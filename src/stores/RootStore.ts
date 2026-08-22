import { flow, types, Instance, cast } from 'mobx-state-tree';
import ConfigStore, { IConfigStore } from './ConfigStore';
import getLogger from '../tools/getLogger';
import ClientStore from './ClientStore';
import callApi from '../tools/callApi';
import FileListStore, { IFileListStore } from './FileListStore';
import TorrentListStore from './TorrentListStore';
import PutFilesDialogStore from './PutFilesDialogStore';
import RemoveConfirmDialogStore from './RemoveConfirmDialogStore';
import PutUrlDialogStore from './PutUrlDialogStore';
import SpaceWatcherStore from './SpaceWatcherStore';
import RenameDialogStore from './RenameDialogStore';
import CopyMagnetUrlDialogStore from './CopyMagnetUrlDialogStore';
import MoveDialogStore from './MoveDialogStore';
import SetLabelsDialogStore from './SetLabelsDialogStore';
import TorrentDetailsDialogStore from './TorrentDetailsDialogStore';
import mobxApplyPatchLine from '../tools/mobxApplyPatchLine';

const promiseLimit = require('promise-limit');

const logger = getLogger('RootStore');
const oneLimit = promiseLimit(1) as <T>(fn: () => Promise<T>) => Promise<T>;

let dialogIndex = 0;

interface BgStoreSession {
  id: number | null;
  patchId: number | null;
}

interface DeltaResult {
  id: number;
  branches: string[] | null;
  patchId: number | null;
  type: 'patch' | 'snapshot';
  result: Record<string, unknown> | import('mobx-state-tree').IJsonPatch[];
}

interface DialogProps {
  type: string;
  [key: string]: unknown;
}

const RootStore = types
  .model('RootStore', {
    state: types.optional(types.enumeration(['idle', 'pending', 'done', 'error']), 'idle'),
    isRefreshing: types.optional(types.boolean, false),
    config: types.maybe(ConfigStore),
    client: types.maybe(ClientStore),
    torrentList: types.optional(TorrentListStore, {}),
    fileList: types.maybe(FileListStore),
    spaceWatcher: types.maybe(SpaceWatcherStore),
    dialogs: types.map(
      types.union(
        PutFilesDialogStore,
        PutUrlDialogStore,
        RemoveConfirmDialogStore,
        RenameDialogStore,
        CopyMagnetUrlDialogStore,
        MoveDialogStore,
        SetLabelsDialogStore,
        TorrentDetailsDialogStore
      )
    ),
  })
  .actions((self) => {
    const bgStoreSession: BgStoreSession = {
      id: null,
      patchId: null,
    };

    return {
      init: flow(function* () {
        if (self.state === 'pending') return;
        self.state = 'pending';
        try {
          const [config]: [IConfigStore] = yield Promise.all([
            fetchConfig(),
            (self as unknown as IRootStoreActions).syncClient(),
          ]);
          self.config = cast(config);
          // syncClient swallows its errors so the periodic poll can't blow up,
          // which used to let init succeed with no client at all: a blank list,
          // a dead Refresh button and no error, unrecoverable without reopening
          if (!self.client) {
            throw new Error('Background sync did not provide a client');
          }
          self.state = 'done';
        } catch (err) {
          logger.error('init error', err);
          self.state = 'error';
        }
      }),
      retryInit() {
        if (self.state === 'pending') return;
        self.state = 'idle';
        return (self as unknown as { init: () => Promise<void> }).init();
      },
      applyPatchLine(delta: DeltaResult) {
        mobxApplyPatchLine(self as unknown as Record<string, unknown>, bgStoreSession, delta);
      },
      syncClient: function (): Promise<void> {
        return oneLimit(() => {
          return fetchBgStoreDelta(bgStoreSession)
            .then((delta) => (self as unknown as IRootStoreActions).applyPatchLine(delta))
            .catch((err: Error & { code?: string }) => {
              if (err.code === 'APPLY_PATH_ERROR') {
                logger.warn('syncClient: apply_path_error', err);
                return fetchBgStoreDelta(bgStoreSession).then((delta) =>
                  (self as unknown as IRootStoreActions).applyPatchLine(delta)
                );
              }
              throw err;
            })
            .catch((err) => {
              logger.error('syncClient error', err);
            });
        });
      },
      flushTorrentList() {
        self.torrentList = cast({});
        return self.torrentList;
      },
      createFileList(id: number): IFileListStore {
        self.fileList = cast({ id });
        const fileList = self.fileList;
        if (!fileList) throw new Error('FileList creation failed');
        return fileList;
      },
      destroyFileList() {
        self.fileList = undefined;
      },
      createDialog(dialog: DialogProps) {
        const id = `dialog_${++dialogIndex}`;
        self.dialogs.set(id, { id, ...dialog } as never);
        return self.dialogs.get(id);
      },
      destroyDialog(id: string) {
        self.dialogs.delete(id);
      },
      createSpaceWatcher() {
        self.spaceWatcher = cast({});
      },
      destroySpaceWatcher() {
        self.spaceWatcher = undefined;
      },
      setRefreshing(value: boolean) {
        self.isRefreshing = value;
      },
    };
  })
  .views(() => {
    return {
      get isPopup(): boolean {
        return location.hash === '#popup';
      },
    };
  });

interface IRootStoreActions {
  syncClient: () => Promise<void>;
  applyPatchLine: (delta: DeltaResult) => void;
}

const fetchBgStoreDelta = ({ id, patchId }: BgStoreSession): Promise<DeltaResult> => {
  return callApi<DeltaResult>({ action: 'getBgStoreDelta', id, patchId });
};

const fetchConfig = (): Promise<IConfigStore> => {
  return callApi<IConfigStore>({ action: 'getConfigStore' });
};

export type IRootStore = Instance<typeof RootStore>;
export default RootStore;
