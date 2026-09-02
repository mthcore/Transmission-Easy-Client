import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// The window is driven from the test rather than measured from a layout jsdom
// does not have.
const virtual = vi.hoisted(() => ({
  current: {
    start: 0,
    end: 3,
    padTop: 0,
    padBottom: 0,
    bodyRef: { current: null },
    onScroll: vi.fn(),
  },
}));
vi.mock('../../../hooks/useVirtualRows', () => ({
  useVirtualRows: () => virtual.current,
}));

const scrollSync = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useScrollSync', () => ({ useScrollSync: () => scrollSync }));

// Each row records the props the table gave it; the row's own behaviour is
// covered separately.
const rows = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock('../TorrentListTableItem', () => ({
  default: (props: Record<string, unknown>) => {
    rows.current.push(props);
    return (
      <tr data-testid="row" data-even={String(props.even)} aria-rowindex={props.rowIndex as number}>
        <td />
      </tr>
    );
  },
}));
vi.mock('../ColumnContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../TableHeadColumnRenderer', () => ({
  default: ({ column }: { column: { column: string } }) => <th>{column.column}</th>,
}));

const store = vi.hoisted(() => ({
  flushTorrentList: vi.fn(),
  isRefreshing: false,
  config: undefined as unknown,
  torrentList: {
    sortedTorrents: [] as { id: number }[],
    isSelectedAll: false,
    toggleSelectAll: vi.fn(),
  },
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import TorrentListTable from '../TorrentListTable';

/**
 * The torrent list is windowed: only the rows in view exist in the DOM, plus a
 * little overscan. With the whole library rendered, a sort or a select-all on
 * two thousand torrents re-rendered two thousand rows and froze the popup for
 * most of a second.
 *
 * Windowing then costs two things that have to be given back by hand. A screen
 * reader counts the rows it can see, so a two-thousand-torrent library
 * announced itself as thirty — the full count and each row's absolute position
 * are stated explicitly. And the spacer rows that stand in for the scrolled-out
 * ones shift every DOM position, so :nth-child striping swapped on every scroll
 * step; the stripe comes from the absolute index instead.
 */

afterEach(cleanup);

const COLUMNS = [
  { column: 'checkbox', width: 30 },
  { column: 'name', width: 250 },
];

beforeEach(() => {
  rows.current = [];
  store.flushTorrentList.mockClear();
  store.isRefreshing = false;
  store.config = {
    visibleTorrentColumns: COLUMNS,
    activeTorrentColumns: COLUMNS,
    torrentsSort: { by: 'name', direction: 1 },
    saveTorrentsColumns: vi.fn(),
    setTorrentsSort: vi.fn(),
    moveTorrentsColumn: vi.fn(),
  };
  store.torrentList = {
    sortedTorrents: Array.from({ length: 100 }, (_, id) => ({ id })),
    isSelectedAll: false,
    toggleSelectAll: vi.fn(),
  };
  virtual.current = {
    start: 0,
    end: 3,
    padTop: 0,
    padBottom: 0,
    bodyRef: { current: null },
    onScroll: vi.fn(),
  };
});

const draw = () => render(<TorrentListTable />);
const body = () => document.querySelector('table.torrent-table-body') as HTMLTableElement;
const spacers = () => document.querySelectorAll('tr[data-virtual-spacer]');

describe('TorrentListTable — windowing', () => {
  it('renders only the rows in the window', () => {
    draw();

    expect(document.querySelectorAll('[data-testid="row"]')).toHaveLength(3);
  });

  it('renders the slice the window asks for, not the first rows', () => {
    virtual.current = { ...virtual.current, start: 40, end: 43 };
    draw();

    expect(rows.current.map((props) => (props.torrent as { id: number }).id)).toEqual([40, 41, 42]);
  });

  it('stands in for the scrolled-out rows so the scrollbar stays honest', () => {
    virtual.current = { ...virtual.current, start: 40, end: 43, padTop: 800, padBottom: 1140 };
    draw();

    expect(spacers()).toHaveLength(2);
  });

  it('adds no spacer where there is nothing to stand in for', () => {
    draw();

    expect(spacers()).toHaveLength(0);
  });

  it('hides the spacers from assistive technology', () => {
    // They are scrollbar geometry, not rows.
    virtual.current = { ...virtual.current, padTop: 800 };
    draw();

    expect(spacers()[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('spans the spacer across every column, so the table stays one grid', () => {
    virtual.current = { ...virtual.current, padTop: 800 };
    draw();

    expect(spacers()[0].querySelector('td')?.getAttribute('colspan')).toBe('2');
  });
});

describe('TorrentListTable — what windowing costs, given back', () => {
  it('announces the whole library, not the rows in view', () => {
    // A two-thousand-torrent library announced itself as thirty.
    draw();

    expect(body().getAttribute('aria-rowcount')).toBe('100');
  });

  it('gives each row its absolute position, counting the header as row one', () => {
    virtual.current = { ...virtual.current, start: 40, end: 42 };
    draw();

    expect(rows.current.map((props) => props.rowIndex)).toEqual([42, 43]);
  });

  it('stripes from the absolute index, not from the DOM position', () => {
    // The spacer row shifts every position, so :nth-child parity swapped on
    // each scroll step and the whole list flickered.
    //
    // `even` is the row's parity counting from one, so it is true for an odd
    // zero-based index: rows 41, 42, 43 are the 42nd, 43rd and 44th.
    virtual.current = { ...virtual.current, start: 41, end: 44 };
    draw();

    expect(rows.current.map((props) => props.even)).toEqual([true, false, true]);
  });

  it('keeps a row on the same stripe as the window moves past it', () => {
    // The point of using the absolute index: the same torrent must not change
    // colour because the window scrolled.
    virtual.current = { ...virtual.current, start: 41, end: 44 };
    draw();
    const before = rows.current[1].even;

    cleanup();
    rows.current = [];
    virtual.current = { ...virtual.current, start: 40, end: 44 };
    draw();

    expect(rows.current[2].even).toBe(before);
  });
});

describe('TorrentListTable — the rest of the frame', () => {
  it('publishes each column width as a CSS variable', () => {
    // The rows are sized from these rather than from props, so a resize does
    // not re-render them.
    draw();
    const layer = document.querySelector('.torrent-list-layer') as HTMLElement;

    expect(layer.style.getPropertyValue('--col-name-w')).toBe('250px');
    expect(layer.style.getPropertyValue('--col-checkbox-w')).toBe('30px');
  });

  it('drives both the header and the window from one scroll', () => {
    // The fixed header is moved to match, and the window is recomputed.
    draw();
    fireEvent.scroll(document.querySelector('.torrent-list-layer') as HTMLElement);

    expect(scrollSync).toHaveBeenCalled();
    expect(virtual.current.onScroll).toHaveBeenCalled();
  });

  it('clears the previous list state on mount', () => {
    // A selection left from the last time this page was open would otherwise
    // apply to whatever is in the list now.
    draw();

    expect(store.flushTorrentList).toHaveBeenCalled();
  });

  it('shows a spinner while a refresh is in flight', () => {
    store.isRefreshing = true;
    draw();

    expect(document.querySelector('.torrent-list-loading')).not.toBeNull();
  });

  it('renders a header row per visible column', () => {
    draw();

    // One head in the fixed table, one in the body table
    expect(document.querySelectorAll('th')).toHaveLength(4);
  });

  it('renders nothing before the config is loaded', () => {
    store.config = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});
