import React from 'react';
import type { TorrentDetailData } from '../../../bg/TorrentService';
import type { MouseEvent } from 'react';

interface ResizeHandleProps {
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
}

interface TorrentDetailsTrackersTabProps {
  details: TorrentDetailData | null;
  detailsLoading: boolean;
  trackerListText: string;
  onTrackerListChange: (text: string) => void;
  onApplyTrackers: () => void;
  trackerSaving: boolean;
  trackerWidths: Record<string, number>;
  getTrackerResizeProps: (key: string) => ResizeHandleProps;
  /** trackerList editing needs Transmission 4.0+ (rpc 17); read-only below that */
  canEditTrackers: boolean;
}

function trackerHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const TorrentDetailsTrackersTab = ({
  details,
  detailsLoading,
  trackerListText,
  onTrackerListChange,
  onApplyTrackers,
  trackerSaving,
  trackerWidths,
  getTrackerResizeProps,
  canEditTrackers,
}: TorrentDetailsTrackersTabProps) => (
  <div className="tracker-scroll">
    {details && details.trackerStats.length > 0 && (
      <table className="tracker-list-table">
        <colgroup>
          <col style={{ width: trackerWidths.url }} />
          <col style={{ width: trackerWidths.tier }} />
          <col style={{ width: trackerWidths.seeds }} />
          <col style={{ width: trackerWidths.peers }} />
          <col style={{ width: trackerWidths.status }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              <div>{chrome.i18n.getMessage('DT_TRACKER_URL')}</div>
              <div className="resize-el" {...getTrackerResizeProps('url')} />
            </th>
            <th>
              <div>{chrome.i18n.getMessage('DT_TRACKER_TIER')}</div>
              <div className="resize-el" {...getTrackerResizeProps('tier')} />
            </th>
            <th>
              <div>{chrome.i18n.getMessage('DT_TRACKER_SEEDS')}</div>
              <div className="resize-el" {...getTrackerResizeProps('seeds')} />
            </th>
            <th>
              <div>{chrome.i18n.getMessage('DT_TRACKER_PEERS')}</div>
              <div className="resize-el" {...getTrackerResizeProps('peers')} />
            </th>
            <th>
              <div>{chrome.i18n.getMessage('DT_TRACKER_STATUS')}</div>
              <div className="resize-el" {...getTrackerResizeProps('status')} />
            </th>
          </tr>
        </thead>
        <tbody>
          {details.trackerStats.map((ts) => (
            <tr key={ts.id} className={ts.isBackup ? 'tracker-backup' : ''}>
              <td title={ts.announce}>{trackerHostname(ts.announce)}</td>
              <td>{ts.tier}</td>
              <td>{ts.seederCount >= 0 ? ts.seederCount : '-'}</td>
              <td>{ts.leecherCount >= 0 ? ts.leecherCount : '-'}</td>
              <td>{ts.lastAnnounceResult || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    {detailsLoading && !details && <div className="torrent-details-peers-header">Loading...</div>}

    {details && canEditTrackers && (
      <div className="tracker-list-edit">
        <label>{chrome.i18n.getMessage('DT_TRACKER_LIST')}</label>
        <div className="tracker-list-help">{chrome.i18n.getMessage('DT_TRACKER_LIST_HELP')}</div>
        <textarea
          className="tracker-list-textarea"
          value={trackerListText}
          onChange={(e) => onTrackerListChange(e.target.value)}
        />
        <div className="torrent-details-buttons">
          <button onClick={onApplyTrackers} disabled={trackerSaving}>
            {chrome.i18n.getMessage('DT_APPLY')}
          </button>
        </div>
      </div>
    )}
  </div>
);

export default TorrentDetailsTrackersTab;
