import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from '../ContextMenu';
import type { Folder, IBgForContextMenu } from '../../types';

/**
 * `transformFoldersToTree` is a module-private function, so it is exercised here through
 * `ContextMenu#createFolderMenu`, the smallest public surface that consumes it: every menu item
 * the tree builder produces becomes exactly one `chrome.contextMenus.create` call, in order, with
 * the item name as `title`, its own `id` and its `parentId`.
 *
 * ContextMenu.ts does `require('path')`. Webpack aliases `path` to `path-browserify` (see
 * webpack.config.js), so the shipped extension always gets POSIX semantics. Under Node on Windows
 * the very same require yields the win32 implementation, whose `normalize()` rewrites '/' to '\'
 * and defeats the whole tree builder. The spy below pins `normalize` to its POSIX behaviour so the
 * suite tests what actually ships, and behaves identically on every platform.
 */
const nodePath = require('path') as typeof import('path');
let normalizeSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  normalizeSpy = vi
    .spyOn(nodePath, 'normalize')
    .mockImplementation((p: string) => nodePath.posix.normalize(p));
});

afterAll(() => {
  normalizeSpy.mockRestore();
});

const ROOT = 'ROOT_MENU_ID';

interface MenuNode {
  /** Title passed to chrome.contextMenus.create */
  title: string;
  /** 'branch' for intermediate path nodes, 'folder' for selectable folders */
  type: string;
  /** For 'folder' items: index into the original folders array */
  index: number;
  /** Title of the parent menu item, or null when attached to the root menu */
  parent: string | null;
}

interface Options {
  treeView?: boolean;
  putDefaultPath?: boolean;
}

function createMenu(folders: Folder[], options: Options = {}): ContextMenu {
  const bg = {
    bgStore: {
      config: {
        folders,
        treeViewContextMenu: options.treeView ?? true,
        putDefaultPathInContextMenu: options.putDefaultPath ?? false,
        selectDownloadCategoryAfterPutTorrentFromContextMenu: false,
        hasFolder: vi.fn(),
        addFolder: vi.fn(),
        setSelectedLabel: vi.fn(),
      },
    },
    client: null,
    whenReady: vi.fn().mockResolvedValue(undefined),
    torrentErrorNotify: vi.fn(),
  } satisfies IBgForContextMenu;
  return new ContextMenu(bg);
}

function createdItems(): chrome.contextMenus.CreateProperties[] {
  const create = chrome.contextMenus.create as unknown as ReturnType<typeof vi.fn>;
  return create.mock.calls.map((call) => call[0] as chrome.contextMenus.CreateProperties);
}

/**
 * Runs createFolderMenu and rebuilds a readable view of the tree that reached chrome:
 * the trailing "action" entries (defaultPath / add...) are dropped, and parent ids are
 * resolved back to the parent's title so nesting is asserted on names, not on opaque ids.
 */
async function buildTree(paths: string[], options: Options = {}): Promise<MenuNode[]> {
  const folders: Folder[] = paths.map((path) => ({ path }));
  await createMenu(folders, options).createFolderMenu(ROOT);

  const items = createdItems();
  const titleById = new Map<string, string>();
  items.forEach((item) => titleById.set(String(item.id), String(item.title)));

  return items
    .map((item) => ({ item, id: JSON.parse(String(item.id)) as { type: string; index: number } }))
    .filter(({ id }) => id.type !== 'action')
    .map(({ item, id }) => ({
      title: String(item.title),
      type: id.type,
      index: id.index,
      parent: item.parentId === ROOT ? null : (titleById.get(String(item.parentId)) ?? '??'),
    }));
}

const leaf = (title: string, index: number, parent: string | null): MenuNode => ({
  title,
  type: 'folder',
  index,
  parent,
});

const branch = (title: string, parent: string | null): MenuNode => ({
  title,
  type: 'branch',
  index: expect.any(Number) as unknown as number,
  parent,
});

describe('ContextMenu tree view (transformFoldersToTree)', () => {
  beforeEach(() => {
    const create = chrome.contextMenus.create as unknown as ReturnType<typeof vi.fn>;
    create.mockReset();
    // The production helper wraps create() in a promise resolved from its callback.
    create.mockImplementation((_details: unknown, callback?: () => void) => callback?.());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('degenerate inputs', () => {
    it('creates no menu item at all for an empty folder list', async () => {
      await createMenu([]).createFolderMenu(ROOT);
      // No folders means no tree, and also no "default path" / "add..." trailer.
      expect(createdItems()).toHaveLength(0);
    });

    it('renders a single folder as one leaf holding the whole path, with no branch', async () => {
      expect(await buildTree(['/data/movies'])).toEqual([leaf('/data/movies', 0, null)]);
    });

    it('renders a folder without any separator as a bare leaf', async () => {
      expect(await buildTree(['downloads'])).toEqual([leaf('downloads', 0, null)]);
    });
  });

  describe('grouping', () => {
    it('groups sibling paths under their shared parent branch', async () => {
      expect(await buildTree(['/data/movies', '/data/music'])).toEqual([
        branch('/data', null),
        leaf('movies', 0, '/data'),
        leaf('music', 1, '/data'),
      ]);
    });

    it('does not nest paths that merely share a string prefix', async () => {
      // /data/movies is NOT a parent of /data/movies2 - they must stay siblings.
      const tree = await buildTree(['/data/movies', '/data/movies2']);
      expect(tree).toEqual([
        branch('/data', null),
        leaf('movies', 0, '/data'),
        leaf('movies2', 1, '/data'),
      ]);
      expect(tree.some((node) => node.parent === 'movies')).toBe(false);
    });

    it('collapses single-child chains and keeps real forks as branches', async () => {
      // /a and /a/b each have a single child, so they are joined into one "/a/b" branch.
      expect(await buildTree(['/a/b/c/x', '/a/b/c/y', '/a/b/z'])).toEqual([
        branch('/a/b', null),
        branch('c', '/a/b'),
        leaf('x', 0, 'c'),
        leaf('y', 1, 'c'),
        leaf('z', 2, '/a/b'),
      ]);
    });

    it('supports deep nesting with forks at several levels', async () => {
      expect(await buildTree(['/a/b/c/d/e', '/a/b/c/d/f', '/a/b/g/h'])).toEqual([
        branch('/a/b', null),
        branch('c/d', '/a/b'),
        leaf('e', 0, 'c/d'),
        leaf('f', 1, 'c/d'),
        leaf('g/h', 2, '/a/b'),
      ]);
    });

    it('labels a folder that is also a parent with the "current directory" entry', async () => {
      // /data is both selectable and a branch: it gets a './' child, titled via i18n.
      expect(await buildTree(['/data', '/data/movies'])).toEqual([
        branch('/data', null),
        leaf('currentDirectory', 0, '/data'),
        leaf('movies', 1, '/data'),
      ]);
    });

    it('keeps leaf ids pointing at the original folder index, not at the menu order', async () => {
      // Menu order is /x, b, c, then /y/a - but ids must still reference input positions.
      expect(await buildTree(['/x/b', '/y/a', '/x/c'])).toEqual([
        branch('/x', null),
        leaf('b', 0, '/x'),
        leaf('c', 2, '/x'),
        leaf('/y/a', 1, null),
      ]);
    });
  });

  describe('separator handling', () => {
    it('infers the backslash separator and rebuilds branch titles with it', async () => {
      expect(await buildTree(['C:\\Downloads\\Movies', 'C:\\Downloads\\Music'])).toEqual([
        branch('C:\\Downloads', null),
        leaf('Movies', 0, 'C:\\Downloads'),
        leaf('Music', 1, 'C:\\Downloads'),
      ]);
    });

    it('merges mixed separators into one tree, displayed with the first path separator', async () => {
      expect(await buildTree(['C:\\Data\\A', 'C:/Data/B'])).toEqual([
        branch('C:\\Data', null),
        leaf('A', 0, 'C:\\Data'),
        leaf('B', 1, 'C:\\Data'),
      ]);
    });

    it('uses the POSIX separator when the first path is the slash-flavoured one', async () => {
      expect(await buildTree(['C:/Data/A', 'C:\\Data\\B'])).toEqual([
        branch('C:/Data', null),
        leaf('A', 0, 'C:/Data'),
        leaf('B', 1, 'C:/Data'),
      ]);
    });

    it('falls back to a later path when the first one carries no separator', async () => {
      expect(await buildTree(['downloads', 'D:\\media\\x'])).toEqual([
        leaf('downloads', 0, null),
        leaf('D:\\media\\x', 1, null),
      ]);
      vi.clearAllMocks();
      expect(await buildTree(['downloads', 'D:/media/x'])).toEqual([
        leaf('downloads', 0, null),
        leaf('D:/media/x', 1, null),
      ]);
    });

    it('strips trailing separators and collapses duplicated ones', async () => {
      expect(await buildTree(['/data/movies/', '/data/music//'])).toEqual([
        branch('/data', null),
        leaf('movies', 0, '/data'),
        leaf('music', 1, '/data'),
      ]);
    });

    it('treats a trailing separator as the same folder as its bare form', async () => {
      // '/data/movies/' must land on the same node as '/data/movies', so nothing nests below it.
      expect(await buildTree(['/data/movies/', '/data/other'])).toEqual([
        branch('/data', null),
        leaf('movies', 0, '/data'),
        leaf('other', 1, '/data'),
      ]);
    });

    it('resolves "." and ".." segments before building the tree', async () => {
      expect(await buildTree(['/data/movies/../music', '/data/./movies'])).toEqual([
        branch('/data', null),
        leaf('music', 0, '/data'),
        leaf('movies', 1, '/data'),
      ]);
    });
  });

  describe('case handling', () => {
    it('folds path components that differ only by case onto the first casing seen', async () => {
      expect(await buildTree(['/Data/Movies', '/data/music'])).toEqual([
        branch('/Data', null),
        leaf('Movies', 0, '/Data'),
        leaf('music', 1, '/Data'),
      ]);
    });

    it('keeps the folding case-insensitive on deep components too', async () => {
      expect(await buildTree(['/srv/Media/TV', '/SRV/media/movies'])).toEqual([
        branch('/srv/Media', null),
        leaf('TV', 0, '/srv/Media'),
        leaf('movies', 1, '/srv/Media'),
      ]);
    });

    it('collapses two folders whose paths differ only by case into a single entry', async () => {
      // Known consequence of the case folding: the first folder becomes unreachable,
      // the surviving entry keeps the first casing but targets the LAST matching folder.
      expect(await buildTree(['/data/Movies', '/data/movies'])).toEqual([
        leaf('/data/Movies', 1, null),
      ]);
    });
  });

  describe('interaction with the rest of createFolderMenu', () => {
    it('ignores folder.name in tree view and appends only the "add..." action', async () => {
      const folders: Folder[] = [
        { name: 'My Movies', path: '/data/movies' },
        { name: 'My Music', path: '/data/music' },
      ];
      await createMenu(folders).createFolderMenu(ROOT);

      const items = createdItems();
      expect(items.map((item) => item.title)).toEqual(['/data', 'movies', 'music', 'add...']);
      expect(items[items.length - 1].parentId).toBe(ROOT);
    });

    it('adds the default-path entry when configured, without touching the tree', async () => {
      const folders: Folder[] = [{ path: '/data/movies' }, { path: '/data/music' }];
      await createMenu(folders, { putDefaultPath: true }).createFolderMenu(ROOT);

      expect(createdItems().map((item) => item.title)).toEqual([
        '/data',
        'movies',
        'music',
        'defaultPath',
        'add...',
      ]);
    });

    it('does not build a tree when treeViewContextMenu is off', async () => {
      const folders: Folder[] = [
        { name: 'My Movies', path: '/data/movies' },
        { path: '/data/music' },
      ];
      await createMenu(folders, { treeView: false }).createFolderMenu(ROOT);

      const items = createdItems();
      // Flat mode: one item per folder, labelled by name (falling back to path), no branch item.
      expect(items.map((item) => item.title)).toEqual(['My Movies', '/data/music', 'add...']);
      expect(items.map((item) => item.parentId)).toEqual([ROOT, ROOT, ROOT]);
      expect(items.map((item) => String(item.id))).toEqual([
        JSON.stringify({ type: 'folder', index: 0 }),
        JSON.stringify({ type: 'folder', index: 1 }),
        JSON.stringify({ type: 'action', name: 'createFolder' }),
      ]);
    });
  });
});
