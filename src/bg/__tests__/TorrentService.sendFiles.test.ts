import { describe, it, expect, vi, beforeEach } from 'vitest';
import TorrentService from '../TorrentService';

// Minimal stub of the TorrentStore surface that updateTorrents() touches after
// a torrent is added, so sendFiles() can run end-to-end.
function createClientStore() {
  return {
    activeTorrentIds: [] as number[],
    torrentIds: [] as number[],
    removeTorrentByIds: vi.fn(),
    syncChanges: vi.fn(),
    sync: vi.fn(),
    torrents: new Map<number, { stateText: string }>(),
    currentSpeed: { downloadSpeed: 0, uploadSpeed: 0 },
    speedRoll: { add: vi.fn() },
  };
}

function createNotifier() {
  return {
    torrentCompleteNotify: vi.fn(),
    torrentAddedNotify: vi.fn(),
    torrentIsExistsNotify: vi.fn(),
    torrentErrorNotify: vi.fn(),
  };
}

describe('TorrentService.sendFiles', () => {
  let transport: { sendAction: ReturnType<typeof vi.fn> };
  let notifier: ReturnType<typeof createNotifier>;
  let service: TorrentService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor reads the persisted notified-ids set from storage.
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_query: unknown, cb?: (items: Record<string, unknown>) => void) => cb?.({})
    );

    transport = {
      sendAction: vi.fn((query: { method: string }) => {
        if (query.method === 'torrent-add') {
          return Promise.resolve({
            result: 'success',
            arguments: { 'torrent-added': { id: 1, name: 'Test' } },
          });
        }
        // torrent-get (updateTorrents)
        return Promise.resolve({ result: 'success', arguments: { torrents: [] } });
      }),
    };
    notifier = createNotifier();

    service = new TorrentService({
      // Only the members exercised here are stubbed.
      transport: transport as never,
      clientStore: createClientStore() as never,
      notifier,
      getShowNotifications: () => false,
    });
  });

  it('adds a magnet link by passing the URI straight to torrent-add (issue #12)', async () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test';

    await service.sendFiles([magnet]);

    const addCall = transport.sendAction.mock.calls.find(
      ([query]) => (query as { method: string }).method === 'torrent-add'
    );
    const addArgs = addCall?.[0] as { arguments: { filename: string } } | undefined;
    expect(addArgs?.arguments.filename).toBe(magnet);
    // Magnet links must NOT surface an error the way they did before the fix.
    expect(notifier.torrentErrorNotify).not.toHaveBeenCalled();
  });

  it('does not add genuinely unsupported links and notifies an error', async () => {
    await service.sendFiles(['ftp://example.com/file.torrent']);

    const addCall = transport.sendAction.mock.calls.find(
      ([query]) => (query as { method: string }).method === 'torrent-add'
    );
    expect(addCall).toBeUndefined();
    expect(notifier.torrentErrorNotify).toHaveBeenCalled();
  });

  it('sends the selected directory as download-dir (dialogs pass a plain path string)', async () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test';

    await service.sendFiles([magnet], '/mnt/media/films');

    const addCall = transport.sendAction.mock.calls.find(
      ([query]) => (query as { method: string }).method === 'torrent-add'
    );
    const addArgs = addCall?.[0] as { arguments: Record<string, unknown> } | undefined;
    expect(addArgs?.arguments['download-dir']).toBe('/mnt/media/films');
  });

  it('notifies exactly once when the add fails', async () => {
    transport.sendAction.mockImplementation((query: { method: string }) => {
      if (query.method === 'torrent-add') {
        const err = new Error('invalid or corrupt torrent file') as Error & { code: string };
        err.code = 'TRANSMISSION_ERROR';
        return Promise.reject(err);
      }
      return Promise.resolve({ result: 'success', arguments: { torrents: [] } });
    });
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test';

    await service.sendFiles([magnet]);

    expect(notifier.torrentErrorNotify).toHaveBeenCalledTimes(1);
  });
});
