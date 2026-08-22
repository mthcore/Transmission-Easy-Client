import { vi } from 'vitest';
import enMessagesJson from '../_locales/en/messages.json';

// The real locale table, so a getMessage() for a key that does not exist
// behaves like production (empty string) instead of echoing the key back
const enMessages = enMessagesJson as Record<string, { message: string }>;

const i18nOverrides: Record<string, string> = {
  sizeList: '["B", "kB", "MB", "GB", "TB", "PB", "EB"]',
  sizePsList: '["B/s", "kB/s", "MB/s", "GB/s", "TB/s", "PB/s", "EB/s"]',
  timeOutList: '["w", "d", "h", "m", "s"]',
};

const chromeMock = {
  i18n: {
    // Mirrors the real API: an unknown key returns '' (NOT the key), so code
    // written as `getMessage(a) || getMessage(b)` takes the same branch under
    // test as in production and a deleted locale key shows up as a failure.
    getMessage: (key: string) => i18nOverrides[key] ?? (enMessages[key] ? key : ''),
    getUILanguage: () => 'en',
  },
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    lastError: null as chrome.runtime.LastError | null,
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    openOptionsPage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  // Callback-style by default, like the real API on both Chrome and Firefox
  // (the chrome.* namespace has no promise support on Firefox, so production
  // code must always pass a callback — the mocks have to match)
  storage: {
    local: {
      get: vi.fn((_query: unknown, cb?: (items: Record<string, unknown>) => void) => cb?.({})),
      set: vi.fn((_items: unknown, cb?: () => void) => cb?.()),
      remove: vi.fn((_keys: unknown, cb?: () => void) => cb?.()),
    },
    session: {
      get: vi.fn((_query: unknown, cb?: (items: Record<string, unknown>) => void) => cb?.({})),
      set: vi.fn((_items: unknown, cb?: () => void) => cb?.()),
      remove: vi.fn((_keys: unknown, cb?: () => void) => cb?.()),
    },
    sync: {
      get: vi.fn((_query: unknown, cb?: (items: Record<string, unknown>) => void) => cb?.({})),
      set: vi.fn((_items: unknown, cb?: () => void) => cb?.()),
      remove: vi.fn((_keys: unknown, cb?: () => void) => cb?.()),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  notifications: {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn(),
    sendMessage: vi.fn(),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
  declarativeNetRequest: {
    updateDynamicRules: vi.fn((_options: unknown, cb?: () => void) => cb?.()),
  },
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  },
};

Object.assign(globalThis, { chrome: chromeMock });
