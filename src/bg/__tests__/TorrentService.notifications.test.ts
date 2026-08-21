import { describe, it, expect, vi, beforeEach } from 'vitest';
import TorrentService from '../TorrentService';

type Torrent = {
  id: number;
  hashString: string;
  percentDone: number;
  stateText: string;
};

/** Stub store keeping the pieces of TorrentStore the service reads */
function createClientStore() {
  const torrents = new Map<number, Torrent>();
  return {
    torrents,
    get torrentIds() {
      return Array.from(torrents.keys());
    },
    get incompleteTorrentIds() {
      return Array.from(torrents.values())
        .filter((t) => t.percentDone !== 1)
        .map((t) => t.id);
    },
    removeTorrentByIds: vi.fn(),
    syncChanges: vi.fn(),
    sync: vi.fn((incoming: Torrent[]) => {
      torrents.clear();
      for (const t of incoming) torrents.set(t.id, t);
    }),
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

function rawTorrent(id: number, hash: string, percentDone: number) {
  return {
    id,
    hashString: hash,
    percentDone,
    name: `t${id}`,
    status: percentDone === 1 ? 6 : 4,
    totalSize: 100,
    sizeWhenDone: 100,
    downloadedEver: 100 * percentDone,
    uploadedEver: 0,
    uploadRatio: 0,
    rateUpload: 0,
    rateDownload: 0,
    error: 0,
    errorString: '',
    recheckProgress: 0,
    peersGettingFromUs: 0,
    peersSendingToUs: 0,
    queuePosition: 0,
    addedDate: 0,
    doneDate: 0,
    downloadDir: '/d',
    metadataPercentComplete: 1,
    peersConnected: 0,
    labels: [],
    bandwidthPriority: 0,
  };
}

/** Storage that survives across TorrentService instances in one test */
let storage: Record<string, unknown>;

function makeService(url: string, torrents: ReturnType<typeof rawTorrent>[]) {
  const clientStore = createClientStore();
  const notifier = createNotifier();
  const transport = {
    url,
    rpcVersion: 18,
    sendAction: vi.fn(() => Promise.resolve({ result: 'success', arguments: { torrents } })),
  };
  const service = new TorrentService({
    transport: transport as never,
    clientStore: clientStore as never,
    notifier,
    getShowNotifications: () => true,
  });
  return { service, notifier, transport, clientStore };
}

describe('TorrentService completion notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => {
      const name = typeof key === 'string' ? key : '';
      return name in storage ? { [name]: storage[name] } : {};
    }) as never);
    vi.mocked(chrome.storage.local.set).mockImplementation((async (
      items: Record<string, unknown>
    ) => {
      Object.assign(storage, items);
    }) as never);
    vi.mocked(chrome.storage.local.remove).mockImplementation((async () => {}) as never);
  });

  it('stays silent on the very first poll of a server', async () => {
    const { service, notifier } = makeService('http://nas:9091/rpc', [
      rawTorrent(1, 'aaa', 1),
      rawTorrent(2, 'bbb', 1),
    ]);
    await service.updateTorrents(true);
    expect(notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('notifies once when a known torrent finishes', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 0.5)]);
    await first.service.updateTorrents(true);
    expect(first.notifier.torrentCompleteNotify).not.toHaveBeenCalled();

    const second = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await second.service.updateTorrents(true);
    expect(second.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);

    // A later poll must not repeat it
    const third = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await third.service.updateTorrents(true);
    expect(third.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('does not notify for torrents already complete on their first sighting', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);

    // A re-seeded torrent shows up already at 100%
    const second = makeService(url, [rawTorrent(1, 'aaa', 1), rawTorrent(2, 'bbb', 1)]);
    await second.service.updateTorrents(true);
    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('does not re-notify after a verify dips below 100%', async () => {
    const url = 'http://nas:9091/rpc';
    const a = makeService(url, [rawTorrent(1, 'aaa', 0.5)]);
    await a.service.updateTorrents(true);
    const b = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await b.service.updateTorrents(true);
    expect(b.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);

    // Verify Local Data drops it below 100% ...
    const c = makeService(url, [rawTorrent(1, 'aaa', 0.4)]);
    await c.service.updateTorrents(true);
    // ... and back up: nothing new was downloaded, so stay quiet
    const d = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await d.service.updateTorrents(true);
    expect(d.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('stays silent after switching to a different server', async () => {
    const a = makeService('http://nas:9091/rpc', [rawTorrent(1, 'aaa', 1)]);
    await a.service.updateTorrents(true);

    // Another daemon, unrelated torrents with ids that happen to differ
    const b = makeService('http://seedbox:9091/rpc', [
      rawTorrent(7, 'zzz', 1),
      rawTorrent(8, 'yyy', 1),
    ]);
    await b.service.updateTorrents(true);
    expect(b.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('coalesces concurrent polls into a single request', async () => {
    const { service, transport } = makeService('http://nas:9091/rpc', [rawTorrent(1, 'aaa', 1)]);
    const [first, second] = [service.updateTorrents(true), service.updateTorrents(true)];
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(transport.sendAction).toHaveBeenCalledTimes(1);
  });
});
