import { getRoot, types, Instance } from 'mobx-state-tree';
import ListSelectStore from './ListSelectStore';
import {
  createColumnSorter,
  torrentColumnMap,
  torrentSpecialHandlers,
} from '../tools/sortByColumn';
import type { ITorrentStore } from './TorrentStore';

const customLabels = ['ALL', 'DL', 'SEEDING', 'COMPL', 'ACTIVE', 'INACTIVE'] as const;

const NO_LABEL = 'NO_LABEL';

const sortTorrents = createColumnSorter(torrentColumnMap, torrentSpecialHandlers);

interface Filter {
  label: string;
  custom: boolean;
}

const TorrentListStore = types
  .compose('TorrentListStore', ListSelectStore, types.model({}))
  .views((self) => {
    return {
      get filters(): Filter[] {
        // client is types.maybe on RootStore: state can be 'done' with client
        // still undefined when the initial bg sync failed — render must not crash
        const rootStore = getRoot<{
          client?: { torrents: Map<number, ITorrentStore> };
        }>(self);

        const result: Filter[] = [];
        customLabels.forEach((label) => result.push({ label, custom: true }));

        if (!rootStore.client) return result;

        // Collect unique labels from all torrents
        const labelSet = new Set<string>();
        for (const torrent of rootStore.client.torrents.values()) {
          const labels = torrent.labels;
          if (labels) {
            for (const label of labels) {
              if (label) labelSet.add(label);
            }
          }
        }

        if (labelSet.size > 0) {
          // Add "No Label" filter
          result.push({ label: NO_LABEL, custom: true });
          // Add each unique label as a non-custom filter
          const sorted = Array.from(labelSet).sort();
          for (const label of sorted) {
            result.push({ label, custom: false });
          }
        }

        return result;
      },
      get filteredTorrents(): ITorrentStore[] {
        // Same maybe-guard as filters: config and client may not be attached yet
        const rootStore = getRoot<{
          config?: {
            selectedLabel: { label: string; custom: boolean };
            hideSeedingTorrents: boolean;
            hideFinishedTorrents: boolean;
            searchQuery: string;
          };
          client?: {
            torrents: Map<number, ITorrentStore>;
          };
        }>(self);
        if (!rootStore.config || !rootStore.client) return [];
        const filter = rootStore.config.selectedLabel;

        const result: ITorrentStore[] = [];
        for (const torrent of rootStore.client.torrents.values()) {
          if (filter.custom) {
            switch (filter.label) {
              case 'ALL': {
                result.push(torrent);
                break;
              }
              case 'DL': {
                if (torrent.isDownloading) {
                  result.push(torrent);
                }
                break;
              }
              case 'SEEDING': {
                if (torrent.isSeeding) {
                  result.push(torrent);
                }
                break;
              }
              case 'COMPL': {
                if (torrent.isCompleted) {
                  result.push(torrent);
                }
                break;
              }
              case 'ACTIVE': {
                if (torrent.isActive) {
                  result.push(torrent);
                }
                break;
              }
              case 'INACTIVE': {
                if (!torrent.isActive) {
                  result.push(torrent);
                }
                break;
              }
              case NO_LABEL: {
                if (!torrent.labels || torrent.labels.length === 0) {
                  result.push(torrent);
                }
                break;
              }
            }
          } else {
            // Filter by torrent label
            if (torrent.labels && torrent.labels.includes(filter.label)) {
              result.push(torrent);
            }
          }
        }

        const { hideSeedingTorrents, hideFinishedTorrents, searchQuery } = rootStore.config;
        let filtered = result;

        if (hideSeedingTorrents || hideFinishedTorrents) {
          filtered = filtered.filter((torrent) => {
            if (hideSeedingTorrents && torrent.isSeeding) {
              return false;
            }
            if (hideFinishedTorrents && torrent.isFinished) {
              return false;
            }
            return true;
          });
        }

        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          filtered = filtered.filter((torrent) => torrent.name.toLowerCase().includes(query));
        }

        return filtered;
      },
      get sortedTorrents(): ITorrentStore[] {
        const rootStore = getRoot<{
          config?: {
            torrentsSort: { by: string; direction: 1 | -1 };
          };
        }>(self);
        if (!rootStore.config) return [];
        const { by, direction } = rootStore.config.torrentsSort;
        return sortTorrents(
          this.filteredTorrents as unknown as { [key: string]: unknown }[],
          by,
          direction
        ) as unknown as ITorrentStore[];
      },
      get sortedTorrentIds(): number[] {
        return this.sortedTorrents.map((torrent) => torrent.id);
      },
      get _sortedIds(): number[] {
        return this.sortedTorrentIds;
      },
    };
  })
  .actions((self) => {
    return {
      afterCreate() {
        self.startSortedIdsWatcher();
      },
      beforeDestroy() {
        self.stopSortedIdsWatcher();
      },
    };
  });

export type ITorrentListStore = Instance<typeof TorrentListStore>;
export default TorrentListStore;
