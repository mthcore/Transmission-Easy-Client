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

/**
 * `config` is `maybe`, because the store is built synchronously when the
 * service worker starts and the settings are read from storage afterwards.
 * Everything the background wires up — the daemon, the context menu, the
 * transmission client — is built after that read and depends on it having
 * finished.
 *
 * Each of the three used to assert that with a cast at its construction site,
 * and a cast does not assert one fact: it silences every other disagreement at
 * that seam too. Saying it here instead is what let those casts go.
 */
describe('BgStore.requireConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.lastError = null;
  });

  it('hands back the config once it is loaded', async () => {
    const store = BgStore.create({});
    await store.fetchConfig();

    expect(store.requireConfig()).toBe(store.config);
    destroy(store);
  });

  it('still hands one back when the storage read failed', async () => {
    // fetchConfig promises a default config on failure, so the consumers built
    // after it are entitled to one either way.
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

    expect(store.requireConfig().port).toBe(9091);
    destroy(store);
  });

  it('names the mistake when read before the config is loaded', () => {
    // Reached only by something wired up too early. Without the check the
    // failure is a TypeError from deep inside whichever getter ran first, in a
    // service worker with no console open.
    const store = BgStore.create({});

    expect(() => store.requireConfig()).toThrow(/before fetchConfig/);
    destroy(store);
  });
});
