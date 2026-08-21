import { storageGet } from './chromeStorage';

/**
 * Applies the stored theme as early as possible, straight from storage.
 *
 * useTheme can only run once RootStore.init() has round-tripped through the
 * service worker; until then no data-theme attribute exists and the CSS falls
 * back to prefers-color-scheme, so a user whose explicit theme is the opposite
 * of their OS setting saw a wrong-theme flash on every popup/options open.
 * A direct storage read is much faster than that round trip.
 */
/**
 * Reflects the UI locale on <html>. The pages hardcode lang="en" and never set
 * dir, so the Hebrew locale rendered inside an LTR document: punctuation and
 * numbers landed on the wrong side of each string, and screen readers read
 * Hebrew with an English voice.
 */
export function applyLocaleDirection(): void {
  const locale = chrome.i18n.getUILanguage?.() ?? 'en';
  const root = document.documentElement;
  root.setAttribute('lang', locale);
  // @@bidi_dir resolves to 'rtl' for RTL locales via the i18n system
  const bidiDir = chrome.i18n.getMessage('@@bidi_dir');
  root.setAttribute('dir', bidiDir === 'rtl' ? 'rtl' : 'ltr');
}

export default function applyStoredTheme(): void {
  storageGet<{ theme?: string }>({ theme: 'system' })
    .then(({ theme }) => {
      if (theme && theme !== 'system') {
        document.documentElement.setAttribute('data-theme', theme);
      }
    })
    .catch(() => {
      // Falls back to prefers-color-scheme, same as before
    });
}
