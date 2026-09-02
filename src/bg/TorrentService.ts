import getLogger from '../tools/getLogger';
import type { TorrentId } from '../types';
import readBlobAsArrayBuffer from '../tools/readBlobAsArrayBuffer';
import { arrayBufferToBase64 } from '../tools/binaryConversion';
import downloadFileFromUrl from '../tools/downloadFileFromUrl';
import { parseTransmissionResponse } from '../tools/safeJsonParse';
import { storageGet, storageSet, storageRemove } from '../tools/chromeStorage';
import {
  assertRpcVersion,
  RPC_VERSION_3,
  RPC_VERSION_4,
  RPC_VERSION_4_1,
} from '../tools/rpcCompat';
import { RECENTLY_ACTIVE_THRESHOLD } from '../constants';
import type TransmissionTransport from './TransmissionTransport';
import type { TransmissionResponse } from './TransmissionTransport';
import type { BandwidthPriority } from '../types/transmission';
import {
  decideCompletions,
  NOTIFIED_STORAGE_KEY,
  type CompletionCensus,
  type NotifiedState,
} from './completionRules';

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
  /**
   * Absent from both listFields and detailFields — it costs ~0.5-2KB per
   * torrent per poll and the copy-magnet action rebuilds a URI from the hash.
   * Optional so consumers have to handle the rebuild rather than trusting a
   * value that is in practice always undefined.
   */
  magnetLink?: string;
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
  incompleteTorrentIds: number[];
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
}

/** Session-scoped, so the recently-active window survives an SW restart */
const RESPONSE_TIME_STORAGE_KEY = '_torrentsResponseTime';

/** Session-scoped speed-graph history, restored after an SW restart */
const SPEED_ROLL_STORAGE_KEY = '_speedRoll';

/**
 * How often the speed roll is written. Only an SW restart ever reads it back,
 * so this trades a few seconds of graph history for not re-serializing five
 * minutes of samples on every one-second poll.
 */
const SPEED_ROLL_PERSIST_INTERVAL = 10_000;

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
  /** Whether any visible column needs the (very heavy) trackerStats field */
  getNeedsTrackerStats?: () => boolean;
}

class TorrentService {
  private transport: TransmissionTransport;
  private clientStore: TorrentStore;
  private notifier: TorrentNotifier;
  private getShowNotifications: () => boolean;
  private getNeedsTrackerStats: () => boolean;
  private torrentsResponseTime: number;
  private _notifiedStatePromise: Promise<NotifiedState | null>;
  private _inFlightUpdate: Promise<TransmissionResponse> | null = null;
  /** Monotonic request counter, so out-of-order responses can be dropped */
  private _requestSeq = 0;
  private _lastAppliedSeq = 0;
  /** Detects a change in the requested field set (Seeds/Peers column toggle) */
  private _lastNeedsTrackerStats = false;
  /** Last time the speed roll was written to session storage (see persistSpeedRoll) */
  private _lastSpeedPersist = 0;

  constructor(options: TorrentServiceOptions) {
    this.transport = options.transport;
    this.clientStore = options.clientStore;
    this.notifier = options.notifier;
    this.getShowNotifications = options.getShowNotifications;
    this.getNeedsTrackerStats = options.getNeedsTrackerStats ?? (() => false);
    this.torrentsResponseTime = 0;

    // Restore the recently-active window across service-worker restarts. The
    // MV3 worker is killed after ~30s idle, so an instance-only value meant the
    // 2-minute background poll ALWAYS refetched the full list.
    storageGet<Record<string, number | undefined>>(RESPONSE_TIME_STORAGE_KEY, 'session')
      .then((data) => {
        const stored = data[RESPONSE_TIME_STORAGE_KEY];
        if (typeof stored === 'number' && stored > this.torrentsResponseTime) {
          this.torrentsResponseTime = stored;
        }
      })
      .catch(() => {});

    // Restore the speed-graph history the previous worker generation collected
    storageGet<Record<string, { download: number; upload: number; time: number }[] | undefined>>(
      SPEED_ROLL_STORAGE_KEY,
      'session'
    )
      .then((data) => {
        const stored = data[SPEED_ROLL_STORAGE_KEY];
        // Only seed an empty roll: live samples beat a stale snapshot
        if (Array.isArray(stored) && stored.length && !this.clientStore.speedRoll.data.length) {
          this.clientStore.speedRoll.setData(stored);
        }
      })
      .catch(() => {});

    // A failed read must not poison every later poll — null just skips
    // completion notifications for the first cycle. Callback-based helper:
    // chrome.* returns no promise on Firefox.
    this._notifiedStatePromise = storageGet<Record<string, NotifiedState | undefined>>(
      NOTIFIED_STORAGE_KEY
    )
      .then((data) => data[NOTIFIED_STORAGE_KEY] ?? null)
      .catch(() => null);
    // Drop the pre-3.5 id-keyed sets: ids are session-scoped, so they could
    // only ever produce wrong notifications
    storageRemove(['_activeIds', '_notifiedIds']).catch(() => {});
  }

  resetResponseTime(): void {
    this.torrentsResponseTime = 0;
    storageRemove(RESPONSE_TIME_STORAGE_KEY, 'session').catch(() => {});
  }

  /**
   * Refresh chained after a mutating action. It needs a request issued AFTER
   * the action (a shared in-flight poll could predate it), but not a full list:
   * 'recently-active' returns every torrent the action touched plus a `removed`
   * list, which is what makes a full fetch per action unnecessary — that costs
   * megabytes on a large library and they stack when several actions run.
   */
  private thenUpdateTorrents = <T>(result: T): Promise<T> => {
    return this.requestTorrents({ full: false, reuseInFlight: false }).then(() => result);
  };

  /**
   * `force` means the user explicitly asked for a refresh: a fresh request AND
   * a full list, so a drifted list can always be repaired.
   *
   * Periodic polls (1s UI Interval, background alarm) coalesce, since they are
   * interchangeable and pile up on a slow daemon.
   */
  updateTorrents(force?: boolean): Promise<TransmissionResponse> {
    return this.requestTorrents({ full: !!force, reuseInFlight: !force });
  }

  private requestTorrents(options: {
    full: boolean;
    reuseInFlight: boolean;
  }): Promise<TransmissionResponse> {
    if (options.reuseInFlight && this._inFlightUpdate) {
      return this._inFlightUpdate;
    }
    const promise = this.doUpdateTorrents(options.full).finally(() => {
      if (this._inFlightUpdate === promise) {
        this._inFlightUpdate = null;
      }
    });
    if (options.reuseInFlight) {
      this._inFlightUpdate = promise;
    }
    return promise;
  }

  private doUpdateTorrents(full?: boolean): Promise<TransmissionResponse> {
    const now = Math.trunc(Date.now() / 1000);
    // Requests can overlap and answer out of order; an older response must
    // never be applied on top of a newer one, or it resurrects torrents the
    // user just removed.
    const requestSeq = ++this._requestSeq;

    // Toggling the Seeds/Peers column changes WHICH fields we ask for, and a
    // recently-active delta only refreshes active torrents: without one full
    // fetch, every idle torrent showed 0 seeds forever after enabling the
    // column (the earlier polls wrote 0 because the field wasn't requested)
    const needsTrackerStats = this.getNeedsTrackerStats();
    const fieldsChanged = needsTrackerStats !== this._lastNeedsTrackerStats;
    // NOT committed here: a full refetch discarded by the out-of-order guard
    // below would still have cleared the flag, so no later poll would ever ask
    // for the new field set again and idle torrents kept showing 0 seeds.

    let isRecently = false;
    if (!full && !fieldsChanged && now - this.torrentsResponseTime < RECENTLY_ACTIVE_THRESHOLD) {
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
    // trackerStats is by far the heaviest field (Transmission returns ~25
    // subfields per tracker) and only feeds the seeds/peers columns, which are
    // hidden by default. magnetLink is another ~0.5-2KB per torrent and is read
    // once per session at most — the copy-magnet action rebuilds it from the
    // hash. Fetching both on every poll cost a multi-GB/day idle transfer.
    if (needsTrackerStats) {
      listFields.push('trackerStats');
    }
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

    // The notified state is read when the RESPONSE lands, not when the request
    // is issued: two overlapping polls would otherwise compute completions from
    // the same stale baseline and both notify. It is also REPLACED inside the
    // same link, so a second poll waits on this one's result instead of
    // reading the baseline it is about to invalidate.
    return requestPromise.then((response) => {
      const nextStatePromise = this._notifiedStatePromise.then((previousState) => {
        // A response older than one already applied carries a pre-action view
        // of the list: applying it would undo what the user just did
        if (requestSeq < this._lastAppliedSeq) {
          return previousState;
        }
        this._lastAppliedSeq = requestSeq;
        this._lastNeedsTrackerStats = needsTrackerStats;
        if (now > this.torrentsResponseTime) {
          this.torrentsResponseTime = now;
          storageSet({ [RESPONSE_TIME_STORAGE_KEY]: now }, 'session').catch(() => {});
        }

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

        // Completion detection, keyed by hashString and scoped to this server.
        // Skipped entirely when notifications are off: the census walks every
        // torrent and allocates a hash list the size of the whole library.
        if (!this.getShowNotifications()) {
          const { downloadSpeed, uploadSpeed } = this.clientStore.currentSpeed;
          this.clientStore.speedRoll.add(downloadSpeed, uploadSpeed);
          this.persistSpeedRoll();
          // Drop the baseline instead of freezing it. Kept, it stops at the
          // moment the user turned notifications off, so every torrent that
          // finished while they were off still looks like one we watched
          // finish and arrives as a burst on the first poll after re-enabling.
          // Cleared, that first poll behaves like a new server: silent for one
          // cycle, accurate from the next.
          if (previousState !== null) {
            storageRemove(NOTIFIED_STORAGE_KEY).catch(() => {});
          }
          return null;
        }
        // Census first, decision second: walking the store and applying the
        // rules were interleaved here, which is what made this the hardest
        // code in the file to follow.
        const incompleteIds = new Set(this.clientStore.incompleteTorrentIds);
        const census: CompletionCensus = { known: [], completed: [] };
        for (const id of this.clientStore.torrentIds) {
          const torrent = this.clientStore.torrents.get(id);
          const hash = torrent?.hashString;
          if (!torrent || !hash) continue;
          census.known.push(hash);
          if (!incompleteIds.has(id)) census.completed.push({ hash, torrent });
        }

        const { notify, nextState, shouldPersist } = decideCompletions(
          previousState,
          census,
          this.transport.url,
          now
        );
        for (const torrent of notify) this.notifier.torrentCompleteNotify(torrent);
        if (shouldPersist) {
          storageSet({ [NOTIFIED_STORAGE_KEY]: nextState }).catch(() => {});
        }

        const { downloadSpeed, uploadSpeed } = this.clientStore.currentSpeed;
        this.clientStore.speedRoll.add(downloadSpeed, uploadSpeed);
        this.persistSpeedRoll();

        return nextState;
      });

      // A rejected link must not strand every later poll on a promise that
      // never settles, so the chain carries on from a null baseline instead.
      this._notifiedStatePromise = nextStatePromise.catch(() => null);
      return nextStatePromise.then(() => response);
    });
  }

  /**
   * The speed graph's history lived only in service-worker memory, which MV3
   * discards after ~30s idle — so the graph restarted empty on every popup
   * open. Session storage matches its lifetime (gone on browser restart).
   */
  private persistSpeedRoll(): void {
    // Called on every applied poll — once a second while a page is open — and
    // the roll keeps five minutes of samples, so writing it each time
    // serialized ~300 objects per second purely to survive an SW restart.
    // The restart is the only reader, so a coarse cadence loses nothing but
    // the last few seconds of graph history.
    const now = Date.now();
    if (now - this._lastSpeedPersist < SPEED_ROLL_PERSIST_INTERVAL) return;
    this._lastSpeedPersist = now;
    const data = this.clientStore.speedRoll.data;
    storageSet({ [SPEED_ROLL_STORAGE_KEY]: data.map((p) => ({ ...p })) }, 'session').catch(
      () => {}
    );
  }

  start(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-start', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  forcestart(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-start-now', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  stop(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-stop', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  recheck(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-verify', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  removetorrent(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-remove', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  removedatatorrent(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-remove', arguments: { ids, 'delete-local-data': true } })
      .then(this.thenUpdateTorrents);
  }

  rename(ids: TorrentId[], path: string, name: string): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-rename-path', arguments: { ids, path, name } })
      .then(this.thenUpdateTorrents);
  }

  torrentSetLocation(ids: TorrentId[], location: string): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set-location', arguments: { ids, location, move: true } })
      .then(this.thenUpdateTorrents);
  }

  setLabels(ids: TorrentId[], labels: string[]): Promise<TransmissionResponse> {
    // Labels landed in RPC 16 (Transmission 3.00); older daemons answer
    // 'success' while silently ignoring the argument
    assertRpcVersion(this.transport.rpcVersion, RPC_VERSION_3, 'Labels');
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, labels } })
      .then(this.thenUpdateTorrents);
  }

  setBandwidthPriority(ids: TorrentId[], priority: number): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, bandwidthPriority: priority } })
      .then(this.thenUpdateTorrents);
  }

  reannounce(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport.sendAction({ method: 'torrent-reannounce', arguments: { ids } });
  }

  queueTop(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-top', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueUp(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-up', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueDown(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-down', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  queueBottom(ids: TorrentId[]): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({ method: 'queue-move-bottom', arguments: { ids } })
      .then(this.thenUpdateTorrents);
  }

  sendFile(
    data: { blob?: Blob; url?: string },
    directory?: string,
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
            }),
            parseTransmissionResponse
          );
        } else if (data.blob) {
          return readBlobAsArrayBuffer(data.blob)
            .then((ab) => arrayBufferToBase64(ab))
            .then((base64) => {
              return transport.sendAction(
                applyOptions({
                  method: 'torrent-add',
                  arguments: { metainfo: base64 },
                }),
                parseTransmissionResponse
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
        query.arguments['download-dir'] = directory;
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
    directory?: string,
    options?: TorrentAddOptions
  ): Promise<void> {
    // Failure notification is owned by sendFile's catch — no handler here,
    // or every failed add would notify twice
    return this.sendFile(data, directory, options).then((response) => {
      const args = response.arguments as Record<string, { id: number; name: string } | undefined>;
      const torrentAdded = args['torrent_added'] ?? args['torrent-added'];
      const torrentDuplicate = args['torrent_duplicate'] ?? args['torrent-duplicate'];
      if (torrentAdded) {
        this.notifier.torrentAddedNotify(torrentAdded);
      }
      if (torrentDuplicate) {
        this.notifier.torrentIsExistsNotify(torrentDuplicate);
      }
    });
  }

  sendFiles(urls: string[], directory?: string): Promise<TransmissionResponse> {
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

  getPeers(id: TorrentId): Promise<PeerData[]> {
    return this.transport
      .sendAction(
        {
          method: 'torrent-get',
          arguments: {
            fields: ['id', 'peers'],
            ids: [id],
          },
        },
        parseTransmissionResponse
      )
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

  getTorrentDetails(id: TorrentId): Promise<TorrentDetailData> {
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

  setDownloadLimit(
    ids: TorrentId[],
    limit: number,
    enabled: boolean
  ): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, downloadLimit: limit, downloadLimited: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setUploadLimit(ids: TorrentId[], limit: number, enabled: boolean): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, uploadLimit: limit, uploadLimited: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setHonorsSessionLimits(ids: TorrentId[], enabled: boolean): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, honorsSessionLimits: enabled },
      })
      .then(this.thenUpdateTorrents);
  }

  setPeerLimit(ids: TorrentId[], limit: number): Promise<TransmissionResponse> {
    return this.transport
      .sendAction({
        method: 'torrent-set',
        arguments: { ids, 'peer-limit': limit },
      })
      .then(this.thenUpdateTorrents);
  }

  setGroup(ids: TorrentId[], group: string): Promise<TransmissionResponse> {
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

  setSequentialDownload(ids: TorrentId[], enabled: boolean): Promise<TransmissionResponse> {
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

  setTrackerList(ids: TorrentId[], trackerList: string): Promise<TransmissionResponse> {
    // trackerList replaced trackerAdd/Remove/Replace in RPC 17; older daemons
    // ignore it silently, so fail loudly like every other 4.x-only path
    assertRpcVersion(this.transport.rpcVersion, RPC_VERSION_4, 'Editing the tracker list');
    return this.transport
      .sendAction({ method: 'torrent-set', arguments: { ids, trackerList } })
      .then(this.thenUpdateTorrents);
  }

  setSeedLimits(
    ids: TorrentId[],
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
    // Transmission sentinels: -1 = not applicable, -2 = infinite (seeded
    // without downloading). Mapping -2 to 0 showed the best seeders as the
    // worst ratio; keep it as a sentinel the UI can render as ∞.
    const shared = uploadRatio >= 0 ? Math.round(uploadRatio * 1000) : uploadRatio === -2 ? -2 : 0;
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
      // Every tracker scrapes the SAME swarm, so summing multiplied the counts
      // by the number of working trackers — the best estimate is the max
      trackerStats.forEach((tracker) => {
        if (tracker.leecherCount > _peers) {
          _peers = tracker.leecherCount;
        }
        if (tracker.seederCount > _seeds) {
          _seeds = tracker.seederCount;
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
    const magnetLink = torrent.magnetLink as string | undefined;
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
