import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { observable, runInAction } from 'mobx';

// The context menu pulls in the whole store; the row's own behaviour is what
// is under test, so it is passed straight through.
vi.mock('../../menu/TorrentContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stand-in renderers: each records the width it was handed, which is how the
// subscription rule below is observed.
const widths = vi.hoisted(() => ({ current: {} as Record<string, number> }));
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../torrentColumns', () => ({
  default: {
    select: (ctx: { handleSelect: (e: unknown) => void }, width: number) => {
      widths.current.select = width;
      return (
        <td key="select">
          <input type="checkbox" onChange={ctx.handleSelect} />
        </td>
      );
    },
    name: (_ctx: unknown, width: number) => {
      widths.current.name = width;
      return <td key="name">name</td>;
    },
    size: (_ctx: unknown, width: number) => {
      widths.current.size = width;
      return <td key="size">size</td>;
    },
  },
}));

const store = vi.hoisted(() => ({
  createFileList: vi.fn(),
  torrentList: {
    addMultipleSelectedId: vi.fn(),
    addSelectedId: vi.fn(),
    removeSelectedId: vi.fn(),
  },
  config: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import TorrentListTableItem from '../TorrentListTableItem';

/**
 * One row of the torrent list, rendered a few hundred times over.
 *
 * Two things here are about what the row does NOT do. A double-click opens the
 * file list, but a double-click on the row's own checkbox or start/stop button
 * used to pop the panel as well, because the event bubbles. And the column
 * width is read only for the name column — the only renderer that uses it —
 * because destructuring it for every column subscribed each row to all
 * fourteen width atoms, so a single drag of a header re-rendered the whole
 * list about sixty times a second.
 */

afterEach(cleanup);

function torrent(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    selected: false,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const COLUMNS = [
  { column: 'select', width: 30 },
  { column: 'name', width: 250 },
  { column: 'size', width: 80 },
];

beforeEach(() => {
  widths.current = {};
  renders.count = 0;
  store.createFileList.mockClear();
  Object.values(store.torrentList).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
  store.config = { visibleTorrentColumns: COLUMNS };
});

const draw = (props: Record<string, unknown> = {}) =>
  render(<TorrentListTableItem torrent={torrent() as never} {...props} />);

const checkbox = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;
const row = () => document.querySelector('tr') as HTMLTableRowElement;

describe('TorrentListTableItem — selecting', () => {
  it('adds the row to the selection', () => {
    draw();
    fireEvent.click(checkbox());

    expect(store.torrentList.addSelectedId).toHaveBeenCalledWith(7);
  });

  it('extends the selection when shift is held', () => {
    draw();
    fireEvent.click(checkbox(), { shiftKey: true });

    expect(store.torrentList.addMultipleSelectedId).toHaveBeenCalledWith(7);
    expect(store.torrentList.addSelectedId).not.toHaveBeenCalled();
  });

  it('removes a row that was already selected', () => {
    draw({ torrent: torrent({ selected: true }) as never });
    fireEvent.click(checkbox());

    expect(store.torrentList.removeSelectedId).toHaveBeenCalledWith(7);
  });

  it('ignores shift when deselecting, which is not a range', () => {
    draw({ torrent: torrent({ selected: true }) as never });
    fireEvent.click(checkbox(), { shiftKey: true });

    expect(store.torrentList.removeSelectedId).toHaveBeenCalledWith(7);
    expect(store.torrentList.addMultipleSelectedId).not.toHaveBeenCalled();
  });

  it('marks a selected row so the styling can follow', () => {
    draw({ torrent: torrent({ selected: true }) as never });

    expect(row().className).toContain('selected');
  });
});

describe('TorrentListTableItem — double-clicking', () => {
  it('opens the file list for the row', () => {
    draw();
    fireEvent.doubleClick(row());

    expect(store.createFileList).toHaveBeenCalledWith(7);
  });

  it('does not open it from the row’s own checkbox', () => {
    // The event bubbles: double-clicking the checkbox popped the file panel
    // as well, which is never what that gesture meant.
    draw();
    fireEvent.doubleClick(checkbox());

    expect(store.createFileList).not.toHaveBeenCalled();
  });

  it('does not open it from a control inside a cell', () => {
    store.config = { visibleTorrentColumns: [{ column: 'select', width: 30 }] };
    draw();
    const label = document.createElement('label');
    checkbox().parentElement?.appendChild(label);

    fireEvent.doubleClick(label);

    expect(store.createFileList).not.toHaveBeenCalled();
  });
});

describe('TorrentListTableItem — the columns', () => {
  it('hands the width to the name column, which is the one that uses it', () => {
    draw();

    expect(widths.current.name).toBe(250);
  });

  it('hands zero to every other column', () => {
    // Reading each column's width subscribed the row to all fourteen width
    // atoms, so one header drag re-rendered the whole list.
    draw();

    expect(widths.current.select).toBe(0);
    expect(widths.current.size).toBe(0);
  });

  it('does not re-render when another column is resized', () => {
    // The observable proof of the rule above: only the name width may wake a
    // row up.
    const columns = observable([
      { column: 'select', width: 30 },
      { column: 'name', width: 250 },
      { column: 'size', width: 80 },
    ]);
    store.config = { visibleTorrentColumns: columns };
    draw();
    const before = widths.current.name;

    act(() => {
      runInAction(() => {
        columns[2].width = 500;
      });
    });

    expect(widths.current.name).toBe(before);
    expect(widths.current.size).toBe(0);
  });

  it('skips a column with no renderer rather than failing the row', () => {
    // A column name persisted by an older build is not a reason to lose the
    // whole list.
    store.config = {
      visibleTorrentColumns: [...COLUMNS, { column: 'somethingRemoved', width: 40 }],
    };

    expect(draw).not.toThrow();
    expect(document.querySelectorAll('td')).toHaveLength(3);
  });

  it('renders nothing before the config is loaded', () => {
    store.config = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});

describe('TorrentListTableItem — its place in the list', () => {
  it('stripes from the absolute position, not from the rendered window', () => {
    // Virtualization breaks :nth-child parity, so the stripe is passed in.
    draw({ even: true });

    expect(row().className).toContain('even');
  });

  it('reports its position in the whole list to assistive technology', () => {
    draw({ rowIndex: 42 });

    expect(row().getAttribute('aria-rowindex')).toBe('42');
  });
});
