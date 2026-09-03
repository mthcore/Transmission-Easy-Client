import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  redact,
  foldEntry,
  recordDiagnostic,
  readDiagnosticLog,
  clearDiagnosticLog,
  formatDiagnosticReport,
  resetDiagnosticQueue,
  DIAGNOSTIC_STORAGE_KEY,
  MAX_ENTRIES,
  MAX_MESSAGE_LENGTH,
  DEDUPE_WINDOW_MS,
  type DiagnosticEntry,
} from '../diagnosticLog';

/**
 * The log exists because a shipped extension's failures were observable by
 * nobody: the user sees an action quietly not happen, and the service worker
 * that held the console was torn down long before the bug report was written.
 *
 * Two of its rules carry real weight and are the reason this file is longer
 * than the module deserves on size alone:
 *
 *  - Redaction runs on the way IN. What is written here is later COPIED, and
 *    usually into a public issue. A daemon URL can carry credentials inline.
 *  - The ring is bounded and folds repeats. A daemon that has gone away fails
 *    once per poll; at one poll a second, an unfolded ring holds fifty copies
 *    of the same line and nothing that led up to it.
 */

/** A storage that behaves like chrome.storage.local rather than returning {}. */
function installStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  vi.mocked(chrome.storage.local.get).mockImplementation(((
    query: unknown,
    cb: (items: Record<string, unknown>) => void
  ) => {
    const keys = typeof query === 'string' ? [query] : Array.isArray(query) ? query : [];
    const result: Record<string, unknown> = {};
    for (const key of keys) if (key in data) result[key] = data[key];
    cb(result);
  }) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(((
    items: Record<string, unknown>,
    cb?: () => void
  ) => {
    Object.assign(data, items);
    cb?.();
  }) as never);
  vi.mocked(chrome.storage.local.remove).mockImplementation(((keys: unknown, cb?: () => void) => {
    for (const key of typeof keys === 'string' ? [keys] : (keys as string[])) delete data[key];
    cb?.();
  }) as never);
  return data;
}

const stored = (data: Record<string, unknown>) =>
  (data[DIAGNOSTIC_STORAGE_KEY] ?? []) as DiagnosticEntry[];

beforeEach(() => {
  vi.clearAllMocks();
  resetDiagnosticQueue();
});

afterEach(() => {
  resetDiagnosticQueue();
});

describe('redact — what must not reach a public issue', () => {
  it('drops credentials carried inline in the daemon URL', () => {
    // Transmission's URL is user-entered and this form works, so it happens.
    const out = redact('GET failed http://admin:hunter2@nas.local:9091/transmission/rpc');

    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('admin');
    expect(out).not.toContain('nas.local');
  });

  it('drops the host but keeps the port and the path', () => {
    // Which RPC path failed, and on which port, is most of the diagnostic
    // value. Redacting the whole URL would have thrown that away with it.
    const out = redact('404 on https://seedbox.example.com/transmission/rpc');

    expect(out).not.toContain('seedbox.example.com');
    expect(out).toContain('/transmission/rpc');
  });

  it('keeps the scheme, so an http/https mix-up is still diagnosable', () => {
    expect(redact('http://nas.local/x')).toMatch(/^http:/);
    expect(redact('https://nas.local/x')).toMatch(/^https:/);
  });

  it('drops the Basic authorization header', () => {
    const out = redact('Authorization: Basic YWRtaW46aHVudGVyMg==');

    expect(out).not.toContain('YWRtaW46aHVudGVyMg==');
    expect(out).toContain('Basic <redacted>');
  });

  it('drops a value that announces itself as a secret', () => {
    const out = redact('login failed password=hunter2 token: abc123');

    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc123');
  });

  it('drops the session id, which is a live credential for the daemon', () => {
    const out = redact('X-Transmission-Session-Id: aBcD1234EfGh5678');

    expect(out).not.toContain('aBcD1234EfGh5678');
  });

  it('leaves an ordinary message alone', () => {
    // Over-redaction costs as much as under-redaction: a report that says
    // <redacted> everywhere is not a report.
    const message = 'torrent-get returned 409, retrying';

    expect(redact(message)).toBe(message);
  });
});

describe('foldEntry — keeping the ring readable', () => {
  const entry = (over: Partial<DiagnosticEntry> = {}): DiagnosticEntry => ({
    time: 1_000_000,
    level: 'error',
    name: 'TorrentService',
    message: 'daemon unreachable',
    ...over,
  });

  it('appends something new', () => {
    const out = foldEntry([], entry());

    expect(out).toHaveLength(1);
    expect(out[0].count).toBeUndefined();
  });

  it('folds a repeat inside the window into a count', () => {
    // A dead daemon fails once per poll. Fifty entries of it would push out
    // everything that led up to it.
    const first = foldEntry([], entry());
    const out = foldEntry(first, entry({ time: 1_000_500 }));

    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });

  it('keeps counting past the second repeat', () => {
    let out = foldEntry([], entry());
    for (let i = 1; i <= 4; i++) out = foldEntry(out, entry({ time: 1_000_000 + i }));

    expect(out[0].count).toBe(5);
  });

  it('carries the newest time, not the first', () => {
    // The report is read for "when did this last happen".
    const first = foldEntry([], entry());
    const out = foldEntry(first, entry({ time: 1_030_000 }));

    expect(out[0].time).toBe(1_030_000);
  });

  it('appends again once the window has passed', () => {
    const first = foldEntry([], entry());
    const out = foldEntry(first, entry({ time: 1_000_000 + DEDUPE_WINDOW_MS }));

    expect(out).toHaveLength(2);
  });

  it('does not fold two different messages together', () => {
    const first = foldEntry([], entry());
    const out = foldEntry(first, entry({ message: 'something else' }));

    expect(out).toHaveLength(2);
  });

  it('does not fold a warning into an error of the same words', () => {
    const first = foldEntry([], entry({ level: 'warn' }));
    const out = foldEntry(first, entry({ level: 'error' }));

    expect(out).toHaveLength(2);
  });

  it('moves a folded entry to the end, so a live error outranks a stale one', () => {
    // The ring drops from the front. An error still recurring must not be the
    // one thrown away because its first sighting was oldest.
    const seed = foldEntry(foldEntry([], entry({ message: 'old' })), entry({ message: 'new' }));
    const out = foldEntry(seed, entry({ message: 'old', time: 1_000_500 }));

    expect(out.map((e) => e.message)).toEqual(['new', 'old']);
  });

  it('drops the oldest once the ring is full', () => {
    let out: DiagnosticEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      out = foldEntry(out, entry({ message: `error ${i}`, time: 2_000_000 + i * 100_000 }));
    }

    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out[0].message).toBe('error 5');
    expect(out[out.length - 1].message).toBe(`error ${MAX_ENTRIES + 4}`);
  });
});

describe('recordDiagnostic — what it writes', () => {
  it('records an error with its namespace and level', async () => {
    const data = installStorage();

    recordDiagnostic('error', 'Bg', ['init error']);
    await vi.waitFor(() => expect(stored(data)).toHaveLength(1));

    expect(stored(data)[0]).toMatchObject({ level: 'error', name: 'Bg', message: 'init error' });
  });

  it('reduces an Error to its name and message, not a stack', () => {
    // A stack pasted whole helps nobody and fills the ring.
    const data = installStorage();

    recordDiagnostic('error', 'Bg', ['init error', new TypeError('boom')]);

    return vi
      .waitFor(() => expect(stored(data)).toHaveLength(1))
      .then(() => {
        expect(stored(data)[0].message).toBe('init error TypeError: boom');
      });
  });

  it('redacts on the way in, so storage never holds the secret either', async () => {
    const data = installStorage();

    recordDiagnostic('error', 'Transport', ['http://admin:hunter2@nas.local:9091/rpc failed']);
    await vi.waitFor(() => expect(stored(data)).toHaveLength(1));

    expect(JSON.stringify(data)).not.toContain('hunter2');
  });

  it('truncates a very long message rather than filling the ring with one', async () => {
    const data = installStorage();

    recordDiagnostic('error', 'Bg', ['x'.repeat(MAX_MESSAGE_LENGTH * 3)]);
    await vi.waitFor(() => expect(stored(data)).toHaveLength(1));

    expect(stored(data)[0].message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 1);
  });

  it('survives an argument that cannot be serialized', async () => {
    // A circular object, or an observable proxy that throws on read: a
    // diagnostic that breaks the thing it diagnoses is worse than none.
    const data = installStorage();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => recordDiagnostic('error', 'Bg', [circular])).not.toThrow();
    await vi.waitFor(() => expect(stored(data)).toHaveLength(1));
  });

  it('does not throw when storage refuses the write', async () => {
    // Called from inside the logger. A rejection here would be an unhandled
    // rejection reported by nothing, and reporting it through the logger would
    // call straight back into this.
    installStorage();
    vi.mocked(chrome.storage.local.set).mockImplementation(((_items: unknown, cb?: () => void) => {
      (chrome.runtime as unknown as { lastError: unknown }).lastError = { message: 'QUOTA' };
      cb?.();
      (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
    }) as never);

    expect(() => recordDiagnostic('error', 'Bg', ['boom'])).not.toThrow();
    await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalled());
  });

  it('loses nothing from a burst that lands during a write', async () => {
    // The write is a read-modify-write. Letting each arrival run its own would
    // be a burst of races; they are folded into the next pass instead.
    const data = installStorage();

    recordDiagnostic('error', 'Bg', ['first']);
    recordDiagnostic('error', 'Bg', ['second']);
    recordDiagnostic('error', 'Bg', ['third']);

    await vi.waitFor(() => expect(stored(data)).toHaveLength(3));
    expect(stored(data).map((e) => e.message)).toEqual(['first', 'second', 'third']);
  });

  it('appends to what an earlier service-worker life already wrote', async () => {
    // The whole point of local storage over session: yesterday's failure is
    // still there to report.
    const data = installStorage({
      [DIAGNOSTIC_STORAGE_KEY]: [
        { time: 1, level: 'error', name: 'Bg', message: 'yesterday' },
      ] as DiagnosticEntry[],
    });

    recordDiagnostic('error', 'Bg', ['today']);
    await vi.waitFor(() => expect(stored(data)).toHaveLength(2));

    expect(stored(data)[0].message).toBe('yesterday');
  });
});

describe('readDiagnosticLog and clear', () => {
  it('reads back what was recorded', async () => {
    installStorage({
      [DIAGNOSTIC_STORAGE_KEY]: [{ time: 1, level: 'warn', name: 'Bg', message: 'hm' }],
    });

    await expect(readDiagnosticLog()).resolves.toHaveLength(1);
  });

  it('answers with an empty log when nothing was ever written', async () => {
    installStorage();

    await expect(readDiagnosticLog()).resolves.toEqual([]);
  });

  it('answers with an empty log when the stored value is not a list', async () => {
    // Hand-edited storage, or a key collision: the pane must still open.
    installStorage({ [DIAGNOSTIC_STORAGE_KEY]: 'corrupted' });

    await expect(readDiagnosticLog()).resolves.toEqual([]);
  });

  it('answers with an empty log rather than rejecting when storage fails', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      _query: unknown,
      cb: (items: Record<string, unknown>) => void
    ) => {
      (chrome.runtime as unknown as { lastError: unknown }).lastError = { message: 'nope' };
      cb({});
      (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
    }) as never);

    await expect(readDiagnosticLog()).resolves.toEqual([]);
  });

  it('clears the stored log', async () => {
    const data = installStorage({ [DIAGNOSTIC_STORAGE_KEY]: [{ time: 1 }] });

    await clearDiagnosticLog();

    expect(data[DIAGNOSTIC_STORAGE_KEY]).toBeUndefined();
  });

  it('does not let a write already in flight land after Clear', async () => {
    // Emptying the queue does not stop a flush that already took its batch out
    // of it. Removing the key first only means the write lands afterwards and
    // puts everything straight back: Clear looked like it had worked until the
    // pane was reopened.
    //
    // The write is held open on purpose. Left to real timing this race lands
    // either way from one run to the next, and a test that catches a race only
    // sometimes is worse than no test — it passes in CI and fails at random.
    const data = installStorage();
    let releaseWrite!: () => void;
    vi.mocked(chrome.storage.local.set).mockImplementation(((
      items: Record<string, unknown>,
      cb?: () => void
    ) => {
      releaseWrite = () => {
        Object.assign(data, items);
        cb?.();
      };
    }) as never);

    recordDiagnostic('error', 'Bg', ['pending']);
    await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalled());

    const cleared = clearDiagnosticLog();
    // A macrotask boundary, so every pending microtask has run — no counting
    // ticks, and no run-to-run difference.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The invariant, stated where it can be seen: while the write is still in
    // flight, nothing may be removed. Removing here is precisely what let the
    // write land afterwards and put the entries back.
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();

    releaseWrite();
    await cleared;

    expect(chrome.storage.local.remove).toHaveBeenCalled();
    expect(stored(data)).toHaveLength(0);
  });
});

describe('formatDiagnosticReport — what gets pasted', () => {
  const entries: DiagnosticEntry[] = [
    {
      time: Date.UTC(2026, 8, 3, 10, 12, 4),
      level: 'error',
      name: 'Transport',
      message: 'HTTP 409',
    },
    { time: Date.UTC(2026, 8, 3, 10, 13, 0), level: 'warn', name: 'Bg', message: 'slow', count: 3 },
  ];

  it('leads with the environment, which is what a report is usually missing', () => {
    // The version guards branch on RPC 16, 17 and 18, and no user knows which
    // one their daemon speaks.
    const out = formatDiagnosticReport(['TEC 3.5.0', 'Transmission 4.0.5 (RPC 18)'], entries);

    expect(out.split('\n')[0]).toBe('TEC 3.5.0');
    expect(out).toContain('RPC 18');
  });

  it('carries the level, the namespace and the message on one line', () => {
    const out = formatDiagnosticReport([], entries);

    expect(out).toContain('ERROR');
    expect(out).toContain('Transport');
    expect(out).toContain('HTTP 409');
  });

  it('shows a repeat count so a fold does not read as a single event', () => {
    const out = formatDiagnosticReport([], entries);

    expect(out).toContain('(x3)');
  });

  it('does not put a count on a single occurrence', () => {
    const out = formatDiagnosticReport([], [entries[0]]);

    expect(out).not.toContain('(x');
  });

  it('timestamps to the second, since milliseconds are noise', () => {
    const out = formatDiagnosticReport([], [entries[0]]);

    expect(out).toContain('2026-09-03T10:12:04Z');
  });

  it('still gives the environment when there is nothing to report', () => {
    // An empty log is itself an answer: the failure was not one we record.
    const out = formatDiagnosticReport(['TEC 3.5.0'], []);

    expect(out).toBe('TEC 3.5.0');
  });

  it('leaves out an environment line the page could not fill in', () => {
    const out = formatDiagnosticReport(['TEC 3.5.0', '', 'Mozilla/5.0'], []);

    expect(out).toBe('TEC 3.5.0\nMozilla/5.0');
  });
});
