import { describe, it, expect, vi, afterEach } from 'vitest';
import { types, destroy, isAlive, Instance } from 'mobx-state-tree';
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

function createRoot(
  torrents: Record<string, unknown>[] = [],
  clientOverrides: Record<string, unknown> = {}
): ITestRoot {
  const torrentMap: Record<string, Record<string, unknown>> = {};
  for (const t of torrents) {
    torrentMap[String(t.id)] = t;
  }
  root = TestRoot.create({
    client: { torrents: torrentMap as never, ...clientOverrides },
  });
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
    it('incompleteTorrentIds excludes completed torrents (completion baseline)', () => {
      const r = createRoot([
        makeTorrent({ id: 1, percentDone: 1 }), // completed
        makeTorrent({ id: 2, percentDone: 0.5 }),
      ]);
      expect(r.client.incompleteTorrentIds).toEqual([2]);
    });

    it('activeTorrentIds/activeCount/pausedCount reflect the run state, not completion', () => {
      const r = createRoot([
        makeTorrent({ id: 1, percentDone: 1, statusCode: 6 }), // completed, seeding
        makeTorrent({ id: 2, percentDone: 0.5, statusCode: 0 }), // incomplete, stopped
        makeTorrent({ id: 3, percentDone: 0.2, statusCode: 4 }), // downloading
      ]);
      expect(r.client.activeTorrentIds.sort()).toEqual([1, 3]);
      expect(r.client.activeCount).toBe(2);
      expect(r.client.pausedCount).toBe(1);
    });

    it('replaces a torrent whose id was reused by a different hash', () => {
      // Daemon restart renumbers ids: reconciling stale state onto the new
      // torrent made selection and open dialogs point at the wrong one
      const r = createRoot([makeTorrent({ id: 1, hashString: 'aaa', name: 'old' })]);
      r.client.sync([makeTorrent({ id: 1, hashString: 'bbb', name: 'new' })]);
      expect(r.client.torrents.get('1')?.name).toBe('new');
      expect(r.client.torrents.get('1')?.hashString).toBe('bbb');
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

/**
 * The session-scoped-id guard destroys the old NODE. Asserting on field values
 * cannot see it — a plain map.set on an existing identifier already reconciles
 * every field — so both delete branches could be removed with the suite green.
 */
describe('ClientStore — session-scoped id reuse', () => {
  it('destroys the old node when sync() sees the id under a new hash', () => {
    const r = createRoot([makeTorrent({ id: 1, name: 'old', hashString: 'aaa' })]);
    const oldNode = r.client.torrents.get('1');
    expect(oldNode).toBeDefined();

    r.client.sync([makeTorrent({ id: 1, name: 'new', hashString: 'bbb' })] as never);

    // isAlive only: comparing the nodes themselves makes vitest's differ read
    // fields off the dead one, which MST refuses
    expect(isAlive(oldNode!)).toBe(false);
    expect(isAlive(r.client.torrents.get('1')!)).toBe(true);
    expect(r.client.torrents.get('1')?.name).toBe('new');
  });

  it('destroys the old node on syncChanges too — the path almost every poll takes', () => {
    const r = createRoot([makeTorrent({ id: 1, name: 'old', hashString: 'aaa' })]);
    const oldNode = r.client.torrents.get('1');

    r.client.syncChanges([makeTorrent({ id: 1, name: 'new', hashString: 'bbb' })] as never);

    expect(isAlive(oldNode!)).toBe(false);
    expect(r.client.torrents.get('1')?.hashString).toBe('bbb');
  });

  it('keeps the node when the hash is unchanged', () => {
    const r = createRoot([makeTorrent({ id: 1, name: 'old', hashString: 'aaa' })]);
    const oldNode = r.client.torrents.get('1');

    r.client.syncChanges([makeTorrent({ id: 1, name: 'renamed', hashString: 'aaa' })] as never);

    expect(isAlive(oldNode!)).toBe(true);
    expect(r.client.torrents.get('1')?.name).toBe('renamed');
  });
});

/**
 * sessionTotals prefers the daemon's own counters; the existing test builds a
 * root with no settings at all, so it only ever exercised the fallback.
 */
describe('ClientStore — sessionTotals', () => {
  /** Only the fields SettingsStore actually requires, plus the ones under test */
  const makeSettings = (overrides: Record<string, unknown> = {}) => ({
    downloadSpeedLimit: 0,
    downloadSpeedLimitEnabled: false,
    uploadSpeedLimit: 0,
    uploadSpeedLimitEnabled: false,
    altSpeedEnabled: false,
    altDownloadSpeedLimit: 0,
    altUploadSpeedLimit: 0,
    downloadDir: '/downloads',
    ...overrides,
  });

  it('prefers the daemon session counters over the per-torrent sum', () => {
    const r = createRoot([makeTorrent({ id: 1, downloaded: 500, uploaded: 250 })], {
      settings: makeSettings({ sessionDownloaded: 4242, sessionUploaded: 1717 }) as never,
    });

    expect(r.client.sessionTotals).toEqual({ downloaded: 4242, uploaded: 1717 });
  });

  it('falls back to the per-torrent sum when the daemon reports no counters', () => {
    const r = createRoot([makeTorrent({ id: 1, downloaded: 500, uploaded: 250 })], {
      settings: makeSettings() as never,
    });

    expect(r.client.sessionTotals).toEqual({ downloaded: 500, uploaded: 250 });
  });
});

describe('ClientStore — bandwidth groups', () => {
  const GROUPS = [
    {
      name: 'night',
      honorsSessionLimits: false,
      speedLimitDown: 500,
      speedLimitDownEnabled: true,
      speedLimitUp: 100,
      speedLimitUpEnabled: false,
    },
  ];

  const sentMessage = () =>
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];

  it('getGroups asks for every group and returns the list unchanged', async () => {
    stubApiResult(GROUPS);
    const r = createRoot();

    await expect(r.client.getGroups()).resolves.toEqual(GROUPS);
    expect(sentMessage()).toEqual({ action: 'getGroups', names: undefined });
  });

  it('getGroups forwards a name filter', async () => {
    stubApiResult([]);
    const r = createRoot();

    await r.client.getGroups(['night']);
    expect(sentMessage()).toEqual({ action: 'getGroups', names: ['night'] });
  });

  it('setSessionGroup sends the name and options, and does NOT resync', async () => {
    // group-set changes no torrent and no session setting the mirror holds, so
    // a resync would be a wasted round trip; the caller re-reads the groups.
    stubApiResult();
    const r = createRoot();

    await r.client.setSessionGroup('night', { speedLimitDown: 500, speedLimitDownEnabled: true });

    expect(sentMessage()).toEqual({
      action: 'setSessionGroup',
      name: 'night',
      options: { speedLimitDown: 500, speedLimitDownEnabled: true },
    });
    expect(syncClientMock).not.toHaveBeenCalled();
  });

  it('setTorrentGroup sends the ids and resyncs, since the torrent changed', async () => {
    stubApiResult();
    const r = createRoot();

    await r.client.setTorrentGroup([1, 2], 'night');

    expect(sentMessage()).toEqual({ action: 'setTorrentGroup', ids: [1, 2], group: 'night' });
    expect(syncClientMock).toHaveBeenCalled();
  });

  it('an empty group name detaches the torrent from its group', async () => {
    stubApiResult();
    const r = createRoot();

    await r.client.setTorrentGroup([1], '');
    expect(sentMessage()).toEqual({ action: 'setTorrentGroup', ids: [1], group: '' });
  });

  it('records a rejection in lastErrorMessage like every other action', async () => {
    stubApiError('group-get requires Transmission RPC 17+', 'UNSUPPORTED_RPC_VERSION');
    const r = createRoot();

    await expect(r.client.getGroups()).rejects.toThrow(/RPC 17/);
    expect(r.client.lastErrorMessage).toMatch(/RPC 17/);
  });
});

describe('ClientStore — file wanted vs priority', () => {
  const sentMessage = () =>
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];

  it('filesSetPriority carries only the level', async () => {
    stubApiResult();
    const r = createRoot();

    await r.client.filesSetPriority(7, [0, 1], 3);

    expect(sentMessage()).toEqual({ action: 'setPriority', id: 7, fileIdxs: [0, 1], level: 3 });
  });

  it('filesSetWanted is a separate action, so a priority change cannot re-include a file', async () => {
    stubApiResult();
    const r = createRoot();

    await r.client.filesSetWanted(7, [2], false);

    expect(sentMessage()).toEqual({ action: 'setWanted', id: 7, fileIdxs: [2], wanted: false });
  });

  it('records a rejection like every other action', async () => {
    stubApiError('daemon refused');
    const r = createRoot();

    await expect(r.client.filesSetWanted(7, [0], true)).rejects.toThrow(/daemon refused/);
    expect(r.client.lastErrorMessage).toMatch(/daemon refused/);
  });
});
