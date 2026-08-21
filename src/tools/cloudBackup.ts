import { storageGet, storageSet, storageRemove } from './chromeStorage';

/**
 * Cloud backup storage, chunked across several sync keys.
 *
 * chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8192 bytes, measured on
 * the JSON-serialized value), so a full config backup can't live in a single
 * key. The blob is split into 'backup_<gen>_<i>' chunks described by a
 * 'backupMeta' record.
 *
 * Chunk keys carry a per-save generation id because chrome.storage.sync merges
 * PER KEY: two machines saving around the same time would otherwise have their
 * chunks interleaved into one silently corrupt blob. With the generation in the
 * key, a losing generation's chunks simply don't match the winning meta, and
 * the stored length lets the reader reject a partially propagated set.
 *
 * Reads fall back to both older formats ('backupChunks' + 'backup_<i>', and the
 * original single 'backup' key) so existing cloud backups stay restorable.
 */

const LEGACY_KEY = 'backup';
const LEGACY_COUNT_KEY = 'backupChunks';
const META_KEY = 'backupMeta';

// Serialized chunk budget, well under the 8192-byte per-item quota (which also
// counts the key name and JSON escaping overhead).
const CHUNK_BYTE_LIMIT = 6500;

const LEGACY_CHUNK_KEY_RE = /^backup_(\d+)$/;
const CHUNK_KEY_RE = /^backup_[a-z0-9]+_\d+$/;

interface BackupMeta {
  gen: string;
  chunks: number;
  length: number;
}

const chunkKey = (gen: string, index: number) => `backup_${gen}_${index}`;

const serializedBytes = (value: string) => new TextEncoder().encode(JSON.stringify(value)).length;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

function newGeneration(): string {
  return Math.trunc(Math.random() * 2 ** 31).toString(36);
}

function isBackupKey(key: string): boolean {
  return (
    key === LEGACY_KEY ||
    key === LEGACY_COUNT_KEY ||
    key === META_KEY ||
    CHUNK_KEY_RE.test(key) ||
    LEGACY_CHUNK_KEY_RE.test(key)
  );
}

export function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  let rest = value;
  while (rest.length) {
    let size = Math.min(rest.length, 3000);
    // Shrink until the JSON-serialized chunk fits the per-item quota budget
    // (escaping can inflate a chunk well past its character count).
    while (size > 1 && serializedBytes(rest.slice(0, size)) > CHUNK_BYTE_LIMIT) {
      size = Math.ceil(size / 2);
    }
    // Don't split a surrogate pair across chunks
    if (size < rest.length && isHighSurrogate(rest.charCodeAt(size - 1)) && size > 1) {
      size -= 1;
    }
    chunks.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return chunks;
}

export async function saveCloudBackup(value: string): Promise<void> {
  // An accidental save of an emptied textarea must not wipe the existing
  // backup — clearing the cloud copy has its own explicit button.
  if (!value.trim()) {
    throw new Error('Cannot save an empty backup');
  }
  const gen = newGeneration();
  const chunks = splitIntoChunks(value);
  const meta: BackupMeta = { gen, chunks: chunks.length, length: value.length };
  const items: Record<string, unknown> = {};
  chunks.forEach((chunk, index) => {
    items[chunkKey(gen, index)] = chunk;
  });

  const existing = await storageGet<Record<string, unknown>>(null, 'sync');
  // Never list a key this save is about to write — the meta key name is shared
  // across generations, so cleaning it up would delete the new meta
  const written = new Set([...Object.keys(items), META_KEY]);
  const stale = Object.keys(existing).filter((key) => isBackupKey(key) && !written.has(key));

  // Chunks first, then the meta that points at them: a reader that sees the new
  // meta is guaranteed to find its chunks. The previous generation is only
  // dropped afterwards, so a failed write leaves the old backup restorable.
  const staleChunks = stale.filter((key) => key !== META_KEY);
  try {
    await storageSet(items, 'sync');
  } catch (err) {
    // Both generations don't fit in sync's ~100KB total budget. Free the old
    // chunks and retry: losing the previous copy beats being unable to save.
    if (!staleChunks.length) throw err;
    await storageRemove(staleChunks, 'sync');
    await storageSet(items, 'sync');
  }
  await storageSet({ [META_KEY]: meta }, 'sync');
  if (stale.length) {
    await storageRemove(stale, 'sync');
  }
}

export async function loadCloudBackup(): Promise<string | null> {
  const all = await storageGet<Record<string, unknown>>(null, 'sync');

  const meta = all[META_KEY] as BackupMeta | undefined;
  if (meta && typeof meta.gen === 'string' && typeof meta.chunks === 'number') {
    const parts: string[] = [];
    for (let index = 0; index < meta.chunks; index++) {
      const part = all[chunkKey(meta.gen, index)];
      if (typeof part !== 'string') {
        parts.length = 0;
        break;
      }
      parts.push(part);
    }
    if (parts.length === meta.chunks) {
      const value = parts.join('');
      // A short read means sync hasn't propagated every chunk of this
      // generation yet — better no backup than a truncated one
      if (typeof meta.length !== 'number' || value.length === meta.length) {
        return value;
      }
    }
  }

  // Pre-generation chunked format (3.3.1/3.4.0)
  const count = all[LEGACY_COUNT_KEY];
  if (typeof count === 'number' && count > 0) {
    const parts: string[] = [];
    for (let index = 0; index < count; index++) {
      const part = all[`backup_${index}`];
      if (typeof part !== 'string') {
        parts.length = 0;
        break;
      }
      parts.push(part);
    }
    if (parts.length === count) {
      return parts.join('');
    }
  }

  const legacy = all[LEGACY_KEY];
  return typeof legacy === 'string' && legacy ? legacy : null;
}

export async function hasCloudBackup(): Promise<boolean> {
  return (await loadCloudBackup()) !== null;
}

export async function clearCloudBackup(): Promise<void> {
  const all = await storageGet<Record<string, unknown>>(null, 'sync');
  const keys = Object.keys(all).filter(isBackupKey);
  if (keys.length) {
    await storageRemove(keys, 'sync');
  }
}
