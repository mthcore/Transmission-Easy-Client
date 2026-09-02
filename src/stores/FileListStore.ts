import { flow, getRoot, isAlive, resolveIdentifier, types, Instance, cast } from 'mobx-state-tree';
import getLogger from '../tools/getLogger';
import ListSelectStore from './ListSelectStore';
import FileStore, { IFileStore } from './FileStore';
import TorrentStore, { ITorrentStore } from './TorrentStore';
import { createColumnSorter, fileColumnMap } from '../tools/sortByColumn';
import searchNormalize from '../tools/searchNormalize';

const logger = getLogger('FileListStore');

const sortFiles = createColumnSorter(fileColumnMap);

interface FileData {
  name: string;
  shortName: string;
  size: number;
  downloaded: number;
  priority: number;
}

const FileListStore = types
  .compose(
    'FileListStore',
    ListSelectStore,
    types.model({
      id: types.identifierNumber,
      removeSelectOnHide: types.optional(types.boolean, false),
      state: types.optional(types.enumeration(['idle', 'pending', 'done', 'error']), 'idle'),
      files: types.array(FileStore),
      directory: types.optional(types.string, ''),
      isLoading: types.optional(types.boolean, true),
      filter: types.optional(types.string, ''),
      /** Free-text filter on the file name, independent of the folder filter */
      nameQuery: types.optional(types.string, ''),
      selectedIds: types.array(types.string),
    })
  )
  .actions((self) => {
    return {
      fetchFiles: flow(function* () {
        if (self.state === 'pending') return;
        self.state = 'pending';
        try {
          const rootStore = getRoot<{
            client: {
              getTorrentFiles: (id: number) => Promise<FileData[]>;
            };
          }>(self);
          const _files: FileData[] = yield rootStore.client.getTorrentFiles(self.id);
          const { dir, files } = setFilesShortName(_files);
          if (isAlive(self)) {
            self.directory = dir;
            self.files = cast(files);
            self.isLoading = false;
            self.state = 'done';
          }
        } catch (err) {
          logger.error('fetchFiles error', err);
          if (isAlive(self)) {
            self.state = 'error';
          }
        }
      }),
      setFilter(value: string) {
        self.filter = value;
      },
      setNameQuery(value: string) {
        self.nameQuery = value;
      },
      setRemoveSelectOnHide(value: boolean) {
        self.removeSelectOnHide = value;
      },
    };
  })
  .views((self) => {
    return {
      getFileById(name: string): IFileStore | undefined {
        return resolveIdentifier(FileStore, self, name);
      },
      getFileIndexById(name: string): number | null {
        const file = this.getFileById(name);
        if (file) {
          return self.files.indexOf(file);
        }
        return null;
      },
      get torrent(): ITorrentStore | undefined {
        return resolveIdentifier(TorrentStore, self, self.id);
      },
      get filteredFiles(): IFileStore[] {
        let files: IFileStore[];
        if (self.filter) {
          const filter = self.filter + '/';
          const filterLen = filter.length;
          files = self.files.filter((file) => {
            return file.normalizedName.substring(0, filterLen) === filter;
          });
        } else {
          files = self.files.slice();
        }

        // Composed with the folder filter rather than replacing it: searching
        // inside the folder you are looking at is the useful behaviour.
        // Diacritic-insensitive like the torrent search, so 'reglement' finds
        // 'règlement'.
        if (self.nameQuery) {
          const query = searchNormalize(self.nameQuery);
          files = files.filter((file) => searchNormalize(file.name).includes(query));
        }

        return files;
      },
      get sortedFiles(): IFileStore[] {
        const rootStore = getRoot<{
          config: {
            filesSort: { by: string; direction: 1 | -1 };
          };
        }>(self);
        const { by, direction } = rootStore.config.filesSort;
        return sortFiles(
          this.filteredFiles as unknown as { [key: string]: unknown }[],
          by,
          direction
        ) as unknown as IFileStore[];
      },
      get _sortedIds(): string[] {
        return this.sortedFiles.map((file) => file.name);
      },
      get selectedIndexes(): (number | null)[] {
        return (self.selectedIds as unknown as string[]).map((name) => this.getFileIndexById(name));
      },
      get filterLevel(): number {
        const filter = self.filter;
        return !filter ? 0 : filter.split(/[\\/]/).length;
      },
      get joinedDirectory(): string {
        const directory = this.torrent?.directory;
        if (directory) {
          if (self.directory) {
            const sep = /\//.test(directory) ? '/' : '\\';
            return directory + sep + self.directory;
          } else {
            return directory;
          }
        }
        return '';
      },
    };
  })
  .actions((self) => {
    return {
      afterCreate() {
        self.startSortedIdsWatcher();
      },
      beforeDestroy() {
        self.stopSortedIdsWatcher();

        if (self.removeSelectOnHide) {
          const rootStore = getRoot<{
            torrentList: { removeSelectedId: (id: number) => void };
          }>(self);
          rootStore.torrentList.removeSelectedId(self.id);
        }
      },
    };
  });

function setFilesShortName(files: FileData[]): { dir: string; files: FileData[] } {
  let dir: string | null = null;
  let sep: string | null = null;
  const isEvery = files.every((file) => {
    const name = file.name;

    if (sep === null) {
      if (/\//.test(name)) {
        sep = '/';
      } else if (/\\/.test(name)) {
        sep = '\\';
      } else {
        return false;
      }
    }

    const pos = name.indexOf(sep);
    if (pos === -1) {
      return false;
    }

    if (dir === null) {
      dir = name.substring(0, pos);
    }

    return dir === name.substring(0, pos);
  });

  // Only report a directory when EVERY file lives under it — dir is captured
  // from the first file before the comparison can fail, so a mixed list would
  // otherwise display a folder that holds only part of the data
  if (dir === null || !isEvery) {
    dir = '';
  }

  const dirLength = dir.length;
  if (isEvery) {
    files.forEach((file) => {
      file.shortName = file.name.substring(dirLength + 1);
    });
  }

  return { dir, files };
}

export type IFileListStore = Instance<typeof FileListStore>;
export default FileListStore;
