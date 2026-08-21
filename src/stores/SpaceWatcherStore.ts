import { flow, getRoot, isAlive, types, Instance, cast } from 'mobx-state-tree';
import getLogger from '../tools/getLogger';
import { formatBytes } from '../tools/format';

const logger = getLogger('SpaceWatcherStore');

const DownloadDirStore = types
  .model('DownloadDirStore', {
    path: types.string,
    available: types.number,
  })
  .views((self) => {
    return {
      get availableStr(): string {
        return formatBytes(self.available);
      },
    };
  });

export type IDownloadDirStore = Instance<typeof DownloadDirStore>;

const SpaceWatcherStore = types
  .model('SpaceWatcherStore', {
    state: types.optional(types.enumeration(['idle', 'pending', 'done', 'error']), 'idle'),
    downloadDirs: types.array(DownloadDirStore),
    errorMessage: types.optional(types.string, ''),
  })
  .actions((self) => {
    return {
      fetchDownloadDirs: flow(function* () {
        if (self.state === 'pending') return;
        self.state = 'pending';
        self.errorMessage = '';
        try {
          const result: { path: string; available: number }[] = [];
          const rootStore = getRoot<{
            client: {
              settings: {
                downloadDir: string;
                downloadDirFreeSpace: number | undefined;
                hasDownloadDirFreeSpace: boolean;
              } | null;
              updateSettings: () => Promise<void>;
              getFreeSpace: (path: string) => Promise<{ path: string; sizeBytes: number }>;
            };
          }>(self);

          if (!rootStore.client.settings || rootStore.client.settings.hasDownloadDirFreeSpace) {
            yield rootStore.client.updateSettings();
          }
          if (isAlive(self)) {
            const settings = rootStore.client.settings;
            // A bare return here left state on 'pending' forever, and the
            // re-entry guard then blocked every later attempt: the free-space
            // indicator stuck on "Loading…" for the rest of the session
            if (!settings) {
              self.state = 'idle';
              return;
            }
            const { downloadDir, downloadDirFreeSpace } = settings;
            if (typeof downloadDirFreeSpace === 'number') {
              result.push({
                path: downloadDir,
                available: downloadDirFreeSpace,
              });
            } else {
              const { path, sizeBytes } = yield rootStore.client.getFreeSpace(downloadDir);
              result.push({
                path: path,
                available: sizeBytes,
              });
            }
          }
          if (isAlive(self)) {
            self.downloadDirs = cast(result);
            self.state = 'done';
          }
        } catch (err) {
          logger.error('fetchDownloadDirs error', err);
          if (isAlive(self)) {
            self.state = 'error';
            const error = err as Error;
            self.errorMessage = `${error.name}: ${error.message}`;
          }
        }
      }),
    };
  })
  .views(() => {
    return {};
  });

export type ISpaceWatcherStore = Instance<typeof SpaceWatcherStore>;
export default SpaceWatcherStore;
