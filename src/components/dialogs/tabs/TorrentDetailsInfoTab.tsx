import React from 'react';
import { speedToStr, formatBytes } from '../../../tools/format';
import { SPEED_LIMIT_UNIT } from '../../../stores/ClientStore';
import type { PeerData, TorrentDetailData } from '../../../bg/TorrentService';
import type { MouseEvent } from 'react';

interface ResizeHandleProps {
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
}

interface Torrent {
  sizeStr: string;
  sizeWhenDoneStr: string;
  progressStr: string;
  downloadedStr: string;
  uploadedStr: string;
  downloaded: number;
  uploaded: number;
  activeSeeds: number;
  seeds: number;
  activePeers: number;
  peers: number;
  downloadSpeedStr: string;
  uploadSpeedStr: string;
  etaStr: string;
  etaIdleStr: string;
  stateText: string;
  addedTimeStr: string;
  completedTimeStr: string;
  activityDateStr: string;
  startDateStr: string;
  directory?: string;
  errorMessage?: string;
  hash?: string | null;
  peersConnected?: number;
  isPrivate?: boolean;
  size: number;
  sizeWhenDone?: number;
}

interface TorrentDetailsInfoTabProps {
  torrent: Torrent;
  details: TorrentDetailData | null;
  detailsLoading: boolean;
  peers: PeerData[];
  peersLoading: boolean;
  peerWidths: Record<string, number>;
  getPeerResizeProps: (key: string) => ResizeHandleProps;
}

// Same locale-provided unit suffixes ([w, d, h, m, s]) as getEta, so the
// durations here match the ETA row instead of hardcoding English units.
// Guarded: this runs at IMPORT time, and getMessage returns '' for a missing
// key — JSON.parse('') would throw before the module ever rendered. A short
// array from a translator is filled out rather than indexed past its end.
const DEFAULT_TIME_UNITS = ['w', 'd', 'h', 'm', 's'];
const timeUnits: string[] = (() => {
  try {
    const parsed: unknown = JSON.parse(chrome.i18n.getMessage('timeOutList'));
    if (!Array.isArray(parsed)) return DEFAULT_TIME_UNITS;
    return DEFAULT_TIME_UNITS.map((fallback, index) =>
      typeof parsed[index] === 'string' ? (parsed[index] as string) : fallback
    );
  } catch {
    return DEFAULT_TIME_UNITS;
  }
})();

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}${timeUnits[1]}`);
  if (h > 0) parts.push(`${h}${timeUnits[2]}`);
  if (m > 0) parts.push(`${m}${timeUnits[3]}`);
  return parts.length > 0 ? parts.join(' ') : `< 1${timeUnits[3]}`;
}

function formatDate(timestamp: number): string {
  if (timestamp <= 0) return '-';
  return new Date(timestamp * 1000).toLocaleDateString();
}

const TorrentDetailsInfoTab = ({
  torrent,
  details,
  detailsLoading,
  peers,
  peersLoading,
  peerWidths,
  getPeerResizeProps,
}: TorrentDetailsInfoTabProps) => {
  const ratio =
    torrent.downloaded > 0
      ? (torrent.uploaded / torrent.downloaded).toFixed(3)
      : torrent.uploaded > 0
        ? '∞'
        : '0.000';

  // The list only carries seeds/peers while the Seeds/Peers columns are shown
  // — trackerStats is far too heavy to poll otherwise — so with the default
  // column set this dialog rendered "N / 0". The details request always asks
  // for trackerStats, which makes it the reliable source here. Same rule as
  // normalizeTorrent: every tracker scrapes the SAME swarm, so take the max.
  const swarm = details?.trackerStats?.length
    ? details.trackerStats.reduce(
        (acc, tracker) => ({
          seeds: Math.max(acc.seeds, tracker.seederCount),
          peers: Math.max(acc.peers, tracker.leecherCount),
        }),
        { seeds: 0, peers: 0 }
      )
    : { seeds: torrent.seeds, peers: torrent.peers };

  const showEffectiveSize =
    torrent.sizeWhenDone != null &&
    torrent.sizeWhenDone > 0 &&
    torrent.sizeWhenDone !== torrent.size;

  return (
    <>
      <div className="torrent-details-grid">
        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_SIZE')}</label>
          <span>
            {torrent.sizeStr}
            {showEffectiveSize && (
              <span className="detail-secondary">
                {' '}
                ({chrome.i18n.getMessage('OV_COL_SIZE_WHEN_DONE')}: {torrent.sizeWhenDoneStr})
              </span>
            )}
          </span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_DONE')}</label>
          <span>{torrent.progressStr}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_DOWNLOADED')}</label>
          <span>{torrent.downloadedStr}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_UPPED')}</label>
          <span>{torrent.uploadedStr}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_SHARED')}</label>
          <span>{ratio}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_SEEDS')}</label>
          <span>
            {torrent.activeSeeds} / {swarm.seeds}
          </span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_PEERS')}</label>
          <span>
            {torrent.activePeers} / {swarm.peers}
            {torrent.peersConnected != null && ` (${torrent.peersConnected})`}
          </span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_DOWNSPD')}</label>
          <span>{torrent.downloadSpeedStr || '-'}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_UPSPD')}</label>
          <span>{torrent.uploadSpeedStr || '-'}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_ETA')}</label>
          <span>
            {torrent.etaStr}
            {torrent.etaIdleStr && (
              <span className="detail-secondary">
                {' '}
                ({chrome.i18n.getMessage('DT_ETA_IDLE')}: {torrent.etaIdleStr})
              </span>
            )}
          </span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_STATUS')}</label>
          <span>
            {torrent.stateText}
            {torrent.isPrivate && (
              <span className="torrent-badge private" title={chrome.i18n.getMessage('DT_PRIVATE')}>
                {chrome.i18n.getMessage('DT_PRIVATE')}
              </span>
            )}
          </span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_DATE_ADDED')}</label>
          <span>{torrent.addedTimeStr}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_DATE_COMPLETED')}</label>
          <span>{torrent.completedTimeStr}</span>
        </div>

        <div className="nf-subItem">
          <label>{chrome.i18n.getMessage('OV_COL_ACTIVITY')}</label>
          <span>{torrent.activityDateStr}</span>
        </div>

        {torrent.startDateStr !== '-' && (
          <div className="nf-subItem">
            <label>{chrome.i18n.getMessage('OV_COL_STARTED')}</label>
            <span>{torrent.startDateStr}</span>
          </div>
        )}

        {details && (
          <>
            {details.creator && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_CREATOR')}</label>
                <span>{details.creator}</span>
              </div>
            )}

            {details.dateCreated > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_DATE_CREATED')}</label>
                <span>{formatDate(details.dateCreated)}</span>
              </div>
            )}

            {details.pieceCount > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_PIECES')}</label>
                <span>
                  {details.pieceCount} × {formatBytes(details.pieceSize)}
                </span>
              </div>
            )}

            {details.fileCount !== undefined && details.fileCount > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('fileCount')}</label>
                <span>{details.fileCount}</span>
              </div>
            )}

            {details.primaryMimeType && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('primaryMimeType')}</label>
                <span>{details.primaryMimeType}</span>
              </div>
            )}

            {details.corruptEver > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_CORRUPT')}</label>
                <span>{formatBytes(details.corruptEver)}</span>
              </div>
            )}

            {details.secondsDownloading > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_TIME_DOWNLOADING')}</label>
                <span>{formatDuration(details.secondsDownloading)}</span>
              </div>
            )}

            {details.secondsSeeding > 0 && (
              <div className="nf-subItem">
                <label>{chrome.i18n.getMessage('DT_TIME_SEEDING')}</label>
                <span>{formatDuration(details.secondsSeeding)}</span>
              </div>
            )}

            {(details.downloadLimited || details.uploadLimited) && (
              <div className="nf-subItem torrent-details-full-width">
                <label>{chrome.i18n.getMessage('DT_DOWNLOAD_LIMIT')}</label>
                <span>
                  {details.downloadLimited
                    ? `${speedToStr(details.downloadLimit * SPEED_LIMIT_UNIT)}`
                    : chrome.i18n.getMessage('DT_DISABLED')}
                  {' / '}
                  {chrome.i18n.getMessage('DT_UPLOAD_LIMIT')}:{' '}
                  {details.uploadLimited
                    ? `${speedToStr(details.uploadLimit * SPEED_LIMIT_UNIT)}`
                    : chrome.i18n.getMessage('DT_DISABLED')}
                  {' — '}
                  {chrome.i18n.getMessage('DT_HONORS_SESSION_LIMITS')}:{' '}
                  {details.honorsSessionLimits
                    ? chrome.i18n.getMessage('DT_ENABLED')
                    : chrome.i18n.getMessage('DT_DISABLED')}
                </span>
              </div>
            )}

            {details.peersFrom &&
              (() => {
                const pf = details.peersFrom;
                const sources: string[] = [];
                if (pf.fromTracker > 0)
                  sources.push(
                    `${chrome.i18n.getMessage('DT_PEERS_FROM_TRACKER')}: ${pf.fromTracker}`
                  );
                if (pf.fromDht > 0)
                  sources.push(`${chrome.i18n.getMessage('DT_PEERS_FROM_DHT')}: ${pf.fromDht}`);
                if (pf.fromPex > 0)
                  sources.push(`${chrome.i18n.getMessage('DT_PEERS_FROM_PEX')}: ${pf.fromPex}`);
                if (pf.fromLpd > 0)
                  sources.push(`${chrome.i18n.getMessage('DT_PEERS_FROM_LPD')}: ${pf.fromLpd}`);
                if (pf.fromLtep > 0)
                  sources.push(`${chrome.i18n.getMessage('DT_PEERS_FROM_LTEP')}: ${pf.fromLtep}`);
                if (pf.fromIncoming > 0)
                  sources.push(
                    `${chrome.i18n.getMessage('DT_PEERS_FROM_INCOMING')}: ${pf.fromIncoming}`
                  );
                if (pf.fromCache > 0)
                  sources.push(`${chrome.i18n.getMessage('DT_PEERS_FROM_CACHE')}: ${pf.fromCache}`);
                if (sources.length === 0) return null;
                return (
                  <div className="nf-subItem torrent-details-full-width">
                    <label>{chrome.i18n.getMessage('DT_PEERS_FROM')}</label>
                    <span>{sources.join(' \u2022 ')}</span>
                  </div>
                );
              })()}

            {details.comment && (
              <div className="nf-subItem torrent-details-full-width">
                <label>{chrome.i18n.getMessage('DT_COMMENT')}</label>
                <span>{details.comment}</span>
              </div>
            )}

            {details.webseeds.length > 0 && (
              <div className="nf-subItem torrent-details-full-width">
                <label>{chrome.i18n.getMessage('DT_WEBSEEDS')}</label>
                <span>{details.webseeds.join(', ')}</span>
              </div>
            )}
          </>
        )}

        {torrent.hash && (
          <div className="nf-subItem torrent-details-full-width">
            <label>{chrome.i18n.getMessage('copyHash')}</label>
            <span className="torrent-details-path">{torrent.hash}</span>
          </div>
        )}

        {torrent.directory && (
          <div className="nf-subItem torrent-details-full-width">
            <label>{chrome.i18n.getMessage('path')}</label>
            <span className="torrent-details-path">{torrent.directory}</span>
          </div>
        )}

        {torrent.errorMessage && (
          <div className="nf-subItem torrent-details-full-width torrent-details-error">
            <label>{chrome.i18n.getMessage('OV_FL_ERROR')}</label>
            <span>{torrent.errorMessage}</span>
          </div>
        )}
      </div>

      {peers.length > 0 && (
        <div className="torrent-details-peers">
          <div className="torrent-details-peers-header">
            {chrome.i18n.getMessage('OV_COL_PEERS')} ({peers.length})
          </div>
          <div className="peer-list-scroll">
            <table className="peer-list-table">
              <colgroup>
                <col style={{ width: peerWidths.ip }} />
                <col style={{ width: peerWidths.client }} />
                <col style={{ width: peerWidths.pct }} />
                <col style={{ width: peerWidths.dl }} />
                <col style={{ width: peerWidths.ul }} />
                <col style={{ width: peerWidths.flags }} />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <div>{chrome.i18n.getMessage('PRS_COL_IP')}</div>
                    <div className="resize-el" {...getPeerResizeProps('ip')} />
                  </th>
                  <th>
                    <div>Client</div>
                    <div className="resize-el" {...getPeerResizeProps('client')} />
                  </th>
                  <th>
                    <div>%</div>
                    <div className="resize-el" {...getPeerResizeProps('pct')} />
                  </th>
                  <th>
                    <div>{chrome.i18n.getMessage('OV_COL_DOWNSPD')}</div>
                    <div className="resize-el" {...getPeerResizeProps('dl')} />
                  </th>
                  <th>
                    <div>{chrome.i18n.getMessage('OV_COL_UPSPD')}</div>
                    <div className="resize-el" {...getPeerResizeProps('ul')} />
                  </th>
                  <th>
                    <div>{chrome.i18n.getMessage('peerFlags')}</div>
                    <div className="resize-el" {...getPeerResizeProps('flags')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* address alone collides for two peers behind one NAT (the
                    RPC's address field is the bare IP), mixing their rows up */}
                {peers.map((peer, index) => (
                  <tr key={`${peer.address}-${index}`}>
                    <td title={peer.address}>{peer.address}</td>
                    <td title={peer.client}>{peer.client}</td>
                    <td>{(peer.progress * 100).toFixed(0)}%</td>
                    <td>{peer.downloadSpeed ? speedToStr(peer.downloadSpeed) : '-'}</td>
                    <td>{peer.uploadSpeed ? speedToStr(peer.uploadSpeed) : '-'}</td>
                    <td className="peer-flags" title={peer.flags}>
                      {peer.flags}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {peersLoading && peers.length === 0 && (
        <div className="torrent-details-peers">
          <div className="torrent-details-peers-header">
            {chrome.i18n.getMessage('OV_COL_PEERS')}...
          </div>
        </div>
      )}

      {detailsLoading && !details && (
        <div className="torrent-details-peers">
          <div className="torrent-details-peers-header">Loading...</div>
        </div>
      )}
    </>
  );
};

export default TorrentDetailsInfoTab;
