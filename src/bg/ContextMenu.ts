import getLogger from '../tools/getLogger';
import downloadFileFromTab from '../tools/downloadFileFromTab';
import downloadFileFromUrl from '../tools/downloadFileFromUrl';
import type { IBgForContextMenu, Folder } from '../types';

const path = require('path');
const promiseLimit = require('promise-limit');

const logger = getLogger('ContextMenu');
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
    directory?: Folder
  ): Promise<void> {
    try {
      let data: { blob?: Blob; url?: string };
      try {
        data = await downloadFileFromTab(url, tabId, frameId);
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (!['FILE_SIZE_EXCEEDED', 'LINK_IS_NOT_SUPPORTED'].includes(error.code ?? '')) {
          logger.error(
            'onSendLink: downloadFileFromTab error, fallback to downloadFileFromUrl',
            error.message || String(err)
          );
          data = await downloadFileFromUrl(url);
        } else {
          throw err;
        }
      }
      if (!this.bg.client) throw new Error('Client not initialized');
      await this.bg.client.putTorrent(data, directory);
      if (this.bgStore.config.selectDownloadCategoryAfterPutTorrentFromContextMenu) {
        this.bgStore.config.setSelectedLabel('DL', true);
      }
      if (!this.bg.client) throw new Error('Client not initialized');
      await this.bg.client.updateTorrents();
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'FILE_SIZE_EXCEEDED') {
        this.bg.torrentErrorNotify(chrome.i18n.getMessage('fileSizeError'));
        return;
      }
      if (error.code === 'LINK_IS_NOT_SUPPORTED') {
        // Fallback to URL
        try {
          if (!this.bg.client) throw new Error('Client not initialized');
          await this.bg.client.putTorrent({ url }, directory);
          if (this.bgStore.config.selectDownloadCategoryAfterPutTorrentFromContextMenu) {
            this.bgStore.config.setSelectedLabel('DL', true);
          }
          if (!this.bg.client) throw new Error('Client not initialized');
          await this.bg.client.updateTorrents();
        } catch (fallbackErr) {
          const error = fallbackErr as { message?: string };
          logger.error('onSendLink error:', error.message || String(fallbackErr));
          this.bg.torrentErrorNotify(error.message || 'Failed to add torrent');
        }
        return;
      }
      logger.error('onSendLink error', err);
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
              if (!linkUrl || !tab?.id) return;
              await this.onSendLink(linkUrl, tab.id, frameId);
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
          if (!linkUrl || !tab?.id || itemInfo.index === undefined) return;
          const folder = this.bgStore.config.folders[itemInfo.index];
          await this.onSendLink(linkUrl, tab.id, frameId, folder);
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
        contexts: ['link'],
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
            contexts: ['link'],
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
            contexts: ['link'],
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
          contexts: ['link'],
        });
      }

      await contextMenusCreate({
        id: JSON.stringify({ type: 'action', name: 'createFolder' }),
        parentId: parentId,
        title: chrome.i18n.getMessage('add') + '...',
        contexts: ['link'],
      });
    }
  }

  destroy(): void {
    // Cleanup
  }
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
    normPath = path.normalize(normPath);
    if (/\/$/.test(normPath)) {
      normPath = normPath.slice(0, -1);
    }
    placeFolderMap[normPath] = folder;
    places.push(normPath);
  });
  if (sep === null) {
    sep = '/';
  }

  const lowKeyMap: Record<string, string> = {};
  const tree: Record<string, unknown> = {};
  places.forEach((place) => {
    const parts = place.split('/');
    if (parts[0] === '') {
      parts.unshift(parts.splice(0, 2).join(sep ?? '/'));
    }

    let parentThree: Record<string, unknown> = tree;
    parts.forEach((part, index) => {
      const lowPart = parts
        .slice(0, index + 1)
        .join('/')
        .toLowerCase();
      let caseKey = lowKeyMap[lowPart];
      if (!caseKey) {
        caseKey = lowKeyMap[lowPart] = part;
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

const contextMenusRemoveAll = async (): Promise<void> => {
  await chrome.contextMenus.removeAll();
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
