/**
 * When a finished torrent is worth announcing.
 *
 * These rules lived inline in the middle of the poll handler, interleaved with
 * store synchronisation and the speed graph, which made them the subtlest code
 * in the service and the hardest to reason about in isolation. They are pure:
 * given the previous bookkeeping, a census of the current list and the clock,
 * they say what to announce and what to remember. Nothing here touches storage,
 * the store or chrome.
 *
 * Every branch exists because of a way this got it wrong before:
 *
 *  - Scoped to one server, so switching daemons cannot announce every finished
 *    torrent the other one holds.
 *  - Silent for one cycle with no baseline, for the same reason.
 *  - A hash stays in `completed` while its torrent is still listed, so a
 *    re-check that dips below 100% does not re-announce on the way back up.
 *  - A torrent seen for the first time already complete is announced only if it
 *    actually downloaded something AND finished recently — otherwise reopening
 *    the browser replays every completion from while it was closed.
 */

/** The fields the completion rules read. `stateText` is what the toast shows. */
export interface NotifiableTorrent {
  stateText: string;
  downloaded?: number;
  completedTime?: number;
}

/**
 * Completion bookkeeping, persisted across service-worker restarts. Keyed by
 * hashString because Transmission's numeric ids are unique only within one
 * daemon session.
 */
export interface NotifiedState {
  url: string;
  /** Hashes already notified as complete */
  completed: string[];
  /** Every hash present on the previous poll, to spot first sightings */
  known: string[];
}

/**
 * The current list, reduced to what the rules need.
 *
 * Generic in the torrent, because the rules read three fields and hand the
 * very same objects back. Fixing the type at what they read threw away
 * everything else on the way through — and the caller announces those
 * torrents, which takes an id and a name.
 */
export interface CompletionCensus<T extends NotifiableTorrent = NotifiableTorrent> {
  /** Every hash currently listed, complete or not */
  known: string[];
  /** The complete ones, in list order */
  completed: { hash: string; torrent: T }[];
}

export interface CompletionOutcome<T extends NotifiableTorrent = NotifiableTorrent> {
  /** Torrents to announce, in list order */
  notify: T[];
  nextState: NotifiedState;
  /** False when the state is unchanged, so an idle poll writes nothing */
  shouldPersist: boolean;
}

/**
 * How recently a torrent must have finished for a first-sighting completion to
 * be announced (seconds). Wide enough to cover a background poll gap and a
 * service-worker restart, short enough that a browser reopened the next day
 * doesn't replay every completion that happened meanwhile.
 */
export const COMPLETION_NOTIFY_WINDOW = 15 * 60;

export const NOTIFIED_STORAGE_KEY = '_notifiedState';

function sameHashSet(a: string[] | null, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((hash) => seen.has(hash));
}

/**
 * @param previous the last persisted bookkeeping, or null when there is none
 * @param now seconds since the epoch, from the same clock as completedTime
 */
export function decideCompletions<T extends NotifiableTorrent>(
  previous: NotifiedState | null,
  census: CompletionCensus<T>,
  url: string,
  now: number
): CompletionOutcome<T> {
  const notify: T[] = [];

  // A different server (or no state yet) means nothing here was ever "just
  // completed" — stay silent for one cycle instead of announcing every
  // finished torrent the other daemon holds
  const sameServer = previous !== null && previous.url === url;

  if (sameServer) {
    const alreadyNotified = new Set(previous.completed);
    const seenBefore = new Set(previous.known);
    for (const { hash, torrent } of census.completed) {
      if (alreadyNotified.has(hash)) continue;
      if (seenBefore.has(hash)) {
        // Watched it finish: always worth announcing
        notify.push(torrent);
        continue;
      }
      // Never seen before, yet already complete. That is either a torrent added
      // and finished between two polls (worth announcing) or one that finished
      // long ago — while the browser was closed, or added for data already on
      // disk. downloadedEver rules out the latter, completedTime rules out the
      // former; without both we stay silent.
      const downloadedSomething = (torrent.downloaded ?? 0) > 0;
      // A daemon clock ahead of the browser's makes the age negative, which
      // would pass a bare "< WINDOW" test for any completion date
      const age = now - (torrent.completedTime ?? 0);
      const completedRecently =
        typeof torrent.completedTime === 'number' &&
        torrent.completedTime > 0 &&
        age >= 0 &&
        age < COMPLETION_NOTIFY_WINDOW;
      if (downloadedSomething && completedRecently) {
        notify.push(torrent);
      }
    }
  }

  const completedHashes = census.completed.map(({ hash }) => hash);
  // Keep hashes already notified while their torrent is still listed, so a
  // re-check that dips below 100% doesn't re-notify on the way back up
  const presentHashes = new Set(census.known);
  const persistedCompleted = sameServer
    ? Array.from(
        new Set([
          ...previous.completed.filter((hash) => presentHashes.has(hash)),
          ...completedHashes,
        ])
      )
    : completedHashes;

  const nextState: NotifiedState = {
    url,
    completed: persistedCompleted,
    known: census.known,
  };

  const shouldPersist =
    !sameServer ||
    !sameHashSet(previous.completed, persistedCompleted) ||
    !sameHashSet(previous.known, census.known);

  return { notify, nextState, shouldPersist };
}
