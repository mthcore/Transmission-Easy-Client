import { flow, types, Instance, cast } from 'mobx-state-tree';
import ConfigStore, {
  configKeys,
  defaultFileListColumnList,
  defaultTorrentListColumnList,
  defaultTorrentListColumnListPopup,
} from './ConfigStore';
import getLogger from '../tools/getLogger';
import loadConfig from '../tools/loadConfig';
import ClientStore from './ClientStore';
import mergeColumns from '../tools/mergeColumns';
import type { ColumnConfig } from '../types';

const logger = getLogger('BgStore');

const BgStore = types
  .model('BgStore', {
    config: types.maybe(ConfigStore),
    client: types.optional(ClientStore, {}),
  })
  .views((self) => ({
    /**
     * The config, once loading has finished.
     *
     * It is `maybe` because the store is built synchronously when the service
     * worker starts and the settings are read from storage afterwards. From
     * the moment `fetchConfig` resolves it is defined and stays defined: both
     * its success and its failure path assign a node, and nothing ever clears
     * one. Everything built after that point depends on this.
     *
     * Saying so here is the point. Each of the three consumers used to assert
     * it with a cast at the seam where it was constructed, and a cast does not
     * assert one fact — it silences every other disagreement at that seam too,
     * so the place where the whole background wires itself together was the
     * one place the compiler checked nothing.
     */
    requireConfig(): IConfigStore {
      if (!self.config) {
        // Reached only by a consumer built before init() finished, which is a
        // wiring mistake rather than a runtime condition. Named, because the
        // alternative is a TypeError from deep inside whichever getter ran
        // first, in a service worker with no console open.
        throw new Error('BgStore.config read before fetchConfig resolved');
      }
      return self.config;
    },
  }))
  .actions((self) => {
    return {
      fetchConfig: flow(function* () {
        try {
          const config: Record<string, unknown> = yield loadConfig(configKeys);

          const columnMergeConfigs: [string, ColumnConfig[]][] = [
            ['filesColumns', defaultFileListColumnList as ColumnConfig[]],
            ['torrentColumns', defaultTorrentListColumnList as ColumnConfig[]],
            ['torrentColumnsPopup', defaultTorrentListColumnListPopup as ColumnConfig[]],
          ];

          columnMergeConfigs.forEach(([key, defColumns]) => {
            if (config[key]) {
              try {
                mergeColumns(config[key] as ColumnConfig[], defColumns);
              } catch (err) {
                logger.error(`mergeColumns ${key} error, use default`, err);
              }
            }
          });

          // Reuse the existing node: reassigning it resets every field to its
          // default inside this action, which refires all config autoruns
          // (client flush + rebuild, DNR rewrite, context-menu rebuild) even
          // when nothing actually changed — and fetchConfig runs on every
          // connection re-check.
          if (!self.config) {
            self.config = cast({});
          }
          const target = self.config as unknown as Record<string, unknown>;
          Object.entries(config).forEach(([key, value]) => {
            try {
              if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
                target[key] = value;
              }
            } catch (err) {
              logger.error(`fetchConfig key (${key}) error, use default value`, err);
            }
          });
        } catch (err) {
          logger.error('fetchConfig error, use default config', err);
          // Actually apply the promised default: leaving config undefined
          // kills the daemon autorun and locks every page on 'Loading: error'
          if (!self.config) {
            self.config = cast({});
          }
        }
      }),
      flushClient() {
        self.client = cast({});
      },
    };
  });

export type IConfigStore = Instance<typeof ConfigStore>;
export type IBgStore = Instance<typeof BgStore>;
export default BgStore;
