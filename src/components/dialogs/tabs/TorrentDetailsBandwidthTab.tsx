import React from 'react';
import NumberField from './NumberField';
import { KILOBYTES_PER_SECOND } from '../../../tools/format';

/**
 * Per-torrent bandwidth overrides.
 *
 * The daemon keeps a limit's value separately from whether it applies, so the
 * value stays in the field while the limit is off — turning a limit back on
 * restores the number the user set rather than zero. That is why each row is a
 * checkbox plus a field rather than a single "0 means unlimited" input.
 *
 * Everything applies in one request, like the seed limits tab: enabling a
 * limit and choosing its value are one edit.
 */
export interface BandwidthTabValues {
  honorsSessionLimits: boolean;
  downloadLimited: boolean;
  downloadLimit: number;
  uploadLimited: boolean;
  uploadLimit: number;
  peerLimit: number;
}

interface TorrentDetailsBandwidthTabProps {
  detailsLoading: boolean;
  hasDetails: boolean;
  values: BandwidthTabValues;
  onChange: (patch: Partial<BandwidthTabValues>) => void;
  onApply: () => void;
  saving: boolean;
}

const TorrentDetailsBandwidthTab = ({
  detailsLoading,
  hasDetails,
  values,
  onChange,
  onApply,
  saving,
}: TorrentDetailsBandwidthTabProps) => (
  <div className="seed-limits-scroll">
    {hasDetails ? (
      <div className="seed-limits-form">
        <div className="seed-limit-row">
          <label>
            <input
              type="checkbox"
              checked={values.honorsSessionLimits}
              onChange={(e) => onChange({ honorsSessionLimits: e.target.checked })}
            />
            {chrome.i18n.getMessage('DT_HONORS_SESSION_LIMITS')}
          </label>
        </div>

        <div className="seed-limit-row">
          <label>
            <input
              type="checkbox"
              checked={values.downloadLimited}
              onChange={(e) => onChange({ downloadLimited: e.target.checked })}
            />
            {chrome.i18n.getMessage('DT_DOWNLOAD_LIMIT')} ({KILOBYTES_PER_SECOND})
          </label>
          <NumberField
            min="0"
            step="1"
            value={values.downloadLimit}
            onChange={(downloadLimit) => onChange({ downloadLimit })}
          />
        </div>

        <div className="seed-limit-row">
          <label>
            <input
              type="checkbox"
              checked={values.uploadLimited}
              onChange={(e) => onChange({ uploadLimited: e.target.checked })}
            />
            {chrome.i18n.getMessage('DT_UPLOAD_LIMIT')} ({KILOBYTES_PER_SECOND})
          </label>
          <NumberField
            min="0"
            step="1"
            value={values.uploadLimit}
            onChange={(uploadLimit) => onChange({ uploadLimit })}
          />
        </div>

        <div className="seed-limit-row">
          <label>{chrome.i18n.getMessage('DT_PEER_LIMIT')}</label>
          <NumberField
            min="1"
            step="1"
            value={values.peerLimit}
            onChange={(peerLimit) => onChange({ peerLimit })}
          />
        </div>

        <div className="torrent-details-buttons">
          <button onClick={onApply} disabled={saving}>
            {chrome.i18n.getMessage('DT_APPLY')}
          </button>
        </div>
      </div>
    ) : detailsLoading ? (
      <div className="torrent-details-peers-header">Loading...</div>
    ) : null}
  </div>
);

export default TorrentDetailsBandwidthTab;
