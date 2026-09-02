import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableHeadColumn } from '../useTableHeadColumn';
import { MIN_COLUMN_WIDTH } from '../../constants';

/**
 * Column headers do two things with the mouse that must not become one: a drag
 * reorders the columns, a drag on the edge resizes one. They share a button, so
 * every case here is about telling them apart or about ending cleanly.
 *
 * Three of these were bugs. Resizing without disabling `draggable` started a
 * column drag as well; releasing the button outside the window left the resize
 * armed, so the column then followed the pointer with no button held; and in a
 * right-to-left layout a column grows leftward, so an unflipped delta made
 * pulling the handle outward shrink the column.
 */

const NAME = 'size';
const TYPE = 'torrent';

function setup(overrides: Record<string, unknown> = {}) {
  const onMoveColumn = vi.fn();
  const onSaveColumns = vi.fn();
  const onSort = vi.fn();
  const column = { column: NAME, width: 120, setWidth: vi.fn() };
  const hook = renderHook(() =>
    useTableHeadColumn({
      type: TYPE,
      column,
      onMoveColumn,
      onSaveColumns,
      onSort,
      isSorted: false,
      sortDirection: 1,
      ...overrides,
    } as never)
  );
  const th = document.createElement('th');
  (hook.result.current.refTh as { current: HTMLElement | null }).current = th;
  return { ...hook, onMoveColumn, onSaveColumns, onSort, column, th };
}

/** A drag event whose dataTransfer carries the dragged column's identity. */
function dragEvent(target: HTMLElement, data: Record<string, string> = {}) {
  return {
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      setData: vi.fn(),
      getData: (key: string) => data[key] ?? '',
    },
  } as never;
}

const th = () => document.createElement('th');

function mouse(clientX: number, extra: Record<string, unknown> = {}) {
  return {
    clientX,
    button: 0,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...extra,
  } as never;
}

afterEach(() => {
  document.documentElement.dir = '';
});

describe('useTableHeadColumn — reordering', () => {
  it('carries the column name and the table it belongs to', () => {
    const { result } = setup();
    const event = dragEvent(th());

    act(() => result.current.handleDragStart(event));

    const setData = (event as unknown as { dataTransfer: { setData: ReturnType<typeof vi.fn> } })
      .dataTransfer.setData;
    expect(setData).toHaveBeenCalledWith('name', NAME);
    expect(setData).toHaveBeenCalledWith('type', TYPE);
  });

  it('moves the dragged column onto this one', () => {
    const { result, onMoveColumn } = setup();

    act(() => result.current.handleDrop(dragEvent(th(), { name: 'name', type: TYPE })));

    expect(onMoveColumn).toHaveBeenCalledWith('name', NAME);
  });

  it('accepts a drop on a child of the header cell', () => {
    // The cell holds a label and a resize handle; the drop lands on whichever
    // the pointer was over.
    const cell = th();
    const label = document.createElement('span');
    cell.appendChild(label);
    const { result, onMoveColumn } = setup();

    act(() => result.current.handleDrop(dragEvent(label, { name: 'name', type: TYPE })));

    expect(onMoveColumn).toHaveBeenCalledWith('name', NAME);
  });

  it('refuses a column dragged from another table', () => {
    // The torrent list and the file list both have draggable headers; a column
    // moved between them would name something the other table does not have.
    const { result, onMoveColumn } = setup();

    act(() => result.current.handleDrop(dragEvent(th(), { name: 'name', type: 'file' })));

    expect(onMoveColumn).not.toHaveBeenCalled();
  });

  it('does nothing when a column is dropped on itself', () => {
    const { result, onMoveColumn } = setup();

    act(() => result.current.handleDrop(dragEvent(th(), { name: NAME, type: TYPE })));

    expect(onMoveColumn).not.toHaveBeenCalled();
  });

  it('ignores a drop that did not land on a header cell at all', () => {
    const { result, onMoveColumn } = setup();
    const stray = document.createElement('div');

    act(() => result.current.handleDrop(dragEvent(stray, { name: 'name', type: TYPE })));

    expect(onMoveColumn).not.toHaveBeenCalled();
  });

  it('claims the dragover so the cell becomes a drop target', () => {
    const { result } = setup();
    const event = dragEvent(th());

    act(() => result.current.handleDragOver(event));

    expect(
      (event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).toHaveBeenCalled();
  });

  it('leaves a dragover outside the headers alone', () => {
    const { result } = setup();
    const event = dragEvent(document.createElement('div'));

    act(() => result.current.handleDragOver(event));

    expect(
      (event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).not.toHaveBeenCalled();
  });
});

describe('useTableHeadColumn — resizing', () => {
  // clientX and buttons are read-only accessors on MouseEvent, so they have to
  // come from the init dict rather than be assigned afterwards.
  const move = (clientX: number, buttons = 1) =>
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, buttons }));
    });

  it('widens the column by the distance dragged', () => {
    const { result, column } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    move(160);

    expect(column.setWidth).toHaveBeenLastCalledWith(180);
  });

  it('stops the column from being dragged while it is resized', () => {
    // Both live on the same cell: without this, pulling the edge started a
    // column reorder at the same time.
    const { result, th: cell } = setup();
    cell.draggable = true;

    act(() => result.current.handleResizeMouseDown(mouse(100)));

    expect(cell.draggable).toBe(false);
  });

  it('makes it draggable again and saves once the resize ends', () => {
    const { result, th: cell, onSaveColumns } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(cell.draggable).toBe(true);
    expect(onSaveColumns).toHaveBeenCalledTimes(1);
  });

  it('never shrinks a column past the minimum', () => {
    const { result, column } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    move(-500);

    expect(column.setWidth).toHaveBeenLastCalledWith(MIN_COLUMN_WIDTH);
  });

  it('grows leftward in a right-to-left layout', () => {
    // Unflipped, pulling the handle outward shrank the column.
    document.documentElement.dir = 'rtl';
    const { result, column } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    move(40);

    expect(column.setWidth).toHaveBeenLastCalledWith(120 + (100 - 40));
  });

  it('ends the resize when the button was released outside the window', () => {
    // No mouseup ever arrives, so the drag stayed armed and the column then
    // followed the pointer with no button held.
    const { result, column, onSaveColumns } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    move(160, 0);

    expect(column.setWidth).not.toHaveBeenCalled();
    expect(onSaveColumns).toHaveBeenCalledTimes(1);

    move(300);
    expect(column.setWidth).not.toHaveBeenCalled();
  });

  it('starts on the left button only', () => {
    // A right click opens the column menu; it must not also arm a resize.
    const { result, column } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100, { button: 2 })));
    move(160);

    expect(column.setWidth).not.toHaveBeenCalled();
  });

  it('measures from the stored width, not from the rendered one', () => {
    // clientWidth includes padding and borders, so resizing from it jumped on
    // the first pixel of movement.
    const { result, column } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(0)));
    move(1);

    expect(column.setWidth).toHaveBeenLastCalledWith(121);
  });

  it('stops listening when the header goes away mid-drag', () => {
    const { result, column, unmount } = setup();

    act(() => result.current.handleResizeMouseDown(mouse(100)));
    unmount();
    move(160);

    expect(column.setWidth).not.toHaveBeenCalled();
  });
});

describe('useTableHeadColumn — sorting', () => {
  it('sorts ascending on a column that was not sorted', () => {
    const { result, onSort } = setup();

    act(() => result.current.handleSort(mouse(0)));

    expect(onSort).toHaveBeenCalledWith(NAME, 1);
  });

  it('reverses a column already sorted ascending', () => {
    const { result, onSort } = setup({ isSorted: true, sortDirection: 1 });

    act(() => result.current.handleSort(mouse(0)));

    expect(onSort).toHaveBeenCalledWith(NAME, 0);
  });

  it('returns to ascending from descending', () => {
    const { result, onSort } = setup({ isSorted: true, sortDirection: 0 });

    act(() => result.current.handleSort(mouse(0)));

    expect(onSort).toHaveBeenCalledWith(NAME, 1);
  });

  it('does not let a click on the resize handle sort the column', () => {
    const { result } = setup();
    const event = mouse(0);

    act(() => result.current.handleResizeClick(event));

    expect(
      (event as unknown as { stopPropagation: ReturnType<typeof vi.fn> }).stopPropagation
    ).toHaveBeenCalled();
  });
});
