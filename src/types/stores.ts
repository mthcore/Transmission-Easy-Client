/**
 * MobX-State-Tree Store Types
 */

// Torrent store snapshot (data format)
export interface TorrentSnapshot {
  id: number;
  statusCode: number;
  errorCode: number;
  errorString: string;
  name: string;
  size: number;
  sizeWhenDone?: number;
  percentDone: number;
  recheckProgress: number;
  downloaded: number;
  uploaded: number;
  shared: number;
  uploadSpeed: number;
  downloadSpeed: number;
  eta: number;
  etaIdle?: number;
  activePeers: number;
  peers: number;
  activeSeeds: number;
  seeds: number;
  order?: number;
  addedTime: number;
  completedTime: number;
  activityDate?: number;
  startDate?: number;
  editDate?: number;
  directory?: string;
  magnetLink?: string;
  hashString?: string;
  isStalled?: boolean;
  isPrivate?: boolean;
  isFinished?: boolean;
  metadataPercentComplete?: number;
  peersConnected?: number;
  labels?: string[];
  bandwidthPriority?: number;
  sequentialDownload?: boolean;
}

// Torrent store views (computed properties)
export interface TorrentViews {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly remaining: number;
  readonly remainingStr: string;
  readonly isCompleted: boolean;
  readonly sizeStr: string;
  readonly sizeWhenDoneStr: string;
  readonly progress: number;
  readonly progressStr: string;
  readonly recheckProgressStr: string;
  readonly uploadSpeedStr: string;
  readonly downloadSpeedStr: string;
  readonly etaStr: string;
  readonly etaIdleStr: string;
  readonly metadataStatusStr: string;
  readonly uploadedStr: string;
  readonly sharedStr: string;
  readonly downloadedStr: string;
  readonly addedTimeStr: string;
  readonly completedTimeStr: string;
  readonly activityDateStr: string;
  readonly startDateStr: string;
  readonly editDateStr: string;
  readonly stateText: string;
  readonly errorMessage: string;
  readonly selected: boolean;
  readonly isStopped: boolean;
  readonly isQueuedToCheckFiles: boolean;
  readonly isChecking: boolean;
  readonly isQueuedToDownload: boolean;
  readonly isDownloading: boolean;
  readonly isQueuedToSeed: boolean;
  readonly isSeeding: boolean;
  readonly actions: string[];
  readonly isActive: boolean;
  readonly labelsStr: string;
  readonly bandwidthPriorityStr: string;
  readonly hash: string | null;
}

// Combined Torrent type (snapshot + views)
export type Torrent = TorrentSnapshot & TorrentViews;

// File store snapshot
export interface FileSnapshot {
  name: string;
  shortName: string;
  size: number;
  downloaded: number;
  priority: number;
}

// File store views
export interface FileViews {
  readonly progress: number;
  readonly progressStr: string;
  readonly sizeStr: string;
  readonly downloadedStr: string;
  readonly priorityStr: string;
  readonly selected: boolean;
  readonly nameParts: string[];
  readonly normalizedName: string;
}

// Combined File type (named FileEntry to avoid collision with DOM File)
export type FileEntry = FileSnapshot & FileViews;

// Column configuration
export interface ColumnConfig {
  column: string;
  display: number; // 1 = visible, 0 = hidden
  order: number;
  width: number;
}
