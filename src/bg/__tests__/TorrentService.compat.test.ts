import { beforeEach, describe, expect, it, vi } from 'vitest';
import TorrentService, { type NormalizedTorrent } from '../TorrentService';

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

function baseTorrent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Test',
    totalSize: 1000,
    sizeWhenDone: 1000,
    percentDone: 0.5,
    downloadedEver: 500,
    uploadedEver: 100,
    rateUpload: 0,
    rateDownload: 0,
    eta: 60,
    etaIdle: -1,
    status: 4,
    error: 0,
    errorString: '',
    uploadRatio: 0.2,
    ...overrides,
  };
}

function createService(rpcVersion: number) {
  (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  const sendAction = vi.fn().mockResolvedValue({
    result: 'success',
    arguments: { torrents: [] },
  });
  const clientStore = createClientStore();
  const service = new TorrentService({
    transport: { sendAction, rpcVersion } as never,
    clientStore: clientStore as never,
    notifier: createNotifier(),
    getShowNotifications: () => false,
  });
  return { service, sendAction, clientStore };
}

describe('TorrentService rpc-version compat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not request sequential_download from old daemons', async () => {
    const { service, sendAction } = createService(16);
    await service.updateTorrents();
    const query = sendAction.mock.calls[0][0] as { arguments: { fields: string[] } };
    expect(query.arguments.fields).not.toContain('sequential_download');
  });

  it('requests sequential_download from 4.1+ daemons', async () => {
    const { service, sendAction } = createService(18);
    await service.updateTorrents();
    const query = sendAction.mock.calls[0][0] as { arguments: { fields: string[] } };
    expect(query.arguments.fields).toContain('sequential_download');
  });

  it('preserves eta sentinels (-1/-2) and reads sequential_download', async () => {
    const { service, sendAction, clientStore } = createService(18);
    sendAction.mockResolvedValue({
      result: 'success',
      arguments: {
        torrents: [
          baseTorrent({ id: 1, eta: -1 }),
          baseTorrent({ id: 2, eta: -2, sequential_download: true }),
          baseTorrent({ id: 3, eta: 120 }),
        ],
      },
    });

    await service.updateTorrents();

    const synced = clientStore.sync.mock.calls[0][0] as NormalizedTorrent[];
    expect(synced.map((t) => t.eta)).toEqual([-1, -2, 120]);
    expect(synced[1].sequentialDownload).toBe(true);
    expect(synced[0].sequentialDownload).toBeUndefined();
  });

  it('setSequentialDownload is refused for daemons below rpc 18', async () => {
    const { service, sendAction } = createService(17);
    await expect(service.setSequentialDownload([1], true)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RPC_VERSION',
    });
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('setSequentialDownload sends the snake_case key at rpc 18', async () => {
    const { service, sendAction } = createService(18);
    await service.setSequentialDownload([1, 2], true);
    expect(sendAction.mock.calls[0][0]).toEqual({
      method: 'torrent-set',
      arguments: { ids: [1, 2], sequential_download: true },
    });
  });

  it('sendFile only forwards sequentialDownload to 4.1+ daemons', async () => {
    const older = createService(17);
    older.sendAction.mockResolvedValue({
      result: 'success',
      arguments: { 'torrent-added': { id: 1, name: 'Test' } },
    });
    await older.service.sendFile({ url: 'http://example.com/a.torrent' }, undefined, {
      sequentialDownload: true,
    });
    const oldQuery = older.sendAction.mock.calls[0][0] as { arguments: Record<string, unknown> };
    expect(oldQuery.arguments).not.toHaveProperty('sequential_download');

    const newer = createService(18);
    newer.sendAction.mockResolvedValue({
      result: 'success',
      arguments: { 'torrent-added': { id: 1, name: 'Test' } },
    });
    await newer.service.sendFile({ url: 'http://example.com/a.torrent' }, undefined, {
      sequentialDownload: true,
    });
    const newQuery = newer.sendAction.mock.calls[0][0] as { arguments: Record<string, unknown> };
    expect(newQuery.arguments['sequential_download']).toBe(true);
  });

  it('requests file-count/primary-mime-type in details only from 4.0+ daemons', async () => {
    const older = createService(16);
    older.sendAction.mockResolvedValue({
      result: 'success',
      arguments: { torrents: [{ id: 1, trackerStats: [] }] },
    });
    await older.service.getTorrentDetails(1);
    const oldQuery = older.sendAction.mock.calls[0][0] as { arguments: { fields: string[] } };
    expect(oldQuery.arguments.fields).not.toContain('file-count');

    const newer = createService(17);
    newer.sendAction.mockResolvedValue({
      result: 'success',
      arguments: {
        torrents: [{ id: 1, trackerStats: [], 'file-count': 12, 'primary-mime-type': 'video/mp4' }],
      },
    });
    const details = await newer.service.getTorrentDetails(1);
    const newQuery = newer.sendAction.mock.calls[0][0] as { arguments: { fields: string[] } };
    expect(newQuery.arguments.fields).toContain('file-count');
    expect(newQuery.arguments.fields).toContain('primary-mime-type');
    expect(details.fileCount).toBe(12);
    expect(details.primaryMimeType).toBe('video/mp4');
  });
});
