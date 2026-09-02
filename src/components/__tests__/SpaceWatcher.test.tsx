import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const intervalProps = vi.hoisted(() => ({ current: null as { onFire?: () => void } | null }));
vi.mock('../Interval', () => ({
  default: (props: { onFire: () => void; interval: number }) => {
    intervalProps.current = props;
    return <div data-testid="interval" />;
  },
}));
// The real one renders nothing while the page is hidden; standing in for it
// keeps the gate itself visible to the assertions below.
vi.mock('../VisiblePage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="visible-gate">{children}</div>
  ),
}));

const store = vi.hoisted(() => ({
  createSpaceWatcher: vi.fn(),
  destroySpaceWatcher: vi.fn(),
  spaceWatcher: undefined as unknown,
}));
vi.mock('../../hooks/useRootStore', () => ({ default: () => store }));

import SpaceWatcher from '../SpaceWatcher';
import { SPACE_WATCHER_INTERVAL } from '../../constants';

/**
 * Free space is a poll of its own, separate from the torrent list, so it owns
 * a store that exists only while the footer shows it.
 *
 * The part that matters is the gate. A backgrounded tab went on waking the
 * service worker with a free-space request every minute, for as long as the
 * browser stayed open — the poll has to be inside the visibility gate, not
 * beside it.
 */

afterEach(cleanup);

let watcher: Record<string, unknown>;

beforeEach(() => {
  store.createSpaceWatcher.mockClear();
  store.destroySpaceWatcher.mockClear();
  intervalProps.current = null;
  watcher = {
    state: 'done',
    errorMessage: '',
    downloadDirs: [{ path: '/downloads', availableStr: '120 GB' }],
    fetchDownloadDirs: vi.fn(),
  };
  store.spaceWatcher = watcher;
});

const draw = () => render(<SpaceWatcher />);
const readout = () => document.querySelector('span.space.disk');

describe('SpaceWatcher — the store it owns', () => {
  it('creates the watcher when the footer shows it', () => {
    draw();

    expect(store.createSpaceWatcher).toHaveBeenCalled();
  });

  it('destroys it again when the footer stops showing it', () => {
    // Left alive, its poll outlives the thing that asked for it.
    const { unmount } = draw();
    unmount();

    expect(store.destroySpaceWatcher).toHaveBeenCalled();
  });

  it('renders nothing until the watcher exists', () => {
    store.spaceWatcher = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});

describe('SpaceWatcher — polling', () => {
  it('polls inside the visibility gate, not beside it', () => {
    // A backgrounded tab kept waking the service worker every minute forever.
    draw();
    const gate = screen.getByTestId('visible-gate');

    expect(gate.querySelector('[data-testid="interval"]')).not.toBeNull();
  });

  it('polls at the free-space interval, not the torrent-list one', () => {
    draw();

    expect(intervalProps.current).toMatchObject({ interval: SPACE_WATCHER_INTERVAL });
  });

  it('fetches when the interval fires', () => {
    draw();
    intervalProps.current?.onFire?.();

    expect(watcher.fetchDownloadDirs).toHaveBeenCalled();
  });

  it('fetches again when the readout is clicked', () => {
    // The only way to refresh without waiting out a whole interval.
    draw();
    fireEvent.click(readout()!);

    expect(watcher.fetchDownloadDirs).toHaveBeenCalled();
  });
});

describe('SpaceWatcher — what it shows', () => {
  it('shows the free space per download directory', () => {
    draw();

    expect(readout()).toHaveTextContent('120 GB');
  });

  it('names the directory in the tooltip, since the readout has no room', () => {
    draw();

    expect(readout()?.getAttribute('title')).toContain('/downloads');
  });

  it('lists every directory the daemon reported', () => {
    watcher.downloadDirs = [
      { path: '/a', availableStr: '1 GB' },
      { path: '/b', availableStr: '2 GB' },
    ];
    draw();

    expect(readout()).toHaveTextContent('1 GB');
    expect(readout()).toHaveTextContent('2 GB');
  });

  it('shows it is working while the first answer is on its way', () => {
    watcher.state = 'pending';
    draw();

    expect(readout()).toHaveTextContent('...');
  });

  it('shows a dash and the reason when the fetch failed', () => {
    // A blank readout is indistinguishable from a disk with no space left.
    watcher.state = 'error';
    watcher.errorMessage = 'Connection refused';
    draw();

    expect(readout()).toHaveTextContent('-');
    expect(readout()?.getAttribute('title')).toBe('Connection refused');
  });

  it('still offers a way to retry after a failure', () => {
    watcher.state = 'error';
    draw();
    fireEvent.click(readout()!);

    expect(watcher.fetchDownloadDirs).toHaveBeenCalled();
  });
});
