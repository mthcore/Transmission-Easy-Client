import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';

interface Settings {
  blocklistEnabled: boolean;
  blocklistUrl: string;
  blocklistSize: number;
  peerLimitGlobal: number;
  peerLimitPerTorrent: number;
  seedRatioLimit: number;
  seedRatioLimited: boolean;
  idleSeedingLimit: number;
  idleSeedingLimitEnabled: boolean;
  peerPort: number;
  portForwardingEnabled: boolean;
  encryption: string;
  dhtEnabled: boolean;
  pexEnabled: boolean;
  lpdEnabled: boolean;
  utpEnabled: boolean;
  incompleteDirEnabled: boolean;
  incompleteDir: string;
  renamePartialFiles: boolean;
  downloadQueueEnabled: boolean;
  downloadQueueSize: number;
  seedQueueEnabled: boolean;
  seedQueueSize: number;
  queueStalledEnabled: boolean;
  queueStalledMinutes: number;
  startAddedTorrents: boolean;
  trashOriginalTorrentFiles: boolean;
  altSpeedTimeEnabled: boolean;
  altSpeedTimeBegin: number;
  altSpeedTimeEnd: number;
  altSpeedTimeDay: number;
  scriptTorrentDoneEnabled: boolean;
  scriptTorrentDoneFilename: string;
  scriptTorrentAddedEnabled: boolean;
  scriptTorrentAddedFilename: string;
  scriptTorrentDoneSeedingEnabled: boolean;
  scriptTorrentDoneSeedingFilename: string;
  rpcVersion: number;
  version?: string;
  daemonVersionStr: string;
  features: {
    scriptTorrentAdded: boolean;
    sequentialDownload: boolean;
    portTestIpProtocol: boolean;
  };
}

interface ClientStore {
  settings: Settings | null;
  updateSettings: () => Promise<void>;
  setBlocklistEnabled: (enabled: boolean) => Promise<void>;
  setBlocklistUrl: (url: string) => Promise<void>;
  blocklistUpdate: () => Promise<{ blocklistSize: number }>;
  setPeerLimitGlobal: (limit: number) => Promise<void>;
  setPeerLimitPerTorrent: (limit: number) => Promise<void>;
  setSeedRatioLimited: (enabled: boolean) => Promise<void>;
  setSeedRatioLimit: (limit: number) => Promise<void>;
  setIdleSeedingLimitEnabled: (enabled: boolean) => Promise<void>;
  setIdleSeedingLimit: (limit: number) => Promise<void>;
  setPeerPort: (port: number) => Promise<void>;
  setPortForwardingEnabled: (enabled: boolean) => Promise<void>;
  setEncryption: (mode: string) => Promise<void>;
  setDhtEnabled: (enabled: boolean) => Promise<void>;
  setPexEnabled: (enabled: boolean) => Promise<void>;
  setLpdEnabled: (enabled: boolean) => Promise<void>;
  setUtpEnabled: (enabled: boolean) => Promise<void>;
  setIncompleteDirEnabled: (enabled: boolean) => Promise<void>;
  setIncompleteDir: (dir: string) => Promise<void>;
  setRenamePartialFiles: (enabled: boolean) => Promise<void>;
  setDownloadQueueEnabled: (enabled: boolean) => Promise<void>;
  setDownloadQueueSize: (size: number) => Promise<void>;
  setSeedQueueEnabled: (enabled: boolean) => Promise<void>;
  setSeedQueueSize: (size: number) => Promise<void>;
  setQueueStalledEnabled: (enabled: boolean) => Promise<void>;
  setQueueStalledMinutes: (minutes: number) => Promise<void>;
  setStartAddedTorrents: (enabled: boolean) => Promise<void>;
  setTrashOriginalTorrentFiles: (enabled: boolean) => Promise<void>;
  setAltSpeedTimeEnabled: (enabled: boolean) => Promise<void>;
  setAltSpeedTimeBegin: (minutes: number) => Promise<void>;
  setAltSpeedTimeEnd: (minutes: number) => Promise<void>;
  setAltSpeedTimeDay: (day: number) => Promise<void>;
  setScriptTorrentDoneEnabled: (enabled: boolean) => Promise<void>;
  setScriptTorrentDoneFilename: (filename: string) => Promise<void>;
  setScriptTorrentAddedEnabled: (enabled: boolean) => Promise<void>;
  setScriptTorrentAddedFilename: (filename: string) => Promise<void>;
  setScriptTorrentDoneSeedingEnabled: (enabled: boolean) => Promise<void>;
  setScriptTorrentDoneSeedingFilename: (filename: string) => Promise<void>;
  portTest: () => Promise<boolean>;
}

interface RootStore {
  client: ClientStore;
}

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
  const rootStore = useRootStore() as unknown as RootStore;
  const settings = rootStore.client.settings;
  const [url, setUrl] = useState('');
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [incompleteDir, setIncompleteDirInput] = useState('');
  const [incompleteDirLoaded, setIncompleteDirLoaded] = useState(false);
  const [scriptFilename, setScriptFilenameInput] = useState('');
  const [scriptFilenameLoaded, setScriptFilenameLoaded] = useState(false);
  const [scriptAddedFilename, setScriptAddedFilenameInput] = useState('');
  const [scriptAddedFilenameLoaded, setScriptAddedFilenameLoaded] = useState(false);
  const [scriptDoneSeedingFilename, setScriptDoneSeedingFilenameInput] = useState('');
  const [scriptDoneSeedingFilenameLoaded, setScriptDoneSeedingFilenameLoaded] = useState(false);
  const [portTestResult, setPortTestResult] = useState<boolean | null>(null);
  const [portTesting, setPortTesting] = useState(false);

  const fetchSettings = useCallback(() => {
    setLoading(true);
    setError(false);
    rootStore.client.updateSettings().then(
      () => setLoading(false),
      () => {
        setLoading(false);
        setError(true);
      }
    );
  }, [rootStore.client]);

  useEffect(() => {
    if (!settings) {
      fetchSettings();
    }
  }, [fetchSettings, settings]);

  if (!settings) {
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

  if (!urlLoaded) {
    setUrl(settings.blocklistUrl);
    setUrlLoaded(true);
  }

  if (!incompleteDirLoaded) {
    setIncompleteDirInput(settings.incompleteDir);
    setIncompleteDirLoaded(true);
  }

  if (!scriptFilenameLoaded) {
    setScriptFilenameInput(settings.scriptTorrentDoneFilename);
    setScriptFilenameLoaded(true);
  }

  if (!scriptAddedFilenameLoaded) {
    setScriptAddedFilenameInput(settings.scriptTorrentAddedFilename || '');
    setScriptAddedFilenameLoaded(true);
  }

  if (!scriptDoneSeedingFilenameLoaded) {
    setScriptDoneSeedingFilenameInput(settings.scriptTorrentDoneSeedingFilename || '');
    setScriptDoneSeedingFilenameLoaded(true);
  }

  const handleToggle = (setter: (enabled: boolean) => Promise<void>, current: boolean) => () => {
    setter(!current);
  };

  const handleNumberBlur =
    (setter: (value: number) => Promise<void>) => (e: React.FocusEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (Number.isFinite(val) && val > 0) {
        setter(val);
      }
    };

  const handleIntBlur =
    (setter: (value: number) => Promise<void>) => (e: React.FocusEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (Number.isFinite(val) && val > 0) {
        setter(val);
      }
    };

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  }, []);

  const handleApplyUrl = useCallback(() => {
    rootStore.client.setBlocklistUrl(url);
  }, [rootStore.client, url]);

  const handleUpdate = useCallback(() => {
    setUpdating(true);
    rootStore.client.blocklistUpdate().then(
      () => setUpdating(false),
      () => setUpdating(false)
    );
  }, [rootStore.client]);

  const handleEncryptionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      rootStore.client.setEncryption(e.target.value);
    },
    [rootStore.client]
  );

  const handleIncompleteDirChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIncompleteDirInput(e.target.value);
  }, []);

  const handleApplyIncompleteDir = useCallback(() => {
    rootStore.client.setIncompleteDir(incompleteDir);
  }, [rootStore.client, incompleteDir]);

  const handleScriptFilenameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScriptFilenameInput(e.target.value);
  }, []);

  const handleApplyScriptFilename = useCallback(() => {
    rootStore.client.setScriptTorrentDoneFilename(scriptFilename);
  }, [rootStore.client, scriptFilename]);

  const handleScriptAddedFilenameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScriptAddedFilenameInput(e.target.value);
  }, []);

  const handleApplyScriptAddedFilename = useCallback(() => {
    rootStore.client.setScriptTorrentAddedFilename(scriptAddedFilename);
  }, [rootStore.client, scriptAddedFilename]);

  const handleScriptDoneSeedingFilenameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setScriptDoneSeedingFilenameInput(e.target.value);
    },
    []
  );

  const handleApplyScriptDoneSeedingFilename = useCallback(() => {
    rootStore.client.setScriptTorrentDoneSeedingFilename(scriptDoneSeedingFilename);
  }, [rootStore.client, scriptDoneSeedingFilename]);

  const handlePortTest = useCallback(() => {
    setPortTesting(true);
    setPortTestResult(null);
    rootStore.client.portTest().then(
      (isOpen) => {
        setPortTestResult(isOpen);
        setPortTesting(false);
      },
      () => {
        setPortTestResult(false);
        setPortTesting(false);
      }
    );
  }, [rootStore.client]);

  const handleDayToggle = useCallback(
    (dayBit: number) => () => {
      rootStore.client.setAltSpeedTimeDay(settings.altSpeedTimeDay ^ dayBit);
    },
    [rootStore.client, settings.altSpeedTimeDay]
  );

  const handleTimeChange =
    (setter: (minutes: number) => Promise<void>) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const [h, m] = e.target.value.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        setter(h * 60 + m);
      }
    };

  return (
    <div className="page server">
      <h2>{chrome.i18n.getMessage('optServer')}</h2>

      {settings.daemonVersionStr && <p className="daemon-version">{settings.daemonVersionStr}</p>}

      <h3>{chrome.i18n.getMessage('generalSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('startAddedTorrents')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              rootStore.client.setStartAddedTorrents,
              settings.startAddedTorrents
            )}
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
              rootStore.client.setTrashOriginalTorrentFiles,
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
          defaultValue={settings.peerLimitGlobal}
          onBlur={handleIntBlur(rootStore.client.setPeerLimitGlobal)}
        />
      </label>

      <label>
        <span>{chrome.i18n.getMessage('peerLimitPerTorrent')}</span>
        <input
          type="number"
          min="1"
          defaultValue={settings.peerLimitPerTorrent}
          onBlur={handleIntBlur(rootStore.client.setPeerLimitPerTorrent)}
        />
      </label>

      <h3>{chrome.i18n.getMessage('seedingSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('seedRatioLimited')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(rootStore.client.setSeedRatioLimited, settings.seedRatioLimited)}
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
            defaultValue={settings.seedRatioLimit}
            onBlur={handleNumberBlur(rootStore.client.setSeedRatioLimit)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('idleSeedingLimitEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              rootStore.client.setIdleSeedingLimitEnabled,
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
            defaultValue={settings.idleSeedingLimit}
            onBlur={handleIntBlur(rootStore.client.setIdleSeedingLimit)}
          />{' '}
          <span>{chrome.i18n.getMessage('minutes')}</span>
        </label>
      )}

      <h3>{chrome.i18n.getMessage('queueSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('downloadQueueEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              rootStore.client.setDownloadQueueEnabled,
              settings.downloadQueueEnabled
            )}
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
            defaultValue={settings.downloadQueueSize}
            onBlur={handleIntBlur(rootStore.client.setDownloadQueueSize)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('seedQueueEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(rootStore.client.setSeedQueueEnabled, settings.seedQueueEnabled)}
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
            defaultValue={settings.seedQueueSize}
            onBlur={handleIntBlur(rootStore.client.setSeedQueueSize)}
          />
        </label>
      )}

      <label>
        <span>{chrome.i18n.getMessage('queueStalledEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              rootStore.client.setQueueStalledEnabled,
              settings.queueStalledEnabled
            )}
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
            defaultValue={settings.queueStalledMinutes}
            onBlur={handleIntBlur(rootStore.client.setQueueStalledMinutes)}
          />{' '}
          <span>{chrome.i18n.getMessage('minutes')}</span>
        </label>
      )}

      <h3>{chrome.i18n.getMessage('incompleteDirSettings')}</h3>

      <label>
        <span>{chrome.i18n.getMessage('incompleteDirEnabled')}</span>
        <span className="toggle-switch">
          <input
            onChange={handleToggle(
              rootStore.client.setIncompleteDirEnabled,
              settings.incompleteDirEnabled
            )}
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
            onChange={handleToggle(
              rootStore.client.setRenamePartialFiles,
              settings.renamePartialFiles
            )}
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
          defaultValue={settings.peerPort}
          onBlur={handleIntBlur(rootStore.client.setPeerPort)}
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
            onChange={handleToggle(
              rootStore.client.setPortForwardingEnabled,
              settings.portForwardingEnabled
            )}
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
            onChange={handleToggle(rootStore.client.setDhtEnabled, settings.dhtEnabled)}
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
            onChange={handleToggle(rootStore.client.setPexEnabled, settings.pexEnabled)}
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
            onChange={handleToggle(rootStore.client.setLpdEnabled, settings.lpdEnabled)}
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
            onChange={handleToggle(rootStore.client.setUtpEnabled, settings.utpEnabled)}
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
            onChange={handleToggle(
              rootStore.client.setAltSpeedTimeEnabled,
              settings.altSpeedTimeEnabled
            )}
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
              onChange={handleTimeChange(rootStore.client.setAltSpeedTimeBegin)}
            />
          </label>

          <label>
            <span>{chrome.i18n.getMessage('altSpeedTimeEnd')}</span>
            <input
              type="time"
              value={minutesToTime(settings.altSpeedTimeEnd)}
              onChange={handleTimeChange(rootStore.client.setAltSpeedTimeEnd)}
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
              rootStore.client.setScriptTorrentDoneEnabled,
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
                  rootStore.client.setScriptTorrentAddedEnabled,
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
                  rootStore.client.setScriptTorrentDoneSeedingEnabled,
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
            onChange={handleToggle(rootStore.client.setBlocklistEnabled, settings.blocklistEnabled)}
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
    </div>
  );
});

export default ServerOptions;
