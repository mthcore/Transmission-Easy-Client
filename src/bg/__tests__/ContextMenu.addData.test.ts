import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from '../ContextMenu';
import type { IBgForContextMenu } from '../../types';

/**
 * Two things this branch added had no test at the call site: the menu contexts
 * (a link-only entry never appeared on a JavaScript download button) and the
 * "is this actually a torrent" gate in addData (right-clicking a torrent's
 * TITLE link used to post the HTML page to the daemon, which answered
 * "invalid or corrupt torrent file" with no hint why). Both could be deleted
 * with the whole suite still green.
 */

const TORRENT =
  'd8:announce9:http://a/4:infod6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';

vi.mock('../../tools/downloadFileFromTab', () => ({ default: vi.fn() }));
vi.mock('../../tools/downloadFileFromUrl', () => ({ default: vi.fn() }));

import downloadFileFromTab from '../../tools/downloadFileFromTab';

const downloadMock = downloadFileFromTab as unknown as ReturnType<typeof vi.fn>;

let putTorrent: ReturnType<typeof vi.fn>;
let torrentErrorNotify: ReturnType<typeof vi.fn>;

function createMenu(): ContextMenu {
  putTorrent = vi.fn().mockResolvedValue(undefined);
  torrentErrorNotify = vi.fn();
  const bg = {
    bgStore: {
      config: {
        folders: [],
        treeViewContextMenu: true,
        putDefaultPathInContextMenu: false,
        selectDownloadCategoryAfterPutTorrentFromContextMenu: false,
        hasFolder: vi.fn(),
        addFolder: vi.fn(),
        setSelectedLabel: vi.fn(),
      },
    },
    client: { putTorrent },
    whenReady: vi.fn().mockResolvedValue(undefined),
    torrentErrorNotify,
  } as unknown as IBgForContextMenu;
  return new ContextMenu(bg);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContextMenu — menu contexts', () => {
  it('offers the entry on page, image, media and selection targets, not links alone', async () => {
    const menu = createMenu();
    await menu.create();

    const create = chrome.contextMenus.create as unknown as ReturnType<typeof vi.fn>;
    const items = create.mock.calls.map((call) => call[0] as chrome.contextMenus.CreateProperties);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      // Chrome applies 'page' only when NO more specific context matches, so an
      // image-based download button needs 'image' spelled out
      expect(item.contexts).toEqual(
        expect.arrayContaining(['link', 'page', 'image', 'video', 'audio', 'selection'])
      );
    }
  });
});

describe('ContextMenu — addData torrent gate', () => {
  it('refuses a fetched page that is not a torrent, and tells the user why', async () => {
    const menu = createMenu();
    downloadMock.mockResolvedValue({
      blob: new Blob(['<html>login page</html>'], { type: 'text/html' }),
    });

    await menu.onSendLink('https://tracker.example/torrent/42', 7, undefined);

    expect(putTorrent).not.toHaveBeenCalled();
    expect(torrentErrorNotify).toHaveBeenCalledWith('notATorrentFile');
  });

  it('passes a real torrent through to the daemon', async () => {
    const menu = createMenu();
    downloadMock.mockResolvedValue({
      blob: new Blob([TORRENT], { type: 'application/x-bittorrent' }),
    });

    await menu.onSendLink('https://tracker.example/get/42', 7, undefined);

    expect(putTorrent).toHaveBeenCalledTimes(1);
    expect(torrentErrorNotify).not.toHaveBeenCalled();
  });

  it('hands a magnet URI straight to the daemon without a torrent check', async () => {
    const menu = createMenu();
    const err = Object.assign(new Error('Link is not supported'), {
      code: 'LINK_IS_NOT_SUPPORTED',
    });
    downloadMock.mockRejectedValue(err);

    await menu.onSendLink('magnet:?xt=urn:btih:abc', 7, undefined);

    expect(putTorrent).toHaveBeenCalledWith({ url: 'magnet:?xt=urn:btih:abc' }, undefined);
  });

  it('refuses any other unsupported scheme instead of posting it as a filename', async () => {
    const menu = createMenu();
    const err = Object.assign(new Error('Link is not supported'), {
      code: 'LINK_IS_NOT_SUPPORTED',
    });
    downloadMock.mockRejectedValue(err);

    await menu.onSendLink('javascript:void(0)', 7, undefined);

    expect(putTorrent).not.toHaveBeenCalled();
    expect(torrentErrorNotify).toHaveBeenCalledWith('notATorrentFile');
  });
});
