import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import callApi from '../callApi';
import { MESSAGE_TIMEOUT } from '../../constants';

/**
 * Every action the UI takes goes through here. It is the one place the pages
 * and the service worker actually meet, and it is four guards wide.
 *
 * The timeout is the one that matters most, and it is the one MV3 makes
 * routine. A service worker is asleep by default: it is woken by the message,
 * and if it dies mid-handler — an unhandled rejection, a torn-down port, a
 * browser that decided to reclaim it — the callback is simply never invoked.
 * Nothing rejects, nothing resolves, and the promise the page is awaiting is
 * never settled. Without the timeout, "the background did not answer" is a
 * hung UI rather than an error message.
 *
 * The `settled` flag beside it is belt and braces: a promise already ignores a
 * second settle, so the flag is not observable from the outside and the cases
 * below do not pretend to pin it. What they do pin is the outcome — a late
 * reply does not replace the timeout — and the timer being cancelled, which is
 * observable and does matter at one poll a second.
 */

const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;

/** lastError is read-only in the chrome types; the mock is a plain object. */
const setLastError = (error: { message: string } | null) => {
  (chrome.runtime as unknown as { lastError: unknown }).lastError = error;
};

/** Reply as the background does, on the next tick. */
const replyWith = (response: unknown) =>
  sendMessage.mockImplementation((_message: unknown, callback: (r: unknown) => void) => {
    setTimeout(() => callback(response), 0);
  });

/** Never call back, as a service worker that died mid-handler does not. */
const neverReply = () => sendMessage.mockImplementation(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockReset();
  setLastError(null);
});

afterEach(() => {
  vi.useRealTimers();
  setLastError(null);
});

/** Advance to just past the timeout and let the rejection settle. */
async function runOutTheClock() {
  await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT + 1);
}

describe('callApi — a background that answers', () => {
  it('returns the result the background sent', async () => {
    replyWith({ result: { torrents: [1, 2] } });

    const promise = callApi({ action: 'updateTorrentList' } as never);
    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toEqual({ torrents: [1, 2] });
  });

  it('unwraps the envelope rather than handing it over whole', async () => {
    // Every call site reads the value, not { result: value }.
    replyWith({ result: 'plain' });

    const promise = callApi({ action: 'x' } as never);
    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toBe('plain');
  });

  it('resolves undefined for an action that returns nothing', async () => {
    replyWith({ result: undefined });

    const promise = callApi({ action: 'x' } as never);
    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toBeUndefined();
  });

  it('sends a structurally cloned copy of the message', async () => {
    // Firefox will not clone a mobx model; the ids arrive as an observable
    // array from the store and have to be flattened before they cross.
    replyWith({ result: null });

    const promise = callApi({ action: 'start', ids: [1, 2] } as never);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    const sent = sendMessage.mock.calls[0][0];
    expect(sent).toEqual({ action: 'start', ids: [1, 2] });
    expect(Array.isArray(sent.ids)).toBe(true);
  });
});

describe('callApi — a background that refuses', () => {
  it('rejects with the message the background reported', async () => {
    replyWith({ error: { message: 'Connection refused' } });

    const promise = callApi({ action: 'x' } as never);
    // Attached before the clock moves: the rejection lands during the
    // advance, and with nothing listening yet it is an unhandled rejection.
    const rejects = expect(promise).rejects.toThrow('Connection refused');
    await vi.advanceTimersByTimeAsync(1);

    await rejects;
  });

  it('carries the error code across, so call sites can branch on it', async () => {
    // The whole point of ErrorWithCode: FILE_SIZE_EXCEEDED and
    // LINK_IS_NOT_SUPPORTED are handled differently from a generic failure.
    replyWith({ error: { message: 'too big', code: 'FILE_SIZE_EXCEEDED' } });

    const promise = callApi({ action: 'x' } as never);
    // Attached before the clock moves: the rejection lands during the
    // advance, and with nothing listening yet it is an unhandled rejection.
    const rejects = expect(promise).rejects.toMatchObject({ code: 'FILE_SIZE_EXCEEDED' });
    await vi.advanceTimersByTimeAsync(1);

    await rejects;
  });

  it('carries the error name, which the footer shows', async () => {
    replyWith({ error: { message: 'boom', name: 'TransmissionError' } });

    const promise = callApi({ action: 'x' } as never);
    // Attached before the clock moves: the rejection lands during the
    // advance, and with nothing listening yet it is an unhandled rejection.
    const rejects = expect(promise).rejects.toMatchObject({ name: 'TransmissionError' });
    await vi.advanceTimersByTimeAsync(1);

    await rejects;
  });

  it('rejects with something readable for an error carrying no message', async () => {
    replyWith({ error: {} });

    const promise = callApi({ action: 'x' } as never);
    // Attached before the clock moves: the rejection lands during the
    // advance, and with nothing listening yet it is an unhandled rejection.
    const rejects = expect(promise).rejects.toThrow(/Unknown error/);
    await vi.advanceTimersByTimeAsync(1);

    await rejects;
  });

  it('rejects when the messaging layer itself failed', async () => {
    // chrome.runtime.lastError, not a thrown exception: reading it is how the
    // callback style reports "there was no receiving end".
    sendMessage.mockImplementation((_message: unknown, callback: (r: unknown) => void) => {
      setLastError({ message: 'Could not establish connection' });
      callback(undefined);
    });

    await expect(callApi({ action: 'x' } as never)).rejects.toMatchObject({
      message: 'Could not establish connection',
    });
  });

  it('rejects an empty response with something the user can read', async () => {
    // A background that answers with nothing at all fails either way — without
    // the guard it is a TypeError from dereferencing undefined, which reaches
    // the footer as "Cannot read properties of undefined (reading 'error')".
    // Asserting only that it rejects would pass with the guard deleted.
    replyWith(undefined);

    const promise = callApi({ action: 'x' } as never);
    // Attached before the clock moves: the rejection lands during the
    // advance, and with nothing listening yet it is an unhandled rejection.
    const rejects = expect(promise).rejects.toThrow(/responseEmpty|Response is empty/);
    await vi.advanceTimersByTimeAsync(1);

    await rejects;
  });
});

describe('callApi — a background that never answers', () => {
  it('gives up rather than leaving the page waiting for ever', async () => {
    // The MV3 case: the worker was woken by this message and died before
    // replying, so the callback is never invoked at all.
    neverReply();

    const promise = callApi({ action: 'updateTorrentList' } as never);
    const settled = vi.fn();
    promise.then(settled, settled);

    await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT - 1);
    expect(settled).not.toHaveBeenCalled();

    await runOutTheClock();
    await expect(promise).rejects.toMatchObject({ code: 'MESSAGE_TIMEOUT' });
  });

  it('names the action that timed out', async () => {
    // One line in a log that says which call hung is the difference between a
    // reproducible report and "the extension froze".
    neverReply();

    const promise = callApi({ action: 'getTorrentDetails' } as never);
    const rejects = expect(promise).rejects.toThrow(/getTorrentDetails/);
    await runOutTheClock();

    await rejects;
  });

  it('keeps the timeout result when a reply arrives after it', async () => {
    // A woken worker can answer late.
    //
    // The `settled` flag is not what makes this hold: a promise ignores a
    // second settle on its own, so removing the flag changes nothing
    // observable here. This pins the outcome, and says as much rather than
    // claiming to pin the guard.
    let reply!: (response: unknown) => void;
    sendMessage.mockImplementation((_message: unknown, callback: (r: unknown) => void) => {
      reply = callback;
    });

    const promise = callApi({ action: 'x' } as never);
    const outcome = promise.catch((err) => err);
    await runOutTheClock();

    reply({ result: 'too late' });
    await expect(outcome).resolves.toMatchObject({ code: 'MESSAGE_TIMEOUT' });
  });

  it('cancels its timer once the background has answered', async () => {
    // Otherwise every call leaves a timer armed for three and a half minutes,
    // and a page doing one poll a second accumulates thousands.
    replyWith({ result: 'ok' });
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    const promise = callApi({ action: 'x' } as never);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
