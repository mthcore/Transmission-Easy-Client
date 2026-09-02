import { describe, it, expect, afterEach } from 'vitest';
import { types, destroy, Instance } from 'mobx-state-tree';
import TorrentStore from '../../stores/TorrentStore';
import TorrentListStore from '../../stores/TorrentListStore';

// Minimal config model matching what TorrentListStore accesses via getRoot
const TestSelectedLabel = types.model({
  label: types.string,
  custom: types.boolean,
});

const TestConfig = types.model({
  selectedLabel: types.optional(TestSelectedLabel, { label: 'ALL', custom: true }),
  hideSeedingTorrents: types.optional(types.boolean, false),
  hideFinishedTorrents: types.optional(types.boolean, false),
  searchQuery: types.optional(types.string, ''),
  torrentsSort: types.optional(
    types.model({ by: types.string, direction: types.optional(types.number, 1) }),
    { by: 'name', direction: 1 }
  ),
});

const TestClient = types.model({
  torrents: types.map(TorrentStore),
});

const TestRoot = types.model({
  config: types.optional(TestConfig, {}),
  client: types.optional(TestClient, {}),
  torrentList: types.optional(TorrentListStore, {}),
});

type ITestRoot = Instance<typeof TestRoot>;

function makeTorrent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    statusCode: 4,
    errorCode: 0,
    errorString: '',
    name: 'Test',
    size: 1000,
    percentDone: 0.5,
    recheckProgress: 0,
    downloaded: 500,
    uploaded: 250,
    shared: 500,
    uploadSpeed: 0,
    downloadSpeed: 1024,
    eta: 100,
    activePeers: 2,
    peers: 5,
    activeSeeds: 1,
    seeds: 3,
    order: 1,
    addedTime: 1700000000,
    completedTime: 0,
    labels: [],
    bandwidthPriority: 0,
    ...overrides,
  };
}

let root: ITestRoot | null = null;

afterEach(() => {
  if (root) {
    destroy(root);
    root = null;
  }
});

function createRoot(config = {}, torrents: Record<string, unknown>[] = []) {
  const torrentMap: Record<string, Record<string, unknown>> = {};
  for (const t of torrents) {
    torrentMap[String(t.id)] = t;
  }
  root = TestRoot.create({
    config,
    client: { torrents: torrentMap as never },
  });
  return root;
}

describe('TorrentListStore', () => {
  describe('filters', () => {
    it('returns custom category labels when no torrents have labels', () => {
      const r = createRoot();
      const filters = r.torrentList.filters;
      expect(filters.map((f) => f.label)).toEqual([
        'ALL',
        'DL',
        'SEEDING',
        'COMPL',
        'ACTIVE',
        'INACTIVE',
      ]);
      expect(filters.every((f) => f.custom)).toBe(true);
    });

    it('includes torrent labels and NO_LABEL when labels exist', () => {
      const r = createRoot({}, [
        makeTorrent({ id: 1, labels: ['movies'] }),
        makeTorrent({ id: 2, labels: ['music', 'hd'] }),
        makeTorrent({ id: 3, labels: [] }),
      ]);
      const filters = r.torrentList.filters;
      const labels = filters.map((f) => f.label);
      // Custom categories + NO_LABEL + unique sorted labels
      expect(labels).toContain('NO_LABEL');
      expect(labels).toContain('movies');
      expect(labels).toContain('music');
      expect(labels).toContain('hd');
      // Labels are sorted alphabetically
      const labelIndex = (l: string) => labels.indexOf(l);
      expect(labelIndex('hd')).toBeLessThan(labelIndex('movies'));
      expect(labelIndex('movies')).toBeLessThan(labelIndex('music'));
    });

    it('marks torrent labels as non-custom', () => {
      const r = createRoot({}, [makeTorrent({ id: 1, labels: ['test'] })]);
      const testFilter = r.torrentList.filters.find((f) => f.label === 'test');
      expect(testFilter?.custom).toBe(false);
    });
  });

  describe('filteredTorrents', () => {
    it('returns all torrents for ALL filter', () => {
      const r = createRoot({ selectedLabel: { label: 'ALL', custom: true } }, [
        makeTorrent({ id: 1 }),
        makeTorrent({ id: 2, name: 'Second' }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(2);
    });

    it('filters by DL (downloading)', () => {
      const r = createRoot({ selectedLabel: { label: 'DL', custom: true } }, [
        makeTorrent({ id: 1, statusCode: 4 }), // downloading
        makeTorrent({ id: 2, statusCode: 6 }), // seeding
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(1);
    });

    it('filters by SEEDING', () => {
      const r = createRoot({ selectedLabel: { label: 'SEEDING', custom: true } }, [
        makeTorrent({ id: 1, statusCode: 4 }),
        makeTorrent({ id: 2, statusCode: 6 }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(2);
    });

    it('filters by COMPL (completed)', () => {
      const r = createRoot({ selectedLabel: { label: 'COMPL', custom: true } }, [
        makeTorrent({ id: 1, percentDone: 0.5 }),
        makeTorrent({ id: 2, percentDone: 1 }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(2);
    });

    it('filters by ACTIVE (has speed)', () => {
      const r = createRoot({ selectedLabel: { label: 'ACTIVE', custom: true } }, [
        makeTorrent({ id: 1, downloadSpeed: 100, uploadSpeed: 0 }),
        makeTorrent({ id: 2, downloadSpeed: 0, uploadSpeed: 0 }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(1);
    });

    it('filters by INACTIVE (no speed)', () => {
      const r = createRoot({ selectedLabel: { label: 'INACTIVE', custom: true } }, [
        makeTorrent({ id: 1, downloadSpeed: 100 }),
        makeTorrent({ id: 2, downloadSpeed: 0, uploadSpeed: 0 }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(2);
    });

    it('filters by NO_LABEL (torrents without labels)', () => {
      const r = createRoot({ selectedLabel: { label: 'NO_LABEL', custom: true } }, [
        makeTorrent({ id: 1, labels: ['movies'] }),
        makeTorrent({ id: 2, labels: [] }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(2);
    });

    it('filters by specific label name', () => {
      const r = createRoot({ selectedLabel: { label: 'movies', custom: false } }, [
        makeTorrent({ id: 1, labels: ['movies', 'hd'] }),
        makeTorrent({ id: 2, labels: ['music'] }),
        makeTorrent({ id: 3, labels: [] }),
      ]);
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(1);
    });

    it('applies hideSeedingTorrents filter', () => {
      const r = createRoot(
        { selectedLabel: { label: 'ALL', custom: true }, hideSeedingTorrents: true },
        [
          makeTorrent({ id: 1, statusCode: 4 }),
          makeTorrent({ id: 2, statusCode: 6 }), // seeding
        ]
      );
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(1);
    });

    it('applies hideFinishedTorrents filter', () => {
      const r = createRoot(
        { selectedLabel: { label: 'ALL', custom: true }, hideFinishedTorrents: true },
        [
          makeTorrent({ id: 1, isFinished: false }),
          makeTorrent({ id: 2, isFinished: true }), // finished (API field)
        ]
      );
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].id).toBe(1);
    });

    it('applies search query filter', () => {
      const r = createRoot(
        { selectedLabel: { label: 'ALL', custom: true }, searchQuery: 'alpha' },
        [makeTorrent({ id: 1, name: 'Alpha File' }), makeTorrent({ id: 2, name: 'Beta File' })]
      );
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
      expect(r.torrentList.filteredTorrents[0].name).toBe('Alpha File');
    });

    it('search is case-insensitive', () => {
      const r = createRoot(
        { selectedLabel: { label: 'ALL', custom: true }, searchQuery: 'ALPHA' },
        [makeTorrent({ id: 1, name: 'alpha test' })]
      );
      expect(r.torrentList.filteredTorrents).toHaveLength(1);
    });
  });

  describe('sortedTorrents', () => {
    it('sorts by name ascending', () => {
      const r = createRoot({ torrentsSort: { by: 'name', direction: 1 } }, [
        makeTorrent({ id: 1, name: 'Charlie' }),
        makeTorrent({ id: 2, name: 'Alpha' }),
        makeTorrent({ id: 3, name: 'Bravo' }),
      ]);
      const names = r.torrentList.sortedTorrents.map((t) => t.name);
      expect(names).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('sorts by name descending', () => {
      const r = createRoot({ torrentsSort: { by: 'name', direction: -1 } }, [
        makeTorrent({ id: 1, name: 'Charlie' }),
        makeTorrent({ id: 2, name: 'Alpha' }),
        makeTorrent({ id: 3, name: 'Bravo' }),
      ]);
      const names = r.torrentList.sortedTorrents.map((t) => t.name);
      expect(names).toEqual(['Charlie', 'Bravo', 'Alpha']);
    });
  });

  describe('sortedTorrentIds', () => {
    it('returns IDs in sorted order', () => {
      const r = createRoot({ torrentsSort: { by: 'name', direction: 1 } }, [
        makeTorrent({ id: 10, name: 'Bravo' }),
        makeTorrent({ id: 20, name: 'Alpha' }),
      ]);
      expect(r.torrentList.sortedTorrentIds).toEqual([20, 10]);
    });
  });
});
