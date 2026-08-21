import React, { useEffect, useState } from 'react';

/**
 * Number input that tolerates being emptied. A plain controlled number input
 * snapped back to '0' the moment the field was cleared (Number('') === 0),
 * which reads as "stop seeding immediately" once applied.
 */
const NumberField = ({
  value,
  min,
  step,
  onChange,
}: {
  value: number;
  min: string;
  step: string;
  onChange: (value: number) => void;
}) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '') {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }
      }}
      onBlur={(e) => {
        if (e.target.value === '') {
          setText(String(value));
        }
      }}
    />
  );
};

interface TorrentDetailsSeedLimitsTabProps {
  detailsLoading: boolean;
  hasDetails: boolean;
  seedRatioMode: number;
  onSeedRatioModeChange: (mode: number) => void;
  seedRatioLimit: number;
  onSeedRatioLimitChange: (limit: number) => void;
  seedIdleMode: number;
  onSeedIdleModeChange: (mode: number) => void;
  seedIdleLimit: number;
  onSeedIdleLimitChange: (limit: number) => void;
  onApplySeedLimits: () => void;
  seedSaving: boolean;
}

const TorrentDetailsSeedLimitsTab = ({
  detailsLoading,
  hasDetails,
  seedRatioMode,
  onSeedRatioModeChange,
  seedRatioLimit,
  onSeedRatioLimitChange,
  seedIdleMode,
  onSeedIdleModeChange,
  seedIdleLimit,
  onSeedIdleLimitChange,
  onApplySeedLimits,
  seedSaving,
}: TorrentDetailsSeedLimitsTabProps) => (
  <div className="seed-limits-scroll">
    {hasDetails ? (
      <div className="seed-limits-form">
        <div className="seed-limit-row">
          <label>{chrome.i18n.getMessage('DT_SEED_RATIO_MODE')}</label>
          <select
            value={seedRatioMode}
            onChange={(e) => onSeedRatioModeChange(Number(e.target.value))}
          >
            <option value={0}>{chrome.i18n.getMessage('DT_USE_GLOBAL')}</option>
            <option value={1}>{chrome.i18n.getMessage('DT_CUSTOM')}</option>
            <option value={2}>{chrome.i18n.getMessage('DT_UNLIMITED')}</option>
          </select>
        </div>

        {seedRatioMode === 1 && (
          <div className="seed-limit-row">
            <label>{chrome.i18n.getMessage('DT_SEED_RATIO_LIMIT')}</label>
            <NumberField
              min="0"
              step="0.1"
              value={seedRatioLimit}
              onChange={onSeedRatioLimitChange}
            />
          </div>
        )}

        <div className="seed-limit-row">
          <label>{chrome.i18n.getMessage('DT_SEED_IDLE_MODE')}</label>
          <select
            value={seedIdleMode}
            onChange={(e) => onSeedIdleModeChange(Number(e.target.value))}
          >
            <option value={0}>{chrome.i18n.getMessage('DT_USE_GLOBAL')}</option>
            <option value={1}>{chrome.i18n.getMessage('DT_CUSTOM')}</option>
            <option value={2}>{chrome.i18n.getMessage('DT_UNLIMITED')}</option>
          </select>
        </div>

        {seedIdleMode === 1 && (
          <div className="seed-limit-row">
            <label>{chrome.i18n.getMessage('DT_SEED_IDLE_LIMIT')}</label>
            <NumberField min="0" step="1" value={seedIdleLimit} onChange={onSeedIdleLimitChange} />
          </div>
        )}

        <div className="torrent-details-buttons">
          <button onClick={onApplySeedLimits} disabled={seedSaving}>
            {chrome.i18n.getMessage('DT_APPLY')}
          </button>
        </div>
      </div>
    ) : detailsLoading ? (
      <div className="torrent-details-peers-header">Loading...</div>
    ) : null}
  </div>
);

export default TorrentDetailsSeedLimitsTab;
