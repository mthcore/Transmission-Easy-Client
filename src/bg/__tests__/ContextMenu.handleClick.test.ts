import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBgForContextMenu, Folder } from '../../types';

vi.mock('../../tools/downloadFileFromTab', () => ({ default: vi.fn() }));
vi.mock('../../tools/downloadFileFromUrl', () => ({ default: vi.fn() }));
vi.mock('../../tools/captureTorrentFromTab', () => ({ default: vi.fn() }));

import ContextMenu from '../ContextMenu';
import downloadFileFromTab from '../../tools/downloadFileFromTab';
import captureTorrentFromTab from '../../tools/captureTorrentFromTab';

/**
 * What happens when the browser's own context menu is used. The entry is built
 * once and then clicked later, so everything here is about a click arriving
 * against a world that may have moved on.
 *
 * The menu item's id carries its meaning as JSON, and the folder entries carry
 * an INDEX into the configured folder list. If that list changed between the
 * menu being built and the click landing, the index points somewhere else — or
 * nowhere. Sending the torrent to the daemon's default directory would be
 * silent and wrong, so it is reported instead.
 */

/** A right-clicked LINK is fetched through the tab that holds it. */
const fetchLink = downloadFileFromTab as unknown as ReturnType<typeof vi.fn>;
/** A right-clicked page is captured from the tab's own download. */
const capture = captureTorrentFromTab as unknown as ReturnType<typeof vi.fn>;

let putTorrent: ReturnType<typeof vi.fn>;
let torrentErrorNotify: ReturnType<typeof vi.fn>;
let whenReady: ReturnType<typeof vi.fn>;
let folders: Folder[];

function createMenu(): ContextMenu {
  putTorrent = vi.fn().mockResolvedValue(undefined);
  torrentErrorNotify = vi.fn();
  whenReady = vi.fn().mockResolvedValue(undefined);
  const bg = {
    bgStore: {
      requireConfig: () => ({
        folders,
        treeViewContextMenu: true,
        putDefaultPathInContextMenu: false,
        selectDownloadCategoryAfterPutTorrentFromContextMenu: false,
        hasFolder: vi.fn(),
        addFolder: vi.fn(),
        setSelectedLabel: vi.fn(),
      }),
    },
    client: { putTorrent },
    whenReady,
    torrentErrorNotify,
  } as unknown as IBgForContextMenu;
  return new ContextMenu(bg);
}

const TAB = { id: 12 } as chrome.tabs.Tab;

const id = (info: Record<string, unknown>) => JSON.stringify(info);

function click(menu: ContextMenu, info: Record<string, unknown>, tab: chrome.tabs.Tab | undefined) {
  return menu.handleClick(info as unknown as chrome.contextMenus.OnClickData, tab);
}

beforeEach(() => {
  vi.clearAllMocks();
  folders = [
    { name: 'Films', path: '/mnt/films' },
    { name: 'Séries', path: '/mnt/series' },
  ] as Folder[];
  // A URL rather than a blob: addData's "is this a torrent" check is covered
  // in its own file, and it is the directory that matters here.
  fetchLink.mockResolvedValue({ url: 'https://x/a.torrent' });
  capture.mockResolvedValue({ url: 'https://x/captured.torrent' });
});

afterEach(() => vi.clearAllMocks());

describe('ContextMenu.handleClick — the default entry', () => {
  it('fetches a right-clicked link', async () => {
    const menu = createMenu();
    await click(
      menu,
      { menuItemId: id({ type: 'action', name: 'default' }), linkUrl: 'https://x/a.torrent' },
      TAB
    );

    expect(fetchLink).toHaveBeenCalledWith('https://x/a.torrent', 12, undefined);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures from the page when there was no link', async () => {
    // Modern trackers download through a JavaScript button with no href at
    // all, so the page context has to work without one.
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'action', name: 'default' }) }, TAB);

    expect(capture).toHaveBeenCalled();
  });

  it('waits for the background to be ready before acting', async () => {
    // The click can wake a service worker that has no daemon connection yet.
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'action', name: 'default' }) }, TAB);

    expect(whenReady).toHaveBeenCalled();
  });

  it('does nothing without a tab to act in', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'action', name: 'default' }) }, undefined);

    expect(capture).not.toHaveBeenCalled();
    expect(fetchLink).not.toHaveBeenCalled();
  });

  it('acts in the frame the click came from', async () => {
    // A tracker's download button often lives in an iframe; capturing from the
    // top frame would find nothing.
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'action', name: 'default' }), frameId: 7 }, TAB);

    expect(capture).toHaveBeenCalledWith(12, 7);
  });
});

describe('ContextMenu.handleClick — a folder entry', () => {
  const folderId = (index: number) => id({ type: 'folder', index });

  it('sends a link to the chosen folder', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: folderId(1), linkUrl: 'https://x/a.torrent' }, TAB);

    expect(putTorrent).toHaveBeenCalledWith(expect.anything(), '/mnt/series');
  });

  it('captures to the chosen folder when there is no link', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: folderId(0) }, TAB);

    expect(capture).toHaveBeenCalledWith(12, undefined);
    expect(putTorrent).toHaveBeenCalledWith(expect.anything(), '/mnt/films');
  });

  it('reports a folder that has gone rather than using the default directory', async () => {
    // The folder list changed after this menu was built. Falling through to
    // the daemon's default is silent and wrong: the torrent lands somewhere
    // the user did not choose and nothing says so.
    const menu = createMenu();
    await click(menu, { menuItemId: folderId(9) }, TAB);

    expect(torrentErrorNotify).toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(fetchLink).not.toHaveBeenCalled();
  });

  it('does nothing for a folder entry carrying no index', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'folder' }) }, TAB);

    expect(capture).not.toHaveBeenCalled();
    expect(torrentErrorNotify).not.toHaveBeenCalled();
  });

  it('does nothing without a tab', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: folderId(0) }, undefined);

    expect(capture).not.toHaveBeenCalled();
  });
});

describe('ContextMenu.handleClick — ids and failures', () => {
  it('ignores an id that is not the JSON it writes', async () => {
    // Another extension's menu entry, or one left over from an older build.
    const menu = createMenu();

    await expect(click(menu, { menuItemId: 'not json' }, TAB)).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('ignores a type it does not know', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'somethingElse' }) }, TAB);

    expect(capture).not.toHaveBeenCalled();
    expect(torrentErrorNotify).not.toHaveBeenCalled();
  });

  it('ignores an action name it does not know', async () => {
    const menu = createMenu();
    await click(menu, { menuItemId: id({ type: 'action', name: 'somethingElse' }) }, TAB);

    expect(capture).not.toHaveBeenCalled();
  });

  it('swallows a failure rather than rejecting into the event listener', async () => {
    // This is a chrome.contextMenus.onClicked handler: an unhandled rejection
    // here is reported against the whole extension and tells the user nothing.
    capture.mockRejectedValueOnce(new Error('daemon said 500'));
    const menu = createMenu();

    await expect(
      click(menu, { menuItemId: id({ type: 'action', name: 'default' }) }, TAB)
    ).resolves.toBeUndefined();
  });

  it('registers itself once, however many times it is constructed', async () => {
    // A service worker restart rebuilds this; a second listener would fetch
    // every right-clicked torrent twice.
    const hasListener = chrome.contextMenus.onClicked.hasListener as unknown as ReturnType<
      typeof vi.fn
    >;
    const addListener = chrome.contextMenus.onClicked.addListener as unknown as ReturnType<
      typeof vi.fn
    >;
    hasListener.mockReturnValueOnce(false).mockReturnValueOnce(true);

    createMenu();
    const before = addListener.mock.calls.length;
    createMenu();

    expect(addListener.mock.calls.length).toBe(before);
  });
});
