import { storageGet, storageSet } from './chromeStorage';
import getLogger from './getLogger';

const logger = getLogger('loadConfig');

// OldFolder is a tuple: [unknown, path: string, label: string]
type OldFolder = [unknown, string, string];

interface OldSelectedLabel {
  label: string;
  custom: number | boolean;
}

interface NewFolder {
  path: string;
  name: string;
}

interface NewSelectedLabel {
  label: string;
  custom: boolean;
}

interface Config {
  configVersion?: number;
  selectedLabel?: NewSelectedLabel;
  showSpeedGraph?: number | boolean;
  treeViewContextMenu?: number | boolean;
  showFreeSpace?: number | boolean;
  [key: string]: unknown;
}

// The keys on the LEFT are what legacy installs actually wrote to storage,
// typos included: 'showNotificationOnDownloadCompleate' and
// 'hideFnishStatusItem' shipped that way for years, so "fixing" the spelling
// here silently stopped migrating those two settings. Both spellings are
// accepted, the historical one first.
const oldConfigMap: Record<string, string> = {
  useSSL: 'ssl',
  ip: 'hostname',
  path: 'pathname',
  displayActiveTorrentCountIcon: 'showActiveCountBadge',
  showNotificationOnDownloadCompleate: 'showDownloadCompleteNotifications',
  showNotificationOnDownloadComplete: 'showDownloadCompleteNotifications',
  popupUpdateInterval: 'uiUpdateInterval',
  hideSeedStatusItem: 'hideSeedingTorrents',
  hideFnishStatusItem: 'hideFinishedTorrents',
  hideFinishStatusItem: 'hideFinishedTorrents',
  selectDownloadCategoryOnAddItemFromContextMenu:
    'selectDownloadCategoryAfterPutTorrentFromContextMenu',
  showDefaultFolderContextMenuItem: 'putDefaultPathInContextMenu',
  folderList: 'folders',
  torrentListColumnList: 'torrentColumns',
  fileListColumnList: 'filesColumns',
};

const oldConfigDefaults = Object.keys(oldConfigMap);

const loadConfig = (keys: string | string[] | null): Promise<Config> => {
  return storageGet<Config>(keys)
    .then((config) => {
      if (config.configVersion !== 2) {
        return storageGet<Record<string, unknown>>(oldConfigDefaults)
          .then((oldConfig) => {
            return migrateConfig(oldConfig, config);
          })
          .then((config) => {
            config.configVersion = 2;
            return storageSet(config as Record<string, unknown>).then(() => config);
          });
      }
      return config;
    })
    .then((config) => {
      if (config.selectedLabel) {
        if (typeof config.selectedLabel.custom === 'number') {
          config.selectedLabel.custom = !!config.selectedLabel.custom;
        }
      }

      (['showSpeedGraph', 'treeViewContextMenu', 'showFreeSpace'] as const).forEach((key) => {
        if (typeof config[key] === 'number') {
          (config as Record<string, unknown>)[key] = !!config[key];
        }
      });

      return config;
    });
};

function migrateConfig(oldConfig: Record<string, unknown>, config: Config): Config {
  const transformMap: Record<string, (value: unknown) => unknown> = {
    useSSL: intToBoolean,
    displayActiveTorrentCountIcon: intToBoolean,
    showNotificationOnDownloadCompleate: intToBoolean,
    showNotificationOnDownloadComplete: intToBoolean,
    hideSeedStatusItem: intToBoolean,
    hideFnishStatusItem: intToBoolean,
    hideFinishStatusItem: intToBoolean,
    showSpeedGraph: intToBoolean,
    selectDownloadCategoryOnAddItemFromContextMenu: intToBoolean,
    treeViewContextMenu: intToBoolean,
    showDefaultFolderContextMenuItem: intToBoolean,
    showFreeSpace: intToBoolean,
    folderList: folderListToFolders,
    selectedLabel: selectedLabelToLabel,
  };

  Object.entries(oldConfig).forEach(([key, value]) => {
    const newKey = oldConfigMap[key];

    const transform = transformMap[key];
    if (transform) {
      try {
        value = transform(value);
      } catch (err) {
        // This also runs on user-pasted restore blobs: one malformed field
        // must not abort the whole restore with a raw TypeError
        logger.warn(`migrateConfig: skipping malformed key (${key})`, err);
        return;
      }
    }

    (config as Record<string, unknown>)[newKey || key] = value;
  });

  function intToBoolean(value: unknown): boolean {
    return typeof value === 'boolean' ? value : !!value;
  }

  function folderListToFolders(value: unknown): NewFolder[] {
    if (!Array.isArray(value)) {
      throw new TypeError('folderList is not an array');
    }
    return (value as OldFolder[])
      .filter((entry) => Array.isArray(entry) && typeof entry[1] === 'string')
      .map(([, path, label]) => {
        return {
          path,
          name: typeof label === 'string' ? label : '',
        };
      });
  }

  function selectedLabelToLabel(value: unknown): NewSelectedLabel {
    const v = value as OldSelectedLabel | null;
    if (!v || typeof v.label !== 'string') {
      throw new TypeError('selectedLabel has no label');
    }
    return {
      label: v.label,
      custom: !!v.custom,
    };
  }

  return config;
}

export default loadConfig;
export { migrateConfig };
