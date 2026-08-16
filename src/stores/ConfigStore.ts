import {
  getPropertyMembers,
  getSnapshot,
  resolveIdentifier,
  types,
  Instance,
  cast,
} from 'mobx-state-tree';
import { storageSet } from '../tools/chromeStorage';
import url from 'url';
import { BG_UPDATE_INTERVAL, UI_UPDATE_INTERVAL } from '../constants';

interface ColumnDef {
  column: string;
  display: number;
  order: number;
  width: number;
  lang: string;
}

const defaultTorrentListColumnList: ColumnDef[] = [
  { column: 'checkbox', display: 1, order: 0, width: 28, lang: 'selectAll' },
  { column: 'name', display: 1, order: 1, width: 519, lang: 'OV_COL_NAME' },
  { column: 'order', display: 0, order: 1, width: 30, lang: 'OV_COL_ORDER' },
  { column: 'remaining', display: 0, order: 1, width: 80, lang: 'OV_COL_REMAINING' },
  { column: 'done', display: 1, order: 1, width: 103, lang: 'OV_COL_DONE' },
  { column: 'status', display: 1, order: 1, width: 94, lang: 'OV_COL_STATUS' },
  { column: 'downspd', display: 1, order: 1, width: 54, lang: 'OV_COL_DOWNSPD' },
  { column: 'upspd', display: 1, order: 1, width: 49, lang: 'OV_COL_UPSPD' },
  { column: 'size', display: 1, order: 1, width: 52, lang: 'OV_COL_SIZE' },
  { column: 'seeds', display: 0, order: 1, width: 40, lang: 'OV_COL_SEEDS' },
  { column: 'peers', display: 0, order: 1, width: 40, lang: 'OV_COL_PEERS' },
  { column: 'seeds_peers', display: 1, order: 1, width: 51, lang: 'OV_COL_SEEDS_PEERS' },
  { column: 'eta', display: 1, order: 1, width: 26, lang: 'OV_COL_ETA' },
  { column: 'upped', display: 1, order: 1, width: 80, lang: 'OV_COL_UPPED' },
  { column: 'downloaded', display: 0, order: 1, width: 80, lang: 'OV_COL_DOWNLOADED' },
  { column: 'shared', display: 1, order: 1, width: 91, lang: 'OV_COL_SHARED' },
  { column: 'added', display: 1, order: 1, width: 94, lang: 'OV_COL_DATE_ADDED' },
  { column: 'completed', display: 1, order: 1, width: 110, lang: 'OV_COL_DATE_COMPLETED' },
  { column: 'label', display: 0, order: 1, width: 100, lang: 'OV_COL_LABEL' },
  { column: 'priority', display: 0, order: 1, width: 70, lang: 'FI_COL_PRIO' },
  { column: 'activity', display: 0, order: 1, width: 110, lang: 'OV_COL_ACTIVITY' },
  { column: 'started', display: 0, order: 1, width: 110, lang: 'OV_COL_STARTED' },
  { column: 'edited', display: 0, order: 1, width: 110, lang: 'OV_COL_EDITED' },
  { column: 'sizeWhenDone', display: 0, order: 1, width: 70, lang: 'OV_COL_SIZE_WHEN_DONE' },
  { column: 'actions', display: 1, order: 0, width: 52, lang: 'Actions' },
];

const defaultTorrentListColumnListPopup: ColumnDef[] = [
  { column: 'checkbox', display: 1, order: 0, width: 28, lang: 'selectAll' },
  { column: 'name', display: 1, order: 1, width: 423, lang: 'OV_COL_NAME' },
  { column: 'order', display: 0, order: 1, width: 30, lang: 'OV_COL_ORDER' },
  { column: 'remaining', display: 0, order: 1, width: 80, lang: 'OV_COL_REMAINING' },
  { column: 'done', display: 1, order: 1, width: 93, lang: 'OV_COL_DONE' },
  { column: 'status', display: 1, order: 1, width: 112, lang: 'OV_COL_STATUS' },
  { column: 'size', display: 1, order: 1, width: 77, lang: 'OV_COL_SIZE' },
  { column: 'seeds', display: 0, order: 1, width: 40, lang: 'OV_COL_SEEDS' },
  { column: 'peers', display: 0, order: 1, width: 40, lang: 'OV_COL_PEERS' },
  { column: 'seeds_peers', display: 0, order: 1, width: 50, lang: 'OV_COL_SEEDS_PEERS' },
  { column: 'downspd', display: 0, order: 1, width: 80, lang: 'OV_COL_DOWNSPD' },
  { column: 'upspd', display: 0, order: 1, width: 80, lang: 'OV_COL_UPSPD' },
  { column: 'eta', display: 0, order: 1, width: 60, lang: 'OV_COL_ETA' },
  { column: 'upped', display: 0, order: 1, width: 80, lang: 'OV_COL_UPPED' },
  { column: 'downloaded', display: 0, order: 1, width: 80, lang: 'OV_COL_DOWNLOADED' },
  { column: 'shared', display: 0, order: 1, width: 70, lang: 'OV_COL_SHARED' },
  { column: 'added', display: 0, order: 1, width: 140, lang: 'OV_COL_DATE_ADDED' },
  { column: 'completed', display: 0, order: 1, width: 140, lang: 'OV_COL_DATE_COMPLETED' },
  { column: 'label', display: 0, order: 1, width: 100, lang: 'OV_COL_LABEL' },
  { column: 'priority', display: 0, order: 1, width: 70, lang: 'FI_COL_PRIO' },
  { column: 'activity', display: 0, order: 1, width: 140, lang: 'OV_COL_ACTIVITY' },
  { column: 'started', display: 0, order: 1, width: 140, lang: 'OV_COL_STARTED' },
  { column: 'edited', display: 0, order: 1, width: 140, lang: 'OV_COL_EDITED' },
  { column: 'sizeWhenDone', display: 0, order: 1, width: 80, lang: 'OV_COL_SIZE_WHEN_DONE' },
  { column: 'actions', display: 1, order: 0, width: 52, lang: 'Actions' },
];

const defaultFileListColumnList: ColumnDef[] = [
  { column: 'checkbox', display: 1, order: 0, width: 33, lang: 'selectAll' },
  { column: 'size', display: 1, order: 1, width: 62, lang: 'FI_COL_SIZE' },
  { column: 'downloaded', display: 1, order: 1, width: 101, lang: 'OV_COL_DOWNLOADED' },
  { column: 'done', display: 1, order: 1, width: 100, lang: 'OV_COL_DONE' },
  { column: 'name', display: 1, order: 1, width: 342, lang: 'FI_COL_NAME' },
  { column: 'prio', display: 1, order: 1, width: 100, lang: 'FI_COL_PRIO' },
];

const ColumnStore = types
  .model('ColumnsStore', {
    column: types.identifier,
    display: types.number,
    order: types.number,
    width: types.number,
    lang: types.string,
  })
  .actions((self) => {
    return {
      setWidth(value: number) {
        self.width = value;
      },
      toggleDisplay() {
        self.display = self.display ? 0 : 1;
      },
    };
  });

const TorrentsColumnStore = types.compose('TorrentsColumnsStore', ColumnStore, types.model({}));
const FilesColumnStore = types.compose('FilesColumnsStore', ColumnStore, types.model({}));

const FolderStore = types.model('FolderStore', {
  name: types.string,
  path: types.string,
});

const SelectedLabelStore = types
  .model('SelectedLabelStore', {
    label: types.string,
    custom: types.boolean,
  })
  .views((self) => {
    return {
      get id(): string {
        return JSON.stringify({
          label: self.label,
          custom: self.custom,
        });
      },
    };
  });

const ConfigStore = types
  .model('ConfigStore', {
    hostname: types.optional(types.string, ''),
    ssl: types.optional(types.boolean, true),
    port: types.optional(types.number, 9091),
    pathname: types.optional(types.string, '/transmission/rpc'),
    webPathname: types.optional(types.string, ''),

    authenticationRequired: types.optional(types.boolean, true),
    login: types.optional(types.string, ''),
    password: types.optional(types.string, ''),

    showActiveCountBadge: types.optional(types.boolean, true),
    showDownloadCompleteNotifications: types.optional(types.boolean, true),
    backgroundUpdateInterval: types.optional(types.number, BG_UPDATE_INTERVAL),
    uiUpdateInterval: types.optional(types.number, UI_UPDATE_INTERVAL),

    hideSeedingTorrents: types.optional(types.boolean, false),
    hideFinishedTorrents: types.optional(types.boolean, false),
    showSpeedGraph: types.optional(types.boolean, true),

    selectDownloadCategoryAfterPutTorrentFromContextMenu: types.optional(types.boolean, false),
    treeViewContextMenu: types.optional(types.boolean, true),
    putDefaultPathInContextMenu: types.optional(types.boolean, true),

    badgeColor: types.optional(types.string, '0,0,0,0.40'),

    showFreeSpace: types.optional(types.boolean, true),

    searchQuery: types.optional(types.string, ''),
    theme: types.optional(types.enumeration(['light', 'dark', 'system']), 'system'),

    folders: types.array(FolderStore),

    isPopupMode: types.optional(types.boolean, false),

    torrentColumns: types.optional(types.array(TorrentsColumnStore), defaultTorrentListColumnList),
    torrentColumnsPopup: types.optional(
      types.array(TorrentsColumnStore),
      defaultTorrentListColumnListPopup
    ),
    filesColumns: types.optional(types.array(FilesColumnStore), defaultFileListColumnList),

    torrentsSort: types.optional(
      types.model({
        by: types.string,
        direction: types.optional(types.number, 1),
      }),
      { by: 'added', direction: -1 }
    ),

    filesSort: types.optional(
      types.model({
        by: types.string,
        direction: types.optional(types.number, 1),
      }),
      { by: 'size' }
    ),

    selectedLabel: types.optional(SelectedLabelStore, { label: 'ALL', custom: true }),

    detailPeerWidths: types.optional(types.frozen<Record<string, number>>(), {}),
    detailTrackerWidths: types.optional(types.frozen<Record<string, number>>(), {}),

    configVersion: types.optional(types.number, 2),
  })
  .actions((self) => {
    return {
      setKeyValue(keyValue: Record<string, unknown>) {
        Object.assign(self, keyValue);
      },
      setPopupMode(isPopup: boolean) {
        self.isPopupMode = isPopup;
      },
      addFolder(path: string, name = '') {
        self.folders.push({ path, name });
        return storageSet({
          folders: self.folders.toJSON(),
        });
      },
      hasFolder(path: string): boolean {
        return self.folders.some((folder) => folder.path === path);
      },
      moveTorrentsColumn(from: string, to: string) {
        const sourceColumns = self.isPopupMode ? self.torrentColumnsPopup : self.torrentColumns;
        const column = sourceColumns.find((c) => c.column === from);
        const columnTarget = sourceColumns.find((c) => c.column === to);

        if (!column || !columnTarget) return;

        // Reorder via snapshots, not live nodes: ColumnStore.column is a
        // types.identifier, so reassigning self.torrentColumns[Popup] with an
        // array that still holds live nodes from that very array makes
        // mobx-state-tree try to tear down nodes it's simultaneously
        // reconciling back in, crashing with "no longer part of a state tree"
        // (this reordering broke silently across the mobx-state-tree 5→7
        // bump; nothing exercised it until this store had tests). Snapshots
        // are plain data, so identifier-based reconciliation just reorders
        // the existing nodes in place instead.
        const columns = moveColumn(
          sourceColumns.map((c) => getSnapshot(c)),
          getSnapshot(column),
          getSnapshot(columnTarget)
        );

        if (self.isPopupMode) {
          self.torrentColumnsPopup = cast(columns);
          return storageSet({
            torrentColumnsPopup: columns,
          });
        } else {
          self.torrentColumns = cast(columns);
          return storageSet({
            torrentColumns: columns,
          });
        }
      },
      saveTorrentsColumns() {
        if (self.isPopupMode) {
          return storageSet({
            torrentColumnsPopup: self.torrentColumnsPopup.toJSON(),
          });
        } else {
          return storageSet({
            torrentColumns: self.torrentColumns.toJSON(),
          });
        }
      },
      moveFilesColumn(from: string, to: string) {
        const column = resolveIdentifier(FilesColumnStore, self, from);
        const columnTarget = resolveIdentifier(FilesColumnStore, self, to);

        if (!column || !columnTarget) return;

        // Same live-node-vs-snapshot pitfall as moveTorrentsColumn above.
        const columns = moveColumn(
          self.filesColumns.map((c) => getSnapshot(c)),
          getSnapshot(column),
          getSnapshot(columnTarget)
        );

        self.filesColumns = cast(columns);
        return storageSet({
          filesColumns: columns,
        });
      },
      saveFilesColumns() {
        return storageSet({
          filesColumns: self.filesColumns.toJSON(),
        });
      },
      setTorrentsSort(by: string, direction: number) {
        self.torrentsSort = cast({ by, direction });
        return storageSet({
          torrentsSort: { by, direction },
        });
      },
      setFilesSort(by: string, direction: number) {
        self.filesSort = cast({ by, direction });
        return storageSet({
          filesSort: { by, direction },
        });
      },
      setSelectedLabel(label: string, isCustom: boolean) {
        self.selectedLabel = cast({ label, custom: isCustom });
        return storageSet({
          selectedLabel: { label, custom: isCustom },
        });
      },
      setOptions(obj: Record<string, unknown>) {
        Object.assign(self, obj);
        return storageSet(obj);
      },
      removeFolders(selectedFolders: Instance<typeof FolderStore>[]) {
        self.folders = cast(removeItems(self.folders.slice(0), selectedFolders));
        return storageSet({
          folders: self.folders.toJSON(),
        });
      },
      moveFolders(selectedFolders: Instance<typeof FolderStore>[], index: number) {
        self.folders = cast(moveItems(self.folders.slice(0), selectedFolders, index));
        return storageSet({
          folders: self.folders.toJSON(),
        });
      },
      setSearchQuery(query: string) {
        self.searchQuery = query;
      },
      setTheme(theme: 'light' | 'dark' | 'system') {
        self.theme = theme;
        return storageSet({ theme });
      },
      setDetailPeerWidths(widths: Record<string, number>) {
        self.detailPeerWidths = widths;
        return storageSet({ detailPeerWidths: widths });
      },
      setDetailTrackerWidths(widths: Record<string, number>) {
        self.detailTrackerWidths = widths;
        return storageSet({ detailTrackerWidths: widths });
      },
    };
  })
  .views((self) => {
    return {
      get url(): string {
        return url.format({
          protocol: self.ssl ? 'https' : 'http',
          port: self.port,
          hostname: self.hostname,
          pathname: self.pathname,
        });
      },
      get webUiUrl(): string {
        // Credentials are deliberately NOT embedded in the URL: browsers leak
        // them into DOM/history and don't apply them to the page's background
        // RPC requests. Authentication is injected as an Authorization header
        // by the background declarativeNetRequest rule (src/bg/webUiAuthRule.ts).
        const urlObject: url.UrlObject = {
          protocol: self.ssl ? 'https' : 'http',
          port: self.port,
          hostname: self.hostname,
          pathname: self.webPathname,
        };
        return url.format(urlObject);
      },
      get activeTorrentColumns() {
        return self.isPopupMode ? self.torrentColumnsPopup : self.torrentColumns;
      },
      get visibleTorrentColumns() {
        return this.activeTorrentColumns.filter((column) => column.display);
      },
      get visibleFileColumns() {
        return self.filesColumns.filter((column) => column.display);
      },
    };
  })
  .actions((self) => {
    // Keeps both extension contexts (service worker and pages) in sync
    const storageChangeListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      namespace: string
    ) => {
      if (namespace === 'local') {
        const keyValue: Record<string, unknown> = {};
        Object.entries(changes).forEach(([key, { newValue }]) => {
          if (configKeys.includes(key)) {
            keyValue[key] = newValue;
          }
        });
        self.setKeyValue(keyValue);
      }
    };

    return {
      afterCreate() {
        chrome.storage.onChanged.addListener(storageChangeListener);
      },
      beforeDestroy() {
        chrome.storage.onChanged.removeListener(storageChangeListener);
      },
    };
  });

function moveColumn<T>(columns: T[], column: T, columnTarget: T): T[] {
  const pos = columns.indexOf(column);
  const posTarget = columns.indexOf(columnTarget);

  columns.splice(pos, 1);

  if (pos < posTarget) {
    columns.splice(columns.indexOf(columnTarget) + 1, 0, column);
  } else {
    columns.splice(columns.indexOf(columnTarget), 0, column);
  }

  return columns;
}

function removeItems<T>(array: T[], items: T[]): T[] {
  items.forEach((folder) => {
    const pos = array.indexOf(folder);
    if (pos !== -1) {
      array.splice(pos, 1);
    }
  });
  return array;
}

function moveItems<T>(array: T[], items: T[], index: number): T[] {
  let startPos: number | null = null;
  items.forEach((folder) => {
    const pos = array.indexOf(folder);
    if (pos !== -1) {
      if (startPos === null) {
        startPos = pos;
      }
      array.splice(pos, 1);
    }
  });

  if (startPos !== null) {
    if (index < 0) {
      array.splice(startPos - 1, 0, ...items);
    } else {
      array.splice(startPos + 1, 0, ...items);
    }
  }

  return array;
}

const configKeys = Object.keys(getPropertyMembers(ConfigStore).properties);

export type IConfigStore = Instance<typeof ConfigStore>;
export type IColumnStore = Instance<typeof ColumnStore>;
export type IFolderStore = Instance<typeof FolderStore>;
export type ISelectedLabelStore = Instance<typeof SelectedLabelStore>;
export default ConfigStore;
export {
  configKeys,
  SelectedLabelStore,
  defaultTorrentListColumnList,
  defaultTorrentListColumnListPopup,
  defaultFileListColumnList,
};
