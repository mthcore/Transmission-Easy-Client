import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../tools/showError', () => ({ default: showError }));

// The page mounts itself on import. The element it renders is captured here
// and driven through Testing Library instead, which is the only way to reach
// the shortcut handler — the component is not exported.
const mounted = vi.hoisted(() => ({ element: null as React.ReactElement | null }));
vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (element: React.ReactElement) => {
      mounted.element = element;
    },
    unmount: () => undefined,
  }),
}));

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../stores/RootStore', () => ({
  default: { create: () => store.current },
}));

// Everything the page draws pulls its own slice of the store; the shortcuts
// are what is under test.
vi.mock('../../components/menu/Menu', () => ({ default: () => <div /> }));
vi.mock('../../components/table/TorrentListTable', () => ({ default: () => <div /> }));
vi.mock('../../components/table/FileListTable', () => ({ default: () => <div /> }));
vi.mock('../../components/Footer', () => ({ default: () => <div /> }));
vi.mock('../../components/Interval', () => ({ default: () => <div /> }));
vi.mock('../../components/VisiblePage', () => ({ default: () => <div /> }));
vi.mock('../../components/dialogs/DialogLoader', () => ({ default: () => <div /> }));
vi.mock('../../tools/applyStoredTheme', () => ({
  default: () => undefined,
  applyLocaleDirection: () => undefined,
}));

/**
 * The popup's keyboard shortcuts. Every guard in here exists because one of
 * them fired when it should not have.
 *
 * They stand down while the user is typing — but only there: a focused
 * checkbox is an INPUT too, and clicking a row checkbox leaves focus on it, so
 * the coarse test killed select-then-Delete, the most natural flow there is.
 * They stand down behind an open dialog, where Enter could otherwise start the
 * very torrents a confirmation was about to remove. And the ones that cost an
 * RPC ignore auto-repeat, since holding the key fired dozens a second.
 */

afterEach(cleanup);

function client(overrides: Record<string, unknown> = {}) {
  return {
    torrents: new Map([
      [1, { name: 'a.iso', directory: '/d', statusCode: 4 }],
      [2, { name: 'b.iso', directory: '/d', statusCode: 0 }],
    ]),
    torrentIds: [1, 2],
    updateTorrentList: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    torrentsStart: vi.fn().mockResolvedValue(undefined),
    torrentsStop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let root: Record<string, unknown>;

async function draw(overrides: Record<string, unknown> = {}) {
  root = {
    state: 'done',
    isPopup: false,
    isRefreshing: false,
    dialogs: new Map(),
    fileList: null,
    config: { setPopupMode: vi.fn(), theme: 'system' },
    client: client(),
    torrentList: { selectedIds: [] as number[], toggleSelectAll: vi.fn() },
    init: vi.fn().mockResolvedValue(undefined),
    retryInit: vi.fn(),
    setRefreshing: vi.fn(),
    createDialog: vi.fn(),
    destroyFileList: vi.fn(),
    ...overrides,
  };
  store.current = root;
  mounted.element = null;
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import('../index');
  await act(async () => {
    render(mounted.element as React.ReactElement);
  });
}

/** Press a key on the document, as the page listens for it. */
async function press(key: string, init: Partial<KeyboardEventInit> & { target?: Element } = {}) {
  const { target, ...rest } = init;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  await act(async () => {
    (target ?? document.body).dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shortcuts — when they stand down', () => {
  it('stays quiet while the user is typing', async () => {
    await draw({ torrentList: { selectedIds: [1], toggleSelectAll: vi.fn() } });
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);

    await press('Delete', { target: field });

    expect(root.createDialog).not.toHaveBeenCalled();
  });

  it('still fires with focus on a row checkbox', async () => {
    // Clicking a row checkbox leaves focus on it, and the coarse tagName test
    // then killed select-then-Delete for the rest of the session.
    await draw({ torrentList: { selectedIds: [1], toggleSelectAll: vi.fn() } });
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);

    await press('Delete', { target: box });

    expect(root.createDialog).toHaveBeenCalled();
  });

  it('stands down behind an open dialog', async () => {
    // Enter could otherwise start the very torrents a confirmation was about
    // to remove.
    await draw({
      dialogs: new Map([['d1', {}]]),
      torrentList: { selectedIds: [1], toggleSelectAll: vi.fn() },
    });

    await press('Enter');

    expect((root.client as ReturnType<typeof client>).torrentsStop).not.toHaveBeenCalled();
  });

  it('leaves Enter to a focused button', async () => {
    // Enter activates that control; firing the shortcut too acted on the whole
    // selection behind the user's back.
    await draw({ torrentList: { selectedIds: [1], toggleSelectAll: vi.fn() } });
    const button = document.createElement('button');
    document.body.appendChild(button);

    await press('Enter', { target: button });

    expect((root.client as ReturnType<typeof client>).torrentsStop).not.toHaveBeenCalled();
  });
});

describe('shortcuts — acting on the selection', () => {
  const withSelection = (ids: number[], extra: Record<string, unknown> = {}) =>
    draw({ torrentList: { selectedIds: ids, toggleSelectAll: vi.fn() }, ...extra });

  it('Delete raises the confirm dialog with a copy of the selection', async () => {
    await withSelection([1, 2]);
    await press('Delete');

    expect(root.createDialog).toHaveBeenCalledWith({
      type: 'removeConfirm',
      torrentIds: [1, 2],
    });
  });

  it('Delete does nothing with nothing selected', async () => {
    await withSelection([]);
    await press('Delete');

    expect(root.createDialog).not.toHaveBeenCalled();
  });

  it('Enter stops the selection when any of it is running', async () => {
    // Decided on the run state, not on speed: isActive is speed-based, so a
    // started-but-idle torrent could never be paused.
    await withSelection([1, 2]);
    await press('Enter');

    expect((root.client as ReturnType<typeof client>).torrentsStop).toHaveBeenCalledWith([1, 2]);
  });

  it('Enter starts the selection when none of it is running', async () => {
    await withSelection([2]);
    await press('Enter');

    expect((root.client as ReturnType<typeof client>).torrentsStart).toHaveBeenCalledWith([2]);
  });

  it('Enter ignores auto-repeat', async () => {
    await withSelection([1]);
    await press('Enter', { repeat: true });

    expect((root.client as ReturnType<typeof client>).torrentsStop).not.toHaveBeenCalled();
  });

  it('F2 renames a single selected torrent', async () => {
    await withSelection([1]);
    await press('F2');

    expect(root.createDialog).toHaveBeenCalledWith({
      type: 'rename',
      path: 'a.iso',
      torrentIds: [1],
    });
  });

  it('F2 does nothing for several torrents at once', async () => {
    await withSelection([1, 2]);
    await press('F2');

    expect(root.createDialog).not.toHaveBeenCalled();
  });

  it('Ctrl+M moves the selection, with an empty directory rather than none', async () => {
    // The dialog's directory is a required string: a torrent removed between
    // the last sync and this keypress threw an MST typecheck error out of the
    // keydown handler.
    await withSelection([9]);
    await press('m', { ctrlKey: true });

    expect(root.createDialog).toHaveBeenCalledWith({
      type: 'move',
      directory: '',
      torrentIds: [9],
    });
  });

  it('Ctrl+I opens the details of a single selected torrent', async () => {
    await withSelection([1]);
    await press('i', { ctrlKey: true });

    expect(root.createDialog).toHaveBeenCalledWith({ type: 'torrentDetails', torrentId: 1 });
  });

  it('Ctrl+A toggles select all', async () => {
    await withSelection([]);
    const event = await press('a', { ctrlKey: true });

    expect(
      (root.torrentList as { toggleSelectAll: ReturnType<typeof vi.fn> }).toggleSelectAll
    ).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+U opens the add-URL dialog', async () => {
    await withSelection([]);
    await press('u', { ctrlKey: true });

    expect(root.createDialog).toHaveBeenCalledWith({ type: 'putUrl' });
  });
});

describe('shortcuts — the ones that cost an RPC', () => {
  it('R refreshes, once', async () => {
    await draw();
    await press('r');

    expect((root.client as ReturnType<typeof client>).updateTorrentList).toHaveBeenCalledWith(true);
    expect(root.setRefreshing).toHaveBeenCalledWith(true);
  });

  it('R ignores auto-repeat', async () => {
    // Holding the key used to fire dozens of forced full refreshes a second.
    await draw();
    await press('r', { repeat: true });

    expect((root.client as ReturnType<typeof client>).updateTorrentList).not.toHaveBeenCalled();
  });

  it('R does nothing while a refresh is already running', async () => {
    await draw({ isRefreshing: true });
    await press('r');

    expect((root.client as ReturnType<typeof client>).updateTorrentList).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+S stops everything', async () => {
    await draw();
    await press('S', { ctrlKey: true, shiftKey: true });

    expect((root.client as ReturnType<typeof client>).torrentsStop).toHaveBeenCalledWith([1, 2]);
  });

  it('Ctrl+Shift+R starts everything', async () => {
    await draw();
    await press('R', { ctrlKey: true, shiftKey: true });

    expect((root.client as ReturnType<typeof client>).torrentsStart).toHaveBeenCalledWith([1, 2]);
  });

  it('the stop-all chord ignores auto-repeat too', async () => {
    // Each repeat costs an RPC plus a chained refetch.
    await draw();
    await press('S', { ctrlKey: true, shiftKey: true, repeat: true });

    expect((root.client as ReturnType<typeof client>).torrentsStop).not.toHaveBeenCalled();
  });

  it('reports a refused stop-all rather than failing silently', async () => {
    await draw();
    (root.client as ReturnType<typeof client>).torrentsStop.mockRejectedValueOnce(
      new Error('daemon said 500')
    );
    await press('S', { ctrlKey: true, shiftKey: true });
    await act(async () => undefined);

    expect(showError).toHaveBeenCalled();
  });
});

describe('shortcuts — Escape', () => {
  it('closes the file list', async () => {
    await draw({ fileList: { id: 3 } });
    await press('Escape');

    expect(root.destroyFileList).toHaveBeenCalled();
  });

  it('leaves it alone while a dialog is open', async () => {
    // The dialogs close themselves, topmost first; closing here too would pop
    // two per press.
    await draw({ fileList: { id: 3 }, dialogs: new Map([['d1', {}]]) });
    await press('Escape');

    expect(root.destroyFileList).not.toHaveBeenCalled();
  });
});
