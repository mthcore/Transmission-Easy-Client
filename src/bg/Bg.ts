import getLogger from '../tools/getLogger';
import Daemon, { ALARM_NAME } from './Daemon';
import ContextMenu from './ContextMenu';
import BgStore, { IBgStore } from '../stores/BgStore';
import { autorun } from 'mobx';
import TransmissionClient from './TransmissionClient';
import updateWebUiAuthRule from './webUiAuthRule';
import MobxPatchLine from '../tools/MobxPatchLine';
import { serializeError } from 'serialize-error';
import type { BgMessage, IBgForDaemon, IBgForContextMenu } from '../types';
import { getSnapshot } from 'mobx-state-tree';

const logger = getLogger('background');

const notificationIcons = {
  complete: chrome.runtime.getURL('assets/img/notification_done.png'),
  add: chrome.runtime.getURL('assets/img/notification_add.png'),
  error: chrome.runtime.getURL('assets/img/notification_error.png'),
};

interface TorrentInfo {
  id: number;
  name: string;
  stateText?: string;
}

class Bg {
  bgStore: IBgStore;
  bgStorePathLine: MobxPatchLine;
  client: TransmissionClient | null;
  daemon: Daemon | null;
  contextMenu: ContextMenu | null;
  initPromise: Promise<void> | null;

  constructor() {
    this.bgStore = BgStore.create();
    // Cast to Record for MobxPatchLine compatibility with MST types
    this.bgStorePathLine = new MobxPatchLine(this.bgStore as unknown as Record<string, unknown>, [
      'client',
    ]);
    this.client = null;
    this.daemon = null;
    this.contextMenu = null;

    this.initPromise = null;

    this.init().catch((err) => {
      logger.error('init error', err);
    });
  }

  init(): Promise<void> {
    chrome.runtime.onMessage.addListener(this.handleMessage);
    // chrome.alarms listener must be registered synchronously at SW startup
    chrome.alarms.onAlarm.addListener(this.handleAlarm);
    // Clicking a notification used to do nothing at all
    chrome.notifications.onClicked.addListener(this.handleNotificationClick);
    // Cast needed because MST types with 'maybe' are complex
    this.daemon = new Daemon(this as unknown as IBgForDaemon);
    this.contextMenu = new ContextMenu(this as unknown as IBgForContextMenu);

    return (this.initPromise = this.bgStore.fetchConfig().then(() => {
      const autorunLogger = getLogger('autorun');

      autorun(() => {
        autorunLogger.info('daemon');
        this.daemon?.start();
      });

      autorun(() => {
        autorunLogger.info('client');
        const config = this.bgStore.config;
        if (!config) return;

        const dep = [
          config.ssl,
          config.port,
          config.hostname,
          config.pathname,
          config.authenticationRequired,
        ];

        if (dep.length) {
          this.bgStore.flushClient();
          // Cast needed for TransmissionClient's Bg interface expectations
          this.client = new TransmissionClient(this as never);
          // session-get first so the daemon's rpc-version is known before the
          // first torrent-get; still poll torrents if session-get fails
          this.client
            .updateSettings()
            .catch((err) => {
              autorunLogger.error('client', 'updateSettings error', err);
            })
            .then(() => this.client?.updateTorrents())
            .catch((err) => {
              autorunLogger.error('client', 'updateTorrents error', err);
            });
        }
      });

      autorun(() => {
        autorunLogger.info('webUiAuthRule');
        const config = this.bgStore.config;
        if (!config) return;

        updateWebUiAuthRule({
          ssl: config.ssl,
          hostname: config.hostname,
          port: config.port,
          pathname: config.pathname,
          webPathname: config.webPathname,
          authenticationRequired: config.authenticationRequired,
          login: config.login,
          password: config.password,
        }).catch((err) => {
          autorunLogger.error('webUiAuthRule', 'update error', err);
        });
      });

      autorun(() => {
        autorunLogger.info('badge');
        const config = this.bgStore.config;
        if (!config) return;

        if (config.showActiveCountBadge) {
          // The option is labelled "number of DOWNLOADING torrents": not
          // "running" (would never clear while seeding) and not merely
          // "unfinished" (would never clear while a paused torrent sits at 40%)
          const count = this.bgStore.client.downloadingCount;
          if (count > 0) {
            setBadgeText('' + count);
          } else {
            setBadgeText('');
          }
        } else {
          setBadgeText('');
        }
      });

      autorun(() => {
        autorunLogger.info('badgeColor');
        const config = this.bgStore.config;
        if (!config) return;

        setBadgeBackgroundColor(config.badgeColor);
      });

      autorun(() => {
        autorunLogger.info('contextMenu');
        const config = this.bgStore.config;
        if (!config) return;

        const dep = [
          config.folders.length,
          config.treeViewContextMenu,
          config.putDefaultPathInContextMenu,
        ];

        if (dep.length) {
          this.contextMenu?.create();
        }
      });
    }));
  }

  whenReady(): Promise<void> {
    return this.initPromise ?? Promise.resolve();
  }

  private requireClient(): TransmissionClient {
    if (!this.client) {
      throw new Error('Client not initialized');
    }
    return this.client;
  }

  handleMessage = (
    message: BgMessage,
    sender: chrome.runtime.MessageSender,
    response: (result: unknown) => void
  ): boolean | void => {
    // Only this extension's own pages may drive the dispatcher. It answers
    // 'getConfigStore' with the daemon password and serves every destructive
    // action, while our content script lives in arbitrary web pages — so the
    // boundary is asserted here rather than left to depend on that script
    // never growing a page-facing bridge.
    // Note the check is on the URL, not on sender.tab: the options page and the
    // full-page view legitimately run IN a tab (options_ui.open_in_tab), while
    // a content script reports the web page's own URL.
    const ownOrigin = chrome.runtime.getURL('');
    if (sender.id !== chrome.runtime.id || (sender.url && !sender.url.startsWith(ownOrigin))) {
      logger.warn('Rejected a message from outside the extension', sender.id, sender.url);
      return;
    }

    let promise: Promise<unknown> | null = null;

    // Type narrowing happens automatically in each case block
    switch (message.action) {
      case 'getBgStoreDelta': {
        promise = this.whenReady().then(() => {
          return this.bgStorePathLine.getDelta(message.id, message.patchId);
        });
        break;
      }
      case 'getConfigStore': {
        promise = this.whenReady().then(() => {
          const config = this.bgStore.config;
          return config ? getSnapshot(config) : null;
        });
        break;
      }
      case 'updateTorrentList': {
        promise = this.whenReady().then(() => {
          return this.requireClient().updateTorrents(message.force);
        });
        break;
      }
      case 'start':
      case 'forcestart':
      case 'stop':
      case 'recheck':
      case 'removetorrent':
      case 'removedatatorrent':
      case 'reannounce':
      case 'queueTop':
      case 'queueUp':
      case 'queueDown':
      case 'queueBottom': {
        const action = message.action;
        promise = this.whenReady().then(() => this.requireClient()[action](message.ids));
        break;
      }
      case 'setPriority': {
        promise = this.whenReady().then(() =>
          this.requireClient().setPriority(message.id, message.level, message.fileIdxs)
        );
        break;
      }
      case 'getFileList': {
        promise = this.whenReady().then(() => this.requireClient().getFileList(message.id));
        break;
      }
      case 'getPeers': {
        promise = this.whenReady().then(() => this.requireClient().getPeers(message.id));
        break;
      }
      case 'setDownloadSpeedLimitEnabled':
      case 'setUploadSpeedLimitEnabled':
      case 'setAltSpeedEnabled':
      case 'setBlocklistEnabled':
      case 'setSeedRatioLimited':
      case 'setIdleSeedingLimitEnabled':
      case 'setPortForwardingEnabled':
      case 'setDhtEnabled':
      case 'setPexEnabled':
      case 'setLpdEnabled':
      case 'setUtpEnabled':
      case 'setIncompleteDirEnabled':
      case 'setRenamePartialFiles':
      case 'setDownloadQueueEnabled':
      case 'setSeedQueueEnabled':
      case 'setQueueStalledEnabled':
      case 'setStartAddedTorrents':
      case 'setTrashOriginalTorrentFiles':
      case 'setAltSpeedTimeEnabled':
      case 'setScriptTorrentDoneEnabled':
      case 'setScriptTorrentAddedEnabled':
      case 'setScriptTorrentDoneSeedingEnabled': {
        const action = message.action;
        const enabled = message.enabled;
        promise = this.whenReady().then(() => this.requireClient()[action](enabled));
        break;
      }
      case 'setDownloadSpeedLimit':
      case 'setUploadSpeedLimit':
      case 'setAltUploadSpeedLimit':
      case 'setAltDownloadSpeedLimit': {
        const action = message.action;
        const speed = message.speed;
        promise = this.whenReady().then(() => this.requireClient()[action](speed));
        break;
      }
      case 'updateSettings': {
        // The options page sends this right after writing new connection
        // settings to validate them; the async storage.onChanged listener may
        // not have rebuilt the client yet. Re-reading the config here makes
        // the rebuild happen before the check, so the NEW server is validated.
        promise = this.whenReady()
          .then(() => this.bgStore.fetchConfig())
          .then(() => this.requireClient().updateSettings());
        break;
      }
      case 'sendFiles': {
        promise = this.whenReady().then(() => {
          return this.requireClient().sendFiles(message.urls, message.directory);
        });
        break;
      }
      case 'getFreeSpace': {
        promise = this.whenReady().then(() => {
          return this.requireClient().getFreeSpace(message.path);
        });
        break;
      }
      case 'rename': {
        promise = this.whenReady().then(() =>
          this.requireClient().rename(message.ids, message.path, message.name)
        );
        break;
      }
      case 'torrentSetLocation': {
        promise = this.whenReady().then(() =>
          this.requireClient().torrentSetLocation(message.ids, message.location)
        );
        break;
      }
      case 'setLabels': {
        promise = this.whenReady().then(() =>
          this.requireClient().setLabels(message.ids, message.labels)
        );
        break;
      }
      case 'setBandwidthPriority': {
        promise = this.whenReady().then(() =>
          this.requireClient().setBandwidthPriority(message.ids, message.priority)
        );
        break;
      }
      case 'setPeerLimitGlobal':
      case 'setPeerLimitPerTorrent':
      case 'setSeedRatioLimit':
      case 'setIdleSeedingLimit':
      case 'setPeerPort':
      case 'setDownloadQueueSize':
      case 'setSeedQueueSize':
      case 'setQueueStalledMinutes':
      case 'setAltSpeedTimeBegin':
      case 'setAltSpeedTimeEnd':
      case 'setAltSpeedTimeDay': {
        const action = message.action;
        const value = message.value;
        promise = this.whenReady().then(() => this.requireClient()[action](value));
        break;
      }
      case 'setEncryption': {
        promise = this.whenReady().then(() => this.requireClient().setEncryption(message.mode));
        break;
      }
      case 'setBlocklistUrl': {
        promise = this.whenReady().then(() => this.requireClient().setBlocklistUrl(message.url));
        break;
      }
      case 'blocklistUpdate': {
        promise = this.whenReady().then(() => this.requireClient().blocklistUpdate());
        break;
      }
      case 'setIncompleteDir': {
        promise = this.whenReady().then(() => this.requireClient().setIncompleteDir(message.dir));
        break;
      }
      case 'setScriptTorrentDoneFilename':
      case 'setScriptTorrentAddedFilename':
      case 'setScriptTorrentDoneSeedingFilename': {
        const action = message.action;
        const filename = message.filename;
        promise = this.whenReady().then(() => this.requireClient()[action](filename));
        break;
      }
      case 'portTest': {
        promise = this.whenReady().then(() => this.requireClient().portTest(message.ipProtocol));
        break;
      }
      case 'setSequentialDownload': {
        promise = this.whenReady().then(() =>
          this.requireClient().setSequentialDownload(message.ids, message.enabled)
        );
        break;
      }
      case 'getTorrentDetails': {
        promise = this.whenReady().then(() => this.requireClient().getTorrentDetails(message.id));
        break;
      }
      case 'setTrackerList': {
        promise = this.whenReady().then(() =>
          this.requireClient().setTrackerList(message.ids, message.trackerList)
        );
        break;
      }
      case 'setSeedLimits': {
        promise = this.whenReady().then(() =>
          this.requireClient().setSeedLimits(
            message.ids,
            message.seedRatioMode,
            message.seedRatioLimit,
            message.seedIdleMode,
            message.seedIdleLimit
          )
        );
        break;
      }
      default: {
        // Exhaustive check - TypeScript will error if a case is missing
        const _exhaustiveCheck: never = message;
        promise = Promise.reject(
          new Error(`Unknown request: ${(_exhaustiveCheck as BgMessage).action}`)
        );
      }
    }

    if (promise) {
      promise
        .then(
          (result) => {
            response({ result });
          },
          (err) => {
            response({ error: serializeError(err) });
          }
        )
        .catch((err) => {
          logger.error('Send response error', err);
        });
      return true;
    }
  };

  handleNotificationClick = (notificationId: string) => {
    chrome.notifications.clear(notificationId);
    // The popup can't be opened programmatically on every browser, so fall
    // back to the extension page in a tab
    const openPage = () => chrome.tabs.create({ url: '/index.html' });
    const action = chrome.action as typeof chrome.action & {
      openPopup?: () => Promise<void>;
    };
    if (typeof action.openPopup === 'function') {
      Promise.resolve(action.openPopup()).catch(openPage);
    } else {
      openPage();
    }
  };

  handleAlarm = (alarm: chrome.alarms.Alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    this.whenReady()
      .then(() => {
        if (this.daemon?.isActive) {
          this.daemon.handleFire();
        }
      })
      .catch((err) => {
        logger.error('handleAlarm error', err);
      });
  };

  torrentAddedNotify(torrent: TorrentInfo): void {
    const icon = notificationIcons.add;
    const statusText = chrome.i18n.getMessage('torrentAdded');
    showNotification('added-' + torrent.id, icon, torrent.name, statusText);
  }

  torrentIsExistsNotify(torrent: TorrentInfo): void {
    const icon = notificationIcons.error;
    const title = chrome.i18n.getMessage('torrentFileIsExists');
    showNotification('exists-' + torrent.id, icon, torrent.name, title);
  }

  torrentExistsNotify(): void {
    const icon = notificationIcons.error;
    const title = chrome.i18n.getMessage('torrentFileExists');
    showNotification('exists-' + Date.now(), icon, title);
  }

  torrentCompleteNotify(torrent: TorrentInfo): void {
    const icon = notificationIcons.complete;
    const statusText = chrome.i18n.getMessage('OV_COL_STATUS') + ': ' + torrent.stateText;
    showNotification('complete-' + torrent.id, icon, torrent.name, statusText);
  }

  torrentErrorNotify(message: string): void {
    const icon = notificationIcons.error;
    const title = chrome.i18n.getMessage('OV_FL_ERROR');
    showNotification('error-' + Date.now(), icon, title, message);
  }
}

let lastBadgeText: string | null = null;
function setBadgeText(text: string): void {
  if (text === lastBadgeText) return;
  lastBadgeText = text;
  chrome.action.setBadgeText({ text: text });
}

function showNotification(id: string, iconUrl: string, title = '', message = ''): void {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: iconUrl,
    title: title,
    message: message,
  });
}

let lastBadgeColor: string | null = null;
function setBadgeBackgroundColor(color: string): void {
  if (color === lastBadgeColor) return;
  lastBadgeColor = color;
  const colors = color.split(',').map((i) => parseFloat(i));
  if (colors.length === 4) {
    const alpha = colors.pop();
    // Ensure minimum alpha so badge is always visible
    colors.push(Math.round(255 * Math.max(alpha ?? 1, 0.1)));
  }
  chrome.action.setBadgeBackgroundColor({ color: colors as [number, number, number, number] });
}

declare const self: Window & { bg: Bg };

const bg = (self.bg = new Bg());

export default bg;
