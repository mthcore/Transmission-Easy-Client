import React, { useRef, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react';
import TorrentListTableItem from './TorrentListTableItem';
import ColumnContextMenu from './ColumnContextMenu';
import TableHeadColumnRenderer from './TableHeadColumnRenderer';
import type { Column } from './TableHeadColumn';
import useRootStore from '../../hooks/useRootStore';
import { useScrollSync } from '../../hooks/useScrollSync';
import { useVirtualRows, type VirtualRows } from '../../hooks/useVirtualRows';
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
  const refLayer = useRef<HTMLDivElement>(null);
  const handleScroll = useScrollSync(refFixedHead as React.RefObject<HTMLElement>);

  // Windowing: only the viewport's rows (plus overscan) exist in the DOM —
  // with the whole library rendered, a sort or select-all on 2000 torrents
  // re-rendered 2000 rows and froze the popup for most of a second
  const rowCount = rootStore.torrentList.sortedTorrents.length;
  const virtual = useVirtualRows(refLayer, rowCount);

  const { onScroll: onVirtualScroll } = virtual;
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      handleScroll(e);
      onVirtualScroll();
    },
    [handleScroll, onVirtualScroll]
  );

  useEffect(() => {
    rootStore.flushTorrentList();
  }, [rootStore]);

  if (!config) return null;

  const columnVars: Record<string, string> = {};
  config.visibleTorrentColumns.forEach((col) => {
    columnVars[`--col-${col.column}-w`] = `${col.width}px`;
  });

  return (
    <div ref={refLayer} onScroll={onScroll} className="torrent-list-layer" style={columnVars}>
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
      {/* aria-rowcount is the FULL list: only ~30 rows exist in the DOM, so
          without it a screen reader announces a 2000-torrent library as 30 */}
      <table
        className="torrent-table-body"
        aria-rowcount={rowCount}
        border={0}
        cellSpacing={0}
        cellPadding={0}
      >
        <TorrentListTableHead />
        <TorrentListTableTorrents virtual={virtual} />
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

const TorrentListTableTorrents = observer(({ virtual }: { virtual: VirtualRows }) => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore.torrentList;
  const columnCount = rootStore.config?.visibleTorrentColumns.length ?? 1;

  const { start, end, padTop, padBottom, bodyRef } = virtual;
  const slice = torrentListStore.sortedTorrents.slice(start, end);

  return (
    <tbody ref={bodyRef}>
      {padTop > 0 && (
        <tr data-virtual-spacer aria-hidden="true" style={{ height: padTop }}>
          <td colSpan={columnCount} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
      {slice.map((torrent, index) => (
        <TorrentListTableItem
          key={torrent.id}
          torrent={torrent as unknown as Torrent}
          // Striping follows the ABSOLUTE index: with a spacer row shifting
          // DOM positions as the window moves, :nth-child stripes swapped on
          // every scroll step
          even={(start + index) % 2 === 1}
          // 1-based, and row 1 is the header
          rowIndex={start + index + 2}
        />
      ))}
      {padBottom > 0 && (
        <tr data-virtual-spacer aria-hidden="true" style={{ height: padBottom }}>
          <td colSpan={columnCount} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
});

export default TorrentListTable;
