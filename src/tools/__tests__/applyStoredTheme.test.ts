import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storageGet = vi.hoisted(() => vi.fn());
vi.mock('../chromeStorage', () => ({ storageGet, storageSet: vi.fn() }));

import applyStoredTheme, { applyLocaleDirection } from '../applyStoredTheme';

/**
 * Both of these run before React, straight off the module, because both fix
 * something that is wrong for as long as they wait.
 *
 * The theme comes from storage directly rather than through the store: useTheme
 * cannot run until RootStore.init() has round-tripped through the service
 * worker, and until then no data-theme exists and the CSS falls back to
 * prefers-color-scheme — so a user whose chosen theme is the opposite of their
 * OS setting saw a wrong-theme flash on every open.
 *
 * The direction is set because the pages hardcode lang="en" and never set dir,
 * so the Hebrew locale rendered inside an LTR document: punctuation and numbers
 * landed on the wrong side of every string, and screen readers read Hebrew with
 * an English voice.
 */

const root = () => document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  root().removeAttribute('data-theme');
  root().removeAttribute('dir');
  root().removeAttribute('lang');
  storageGet.mockResolvedValue({ theme: 'system' });
});

afterEach(() => {
  root().removeAttribute('data-theme');
  root().removeAttribute('dir');
  root().removeAttribute('lang');
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('applyStoredTheme', () => {
  it('stamps an explicit theme on the document', async () => {
    storageGet.mockResolvedValue({ theme: 'dark' });
    applyStoredTheme();
    await settle();

    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('stamps nothing for "system", so the OS preference decides', async () => {
    storageGet.mockResolvedValue({ theme: 'system' });
    applyStoredTheme();
    await settle();

    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('asks storage with "system" as the default', async () => {
    // A profile that never chose a theme must not be read as an empty string.
    applyStoredTheme();

    expect(storageGet).toHaveBeenCalledWith({ theme: 'system' });
  });

  it('leaves the OS preference in charge when storage cannot be read', async () => {
    // Falling back is the same behaviour as before this existed.
    //
    // The failure this guards against is a REJECTION, not a throw: nothing
    // awaits this call, so an unhandled rejection is the only trace it would
    // leave. A "does not throw" assertion cannot see that, which is why the
    // process listener is here.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    storageGet.mockRejectedValue(new Error('storage unavailable'));

    applyStoredTheme();
    await settle();
    await settle();
    process.off('unhandledRejection', onUnhandled);

    expect(unhandled).toEqual([]);
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('does not stamp an empty theme', async () => {
    storageGet.mockResolvedValue({ theme: '' });
    applyStoredTheme();
    await settle();

    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});

describe('applyLocaleDirection', () => {
  it('marks the document with the interface locale', () => {
    // The pages hardcode lang="en", so a screen reader read Hebrew with an
    // English voice.
    applyLocaleDirection();

    expect(root().getAttribute('lang')).toBe('en');
  });

  it('lays the page out left to right for an LTR locale', () => {
    applyLocaleDirection();

    expect(root().getAttribute('dir')).toBe('ltr');
  });

  it('lays it out right to left when the locale says so', () => {
    // @@bidi_dir is how the i18n system reports it; without this, Hebrew
    // rendered inside an LTR document and its punctuation and numbers landed
    // on the wrong side of every string.
    const getMessage = vi
      .spyOn(chrome.i18n, 'getMessage')
      .mockImplementation((key: string) => (key === '@@bidi_dir' ? 'rtl' : ''));
    applyLocaleDirection();
    getMessage.mockRestore();

    expect(root().getAttribute('dir')).toBe('rtl');
  });

  it('treats anything other than "rtl" as left to right', () => {
    const getMessage = vi
      .spyOn(chrome.i18n, 'getMessage')
      .mockImplementation(() => 'something else');
    applyLocaleDirection();
    getMessage.mockRestore();

    expect(root().getAttribute('dir')).toBe('ltr');
  });

  it('falls back to English when the browser reports no UI language', () => {
    const getUILanguage = vi
      .spyOn(chrome.i18n, 'getUILanguage')
      .mockReturnValue(undefined as unknown as string);
    applyLocaleDirection();
    getUILanguage.mockRestore();

    expect(root().getAttribute('lang')).toBeTruthy();
  });
});
