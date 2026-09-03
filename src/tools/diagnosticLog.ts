import { storageGet, storageSet, storageRemove } from './chromeStorage';

/**
 * A short, redacted record of what went wrong, kept so a user can hand it back.
 *
 * The service worker's console is not a channel. MV3 tears the worker down
 * after ~30s idle and the console goes with it, so by the time anyone thinks to
 * look, the failure that mattered is gone. Asking a user to open
 * chrome://extensions and catch it live is not a bug report, it is a stakeout.
 *
 * So warnings and errors are written here instead, and the Diagnostics options
 * pane reads them back. `chrome.storage.local` and not `session`: a user
 * reporting yesterday's failure should still have yesterday's failure.
 *
 * The key starts with '_', which is how this codebase marks its own
 * bookkeeping — the backup pane already skips those on the way out AND on the
 * way in, so this cannot end up nested inside a backup blob.
 */

export interface DiagnosticEntry {
  /** Epoch milliseconds of the most recent occurrence */
  time: number;
  level: 'warn' | 'error';
  /** The logger namespace, e.g. 'TorrentService' */
  name: string;
  message: string;
  /** Occurrences folded into this entry; absent means one */
  count?: number;
}

export const DIAGNOSTIC_STORAGE_KEY = '_diagnosticLog';

/** Roughly a screenful. The oldest go first. */
export const MAX_ENTRIES = 50;

/** A stack trace pasted whole helps nobody and fills the ring. */
export const MAX_MESSAGE_LENGTH = 300;

/**
 * Repeats of one message inside this window fold into a single entry with a
 * count. A daemon that has gone away fails once per poll — at one poll a
 * second, fifty identical entries would push out everything that led up to it.
 */
export const DEDUPE_WINDOW_MS = 60_000;

/**
 * Best-effort redaction, applied on the way IN rather than on the way out, so
 * the sensitive text never sits in storage either.
 *
 * These patterns catch what this extension actually handles: the daemon URL
 * (which may carry credentials inline), the Basic-auth header, and the session
 * token. They cannot catch a torrent name inside a free-form message, and
 * pretending otherwise would be the more dangerous claim — the real safeguard
 * is that the Diagnostics pane shows the log on screen, so what is copied has
 * been read first.
 */
export function redact(text: string): string {
  return (
    text
      // Keep the scheme, the port and the path: which RPC path failed, and on
      // which port, is most of the diagnostic value. The host is not.
      .replace(/\b(https?):\/\/(?:[^\s/@]+@)?[^\s/:?#]+/gi, '$1://<host>')
      .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic <redacted>')
      .replace(
        /\b(password|passwd|pwd|token|session-?id)(["']?\s*[:=]\s*["']?)([^\s,"'}&]+)/gi,
        '$1$2<redacted>'
      )
  );
}

/** One line per argument, errors reduced to name and message. */
function describe(args: unknown[]): string {
  const text = args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === 'string') return arg;
      if (arg === null || arg === undefined) return String(arg);
      try {
        return JSON.stringify(arg);
      } catch {
        // Circular, or a proxy that throws on read: the shape is not worth a
        // failed write.
        return String(arg);
      }
    })
    .join(' ');
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

/**
 * Fold an arrival into the ring.
 *
 * Exported and pure so the rules above are testable without storage: the
 * window, the count, and the bound are the parts that decide whether a log is
 * still readable after a bad night.
 */
export function foldEntry(entries: DiagnosticEntry[], arrival: DiagnosticEntry): DiagnosticEntry[] {
  const match = entries.findIndex(
    (entry) =>
      entry.level === arrival.level &&
      entry.name === arrival.name &&
      entry.message === arrival.message &&
      arrival.time - entry.time < DEDUPE_WINDOW_MS
  );

  if (match !== -1) {
    const folded = entries.slice();
    const [existing] = folded.splice(match, 1);
    // Moved to the end as well as counted: an error still recurring is more
    // current than one that stopped an hour ago, and the ring drops from the
    // front.
    folded.push({ ...existing, time: arrival.time, count: (existing.count ?? 1) + 1 });
    return folded;
  }

  const appended = entries.concat(arrival);
  return appended.length > MAX_ENTRIES ? appended.slice(appended.length - MAX_ENTRIES) : appended;
}

/**
 * Arrivals not yet written. A write is a read-modify-write, so a burst that
 * each wrote on its own would be a burst of races; instead the ones that land
 * during a write are picked up by the next pass.
 */
let queued: DiagnosticEntry[] = [];
let writing: Promise<void> | null = null;

function flush(): Promise<void> {
  if (writing) return writing;
  if (!queued.length) return Promise.resolve();

  const batch = queued;
  queued = [];

  writing = storageGet<Record<string, unknown>>(DIAGNOSTIC_STORAGE_KEY)
    .then((stored) => {
      const existing = stored?.[DIAGNOSTIC_STORAGE_KEY];
      const entries = Array.isArray(existing) ? (existing as DiagnosticEntry[]) : [];
      const next = batch.reduce(foldEntry, entries);
      return storageSet({ [DIAGNOSTIC_STORAGE_KEY]: next });
    })
    // Swallowed on purpose. This runs inside the logger: a rejection here would
    // surface as an unhandled rejection reported by nothing, and reporting it
    // through the logger would call straight back into this.
    .catch(() => {})
    .then(() => {
      writing = null;
      // Arrivals during the write above are still waiting.
      if (queued.length) return flush();
    });

  return writing;
}

/**
 * Record a warning or an error. Never throws and never rejects: it is called
 * from the logger, on paths that are already going wrong.
 */
export function recordDiagnostic(level: 'warn' | 'error', name: string, args: unknown[]): void {
  try {
    queued.push({ time: Date.now(), level, name, message: redact(describe(args)) });
    void flush();
  } catch {
    // A diagnostic that breaks the thing it is diagnosing is worse than none.
  }
}

/** Oldest first, as the pane shows them. */
export function readDiagnosticLog(): Promise<DiagnosticEntry[]> {
  return storageGet<Record<string, unknown>>(DIAGNOSTIC_STORAGE_KEY)
    .then((stored) => {
      const entries = stored?.[DIAGNOSTIC_STORAGE_KEY];
      return Array.isArray(entries) ? (entries as DiagnosticEntry[]) : [];
    })
    .catch(() => []);
}

export function clearDiagnosticLog(): Promise<void> {
  queued = [];
  // Emptying the queue is not enough. A write already in flight took its batch
  // out of the queue when it started, so it is still going to land — and
  // removing the key first just means it lands afterwards and puts everything
  // straight back. Clear looked like it had worked until the pane was
  // reopened.
  const inFlight = writing ?? Promise.resolve();
  return inFlight.then(() => storageRemove(DIAGNOSTIC_STORAGE_KEY)).catch(() => {});
}

/** Test seam: the queue is module state and outlives a single case. */
export function resetDiagnosticQueue(): void {
  queued = [];
  writing = null;
}

/** ISO to the second: milliseconds are noise in a pasted report. */
function stamp(time: number): string {
  try {
    return new Date(time).toISOString().replace(/\.\d+Z$/, 'Z');
  } catch {
    return String(time);
  }
}

/**
 * The text the Diagnostics pane shows and the user copies.
 *
 * Built here rather than in the component because it IS the deliverable — what
 * a bug report is worth depends on this being readable and on it carrying the
 * environment. A report without the daemon's RPC version is the report we get
 * today: the version guards branch on RPC 16, 17 and 18, and no user knows
 * which one they run.
 */
export function formatDiagnosticReport(environment: string[], entries: DiagnosticEntry[]): string {
  const header = environment.filter(Boolean).join('\n');
  if (!entries.length) return header;

  const lines = entries.map((entry) => {
    const repeat = entry.count && entry.count > 1 ? ` (x${entry.count})` : '';
    return `${stamp(entry.time)}  ${entry.level.toUpperCase().padEnd(5)}  ${entry.name}  ${entry.message}${repeat}`;
  });
  return `${header}\n\n${lines.join('\n')}`;
}
