import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import BackupRestoreOptions from '../BackupRestoreOptions';

const QUOTA_BYTES_PER_ITEM = 8192;

const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

// In-memory local+sync storage with chrome.storage semantics, including the
// sync per-item quota that broke the single-key cloud backup.
let areas: Record<string, Record<string, unknown>>;

function installRealisticStorage() {
  areas = { local: {}, sync: {} };
  const runtime = chrome.runtime as { lastError: chrome.runtime.LastError | null };

  const makeGet =
    (ns: string) => (query: unknown, cb: (items: Record<string, unknown>) => void) => {
      const store = areas[ns];
      let result: Record<string, unknown> = {};
      if (query === null || query === undefined) {
        result = { ...store };
      } else if (typeof query === 'string') {
        if (query in store) result[query] = store[query];
      } else if (Array.isArray(query)) {
        for (const key of query) if (key in store) result[key] = store[key];
      } else {
        result = { ...(query as Record<string, unknown>) };
        for (const key of Object.keys(result)) if (key in store) result[key] = store[key];
      }
      cb(result);
    };

  const makeSet = (ns: string) => (items: Record<string, unknown>, cb: () => void) => {
    if (ns === 'sync') {
      for (const [key, value] of Object.entries(items)) {
        if (key.length + serializedBytes(value) > QUOTA_BYTES_PER_ITEM) {
          runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
          cb();
          runtime.lastError = null;
          return;
        }
      }
    }
    Object.assign(areas[ns], items);
    cb();
  };

  const makeRemove = (ns: string) => (keys: string | string[], cb: () => void) => {
    for (const key of ([] as string[]).concat(keys)) {
      delete areas[ns][key];
    }
    cb();
  };

  vi.mocked(chrome.storage.local.get).mockImplementation(makeGet('local') as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(makeSet('local') as never);
  vi.mocked(chrome.storage.local.remove).mockImplementation(makeRemove('local') as never);
  vi.mocked(chrome.storage.sync.get).mockImplementation(makeGet('sync') as never);
  vi.mocked(chrome.storage.sync.set).mockImplementation(makeSet('sync') as never);
  vi.mocked(chrome.storage.sync.remove).mockImplementation(makeRemove('sync') as never);
}

// A config whose pretty-printed backup exceeds the 8192-byte per-item quota,
// like a real config with persisted column lists (the 3.3.0 regression).
function bigConfig(): Record<string, unknown> {
  const mkCols = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      column: `col_${i}`,
      display: i % 2,
      order: 1,
      width: 100 + i,
      lang: 'OV_COL_DATE_COMPLETED',
    }));
  return {
    configVersion: 2,
    hostname: '192.168.1.50',
    port: 9091,
    ssl: false,
    pathname: '/transmission/rpc',
    login: 'admin',
    password: 'secret',
    torrentColumns: mkCols(25),
    torrentColumnsPopup: mkCols(25),
    filesColumns: mkCols(6),
  };
}

async function renderLoaded() {
  render(<BackupRestoreOptions />);
  await waitFor(() => {
    expect(document.querySelector('textarea')).toBeTruthy();
  });
}

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

describe('BackupRestoreOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.runtime as { lastError: unknown }).lastError = null;
    installRealisticStorage();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('saves a config bigger than the sync per-item quota by chunking it', async () => {
    areas.local = bigConfig();
    await renderLoaded();
    expect(
      serializedBytes((document.querySelector('textarea') as HTMLTextAreaElement).value)
    ).toBeGreaterThan(QUOTA_BYTES_PER_ITEM);

    await click(screen.getByText('optSaveInCloud'));

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
    expect(areas.sync.backupChunks as number).toBeGreaterThan(1);
    expect(document.querySelector('.red')).toBeNull();
  });

  it('shows the error when saving to cloud fails', async () => {
    areas.local = { configVersion: 2 };
    vi.mocked(chrome.storage.sync.set).mockImplementation(((
      _items: Record<string, unknown>,
      cb: () => void
    ) => {
      const runtime = chrome.runtime as { lastError: chrome.runtime.LastError | null };
      runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
      cb();
      runtime.lastError = null;
    }) as never);
    await renderLoaded();

    await click(screen.getByText('optSaveInCloud'));

    await waitFor(() => {
      expect(screen.getByText(/QUOTA_BYTES quota exceeded/)).toBeTruthy();
    });
  });

  it('restores a chunked cloud backup on a first start', async () => {
    areas.local = { configVersion: 2 };
    const blob = JSON.stringify(bigConfig(), null, 2);
    // seed a chunked backup the way saveCloudBackup writes it
    const chunkSize = 3000;
    let count = 0;
    for (let offset = 0; offset < blob.length; offset += chunkSize) {
      areas.sync[`backup_${count}`] = blob.slice(offset, offset + chunkSize);
      count += 1;
    }
    areas.sync.backupChunks = count;

    await renderLoaded();
    const getFromCloud = screen.getByText('optGetFromCloud') as HTMLButtonElement;
    expect(getFromCloud.disabled).toBe(false);

    await click(getFromCloud);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(blob);

    await click(screen.getByText('toRestore'));
    await waitFor(() => {
      expect(areas.local.hostname).toBe('192.168.1.50');
    });
    expect(document.querySelector('.red')).toBeNull();
  });

  it('still restores a legacy single-key cloud backup', async () => {
    areas.local = { configVersion: 2 };
    areas.sync.backup = JSON.stringify(
      { configVersion: 2, hostname: 'legacy.example.org', port: 9091 },
      null,
      2
    );

    await renderLoaded();
    const getFromCloud = screen.getByText('optGetFromCloud') as HTMLButtonElement;
    expect(getFromCloud.disabled).toBe(false);

    await click(getFromCloud);
    await click(screen.getByText('toRestore'));
    await waitFor(() => {
      expect(areas.local.hostname).toBe('legacy.example.org');
    });
  });

  it('shows the error when restoring invalid JSON', async () => {
    areas.local = { configVersion: 2 };
    await renderLoaded();
    (document.querySelector('textarea') as HTMLTextAreaElement).value = '{not json';

    await click(screen.getByText('toRestore'));

    await waitFor(() => {
      expect(document.querySelector('.red')).toBeTruthy();
    });
    expect(areas.local.hostname).toBeUndefined();
  });

  it('clears chunked cloud data and disables the cloud buttons', async () => {
    areas.local = { configVersion: 2 };
    areas.sync = { backupChunks: 1, backup_0: '{}', backup: 'legacy' };
    await renderLoaded();

    await click(screen.getByText('optClearCloudStorage'));

    await waitFor(() => {
      expect((screen.getByText('optGetFromCloud') as HTMLButtonElement).disabled).toBe(true);
    });
    expect(Object.keys(areas.sync)).toEqual([]);
  });
});
