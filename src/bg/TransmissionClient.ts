import TransmissionTransport from './TransmissionTransport';
import type { TransmissionResponse } from './TransmissionTransport';
import TorrentService, {
  type NormalizedTorrent,
  type PeerData,
  type TorrentDetailData,
  type TorrentAddOptions,
} from './TorrentService';
import FileService, { type NormalizedFile } from './FileService';
import SettingsService, {
  type NormalizedSettings,
  type NormalizedSessionStats,
  type NormalizedBandwidthGroup,
} from './SettingsService';
import type { Folder } from '../types/bg';

interface BgStore {
  config: {
    url: string;
    authenticationRequired: boolean;
    login: string;
    password: string;
    showDownloadCompleteNotifications: boolean;
  };
  client: {
    incompleteTorrentIds: number[];
    torrentIds: number[];
    removeTorrentByIds: (ids: number[]) => void;
    syncChanges: (torrents: NormalizedTorrent[]) => void;
    sync: (torrents: NormalizedTorrent[]) => void;
    torrents: Map<number, { stateText: string; hashString?: string }>;
    currentSpeed: { downloadSpeed: number; uploadSpeed: number };
    speedRoll: { add: (download: number, upload: number) => void };
    setSettings: (settings: NormalizedSettings) => void;
  };
  flushClient: () => void;
}

interface Bg {
  bgStore: BgStore;
  daemon: { isActive: boolean; start: () => void };
  torrentCompleteNotify: (torrent: { stateText: string }) => void;
  torrentAddedNotify: (torrent: { id: number; name?: string }) => void;
  torrentIsExistsNotify: (torrent: { id: number; name?: string }) => void;
  torrentErrorNotify: (message: string) => void;
}

class TransmissionClient {
  private transport: TransmissionTransport;
  private torrentService: TorrentService;
  private fileService: FileService;
  private settingsService: SettingsService;

  constructor(bg: Bg) {
    const bgStore = bg.bgStore;

    this.transport = new TransmissionTransport({
      url: bgStore.config.url,
      getConfig: () => bgStore.config,
      onConnected: () => {
        if (!bg.daemon.isActive) {
          bg.daemon.start();
        }
      },
      onTokenRefresh: () => {
        this.torrentService.resetResponseTime();
      },
    });

    this.torrentService = new TorrentService({
      transport: this.transport,
      clientStore: bgStore.client,
      notifier: bg,
      getShowNotifications: () => bgStore.config.showDownloadCompleteNotifications,
    });

    this.fileService = new FileService(this.transport);

    this.settingsService = new SettingsService(this.transport, (settings) =>
      bgStore.client.setSettings(settings)
    );
  }

  private versionPromise: Promise<void> | null = null;

  /**
   * Ensure the daemon's rpc-version is known before version-dependent calls.
   * Covers MV3 service-worker wake-ups where the alarm fires updateTorrents
   * before any session-get has resolved. Self-heals: on failure the next poll
   * retries, and the current cycle proceeds ungated (rpcVersion 0).
   */
  private ensureVersion(): Promise<void> {
    if (this.transport.rpcVersion > 0) return Promise.resolve();
    if (!this.versionPromise) {
      this.versionPromise = this.settingsService.updateSettings().catch(() => {
        this.versionPromise = null;
      });
    }
    return this.versionPromise;
  }

  // Torrent operations
  updateTorrents(force?: boolean): Promise<TransmissionResponse> {
    return this.ensureVersion().then(() => this.torrentService.updateTorrents(force));
  }
  start(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.start(ids);
  }
  forcestart(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.forcestart(ids);
  }
  stop(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.stop(ids);
  }
  recheck(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.recheck(ids);
  }
  removetorrent(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.removetorrent(ids);
  }
  removedatatorrent(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.removedatatorrent(ids);
  }
  rename(ids: number[], path: string, name: string): Promise<TransmissionResponse> {
    return this.torrentService.rename(ids, path, name);
  }
  torrentSetLocation(ids: number[], location: string): Promise<TransmissionResponse> {
    return this.torrentService.torrentSetLocation(ids, location);
  }
  setLabels(ids: number[], labels: string[]): Promise<TransmissionResponse> {
    return this.torrentService.setLabels(ids, labels);
  }
  setBandwidthPriority(ids: number[], priority: number): Promise<TransmissionResponse> {
    return this.torrentService.setBandwidthPriority(ids, priority);
  }
  setSequentialDownload(ids: number[], enabled: boolean): Promise<TransmissionResponse> {
    return this.torrentService.setSequentialDownload(ids, enabled);
  }
  reannounce(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.reannounce(ids);
  }
  queueTop(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.queueTop(ids);
  }
  queueUp(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.queueUp(ids);
  }
  queueDown(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.queueDown(ids);
  }
  queueBottom(ids: number[]): Promise<TransmissionResponse> {
    return this.torrentService.queueBottom(ids);
  }
  sendFiles(urls: string[], directory?: string): Promise<TransmissionResponse> {
    return this.torrentService.sendFiles(urls, directory);
  }
  putTorrent(
    data: { blob?: Blob; url?: string },
    directory?: string,
    options?: TorrentAddOptions
  ): Promise<void> {
    return this.torrentService.putTorrent(data, directory, options);
  }
  getPeers(id: number): Promise<PeerData[]> {
    return this.torrentService.getPeers(id);
  }
  getTorrentDetails(id: number): Promise<TorrentDetailData> {
    return this.torrentService.getTorrentDetails(id);
  }
  setTrackerList(ids: number[], trackerList: string): Promise<TransmissionResponse> {
    return this.torrentService.setTrackerList(ids, trackerList);
  }
  setSeedLimits(
    ids: number[],
    seedRatioMode: number,
    seedRatioLimit: number,
    seedIdleMode: number,
    seedIdleLimit: number
  ): Promise<TransmissionResponse> {
    return this.torrentService.setSeedLimits(
      ids,
      seedRatioMode,
      seedRatioLimit,
      seedIdleMode,
      seedIdleLimit
    );
  }

  // Per-torrent limits (torrent-set)
  setTorrentDownloadLimit(
    ids: number[],
    limit: number,
    enabled: boolean
  ): Promise<TransmissionResponse> {
    return this.torrentService.setDownloadLimit(ids, limit, enabled);
  }
  setTorrentUploadLimit(
    ids: number[],
    limit: number,
    enabled: boolean
  ): Promise<TransmissionResponse> {
    return this.torrentService.setUploadLimit(ids, limit, enabled);
  }
  setTorrentHonorsSessionLimits(ids: number[], enabled: boolean): Promise<TransmissionResponse> {
    return this.torrentService.setHonorsSessionLimits(ids, enabled);
  }
  setTorrentPeerLimit(ids: number[], limit: number): Promise<TransmissionResponse> {
    return this.torrentService.setPeerLimit(ids, limit);
  }
  setTorrentQueuePosition(ids: number[], position: number): Promise<TransmissionResponse> {
    return this.torrentService.setQueuePosition(ids, position);
  }
  setTorrentGroup(ids: number[], group: string): Promise<TransmissionResponse> {
    return this.torrentService.setGroup(ids, group);
  }

  // File operations
  getFileList(id: number): Promise<NormalizedFile[]> {
    return this.fileService.getFileList(id);
  }
  setPriority(id: number, level: number, idxs: number[]): Promise<unknown[]> {
    return this.fileService.setPriority(id, level, idxs);
  }

  // Settings operations
  updateSettings(): Promise<void> {
    return this.settingsService.updateSettings();
  }
  getSessionStats(): Promise<NormalizedSessionStats> {
    return this.settingsService.getSessionStats();
  }
  getFreeSpace(path: string): Promise<{ path: string; sizeBytes: number; totalSize?: number }> {
    return this.settingsService.getFreeSpace(path);
  }
  getGroups(names?: string[]): Promise<NormalizedBandwidthGroup[]> {
    return this.settingsService.getGroups(names);
  }
  setSessionGroup(
    name: string,
    options: {
      honorsSessionLimits?: boolean;
      speedLimitDown?: number;
      speedLimitDownEnabled?: boolean;
      speedLimitUp?: number;
      speedLimitUpEnabled?: boolean;
    }
  ): Promise<void> {
    return this.settingsService.setGroup(name, options);
  }
  setDownloadSpeedLimitEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setDownloadSpeedLimitEnabled(enabled);
  setDownloadSpeedLimit = (speed: number): Promise<void> =>
    this.settingsService.setDownloadSpeedLimit(speed);
  setUploadSpeedLimitEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setUploadSpeedLimitEnabled(enabled);
  setUploadSpeedLimit = (speed: number): Promise<void> =>
    this.settingsService.setUploadSpeedLimit(speed);
  setAltSpeedEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setAltSpeedEnabled(enabled);
  setAltDownloadSpeedLimit = (speed: number): Promise<void> =>
    this.settingsService.setAltDownloadSpeedLimit(speed);
  setAltUploadSpeedLimit = (speed: number): Promise<void> =>
    this.settingsService.setAltUploadSpeedLimit(speed);
  setBlocklistEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setBlocklistEnabled(enabled);
  setBlocklistUrl = (url: string): Promise<void> => this.settingsService.setBlocklistUrl(url);
  blocklistUpdate(): Promise<{ blocklistSize: number }> {
    return this.settingsService.blocklistUpdate();
  }
  setPeerLimitGlobal = (limit: number): Promise<void> =>
    this.settingsService.setPeerLimitGlobal(limit);
  setPeerLimitPerTorrent = (limit: number): Promise<void> =>
    this.settingsService.setPeerLimitPerTorrent(limit);
  setSeedRatioLimited = (enabled: boolean): Promise<void> =>
    this.settingsService.setSeedRatioLimited(enabled);
  setSeedRatioLimit = (limit: number): Promise<void> =>
    this.settingsService.setSeedRatioLimit(limit);
  setIdleSeedingLimitEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setIdleSeedingLimitEnabled(enabled);
  setIdleSeedingLimit = (limit: number): Promise<void> =>
    this.settingsService.setIdleSeedingLimit(limit);
  setPeerPort = (port: number): Promise<void> => this.settingsService.setPeerPort(port);
  setPortForwardingEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setPortForwardingEnabled(enabled);
  setEncryption = (mode: string): Promise<void> => this.settingsService.setEncryption(mode);
  setDhtEnabled = (enabled: boolean): Promise<void> => this.settingsService.setDhtEnabled(enabled);
  setPexEnabled = (enabled: boolean): Promise<void> => this.settingsService.setPexEnabled(enabled);
  setLpdEnabled = (enabled: boolean): Promise<void> => this.settingsService.setLpdEnabled(enabled);
  setUtpEnabled = (enabled: boolean): Promise<void> => this.settingsService.setUtpEnabled(enabled);
  setIncompleteDirEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setIncompleteDirEnabled(enabled);
  setIncompleteDir = (dir: string): Promise<void> => this.settingsService.setIncompleteDir(dir);
  setRenamePartialFiles = (enabled: boolean): Promise<void> =>
    this.settingsService.setRenamePartialFiles(enabled);
  setDownloadQueueEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setDownloadQueueEnabled(enabled);
  setDownloadQueueSize = (size: number): Promise<void> =>
    this.settingsService.setDownloadQueueSize(size);
  setSeedQueueEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setSeedQueueEnabled(enabled);
  setSeedQueueSize = (size: number): Promise<void> => this.settingsService.setSeedQueueSize(size);
  setQueueStalledEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setQueueStalledEnabled(enabled);
  setQueueStalledMinutes = (minutes: number): Promise<void> =>
    this.settingsService.setQueueStalledMinutes(minutes);
  setStartAddedTorrents = (enabled: boolean): Promise<void> =>
    this.settingsService.setStartAddedTorrents(enabled);
  setTrashOriginalTorrentFiles = (enabled: boolean): Promise<void> =>
    this.settingsService.setTrashOriginalTorrentFiles(enabled);
  setAltSpeedTimeEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setAltSpeedTimeEnabled(enabled);
  setAltSpeedTimeBegin = (minutes: number): Promise<void> =>
    this.settingsService.setAltSpeedTimeBegin(minutes);
  setAltSpeedTimeEnd = (minutes: number): Promise<void> =>
    this.settingsService.setAltSpeedTimeEnd(minutes);
  setAltSpeedTimeDay = (day: number): Promise<void> => this.settingsService.setAltSpeedTimeDay(day);
  setScriptTorrentDoneEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setScriptTorrentDoneEnabled(enabled);
  setScriptTorrentDoneFilename = (filename: string): Promise<void> =>
    this.settingsService.setScriptTorrentDoneFilename(filename);
  // v4.0.0+ session-set methods
  setScriptTorrentAddedEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setScriptTorrentAddedEnabled(enabled);
  setScriptTorrentAddedFilename = (filename: string): Promise<void> =>
    this.settingsService.setScriptTorrentAddedFilename(filename);
  setScriptTorrentDoneSeedingEnabled = (enabled: boolean): Promise<void> =>
    this.settingsService.setScriptTorrentDoneSeedingEnabled(enabled);
  setScriptTorrentDoneSeedingFilename = (filename: string): Promise<void> =>
    this.settingsService.setScriptTorrentDoneSeedingFilename(filename);
  setDefaultTrackers = (trackers: string): Promise<void> =>
    this.settingsService.setDefaultTrackers(trackers);
  portTest(ipProtocol?: 'ipv4' | 'ipv6'): Promise<boolean> {
    return this.settingsService.portTest(ipProtocol);
  }

  destroy(): void {
    // Cleanup
  }
}

export default TransmissionClient;
