import { observer } from 'mobx-react';
import React, { useCallback, ChangeEvent } from 'react';
import useRootStore from '../../hooks/useRootStore';
import TorrentContextMenu from '../menu/TorrentContextMenu';
import torrentColumnRenderers, { TorrentColumnCtx } from './torrentColumns';
import { useLoading } from '../../hooks/useLoading';
import type { Torrent } from '../../types/stores';

interface TorrentListTableItemProps {
  torrent: Torrent;
  /** Absolute-index striping: virtualization breaks :nth-child parity */
  even?: boolean;
}

interface TorrentListStore {
  addMultipleSelectedId: (id: number) => void;
  addSelectedId: (id: number) => void;
  removeSelectedId: (id: number) => void;
}

const TorrentListTableItem = observer(({ torrent, even }: TorrentListTableItemProps) => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore?.torrentList as TorrentListStore | undefined;
  const config = rootStore?.config;
  const { isLoading: isStarting, withLoading: withStartLoading } = useLoading();
  const { isLoading: isStopping, withLoading: withStopLoading } = useLoading();

  const handleSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (!torrent.selected) {
        if (e.nativeEvent instanceof MouseEvent && (e.nativeEvent as MouseEvent).shiftKey) {
          torrentListStore?.addMultipleSelectedId(torrent.id);
        } else {
          torrentListStore?.addSelectedId(torrent.id);
        }
      } else {
        torrentListStore?.removeSelectedId(torrent.id);
      }
    },
    [torrent, torrentListStore]
  );

  const handleStart = useCallback(() => {
    withStartLoading(() => torrent.start());
  }, [torrent, withStartLoading]);

  const handleStop = useCallback(() => {
    withStopLoading(() => torrent.stop());
  }, [torrent, withStopLoading]);

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>) => {
      e.preventDefault();
      rootStore?.createFileList(torrent.id);
    },
    [rootStore, torrent.id]
  );

  if (!config) return null;

  const visibleTorrentColumns = config.visibleTorrentColumns as unknown as Array<{
    column: string;
    width: number;
  }>;

  const ctx: TorrentColumnCtx = {
    torrent,
    handleSelect,
    handleStart,
    handleStop,
    isStarting,
    isStopping,
  };

  const columns = visibleTorrentColumns.map((column) => {
    const name = column.column;
    const renderer = torrentColumnRenderers[name];
    if (!renderer) return null;
    // `column.width` is only READ for the name renderer, the only one that uses
    // it: destructuring it for every column subscribed each row to all ~14
    // width atoms, so one setWidth during a header drag re-rendered the whole
    // list (~60 times a second). The other columns are sized by the
    // --col-*-w CSS variables the table already publishes.
    return renderer(ctx, name === 'name' ? column.width : 0);
  });

  const classList: string[] = [];
  if (torrent.selected) {
    classList.push('selected');
  }
  if (even) {
    classList.push('even');
  }

  // Double-clicks bubbling from interactive cells must not open the file
  // list: double-clicking a row checkbox (or a start/stop button that
  // re-enabled between clicks) unexpectedly popped the file panel
  const handleRowDblClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, select, label')) return;
    handleDblClick(e);
  };

  return (
    <TorrentContextMenu torrentId={torrent.id}>
      <tr className={classList.join(' ')} id={String(torrent.id)} onDoubleClick={handleRowDblClick}>
        {columns}
      </tr>
    </TorrentContextMenu>
  );
});

export default TorrentListTableItem;
