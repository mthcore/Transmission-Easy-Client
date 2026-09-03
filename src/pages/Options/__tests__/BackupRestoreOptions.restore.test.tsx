import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const storageGet = vi.hoisted(() => vi.fn());
const storageSet = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/chromeStorage', () => ({ storageGet, storageSet }));

const cloud = vi.hoisted(() => ({
  saveCloudBackup: vi.fn(),
  loadCloudBackup: vi.fn(),
  hasCloudBackup: vi.fn(),
  clearCloudBackup: vi.fn(),
}));
vi.mock('../../../tools/cloudBackup', () => cloud);

import BackupRestoreOptions from '../BackupRestoreOptions';
import { BACKUP_EXCLUDE_KEYS } from '../../../stores/backupSanitize';

/**
 * Restoring overwrites every setting the extension holds, so this page is the
 * one place where being wrong costs the user their configuration rather than
 * one request.
 *
 * Two confirmations guard it, and the second is the interesting one. The
 * extension's Basic-auth header follows the hostname, so a backup that
 * repoints it at another server would send the stored credentials somewhere
 * else — that change is named and confirmed on its own, and declining must
 * write nothing at all.
 *
 * The rest is about not lying to the user. Only known keys reach storage, and
 * the ones the sanitizer refused are reported as a partial success rather than
 * hidden behind a green check.
 *
 * The cloud module is stubbed here, so the sync chunking it does is NOT under
 * test — BackupRestoreOptions.test.tsx drives the real one for exactly that,
 * and the two files are separate because they cannot share a module mock.
 */

afterEach(cleanup);

const STORED = {
  hostname: 'nas.local',
  port: 9091,
  ssl: true,
  pathname: '/transmission/rpc',
  webPathname: '',
  login: 'user',
  authenticationRequired: true,
};

let confirmSpy: ReturnType<typeof vi.spyOn>;
/** What storage actually holds; anything absent falls back to the defaults. */
let persisted: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  persisted = { ...STORED };
  // chrome.storage.get(defaults) fills in keys that were never written, which
  // is exactly what keeps a never-persisted port from reading as a change.
  storageGet.mockImplementation((keys: unknown) =>
    Promise.resolve(
      keys === null
        ? { ...persisted, _notifiedState: { completed: ['a'] } }
        : { ...(keys as Record<string, unknown>), ...persisted }
    )
  );
  storageSet.mockResolvedValue(undefined);
  cloud.hasCloudBackup.mockResolvedValue(false);
  cloud.saveCloudBackup.mockResolvedValue(undefined);
  cloud.loadCloudBackup.mockResolvedValue(null);
  cloud.clearCloudBackup.mockResolvedValue(undefined);
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => confirmSpy.mockRestore());

async function draw() {
  const result = render(<BackupRestoreOptions />);
  await act(async () => undefined);
  return result;
}

const field = () => document.querySelector('textarea') as HTMLTextAreaElement;
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

/** Put a backup in the textarea and press Restore. */
async function restore(backup: Record<string, unknown>) {
  fireEvent.change(field(), { target: { value: JSON.stringify(backup) } });
  await act(async () => {
    fireEvent.click(button('toRestore')!);
  });
}

describe('BackupRestoreOptions — what a backup contains', () => {
  it('shows the stored configuration on open', async () => {
    await draw();

    expect(field().value).toContain('nas.local');
  });

  it('leaves the background bookkeeping out of it', async () => {
    // The completion-notify record holds every torrent hash on the server; it
    // is local, transient, and can be enormous.
    await draw();

    expect(field().value).not.toContain('_notifiedState');
  });

  it('leaves out every key marked as excluded', async () => {
    const excluded = BACKUP_EXCLUDE_KEYS[0];
    persisted = { ...STORED, [excluded]: 'x' };
    await draw();

    expect(field().value).not.toContain(excluded);
  });
});

describe('BackupRestoreOptions — restoring', () => {
  it('asks before overwriting everything', async () => {
    await draw();
    await restore({ hostname: 'nas.local', port: 9091 });

    expect(confirmSpy).toHaveBeenCalled();
  });

  it('writes nothing when the user declines', async () => {
    confirmSpy.mockReturnValue(false);
    await draw();
    await restore({ hostname: 'other.local' });

    expect(storageSet).not.toHaveBeenCalled();
  });

  it('writes the configuration once confirmed', async () => {
    await draw();
    await restore({ hostname: 'nas.local', port: 9091 });

    expect(storageSet).toHaveBeenCalled();
  });

  it('strips excluded keys an older backup may carry', async () => {
    await draw();
    await restore({ hostname: 'nas.local', [BACKUP_EXCLUDE_KEYS[0]]: 'x' });

    const written = storageSet.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty(BACKUP_EXCLUDE_KEYS[0]);
  });

  it('lets only known keys into storage', async () => {
    // A hand-edited or version-skewed backup must not put arbitrary keys into
    // the extension's storage.
    await draw();
    await restore({ hostname: 'nas.local', somethingInvented: 'x' });

    const written = storageSet.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty('somethingInvented');
  });

  it('says which values it refused rather than showing a bare success', async () => {
    // The restore used to show an unqualified green check while silently
    // keeping the old values for those keys.
    //
    // Read from the message line, not from the page: the textarea below holds
    // the config JSON, so searching the whole document for a key name matches
    // whether or not anything was reported.
    await draw();
    await restore({ hostname: 'nas.local', port: 'not a number' });

    const messages = Array.from(document.querySelectorAll('p.red')).map((p) => p.textContent ?? '');
    expect(messages.join(' ')).toContain('port');
  });

  it('reports a backup that is not valid JSON', async () => {
    await draw();
    fireEvent.change(field(), { target: { value: '{ not json' } });
    await act(async () => {
      fireEvent.click(button('toRestore')!);
    });

    // No CONFIG is written. Not "nothing is written": the logger records
    // warnings and errors for the Diagnostics pane, so a reported failure now
    // legitimately puts one entry in its own '_'-prefixed key. Asserting on the
    // keys says what this case is actually about — a bad backup must not touch
    // the settings — and keeps saying it whatever else learns to write.
    const written = storageSet.mock.calls.flatMap((call) => Object.keys(call[0] ?? {}));
    expect(written.filter((key) => !key.startsWith('_'))).toEqual([]);
    expect(document.body.textContent?.toLowerCase()).toMatch(/error|erreur|json|token/i);
  });

  it('reports a storage write that fails', async () => {
    // Storage rejections are lastError-like objects rather than Errors, and
    // logging alone is a no-op in a production build.
    storageSet.mockRejectedValueOnce({ message: 'QUOTA_BYTES exceeded' });
    await draw();
    await restore({ hostname: 'nas.local' });

    expect(document.body.textContent).toContain('QUOTA_BYTES exceeded');
  });
});

describe('BackupRestoreOptions — a backup that changes the server', () => {
  it('names the change and asks again', async () => {
    // The Basic-auth header follows the hostname: restoring this would send
    // the stored credentials to a different machine.
    await draw();
    await restore({ hostname: 'someone-elses.host', port: 9091 });

    // The second question is a distinct message from the first: the mock
    // returns the i18n KEY, so the identity of the message is what says a
    // separate confirmation was raised rather than the overwrite one twice.
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(confirmSpy.mock.calls[1][0]).not.toBe(confirmSpy.mock.calls[0][0]);
  });

  it('writes nothing when that second question is declined', async () => {
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await draw();
    await restore({ hostname: 'someone-elses.host' });

    expect(storageSet).not.toHaveBeenCalled();
  });

  it('asks only once when the server is unchanged', async () => {
    await draw();
    await restore({ hostname: 'nas.local', port: 9091, login: 'user' });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('does not invent a change for a key that was never stored', async () => {
    // The comparison asks storage for the connection keys WITH ConfigStore's
    // defaults. Without them a never-persisted port comes back undefined and
    // the backup's 9091 reads as a change the user never made.
    persisted = { hostname: 'nas.local' };
    await draw();
    await restore({ hostname: 'nas.local', port: 9091 });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});

describe('BackupRestoreOptions — the cloud copy', () => {
  it('saves what is in the textarea', async () => {
    await draw();
    fireEvent.change(field(), { target: { value: '{"hostname":"nas.local"}' } });
    await act(async () => {
      fireEvent.click(button('optSaveInCloud')!);
    });

    expect(cloud.saveCloudBackup).toHaveBeenCalledWith('{"hostname":"nas.local"}');
  });

  it('reports a refused save instead of looking like nothing happened', async () => {
    // These used to report only through the logger, which is a no-op in
    // production: the button appeared dead.
    cloud.saveCloudBackup.mockRejectedValueOnce({ message: 'sync quota exceeded' });
    await draw();
    await act(async () => {
      fireEvent.click(button('optSaveInCloud')!);
    });

    expect(document.body.textContent).toContain('sync quota exceeded');
  });

  it('loads a stored backup into the textarea', async () => {
    cloud.hasCloudBackup.mockResolvedValue(true);
    cloud.loadCloudBackup.mockResolvedValue('{"hostname":"from-cloud"}');
    await draw();
    await act(async () => {
      fireEvent.click(button('optGetFromCloud')!);
    });

    expect(field().value).toBe('{"hostname":"from-cloud"}');
  });

  it('says so when there is nothing stored', async () => {
    cloud.hasCloudBackup.mockResolvedValue(true);
    cloud.loadCloudBackup.mockResolvedValue(null);
    await draw();
    await act(async () => {
      fireEvent.click(button('optGetFromCloud')!);
    });

    expect(field().value).toContain('nas.local');
  });

  it('asks before clearing it', async () => {
    cloud.hasCloudBackup.mockResolvedValue(true);
    await draw();
    await act(async () => {
      fireEvent.click(button('optClearCloudStorage')!);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(cloud.clearCloudBackup).toHaveBeenCalled();
  });

  it('clears nothing when the user declines', async () => {
    confirmSpy.mockReturnValue(false);
    cloud.hasCloudBackup.mockResolvedValue(true);
    await draw();
    await act(async () => {
      fireEvent.click(button('optClearCloudStorage')!);
    });

    expect(cloud.clearCloudBackup).not.toHaveBeenCalled();
  });
});
