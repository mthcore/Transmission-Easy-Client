import TransmissionTransport from './TransmissionTransport';
import type { TorrentId } from '../types';
import type { TransmissionResponse } from './TransmissionTransport';
import TorrentService, {
  type NormalizedTorrent,
  type PeerData,
  type TorrentDetailData,
  type TorrentAddOptions,
  type TorrentLimits,
} from './TorrentService';
import FileService, { type NormalizedFile } from './FileService';
import SettingsService, {
  type NormalizedSettings,
  type NormalizedBandwidthGroup,
} from './SettingsService';

interface BgStore {
  config: {
    url: string;
    authenticationRequired: boolean;
    login: string;
    password: string;
    showDownloadCompleteNotifications: boolean;
    needsTrackerStats: boolean;
  };
  client: {
    incompleteTorrentIds: number[];
    downloadingCount: number;
    torrentIds: number[];
    removeTorrentByIds: (ids: TorrentId[]) => void;
    syncChanges: (torrents: NormalizedTorrent[]) => void;
    sync: (torrents: NormalizedTorrent[]) => void;
    torrents: Map<
      number,
      { stateText: string; hashString?: string; downloaded?: number; completedTime?: number }
    >;
    currentSpeed: { downloadSpeed: number; uploadSpeed: number };
    speedRoll: {
      add: (download: number, upload: number) => void;
      setData: (data: { download: number; upload: number; time: number }[]) => void;
      data: { download: number; upload: number; time: number }[];
    };
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
      // Only pay for trackerStats when a column that displays it is visible
      getNeedsTrackerStats: () => bgStore.config.needsTrackerStats,
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
  start(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.start(ids);
  }
  forcestart(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.forcestart(ids);
  }
  stop(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.stop(ids);
  }
  recheck(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.recheck(ids);
  }
  removetorrent(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.removetorrent(ids);
  }
  removedatatorrent(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.removedatatorrent(ids);
  }
  rename(ids: TorrentId[], path: string, name: string): Promise<TransmissionResponse> {
    return this.torrentService.rename(ids, path, name);
  }
  torrentSetLocation(ids: TorrentId[], location: string): Promise<TransmissionResponse> {
    return this.torrentService.torrentSetLocation(ids, location);
  }
  setLabels(ids: TorrentId[], labels: string[]): Promise<TransmissionResponse> {
    return this.torrentService.setLabels(ids, labels);
  }
  setTorrentLimits(ids: TorrentId[], limits: TorrentLimits): Promise<TransmissionResponse> {
    return this.torrentService.setTorrentLimits(ids, limits);
  }
  setBandwidthPriority(ids: TorrentId[], priority: number): Promise<TransmissionResponse> {
    return this.torrentService.setBandwidthPriority(ids, priority);
  }
  setSequentialDownload(ids: TorrentId[], enabled: boolean): Promise<TransmissionResponse> {
    return this.torrentService.setSequentialDownload(ids, enabled);
  }
  reannounce(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.reannounce(ids);
  }
  queueTop(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.queueTop(ids);
  }
  queueUp(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.queueUp(ids);
  }
  queueDown(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.torrentService.queueDown(ids);
  }
  queueBottom(ids: TorrentId[]): Promise<TransmissionResponse> {
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
  getPeers(id: TorrentId): Promise<PeerData[]> {
    return this.torrentService.getPeers(id);
  }
  getTorrentDetails(id: TorrentId): Promise<TorrentDetailData> {
    return this.torrentService.getTorrentDetails(id);
  }
  setTrackerList(ids: TorrentId[], trackerList: string): Promise<TransmissionResponse> {
    return this.torrentService.setTrackerList(ids, trackerList);
  }
  setSeedLimits(
    ids: TorrentId[],
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
  setTorrentGroup(ids: TorrentId[], group: string): Promise<TransmissionResponse> {
    return this.torrentService.setGroup(ids, group);
  }

  // File operations
  getFileList(id: TorrentId): Promise<NormalizedFile[]> {
    return this.fileService.getFileList(id);
  }
  setPriority(id: TorrentId, level: number, idxs: number[]): Promise<unknown[]> {
    return this.fileService.setPriority(id, level, idxs);
  }
  setWanted(id: TorrentId, wanted: boolean, idxs: number[]): Promise<unknown[]> {
    return this.fileService.setWanted(id, wanted, idxs);
  }

  // Settings operations
  updateSettings(): Promise<void> {
    return this.settingsService.updateSettings();
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
  /** Uniform session settings, dispatched from the descriptor table */
  applySetting = (name: string, value: boolean | number | string): Promise<void> =>
    this.settingsService.applySetting(name, value);

  blocklistUpdate(): Promise<{ blocklistSize: number }> {
    return this.settingsService.blocklistUpdate();
  }
  // v4.0.0+ session-set methods
  portTest(ipProtocol?: 'ipv4' | 'ipv6'): Promise<boolean> {
    return this.settingsService.portTest(ipProtocol);
  }

  destroy(): void {
    // Cleanup
  }
}

export default TransmissionClient;
