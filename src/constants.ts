/**
 * Application constants
 */

// Speed menu
export const SPEED_ARRAY_COUNT = 10;
export const DEFAULT_SPEED_LIMIT = 512;

// Animation
export const ANIMATION_TIME_MULTIPLIER = 3.5;

// Progress bar calculation
export const PROGRESS_LIGHT_DENOMINATOR = 10000;

// Space watcher
export const SPACE_WATCHER_INTERVAL = 60 * 1000; // 1 minute

// Directory select special indices
export const CUSTOM_PATH_INDEX = -2;
export const DEFAULT_PATH_INDEX = -1;

// Update intervals (ms)
export const BG_UPDATE_INTERVAL = 120000; // 2 minutes
export const UI_UPDATE_INTERVAL = 1000; // 1 second
// Floor applied wherever an interval is READ, so a bad value persisted by an
// older build can't drive the polling loops at millisecond rates
export const MIN_UI_UPDATE_INTERVAL = 100;
export const MIN_BG_UPDATE_INTERVAL = 1000;

// File size limits
export const MAX_FETCH_SIZE = 1024 * 1024 * 10; // 10 MB

// Messaging
export const FETCH_TIMEOUT = 30_000; // 30 seconds
// Downloading a .torrent is not an RPC round-trip: the file can be megabytes
// and the deadline now spans the body read, so a link slower than ~2.7 Mbit/s
// would fail under FETCH_TIMEOUT.
export const DOWNLOAD_TIMEOUT = 120_000; // 2 minutes
// blocklist-update blocks while the daemon fetches and parses the list.
// Kept well under MESSAGE_TIMEOUT: the page gives up at that point, and the
// call is followed by a settings refresh, so the whole exchange must fit.
export const BLOCKLIST_UPDATE_TIMEOUT = 120_000; // 2 minutes
// The UI-side message timeout is only a backstop for a hung background
// handler (a dead service worker rejects sendMessage immediately). The
// transport now bounds a WHOLE exchange — every retry and the 409 token
// refresh included — at its per-call timeout plus RETRY_BUDGET_MS (15s), so
// the old "4 attempts plus backoff, twice" worst case no longer exists. What
// remains is one blocklist-update (120s + 15s) followed by the settings
// refresh it chains (30s + 15s) = 180s, plus head-room. Below that the UI
// reports failure for operations the background later completes, prompting
// harmful retries.
export const MESSAGE_TIMEOUT = 210_000;

// Daemon
export const DAEMON_MAX_RETRIES = 3;

// Tables — shared by both resize implementations (header columns and the
// torrent-details peer/tracker tables)
export const MIN_COLUMN_WIDTH = 24;

// TransmissionClient
export const RECENTLY_ACTIVE_THRESHOLD = 60; // seconds
export const FILE_PRIORITY_CHUNK_SIZE = 250;
