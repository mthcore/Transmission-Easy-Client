import { describe, it, expect, vi, beforeEach } from 'vitest';
import { types, destroy, Instance } from 'mobx-state-tree';
import SpaceWatcherStore from '../SpaceWatcherStore';

/**
 * The free-space indicator polls on its own, and every failure mode it has ends
 * the same way: stuck.
 *
 * The flow guards its own re-entry, so a state left on 'pending' is not a
 * cosmetic problem — it blocks every later attempt, and the footer reads
 * "Loading…" for the rest of the session. Both of the ways that used to happen
 * are cases here: a client that is not there yet, and settings that never
 * arrived.
 */

// `client` is a view rather than an assigned property: MST protects its nodes,
// so defining it from outside throws before the flow ever runs.
const TestRoot = types
  .model('TestRoot', {
    spaceWatcher: types.optional(SpaceWatcherStore, {}),
  })
  .views(() => ({
    get client() {
      return client;
    },
  }));

let getFreeSpace: ReturnType<typeof vi.fn>;
let updateSettings: ReturnType<typeof vi.fn>;
let client: Record<string, unknown> | undefined;

function createWatcher() {
  return TestRoot.create({}).spaceWatcher as Instance<typeof SpaceWatcherStore>;
}

beforeEach(() => {
  getFreeSpace = vi.fn().mockResolvedValue({ path: '/downloads', sizeBytes: 1024 });
  updateSettings = vi.fn().mockResolvedValue(undefined);
  client = {
    settings: { downloadDir: '/downloads' },
    updateSettings,
    getFreeSpace,
  };
});

describe('SpaceWatcherStore — a normal fetch', () => {
  it('asks the daemon for the free space of its download directory', async () => {
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(getFreeSpace).toHaveBeenCalledWith('/downloads');
    expect(watcher.state).toBe('done');
  });

  it('keeps what the daemon reported', async () => {
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(watcher.downloadDirs.map((d) => [d.path, d.available])).toEqual([['/downloads', 1024]]);
  });

  it('asks the daemon every time rather than reusing a cached figure', async () => {
    // The session-get copy only refreshes when settings are refetched, so
    // reusing it showed a number that never moved.
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();
    await watcher.fetchDownloadDirs();

    expect(getFreeSpace).toHaveBeenCalledTimes(2);
  });

  it('fetches the settings only when it has none', async () => {
    // Refreshing them costs a session-get, a session-stats and a config
    // re-read every minute, for one byte count the free-space call returns.
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('fetches them once when it has none', async () => {
    client!.settings = null;
    updateSettings.mockImplementation(() => {
      client!.settings = { downloadDir: '/downloads' };
      return Promise.resolve();
    });
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe('done');
  });
});

describe('SpaceWatcherStore — the ways it used to stick', () => {
  it('goes idle rather than pending when there is no client yet', async () => {
    // A bg resync after the server config broke leaves client unset;
    // dereferencing it threw a TypeError that the catch turned into a sticky
    // error printing the raw exception in the footer.
    client = undefined;
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(watcher.state).toBe('idle');
    expect(watcher.errorMessage).toBe('');
  });

  it('goes idle rather than pending when the settings never arrive', async () => {
    // A bare return left the state on 'pending' for ever, and the re-entry
    // guard then blocked every later attempt.
    client!.settings = null;
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(watcher.state).toBe('idle');
  });

  it('can still be retried after either of those', async () => {
    // This is the property that actually matters: 'pending' is unrecoverable.
    client!.settings = null;
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    client!.settings = { downloadDir: '/downloads' };
    await watcher.fetchDownloadDirs();

    expect(watcher.state).toBe('done');
  });

  it('refuses to run twice at once', async () => {
    let release!: () => void;
    getFreeSpace.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ path: '/downloads', sizeBytes: 1 });
      })
    );
    const watcher = createWatcher();
    const first = watcher.fetchDownloadDirs();
    await watcher.fetchDownloadDirs();

    expect(getFreeSpace).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe('SpaceWatcherStore — failures', () => {
  it('reports the error rather than leaving a blank readout', async () => {
    // A blank figure is indistinguishable from a disk with no space left.
    getFreeSpace.mockRejectedValue(Object.assign(new Error('Connection refused'), { name: 'Err' }));
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();

    expect(watcher.state).toBe('error');
    expect(watcher.errorMessage).toContain('Connection refused');
  });

  it('clears a previous error when a later fetch succeeds', async () => {
    getFreeSpace.mockRejectedValueOnce(new Error('nope'));
    const watcher = createWatcher();
    await watcher.fetchDownloadDirs();
    expect(watcher.state).toBe('error');

    await watcher.fetchDownloadDirs();

    expect(watcher.state).toBe('done');
    expect(watcher.errorMessage).toBe('');
  });

  it('does not write into a store that has been destroyed', async () => {
    // The footer stops showing free space while a fetch is in flight; writing
    // to a dead node throws out of the flow.
    let release!: () => void;
    getFreeSpace.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ path: '/downloads', sizeBytes: 1 });
      })
    );
    const root = TestRoot.create({});
    const pending = root.spaceWatcher.fetchDownloadDirs();
    // The whole root: destroying a required child would modify its parent
    // outside an action, which MST refuses.
    destroy(root);
    release();

    await expect(pending).resolves.toBeUndefined();
  });
});
