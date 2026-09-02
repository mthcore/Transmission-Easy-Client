import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

// Focused on the menu's own behaviour: these children each pull in their own
// slice of the store and none of them takes part in what is tested here.
vi.mock('../../SearchBox', () => ({ default: () => <div data-testid="search" /> }));
vi.mock('../../LabelSelect', () => ({ default: () => <div data-testid="labels" /> }));
vi.mock('../../ComponentLoader', () => ({ default: () => <div data-testid="graph" /> }));
vi.mock('../../VisiblePage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const store = vi.hoisted(() => ({
  createDialog: vi.fn(),
  setRefreshing: vi.fn(),
  isRefreshing: false,
  dialogs: new Map<string, unknown>(),
  config: { showSpeedGraph: false } as unknown,
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import Menu from '../Menu';

/**
 * The toolbar. Almost every guard in it is a scar:
 *
 *  - the drop layer accepts only real file drags, because a "two dataTransfer
 *    types" test broke Firefox (its file drags carry exactly two) and let the
 *    page navigate to the dropped file, while a text-selection drag flashed a
 *    full-screen overlay for nothing;
 *  - Ctrl+O lives beside the hidden file input, because raising a bare putFiles
 *    dialog from the page-level handler produced an invisible dialog that never
 *    became ready instead of a picker;
 *  - and it declines to fire while a modal is open, while the key is
 *    auto-repeating, or while the user is typing.
 *
 * None of it was covered.
 */

afterEach(cleanup);

function makeClient() {
  return {
    settings: { altSpeedEnabled: false },
    torrentIds: [1, 2, 3],
    updateTorrentList: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    torrentsStart: vi.fn().mockResolvedValue(undefined),
    torrentsStop: vi.fn().mockResolvedValue(undefined),
    setAltSpeedEnabled: vi.fn().mockResolvedValue(undefined),
  };
}

let client: ReturnType<typeof makeClient>;

beforeEach(() => {
  showError.mockClear();
  store.createDialog.mockClear();
  store.setRefreshing.mockClear();
  store.isRefreshing = false;
  store.dialogs = new Map();
  store.config = { showSpeedGraph: false };
  client = makeClient();
  store.client = client;
});

const draw = () => render(<Menu />);

const button = (label: string) => screen.getByLabelText(label);

/** A dataTransfer carrying the given types, as a real OS drag would. */
function transfer(types: string[], files: unknown[] = []) {
  return { types, files };
}

function bodyDrag(event: 'dragover' | 'drop', types: string[], files: unknown[] = []) {
  const e = new Event(event, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: transfer(types, files) });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
}

const dropLayer = () => document.querySelector('.drop_layer');

describe('Menu — accepting dropped files', () => {
  it('shows the drop layer for a real file drag', () => {
    draw();
    bodyDrag('dragover', ['Files']);

    expect(dropLayer()).not.toBeNull();
  });

  it('ignores a drag that carries no files', () => {
    // A text selection dragged across the window used to flash the full-screen
    // overlay for nothing.
    draw();
    bodyDrag('dragover', ['text/plain']);

    expect(dropLayer()).toBeNull();
  });

  it('accepts the Firefox file drag, which carries two types', () => {
    // The old guard read "exactly two types" as a column-header drag. Firefox
    // file drags carry ['application/x-moz-file', 'Files'], so the drop was not
    // handled and the page navigated to the file instead.
    draw();
    bodyDrag('dragover', ['application/x-moz-file', 'Files']);

    expect(dropLayer()).not.toBeNull();
  });

  it('claims the drop, so the browser does not navigate to the file', () => {
    draw();
    const event = bodyDrag('drop', ['Files'], [{ name: 'a.torrent' }]);

    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a non-file drop to the page', () => {
    // A column-header drag really is delivered here, and handling it latched
    // the dropped state — the next genuine drag then opened already dropped.
    draw();
    const event = bodyDrag('drop', ['text/html']);

    expect(event.defaultPrevented).toBe(false);
    expect(store.createDialog).not.toHaveBeenCalled();
  });

  it('raises the putFiles dialog with the dropped files', () => {
    const dialog = { setFiles: vi.fn(), setReady: vi.fn() };
    store.createDialog.mockReturnValue(dialog);
    draw();
    bodyDrag('drop', ['Files'], [{ name: 'a.torrent' }]);

    expect(store.createDialog).toHaveBeenCalledWith({ type: 'putFiles' });
    expect(dialog.setFiles).toHaveBeenCalledWith([{ name: 'a.torrent' }]);
    // The renderer waits for this: without it the dialog never appears
    expect(dialog.setReady).toHaveBeenCalledWith(true);
  });

  it('raises no dialog for an empty file list', () => {
    draw();
    bodyDrag('drop', ['Files'], []);

    expect(store.createDialog).not.toHaveBeenCalled();
  });
});

describe('Menu — the Ctrl+O shortcut', () => {
  const press = (init: Partial<KeyboardEventInit> & { target?: Element } = {}) => {
    const { target, ...rest } = init;
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...rest,
    });
    act(() => {
      (target ?? document.body).dispatchEvent(event);
    });
    return event;
  };

  it('opens the file picker', () => {
    draw();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.fn();
    input.addEventListener('click', clicked);

    expect(press().defaultPrevented).toBe(true);
    expect(clicked).toHaveBeenCalled();
  });

  it('stays out of the way while the user is typing', () => {
    draw();
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);

    expect(press({ target: field }).defaultPrevented).toBe(false);
  });

  it('still fires when focus sits on a checkbox', () => {
    // A focused checkbox is an INPUT too: the coarse tagName test killed this
    // shortcut for the rest of the session after one click on a row checkbox.
    draw();
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);

    expect(press({ target: box }).defaultPrevented).toBe(true);
  });

  it('does not re-open the picker on auto-repeat', () => {
    draw();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.fn();
    input.addEventListener('click', clicked);

    press({ repeat: true });

    expect(clicked).not.toHaveBeenCalled();
  });

  it('declines while a modal is open', () => {
    // Stacking a picker over a dialog, and a second dialog behind it, is never
    // what the user meant.
    store.dialogs = new Map([['dialog_1', {}]]);
    draw();

    expect(press().defaultPrevented).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = draw();
    unmount();

    expect(press().defaultPrevented).toBe(false);
  });
});

describe('Menu — refreshing', () => {
  it('refreshes both the list and the settings', async () => {
    draw();
    await act(async () => {
      fireEvent.click(button('refresh'));
    });

    expect(client.updateTorrentList).toHaveBeenCalledWith(true);
    expect(client.updateSettings).toHaveBeenCalled();
    expect(store.setRefreshing).toHaveBeenNthCalledWith(1, true);
    expect(store.setRefreshing).toHaveBeenLastCalledWith(false);
  });

  it('reports a failure and still clears the refreshing flag', async () => {
    // Left set, the button would stay disabled for the rest of the session.
    //
    // This pins the observable outcome, not the `finally` that produces it:
    // both inner promises carry their own catch, so Promise.all never rejects
    // and the flag would also be cleared by a plain call after the try. The
    // `finally` is what keeps that true if an inner catch is ever removed.
    client.updateTorrentList.mockRejectedValueOnce(new Error('daemon said 500'));
    draw();
    await act(async () => {
      fireEvent.click(button('refresh'));
    });

    expect(showError).toHaveBeenCalled();
    expect(store.setRefreshing).toHaveBeenLastCalledWith(false);
  });

  it('ignores a second click while one refresh is in flight', () => {
    store.isRefreshing = true;
    draw();
    fireEvent.click(button('refresh'));

    expect(client.updateTorrentList).not.toHaveBeenCalled();
  });
});

describe('Menu — the whole-list actions', () => {
  it('toggles alternative speed to the opposite of the current setting', () => {
    draw();
    fireEvent.click(button('altSpeedEnable'));

    expect(client.setAltSpeedEnabled).toHaveBeenCalledWith(true);
  });

  it('starts every torrent in the list', () => {
    draw();
    fireEvent.click(button('STM_TORRENTS_RESUMEALL'));

    expect(client.torrentsStart).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('stops every torrent in the list', () => {
    draw();
    fireEvent.click(button('STM_TORRENTS_PAUSEALL'));

    expect(client.torrentsStop).toHaveBeenCalledWith([1, 2, 3]);
  });

  it.each([
    ['STM_TORRENTS_RESUMEALL', 'torrentsStart'],
    ['STM_TORRENTS_PAUSEALL', 'torrentsStop'],
  ])('reports a refused %s instead of failing silently', async (label, method) => {
    (client[method as 'torrentsStart'] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('daemon said 500')
    );
    draw();
    await act(async () => {
      fireEvent.click(button(label));
    });

    expect(showError).toHaveBeenCalledTimes(1);
  });

  it('reports a refused alt-speed toggle instead of failing silently', async () => {
    client.setAltSpeedEnabled.mockRejectedValueOnce(new Error('daemon said 500'));
    draw();
    await act(async () => {
      fireEvent.click(button('altSpeedEnable'));
    });

    expect(showError).toHaveBeenCalledTimes(1);
  });
});

describe('Menu — before the config arrives', () => {
  it('renders nothing rather than a toolbar of dead buttons', () => {
    store.config = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});
