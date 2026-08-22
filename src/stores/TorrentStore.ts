import { getRoot, types, Instance } from 'mobx-state-tree';
import { speedToStr, formatBytes } from '../tools/format';
import getEta from '../tools/getEta';

const TorrentStore = types
  .model('TorrentStore', {
    id: types.identifierNumber,
    statusCode: types.number,
    errorCode: types.number,
    errorString: types.string,
    name: types.string,
    size: types.number,
    sizeWhenDone: types.optional(types.number, 0),
    percentDone: types.number,
    recheckProgress: types.number,
    downloaded: types.number,
    uploaded: types.number,
    shared: types.number,
    uploadSpeed: types.number,
    downloadSpeed: types.number,
    eta: types.number,
    etaIdle: types.optional(types.number, -1),
    activePeers: types.number,
    peers: types.number,
    activeSeeds: types.number,
    seeds: types.number,
    order: types.maybe(types.number),
    addedTime: types.number,
    completedTime: types.number,
    activityDate: types.optional(types.number, 0),
    startDate: types.optional(types.number, 0),
    editDate: types.optional(types.number, 0),
    directory: types.maybe(types.string),
    magnetLink: types.maybe(types.string),
    hashString: types.maybe(types.string),
    isStalled: types.optional(types.boolean, false),
    isPrivate: types.optional(types.boolean, false),
    isFinished: types.optional(types.boolean, false),
    metadataPercentComplete: types.optional(types.number, 1),
    peersConnected: types.optional(types.number, 0),
    labels: types.optional(types.array(types.string), []),
    bandwidthPriority: types.optional(types.number, 0),
    sequentialDownload: types.maybe(types.boolean),
  })
  .actions((self) => {
    return {
      start(): Promise<void> {
        const rootStore = getRoot<{
          client: { torrentsStart: (ids: number[]) => Promise<void> };
        }>(self);
        return rootStore.client.torrentsStart([self.id]);
      },
      stop(): Promise<void> {
        const rootStore = getRoot<{
          client: { torrentsStop: (ids: number[]) => Promise<void> };
        }>(self);
        return rootStore.client.torrentsStop([self.id]);
      },
    };
  })
  .views((self) => {
    return {
      get remaining(): number {
        const base = self.sizeWhenDone > 0 ? self.sizeWhenDone : self.size;
        // Derive from percentDone, not from downloadedEver: that counter is
        // lifetime traffic, so a torrent seeded from existing data (0 bytes
        // downloaded) reported its whole size as remaining, and a re-download
        // reported 0 while still incomplete.
        const result = Math.round(base * (1 - self.percentDone));
        return result > 0 ? result : 0;
      },
      get remainingStr(): string {
        return formatBytes(this.remaining);
      },
      get isCompleted(): boolean {
        return self.percentDone === 1;
      },
      get sizeStr(): string {
        return formatBytes(self.size);
      },
      get sizeWhenDoneStr(): string {
        if (self.sizeWhenDone > 0 && self.sizeWhenDone !== self.size) {
          return formatBytes(self.sizeWhenDone);
        }
        return formatBytes(self.size);
      },
      get progress(): number {
        // Gate on the status, not on recheckProgress being truthy: a recheck
        // sitting at exactly 0.0 must not show the stale percentDone (100%)
        const isChecking = self.statusCode === 2;
        return Math.trunc((isChecking ? self.recheckProgress : self.percentDone) * 1000);
      },
      get progressStr(): string {
        const progress = this.progress / 10;
        if (progress < 100) {
          return progress.toFixed(1) + '%';
        } else {
          return Math.round(progress) + '%';
        }
      },
      get recheckProgressStr(): string {
        return (self.recheckProgress * 100).toFixed(1) + '%';
      },
      get uploadSpeedStr(): string {
        if (self.uploadSpeed === 0) {
          return '';
        } else {
          return speedToStr(self.uploadSpeed);
        }
      },
      get downloadSpeedStr(): string {
        if (self.downloadSpeed === 0) {
          return '';
        } else {
          return speedToStr(self.downloadSpeed);
        }
      },
      get etaStr(): string {
        return getEta(self.eta);
      },
      get etaIdleStr(): string {
        if (self.etaIdle < 0) return '';
        return getEta(self.etaIdle);
      },
      get uploadedStr(): string {
        return formatBytes(self.uploaded);
      },
      get sharedStr(): string {
        // -2 is Transmission's "infinite ratio" sentinel (uploaded with
        // nothing downloaded), which must not read as 0.00
        if (self.shared === -2) return '∞';
        return (self.shared / 1000).toFixed(2);
      },
      get downloadedStr(): string {
        return formatBytes(self.downloaded);
      },
      get addedTimeStr(): string {
        if (!self.addedTime) {
          return '-';
        } else {
          return new Date(self.addedTime * 1000).toLocaleString();
        }
      },
      get completedTimeStr(): string {
        if (!self.completedTime) {
          return '-';
        } else {
          return new Date(self.completedTime * 1000).toLocaleString();
        }
      },
      get activityDateStr(): string {
        if (!self.activityDate) {
          return '-';
        } else {
          return new Date(self.activityDate * 1000).toLocaleString();
        }
      },
      get startDateStr(): string {
        if (!self.startDate) {
          return '-';
        } else {
          return new Date(self.startDate * 1000).toLocaleString();
        }
      },
      get editDateStr(): string {
        if (!self.editDate) {
          return '-';
        } else {
          return new Date(self.editDate * 1000).toLocaleString();
        }
      },
      get metadataStatusStr(): string {
        if (self.metadataPercentComplete >= 1) return '';
        return `${(self.metadataPercentComplete * 100).toFixed(0)}%`;
      },
      get stateText(): string {
        // Metadata progress for magnets, but only while the torrent is
        // actually running — a stopped magnet used to read "Downloading"
        if (self.metadataPercentComplete < 1 && self.statusCode !== 0) {
          const pct = (self.metadataPercentComplete * 100).toFixed(0);
          return `${chrome.i18n.getMessage('OV_FL_DOWNLOADING')} (${chrome.i18n.getMessage('DT_METADATA')} ${pct}%)`;
        }
        switch (self.statusCode) {
          case 0: {
            if (self.isFinished || self.percentDone === 1) {
              return chrome.i18n.getMessage('OV_FL_FINISHED');
            } else {
              return chrome.i18n.getMessage('OV_FL_STOPPED');
            }
          }
          case 1:
          case 3: {
            return chrome.i18n.getMessage('OV_FL_QUEUED');
          }
          case 2: {
            return chrome.i18n.getMessage('OV_FL_CHECKED') + ' ' + this.recheckProgressStr;
          }
          case 4: {
            const label = chrome.i18n.getMessage('OV_FL_DOWNLOADING');
            return self.isStalled ? `${label} (${chrome.i18n.getMessage('OV_FL_STALLED')})` : label;
          }
          case 5: {
            return chrome.i18n.getMessage('OV_FL_QUEUED_SEED');
          }
          case 6: {
            const label = chrome.i18n.getMessage('OV_FL_SEEDING');
            return self.isStalled ? `${label} (${chrome.i18n.getMessage('OV_FL_STALLED')})` : label;
          }
          default: {
            return `Unknown (${self.statusCode})`;
          }
        }
      },
      get errorMessage(): string {
        // Code 1 is TR_STAT_TRACKER_WARNING: the torrent is healthy and a
        // tracker merely said something. Painting it with the red error icon
        // and an "Error:" prefix made it indistinguishable from a real
        // tracker/local error (codes 2/3).
        if (self.errorCode === 1) {
          return self.errorString;
        }
        if (self.errorCode > 1) {
          let errorString = self.errorString;
          if (/^Error: /.test(errorString)) {
            errorString = errorString.substring(7);
          }
          if (errorString) {
            return chrome.i18n.getMessage('OV_FL_ERROR') + ': ' + errorString;
          }
          return chrome.i18n.getMessage('OV_FL_ERROR');
        }
        return '';
      },
      /** True only for real errors (2/3), not for a tracker warning (1) */
      get hasError(): boolean {
        return self.errorCode > 1;
      },
      get selected(): boolean {
        const rootStore = getRoot<{
          torrentList: { _selectedIdsSet: Set<number> };
        }>(self);
        return rootStore.torrentList._selectedIdsSet.has(self.id);
      },
      get isStopped(): boolean {
        return self.statusCode === 0;
      },
      get isQueuedToCheckFiles(): boolean {
        return self.statusCode === 1;
      },
      get isChecking(): boolean {
        return self.statusCode === 2;
      },
      get isQueuedToDownload(): boolean {
        return self.statusCode === 3;
      },
      get isDownloading(): boolean {
        return self.statusCode === 4;
      },
      get isQueuedToSeed(): boolean {
        return self.statusCode === 5;
      },
      get isSeeding(): boolean {
        return self.statusCode === 6;
      },
      get actions(): string[] {
        const actions: string[] = [];

        if (!this.isChecking) {
          actions.push('recheck');
        }

        if (this.isStopped) {
          actions.push('start');
        } else {
          actions.push('stop');
        }

        if (
          this.isStopped ||
          this.isQueuedToCheckFiles ||
          this.isQueuedToDownload ||
          this.isQueuedToSeed
        ) {
          actions.push('forcestart');
        }

        return actions;
      },
      get isActive(): boolean {
        return !!(self.downloadSpeed || self.uploadSpeed);
      },
      get labelsStr(): string {
        return (self as unknown as { labels: string[] }).labels.join(', ');
      },
      get bandwidthPriorityStr(): string {
        switch (self.bandwidthPriority) {
          case -1:
            return chrome.i18n.getMessage('MF_LOW');
          case 1:
            return chrome.i18n.getMessage('MF_HIGH');
          default:
            return chrome.i18n.getMessage('MF_NORMAL');
        }
      },
      get hash(): string | null {
        if (self.hashString) return self.hashString.toUpperCase();
        if (!self.magnetLink) return null;
        const match = self.magnetLink.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
        return match ? match[1].toUpperCase() : null;
      },
    };
  });

export type ITorrentStore = Instance<typeof TorrentStore>;
export default TorrentStore;
