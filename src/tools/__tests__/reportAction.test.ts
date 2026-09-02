import { describe, it, expect, vi, beforeEach } from 'vitest';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../showError', () => ({ default: showError }));

import reportAction from '../reportAction';

/**
 * Menu items, keyboard shortcuts and the speed menus dispatch RPCs whose
 * promise nobody awaits. Before this existed, a daemon failure was an unhandled
 * rejection and the user simply saw the action not happen — no toast, no clue.
 *
 * So what is pinned here is not the happy path: it is that a rejection ALWAYS
 * reaches the user, that it never escapes as an unhandled rejection, and that
 * the three shapes a caller can legally pass are all tolerated. Every one of
 * those is a way the guard could quietly stop guarding.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  showError.mockClear();
});

describe('reportAction', () => {
  it('reports a rejection to the user', async () => {
    const failure = new Error('daemon said 401');

    reportAction(Promise.reject(failure));
    await flush();

    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it('passes the error through, so the toast can say what went wrong', async () => {
    // The whole point of the second argument: without it every failure read as
    // a content-free "action failed", whether the daemon answered 401 or 500.
    reportAction(Promise.reject(new Error('Unexpected token < in JSON')));
    await flush();

    expect(showError.mock.calls[0][1]).toMatchObject({
      message: 'Unexpected token < in JSON',
    });
  });

  it('says nothing when the action succeeds', async () => {
    reportAction(Promise.resolve({ result: 'success' }));
    await flush();

    expect(showError).not.toHaveBeenCalled();
  });

  it('tolerates undefined, which is what an absent client returns', async () => {
    // Call sites are `report(client?.doThing())`: with no client the argument
    // is undefined, and throwing here would take the whole menu handler down.
    expect(() => reportAction(undefined)).not.toThrow();
    await flush();

    expect(showError).not.toHaveBeenCalled();
  });

  it('leaves no unhandled rejection behind', async () => {
    // The failure mode this function exists to prevent. Vitest fails a suite on
    // an unhandled rejection, so an assertion alone would not prove it: the
    // process-level listener is what says the promise was really settled.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    reportAction(Promise.reject(new Error('boom')));
    await flush();
    await flush();

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(showError).toHaveBeenCalledTimes(1);
  });

  it('reports each failed action separately', async () => {
    // A menu can fire several RPCs at once (a multi-selection); each failure is
    // its own report here. Collapsing duplicates is showError's job, not this
    // function's, and doing it in both places would hide the second daemon.
    reportAction(Promise.reject(new Error('first')));
    reportAction(Promise.reject(new Error('second')));
    await flush();

    expect(showError).toHaveBeenCalledTimes(2);
  });

  it('reports a rejection that is not an Error', async () => {
    // A rejected fetch or a thrown string still has to surface rather than
    // disappear into the catch.
    reportAction(Promise.reject('plain string'));
    await flush();

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
