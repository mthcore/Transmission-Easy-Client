import type { NormalizedTorrent } from './TorrentService';

/**
 * One torrent as the daemon reports it, turned into the shape the stores
 * hold. Pure: it reads no connection, no configuration and no clock, which
 * is why it lives beside the service rather than inside it — the service
 * owns the daemon connection and the poll loop, and this is neither.
 *
 * Every cast here is a claim about the daemon's reply. They are concentrated
 * in one file so that a field Transmission renames is one place to fix, and
 * so the mapping can be exercised without a transport.
 */
export function normalizeTorrent(torrent: Record<string, unknown>): NormalizedTorrent {
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
}
