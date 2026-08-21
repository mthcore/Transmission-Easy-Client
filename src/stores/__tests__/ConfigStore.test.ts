import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { destroy } from 'mobx-state-tree';
import ConfigStore, {
  type IConfigStore,
  defaultTorrentListColumnList,
  defaultFileListColumnList,
} from '../ConfigStore';

// storageSet() awaits chrome.storage.local.set's callback; the shared
// chromeMock leaves it a bare vi.fn() that never calls back, so every test
// that touches a persisted action needs it wired to resolve.
beforeEach(() => {
  (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementation((_data, cb) => cb?.());
});

let config: IConfigStore | null = null;

afterEach(() => {
  if (config) {
    destroy(config);
    config = null;
  }
  vi.clearAllMocks();
});

function create(snapshot: Record<string, unknown> = {}): IConfigStore {
  config = ConfigStore.create(snapshot);
  return config;
}

describe('ConfigStore', () => {
  describe('visibleTorrentColumns / activeTorrentColumns', () => {
    it('only returns columns with display=1 by default', () => {
      const c = create();
      const expectedVisible = defaultTorrentListColumnList.filter((col) => col.display).length;
      expect(c.visibleTorrentColumns).toHaveLength(expectedVisible);
      expect(c.visibleTorrentColumns.every((col) => col.display)).toBe(true);
    });

    it('switches between the normal and popup column sets based on isPopupMode', () => {
      const c = create();
      expect(c.activeTorrentColumns).toBe(c.torrentColumns);

      c.setPopupMode(true);
      expect(c.activeTorrentColumns).toBe(c.torrentColumnsPopup);
    });
  });

  describe('visibleFileColumns', () => {
    it('only returns file columns with display=1 by default', () => {
      const c = create();
      const expectedVisible = defaultFileListColumnList.filter((col) => col.display).length;
      expect(c.visibleFileColumns).toHaveLength(expectedVisible);
    });
  });

  describe('toggleDisplay', () => {
    it('flips a column between shown (1) and hidden (0)', () => {
      const c = create();
      const column = c.torrentColumns.find((col) => col.column === 'seeds')!;
      expect(column.display).toBe(0);

      column.toggleDisplay();
      expect(column.display).toBe(1);

      column.toggleDisplay();
      expect(column.display).toBe(0);
    });
  });

  describe('moveTorrentsColumn', () => {
    it('moves a column to sit right before its target and persists the new order', async () => {
      const c = create();
      await c.moveTorrentsColumn('size', 'checkbox');

      const order = c.torrentColumns.map((col) => col.column);
      expect(order[0]).toBe('size');
      expect(order[1]).toBe('checkbox');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          torrentColumns: expect.arrayContaining([expect.objectContaining({ column: 'size' })]),
        }),
        expect.any(Function)
      );
    });

    it('moves within torrentColumnsPopup instead when isPopupMode is set', async () => {
      const c = create({ isPopupMode: true });
      await c.moveTorrentsColumn('status', 'checkbox');

      expect(c.torrentColumnsPopup.map((col) => col.column)[0]).toBe('status');
      // The non-popup list is untouched.
      expect(c.torrentColumns.map((col) => col.column)[0]).toBe('checkbox');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ torrentColumnsPopup: expect.any(Array) }),
        expect.any(Function)
      );
    });

    it('is a no-op when either column name is unknown', async () => {
      const c = create();
      const before = c.torrentColumns.map((col) => col.column);
      await c.moveTorrentsColumn('does-not-exist', 'checkbox');
      expect(c.torrentColumns.map((col) => col.column)).toEqual(before);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('moveFilesColumn', () => {
    it('reorders filesColumns by identifier and persists it', async () => {
      const c = create();
      await c.moveFilesColumn('prio', 'checkbox');
      expect(c.filesColumns.map((col) => col.column)[0]).toBe('prio');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ filesColumns: expect.any(Array) }),
        expect.any(Function)
      );
    });
  });

  describe('setTorrentsSort / setFilesSort', () => {
    it('updates the sort state and persists it', async () => {
      const c = create();
      await c.setTorrentsSort('size', -1);
      expect(c.torrentsSort.by).toBe('size');
      expect(c.torrentsSort.direction).toBe(-1);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { torrentsSort: { by: 'size', direction: -1 } },
        expect.any(Function)
      );
    });
  });

  describe('url / webUiUrl', () => {
    it('builds the RPC url from ssl/hostname/port/pathname', () => {
      const c = create({
        ssl: false,
        hostname: 'nas.local',
        port: 9091,
        pathname: '/transmission/rpc',
      });
      expect(c.url).toBe('http://nas.local:9091/transmission/rpc');
    });

    it('never embeds login/password in webUiUrl even when auth is configured', () => {
      const c = create({
        ssl: true,
        hostname: 'nas.local',
        port: 443,
        webPathname: '/transmission/web/',
        authenticationRequired: true,
        login: 'admin',
        password: 'super-secret',
      });
      expect(c.webUiUrl).not.toContain('admin');
      expect(c.webUiUrl).not.toContain('super-secret');
      expect(c.webUiUrl).not.toContain('@');
    });
  });

  describe('folders', () => {
    it('addFolder/hasFolder/removeFolders round-trip', async () => {
      const c = create();
      expect(c.hasFolder('/downloads/movies')).toBe(false);

      await c.addFolder('/downloads/movies', 'Movies');
      expect(c.hasFolder('/downloads/movies')).toBe(true);

      await c.removeFolders([c.folders[0]]);
      expect(c.hasFolder('/downloads/movies')).toBe(false);
    });

    it('moveFolders up on the top folder is a no-op (no negative splice)', async () => {
      const c = create({
        folders: [
          { path: '/a', name: 'A' },
          { path: '/b', name: 'B' },
          { path: '/c', name: 'C' },
        ],
      });
      await c.moveFolders([c.folders[0]], -1);
      expect(c.folders.map((f) => f.path)).toEqual(['/a', '/b', '/c']);
    });

    it('moveFolders keeps relative order for a non-contiguous selection', async () => {
      const c = create({
        folders: [
          { path: '/a', name: 'A' },
          { path: '/b', name: 'B' },
          { path: '/c', name: 'C' },
          { path: '/d', name: 'D' },
        ],
      });
      // B and D each move up one step: A and C must not be leapfrogged
      await c.moveFolders([c.folders[1], c.folders[3]], -1);
      expect(c.folders.map((f) => f.path)).toEqual(['/b', '/a', '/d', '/c']);
    });

    it('moveFolders moves a middle folder up and the last folder down is a no-op', async () => {
      const c = create({
        folders: [
          { path: '/a', name: 'A' },
          { path: '/b', name: 'B' },
          { path: '/c', name: 'C' },
        ],
      });
      await c.moveFolders([c.folders[1]], -1);
      expect(c.folders.map((f) => f.path)).toEqual(['/b', '/a', '/c']);

      await c.moveFolders([c.folders[2]], 1);
      expect(c.folders.map((f) => f.path)).toEqual(['/b', '/a', '/c']);
    });
  });

  describe('setOptions / setKeyValue', () => {
    it('merges the given keys onto the store and persists them', async () => {
      const c = create();
      await c.setOptions({ hostname: 'new-host', port: 1234 });
      expect(c.hostname).toBe('new-host');
      expect(c.port).toBe(1234);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { hostname: 'new-host', port: 1234 },
        expect.any(Function)
      );
    });
  });

  describe('cross-context sync via chrome.storage.onChanged', () => {
    it('applies changes from the "local" namespace for known config keys', () => {
      const c = create();
      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

      listener({ hostname: { newValue: 'synced-host', oldValue: '' } }, 'local');
      expect(c.hostname).toBe('synced-host');
    });

    it('ignores changes from other storage namespaces', () => {
      const c = create();
      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

      listener({ hostname: { newValue: 'should-not-apply', oldValue: '' } }, 'sync');
      expect(c.hostname).not.toBe('should-not-apply');
    });

    it('ignores keys that are not part of the config schema', () => {
      create();
      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

      // Should not throw even though 'notAConfigKey' isn't a modeled property.
      expect(() => listener({ notAConfigKey: { newValue: 'x' } }, 'local')).not.toThrow();
    });

    it('removes the listener on destroy', () => {
      const c = create();
      destroy(c);
      config = null;
      expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
    });
  });
});
