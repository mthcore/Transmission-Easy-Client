import { useState } from 'react';
import useRootStore from './useRootStore';
import type { TorrentId } from '../types';

/**
 * Translates a dialog's numeric torrent ids into hashStrings once, when the
 * dialog opens, and keeps them for its whole life.
 *
 * Numeric ids are session scoped: a daemon restart while a dialog sits open can
 * hand the same id to a DIFFERENT torrent, and the action would then land on
 * that one — moving its data, renaming it, replacing its labels. The hash
 * addresses the torrent immutably, and the RPC accepts both forms in `ids`.
 * An id with no known torrent is passed through unchanged.
 */
export default function useCapturedTorrentIds(torrentIds: readonly number[]): TorrentId[] {
  const rootStore = useRootStore();
  const [captured] = useState<TorrentId[]>(() =>
    torrentIds.map((id) => {
      const torrent = rootStore?.client?.torrents?.get(id) as { hashString?: string } | undefined;
      return torrent?.hashString || id;
    })
  );
  return captured;
}
