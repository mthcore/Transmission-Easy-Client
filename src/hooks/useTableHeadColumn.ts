import { useRef, useCallback, useEffect } from 'react';
import { DragEvent, MouseEvent } from 'react';
import { MIN_COLUMN_WIDTH } from '../constants';

interface Column {
  column: string;
  width: number;
  setWidth: (width: number) => void;
}

interface UseTableHeadColumnProps {
  type: string;
  column: Column;
  onMoveColumn: (from: string, to: string) => void;
  onSaveColumns: () => void;
  onSort: (column: string, direction: number) => void;
  isSorted: boolean;
  sortDirection: number;
}

export function useTableHeadColumn({
  type,
  column,
  onMoveColumn,
  onSaveColumns,
  onSort,
  isSorted,
  sortDirection,
}: UseTableHeadColumnProps) {
  const refTh = useRef<HTMLTableCellElement>(null);
  const resizeStartSize = useRef(0);
  const resizeStartClientX = useRef(0);

  // Drag & Drop handlers
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLTableCellElement>) => {
      e.dataTransfer.setData('name', column.column);
      e.dataTransfer.setData('type', type);
    },
    [column.column, type]
  );

  // Only a header cell, or something inside one, is a drop target. The parent
  // is checked because the pointer reports whichever child it is over — a
  // label or the resize handle. A target with no parent at all is not a header
  // cell either; the previous form let it through, because `&& el.parentNode`
  // made the whole guard false rather than the cell acceptable.
  const isHeaderCell = (el: HTMLElement | null): boolean =>
    !!el && (el.tagName === 'TH' || (el.parentNode as HTMLElement | null)?.tagName === 'TH');

  const handleDragOver = useCallback((e: DragEvent<HTMLTableCellElement>) => {
    if (!isHeaderCell(e.target as HTMLElement)) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLTableCellElement>) => {
      e.preventDefault();
      e.stopPropagation();
      let el = e.target as HTMLElement | null;
      if (el && el.tagName !== 'TH') {
        el = el.parentNode as HTMLElement | null;
      }
      // Null-safe: reading tagName off a missing parent threw here, before the
      // guard that was meant to reject exactly this could run.
      if (el?.tagName !== 'TH') {
        return;
      }

      if (type !== e.dataTransfer.getData('type')) {
        return;
      }
      const toName = column.column;
      const fromName = e.dataTransfer.getData('name');
      if (toName === fromName) return;

      onMoveColumn(fromName, toName);
    },
    [type, column.column, onMoveColumn]
  );

  // Resize handlers - using refs to avoid recreating functions
  // Set once the resize handlers exist; lets a handler end the drag without a
  // circular reference between the callbacks
  const endResizeRef = useRef<(() => void) | null>(null);

  const handleBodyMouseMove = useCallback(
    (e: globalThis.MouseEvent) => {
      // The button was released outside the window: no mouseup ever reached us,
      // so the drag would stay armed and resize on the next mouse move
      if (e.buttons === 0) {
        endResizeRef.current?.();
        return;
      }
      // In RTL a column grows leftward, so the raw delta is inverted —
      // without the flip, pulling the handle outward SHRANK the column
      const rtl = document.documentElement.dir === 'rtl' ? -1 : 1;
      const delta = (e.clientX - resizeStartClientX.current) * rtl;
      let newSize = resizeStartSize.current + delta;
      if (newSize < MIN_COLUMN_WIDTH) {
        newSize = MIN_COLUMN_WIDTH;
      }
      column.setWidth(newSize);
    },
    [column]
  );

  const handleBodyMouseUp = useCallback((e: globalThis.MouseEvent) => {
    e.stopPropagation();
    endResizeRef.current?.();
  }, []);

  const endResize = useCallback(() => {
    document.body.removeEventListener('mousemove', handleBodyMouseMove);
    document.body.removeEventListener('mouseup', handleBodyMouseUp);

    if (refTh.current) {
      refTh.current.draggable = true;
    }

    onSaveColumns();
  }, [handleBodyMouseMove, handleBodyMouseUp, onSaveColumns]);

  useEffect(() => {
    endResizeRef.current = endResize;
  }, [endResize]);

  const handleResizeClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  const handleResizeMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      if (refTh.current) {
        refTh.current.draggable = false;
      }

      // Use stored column width instead of clientWidth for consistent behavior
      resizeStartSize.current = column.width;
      resizeStartClientX.current = e.clientX;

      document.body.addEventListener('mousemove', handleBodyMouseMove);
      document.body.addEventListener('mouseup', handleBodyMouseUp);
    },
    [column.width, handleBodyMouseMove, handleBodyMouseUp]
  );

  const handleSort = useCallback(
    (e: MouseEvent<HTMLTableCellElement>) => {
      e.preventDefault();
      let direction = 1;
      if (isSorted) {
        direction = sortDirection === 1 ? 0 : 1;
      }
      onSort(column.column, direction);
    },
    [isSorted, sortDirection, onSort, column.column]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.removeEventListener('mousemove', handleBodyMouseMove);
      document.body.removeEventListener('mouseup', handleBodyMouseUp);
    };
  }, [handleBodyMouseMove, handleBodyMouseUp]);

  return {
    refTh,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleResizeClick,
    handleResizeMouseDown,
    handleSort,
  };
}
