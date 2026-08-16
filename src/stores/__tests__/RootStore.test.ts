import { describe, it, expect, vi, afterEach } from 'vitest';
import { destroy } from 'mobx-state-tree';
import RootStore, { type IRootStore } from '../RootStore';

interface SentMessage {
  action: string;
  [key: string]: unknown;
}

// Routes chrome.runtime.sendMessage responses (callApi's transport) by
// message.action, with one response per call for a given action -- each
// entry is shifted off as its action is hit, so a test can script a
// sequence (e.g. a bad delta followed by a good retry).
function stubApi(responses: Record<string, Array<{ result?: unknown; error?: unknown }>>) {
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
    (message: SentMessage, cb: (response: unknown) => void) => {
      const queue = responses[message.action];
      const next = queue?.shift() ?? { result: {} };
      cb(next);
    }
  );
}

function callsFor(action: string): number {
  return (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => (call[0] as SentMessage).action === action
  ).length;
}

let root: IRootStore | null = null;

afterEach(() => {
  if (root) {
    destroy(root);
    root = null;
  }
  vi.clearAllMocks();
});

function create(): IRootStore {
  // Seed config and client up front: TorrentListStore.afterCreate()
  // unconditionally starts an autorun (ListSelectStore's sorted-ids watcher)
  // that reads getRoot(self).config.torrentsSort and .client.torrents the
  // moment torrentList is created -- i.e. synchronously inside
  // RootStore.create() itself, since torrentList is
  // `types.optional(TorrentListStore, {})`. A bare `{}` root snapshot leaves
  // both maybe-typed and that first autorun run throws.
  root = RootStore.create({ config: {}, client: { torrents: {} } });
  return root;
}

describe('RootStore', () => {
  describe('init', () => {
    it('goes idle -> pending -> done, applies the fetched config and syncs the client', async () => {
      const r = create();
      stubApi({
        getConfigStore: [{ result: { hostname: 'nas.local' } }],
        getBgStoreDelta: [
          {
            result: {
              id: 1,
              type: 'snapshot',
              patchId: 10,
              branches: null,
              result: { client: { torrents: {} } },
            },
          },
        ],
      });

      expect(r.state).toBe('idle');
      await r.init();

      expect(r.state).toBe('done');
      expect(r.config?.hostname).toBe('nas.local');
      expect(r.client).toBeTruthy();
    });

    it('sets state to "error" when fetching the config fails', async () => {
      const r = create();
      stubApi({
        getConfigStore: [{ error: { message: 'no daemon' } }],
        getBgStoreDelta: [
          { result: { id: 1, type: 'snapshot', patchId: 1, branches: null, result: {} } },
        ],
      });

      await r.init();
      expect(r.state).toBe('error');
    });

    it('ignores a second call while already pending', async () => {
      const r = create();
      stubApi({
        getConfigStore: [{ result: {} }],
        getBgStoreDelta: [
          { result: { id: 1, type: 'snapshot', patchId: 1, branches: null, result: {} } },
        ],
      });

      const first = r.init();
      const second = r.init(); // fired while `first` is still pending
      await Promise.all([first, second]);

      expect(callsFor('getConfigStore')).toBe(1);
    });
  });

  describe('syncClient', () => {
    it('applies a snapshot delta and tracks the session for the next patch', async () => {
      const r = create();
      stubApi({
        getBgStoreDelta: [
          {
            result: {
              id: 7,
              type: 'snapshot',
              patchId: 100,
              branches: null,
              result: { isRefreshing: true },
            },
          },
        ],
      });

      await r.syncClient();
      expect(r.isRefreshing).toBe(true);

      // A matching patch (same session id, new patchId) applies normally.
      stubApi({
        getBgStoreDelta: [
          {
            result: {
              id: 7,
              type: 'patch',
              patchId: 101,
              branches: null,
              result: [{ op: 'replace', path: '/isRefreshing', value: false }],
            },
          },
        ],
      });
      await r.syncClient();
      expect(r.isRefreshing).toBe(false);
    });

    it('retries once on APPLY_PATH_ERROR (session id mismatch) and applies the retried delta', async () => {
      const r = create();
      stubApi({
        getBgStoreDelta: [
          // First delta: a patch whose id doesn't match the (null) session id
          // -> mobxApplyPatchLine throws APPLY_PATH_ERROR.
          {
            result: {
              id: 999,
              type: 'patch',
              patchId: 1,
              branches: null,
              result: [{ op: 'replace', path: '/isRefreshing', value: true }],
            },
          },
          // Retry: a snapshot always applies regardless of session state.
          {
            result: {
              id: 5,
              type: 'snapshot',
              patchId: 10,
              branches: null,
              result: { isRefreshing: true },
            },
          },
        ],
      });

      await r.syncClient();

      expect(callsFor('getBgStoreDelta')).toBe(2);
      expect(r.isRefreshing).toBe(true);
    });

    it('never rejects, even if every attempt (including the retry) fails', async () => {
      const r = create();
      // Every response is a mismatched-id patch, so both the initial attempt
      // and its single retry hit APPLY_PATH_ERROR.
      stubApi({
        getBgStoreDelta: [
          {
            result: {
              id: 999,
              type: 'patch',
              patchId: 1,
              branches: null,
              result: [],
            },
          },
          {
            result: {
              id: 998,
              type: 'patch',
              patchId: 1,
              branches: null,
              result: [],
            },
          },
        ],
      });

      await expect(r.syncClient()).resolves.toBeUndefined();
      expect(callsFor('getBgStoreDelta')).toBe(2);
    });
  });

  describe('fileList / spaceWatcher / dialogs / refreshing', () => {
    it('flushTorrentList resets torrentList state (e.g. selection) back to defaults', () => {
      const r = create();
      r.torrentList.addSelectedId(1);
      expect(r.torrentList.selectedIds.slice()).toEqual([1]);

      const after = r.flushTorrentList();

      // mobx-state-tree reconciles a re-assigned optional model node in
      // place rather than replacing its identity, so this intentionally
      // checks state, not reference equality.
      expect(after.selectedIds.slice()).toEqual([]);
      expect(r.torrentList.selectedIds.slice()).toEqual([]);
    });

    it('createFileList/destroyFileList manage the fileList slot', () => {
      const r = create();
      expect(r.fileList).toBeUndefined();

      const fileList = r.createFileList(42);
      expect(fileList.id).toBe(42);
      expect(r.fileList).toBe(fileList);

      r.destroyFileList();
      expect(r.fileList).toBeUndefined();
    });

    it('createSpaceWatcher/destroySpaceWatcher manage the spaceWatcher slot', () => {
      const r = create();
      expect(r.spaceWatcher).toBeUndefined();
      r.createSpaceWatcher();
      expect(r.spaceWatcher).toBeTruthy();
      r.destroySpaceWatcher();
      expect(r.spaceWatcher).toBeUndefined();
    });

    it('createDialog/destroyDialog add and remove a dialog by id', () => {
      const r = create();
      const dialog = r.createDialog({ type: 'removeConfirm', torrentIds: [1, 2] });
      expect(dialog?.id).toMatch(/^dialog_/);
      expect(r.dialogs.get(dialog!.id)).toBe(dialog);

      r.destroyDialog(dialog!.id);
      expect(r.dialogs.get(dialog!.id)).toBeUndefined();
    });

    it('setRefreshing toggles isRefreshing', () => {
      const r = create();
      expect(r.isRefreshing).toBe(false);
      r.setRefreshing(true);
      expect(r.isRefreshing).toBe(true);
    });
  });

  describe('isPopup', () => {
    afterEach(() => {
      window.location.hash = '';
    });

    it('is true when the location hash is #popup', () => {
      const r = create();
      window.location.hash = '#popup';
      expect(r.isPopup).toBe(true);
    });

    it('is false otherwise', () => {
      const r = create();
      window.location.hash = '';
      expect(r.isPopup).toBe(false);
    });
  });
});
