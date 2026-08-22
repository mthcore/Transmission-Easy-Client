import { describe, it, expect, vi, beforeEach } from 'vitest';
import { destroy } from 'mobx-state-tree';
import BgStore from '../BgStore';

const runtime = chrome.runtime as { lastError: chrome.runtime.LastError | null };

describe('BgStore.fetchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.lastError = null;
  });

  it('falls back to a default config when the storage read fails', async () => {
    // loadConfig rejects when chrome.storage.local.get reports lastError
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      _query: unknown,
      cb: (items: Record<string, unknown>) => void
    ) => {
      runtime.lastError = { message: 'Storage backend error' };
      cb({});
      runtime.lastError = null;
    }) as never);

    const store = BgStore.create({});
    await store.fetchConfig();

    // The catch used to only log "use default config" while leaving config
    // undefined, killing the daemon autorun and every page's init
    expect(store.config).toBeDefined();
    expect(store.config?.port).toBe(9091);
    destroy(store);
  });

  it('loads the stored config on success', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      query: unknown,
      cb: (items: Record<string, unknown>) => void
    ) => {
      const base = { configVersion: 2, hostname: 'nas.local', port: 9099 };
      if (Array.isArray(query)) {
        const result: Record<string, unknown> = {};
        for (const key of query) {
          if (key in base) result[key] = base[key as keyof typeof base];
        }
        cb(result);
        return;
      }
      cb(base);
    }) as never);

    const store = BgStore.create({});
    await store.fetchConfig();

    expect(store.config?.hostname).toBe('nas.local');
    expect(store.config?.port).toBe(9099);
    destroy(store);
  });
});
