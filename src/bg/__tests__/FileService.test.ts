import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileService from '../FileService';
import { FILE_PRIORITY_CHUNK_SIZE } from '../../constants';

/**
 * FileService decides WHAT THE DAEMON DOWNLOADS.
 *
 * `wanted` and `priority` are INDEPENDENT here, as they are on the daemon. They
 * used to be collapsed into one 0..3 scale where 0 meant "not wanted", so
 * excluding a file discarded its priority and re-including it silently returned
 * it to normal. The assertions below pin the split. The ones that previously
 * pinned the conflation were rewritten deliberately, as part of that change —
 * not because they became inconvenient.
 */

type SendAction = ReturnType<typeof vi.fn>;

function createTransport(response: unknown = { result: 'success', arguments: { torrents: [] } }) {
  return { sendAction: vi.fn(() => Promise.resolve(response)) as SendAction };
}

/** One entry of the daemon's torrent-get files/fileStats pair */
function file(name: string, length: number, bytesCompleted: number) {
  return { name, length, bytesCompleted };
}

describe('FileService.getFileList', () => {
  let transport: ReturnType<typeof createTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests exactly the three fields it needs, for one id', async () => {
    transport = createTransport({
      result: 'success',
      arguments: { torrents: [{ id: 7, files: [], fileStats: [] }] },
    });
    const service = new FileService(transport as never);

    await service.getFileList(7);

    const [query, parser] = transport.sendAction.mock.calls[0];
    expect(query).toEqual({
      method: 'torrent-get',
      arguments: { fields: ['id', 'files', 'fileStats'], ids: [7] },
    });
    // A custom parser is passed: file names are arbitrary bytes and the daemon
    // can emit control characters that strict JSON.parse rejects
    expect(typeof parser).toBe('function');
  });

  it('maps every field of a file, with shortName equal to the full name', async () => {
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [
          {
            id: 1,
            files: [file('Season 1/ep01.mkv', 1000, 400)],
            fileStats: [{ wanted: true, priority: 0 }],
          },
        ],
      },
    });
    const service = new FileService(transport as never);

    const files = await service.getFileList(1);

    // shortName is NOT shortened here — FileListStore.setFilesShortName strips
    // the common directory prefix later, on the UI side
    expect(files).toEqual([
      {
        name: 'Season 1/ep01.mkv',
        shortName: 'Season 1/ep01.mkv',
        size: 1000,
        downloaded: 400,
        priority: 2,
        wanted: true,
      },
    ]);
  });

  // Transmission sends priority -1/0/1 plus an INDEPENDENT `wanted` flag; the
  // UI collapses both into one 0..3 scale where 0 means "do not download".
  // Anything separating the two again must preserve this mapping or change it
  // deliberately.
  it.each([
    { wanted: true, priority: -1, expected: 1, label: 'low' },
    { wanted: true, priority: 0, expected: 2, label: 'normal' },
    { wanted: true, priority: 1, expected: 3, label: 'high' },
    { wanted: false, priority: -1, expected: 1, label: 'excluded, still low' },
    { wanted: false, priority: 0, expected: 2, label: 'excluded, still normal' },
    { wanted: false, priority: 1, expected: 3, label: 'excluded, still HIGH' },
  ])('maps wanted=$wanted priority=$priority to $expected ($label)', async (row) => {
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [
          {
            id: 1,
            files: [file('a', 1, 0)],
            fileStats: [{ wanted: row.wanted, priority: row.priority }],
          },
        ],
      },
    });
    const service = new FileService(transport as never);

    const files = await service.getFileList(1);
    expect(files[0].priority).toBe(row.expected);
    expect(files[0].wanted).toBe(row.wanted);
  });

  it('keeps the priority of an excluded file', async () => {
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [
          {
            id: 1,
            files: [file('kept-high', 1, 0), file('excluded-high', 1, 0)],
            fileStats: [
              { wanted: true, priority: 1 },
              { wanted: false, priority: 1 },
            ],
          },
        ],
      },
    });
    const service = new FileService(transport as never);

    const files = await service.getFileList(1);
    // Both are HIGH on the daemon and both read as HIGH here; only `wanted`
    // tells them apart. Under the old scale the second read as 0, which was
    // indistinguishable from "excluded and low".
    expect(files.map((f) => f.priority)).toEqual([3, 3]);
    expect(files.map((f) => f.wanted)).toEqual([true, false]);
  });

  it('pairs files with fileStats by index', async () => {
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [
          {
            id: 1,
            files: [file('a', 10, 10), file('b', 20, 0), file('c', 30, 15)],
            fileStats: [
              { wanted: true, priority: 1 },
              { wanted: false, priority: 0 },
              { wanted: true, priority: -1 },
            ],
          },
        ],
      },
    });
    const service = new FileService(transport as never);

    const files = await service.getFileList(1);
    expect(files.map((f) => [f.name, f.priority, f.wanted, f.downloaded])).toEqual([
      ['a', 3, true, 10],
      ['b', 2, false, 0],
      ['c', 1, true, 15],
    ]);
  });

  it('picks the requested torrent out of a multi-torrent response', async () => {
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [
          { id: 1, files: [file('wrong', 1, 0)], fileStats: [{ wanted: true, priority: 0 }] },
          { id: 2, files: [file('right', 2, 0)], fileStats: [{ wanted: true, priority: 0 }] },
        ],
      },
    });
    const service = new FileService(transport as never);

    const files = await service.getFileList(2);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('right');
  });

  it('rejects when the response does not contain the requested torrent', async () => {
    transport = createTransport({
      result: 'success',
      arguments: { torrents: [{ id: 99, files: [], fileStats: [] }] },
    });
    const service = new FileService(transport as never);

    await expect(service.getFileList(1)).rejects.toThrow("Files don't received");
  });

  it('returns an empty list for a torrent that reports no files', async () => {
    // NOTE: reached only because `files` is [] AND the id matched — the guard
    // is `if (!files)`, and [] is truthy. A torrent present with zero files is
    // therefore fine, while an absent torrent rejects.
    transport = createTransport({
      result: 'success',
      arguments: { torrents: [{ id: 1, files: [], fileStats: [] }] },
    });
    const service = new FileService(transport as never);

    await expect(service.getFileList(1)).resolves.toEqual([]);
  });

  it('accepts a hashString id, like every other torrent-addressing call', async () => {
    const hash = 'a'.repeat(40);
    transport = createTransport({
      result: 'success',
      arguments: { torrents: [{ id: hash, files: [], fileStats: [] }] },
    });
    const service = new FileService(transport as never);

    await service.getFileList(hash);
    expect(transport.sendAction.mock.calls[0][0].arguments.ids).toEqual([hash]);
  });

  it('KNOWN GAP: throws a raw TypeError when fileStats is shorter than files', async () => {
    // Unguarded parallel indexing: `torrent.fileStats[index]` is undefined and
    // `!state.wanted` throws. Pinned rather than fixed here — a daemon or proxy
    // that truncates one array surfaces as an opaque crash instead of a handled
    // error. Worth fixing on its own.
    transport = createTransport({
      result: 'success',
      arguments: {
        torrents: [{ id: 1, files: [file('a', 1, 0), file('b', 1, 0)], fileStats: [] }],
      },
    });
    const service = new FileService(transport as never);

    await expect(service.getFileList(1)).rejects.toThrow(TypeError);
  });
});

describe('FileService.setPriority', () => {
  let transport: ReturnType<typeof createTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = createTransport({ result: 'success', arguments: {} });
  });

  const args = (call: number) => transport.sendAction.mock.calls[call][0].arguments;

  it.each([
    { level: 1, key: 'priority-low' },
    { level: 2, key: 'priority-normal' },
    { level: 3, key: 'priority-high' },
  ])('level $level sends $key ALONE, without touching wanted', async ({ level, key }) => {
    const service = new FileService(transport as never);

    await service.setPriority(4, level, [0, 1, 2]);

    expect(transport.sendAction).toHaveBeenCalledTimes(1);
    expect(transport.sendAction.mock.calls[0][0].method).toBe('torrent-set');
    // Setting a priority must NOT re-include an excluded file: that is the
    // whole point of separating the two.
    expect(args(0)).toEqual({ ids: [4], [key]: [0, 1, 2] });
  });

  it('an out-of-range level falls back to normal rather than sending nothing', async () => {
    const service = new FileService(transport as never);

    await service.setPriority(4, 42, [1]);

    expect(args(0)).toEqual({ ids: [4], 'priority-normal': [1] });
  });

  it('setWanted sends files-wanted or files-unwanted, and no priority key', async () => {
    const service = new FileService(transport as never);

    await service.setWanted(4, true, [1, 2]);
    expect(args(0)).toEqual({ ids: [4], 'files-wanted': [1, 2] });

    transport.sendAction.mockClear();
    await service.setWanted(4, false, [3]);
    expect(args(0)).toEqual({ ids: [4], 'files-unwanted': [3] });
  });

  it('setWanted chunks and skips an empty list like setPriority', async () => {
    const service = new FileService(transport as never);
    await service.setWanted(
      1,
      true,
      Array.from({ length: 501 }, (_, i) => i)
    );
    expect(transport.sendAction).toHaveBeenCalledTimes(3);

    transport.sendAction.mockClear();
    await expect(service.setWanted(1, false, [])).resolves.toEqual([]);
    expect(transport.sendAction).not.toHaveBeenCalled();
  });

  it(`chunks at ${FILE_PRIORITY_CHUNK_SIZE} indices per request`, async () => {
    const service = new FileService(transport as never);
    const idxs = Array.from({ length: 501 }, (_, i) => i);

    await service.setPriority(9, 2, idxs);

    // 501 = 250 + 250 + 1
    expect(transport.sendAction).toHaveBeenCalledTimes(3);
    expect(args(0)['priority-normal']).toHaveLength(FILE_PRIORITY_CHUNK_SIZE);
    expect(args(1)['priority-normal']).toHaveLength(FILE_PRIORITY_CHUNK_SIZE);
    expect(args(2)['priority-normal']).toEqual([500]);
    for (let i = 0; i < 3; i++) {
      expect(args(i).ids).toEqual([9]);
    }
  });

  it('preserves index order and coverage across chunk boundaries', async () => {
    const service = new FileService(transport as never);
    const idxs = Array.from({ length: FILE_PRIORITY_CHUNK_SIZE + 3 }, (_, i) => i * 2);

    await service.setWanted(1, false, idxs);

    const sent = transport.sendAction.mock.calls.flatMap(
      (call) => call[0].arguments['files-unwanted'] as number[]
    );
    expect(sent).toEqual(idxs);
  });

  it('resolves only once every chunk has resolved', async () => {
    let resolved = 0;
    const slow = {
      sendAction: vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolved += 1;
              resolve({ result: 'success', arguments: {} });
            }, 0)
          )
      ),
    };
    const service = new FileService(slow as never);

    await service.setPriority(
      1,
      3,
      Array.from({ length: 501 }, (_, i) => i)
    );
    expect(resolved).toBe(3);
  });
});
