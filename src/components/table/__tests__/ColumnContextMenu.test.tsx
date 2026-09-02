import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ColumnContextMenu from '../ColumnContextMenu';

/**
 * Right-clicking a table header offers each column as a tick. Two things have
 * to happen on every pick and both are easy to lose: the column's own display
 * flag flips, and the whole set is persisted — a toggle that is not saved comes
 * back on the next open, which reads as the menu not working.
 */

afterEach(cleanup);

function column(name: string, display: boolean) {
  return {
    column: name,
    lang: `OV_COL_${name.toUpperCase()}`,
    display,
    toggleDisplay: vi.fn<() => void>(),
  };
}

type TestColumn = ReturnType<typeof column>;
let columns: TestColumn[];
let onSave: Mock<() => void>;

beforeEach(() => {
  columns = [column('name', true), column('size', false), column('eta', true)];
  onSave = vi.fn<() => void>();
});

function open() {
  render(
    <ColumnContextMenu columns={columns as never} onSave={onSave}>
      <span data-testid="head">header</span>
    </ColumnContextMenu>
  );
  fireEvent.contextMenu(screen.getByTestId('head'));
}

const items = () => screen.getAllByRole('menuitem');

describe('ColumnContextMenu', () => {
  it('offers every column, shown or not', () => {
    // The hidden ones are the whole point: this is how they come back.
    open();

    expect(items()).toHaveLength(3);
  });

  it('ticks the columns that are shown', () => {
    open();

    expect(items()[0].textContent).toContain('●');
    expect(items()[1].textContent).not.toContain('●');
  });

  it('names each column through the locale rather than by its key', () => {
    open();

    expect(items()[0].textContent).toContain('OV_COL_NAME');
  });

  it('flips the column that was picked, and only that one', () => {
    open();
    fireEvent.click(items()[1]);

    expect(columns[1].toggleDisplay).toHaveBeenCalledTimes(1);
    expect(columns[0].toggleDisplay).not.toHaveBeenCalled();
  });

  it('persists the set on every pick', () => {
    // Unsaved, the toggle comes back on the next open and the menu looks
    // broken.
    open();
    fireEvent.click(items()[0]);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves after flipping, not before', () => {
    // Saving first would persist the state the user just changed away from.
    const order: string[] = [];
    columns[0].toggleDisplay.mockImplementation(() => {
      order.push('toggle');
    });
    onSave.mockImplementation(() => {
      order.push('save');
    });
    open();
    fireEvent.click(items()[0]);

    expect(order).toEqual(['toggle', 'save']);
  });

  it('renders no menu at all when there are no columns', () => {
    columns = [];
    open();

    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });
});
