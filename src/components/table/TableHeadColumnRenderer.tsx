import React, { useCallback, ChangeEvent } from 'react';
import { observer } from 'mobx-react';
import { Column } from './TableHeadColumn';
import { useTableHeadColumn } from '../../hooks/useTableHeadColumn';

interface TableHeadColumnRendererProps {
  column: Column;
  isSorted: boolean;
  sortDirection: number;
  onMoveColumn: (from: string, to: string) => void;
  onSort: (column: string, direction: number) => void;
  onSaveColumns: () => void;
  type: 'tr' | 'fl';
  fixedColumns: string[];
  isSelectedAll?: boolean;
  onToggleSelectAll?: () => void;
}

const TableHeadColumnRenderer = observer((props: TableHeadColumnRendererProps) => {
  const {
    column,
    isSorted,
    sortDirection,
    onMoveColumn,
    onSort,
    onSaveColumns,
    type,
    fixedColumns,
    isSelectedAll,
    onToggleSelectAll,
  } = props;

  const {
    refTh,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleResizeClick,
    handleResizeMouseDown,
    handleSort,
  } = useTableHeadColumn({
    type,
    column,
    onMoveColumn,
    onSaveColumns,
    onSort,
    isSorted,
    sortDirection,
  });

  const handleSelectAll = useCallback(
    (_e: ChangeEvent<HTMLInputElement>) => {
      onToggleSelectAll?.();
    },
    [onToggleSelectAll]
  );

  const classList = [column.column];
  if (isSorted) {
    classList.push(sortDirection === 1 ? 'sortDown' : 'sortUp');
  }

  const isFixedColumn = fixedColumns.includes(column.column);

  let body: React.ReactNode;
  if (column.column === 'checkbox') {
    body = (
      <div>
        <input
          checked={isSelectedAll}
          onChange={handleSelectAll}
          type="checkbox"
          aria-label={chrome.i18n.getMessage('selectAll')}
        />
      </div>
    );
  } else if (isFixedColumn) {
    body = <div />;
  } else {
    body = (
      <div>
        {chrome.i18n.getMessage(column.lang + '_SHORT') || chrome.i18n.getMessage(column.lang)}
      </div>
    );
  }

  let arrow: React.ReactNode = null;
  if (column.order !== 0) {
    arrow = <i className="arrow" />;
  }

  const onClick = column.order ? handleSort : undefined;
  const title = isFixedColumn ? '' : chrome.i18n.getMessage(column.lang);

  let ariaSort: 'ascending' | 'descending' | 'none' | undefined;
  if (column.order !== 0) {
    // direction 1 IS ascending in the sorter — the mapping was inverted, so
    // screen readers announced the opposite of the visible order
    ariaSort = isSorted ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none';
  }

  return (
    <th
      ref={refTh}
      scope="col"
      onClick={onClick}
      onDragStart={isFixedColumn ? undefined : handleDragStart}
      onDragOver={isFixedColumn ? undefined : handleDragOver}
      onDrop={isFixedColumn ? undefined : handleDrop}
      className={classList.join(' ')}
      title={title}
      // The checkbox and actions columns are position-fixed by design (the
      // actions cell is sticky to the row edge): letting them be dragged, or
      // dropped onto, persisted a broken order with the sticky column mid-table
      draggable={!isFixedColumn}
      aria-sort={ariaSort}
      aria-label={isFixedColumn ? column.column : undefined}
    >
      {body}
      {!isFixedColumn && (
        <div
          className="resize-el"
          role="separator"
          aria-orientation="vertical"
          draggable={false}
          onClick={handleResizeClick}
          onMouseDown={handleResizeMouseDown}
        />
      )}
      {arrow}
    </th>
  );
});

export default TableHeadColumnRenderer;
