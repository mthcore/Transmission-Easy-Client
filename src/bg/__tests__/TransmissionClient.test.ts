import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The class that wires the background together, and the one gate it applies.
 *
 * Almost all of it forwards to a service, which is why so little is exercised
 * here. Two things are not forwarding, and both are about a service worker
 * being woken up rather than started:
 *
 *  - The daemon's rpc-version decides which calls are even allowed, and MV3
 *    can fire the poll alarm before any session-get has resolved. So
 *    updateTorrents waits for one. Once. The gate has to be a single shared
 *    promise, or a page opening while the alarm fires asks the daemon for its
 *    session twice, and it must not become permanent on failure, or one bad
 *    request leaves the extension gated on a promise that already rejected.
 *
 *  - The transport's callbacks reach back into objects this class does not
 *    own, one of which (the daemon) is nullable and was, until recently,
 *    declared otherwise behind a cast.
 */

/** The transport options the constructor passes; captured to drive callbacks. */
interface TransportOptions {
  url: string;
  getConfig: () => Record<string, unknown>;
  onConnected: () => void;
  onTokenRefresh: () => void;
}

const captured = vi.hoisted(() => ({
  transport: null as (TransportOptions & { rpcVersion: number }) | null,
  torrentOptions: null as Record<string, unknown> | null,
}));

const spies = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  updateTorrents: vi.fn(),
  resetResponseTime: vi.fn(),
  start: vi.fn(),
  startTorrents: vi.fn(),
}));

vi.mock('../TransmissionTransport', () => ({
  default: class {
    rpcVersion = 0;
    constructor(options: TransportOptions) {
      Object.assign(this, options);
      captured.transport = this as unknown as TransportOptions & { rpcVersion: number };
    }
    destroy = vi.fn();
  },
}));

vi.mock('../TorrentService', () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      captured.torrentOptions = options;
    }
    updateTorrents = spies.updateTorrents;
    resetResponseTime = spies.resetResponseTime;
    start = spies.startTorrents;
  },
}));

vi.mock('../FileService', () => ({ default: class {} }));

vi.mock('../SettingsService', () => ({
  default: class {
    updateSettings = spies.updateSettings;
  },
}));

import TransmissionClient from '../TransmissionClient';

const CONFIG = {
  url: 'http://nas.local:9091/transmission/rpc',
  authenticationRequired: false,
  login: '',
  password: '',
  showDownloadCompleteNotifications: true,
  needsTrackerStats: false,
};

function createBg(overrides: { daemon?: unknown } = {}) {
  const daemon = { isActive: false, start: spies.start };
  return {
    bgStore: {
      requireConfig: () => CONFIG,
      client: {},
      flushClient: vi.fn(),
    },
    daemon: 'daemon' in overrides ? overrides.daemon : daemon,
    torrentCompleteNotify: vi.fn(),
    torrentAddedNotify: vi.fn(),
    torrentIsExistsNotify: vi.fn(),
    torrentErrorNotify: vi.fn(),
  } as unknown as ConstructorParameters<typeof TransmissionClient>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.transport = null;
  captured.torrentOptions = null;
  spies.updateSettings.mockResolvedValue(undefined);
  spies.updateTorrents.mockResolvedValue({ result: 'success' });
});

describe('TransmissionClient — the version gate', () => {
  it('asks the daemon for its session before the first poll', async () => {
    // The alarm can fire on a worker that was woken by it, with nothing known
    // about the daemon yet. Polling first means every version-gated call
    // decides against rpcVersion 0.
    const client = new TransmissionClient(createBg());

    await client.updateTorrents();

    expect(spies.updateSettings).toHaveBeenCalledTimes(1);
    expect(spies.updateTorrents).toHaveBeenCalledTimes(1);
  });

  it('polls only after the session has answered, not alongside it', async () => {
    const order: string[] = [];
    spies.updateSettings.mockImplementation(() => {
      order.push('session');
      return Promise.resolve();
    });
    spies.updateTorrents.mockImplementation(() => {
      order.push('torrents');
      return Promise.resolve({ result: 'success' });
    });
    const client = new TransmissionClient(createBg());

    await client.updateTorrents();

    expect(order).toEqual(['session', 'torrents']);
  });

  it('skips the session-get when the version is already known', async () => {
    // This is startup, exactly as Bg.init runs it: updateSettings first, then
    // updateTorrents. updateSettings does not go through the gate, so it
    // leaves the version known and the gate's own promise still unset — and
    // without the rpcVersion check the poll behind it fetches the session a
    // second time on every single startup.
    //
    // Written this way on purpose. Polling twice and asserting one call passes
    // whether the check is there or not, because the promise from the first
    // poll is cached: it looks like it pins the check and pins the caching.
    const client = new TransmissionClient(createBg());
    await client.updateSettings();
    captured.transport!.rpcVersion = 18;

    await client.updateTorrents();

    expect(spies.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch it on every later poll either', async () => {
    const client = new TransmissionClient(createBg());
    await client.updateTorrents();
    captured.transport!.rpcVersion = 18;

    await client.updateTorrents();
    await client.updateTorrents();

    expect(spies.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('shares one session-get between polls that overlap', async () => {
    // A page opening while the alarm fires is two callers arriving at an
    // ungated client at once. Without a shared promise they each start one.
    let release!: () => void;
    spies.updateSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const client = new TransmissionClient(createBg());

    const first = client.updateTorrents();
    const second = client.updateTorrents();
    release();
    await Promise.all([first, second]);

    expect(spies.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('polls anyway when the session-get fails', async () => {
    // Ungated is the fallback, not blocked: a daemon that refuses session-get
    // can still answer torrent-get, and the alternative is a UI that shows
    // nothing at all.
    spies.updateSettings.mockRejectedValue(new Error('401'));
    const client = new TransmissionClient(createBg());

    await client.updateTorrents();

    expect(spies.updateTorrents).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next poll after a failure', async () => {
    // The promise is cleared on rejection. Kept, one bad request would leave
    // every later poll awaiting a promise that has already rejected, and the
    // version would stay unknown for the life of the worker.
    spies.updateSettings.mockRejectedValueOnce(new Error('401'));
    const client = new TransmissionClient(createBg());

    await client.updateTorrents();
    await client.updateTorrents();

    expect(spies.updateSettings).toHaveBeenCalledTimes(2);
  });

  it('does not gate an action the user just asked for', async () => {
    // start/stop and the rest go straight through: the page they were
    // triggered from could not have rendered without a poll having landed.
    const client = new TransmissionClient(createBg());

    client.start([1]);

    expect(spies.updateSettings).not.toHaveBeenCalled();
  });
});

describe('TransmissionClient — what it hands the transport', () => {
  it('builds the transport at the configured url', () => {
    new TransmissionClient(createBg());

    expect(captured.transport!.url).toBe(CONFIG.url);
  });

  it('reads the config through a getter rather than copying it', () => {
    // The config node is mutated in place when settings change; a copy taken
    // at construction would keep sending the old credentials.
    new TransmissionClient(createBg());

    expect(captured.transport!.getConfig()).toBe(CONFIG);
  });

  it('starts the daemon when the transport connects', () => {
    new TransmissionClient(createBg());

    captured.transport!.onConnected();

    expect(spies.start).toHaveBeenCalled();
  });

  it('leaves a daemon that is already polling alone', () => {
    const bg = createBg({ daemon: { isActive: true, start: spies.start } });
    new TransmissionClient(bg);

    captured.transport!.onConnected();

    expect(spies.start).not.toHaveBeenCalled();
  });

  it('survives connecting before there is a daemon at all', () => {
    // Nullable, and it really is null until Bg.init has run. This used to be
    // declared non-null behind a cast, which is a TypeError in a worker with
    // no console open rather than a compile error.
    new TransmissionClient(createBg({ daemon: null }));

    expect(() => captured.transport!.onConnected()).not.toThrow();
  });

  it('drops the recently-active window when the session token is refreshed', () => {
    // A refreshed token means the daemon restarted or the session rolled; the
    // delta window is measured against a clock the old session set.
    new TransmissionClient(createBg());

    captured.transport!.onTokenRefresh();

    expect(spies.resetResponseTime).toHaveBeenCalled();
  });
});

describe('TransmissionClient — what it hands the torrent service', () => {
  it('passes the notifier through, so completions can raise a toast', () => {
    const bg = createBg();
    new TransmissionClient(bg);

    expect(captured.torrentOptions!.notifier).toBe(bg);
  });

  it('reads the notification setting live, not as it was at construction', () => {
    // Turning notifications off has to take effect on the next poll, and the
    // client is not rebuilt when that setting changes.
    new TransmissionClient(createBg());
    const getShowNotifications = captured.torrentOptions!.getShowNotifications as () => boolean;

    expect(getShowNotifications()).toBe(CONFIG.showDownloadCompleteNotifications);
  });

  it('reads the tracker-stats setting live too', () => {
    // It follows whether a column that displays it is visible, which changes
    // while the client is alive.
    new TransmissionClient(createBg());
    const getNeedsTrackerStats = captured.torrentOptions!.getNeedsTrackerStats as () => boolean;

    expect(getNeedsTrackerStats()).toBe(CONFIG.needsTrackerStats);
  });
});
