import getLogger from '../tools/getLogger';
import downloadFileFromTab from '../tools/downloadFileFromTab';
import downloadFileFromUrl from '../tools/downloadFileFromUrl';
import captureTorrentFromTab from '../tools/captureTorrentFromTab';
import { looksLikeTorrentBuffer } from '../tools/isTorrentData';
import type { IBgForContextMenu, Folder } from '../types';

const promiseLimit = require('promise-limit');

const logger = getLogger('ContextMenu');

// 'page' as well as 'link': modern trackers download through a JavaScript
// button with no <a href> at all, so a link-only entry never showed up there
const MENU_CONTEXTS: ['link', 'page'] = ['link', 'page'];
const oneThread = promiseLimit(1);

interface MenuItemInfo {
  type: string;
  name?: string;
  index?: number;
  source?: string;
}

interface MenuItem {
  name: string;
  id: string;
  parentId?: string;
}

class ContextMenu {
  bg: IBgForContextMenu;

  constructor(bg: IBgForContextMenu) {
    this.bg = bg;

    this.bindClick();
  }

  get bgStore(): IBgForContextMenu['bgStore'] {
    return this.bg.bgStore;
  }

  bindClick(): void {
    if (!chrome.contextMenus.onClicked.hasListener(this.handleClick)) {
      chrome.contextMenus.onClicked.addListener(this.handleClick);
    }
  }

  onCreateFolder(): void {
    // prompt() doesn't exist in a MV3 service worker (it used to throw on
    // Chrome); open the options page to add a folder instead, on all browsers
    chrome.tabs.create({ url: '/options.html#/ctx' });
  }

  async onSendLink(
    url: string,
    tabId: number,
    frameId: number | undefined,
    directory?: string
  ): Promise<void> {
    // Download phase. The torrent service never sees these failures, so this
    // is the only place that can tell the user a dead link did nothing.
    let data: { blob?: Blob; url?: string };
    try {
      try {
        data = await downloadFileFromTab(url, tabId, frameId);
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (['FILE_SIZE_EXCEEDED', 'LINK_IS_NOT_SUPPORTED'].includes(error.code ?? '')) {
          throw err;
        }
        logger.error(
          'onSendLink: downloadFileFromTab error, fallback to downloadFileFromUrl',
          error.message || String(err)
        );
        data = await downloadFileFromUrl(url);
      }
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'LINK_IS_NOT_SUPPORTED') {
        // Magnet or other non-downloadable scheme: hand the URI to the daemon
        data = { url };
      } else {
        logger.error('onSendLink: download error', err);
        this.bg.torrentErrorNotify(
          error.code === 'FILE_SIZE_EXCEEDED'
            ? chrome.i18n.getMessage('fileSizeError')
            : error.message || chrome.i18n.getMessage('unexpectedError')
        );
        return;
      }
    }

    await this.addData(data, directory);
  }

  /**
   * "Add to Transmission" chosen on something that is NOT a link — a tracker's
   * JavaScript download button. The page's own download is captured and its
   * bytes added; an ancestor link falls back to the normal URL path.
   */
  async onCapture(tabId: number, frameId: number | undefined, directory?: string): Promise<void> {
    let data: { blob?: Blob; url?: string };
    try {
      data = await captureTorrentFromTab(tabId, frameId);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      logger.error('onCapture: capture error', err);
      const message =
        error.code === 'NO_TORRENT_CAPTURED' || error.code === 'NO_TARGET'
          ? chrome.i18n.getMessage('noTorrentCaptured')
          : error.code === 'NOT_A_TORRENT'
            ? chrome.i18n.getMessage('notATorrentFile')
            : error.message || chrome.i18n.getMessage('unexpectedError');
      this.bg.torrentErrorNotify(message || chrome.i18n.getMessage('unexpectedError'));
      return;
    }
    if (data.url) {
      await this.onSendLink(data.url, tabId, frameId, directory);
      return;
    }
    await this.addData(data, directory);
  }

  private async addData(data: { blob?: Blob; url?: string }, directory?: string): Promise<void> {
    // What we fetched must actually be a torrent: right-clicking a torrent's
    // TITLE link (its HTML page) used to post the page to the daemon, which
    // answered "invalid or corrupt torrent file" with no hint why
    if (data.blob) {
      const buffer = await data.blob.arrayBuffer();
      if (!looksLikeTorrentBuffer(buffer)) {
        this.bg.torrentErrorNotify(chrome.i18n.getMessage('notATorrentFile'));
        return;
      }
    }

    // Add phase: putTorrent's own catch already notifies on failure, so
    // notifying here too would report every failed add twice.
    if (!this.bg.client) {
      this.bg.torrentErrorNotify(chrome.i18n.getMessage('unexpectedError'));
      return;
    }
    try {
      await this.bg.client.putTorrent(data, directory);
    } catch (err) {
      logger.error('onSendLink: putTorrent error', err);
      return;
    }
    if (this.bgStore.config.selectDownloadCategoryAfterPutTorrentFromContextMenu) {
      this.bgStore.config.setSelectedLabel('DL', true);
    }

    // Refresh only — the torrent is already added, so a failure here must not
    // be reported as if the add had failed.
    try {
      await this.bg.client?.updateTorrents();
    } catch (err) {
      logger.error('onSendLink: updateTorrents error', err);
    }
  }

  handleClick = async (
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): Promise<void> => {
    const { menuItemId, linkUrl, frameId } = info;
    let itemInfo: MenuItemInfo;
    try {
      itemInfo = JSON.parse(menuItemId as string);
    } catch (err) {
      logger.error('Invalid menuItemId JSON', err);
      return;
    }
    try {
      switch (itemInfo.type) {
        case 'action': {
          switch (itemInfo.name) {
            case 'default': {
              await this.bg.whenReady();
              if (!tab?.id) return;
              if (linkUrl) {
                await this.onSendLink(linkUrl, tab.id, frameId);
              } else {
                // Page context: the user right-clicked a button, not a link
                await this.onCapture(tab.id, frameId);
              }
              break;
            }
            case 'createFolder': {
              await this.bg.whenReady();
              this.onCreateFolder();
              break;
            }
          }
          break;
        }
        case 'folder': {
          await this.bg.whenReady();
          if (!tab?.id || itemInfo.index === undefined) return;
          const folder = this.bgStore.config.folders[itemInfo.index];
          if (!folder) {
            // The folder list changed after this menu was built: sending the
            // torrent to the daemon's default directory would be silent and
            // wrong, so report it instead
            this.bg.torrentErrorNotify(chrome.i18n.getMessage('unexpectedError'));
            return;
          }
          if (linkUrl) {
            await this.onSendLink(linkUrl, tab.id, frameId, folder.path);
          } else {
            await this.onCapture(tab.id, frameId, folder.path);
          }
          break;
        }
      }
    } catch (err) {
      logger.error('handleClick error', err);
    }
  };

  create(): Promise<void> {
    return oneThread(async () => {
      await contextMenusRemoveAll();
      const menuId = JSON.stringify({ type: 'action', name: 'default', source: 'main' });
      await contextMenusCreate({
        id: menuId,
        title: chrome.i18n.getMessage('addInTorrentClient'),
        contexts: MENU_CONTEXTS,
      });
      await this.createFolderMenu(menuId);
    });
  }

  async createFolderMenu(parentId: string): Promise<void> {
    const folders = this.bgStore.config.folders;
    if (this.bgStore.config.treeViewContextMenu) {
      await Promise.all(
        transformFoldersToTree(folders).map((menuItem) => {
          let name = menuItem.name;
          if (name === './') {
            name = chrome.i18n.getMessage('currentDirectory');
          }
          return contextMenusCreate({
            id: menuItem.id,
            parentId: menuItem.parentId || parentId,
            title: name,
            contexts: MENU_CONTEXTS,
          });
        })
      );
    } else {
      await Promise.all(
        folders.map((folder, index) => {
          return contextMenusCreate({
            id: JSON.stringify({ type: 'folder', index }),
            parentId: parentId,
            title: folder.name || folder.path,
            contexts: MENU_CONTEXTS,
          });
        })
      );
    }

    if (folders.length) {
      if (this.bgStore.config.putDefaultPathInContextMenu) {
        await contextMenusCreate({
          id: JSON.stringify({ type: 'action', name: 'default', source: 'folder' }),
          parentId: parentId,
          title: chrome.i18n.getMessage('defaultPath'),
          contexts: MENU_CONTEXTS,
        });
      }

      await contextMenusCreate({
        id: JSON.stringify({ type: 'action', name: 'createFolder' }),
        parentId: parentId,
        title: chrome.i18n.getMessage('add') + '...',
        contexts: MENU_CONTEXTS,
      });
    }
  }

  destroy(): void {
    // Cleanup
  }
}

/**
 * Collapse '.'/'..' segments and duplicate slashes in an already-'/'-joined
 * path, POSIX-style. Deliberately self-contained rather than delegating to
 * the 'path' module: that module is only POSIX here because webpack aliases
 * it to path-browserify — under plain Node (e.g. this file's own tests) it
 * resolves to the win32 implementation, which rewrites '/' back to '\\' and
 * silently flattens the whole folder tree.
 */
function posixNormalizePath(input: string): string {
  const isAbsolute = input.startsWith('/');
  const out: string[] = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!isAbsolute) {
        out.push('..');
      }
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  if (isAbsolute) return '/' + joined;
  return joined || '.';
}

function transformFoldersToTree(folders: Folder[]): MenuItem[] {
  const placeFolderMap: Record<string, Folder> = {};
  const places: string[] = [];

  let sep: string | null = null;

  folders.forEach((folder) => {
    const place = folder.path;
    if (sep === null) {
      if (place.includes('/')) {
        sep = '/';
      } else if (place.includes('\\')) {
        sep = '\\';
      }
    }
    let normPath = place.split(/[\\/]/).join('/');
    normPath = posixNormalizePath(normPath);
    if (/\/$/.test(normPath)) {
      normPath = normPath.slice(0, -1);
    }
    placeFolderMap[normPath] = folder;
    places.push(normPath);
  });
  if (sep === null) {
    sep = '/';
  }

  // Maps a full path prefix to the display segment used for its menu node
  const lowKeyMap: Record<string, string> = {};
  const tree: Record<string, unknown> = {};
  places.forEach((place) => {
    const parts = place.split('/');
    if (parts[0] === '') {
      parts.unshift(parts.splice(0, 2).join(sep ?? '/'));
    }

    let parentThree: Record<string, unknown> = tree;
    parts.forEach((part, index) => {
      // Case-SENSITIVE key: Transmission daemons are overwhelmingly POSIX, so
      // '/data/Movies' and '/data/movies' are two different directories.
      // Folding them collapsed both into one menu entry pointing at whichever
      // came last, silently downloading into the wrong folder.
      const pathKey = parts.slice(0, index + 1).join('/');
      let caseKey = lowKeyMap[pathKey];
      if (!caseKey) {
        caseKey = lowKeyMap[pathKey] = part;
      }
      let subTree = parentThree[caseKey] as Record<string, unknown> | undefined;
      if (!subTree) {
        subTree = parentThree[caseKey] = {};
      }
      if (index === parts.length - 1) {
        subTree['./'] = place;
      }
      parentThree = subTree;
    });
  });

  const joinSingleParts = (tree: Record<string, unknown>, part: string) => {
    const subTree = tree[part];
    if (typeof subTree !== 'object' || subTree === null) return;

    const subParts = Object.keys(subTree as Record<string, unknown>);
    if (subParts.length === 1) {
      const subPart = subParts[0];
      if (subPart === './') {
        tree[part] = (subTree as Record<string, unknown>)[subPart];
      } else {
        const joinedPart = part + sep + subPart;
        delete tree[part];
        tree[joinedPart] = (subTree as Record<string, unknown>)[subPart];
        joinSingleParts(tree, joinedPart);
      }
    } else {
      subParts.forEach((subPart) => {
        joinSingleParts(subTree as Record<string, unknown>, subPart);
      });
    }
  };
  Object.keys(tree).forEach((part) => {
    joinSingleParts(tree, part);
  });

  const menus: MenuItem[] = [];
  const makeMenuItems = (tree: Record<string, unknown>, parentId?: string) => {
    Object.entries(tree).forEach(([name, item]) => {
      if (typeof item === 'object' && item !== null) {
        const branch = item as Record<string, unknown>;
        const id = JSON.stringify({ type: 'branch', index: menus.length });
        menus.push({
          name: name,
          id,
          parentId,
        });
        makeMenuItems(branch, id);
      } else {
        const place = item as string;
        const folder = placeFolderMap[place];
        const id = JSON.stringify({ type: 'folder', index: folders.indexOf(folder) });
        menus.push({
          name,
          id,
          parentId,
        });
      }
    });
  };
  makeMenuItems(tree);

  return menus;
}

const contextMenusRemoveAll = (): Promise<void> => {
  // Callback form: on Firefox the chrome.* namespace returns undefined, so
  // `await removeAll()` resolved immediately and the recreated items raced the
  // still-pending removal (leaving the user with no menu at all)
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      // A failed removal is not fatal: create() reports its own errors
      void chrome.runtime.lastError;
      resolve();
    });
  });
};

const contextMenusCreate = async (details: chrome.contextMenus.CreateProperties): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    chrome.contextMenus.create(details, () => {
      const err = chrome.runtime.lastError;
      err ? reject(err) : resolve();
    });
  });
};

export default ContextMenu;
