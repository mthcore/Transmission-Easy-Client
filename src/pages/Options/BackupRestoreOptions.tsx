import React, { useState, useCallback, useRef, useEffect, type MouseEvent } from 'react';
import getLogger from '../../tools/getLogger';
import { storageGet, storageSet } from '../../tools/chromeStorage';
import { migrateConfig } from '../../tools/loadConfig';
import {
  BACKUP_EXCLUDE_KEYS,
  getConnectionChanges,
  sanitizeRestoreConfig,
} from '../../tools/backupSanitize';
import {
  saveCloudBackup,
  loadCloudBackup,
  hasCloudBackup,
  clearCloudBackup,
} from '../../tools/cloudBackup';

const logger = getLogger('BackupRestoreOptions');

// Storage rejections are chrome.runtime.lastError-like objects, not Errors
const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(err);
};

type LoadState = 'idle' | 'pending' | 'done' | 'error';
type SaveState = 'idle' | 'pending' | 'done' | 'error';
type RestoreState = 'idle' | 'pending' | 'done' | 'error';

interface StorageData {
  configVersion?: number;
  [key: string]: unknown;
}

const BackupRestoreOptions = () => {
  const refPage = useRef<HTMLDivElement>(null);
  const refData = useRef<HTMLTextAreaElement>(null);

  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [restoreState, setRestoreState] = useState<RestoreState>('idle');
  const [saveError, setSaveError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  /** Keys the sanitizer refused — a partial success, not a failure */
  const [restoreSkipped, setRestoreSkipped] = useState('');
  const [hasCloudData, setHasCloudData] = useState(false);
  const [storage, setStorage] = useState<string | null>(null);

  const checkCloudData = useCallback(async () => {
    try {
      const hasBackup = await hasCloudBackup();
      if (!refPage.current) return;
      setHasCloudData(hasBackup);
    } catch (err) {
      logger.error('checkCloudData error', err);
    }
  }, []);

  const handleLoadConfig = useCallback(async (e?: MouseEvent<HTMLButtonElement>) => {
    e?.preventDefault();
    setLoadState('pending');
    try {
      const raw: StorageData = await storageGet(null);
      if (!refPage.current) return;
      // Filter out transient local-only keys from the backup (background
      // bookkeeping is '_'-prefixed and can be large: the completion-notify
      // record holds every torrent hash on the server)
      for (const key of Object.keys(raw)) {
        if (BACKUP_EXCLUDE_KEYS.includes(key) || key.startsWith('_')) {
          delete raw[key];
        }
      }
      setLoadState('done');
      setStorage(JSON.stringify(raw, null, 2));
    } catch {
      if (!refPage.current) return;
      setLoadState('error');
      setStorage('');
    }
  }, []);

  useEffect(() => {
    handleLoadConfig();
    checkCloudData();
  }, [handleLoadConfig, checkCloudData]);

  const handleSaveToCloud = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setSaveState('pending');
    setSaveError('');
    try {
      await saveCloudBackup(refData.current?.value ?? '');
      if (!refPage.current) return;
      setSaveState('done');
      setHasCloudData(true);
      setTimeout(() => {
        if (!refPage.current) return;
        setSaveState('idle');
      }, 2000);
    } catch (err) {
      logger.error('handleSaveToCloud error', err);
      if (!refPage.current) return;
      setSaveState('error');
      setSaveError(errorMessage(err));
    }
  }, []);

  // These used to report failures only through logger.error, which is a no-op
  // in production builds: a rejected sync read/remove looked like the button
  // did nothing at all.
  const handleLoadFromCloud = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setRestoreError('');
    try {
      const backup = await loadCloudBackup();
      if (!refPage.current) return;
      if (!refData.current) {
        // The textarea only exists once the local config loaded
        setRestoreState('error');
        setRestoreError(chrome.i18n.getMessage('clickLoadConfig'));
        return;
      }
      if (!backup) {
        setRestoreState('error');
        setRestoreError(chrome.i18n.getMessage('OV_FL_ERROR'));
        setHasCloudData(false);
        return;
      }
      refData.current.value = backup;
      // A successful load must clear a leftover restore error, or the old red
      // ERROR line kept sitting under the freshly loaded backup
      setRestoreState('idle');
    } catch (err) {
      logger.error('handleLoadFromCloud error', err);
      if (!refPage.current) return;
      setRestoreState('error');
      setRestoreError(errorMessage(err));
    }
  }, []);

  const handleClearCloud = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const confirmMessage =
      chrome.i18n.getMessage('confirmClearCloud') ||
      'Are you sure you want to clear the cloud backup?';
    if (!window.confirm(confirmMessage)) return;
    try {
      await clearCloudBackup();
      if (!refPage.current) return;
      setHasCloudData(false);
    } catch (err) {
      logger.error('handleClearCloud error', err);
      if (!refPage.current) return;
      setRestoreState('error');
      setRestoreError(errorMessage(err));
    }
  }, []);

  const handleRestore = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const confirmMessage =
      chrome.i18n.getMessage('confirmRestore') ||
      'Are you sure you want to restore this configuration? This will overwrite all current settings.';
    if (!window.confirm(confirmMessage)) return;
    setRestoreState('pending');
    setRestoreError('');
    setRestoreSkipped('');
    try {
      const parsed = JSON.parse(refData.current?.value || '{}');
      // Strip transient keys that may have been included in older backups
      for (const key of BACKUP_EXCLUDE_KEYS) {
        delete parsed[key];
      }
      const config: StorageData = {
        configVersion: 1,
        ...parsed,
      };
      if (config.configVersion !== 2) {
        config.configVersion = 2;
        migrateConfig(config as Record<string, unknown>, config as Record<string, unknown>);
      }
      // Only known config keys may enter storage
      const { config: cleanConfig, droppedKeys } = sanitizeRestoreConfig(
        config as Record<string, unknown>
      );
      if (droppedKeys.length) {
        logger.info('restore: ignored unknown keys', droppedKeys);
      }
      // A restore that repoints the extension at another server deserves its
      // own explicit confirmation (the Basic-auth header follows the hostname)
      // Fallbacks must mirror ConfigStore's defaults, otherwise never-persisted
      // keys show up as fake connection changes (e.g. "port: 0 → 9091")
      const current = await storageGet({
        hostname: '',
        port: 9091,
        ssl: true,
        pathname: '/transmission/rpc',
        webPathname: '',
        login: '',
        authenticationRequired: true,
      });
      const connectionChanges = getConnectionChanges(cleanConfig, current);
      if (connectionChanges.length) {
        const changeMessage =
          chrome.i18n.getMessage('restoreConnectionChanged', connectionChanges.join(', ')) ||
          `This backup changes the server connection: ${connectionChanges.join(', ')}. Continue?`;
        if (!window.confirm(changeMessage)) {
          setRestoreState('idle');
          return;
        }
      }
      await storageSet(cleanConfig);
      if (!refPage.current) return;
      setRestoreState('done');
      // Values dropped for a wrong type (a hand-edited or version-skewed
      // backup) must be visible: the restore used to show an unqualified green
      // check while silently keeping the old values for those keys. This is a
      // partial success and is tracked separately from restoreError — reusing
      // that state left a bare red line on the page once the check faded, with
      // nothing left to explain it.
      if (droppedKeys.length) {
        setRestoreSkipped(
          (chrome.i18n.getMessage('restoreSkippedKeys') || 'Ignored invalid values') +
            ': ' +
            droppedKeys.join(', ')
        );
      }
      setTimeout(() => {
        if (!refPage.current) return;
        setRestoreState('idle');
        setRestoreSkipped('');
      }, 2000);
    } catch (err) {
      logger.error('handleRestore error', err);
      if (!refPage.current) return;
      setRestoreState('error');
      setRestoreError(errorMessage(err));
    }
  }, []);

  return (
    <div ref={refPage} className="page backup-restore">
      <h2>{chrome.i18n.getMessage('backupRestore')}</h2>

      <div className="backup-section">
        <h3>{chrome.i18n.getMessage('backup')}</h3>
        <p className="section-hint">{chrome.i18n.getMessage('backupHint')}</p>
        <p className="section-hint">{chrome.i18n.getMessage('backupIncludesCredentials')}</p>
        <div className="backup-actions">
          <button type="button" onClick={handleLoadConfig} disabled={loadState === 'pending'}>
            {loadState === 'pending' ? '...' : chrome.i18n.getMessage('loadCurrentConfig')}
          </button>
          <button
            type="button"
            onClick={handleSaveToCloud}
            disabled={loadState !== 'done' || saveState === 'pending'}
          >
            {saveState === 'pending'
              ? '...'
              : saveState === 'done'
                ? '✓'
                : chrome.i18n.getMessage('optSaveInCloud')}
          </button>
        </div>
        {saveState === 'error' && (
          <p className="red">
            {chrome.i18n.getMessage('OV_FL_ERROR')}
            {saveError ? `: ${saveError}` : ''}
          </p>
        )}
      </div>

      <div className="backup-section">
        <h3>{chrome.i18n.getMessage('configData')}</h3>
        {loadState === 'done' ? (
          <textarea ref={refData} defaultValue={storage || ''} />
        ) : loadState === 'pending' ? (
          <div className="loading-inline"></div>
        ) : loadState === 'error' ? (
          <p className="red">{chrome.i18n.getMessage('OV_FL_ERROR')}</p>
        ) : (
          <p className="section-hint">{chrome.i18n.getMessage('clickLoadConfig')}</p>
        )}
      </div>

      <div className="backup-section">
        <h3>{chrome.i18n.getMessage('restore')}</h3>
        <p className="section-hint">{chrome.i18n.getMessage('restoreHint')}</p>
        <div className="backup-actions">
          <button
            type="button"
            onClick={handleRestore}
            disabled={loadState !== 'done' || restoreState === 'pending'}
          >
            {restoreState === 'pending'
              ? '...'
              : restoreState === 'done'
                ? '✓'
                : chrome.i18n.getMessage('toRestore')}
          </button>
          <button type="button" onClick={handleLoadFromCloud} disabled={!hasCloudData}>
            {chrome.i18n.getMessage('optGetFromCloud')}
          </button>
          <button type="button" onClick={handleClearCloud} disabled={!hasCloudData}>
            {chrome.i18n.getMessage('optClearCloudStorage')}
          </button>
        </div>
        {restoreState === 'error' && (
          <p className="red">
            {chrome.i18n.getMessage('OV_FL_ERROR')}
            {restoreError ? `: ${restoreError}` : ''}
          </p>
        )}
        {/* Partial success: the restore applied, but some values were dropped
            (wrong type in a hand-edited backup) — say so instead of showing an
            unqualified green check */}
        {restoreState !== 'error' && restoreSkipped && <p className="red">{restoreSkipped}</p>}
      </div>
    </div>
  );
};

export default BackupRestoreOptions;
