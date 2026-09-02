import { describe, it, expect } from 'vitest';
import { migrateConfig } from '../loadConfig';

/**
 * The legacy keys shipped misspelled for years, so both spellings are accepted.
 * Nothing verified that — removing either entry silently reset those two
 * settings for every pre-v2 upgrade — nor that WHICH spelling wins is decided
 * here rather than by the order chrome.storage happened to return the keys in.
 */
const base = () => ({ configVersion: 1 }) as unknown as Parameters<typeof migrateConfig>[1];

describe('migrateConfig — legacy keys', () => {
  it('migrates the historical misspellings', () => {
    const config = migrateConfig(
      { showNotificationOnDownloadCompleate: 1, hideFnishStatusItem: 0 },
      base()
    ) as unknown as Record<string, unknown>;

    expect(config.showDownloadCompleteNotifications).toBe(true);
    expect(config.hideFinishedTorrents).toBe(false);
  });

  it('migrates the corrected spellings too', () => {
    const config = migrateConfig(
      { showNotificationOnDownloadComplete: 0, hideFinishStatusItem: 1 },
      base()
    ) as unknown as Record<string, unknown>;

    expect(config.showDownloadCompleteNotifications).toBe(false);
    expect(config.hideFinishedTorrents).toBe(true);
  });

  it('lets the historical spelling win when a profile carries both', () => {
    // Object.entries order used to decide this, which is the storage backend's
    // choice, not ours — the same profile could migrate differently per browser
    const historicalFirst = migrateConfig(
      { showNotificationOnDownloadCompleate: 1, showNotificationOnDownloadComplete: 0 },
      base()
    ) as unknown as Record<string, unknown>;
    const correctedFirst = migrateConfig(
      { showNotificationOnDownloadComplete: 0, showNotificationOnDownloadCompleate: 1 },
      base()
    ) as unknown as Record<string, unknown>;

    expect(historicalFirst.showDownloadCompleteNotifications).toBe(true);
    expect(correctedFirst.showDownloadCompleteNotifications).toBe(true);
  });

  it('renames the plain keys as well', () => {
    const config = migrateConfig(
      { ip: 'nas.local', path: '/transmission/rpc', useSSL: 1 },
      base()
    ) as unknown as Record<string, unknown>;

    expect(config.hostname).toBe('nas.local');
    expect(config.pathname).toBe('/transmission/rpc');
    expect(config.ssl).toBe(true);
  });

  it('skips one malformed value instead of aborting the whole migration', () => {
    // migrateConfig also runs on user-pasted restore blobs
    const config = migrateConfig(
      { folderList: 'not-a-list', ip: 'nas.local' },
      base()
    ) as unknown as Record<string, unknown>;

    expect(config.hostname).toBe('nas.local');
    expect(config.folders).toBeUndefined();
  });

  it('passes through keys the map does not know', () => {
    const config = migrateConfig({ somethingNew: 42 }, base()) as unknown as Record<
      string,
      unknown
    >;
    expect(config.somethingNew).toBe(42);
  });
});
