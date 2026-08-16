import { describe, it, expect, vi, afterEach } from 'vitest';
import { types, destroy, Instance } from 'mobx-state-tree';
import ClientStore from '../ClientStore';

// ClientStore.syncClient() delegates to getRoot(self).syncClient(), so it
// needs a parent providing that action -- same minimal-root pattern already
// used by TorrentListStore.test.ts. Declared once at module scope (rather
// than inside .actions()) so tests can assert on it directly: mobx-state-tree
// wraps action functions, so a per-instance vi.fn() created inside the
// actions factory isn't the same reference the store exposes back out.
const syncClientMock = vi.fn(() => Promise.resolve());

const TestRoot = types
  .model('TestRoot', {
    client: types.optional(ClientStore, {}),
  })
  .actions(() => ({
    syncClient: syncClientMock,
  }));

type ITestRoot = Instance<typeof TestRoot>;

function makeTorrent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    statusCode: 4,
    errorCode: 0,
    errorString: '',
    name: 'Test',
    size: 1000,
    percentDone: 0.5,
    recheckProgress: 0,
    downloaded: 500,
    uploaded: 250,
    shared: 500,
    uploadSpeed: 0,
    downloadSpeed: 1024,
    eta: 100,
    activePeers: 2,
    peers: 5,
    activeSeeds: 1,
    seeds: 3,
    order: 1,
    addedTime: 1700000000,
    completedTime: 0,
    labels: [],
    bandwidthPriority: 0,
    ...overrides,
  };
}

let root: ITestRoot | null = null;

function createRoot(torrents: Record<string, unknown>[] = []): ITestRoot {
  const torrentMap: Record<string, Record<string, unknown>> = {};
  for (const t of torrents) {
    torrentMap[String(t.id)] = t;
  }
  root = TestRoot.create({ client: { torrents: torrentMap as never } });
  return root;
}

// Every callApi()-backed action round-trips through chrome.runtime.sendMessage.
function stubApiResult(result: unknown = {}) {
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation((_msg, cb) =>
    cb({ result })
  );
}

function stubApiError(message: string, code?: string) {
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation((_msg, cb) =>
    cb({ error: { message, code } })
  );
}

afterEach(() => {
  if (root) {
    destroy(root);
    root = null;
  }
  vi.clearAllMocks();
});

describe('ClientStore', () => {
  describe('sync', () => {
    it('adds new torrents and updates existing ones by id', () => {
      const r = createRoot([makeTorrent({ id: 1, name: 'Original' })]);
      r.client.sync([
        makeTorrent({ id: 1, name: 'Renamed' }),
        makeTorrent({ id: 2, name: 'Second' }),
      ]);

      expect(r.client.torrentIds.sort()).toEqual([1, 2]);
      expect(r.client.torrents.get('1')?.name).toBe('Renamed');
      expect(r.client.torrents.get('2')?.name).toBe('Second');
    });

    it('removes torrents that are no longer present in the sync payload', () => {
      const r = createRoot([makeTorrent({ id: 1 }), makeTorrent({ id: 2 })]);
      r.client.sync([makeTorrent({ id: 1 })]);

      expect(r.client.torrentIds).toEqual([1]);
    });
  });

  describe('syncChanges', () => {
    it('patches torrents in place without removing anything', () => {
      const r = createRoot([makeTorrent({ id: 1 }), makeTorrent({ id: 2 })]);
      r.client.syncChanges([makeTorrent({ id: 1, downloadSpeed: 9999 })]);

      expect(r.client.torrentIds.sort()).toEqual([1, 2]);
      expect(r.client.torrents.get('1')?.downloadSpeed).toBe(9999);
    });
  });

  describe('views', () => {
    it('activeTorrentIds/activeCount exclude completed torrents', () => {
      const r = createRoot([
        makeTorrent({ id: 1, percentDone: 1 }), // completed
        makeTorrent({ id: 2, percentDone: 0.5 }),
      ]);
      expect(r.client.activeTorrentIds).toEqual([2]);
      expect(r.client.activeCount).toBe(1);
    });

    it('currentSpeed sums download/upload speed across torrents', () => {
      const r = createRoot([
        makeTorrent({ id: 1, downloadSpeed: 100, uploadSpeed: 10 }),
        makeTorrent({ id: 2, downloadSpeed: 200, uploadSpeed: 20 }),
      ]);
      expect(r.client.currentSpeed).toEqual({ downloadSpeed: 300, uploadSpeed: 30 });
    });

    it('currentSpeedStr shows "-" when a direction is idle', () => {
      const r = createRoot([makeTorrent({ id: 1, downloadSpeed: 0, uploadSpeed: 0 })]);
      expect(r.client.currentSpeedStr.downloadSpeedStr).toBe('-');
      expect(r.client.currentSpeedStr.uploadSpeedStr).toBe('-');
    });

    it('sessionTotals sums downloaded/uploaded across torrents', () => {
      const r = createRoot([
        makeTorrent({ id: 1, downloaded: 100, uploaded: 10 }),
        makeTorrent({ id: 2, downloaded: 200, uploaded: 20 }),
      ]);
      expect(r.client.sessionTotals).toEqual({ downloaded: 300, uploaded: 30 });
    });

    it('torrentCountsStr is empty with no torrents', () => {
      const r = createRoot([]);
      expect(r.client.torrentCountsStr).toBe('');
    });
  });

  describe('exceptionLog error tracking', () => {
    it('clears lastErrorMessage after a successful action', async () => {
      const r = createRoot();
      r.client.setLastErrorMessage('stale error');
      stubApiResult({});

      await r.client.torrentsStart([1]);
      expect(r.client.lastErrorMessage).toBeUndefined();
    });

    it('sets lastErrorMessage and rethrows on API error', async () => {
      const r = createRoot();
      stubApiError('daemon unreachable', 'RESPONSE_IS_NOT_OK');

      await expect(r.client.torrentsStart([1])).rejects.toThrow('daemon unreachable');
      expect(r.client.lastErrorMessage).toContain('daemon unreachable');
    });
  });

  describe('RPC action wiring', () => {
    // Each of these thin wrappers exists to forward one UI toggle to exactly
    // one Transmission RPC action name. Nothing at the type level guarantees
    // action name / payload key stay correct as new settings get added across
    // messages.ts -> Bg.ts -> TransmissionClient.ts -> SettingsService.ts ->
    // ClientStore.ts -- this table is what actually catches a copy-paste slip.
    const cases: Array<{
      method: keyof Instance<typeof ClientStore>;
      args: unknown[];
      action: string;
      payload: Record<string, unknown>;
    }> = [
      {
        method: 'setDhtEnabled',
        args: [true],
        action: 'setDhtEnabled',
        payload: { enabled: true },
      },
      {
        method: 'setPexEnabled',
        args: [false],
        action: 'setPexEnabled',
        payload: { enabled: false },
      },
      {
        method: 'setDownloadSpeedLimit',
        args: [512],
        action: 'setDownloadSpeedLimit',
        payload: { speed: 512 },
      },
      {
        method: 'setPeerPort',
        args: [51413],
        action: 'setPeerPort',
        payload: { value: 51413 },
      },
      {
        method: 'setEncryption',
        args: ['required'],
        action: 'setEncryption',
        payload: { mode: 'required' },
      },
      {
        method: 'setSeedRatioLimit',
        args: [2.5],
        action: 'setSeedRatioLimit',
        payload: { value: 2.5 },
      },
    ];

    it.each(cases)('$method sends action "$action" with the right payload', async (c) => {
      const r = createRoot();
      stubApiResult({});
      const fn = r.client[c.method] as (...args: unknown[]) => Promise<unknown>;

      await fn(...c.args);

      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sentMessage).toMatchObject({ action: c.action, ...c.payload });
    });

    it('torrentsStart sends the start action with the given ids and syncs the client', async () => {
      const r = createRoot();
      stubApiResult({});

      await r.client.torrentsStart([1, 2, 3]);

      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sentMessage).toMatchObject({ action: 'start', ids: [1, 2, 3] });
      expect(syncClientMock).toHaveBeenCalledTimes(1);
    });

    it('reannounce does not trigger a client sync', async () => {
      const r = createRoot();
      stubApiResult({});

      await r.client.reannounce([1]);

      expect(syncClientMock).not.toHaveBeenCalled();
    });
  });
});
