import { getRoot, types, Instance } from 'mobx-state-tree';
import BaseDialogStore from './BaseDialogStore';
import type { ITorrentStore } from './TorrentStore';

const TorrentDetailsDialogStore = types
  .compose(
    'TorrentDetailsDialogStore',
    BaseDialogStore,
    types.model({
      type: types.literal('torrentDetails'),
      torrentId: types.number,
    })
  )
  .views((self) => ({
    get torrent(): ITorrentStore | undefined {
      // client is types.maybe on RootStore: it can vanish mid-render (bg
      // resync after the server config broke), and dereferencing it blindly
      // threw a TypeError that killed the whole dialog into the error fallback
      const rootStore = getRoot<{
        client?: {
          torrents: Map<number, ITorrentStore>;
        };
      }>(self);
      return rootStore.client?.torrents.get(self.torrentId);
    },
  }));

export type ITorrentDetailsDialogStore = Instance<typeof TorrentDetailsDialogStore>;
export default TorrentDetailsDialogStore;
