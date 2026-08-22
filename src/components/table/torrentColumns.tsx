import React, { ChangeEvent } from 'react';
import TorrentName from '../TorrentName';
import ProgressBar from '../ProgressBar';
import type { Torrent } from '../../types/stores';

export interface TorrentColumnCtx {
  torrent: Torrent;
  handleSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  handleStart: () => void;
  handleStop: () => void;
  isStarting: boolean;
  isStopping: boolean;
}

type ColumnRenderer = (ctx: TorrentColumnCtx, width: number) => React.ReactNode;

const torrentColumnRenderers: Record<string, ColumnRenderer> = {
  checkbox: ({ torrent, handleSelect }) => (
    <td key="checkbox" className="checkbox">
      <input
        checked={torrent.selected}
        onChange={handleSelect}
        type="checkbox"
        aria-label={torrent.name}
      />
    </td>
  ),

  name: ({ torrent }, width) => {
    // Build a rich tooltip with key torrent info
    const tipLines: string[] = [torrent.name];
    if (torrent.isPrivate) {
      tipLines.push(`[${chrome.i18n.getMessage('DT_PRIVATE')}]`);
    }
    if (torrent.directory) {
      tipLines.push(torrent.directory);
    }
    if (torrent.hash) {
      tipLines.push(torrent.hash);
    }
    if (torrent.sizeWhenDoneStr && torrent.sizeWhenDoneStr !== torrent.sizeStr) {
      tipLines.push(
        `${chrome.i18n.getMessage('OV_COL_SIZE_WHEN_DONE')}: ${torrent.sizeWhenDoneStr}`
      );
    }
    const title = tipLines.join('\n');

    // Only show badge for metadata loading (transient important state)
    let metaBadge: React.ReactNode = null;
    if (torrent.metadataPercentComplete != null && torrent.metadataPercentComplete < 1) {
      metaBadge = (
        <span
          className="torrent-badge metadata"
          title={`${chrome.i18n.getMessage('DT_METADATA')} ${(torrent.metadataPercentComplete * 100).toFixed(0)}%`}
        >
          M
        </span>
      );
    }
    return (
      <td key="name" className="name">
        {metaBadge}
        <TorrentName name={torrent.name} width={width - (metaBadge ? 18 : 0)} title={title} />
      </td>
    );
  },

  order: ({ torrent }) => {
    let value: number | string = torrent.order ?? 0;
    if (!Number.isFinite(value)) {
      value = '*';
    }
    return (
      <td key="order" className="order">
        <div>{value}</div>
      </td>
    );
  },

  size: ({ torrent }) => {
    const sizeWhenDone = torrent.sizeWhenDoneStr;
    const title =
      sizeWhenDone !== torrent.sizeStr
        ? `${torrent.sizeStr} (${chrome.i18n.getMessage('OV_COL_SIZE_WHEN_DONE')}: ${sizeWhenDone})`
        : torrent.sizeStr;
    return (
      <td key="size" className="size">
        <div title={title}>{torrent.sizeStr}</div>
      </td>
    );
  },

  sizeWhenDone: ({ torrent }) => (
    <td key="sizeWhenDone" className="sizeWhenDone">
      <div title={torrent.sizeWhenDoneStr}>{torrent.sizeWhenDoneStr}</div>
    </td>
  ),

  remaining: ({ torrent }) => (
    <td key="remaining" className="remaining">
      <div>{torrent.remainingStr}</div>
    </td>
  ),

  done: ({ torrent }) => {
    const progressClass = torrent.isSeeding ? 'seeding' : 'downloading';
    return (
      <td key="done" className="done">
        <ProgressBar progressStr={torrent.progressStr} progressClass={progressClass} />
      </td>
    );
  },

  status: ({ torrent }) => {
    let errorIcon: React.ReactNode = null;
    const errorMessage = torrent.errorMessage;
    // A tracker warning (errorCode 1) still shows its text in the tooltip via
    // errorMessage, but only real errors get the red icon
    if (errorMessage && torrent.hasError) {
      errorIcon = (
        <i className="error_icon" title={errorMessage} role="img" aria-label={errorMessage} />
      );
    }
    return (
      <td key="status" className="status">
        <div title={torrent.stateText}>
          {errorIcon}
          {torrent.stateText}
        </div>
      </td>
    );
  },

  seeds: ({ torrent }) => (
    <td key="seeds" className="seeds">
      <div>{torrent.seeds}</div>
    </td>
  ),

  peers: ({ torrent }) => (
    <td key="peers" className="peers">
      <div>{torrent.peers}</div>
    </td>
  ),

  seeds_peers: ({ torrent }) => (
    <td key="seeds_peers" className="seeds_peers">
      <div>
        {torrent.activeSeeds} / {torrent.activePeers}
      </div>
    </td>
  ),

  downspd: ({ torrent }) => (
    <td key="downspd" className="downspd">
      <div>{torrent.downloadSpeedStr}</div>
    </td>
  ),

  upspd: ({ torrent }) => (
    <td key="upspd" className="upspd">
      <div>{torrent.uploadSpeedStr}</div>
    </td>
  ),

  eta: ({ torrent }) => {
    const etaIdleStr = torrent.etaIdleStr;
    const title = etaIdleStr
      ? `${torrent.etaStr} (${chrome.i18n.getMessage('DT_ETA_IDLE')}: ${etaIdleStr})`
      : torrent.etaStr;
    return (
      <td key="eta" className="eta">
        <div title={title}>{torrent.etaStr}</div>
      </td>
    );
  },

  upped: ({ torrent }) => (
    <td key="upped" className="upped">
      <div>{torrent.uploadedStr}</div>
    </td>
  ),

  downloaded: ({ torrent }) => (
    <td key="downloaded" className="downloaded">
      <div>{torrent.downloadedStr}</div>
    </td>
  ),

  shared: ({ torrent }) => (
    <td key="shared" className="shared">
      <div>{torrent.sharedStr}</div>
    </td>
  ),

  added: ({ torrent }) => (
    <td key="added" className="added">
      <div title={torrent.addedTimeStr}>{torrent.addedTimeStr}</div>
    </td>
  ),

  completed: ({ torrent }) => (
    <td key="completed" className="completed">
      <div title={torrent.completedTimeStr}>{torrent.completedTimeStr}</div>
    </td>
  ),

  label: ({ torrent }) => (
    <td key="label" className="label">
      <div title={torrent.labelsStr}>{torrent.labelsStr}</div>
    </td>
  ),

  priority: ({ torrent }) => (
    <td key="priority" className="priority">
      <div title={torrent.bandwidthPriorityStr}>{torrent.bandwidthPriorityStr}</div>
    </td>
  ),

  activity: ({ torrent }) => (
    <td key="activity" className="activity">
      <div title={torrent.activityDateStr}>{torrent.activityDateStr}</div>
    </td>
  ),

  started: ({ torrent }) => (
    <td key="started" className="started">
      <div title={torrent.startDateStr}>{torrent.startDateStr}</div>
    </td>
  ),

  edited: ({ torrent }) => (
    <td key="edited" className="edited">
      <div title={torrent.editDateStr}>{torrent.editDateStr}</div>
    </td>
  ),

  actions: ({ handleStart, handleStop, isStarting, isStopping }) => (
    <td key="actions" className="actions">
      <div className="btns">
        <button
          onClick={handleStart}
          title={chrome.i18n.getMessage('ML_START')}
          aria-label={chrome.i18n.getMessage('ML_START')}
          className={`start${isStarting ? ' btn-loading' : ''}`}
          type="button"
          disabled={isStarting}
        />
        <button
          onClick={handleStop}
          title={chrome.i18n.getMessage('ML_STOP')}
          aria-label={chrome.i18n.getMessage('ML_STOP')}
          className={`stop${isStopping ? ' btn-loading' : ''}`}
          type="button"
          disabled={isStopping}
        />
      </div>
    </td>
  ),
};

export default torrentColumnRenderers;
