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
