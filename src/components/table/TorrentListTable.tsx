import React, { useRef, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react';
import TorrentListTableItem from './TorrentListTableItem';
import ColumnContextMenu from './ColumnContextMenu';
import TableHeadColumnRenderer from './TableHeadColumnRenderer';
import type { Column } from './TableHeadColumn';
import useRootStore from '../../hooks/useRootStore';
import { useScrollSync } from '../../hooks/useScrollSync';
import type { Torrent } from '../../types/stores';

// Column's `display` is typed boolean here but the MST ColumnStore models it
// as number (0/1); this cast is a pre-existing, cross-cutting mismatch
// (also present in ColumnContextMenu/TableHeadColumnRenderer/useColumnToggle)
// left as-is — out of scope for this pass.
const asColumns = (cols: unknown): Column[] => cols as Column[];

const TorrentListTable = observer(() => {
  const rootStore = useRootStore();
  const config = rootStore.config;
  const refFixedHead = useRef<HTMLTableElement>(null);
  const handleScroll = useScrollSync(refFixedHead as React.RefObject<HTMLElement>);

  useEffect(() => {
    rootStore.flushTorrentList();
  }, [rootStore]);

  if (!config) return null;

  const columnVars: Record<string, string> = {};
  config.visibleTorrentColumns.forEach((col) => {
    columnVars[`--col-${col.column}-w`] = `${col.width}px`;
  });

  return (
    <div onScroll={handleScroll} className="torrent-list-layer" style={columnVars}>
      {rootStore.isRefreshing && (
        <div className="torrent-list-loading">
          <div className="spinner spinner--large" />
        </div>
      )}
      <ColumnContextMenu
        columns={asColumns(config.activeTorrentColumns)}
        onSave={() => config.saveTorrentsColumns()}
      >
        <table
          ref={refFixedHead}
          className="torrent-table-head"
          border={0}
          cellSpacing={0}
          cellPadding={0}
        >
          <TorrentListTableHead />
        </table>
      </ColumnContextMenu>
      <table className="torrent-table-body" border={0} cellSpacing={0} cellPadding={0}>
        <TorrentListTableHead />
        <TorrentListTableTorrents />
      </table>
    </div>
  );
});

const TORRENT_FIXED_COLUMNS = ['checkbox', 'actions'];

const TorrentListTableHead = observer(() => {
  const rootStore = useRootStore();
  const config = rootStore.config;
  const torrentListStore = rootStore.torrentList;

  const handleSort = useCallback(
    (column: string, direction: number) => {
      config?.setTorrentsSort(column, direction);
    },
    [config]
  );

  const handleMoveColumn = useCallback(
    (from: string, to: string) => {
      config?.moveTorrentsColumn(from, to);
    },
    [config]
  );

  const handleSaveColumns = useCallback(() => {
    config?.saveTorrentsColumns();
  }, [config]);

  const handleToggleSelectAll = useCallback(() => {
    torrentListStore?.toggleSelectAll();
  }, [torrentListStore]);

  if (!config) return null;

  const torrentsSort = config.torrentsSort;
  const torrentColumns = asColumns(config.visibleTorrentColumns);

  return (
    <thead>
      <tr>
        {torrentColumns.map((column) => (
          <TableHeadColumnRenderer
            key={column.column}
            column={column}
            isSorted={torrentsSort.by === column.column}
            sortDirection={torrentsSort.direction}
            onMoveColumn={handleMoveColumn}
            onSort={handleSort}
            onSaveColumns={handleSaveColumns}
            type="tr"
            fixedColumns={TORRENT_FIXED_COLUMNS}
            isSelectedAll={torrentListStore.isSelectedAll}
            onToggleSelectAll={handleToggleSelectAll}
          />
        ))}
      </tr>
    </thead>
  );
});

const TorrentListTableTorrents = observer(() => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore.torrentList;

  return (
    <tbody>
      {torrentListStore.sortedTorrents.map((torrent) => (
        <TorrentListTableItem key={torrent.id} torrent={torrent as unknown as Torrent} />
      ))}
    </tbody>
  );
});

export default TorrentListTable;
