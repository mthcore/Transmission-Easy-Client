import { getRoot, types, Instance } from 'mobx-state-tree';
import { formatBytes } from '../tools/format';

const priorityLocaleMap = ['MF_DONT', 'MF_LOW', 'MF_NORMAL', 'MF_HIGH'];

const FileStore = types
  .model('FileStore', {
    name: types.identifier,
    shortName: types.string,
    size: types.number,
    downloaded: types.number,
    priority: types.number,
  })
  .views((self) => {
    let cachedNamePartsName: string | null = null;
    let cachedNameParts: string[] = [];

    return {
      get progress(): number {
        if (self.size === 0) return 100;
        // Truncate like the torrent-list progress: rounding made 99.96% render
        // as a finished '100%' while bytes were still missing
        const percent = (self.downloaded * 100) / self.size;
        return percent >= 100 ? 100 : Math.trunc(percent * 10) / 10;
      },
      get progressStr(): string {
        const progress = this.progress;
        if (progress < 100) {
          return progress.toFixed(1) + '%';
        } else {
          return Math.round(progress) + '%';
        }
      },
      get sizeStr(): string {
        return formatBytes(self.size);
      },
      get downloadedStr(): string {
        return formatBytes(self.downloaded);
      },
      get priorityStr(): string {
        return chrome.i18n.getMessage(priorityLocaleMap[self.priority]);
      },
      get selected(): boolean {
        const rootStore = getRoot<{
          fileList: { _selectedIdsSet: Set<string> };
        }>(self);
        return rootStore.fileList._selectedIdsSet.has(self.name);
      },
      get nameParts(): string[] {
        if (cachedNamePartsName !== self.shortName) {
          cachedNamePartsName = self.shortName;
          cachedNameParts = cachedNamePartsName.split(/[\\/]/);
        }
        return cachedNameParts;
      },
      get normalizedName(): string {
        return this.nameParts.join('/');
      },
    };
  });

export type IFileStore = Instance<typeof FileStore>;
export default FileStore;
