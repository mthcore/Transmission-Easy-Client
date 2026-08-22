import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  splitIntoChunks,
  saveCloudBackup,
  loadCloudBackup,
  hasCloudBackup,
  clearCloudBackup,
} from '../cloudBackup';

// In-memory sync storage with chrome.storage get/set/remove semantics
let syncStore: Record<string, unknown>;

function installSyncStorage() {
  syncStore = {};
  vi.mocked(chrome.storage.sync.get).mockImplementation(((
    query: unknown,
    cb: (items: Record<string, unknown>) => void
  ) => {
    let result: Record<string, unknown> = {};
    if (query === null || query === undefined) {
      result = { ...syncStore };
    } else if (typeof query === 'string') {
      if (query in syncStore) result[query] = syncStore[query];
    } else if (Array.isArray(query)) {
      for (const key of query) if (key in syncStore) result[key] = syncStore[key];
    } else {
      result = { ...(query as Record<string, unknown>) };
      for (const key of Object.keys(result)) if (key in syncStore) result[key] = syncStore[key];
    }
    cb(result);
  }) as never);
  vi.mocked(chrome.storage.sync.set).mockImplementation(((
    items: Record<string, unknown>,
    cb: () => void
  ) => {
    Object.assign(syncStore, items);
    cb();
  }) as never);
  vi.mocked(chrome.storage.sync.remove).mockImplementation(((
    keys: string | string[],
    cb: () => void
  ) => {
    for (const key of ([] as string[]).concat(keys)) {
      delete syncStore[key];
    }
    cb();
  }) as never);
}

const serializedBytes = (value: string) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('splitIntoChunks', () => {
  it('returns no chunks for an empty string', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });

  it('keeps a small string in one chunk', () => {
    expect(splitIntoChunks('{"a":1}')).toEqual(['{"a":1}']);
  });

  it('splits a large blob into chunks that each fit the per-item quota', () => {
    const blob = JSON.stringify({ data: 'x'.repeat(30000) }, null, 2);
    const chunks = splitIntoChunks(blob);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(blob);
    for (const chunk of chunks) {
      // 8192 is Chrome's QUOTA_BYTES_PER_ITEM (key length included)
      expect(serializedBytes(chunk) + 'backup_99'.length).toBeLessThanOrEqual(8192);
    }
  });

  it('keeps heavily-escaped content under the quota despite inflation', () => {
    // quotes and backslashes double in size when JSON-serialized
    const blob = '"\\'.repeat(15000);
    const chunks = splitIntoChunks(blob);
    expect(chunks.join('')).toBe(blob);
    for (const chunk of chunks) {
      expect(serializedBytes(chunk)).toBeLessThanOrEqual(6500);
    }
  });

  it('does not split surrogate pairs across chunks', () => {
    const blob = '😀'.repeat(5000);
    const chunks = splitIntoChunks(blob);
    expect(chunks.join('')).toBe(blob);
    for (const chunk of chunks) {
      // a chunk boundary through a pair would leave a lone high surrogate at
      // the end of one chunk and a lone low surrogate at the start of the next
      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
  });
});

describe('cloudBackup storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.runtime as { lastError: unknown }).lastError = null;
    installSyncStorage();
  });

  it('refuses to save an empty backup and leaves the existing one intact', async () => {
    await saveCloudBackup('{"chunked":true}');
    const meta = syncStore.backupMeta as { gen: string };
    await expect(saveCloudBackup('')).rejects.toThrow('empty backup');
    await expect(saveCloudBackup('  \n ')).rejects.toThrow('empty backup');
    expect(syncStore[`backup_${meta.gen}_0`]).toBe('{"chunked":true}');
    await expect(loadCloudBackup()).resolves.toBe('{"chunked":true}');
  });

  it('round-trips a small backup through generation-tagged chunk keys', async () => {
    await saveCloudBackup('{"hostname":"nas"}');
    const meta = syncStore.backupMeta as { gen: string; chunks: number; length: number };
    expect(meta.chunks).toBe(1);
    expect(meta.length).toBe('{"hostname":"nas"}'.length);
    expect(syncStore[`backup_${meta.gen}_0`]).toBe('{"hostname":"nas"}');
    await expect(loadCloudBackup()).resolves.toBe('{"hostname":"nas"}');
    await expect(hasCloudBackup()).resolves.toBe(true);
  });

  it('round-trips a backup larger than the per-item quota', async () => {
    const blob = JSON.stringify({ data: 'x'.repeat(30000) }, null, 2);
    await saveCloudBackup(blob);
    const meta = syncStore.backupMeta as { chunks: number };
    expect(meta.chunks).toBeGreaterThan(1);
    await expect(loadCloudBackup()).resolves.toBe(blob);
  });

  it('ignores chunks from another save generation instead of mixing them', async () => {
    // chrome.storage.sync merges per key, so a concurrent save on another
    // machine can leave a losing generation's chunks behind
    await saveCloudBackup(JSON.stringify({ machine: 'A', data: 'x'.repeat(20000) }, null, 2));
    const staleGen = (syncStore.backupMeta as { gen: string }).gen;
    const blobB = JSON.stringify({ machine: 'B', data: 'y'.repeat(20000) }, null, 2);
    await saveCloudBackup(blobB);
    // simulate machine A's chunks arriving late, after B's save
    syncStore[`backup_${staleGen}_0`] = 'stale chunk from the other machine';

    await expect(loadCloudBackup()).resolves.toBe(blobB);
  });

  it('rejects a partially propagated generation rather than truncating', async () => {
    const blob = JSON.stringify({ data: 'x'.repeat(30000) }, null, 2);
    await saveCloudBackup(blob);
    const meta = syncStore.backupMeta as { gen: string; chunks: number };
    // last chunk hasn't synced yet
    delete syncStore[`backup_${meta.gen}_${meta.chunks - 1}`];

    await expect(loadCloudBackup()).resolves.toBeNull();
  });

  it('still reads a legacy single-key backup', async () => {
    syncStore.backup = '{"legacy":true}';
    await expect(loadCloudBackup()).resolves.toBe('{"legacy":true}');
    await expect(hasCloudBackup()).resolves.toBe(true);
  });

  it('still reads the pre-generation chunked format', async () => {
    syncStore.backupChunks = 2;
    syncStore.backup_0 = '{"old":';
    syncStore.backup_1 = '"format"}';
    await expect(loadCloudBackup()).resolves.toBe('{"old":"format"}');
  });

  it('reports no backup on a fresh sync area', async () => {
    await expect(loadCloudBackup()).resolves.toBeNull();
    await expect(hasCloudBackup()).resolves.toBe(false);
  });

  it('falls back to the legacy key when the chunk set is corrupted', async () => {
    syncStore.backupChunks = 2;
    syncStore.backup_0 = 'only half';
    syncStore.backup = '{"legacy":true}';
    await expect(loadCloudBackup()).resolves.toBe('{"legacy":true}');
  });

  it('removes the legacy key and every previous generation on save', async () => {
    syncStore.backup = 'old single-key backup';
    syncStore.backupChunks = 1;
    syncStore.backup_0 = 'older chunked backup';
    const big = JSON.stringify({ data: 'x'.repeat(30000) }, null, 2);
    await saveCloudBackup(big);
    const firstGen = (syncStore.backupMeta as { gen: string; chunks: number }).gen;
    const firstChunkCount = (syncStore.backupMeta as { chunks: number }).chunks;
    expect(syncStore.backup).toBeUndefined();
    expect(syncStore.backupChunks).toBeUndefined();
    expect(syncStore.backup_0).toBeUndefined();

    await saveCloudBackup('small');
    for (let index = 0; index < firstChunkCount; index++) {
      expect(syncStore[`backup_${firstGen}_${index}`]).toBeUndefined();
    }
    await expect(loadCloudBackup()).resolves.toBe('small');
  });

  it('clears legacy and chunked keys, leaving unrelated keys alone', async () => {
    syncStore.backup = 'legacy';
    syncStore.unrelated = 'keep me';
    await saveCloudBackup(JSON.stringify({ data: 'x'.repeat(30000) }, null, 2));
    await clearCloudBackup();
    expect(Object.keys(syncStore)).toEqual(['unrelated']);
    await expect(hasCloudBackup()).resolves.toBe(false);
  });
});
