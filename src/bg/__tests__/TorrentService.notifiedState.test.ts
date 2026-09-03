import { describe, it, expect, vi, beforeEach } from 'vitest';
import TorrentService from '../TorrentService';

/**
 * `TorrentService.notifications.test.ts` pins WHICH notifications fire.
 * This file pins the other half: **the state that gets persisted**, and the
 * concurrency rules around it.
 *
 * The completion bookkeeping is effectively
 * `(previousState, torrents, config) -> (notifications, nextState)`, and the
 * persisted `_notifiedState` IS that machine's output — notification
 * assertions alone cannot verify it. Two of the rules below exist only because
 * overlapping polls corrupted it in the past.
 */

const KEY = '_notifiedState';
const WINDOW = 15 * 60; // COMPLETION_NOTIFY_WINDOW, seconds
const nowSec = () => Math.trunc(Date.now() / 1000);

type Torrent = {
  id: number;
  hashString: string;
  percentDone: number;
  downloaded: number;
  completedTime: number;
  stateText: string;
};

function createClientStore() {
  // Keyed by string, as MST maps are — see TorrentService.notifications.test.
  const torrents = new Map<string, Torrent>();
  return {
    torrents,
    get torrentIds() {
      return Array.from(torrents.values()).map((t) => t.id);
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
      for (const t of incoming) torrents.set(String(t.id), t);
    }),
    currentSpeed: { downloadSpeed: 0, uploadSpeed: 0 },
    speedRoll: { add: vi.fn(), setData: vi.fn(), data: [] },
  };
}

function raw(
  id: number,
  hash: string,
  percentDone: number,
  extra: { downloadedEver?: number; doneDate?: number } = {}
) {
  return {
    id,
    hashString: hash,
    percentDone,
    name: `t${id}`,
    status: percentDone === 1 ? 6 : 4,
    totalSize: 100,
    sizeWhenDone: 100,
    downloadedEver: extra.downloadedEver ?? 100 * percentDone,
    doneDate: extra.doneDate ?? 0,
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
    downloadDir: '/d',
    metadataPercentComplete: 1,
    peersConnected: 0,
    labels: [],
    bandwidthPriority: 0,
  };
}

let storage: Record<string, unknown>;

function makeService(
  url: string,
  torrents: ReturnType<typeof raw>[],
  options: { showNotifications?: boolean; defer?: boolean } = {}
) {
  const clientStore = createClientStore();
  const notifier = {
    torrentCompleteNotify: vi.fn(),
    torrentAddedNotify: vi.fn(),
    torrentIsExistsNotify: vi.fn(),
    torrentErrorNotify: vi.fn(),
  };
  const pending: (() => void)[] = [];
  let payload = torrents;
  const transport = {
    url,
    rpcVersion: 18,
    sendAction: vi.fn(() => {
      const response = { result: 'success', arguments: { torrents: payload, removed: [] } };
      if (!options.defer) return Promise.resolve(response);
      return new Promise((resolve) => pending.push(() => resolve(response)));
    }),
  };
  const service = new TorrentService({
    transport: transport as never,
    clientStore: clientStore as never,
    notifier,
    getShowNotifications: () => options.showNotifications ?? true,
  });
  return {
    service,
    notifier,
    clientStore,
    setPayload: (next: ReturnType<typeof raw>[]) => {
      payload = next;
    },
    /** Release deferred responses in order; index 0 is the oldest request. */
    release: (index?: number) => {
      if (index === undefined) pending.splice(0).forEach((r) => r());
      else pending.splice(index, 1).forEach((r) => r());
    },
  };
}

const persisted = () => storage[KEY] as { url: string; completed: string[]; known: string[] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe('the persisted notified state', () => {
  it('records the server url, every known hash and every completed hash', async () => {
    const { service } = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1), raw(2, 'bbb', 0.5)]);
    await service.updateTorrents(true);

    expect(persisted()).toEqual({
      url: 'http://nas:9091/rpc',
      known: ['aaa', 'bbb'],
      completed: ['aaa'],
    });
  });

  it('keeps a notified hash while its torrent is still listed, so a verify dip cannot re-notify', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);
    expect(persisted().completed).toEqual(['aaa']);

    // Same torrent, now mid-verify: no longer complete, but still present
    const second = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 0.4)]);
    await second.service.updateTorrents(true);

    expect(persisted().completed).toEqual(['aaa']);
    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('drops a notified hash once its torrent leaves the list', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1), raw(2, 'bbb', 1)]);
    await first.service.updateTorrents(true);
    expect(persisted().completed.sort()).toEqual(['aaa', 'bbb']);

    // 'bbb' removed from the daemon — its hash must not accumulate forever
    const second = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)]);
    await second.service.updateTorrents(true);

    expect(persisted().completed).toEqual(['aaa']);
    expect(persisted().known).toEqual(['aaa']);
  });

  it('rewrites the state wholesale when the server changes', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);

    const second = makeService('http://other:9091/rpc', [raw(9, 'zzz', 1)]);
    await second.service.updateTorrents(true);

    expect(persisted()).toEqual({
      url: 'http://other:9091/rpc',
      known: ['zzz'],
      completed: ['zzz'],
    });
    // Silent for one cycle rather than announcing the other daemon's library
    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('clears the stored state entirely while notifications are off', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)]);
    await first.service.updateTorrents(true);
    expect(storage[KEY]).toBeDefined();

    const off = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)], {
      showNotifications: false,
    });
    await off.service.updateTorrents(true);
    await flush();

    // Dropped, not frozen: a frozen baseline would replay every completion
    // that happened while notifications were off as a burst when they return.
    expect(storage[KEY]).toBeUndefined();
  });
});

describe('the completion window boundary', () => {
  it('announces a first sighting that finished just inside the window', async () => {
    const { service, notifier } = makeService('http://nas:9091/rpc', [
      raw(1, 'seed', 0.5), // establish the server without seeing 'new'
    ]);
    await service.updateTorrents(true);

    const second = makeService('http://nas:9091/rpc', [
      raw(1, 'seed', 0.5),
      raw(2, 'new', 1, { downloadedEver: 100, doneDate: nowSec() - (WINDOW - 30) }),
    ]);
    await second.service.updateTorrents(true);

    expect(second.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);
    expect(notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('stays silent for a first sighting that finished just outside the window', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'seed', 0.5)]);
    await first.service.updateTorrents(true);

    const second = makeService('http://nas:9091/rpc', [
      raw(1, 'seed', 0.5),
      raw(2, 'old', 1, { downloadedEver: 100, doneDate: nowSec() - (WINDOW + 30) }),
    ]);
    await second.service.updateTorrents(true);

    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
    // Still recorded, so it is never announced later either
    expect(persisted().completed).toContain('old');
  });

  it('stays silent when the daemon clock runs ahead of the browser', async () => {
    // A negative age passes a bare "< WINDOW" test for ANY completion date, so
    // every torrent on a clock-skewed daemon would be announced at once.
    const first = makeService('http://nas:9091/rpc', [raw(1, 'seed', 0.5)]);
    await first.service.updateTorrents(true);

    const second = makeService('http://nas:9091/rpc', [
      raw(1, 'seed', 0.5),
      raw(2, 'future', 1, { downloadedEver: 100, doneDate: nowSec() + 3600 }),
    ]);
    await second.service.updateTorrents(true);

    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });

  it('stays silent for a first sighting with no completion date at all', async () => {
    const first = makeService('http://nas:9091/rpc', [raw(1, 'seed', 0.5)]);
    await first.service.updateTorrents(true);

    const second = makeService('http://nas:9091/rpc', [
      raw(1, 'seed', 0.5),
      raw(2, 'nodate', 1, { downloadedEver: 100, doneDate: 0 }),
    ]);
    await second.service.updateTorrents(true);

    expect(second.notifier.torrentCompleteNotify).not.toHaveBeenCalled();
  });
});

describe('concurrency around the notified state', () => {
  it('two overlapping polls announce a completion once, not twice', async () => {
    // Both polls read the baseline when their RESPONSE lands, and the second
    // waits on the first's result rather than on the stale value it is about
    // to invalidate. Without that chaining both computed from the same
    // baseline and both notified.
    const seed = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 0.5)]);
    await seed.service.updateTorrents(true);

    const overlap = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)], { defer: true });
    const pollA = overlap.service.updateTorrents(true);
    const pollB = overlap.service.updateTorrents(true);
    overlap.release();
    await Promise.all([pollA, pollB]);
    await flush();

    expect(overlap.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);
  });

  it('an out-of-order response does not rewrite the state a newer one wrote', async () => {
    const seed = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 0.5)]);
    await seed.service.updateTorrents(true);

    const svc = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)], { defer: true });
    const pollA = svc.service.updateTorrents(true); // older request
    const pollB = svc.service.updateTorrents(true); // newer request
    // Newer answers first and is applied...
    svc.release(1);
    await pollB;
    await flush();
    const afterNewer = JSON.parse(JSON.stringify(persisted()));

    // ...then the older answer arrives and must be discarded
    svc.release(0);
    await pollA;
    await flush();

    expect(persisted()).toEqual(afterNewer);
    expect(svc.notifier.torrentCompleteNotify).toHaveBeenCalledTimes(1);
  });

  it('a rejected poll does not strand every later poll on a never-settling promise', async () => {
    const svc = makeService('http://nas:9091/rpc', [raw(1, 'aaa', 1)]);
    // First call rejects, the chain must recover from a null baseline
    vi.mocked(svc.clientStore.sync).mockImplementationOnce(() => {
      throw new Error('sync blew up');
    });

    await expect(svc.service.updateTorrents(true)).rejects.toThrow('sync blew up');
    await expect(svc.service.updateTorrents(true)).resolves.toBeDefined();
  });
});
