import { describe, it, expect } from 'vitest';
import {
  decideCompletions,
  COMPLETION_NOTIFY_WINDOW,
  type CompletionCensus,
  type NotifiableTorrent,
  type NotifiedState,
} from '../completionRules';

/**
 * TorrentService.notifiedState.test.ts drives these rules through the poll
 * handler, which is what proves they are wired up. This file drives them
 * directly, which is what makes each rule readable on its own: the inputs are
 * three values and the clock, so a case here says exactly which condition it
 * is about instead of arranging a whole daemon response to get at it.
 */

const URL = 'http://nas:9091/transmission/rpc';
const OTHER = 'http://vps:9091/transmission/rpc';
const NOW = 1_700_000_000;

function torrent(name: string, extra: Partial<NotifiableTorrent> = {}): NotifiableTorrent {
  return { stateText: name, downloaded: 1024, completedTime: NOW - 10, ...extra };
}

function census(
  complete: [string, Partial<NotifiableTorrent>?][],
  incomplete: string[] = []
): CompletionCensus {
  return {
    known: [...complete.map(([hash]) => hash), ...incomplete],
    completed: complete.map(([hash, extra]) => ({ hash, torrent: torrent(hash, extra) })),
  };
}

const state = (partial: Partial<NotifiedState> = {}): NotifiedState => ({
  url: URL,
  completed: [],
  known: [],
  ...partial,
});

const announced = (outcome: { notify: NotifiableTorrent[] }) =>
  outcome.notify.map((t) => t.stateText);

describe('decideCompletions — what gets announced', () => {
  it('announces a torrent we watched finish', () => {
    const previous = state({ known: ['a'], completed: [] });
    const outcome = decideCompletions(previous, census([['a']]), URL, NOW);

    expect(announced(outcome)).toEqual(['a']);
  });

  it('announces it once, not on every later poll', () => {
    const first = decideCompletions(state({ known: ['a'] }), census([['a']]), URL, NOW);
    const second = decideCompletions(first.nextState, census([['a']]), URL, NOW + 1);

    expect(announced(first)).toEqual(['a']);
    expect(announced(second)).toEqual([]);
  });

  it('stays silent on the first poll, with no baseline to compare against', () => {
    // Otherwise every finished torrent in the library arrives at once when the
    // service worker wakes up.
    const outcome = decideCompletions(null, census([['a'], ['b']]), URL, NOW);

    expect(announced(outcome)).toEqual([]);
    expect(outcome.nextState.completed).toEqual(['a', 'b']);
  });

  it('stays silent for one cycle after switching servers', () => {
    const previous = state({ url: OTHER, known: ['a'], completed: [] });
    const outcome = decideCompletions(previous, census([['a']]), URL, NOW);

    expect(announced(outcome)).toEqual([]);
    expect(outcome.nextState.url).toBe(URL);
  });

  it('does not re-announce after a re-check dips below 100% and recovers', () => {
    // The hash stays in `completed` while the torrent is still listed, so the
    // trip back up to 100% is not a new completion.
    const done = decideCompletions(state({ known: ['a'] }), census([['a']]), URL, NOW);
    const rechecking = decideCompletions(done.nextState, census([], ['a']), URL, NOW + 1);
    const recovered = decideCompletions(rechecking.nextState, census([['a']]), URL, NOW + 2);

    expect(announced(recovered)).toEqual([]);
  });

  it('forgets a torrent once it is no longer listed', () => {
    // Removed and re-added is a genuinely new download, so the bookkeeping must
    // not keep the hash forever.
    const done = decideCompletions(state({ known: ['a'] }), census([['a']]), URL, NOW);
    const gone = decideCompletions(done.nextState, census([]), URL, NOW + 1);

    expect(gone.nextState.completed).toEqual([]);
  });
});

describe('decideCompletions — a torrent seen for the first time already complete', () => {
  const seenBefore = state({ known: ['other'], completed: [] });

  it('announces it when it downloaded something and finished just now', () => {
    // Added and finished between two polls.
    const outcome = decideCompletions(seenBefore, census([['a']]), URL, NOW);

    expect(announced(outcome)).toEqual(['a']);
  });

  it('stays silent when it finished before the window', () => {
    // Finished while the browser was closed.
    const old = census([['a', { completedTime: NOW - COMPLETION_NOTIFY_WINDOW - 1 }]]);

    expect(announced(decideCompletions(seenBefore, old, URL, NOW))).toEqual([]);
  });

  it('announces it right at the edge of the window', () => {
    const edge = census([['a', { completedTime: NOW - COMPLETION_NOTIFY_WINDOW + 1 }]]);

    expect(announced(decideCompletions(seenBefore, edge, URL, NOW))).toEqual(['a']);
  });

  it('stays silent when nothing was downloaded', () => {
    // Added for data already on disk: complete immediately, never downloaded.
    const local = census([['a', { downloaded: 0 }]]);

    expect(announced(decideCompletions(seenBefore, local, URL, NOW))).toEqual([]);
  });

  it('stays silent when the daemon clock is ahead of the browser', () => {
    // A negative age would pass a bare `age < WINDOW` test for ANY completion
    // date, including one from last year.
    const skewed = census([['a', { completedTime: NOW + 3600 }]]);

    expect(announced(decideCompletions(seenBefore, skewed, URL, NOW))).toEqual([]);
  });

  it('stays silent when the daemon reports no completion time', () => {
    expect(
      announced(decideCompletions(seenBefore, census([['a', { completedTime: 0 }]]), URL, NOW))
    ).toEqual([]);
  });
});

describe('decideCompletions — when the bookkeeping is worth writing', () => {
  it('does not persist an idle poll that changed nothing', () => {
    const done = decideCompletions(state({ known: ['a'] }), census([['a']]), URL, NOW);
    const idle = decideCompletions(done.nextState, census([['a']]), URL, NOW + 1);

    expect(idle.shouldPersist).toBe(false);
  });

  it('persists when a torrent appears', () => {
    const done = decideCompletions(state({ known: ['a'] }), census([['a']]), URL, NOW);
    const grew = decideCompletions(done.nextState, census([['a']], ['b']), URL, NOW + 1);

    expect(grew.shouldPersist).toBe(true);
  });

  it('persists when there was no baseline at all', () => {
    expect(decideCompletions(null, census([]), URL, NOW).shouldPersist).toBe(true);
  });

  it('ignores ordering when deciding whether anything changed', () => {
    // The daemon does not promise a stable list order; reordering alone must
    // not cause a storage write on every poll.
    const previous = state({ known: ['a', 'b'], completed: ['a', 'b'] });
    const reordered: CompletionCensus = {
      known: ['b', 'a'],
      completed: [
        { hash: 'b', torrent: torrent('b') },
        { hash: 'a', torrent: torrent('a') },
      ],
    };

    expect(decideCompletions(previous, reordered, URL, NOW).shouldPersist).toBe(false);
  });
});
