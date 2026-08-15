import getLogger from '../tools/getLogger';
import readBlobAsArrayBuffer from '../tools/readBlobAsArrayBuffer';
import { arrayBufferToBase64 } from '../tools/binaryConversion';
import downloadFileFromUrl from '../tools/downloadFileFromUrl';
import { parseTransmissionResponse } from '../tools/safeJsonParse';
import { assertRpcVersion, RPC_VERSION_4, RPC_VERSION_4_1 } from '../tools/rpcCompat';
import { RECENTLY_ACTIVE_THRESHOLD } from '../constants';
import type TransmissionTransport from './TransmissionTransport';
import type { TransmissionResponse } from './TransmissionTransport';
import type { Folder } from '../types/bg';
import type { BandwidthPriority } from '../types/transmission';

const logger = getLogger('TorrentService');

export interface PeerData {
  address: string;
  client: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  flags: string;
  isEncrypted: boolean;
  isUTP: boolean;
  isIncoming: boolean;
}

export interface TorrentAddOptions {
  paused?: boolean;
  cookies?: string;
  peerLimit?: number;
  bandwidthPriority?: BandwidthPriority;
  filesWanted?: number[];
  filesUnwanted?: number[];
  priorityHigh?: number[];
  priorityLow?: number[];
  priorityNormal?: number[];
  labels?: string[];
  sequentialDownload?: boolean;
}

export interface TrackerStat {
  id: number;
  announce: string;
  tier: number;
  seederCount: number;
  leecherCount: number;
  lastAnnounceResult: string;
  isBackup: boolean;
}

export interface PeersFromData {
  fromCache: number;
  fromDht: number;
  fromIncoming: number;
  fromLpd: number;
  fromLtep: number;
  fromPex: number;
  fromTracker: number;
}

export interface TorrentDetailData {
  comment: string;
  creator: string;
  dateCreated: number;
  pieceCount: number;
  pieceSize: number;
  corruptEver: number;
  desiredAvailable: number;
  secondsDownloading: number;
  secondsSeeding: number;
  webseeds: string[];
  trackerList: string;
  trackerStats: TrackerStat[];
  seedRatioLimit: number;
  seedRatioMode: number;
  seedIdleLimit: number;
  seedIdleMode: number;
  peersFrom: PeersFromData | null;
  downloadLimit: number;
  downloadLimited: boolean;
  uploadLimit: number;
  uploadLimited: boolean;
  honorsSessionLimits: boolean;
  // v4.0.0+ (rpc 17), undefined on older daemons
  fileCount?: number;
  primaryMimeType?: string;
}

export interface NormalizedTorrent {
  id: number;
  statusCode: number;
  errorCode: number;
  errorString: string;
  name: string;
  size: number;
  sizeWhenDone: number;
  percentDone: number;
  recheckProgress: number;
  downloaded: number;
  uploaded: number;
  shared: number;
  uploadSpeed: number;
  downloadSpeed: number;
  eta: number;
  etaIdle: number;
  activePeers: number;
  peers: number;
  activeSeeds: number;
  seeds: number;
  order: number;
  addedTime: number;
  completedTime: number;
  activityDate: number;
  startDate: number;
  editDate: number;
  directory: string;
  magnetLink: string;
  hashString?: string;
  isStalled: boolean;
  isPrivate: boolean;
  isFinished: boolean;
  metadataPercentComplete: number;
  peersConnected: number;
  labels: string[];
  bandwidthPriority: number;
  sequentialDownload?: boolean;
}

interface TorrentStore {
  activeTorrentIds: number[];
  torrentIds: number[];
  removeTorrentByIds: (ids: number[]) => void;
  syncChanges: (torrents: NormalizedTorrent[]) => void;
  sync: (torrents: NormalizedTorrent[]) => void;
  torrents: Map<number, { stateText: string }>;
  currentSpeed: { downloadSpeed: number; uploadSpeed: number };
  speedRoll: { add: (download: number, upload: number) => void };
}

interface TorrentNotifier {
  torrentCompleteNotify: (torrent: { stateText: string }) => void;
  torrentAddedNotify: (torrent: { id: number; name?: string }) => void;
  torrentIsExistsNotify: (torrent: { id: number; name?: string }) => void;
  torrentErrorNotify: (message: string) => void;
}

interface TorrentServiceOptions {
  transport: TransmissionTransport;
  clientStore: TorrentStore;
  notifier: TorrentNotifier;
  getShowNotifications: () => boolean;
}

class TorrentService {
  private transport: TransmissionTransport;
  private clientStore: TorrentStore;
  private notifier: TorrentNotifier;
  private getShowNotifications: () => boolean;
  private torrentsResponseTime: number;
  private _notifiedIdsPromise: Promise<number[] | null>;

  constructor(options: TorrentServiceOptions) {
    this.transport = options.transport;
    this.clientStore = options.clientStore;
    this.notifier = options.notifier;
    this.getShowNotifications = options.getShowNotifications;
    this.torrentsResponseTime = 0;

    this._notifiedIdsPromise = chrome.storage.local
      .get('_notifiedIds')
      .then((data) => (data._notifiedIds as number[] | undefined) ?? null);
    chrome.storage.local.remove('_activeIds');
  }

  resetResponseTime(): void {
    this.torrentsResponseTime = 0;
  }

  private thenUpdateTorrents = <T>(result: T): Promise<T> => {
    return this.updateTorrents().then(() => result);
  };

  updateTorrents(force?: boolean): Promise<TransmissionResponse> {
    const now = Math.trunc(Date.now() / 1000);

    let isRecently = false;
    if (!force && now - this.torrentsResponseTime < RECENTLY_ACTIVE_THRESHOLD) {
      isRecently = true;
    }

    const listFields = [
      'id',
      'name',
      'totalSize',
      'sizeWhenDone',
      'percentDone',
      'downloadedEver',
      'uploadedEver',
      'rateUpload',
      'rateDownload',
      'eta',
      'etaIdle',
      'peersSendingToUs',
      'peersGettingFromUs',
      'queuePosition',
      'addedDate',
      'doneDate',
      'activityDate',
      'startDate',
      'editDate',
      'downloadDir',
      'recheckProgress',
      'status',
      'error',
      'errorString',
      'trackerStats',
      'magnetLink',
      'uploadRatio',
      'hashString',
      'isStalled',
      'isPrivate',
      'isFinished',
      'metadataPercentComplete',
      'peersConnected',
      'labels',
      'bandwidthPriority',
    ];
    if (this.transport.rpcVersion >= RPC_VERSION_4_1) {
      listFields.push('sequential_download');
    }

    const requestPromise = this.transport.sendAction(
      {
        method: 'torrent-get',
        arguments: {
          fields: listFields,
          ids: isRecently ? 'recently-active' : undefined,
        },
      },
      parseTransmissionResponse
    );

    return Promise.all([requestPromise, this._notifiedIdsPromise]).then(
      ([response, previousNotifiedIds]) => {
        this.torrentsResponseTime = now;

        if (isRecently) {
          const { removed, torrents } = response.arguments as {
            removed: number[];
            torrents: Record<string, unknown>[];
          };

          this.clientStore.removeTorrentByIds(removed);
          this.clientStore.syncChanges(torrents.map(this.normalizeTorrent));
        } else {
          const { torrents } = response.arguments as { torrents: Record<string, unknown>[] };
          this.clientStore.sync(torrents.map(this.normalizeTorrent));
        }

        // Completion detection via persisted notified set
        const activeSet = new Set(this.clientStore.activeTorrentIds);
        const completedIds = this.clientStore.torrentIds.filter((id) => !activeSet.has(id));

        if (this.getShowNotifications() && previousNotifiedIds !== null) {
          const notifiedSet = new Set(previousNotifiedIds);
          for (const id of completedIds) {
            if (!notifiedSet.has(id)) {
              const torrent = this.clientStore.torrents.get(id);
              if (torrent) {
                this.notifier.torrentCompleteNotify(torrent);
              }
            }
          }
        }

        this._notifiedIdsPromise = Promise.resolve(completedIds);
        chrome.storage.local.set({ _notifiedIds: completedIds });

        const { downloadSpeed, uploadSpeed } = this.clientStore.currentSpeed;
        this.clientStore.speedRoll.add(downloadSpeed, uploadSpeed);

        return response;
      }
    );
  }

  start(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-start', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  forcestart(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-start-now', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  stop(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-stop', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  recheck(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-verify', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  removetorrent(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-remove', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  removedatatorrent(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-remove', arguments: { ids, 'delete-local-data': true } })
      .then(this.thenUpdateTorrents);
  }

  rename(ids: number[], path: string, name: string): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-rename-path', arguments: { ids, path, name } })
      .then(this.thenUpdateTorrents);
  }

  torrentSetLocation(ids: number[], location: string): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set-location', arguments: { ids, location, move: true } })
      .then(this.thenUpdateTorrents);
  }

  setLabels(ids: number[], labels: string[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, labels } })
      .then(this.thenUpdateTorrents);
  }

  setBandwidthPriority(ids: number[], priority: number): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, bandwidthPriority: priority } })
      .then(this.thenUpdateTorrents);
  }

  reannounce(ids: number[]): Promise<TransmissionResponse> {
    return this.transport.sendAction({ method: 'torrent-reannounce', arguments: { ids } });
  }

  queueTop(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-top', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueUp(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-up', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueDown(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-down', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueBottom(ids: number[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-bottom', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  sendFile(
    data: { blob?: Blob; url?: string },
    directory?: Folder,
    options?: TorrentAddOptions
  ): Promise<TransmissionResponse> {
    const transport = this.transport;
    return Promise.resolve()
      .then(() => {
        if (data.url) {
          return transport.sendAction(
            applyOptions({
              method: 'torrent-add',
              arguments: { filename: data.url },
            })
          );
        } else if (data.blob) {
          return readBlobAsArrayBuffer(data.blob)
            .then((ab) => arrayBufferToBase64(ab))
            .then((base64) => {
              return transport.sendAction(
                applyOptions({
                  method: 'torrent-add',
                  arguments: { metainfo: base64 },
                })
              );
            });
        } else {
          throw new Error('No URL or blob provided');
        }
      })
      .catch((err) => {
        if (err.code === 'TRANSMISSION_ERROR') {
          this.notifier.torrentErrorNotify(err.message);
        } else {
          this.notifier.torrentErrorNotify(chrome.i18n.getMessage('unexpectedError'));
        }
        throw err;
      });

    function applyOptions(query: { method: string; arguments: Record<string, unknown> }): {
      method: string;
      arguments: Record<string, unknown>;
    } {
      if (directory) {
        query.arguments['download-dir'] = directory.path;
      }
      if (options) {
        if (options.paused !== undefined) query.arguments['paused'] = options.paused;
        if (options.cookies !== undefined) query.arguments['cookies'] = options.cookies;
        if (options.peerLimit !== undefined) query.arguments['peer-limit'] = options.peerLimit;
        if (options.bandwidthPriority !== undefined)
          query.arguments['bandwidthPriority'] = options.bandwidthPriority;
        if (options.filesWanted) query.arguments['files-wanted'] = options.filesWanted;
        if (options.filesUnwanted) query.arguments['files-unwanted'] = options.filesUnwanted;
        if (options.priorityHigh) query.arguments['priority-high'] = options.priorityHigh;
        if (options.priorityLow) query.arguments['priority-low'] = options.priorityLow;
        if (options.priorityNormal) query.arguments['priority-normal'] = options.priorityNormal;
        if (options.labels) query.arguments['labels'] = options.labels;
        // sequential download exists since Transmission 4.1 (rpc 18); the key
        // was born in the snake_case era, so snake is its canonical name
        if (options.sequentialDownload !== undefined && transport.rpcVersion >= RPC_VERSION_4_1) {
          query.arguments['sequential_download'] = options.sequentialDownload;
        }
      }
      return query;
    }
  }

  putTorrent(
    data: { blob?: Blob; url?: string },
    directory?: Folder,
    options?: TorrentAddOptions
  ): Promise<void> {
    return this.sendFile(data, directory, options).then(
      (response) => {
        const args = response.arguments as Record<string, { id: number; name: string } | undefined>;
        const torrentAdded = args['torrent_added'] ?? args['torrent-added'];
        const torrentDuplicate = args['torrent_duplicate'] ?? args['torrent-duplicate'];
        if (torrentAdded) {
          this.notifier.torrentAddedNotify(torrentAdded);
        }
        if (torrentDuplicate) {
          this.notifier.torrentIsExistsNotify(torrentDuplicate);
        }
      },
      (err) => {
        if (err.code === 'TRANSMISSION_ERROR') {
          this.notifier.torrentErrorNotify(err.message);
        } else {
          this.notifier.torrentErrorNotify(chrome.i18n.getMessage('unexpectedError'));
        }
        throw err;
      }
    );
  }

  sendFiles(urls: string[], directory?: Folder): Promise<TransmissionResponse> {
    return Promise.all(
      urls.map((url) => {
        return downloadFileFromUrl(url)
          .catch((err) => {
            if (err.code === 'FILE_SIZE_EXCEEDED') {
              this.notifier.torrentErrorNotify(chrome.i18n.getMessage('fileSizeError'));
              throw err;
            }
            // Magnet links can't be downloaded; pass the URI straight to
            // Transmission's torrent-add (filename) like the context-menu flow does.
            if (!/^(https?|magnet):/.test(url)) {
              this.notifier.torrentErrorNotify(chrome.i18n.getMessage('unexpectedError'));
              throw err;
            }
            if (err.code !== 'LINK_IS_NOT_SUPPORTED') {
              logger.error('sendFiles: downloadFileFromUrl error, fallback to url', err);
            }
            return { url };
          })
          .then((data) => {
            return this.putTorrent(data, directory);
          })
          .then(
            () => {
              return { result: true };
            },
            (err) => {
              logger.error('sendFile error', url, err);
              return { error: err };
            }
          );
      })
    ).then(() => this.thenUpdateTorrents({} as TransmissionResponse));
  }

  getPeers(id: number): Promise<PeerData[]> {
    return this.transport
      .sendAction({
        method: 'torrent-get',
        arguments: {
          fields: ['id', 'peers'],
          ids: [id],
        },
      })
      .then((response) => {
        type RawPeer = {
          address: string;
          clientName: string;
          progress: number;
          rateToClient: number;
          rateToPeer: number;
          flagStr: string;
          isEncrypted?: boolean;
          isUTP?: boolean;
          isIncoming?: boolean;
        };
        type TorrentPeers = { id: number; peers: RawPeer[] };
        const torrents = (response.arguments as { torrents: TorrentPeers[] }).torrents;
        const torrent = torrents.find((t) => t.id === id);
        if (!torrent) return [];
        return torrent.peers.map((peer): PeerData => ({
          address: peer.address,
          client: peer.clientName,
          progress: peer.progress,
          downloadSpeed: peer.rateToClient,
          uploadSpeed: peer.rateToPeer,
          flags: peer.flagStr,
          isEncrypted: peer.isEncrypted ?? false,
          isUTP: peer.isUTP ?? false,
          isIncoming: peer.isIncoming ?? false,
        }));
      });
  }

  getTorrentDetails(id: number): Promise<TorrentDetailData> {
    const detailFields = [
      'id',
      'comment',
      'creator',
      'dateCreated',
      'pieceCount',
      'pieceSize',
      'corruptEver',
      'desiredAvailable',
      'secondsDownloading',
      'secondsSeeding',
      'webseeds',
      'trackerList',
      'trackerStats',
      'seedRatioLimit',
      'seedRatioMode',
      'seedIdleLimit',
      'seedIdleMode',
      'peersFrom',
      'downloadLimit',
      'downloadLimited',
      'uploadLimit',
      'uploadLimited',
      'honorsSessionLimits',
    ];
    if (this.transport.rpcVersion >= RPC_VERSION_4) {
      detailFields.push('file-count', 'primary-mime-type');
    }
    return this.transport
      .sendAction(
        {
          method: 'torrent-get',
          arguments: {
            fields: detailFields,
            ids: [id],
          },
        },
        parseTransmissionResponse
      )
      .then((response) => {
        type RawTrackerStat = {
          id: number;
          announce: string;
          tier: number;
          seederCount: number;
          leecherCount: number;
          lastAnnounceResult: string;
          isBackup: boolean;
        };
        type RawPeersFrom = {
          fromCache: number;
          fromDht: number;
          fromIncoming: number;
          fromLpd: number;
          fromLtep: number;
          fromPex: number;
          fromTracker: number;
        };
        type RawTorrent = {
          id: number;
          comment: string;
          creator: string;
          dateCreated: number;
          pieceCount: number;
          pieceSize: number;
          corruptEver: number;
          desiredAvailable: number;
          secondsDownloading: number;
          secondsSeeding: number;
          webseeds: string[];
          trackerList: string;
          trackerStats: RawTrackerStat[];
          seedRatioLimit: number;
          seedRatioMode: number;
          seedIdleLimit: number;
          seedIdleMode: number;
          peersFrom?: RawPeersFrom;
          downloadLimit?: number;
          downloadLimited?: boolean;
          uploadLimit?: number;
          uploadLimited?: boolean;
          honorsSessionLimits?: boolean;
          'file-count'?: number;
          'primary-mime-type'?: string;
        };
        const torrents = (response.arguments as { torrents: RawTorrent[] }).torrents;
        const torrent = torrents.find((t) => t.id === id);
        if (!torrent) throw new Error(`Torrent ${id} not found`);
        return {
          comment: torrent.comment || '',
          creator: torrent.creator || '',
          dateCreated: torrent.dateCreated || 0,
          pieceCount: torrent.pieceCount || 0,
          pieceSize: torrent.pieceSize || 0,
          corruptEver: torrent.corruptEver || 0,
          desiredAvailable: torrent.desiredAvailable || 0,
          secondsDownloading: torrent.secondsDownloading || 0,
          secondsSeeding: torrent.secondsSeeding || 0,
          webseeds: torrent.webseeds || [],
          trackerList: torrent.trackerList || '',
          trackerStats: (torrent.trackerStats || []).map((ts): TrackerStat => ({
            id: ts.id,
            announce: ts.announce,
            tier: ts.tier,
            seederCount: ts.seederCount,
            leecherCount: ts.leecherCount,
            lastAnnounceResult: ts.lastAnnounceResult || '',
            isBackup: ts.isBackup,
          })),
          seedRatioLimit: torrent.seedRatioLimit ?? 0,
          seedRatioMode: torrent.seedRatioMode ?? 0,
          seedIdleLimit: torrent.seedIdleLimit ?? 0,
          seedIdleMode: torrent.seedIdleMode ?? 0,
          peersFrom: torrent.peersFrom ?? null,
          downloadLimit: torrent.downloadLimit ?? 0,
          downloadLimited: torrent.downloadLimited ?? false,
          uploadLimit: torrent.uploadLimit ?? 0,
          uploadLimited: torrent.uploadLimited ?? false,
          honorsSessionLimits: torrent.honorsSessionLimits ?? true,
          fileCount: torrent['file-count'],
          primaryMimeType: torrent['primary-mime-type'],
        };
      });
  }

  setDownloadLimit(ids: number[], limit: number, enabled: boolean): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, downloadLimit: limit, downloadLimited: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setUploadLimit(ids: number[], limit: number, enabled: boolean): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, uploadLimit: limit, uploadLimited: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setHonorsSessionLimits(ids: number[], enabled: boolean): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, honorsSessionLimits: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setPeerLimit(ids: number[], limit: number): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, 'peer-limit': limit },
      })
      .then(this.thenUpdateTorrents);
  }

  setQueuePosition(ids: number[], position: number): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, queuePosition: position },
      })
      .then(this.thenUpdateTorrents);
  }

  setGroup(ids: number[], group: string): Promise<TransmissionResponse> {
    return Promise.resolve()
      .then(() => assertRpcVersion(this.transport.rpcVersion, RPC_VERSION_4, 'torrent-set group'))
      .then(() =>
        this.transport.sendAction({
          method: 'torrent-set',
          arguments: { ids, group },
        })
      )
      .then(this.thenUpdateTorrents);
  }

  setSequentialDownload(ids: number[], enabled: boolean): Promise<TransmissionResponse> {
    return Promise.resolve()
      .then(() =>
        assertRpcVersion(this.transport.rpcVersion, RPC_VERSION_4_1, 'sequential download')
      )
      .then(() =>
        this.transport.sendAction({
          method: 'torrent-set',
          arguments: { ids, sequential_download: enabled },
        })
      )
      .then(this.thenUpdateTorrents);
  }

  setTrackerList(ids: number[], trackerList: string): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, trackerList } })
      .then(this.thenUpdateTorrents);
  }

  setSeedLimits(
    ids: number[],
    seedRatioMode: number,
    seedRatioLimit: number,
    seedIdleMode: number,
    seedIdleLimit: number
  ): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, seedRatioMode, seedRatioLimit, seedIdleMode, seedIdleLimit },
      })
      .then(this.thenUpdateTorrents);
  }

  private normalizeTorrent = (torrent: Record<string, unknown>): NormalizedTorrent => {
    const id = torrent.id as number;
    const statusCode = torrent.status as number;
    const errorCode = torrent.error as number;
    const errorString = torrent.errorString as string;
    const name = torrent.name as string;
    const size = torrent.totalSize as number;
    const sizeWhenDone = (torrent.sizeWhenDone as number) ?? size;
    const percentDone = torrent.percentDone as number;
    const recheckProgress = torrent.recheckProgress as number;
    const downloaded = torrent.downloadedEver as number;
    const uploaded = torrent.uploadedEver as number;
    const uploadRatio = torrent.uploadRatio as number;
    const shared = uploadRatio >= 0 ? Math.round(uploadRatio * 1000) : 0;
    const uploadSpeed = torrent.rateUpload as number;
    const downloadSpeed = torrent.rateDownload as number;
    // Preserve sentinels: -1 = not available/infinite, -2 = unknown
    const eta = (torrent.eta as number) ?? -1;
    const etaIdle = (torrent.etaIdle as number) ?? -1;
    const sequentialDownload = (torrent.sequential_download ?? torrent.sequentialDownload) as
      boolean | undefined;

    let _peers = 0;
    let _seeds = 0;
    const trackerStats = torrent.trackerStats as
      Array<{ leecherCount: number; seederCount: number }> | undefined;
    if (Array.isArray(trackerStats)) {
      trackerStats.forEach((tracker) => {
        if (tracker.leecherCount > 0) {
          _peers += tracker.leecherCount;
        }
        if (tracker.seederCount > 0) {
          _seeds += tracker.seederCount;
        }
      });
    }

    const activePeers = torrent.peersGettingFromUs as number;
    const peers = _peers;
    const activeSeeds = torrent.peersSendingToUs as number;
    const seeds = _seeds;

    const order = torrent.queuePosition as number;
    const addedTime = torrent.addedDate as number;
    const completedTime = torrent.doneDate as number;
    const activityDate = (torrent.activityDate as number) ?? 0;
    const startDate = (torrent.startDate as number) ?? 0;
    const editDate = (torrent.editDate as number) ?? 0;
    const directory = torrent.downloadDir as string;
    const magnetLink = torrent.magnetLink as string;
    const hashString = (torrent.hashString as string) ?? undefined;
    const isStalled = (torrent.isStalled as boolean) ?? false;
    const isPrivate = (torrent.isPrivate as boolean) ?? false;
    const isFinished = (torrent.isFinished as boolean) ?? false;
    const metadataPercentComplete = (torrent.metadataPercentComplete as number) ?? 1;
    const peersConnected = (torrent.peersConnected as number) ?? 0;
    const labels = (torrent.labels as string[] | undefined) ?? [];
    const bandwidthPriority = (torrent.bandwidthPriority as number) ?? 0;

    return {
      id,
      statusCode,
      errorCode,
      errorString,
      name,
      size,
      sizeWhenDone,
      percentDone,
      recheckProgress,
      downloaded,
      uploaded,
      shared,
      uploadSpeed,
      downloadSpeed,
      eta,
      etaIdle,
      activePeers,
      peers,
      activeSeeds,
      seeds,
      order,
      addedTime,
      completedTime,
      activityDate,
      startDate,
      editDate,
      directory,
      magnetLink,
      hashString,
      isStalled,
      isPrivate,
      isFinished,
      metadataPercentComplete,
      peersConnected,
      labels,
      bandwidthPriority,
      sequentialDownload,
    };
  };
}

export default TorrentService;
