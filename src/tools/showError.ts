import getLogger from './getLogger';

const logger = getLogger('showError');

// One toast per distinct message within this window: a Refresh against a dead
// daemon fires several parallel requests, and each failure produced its own
// identical notification.
const DEDUPE_WINDOW_MS = 2000;
const lastShown = new Map<string, number>();

/**
 * Show error notification to user and log to console.
 *
 * The toast includes the underlying error's message: without it every failure
 * read as a content-free "Unexpected error! / Error", whether the daemon
 * answered 401, 500, or malformed JSON.
 */
function showError(message: string, error?: Error): void {
  logger.error(message, error);

  if (!chrome.notifications) return;

  const detail = error?.message ? String(error.message).slice(0, 200) : '';
  const body = detail && detail !== message ? `${message}\n${detail}` : message;

  const now = Date.now();
  const last = lastShown.get(body);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
  lastShown.set(body, now);
  // The map only ever holds recent entries; drop stale ones as we go
  for (const [key, time] of lastShown) {
    if (now - time >= DEDUPE_WINDOW_MS) lastShown.delete(key);
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'assets/icons/icon_48.png',
    title: chrome.i18n.getMessage('unexpectedError') || 'Error',
    message: body,
  });
}

export default showError;
