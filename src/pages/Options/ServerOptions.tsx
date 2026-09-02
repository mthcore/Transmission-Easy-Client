import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import BandwidthGroups from './BandwidthGroups';

const ALT_SPEED_DAYS = [
  { bit: 1, key: 'daySunday' },
  { bit: 2, key: 'dayMonday' },
  { bit: 4, key: 'dayTuesday' },
  { bit: 8, key: 'dayWednesday' },
  { bit: 16, key: 'dayThursday' },
  { bit: 32, key: 'dayFriday' },
  { bit: 64, key: 'daySaturday' },
] as const;

const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const ServerOptions = observer(() => {
  const rootStore = useRootStore();
  const client = rootStore.client;
  const settings = client?.settings ?? null;
  const [url, setUrl] = useState('');
  const [urlLoaded, setUrlLoaded] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [incompleteDir, setIncompleteDirInput] = useState('');
  const [incompleteDirLoaded, setIncompleteDirLoaded] = useState<string | null>(null);
  const [scriptFilename, setScriptFilenameInput] = useState('');
  const [scriptFilenameLoaded, setScriptFilenameLoaded] = useState<string | null>(null);
  const [scriptAddedFilename, setScriptAddedFilenameInput] = useState('');
  const [scriptAddedFilenameLoaded, setScriptAddedFilenameLoaded] = useState<string | null>(null);
  const [scriptDoneSeedingFilename, setScriptDoneSeedingFilenameInput] = useState('');
  const [scriptDoneSeedingFilenameLoaded, setScriptDoneSeedingFilenameLoaded] = useState<
    string | null
  >(null);
  const [portTestResult, setPortTestResult] = useState<boolean | null>(null);
  const [portTesting, setPortTesting] = useState(false);

  const [actionError, setActionError] = useState('');
  const pendingToggles = useRef(new Map<unknown, boolean>());

  // Every daemon mutation on this page used to fail silently: the error only
  // went to ClientStore.lastErrorMessage, which no options component renders.
  const runAction = useCallback((promise: Promise<unknown> | undefined) => {
    setActionError('');
    Promise.resolve(promise).catch((err: Error) => {
      setActionError(`${err.name}: ${err.message || 'Unknown error'}`);
    });
  }, []);

  const fetchSettings = useCallback(() => {
    if (!client) return;
    setLoading(true);
    setError(false);
    client.updateSettings().then(
      () => setLoading(false),
      () => {
        setLoading(false);
        setError(true);
      }
    );
  }, [client]);

  // Always refresh on mount: the background mirror can hold settings fetched
  // long ago (or changed since from another client), and this page has no
  // polling loop, so it used to display frozen values whenever the service
  // worker happened to be warm.
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // All hooks below must run unconditionally on every render — the actual
  // "not ready yet" branching happens only in the JSX at the very end, so the
  // hook count never differs between the loading and loaded renders (a
  // mismatch there is what "Rendered fewer hooks than expected" means).

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  }, []);

  const handleApplyUrl = useCallback(() => {
    runAction(client?.setBlocklistUrl(url));
  }, [client, url, runAction]);

  const handleUpdate = useCallback(() => {
    if (!client) return;
    setUpdating(true);
    runAction(client.blocklistUpdate().finally(() => setUpdating(false)));
  }, [client, runAction]);

  const handleEncryptionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      runAction(client?.setEncryption(e.target.value));
    },
    [client, runAction]
  );

  const handleIncompleteDirChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIncompleteDirInput(e.target.value);
  }, []);

  const handleApplyIncompleteDir = useCallback(() => {
    runAction(client?.setIncompleteDir(incompleteDir));
  }, [client, incompleteDir, runAction]);

  const handleScriptFilenameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScriptFilenameInput(e.target.value);
  }, []);

  const handleApplyScriptFilename = useCallback(() => {
    runAction(client?.setScriptTorrentDoneFilename(scriptFilename));
  }, [client, scriptFilename, runAction]);

  const handleScriptAddedFilenameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScriptAddedFilenameInput(e.target.value);
  }, []);

  const handleApplyScriptAddedFilename = useCallback(() => {
    runAction(client?.setScriptTorrentAddedFilename(scriptAddedFilename));
  }, [client, scriptAddedFilename, runAction]);

  const handleScriptDoneSeedingFilenameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setScriptDoneSeedingFilenameInput(e.target.value);
    },
    []
  );

  const handleApplyScriptDoneSeedingFilename = useCallback(() => {
    runAction(client?.setScriptTorrentDoneSeedingFilename(scriptDoneSeedingFilename));
  }, [client, scriptDoneSeedingFilename, runAction]);

  const handlePortTest = useCallback(() => {
    if (!client) return;
    setPortTesting(true);
    setPortTestResult(null);
    setActionError('');
    client.portTest().then(
      (isOpen) => {
        setPortTestResult(isOpen);
        setPortTesting(false);
      },
      (err: Error) => {
        // A failed check is NOT a closed port: reporting it as one sent users
        // debugging their router for a request that never ran
        setPortTestResult(null);
        setActionError(`${err.name}: ${err.message}`);
        setPortTesting(false);
      }
    );
  }, [client]);

  // The daemon's bitfield only reaches us after a full session-set/get round
  // trip, so XOR-ing against the mirror lost days when several were clicked in
  // a row. Track the pending value locally and apply successive toggles to it.
  const pendingDayRef = useRef<number | null>(null);
  useEffect(() => {
    // Only clear once the daemon actually reports the pending value, or a
    // toggle still in flight would be recomputed from the stale mirror
    if (pendingDayRef.current === settings?.altSpeedTimeDay) {
      pendingDayRef.current = null;
    }
  }, [settings?.altSpeedTimeDay]);

  const handleDayToggle = useCallback(
    (dayBit: number) => () => {
      if (!settings || !client) return;
      const base = pendingDayRef.current ?? settings.altSpeedTimeDay;
      const next = base ^ dayBit;
      pendingDayRef.current = next;
      Promise.resolve(client.setAltSpeedTimeDay(next)).catch((err: Error) => {
        // A failed toggle must not stay latched, or it would silently ride
        // along with the next successful one
        if (pendingDayRef.current === next) {
          pendingDayRef.current = null;
        }
        setActionError(`${err.name}: ${err.message || 'Unknown error'}`);
      });
      setActionError('');
    },
    [client, settings]
  );

  if (!client || !settings) {
    return (
      <div className="page server">
        <h2>{chrome.i18n.getMessage('optServer')}</h2>
        {loading && <div className="loading-inline" />}
        {error && (
          <div>
            <p>{chrome.i18n.getMessage('checkSettings')}</p>
            <button type="button" onClick={fetchSettings}>
              {chrome.i18n.getMessage('errorRetry')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Re-seed each text field whenever its STORE value moves (daemon echo, the
  // mount-time refresh, an external client's change) — not merely once. The
  // old one-shot latches froze these fields on whatever the pre-refresh mirror
  // held for the rest of the session. In-progress typing is preserved: local
  // state only resets when the store value itself changes.
  if (urlLoaded !== settings.blocklistUrl) {
    setUrl(settings.blocklistUrl);
    setUrlLoaded(settings.blocklistUrl);
  }

  if (incompleteDirLoaded !== settings.incompleteDir) {
    setIncompleteDirInput(settings.incompleteDir);
    setIncompleteDirLoaded(settings.incompleteDir);
  }

  if (scriptFilenameLoaded !== settings.scriptTorrentDoneFilename) {
    setScriptFilenameInput(settings.scriptTorrentDoneFilename);
    setScriptFilenameLoaded(settings.scriptTorrentDoneFilename);
  }

  if (scriptAddedFilenameLoaded !== (settings.scriptTorrentAddedFilename || '')) {
    setScriptAddedFilenameInput(settings.scriptTorrentAddedFilename || '');
    setScriptAddedFilenameLoaded(settings.scriptTorrentAddedFilename || '');
  }

  if (scriptDoneSeedingFilenameLoaded !== (settings.scriptTorrentDoneSeedingFilename || '')) {
    setScriptDoneSeedingFilenameInput(settings.scriptTorrentDoneSeedingFilename || '');
    setScriptDoneSeedingFilenameLoaded(settings.scriptTorrentDoneSeedingFilename || '');
  }

  const handleToggle = (setter: (enabled: boolean) => Promise<unknown>, current: boolean) => () => {
    // Latch on the setter: a quick off-then-on double click read the SAME
    // stale render-time value twice and sent the same state twice, so the
    // second click didn't undo the first
    const pending = pendingToggles.current.get(setter);
    const next = !(pending ?? current);
    pendingToggles.current.set(setter, next);
    runAction(
      setter(next).finally(() => {
        pendingToggles.current.delete(setter);
      })
    );
  };

  /** Clamp to the input's own min/max — typed values bypass those attributes */
  const clampToInput = (value: number, input: HTMLInputElement): number => {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    let result = value;
    if (Number.isFinite(min) && result < min) result = min;
    if (Number.isFinite(max) && result > max) result = max;
    return result;
  };

  const handleNumberBlur =
    (setter: (value: number) => Promise<unknown>) => (e: React.FocusEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      // 0 is a legitimate value (e.g. "stop seeding immediately"); requiring
      // > 0 silently dropped it
      if (Number.isFinite(val)) {
        const clamped = clampToInput(val, e.target);
        // Show what was actually sent: the field kept displaying the raw
        // typed value while the daemon received the clamped one
        e.target.value = String(clamped);
        runAction(setter(clamped));
      } else {
        // Cleared or unparsable: no branch ran at all, so the field stayed
        // blank for the rest of the session (it is uncontrolled, and the key
        // prop doesn't change, so nothing remounts it)
        e.target.value = e.target.defaultValue;
      }
    };

  const handleIntBlur =
    (setter: (value: number) => Promise<unknown>) => (e: React.FocusEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (Number.isFinite(val)) {
        const clamped = clampToInput(val, e.target);
        e.target.value = String(clamped);
        runAction(setter(clamped));
      } else {
        e.target.value = e.target.defaultValue;
      }
    };

  const handleTimeChange =
    (setter: (minutes: number) => Promise<unknown>) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const [h, m] = e.target.value.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        runAction(setter(h * 60 + m));
      }
    };

  return (
    <div className="page server">
      <h2>{chrome.i18n.getMessage('optServer')}</h2>

      {settings.daemonVersionStr && <p className="daemon-version">{settings.daemonVersionStr}</p>}

      {actionError && <p className="red">{actionError}</p>}

      {/* The mount-time refresh failed but the mirror held cached settings:
          without this banner the form rendered stale data with nothing saying
          the daemon was never reached */}
      {error && !loading && (
        <p className="red">
          {chrome.i18n.getMessage('checkSettings')}{' '}
          <button type="button" onClick={fetchSettings}>
            {chrome.i18n.getMessage('errorRetry')}
          </button>
        </p>
      )}

      <h3>{chrome.i18n.getMessage('generalSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('startAddedTorrents')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setStartAddedTorrents, settings.startAddedTorrents)}
            type="checkbox"
            checked={settings.startAddedTorrents}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('trashOriginalTorrentFiles')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              client.setTrashOriginalTorrentFiles,
              settings.trashOriginalTorrentFiles
            )}
            type="checkbox"
            checked={settings.trashOriginalTorrentFiles}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <h3>{chrome.i18n.getMessage('peerSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('peerLimitGlobal')}</span>
        <input
          type="number"
          min="1"
          key={`peerLimitGlobal-${settings.peerLimitGlobal}`}
          defaultValue={settings.peerLimitGlobal}
          onBlur={handleIntBlur(client.setPeerLimitGlobal)}
        />
      </label>

      <label>
        <span>{chrome.i18n.getMessage('peerLimitPerTorrent')}</span>
        <input
          type="number"
          min="1"
          key={`peerLimitPerTorrent-${settings.peerLimitPerTorrent}`}
          defaultValue={settings.peerLimitPerTorrent}
          onBlur={handleIntBlur(client.setPeerLimitPerTorrent)}
        />
      </label>

      <h3>{chrome.i18n.getMessage('seedingSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('seedRatioLimited')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setSeedRatioLimited, settings.seedRatioLimited)}
            type="checkbox"
            checked={settings.seedRatioLimited}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.seedRatioLimited && (
        <label>
          <span>{chrome.i18n.getMessage('seedRatioLimit')}</span>
          <input
            type="number"
            min="0"
            step="0.1"
            key={`seedRatioLimit-${settings.seedRatioLimit}`}
            defaultValue={settings.seedRatioLimit}
            onBlur={handleNumberBlur(client.setSeedRatioLimit)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('idleSeedingLimitEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              client.setIdleSeedingLimitEnabled,
              settings.idleSeedingLimitEnabled
            )}
            type="checkbox"
            checked={settings.idleSeedingLimitEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.idleSeedingLimitEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('idleSeedingLimit')}</span>
          <input
            type="number"
            min="1"
            key={`idleSeedingLimit-${settings.idleSeedingLimit}`}
            defaultValue={settings.idleSeedingLimit}
            onBlur={handleIntBlur(client.setIdleSeedingLimit)}
          />{' '}
          <span>{chrome.i18n.getMessage('minutes')}</span>
        </label>
      )}

      <h3>{chrome.i18n.getMessage('queueSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('downloadQueueEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setDownloadQueueEnabled, settings.downloadQueueEnabled)}
            type="checkbox"
            checked={settings.downloadQueueEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.downloadQueueEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('downloadQueueSize')}</span>
          <input
            type="number"
            min="1"
            key={`downloadQueueSize-${settings.downloadQueueSize}`}
            defaultValue={settings.downloadQueueSize}
            onBlur={handleIntBlur(client.setDownloadQueueSize)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('seedQueueEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setSeedQueueEnabled, settings.seedQueueEnabled)}
            type="checkbox"
            checked={settings.seedQueueEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.seedQueueEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('seedQueueSize')}</span>
          <input
            type="number"
            min="1"
            key={`seedQueueSize-${settings.seedQueueSize}`}
            defaultValue={settings.seedQueueSize}
            onBlur={handleIntBlur(client.setSeedQueueSize)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('queueStalledEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setQueueStalledEnabled, settings.queueStalledEnabled)}
            type="checkbox"
            checked={settings.queueStalledEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.queueStalledEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('queueStalledMinutes')}</span>
          <input
            type="number"
            min="1"
            key={`queueStalledMinutes-${settings.queueStalledMinutes}`}
            defaultValue={settings.queueStalledMinutes}
            onBlur={handleIntBlur(client.setQueueStalledMinutes)}
          />{' '}
          <span>{chrome.i18n.getMessage('minutes')}</span>
        </label>
      )}

      <h3>{chrome.i18n.getMessage('incompleteDirSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('incompleteDirEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setIncompleteDirEnabled, settings.incompleteDirEnabled)}
            type="checkbox"
            checked={settings.incompleteDirEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.incompleteDirEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('incompleteDir')}</span>
          <div className="blocklist-url-row">
            <input type="text" value={incompleteDir} onChange={handleIncompleteDirChange} />
            <button type="button" onClick={handleApplyIncompleteDir}>
              {chrome.i18n.getMessage('DLG_BTN_APPLY')}
            </button>
          </div>
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('renamePartialFiles')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setRenamePartialFiles, settings.renamePartialFiles)}
            type="checkbox"
            checked={settings.renamePartialFiles}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <h3>{chrome.i18n.getMessage('networkSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('peerPort')}</span>
        <input
          type="number"
          min="1"
          max="65535"
          key={`peerPort-${settings.peerPort}`}
          defaultValue={settings.peerPort}
          onBlur={handleIntBlur(client.setPeerPort)}
        />
      </label>

      <label>
        <span></span>
        <span>
          <button type="button" onClick={handlePortTest} disabled={portTesting}>
            {portTesting
              ? chrome.i18n.getMessage('portTesting')
              : chrome.i18n.getMessage('portTest')}
          </button>
          {portTestResult !== null && (
            <span className={portTestResult ? 'port-open' : 'port-closed'}>
              {' '}
              {/* Colour alone is not a status indicator */}
              <span aria-hidden="true">{portTestResult ? '✓' : '✗'}</span>{' '}
              {portTestResult
                ? chrome.i18n.getMessage('portOpen')
                : chrome.i18n.getMessage('portClosed')}
            </span>
          )}
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('portForwardingEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setPortForwardingEnabled, settings.portForwardingEnabled)}
            type="checkbox"
            checked={settings.portForwardingEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('encryption')}</span>
        <select value={settings.encryption} onChange={handleEncryptionChange}>
          <option value="required">{chrome.i18n.getMessage('encryptionRequired')}</option>
          <option value="preferred">{chrome.i18n.getMessage('encryptionPreferred')}</option>
          <option value="tolerated">{chrome.i18n.getMessage('encryptionTolerated')}</option>
        </select>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('dhtEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setDhtEnabled, settings.dhtEnabled)}
            type="checkbox"
            checked={settings.dhtEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('pexEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setPexEnabled, settings.pexEnabled)}
            type="checkbox"
            checked={settings.pexEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('lpdEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setLpdEnabled, settings.lpdEnabled)}
            type="checkbox"
            checked={settings.lpdEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('utpEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setUtpEnabled, settings.utpEnabled)}
            type="checkbox"
            checked={settings.utpEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <h3>{chrome.i18n.getMessage('altSpeedSchedule')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('altSpeedTimeEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setAltSpeedTimeEnabled, settings.altSpeedTimeEnabled)}
            type="checkbox"
            checked={settings.altSpeedTimeEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.altSpeedTimeEnabled && (
        <>
          <label>
            <span>{chrome.i18n.getMessage('altSpeedTimeBegin')}</span>
            <input
              type="time"
              value={minutesToTime(settings.altSpeedTimeBegin)}
              onChange={handleTimeChange(client.setAltSpeedTimeBegin)}
            />
          </label>

          <label>
            <span>{chrome.i18n.getMessage('altSpeedTimeEnd')}</span>
            <input
              type="time"
              value={minutesToTime(settings.altSpeedTimeEnd)}
              onChange={handleTimeChange(client.setAltSpeedTimeEnd)}
            />
          </label>

          <label>
            <span>{chrome.i18n.getMessage('altSpeedTimeDays')}</span>
            <div className="day-checkboxes">
              {ALT_SPEED_DAYS.map(({ bit, key }) => (
                <label key={key} className="day-checkbox">
                  <input
                    type="checkbox"
                    checked={(settings.altSpeedTimeDay & bit) !== 0}
                    onChange={handleDayToggle(bit)}
                  />
                  <span>{chrome.i18n.getMessage(key)}</span>
                </label>
              ))}
            </div>
          </label>
        </>
      )}

      <h3>{chrome.i18n.getMessage('scriptSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('scriptTorrentDoneEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              client.setScriptTorrentDoneEnabled,
              settings.scriptTorrentDoneEnabled
            )}
            type="checkbox"
            checked={settings.scriptTorrentDoneEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {settings.scriptTorrentDoneEnabled && (
        <label>
          <span>{chrome.i18n.getMessage('scriptTorrentDoneFilename')}</span>
          <div className="blocklist-url-row">
            <input type="text" value={scriptFilename} onChange={handleScriptFilenameChange} />
            <button type="button" onClick={handleApplyScriptFilename}>
              {chrome.i18n.getMessage('DLG_BTN_APPLY')}
            </button>
          </div>
        </label>
      )}

      {/* script-torrent-added / done-seeding need Transmission 4.0+ (rpc 17) */}
      {settings.features.scriptTorrentAdded && (
        <>
          <label>
            <span>{chrome.i18n.getMessage('scriptTorrentAddedEnabled')}</span>
            <span className="toggle-switch">
              <input
                onChange={handleToggle(
                  client.setScriptTorrentAddedEnabled,
                  settings.scriptTorrentAddedEnabled
                )}
                type="checkbox"
                checked={settings.scriptTorrentAddedEnabled}
              />
              <span className="toggle-slider"></span>
            </span>
          </label>

          {settings.scriptTorrentAddedEnabled && (
            <label>
              <span>{chrome.i18n.getMessage('scriptTorrentAddedFilename')}</span>
              <div className="blocklist-url-row">
                <input
                  type="text"
                  value={scriptAddedFilename}
                  onChange={handleScriptAddedFilenameChange}
                />
                <button type="button" onClick={handleApplyScriptAddedFilename}>
                  {chrome.i18n.getMessage('DLG_BTN_APPLY')}
                </button>
              </div>
            </label>
          )}

          <label>
            <span>{chrome.i18n.getMessage('scriptTorrentDoneSeedingEnabled')}</span>
            <span className="toggle-switch">
              <input
                onChange={handleToggle(
                  client.setScriptTorrentDoneSeedingEnabled,
                  settings.scriptTorrentDoneSeedingEnabled
                )}
                type="checkbox"
                checked={settings.scriptTorrentDoneSeedingEnabled}
              />
              <span className="toggle-slider"></span>
            </span>
          </label>

          {settings.scriptTorrentDoneSeedingEnabled && (
            <label>
              <span>{chrome.i18n.getMessage('scriptTorrentDoneSeedingFilename')}</span>
              <div className="blocklist-url-row">
                <input
                  type="text"
                  value={scriptDoneSeedingFilename}
                  onChange={handleScriptDoneSeedingFilenameChange}
                />
                <button type="button" onClick={handleApplyScriptDoneSeedingFilename}>
                  {chrome.i18n.getMessage('DLG_BTN_APPLY')}
                </button>
              </div>
            </label>
          )}
        </>
      )}

      <h3>{chrome.i18n.getMessage('blocklist')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('blocklistEnable')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(client.setBlocklistEnabled, settings.blocklistEnabled)}
            type="checkbox"
            checked={settings.blocklistEnabled}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('blocklistUrl')}</span>
        <div className="blocklist-url-row">
          <input type="text" value={url} onChange={handleUrlChange} placeholder="https://..." />
          <button type="button" onClick={handleApplyUrl}>
            {chrome.i18n.getMessage('DLG_BTN_APPLY')}
          </button>
        </div>
      </label>

      <label>
        <span>
          {chrome.i18n.getMessage('blocklistRules')}: {settings.blocklistSize.toLocaleString()}
        </span>
      </label>

      <label>
        <button type="button" onClick={handleUpdate} disabled={updating}>
          {updating ? '...' : chrome.i18n.getMessage('blocklistUpdateNow')}
        </button>
      </label>

      {/* Its own component: this file is long enough that a hook on the wrong
          side of an early return already shipped a hooks-count crash once, and
          the group list has its own loading and error states. It renders
          nothing below Transmission 4.0. */}
      <BandwidthGroups />
    </div>
  );
});

export default ServerOptions;
