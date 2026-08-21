import { configKeys } from '../stores/ConfigStore';

/**
 * Transient/local-only keys that never belong in a backup blob.
 * Everything the background writes for its own bookkeeping starts with '_',
 * and the prefix is matched too so renaming one of these can't silently leak
 * it into every backup (which happened when _notifiedIds became _notifiedState:
 * that record holds every torrent hash on the server and blew the sync quota).
 */
export const BACKUP_EXCLUDE_KEYS = ['_notifiedIds', '_activeIds', '_notifiedState'];

const isTransientKey = (key: string) => key.startsWith('_');

/**
 * Keys whose change repoints the extension at another server or changes where
 * credentials are sent. webPathname decides the path the Basic-auth header is
 * injected on, so a backup widening it must be confirmed like a host change.
 */
export const CONNECTION_KEYS = [
  'hostname',
  'port',
  'ssl',
  'pathname',
  'webPathname',
  'login',
  'authenticationRequired',
] as const;

// Note: the 'backup' key (the cloud copy, sync area only) is deliberately NOT
// allowed — letting it into local storage would nest stale blobs into every
// subsequent backup until the sync quota is exceeded.
const RESTORE_ALLOWED_KEYS = new Set<string>([...configKeys, 'configVersion']);

/**
 * Allowlist-filter a parsed restore blob against the known config keys, so a
 * crafted or corrupted backup can't seed arbitrary storage entries.
 */
export function sanitizeRestoreConfig(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  droppedKeys: string[];
} {
  const result: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (
      RESTORE_ALLOWED_KEYS.has(key) &&
      !BACKUP_EXCLUDE_KEYS.includes(key) &&
      !isTransientKey(key)
    ) {
      result[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  return { config: result, droppedKeys };
}

/**
 * List human-readable connection changes ("hostname: a → b") between the
 * restored blob and the current values, so the user can confirm a restore
 * that repoints the extension at another server.
 */
export function getConnectionChanges(
  next: Record<string, unknown>,
  current: Record<string, unknown>
): string[] {
  const changes: string[] = [];
  for (const key of CONNECTION_KEYS) {
    if (next[key] !== undefined && next[key] !== current[key]) {
      changes.push(`${key}: ${String(current[key])} → ${String(next[key])}`);
    }
  }
  return changes;
}
