import { storageGet, storageSet, storageRemove } from './chromeStorage';

/**
 * Cloud backup storage, chunked across several sync keys.
 *
 * chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8192 bytes, measured on
 * the JSON-serialized value) — a full config backup no longer fits in the
 * single legacy 'backup' key, so the blob is split into 'backup_<i>' chunks
 * with the chunk count in 'backupChunks'. Reads still fall back to the legacy
 * 'backup' key so pre-chunking backups stay restorable.
 */

const LEGACY_KEY = 'backup';
const COUNT_KEY = 'backupChunks';

// Serialized chunk budget, well under the 8192-byte per-item quota (which also
// counts the key name and JSON escaping overhead).
const CHUNK_BYTE_LIMIT = 6500;

const chunkKey = (index: number) => `backup_${index}`;

const CHUNK_KEY_RE = /^backup_(\d+)$/;

const serializedBytes = (value: string) => new TextEncoder().encode(JSON.stringify(value)).length;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

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
  const chunks = splitIntoChunks(value);
  const items: Record<string, unknown> = { [COUNT_KEY]: chunks.length };
  chunks.forEach((chunk, index) => {
    items[chunkKey(index)] = chunk;
  });

  const existing = await storageGet<Record<string, unknown>>(null, 'sync');
  const stale = Object.keys(existing).filter((key) => {
    if (key === LEGACY_KEY) return true;
    const match = CHUNK_KEY_RE.exec(key);
    return match !== null && Number(match[1]) >= chunks.length;
  });

  // Write first, clean up after: a failed write keeps the previous backup
  // intact, and leftover higher-index chunks are ignored by the reader.
  await storageSet(items, 'sync');
  if (stale.length) {
    await storageRemove(stale, 'sync');
  }
}

export async function loadCloudBackup(): Promise<string | null> {
  const all = await storageGet<Record<string, unknown>>(null, 'sync');

  const count = all[COUNT_KEY];
  if (typeof count === 'number' && count > 0) {
    const parts: string[] = [];
    for (let index = 0; index < count; index++) {
      const part = all[chunkKey(index)];
      if (typeof part !== 'string') {
        // Corrupted/partial chunk set — fall back to the legacy key if any
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
  const keys = Object.keys(all).filter(
    (key) => key === LEGACY_KEY || key === COUNT_KEY || CHUNK_KEY_RE.test(key)
  );
  if (keys.length) {
    await storageRemove(keys, 'sync');
  }
}
