import { configKeys } from '../stores/ConfigStore';

/** Transient/local-only keys that never belong in a backup blob */
export const BACKUP_EXCLUDE_KEYS = ['_notifiedIds', '_activeIds'];

/** Keys that change which server the extension talks to */
export const CONNECTION_KEYS = ['hostname', 'port', 'ssl', 'pathname'] as const;

const RESTORE_ALLOWED_KEYS = new Set<string>([...configKeys, 'configVersion', 'backup']);

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
    if (RESTORE_ALLOWED_KEYS.has(key) && !BACKUP_EXCLUDE_KEYS.includes(key)) {
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
