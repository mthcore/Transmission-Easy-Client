import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storageGet, storageSet, storageRemove } from '../chromeStorage';

// Our chromeMock defines lastError as writable, but Chrome types mark it readonly.
// Use a helper to set it in tests.
const runtime = chrome.runtime as { lastError: chrome.runtime.LastError | null };

describe('chromeStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.lastError = null;
  });

  describe('storageGet', () => {
    it('resolves with stored data', async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation((_data, cb) => {
        (cb as (items: Record<string, unknown>) => void)({ key: 'value' });
      });
      const result = await storageGet('key');
      expect(result).toEqual({ key: 'value' });
    });

    it('rejects on runtime error', async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation((_data, cb) => {
        runtime.lastError = { message: 'Storage error' };
        (cb as (items: Record<string, unknown>) => void)({});
        runtime.lastError = null;
      });
      await expect(storageGet('key')).rejects.toEqual({ message: 'Storage error' });
    });

    it('defaults to local area', async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation((_data, cb) => {
        (cb as (items: Record<string, unknown>) => void)({});
      });
      await storageGet('key');
      expect(chrome.storage.local.get).toHaveBeenCalled();
    });
  });

  describe('storageSet', () => {
    it('resolves on success', async () => {
      vi.mocked(chrome.storage.local.set).mockImplementation((_data, cb) => {
        (cb as () => void)();
      });
      await expect(storageSet({ key: 'value' })).resolves.toBeUndefined();
    });

    it('rejects on runtime error', async () => {
      vi.mocked(chrome.storage.local.set).mockImplementation((_data, cb) => {
        runtime.lastError = { message: 'Quota exceeded' };
        (cb as () => void)();
        runtime.lastError = null;
      });
      await expect(storageSet({ key: 'value' })).rejects.toEqual({ message: 'Quota exceeded' });
    });
  });

  describe('storageRemove', () => {
    it('resolves on success', async () => {
      vi.mocked(chrome.storage.local.remove).mockImplementation((_keys, cb) => {
        (cb as () => void)();
      });
      await expect(storageRemove('key')).resolves.toBeUndefined();
    });

    it('removes multiple keys', async () => {
      vi.mocked(chrome.storage.local.remove).mockImplementation((_keys, cb) => {
        (cb as () => void)();
      });
      await storageRemove(['key1', 'key2']);
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        ['key1', 'key2'],
        expect.any(Function)
      );
    });

    it('rejects on runtime error', async () => {
      vi.mocked(chrome.storage.local.remove).mockImplementation((_keys, cb) => {
        runtime.lastError = { message: 'Error' };
        (cb as () => void)();
        runtime.lastError = null;
      });
      await expect(storageRemove('key')).rejects.toEqual({ message: 'Error' });
    });
  });
});
