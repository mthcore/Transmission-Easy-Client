import { describe, it, expect, vi, beforeEach } from 'vitest';
import TorrentService from '../TorrentService';

type Torrent = {
  id: number;
  hashString: string;
  percentDone: number;
  downloaded: number;
  completedTime: number;
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
    speedRoll: { add: vi.fn(), setData: vi.fn(), data: [] },
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

function rawTorrent(id: number, hash: string, percentDone: number, downloadedEver?: number) {
  return {
    id,
    hashString: hash,
    percentDone,
    name: `t${id}`,
    status: percentDone === 1 ? 6 : 4,
    totalSize: 100,
    sizeWhenDone: 100,
    downloadedEver: downloadedEver ?? 100 * percentDone,
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

function makeService(
  url: string,
  torrents: ReturnType<typeof rawTorrent>[],
  options: { showNotifications?: boolean; deferResponse?: boolean } = {}
) {
  const clientStore = createClientStore();
  const notifier = createNotifier();
  const pending: (() => void)[] = [];
  const transport = {
    url,
    rpcVersion: 18,
    sendAction: vi.fn((body: { arguments?: { ids?: unknown } }) => {
      const response = { result: 'success', arguments: { torrents, removed: [] } };
      requests.push(body?.arguments?.ids);
      if (!options.deferResponse) return Promise.resolve(response);
      return new Promise((resolve) => {
        pending.push(() => resolve(response));
      });
    }),
  };
  const requests: unknown[] = [];
  const service = new TorrentService({
    transport: transport as never,
    clientStore: clientStore as never,
    notifier,
    getShowNotifications: () => options.showNotifications ?? true,
  });
  return {
    service,
    notifier,
    transport,
    clientStore,
    requests,
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
}

describe('TorrentService completion notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      key: string,
      cb: (items: Record<string, unknown>) => void
    ) => {
      const name = typeof key === 'string' ? key : '';
      cb(name in storage ? { [name]: storage[name] } : {});
    }) as never);
    vi.mocked(chrome.storage.local.set).mockImplementation(((
      items: Record<string, unknown>,
      cb: () => void
    ) => {
      Object.assign(storage, items);
      cb();
    }) as never);
    vi.mocked(chrome.storage.local.remove).mockImplementation(((
      keys: string | string[],
      cb: () => void
    ) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
      cb();
    }) as never);
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

  it('does not notify a torrent re-seeded from data already on disk', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);

    // Added for existing files: complete on first sighting AND downloadedEver 0
    const second = makeService(url, [rawTorrent(1, 'aaa', 1), rawTorrent(2, 'bbb', 1, 0)]);
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

  it('notifies a torrent that was added AND finished between two polls', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);

    // Background polling is minutes apart: a small torrent can be seen at 100%
    // on its very first sighting. downloadedEver > 0 proves it really
    // downloaded, and a fresh doneDate proves it happened just now.
    const justNow = Math.trunc(Date.now() / 1000) - 30;
    const second = makeService(url, [
      rawTorrent(1, 'aaa', 1),
      { ...rawTorrent(2, 'bbb', 1), doneDate: justNow },
    ]);
    await second.service.updateTorrents(true);
    expect(second.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a torrent that finished long ago (browser was closed)', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);

    // Finished two days ago via another client: announcing it now would replay
    // every completion that happened while the browser was shut
    const longAgo = Math.trunc(Date.now() / 1000) - 2 * 24 * 3600;
    const second = makeService(url, [
      rawTorrent(1, 'aaa', 1),
      { ...rawTorrent(2, 'bbb', 1), doneDate: longAgo },
    ]);
    await second.service.updateTorrents(true);
    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('respects the "show notifications" setting', async () => {
    const url = 'http://nas:9091/rpc';
    const first = makeService(url, [rawTorrent(1, 'aaa', 0.5)], { showNotifications: false });
    await first.service.updateTorrents(true);
    const second = makeService(url, [rawTorrent(1, 'aaa', 1)], { showNotifications: false });
    await second.service.updateTorrents(true);
    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('does not replay completions that happened while notifications were off', async () => {
    // The baseline used to freeze at the moment notifications were turned off,
    // so everything that finished meanwhile still looked like a torrent we had
    // watched finish, and arrived as a burst on the first poll after re-enabling
    const url = 'http://nas:9091/rpc';

    const watching = makeService(url, [rawTorrent(1, 'aaa', 0.5)]);
    await watching.service.updateTorrents(true);

    const off = makeService(url, [rawTorrent(1, 'aaa', 1)], { showNotifications: false });
    await off.service.updateTorrents(true);
    expect(off.notifier.torrentCompleteNotify).not.toHaveBeenCalled();

    const back = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await back.service.updateTorrents(true);
    expect(back.notifier.torrentCompleteNotify).not.toHaveBeenCalled();

    // ...and it does not start announcing it on the poll after that either
    const later = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await later.service.updateTorrents(true);
    expect(later.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('still announces a torrent that finishes after notifications come back on', async () => {
    const url = 'http://nas:9091/rpc';

    const off = makeService(url, [rawTorrent(1, 'aaa', 0.5)], { showNotifications: false });
    await off.service.updateTorrents(true);

    const back = makeService(url, [rawTorrent(1, 'aaa', 0.5)]);
    await back.service.updateTorrents(true);

    const done = makeService(url, [rawTorrent(1, 'aaa', 1)]);
    await done.service.updateTorrents(true);
    expect(done.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);
  });

  it('coalesces periodic polls but never downgrades a forced refresh', async () => {
    const { service, transport, requests, release } = makeService(
      'http://nas:9091/rpc',
      [rawTorrent(1, 'aaa', 1)],
      { deferResponse: true }
    );
    // Seed the recently-active window so a non-forced poll asks for a delta
    service.resetResponseTime();
    const periodic = service.updateTorrents(false);
    const periodicAgain = service.updateTorrents(false);
    expect(periodicAgain).toBe(periodic);

    // A forced refresh must issue its OWN request rather than reuse the
    // in-flight partial one, or Refresh could never repair a stale list
    const forced = service.updateTorrents(true);
    expect(forced).not.toBe(periodic);

    release();
    await Promise.all([periodic, forced]);
    expect(transport.sendAction).toHaveBeenCalledTimes(2);
    // The forced request must not carry the 'recently-active' filter
    expect(requests).toContain(undefined);
  });
});
