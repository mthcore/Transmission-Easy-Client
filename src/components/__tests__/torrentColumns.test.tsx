import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import torrentColumnRenderers, { TorrentColumnCtx } from '../table/torrentColumns';
import getEta from '../../tools/getEta';
import type { Torrent } from '../../types/stores';

/**
 * Plain-object fixture matching the Torrent type (snapshot + computed views).
 * No MST tree: the renderers only read properties, so a literal is enough and
 * keeps the tests focused on rendering instead of store wiring.
 *
 * The `*Str` views that carry real formatting logic (eta, share ratio, labels,
 * sizes) are derived from the snapshot fields, so passing `eta: -1` or
 * `shared: 1234` exercises the same string the store would hand the renderer.
 */
function createTorrent(overrides: Partial<Torrent> = {}): Torrent {
  const snapshot = {
    id: 42,
    statusCode: 4,
    errorCode: 0,
    errorString: '',
    name: 'ubuntu-24.04-desktop-amd64.iso',
    size: 5_000_000,
    sizeWhenDone: 5_000_000,
    percentDone: 0.5,
    recheckProgress: 0,
    downloaded: 2_500_000,
    uploaded: 1_000_000,
    shared: 400,
    uploadSpeed: 0,
    downloadSpeed: 0,
    eta: 3600,
    etaIdle: -1,
    activePeers: 3,
    peers: 10,
    activeSeeds: 5,
    seeds: 8,
    order: 1,
    addedTime: 1_700_000_000,
    completedTime: 0,
    activityDate: 0,
    startDate: 0,
    editDate: 0,
    directory: '/downloads',
    magnetLink: undefined,
    hashString: 'abcdef1234567890abcdef1234567890abcdef12',
    isStalled: false,
    isPrivate: false,
    isFinished: false,
    metadataPercentComplete: 1,
    peersConnected: 7,
    labels: [] as string[],
    bandwidthPriority: 0,
    sequentialDownload: false,
    ...overrides,
  };

  const derived = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remaining: Math.max(0, snapshot.size - snapshot.downloaded),
    remainingStr: '2.5 MB',
    isCompleted: snapshot.percentDone === 1,
    sizeStr: '5 MB',
    sizeWhenDoneStr: '5 MB',
    progress: Math.round(snapshot.percentDone * 1000),
    progressStr: `${snapshot.percentDone * 100}%`,
    recheckProgressStr: '0%',
    uploadSpeedStr: snapshot.uploadSpeed === 0 ? '' : '1 kB/s',
    downloadSpeedStr: snapshot.downloadSpeed === 0 ? '' : '2 kB/s',
    etaStr: getEta(snapshot.eta),
    etaIdleStr: snapshot.etaIdle < 0 ? '' : getEta(snapshot.etaIdle),
    metadataStatusStr:
      snapshot.metadataPercentComplete >= 1
        ? ''
        : `${(snapshot.metadataPercentComplete * 100).toFixed(0)}%`,
    uploadedStr: '1 MB',
    sharedStr: (snapshot.shared / 1000).toFixed(2),
    downloadedStr: '2.5 MB',
    addedTimeStr: '2023-11-14 22:13:20',
    completedTimeStr: '-',
    activityDateStr: '-',
    startDateStr: '-',
    editDateStr: '-',
    stateText: 'OV_FL_DOWNLOADING',
    errorMessage: '',
    selected: false,
    isStopped: snapshot.statusCode === 0,
    isQueuedToCheckFiles: snapshot.statusCode === 1,
    isChecking: snapshot.statusCode === 2,
    isQueuedToDownload: snapshot.statusCode === 3,
    isDownloading: snapshot.statusCode === 4,
    isQueuedToSeed: snapshot.statusCode === 5,
    isSeeding: snapshot.statusCode === 6,
    actions: [] as string[],
    isActive: snapshot.downloadSpeed > 0 || snapshot.uploadSpeed > 0,
    labelsStr: snapshot.labels.join(', '),
    bandwidthPriorityStr: 'MF_NORMAL',
    hash: snapshot.hashString ? snapshot.hashString.toUpperCase() : null,
  };

  // Overrides win over derived values so a test can pin an exact `*Str`.
  return { ...snapshot, ...derived, ...overrides } as Torrent;
}

function createCtx(overrides: Partial<TorrentColumnCtx> = {}): TorrentColumnCtx {
  return {
    torrent: createTorrent(),
    handleSelect: vi.fn(),
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    isStarting: false,
    isStopping: false,
    ...overrides,
  };
}

/** Renders a single column renderer inside a valid table context. */
function renderCell(column: string, ctx: TorrentColumnCtx, width = 200) {
  const renderer = torrentColumnRenderers[column];
  expect(renderer, `no renderer registered for column "${column}"`).toBeTypeOf('function');
  const view = render(
    <table>
      <tbody>
        <tr>{renderer(ctx, width)}</tr>
      </tbody>
    </table>
  );
  const cell = view.container.querySelector('td');
  if (!cell) throw new Error(`renderer for "${column}" produced no <td>`);
  return { ...view, cell };
}

describe('torrentColumnRenderers', () => {
  describe('checkbox', () => {
    it('renders an unchecked box labelled with the torrent name', () => {
      const ctx = createCtx({ torrent: createTorrent({ selected: false }) });
      renderCell('checkbox', ctx);

      const input = screen.getByRole('checkbox', {
        name: 'ubuntu-24.04-desktop-amd64.iso',
      }) as HTMLInputElement;
      expect(input.checked).toBe(false);
    });

    it('reflects the selected view as the checked state', () => {
      const ctx = createCtx({ torrent: createTorrent({ selected: true }) });
      renderCell('checkbox', ctx);

      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });

    it('fires handleSelect when toggled', () => {
      const handleSelect = vi.fn();
      const ctx = createCtx({ handleSelect });
      renderCell('checkbox', ctx);

      fireEvent.click(screen.getByRole('checkbox'));

      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleSelect.mock.calls[0][0].target).toBe(screen.getByRole('checkbox'));
    });
  });

  describe('name', () => {
    it('renders the torrent name', () => {
      renderCell('name', createCtx());

      expect(screen.getByText('ubuntu-24.04-desktop-amd64.iso')).toBeInTheDocument();
    });

    it('builds a tooltip with directory and hash, but no private tag for public torrents', () => {
      const { cell } = renderCell('name', createCtx());

      const title = cell.querySelector('span')?.getAttribute('title') ?? '';
      expect(title.split('\n')).toEqual([
        'ubuntu-24.04-desktop-amd64.iso',
        '/downloads',
        'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      ]);
    });

    it('adds the private marker and the size-when-done line when they apply', () => {
      const torrent = createTorrent({
        isPrivate: true,
        sizeStr: '5 MB',
        sizeWhenDoneStr: '4 MB',
      });
      const { cell } = renderCell('name', createCtx({ torrent }));

      const title = cell.querySelector('span')?.getAttribute('title') ?? '';
      expect(title.split('\n')).toEqual([
        'ubuntu-24.04-desktop-amd64.iso',
        '[DT_PRIVATE]',
        '/downloads',
        'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        'OV_COL_SIZE_WHEN_DONE: 4 MB',
      ]);
    });

    it('omits missing tooltip parts', () => {
      const torrent = createTorrent({ directory: undefined, hashString: undefined, hash: null });
      const { cell } = renderCell('name', createCtx({ torrent }));

      expect(cell.querySelector('span')?.getAttribute('title')).toBe(
        'ubuntu-24.04-desktop-amd64.iso'
      );
    });

    it('shows no metadata badge once metadata is complete', () => {
      const { cell } = renderCell('name', createCtx());

      expect(cell.querySelector('.torrent-badge.metadata')).toBeNull();
    });

    it('shows a metadata badge with a rounded percentage while metadata is loading', () => {
      const torrent = createTorrent({ metadataPercentComplete: 0.256 });
      const { cell } = renderCell('name', createCtx({ torrent }));

      const badge = cell.querySelector('.torrent-badge.metadata');
      expect(badge).not.toBeNull();
      expect(badge).toHaveTextContent('M');
      expect(badge).toHaveAttribute('title', 'DT_METADATA 26%');
    });
  });

  describe('size', () => {
    it('renders sizeStr and uses it alone as the tooltip when nothing is deselected', () => {
      const { cell } = renderCell('size', createCtx());

      expect(cell).toHaveTextContent('5 MB');
      expect(cell.querySelector('div')).toHaveAttribute('title', '5 MB');
    });

    it('mentions the size when done in the tooltip when it differs from the total size', () => {
      const torrent = createTorrent({ sizeStr: '5 MB', sizeWhenDoneStr: '3.5 MB' });
      const { cell } = renderCell('size', createCtx({ torrent }));

      expect(cell).toHaveTextContent('5 MB');
      expect(cell.querySelector('div')).toHaveAttribute(
        'title',
        '5 MB (OV_COL_SIZE_WHEN_DONE: 3.5 MB)'
      );
    });

    it('renders the sizeWhenDone column from its own view', () => {
      const torrent = createTorrent({ sizeWhenDoneStr: '3.5 MB' });
      const { cell } = renderCell('sizeWhenDone', createCtx({ torrent }));

      expect(cell).toHaveTextContent('3.5 MB');
      expect(cell.querySelector('div')).toHaveAttribute('title', '3.5 MB');
    });
  });

  describe('done (progress)', () => {
    it('renders the progress string and exposes it as a progressbar value', () => {
      const torrent = createTorrent({ percentDone: 0.5, progressStr: '50%' });
      const { cell } = renderCell('done', createCtx({ torrent }));

      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '50');
      expect(cell.querySelector('.progress_b_i')).toHaveClass('downloading');
      expect(cell.querySelector('.progress_b_i')).toHaveStyle({ width: '50%' });
    });

    it('marks the bar as seeding when the torrent is seeding', () => {
      const torrent = createTorrent({ statusCode: 6, isSeeding: true, progressStr: '100%' });
      const { cell } = renderCell('done', createCtx({ torrent }));

      expect(cell.querySelector('.progress_b_i')).toHaveClass('seeding');
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('falls back to a zero value for an unparsable progress string', () => {
      const torrent = createTorrent({ progressStr: '' });
      renderCell('done', createCtx({ torrent }));

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });
  });

  describe('eta', () => {
    it('renders a finite eta', () => {
      const { cell } = renderCell('eta', createCtx({ torrent: createTorrent({ eta: 3600 }) }));

      expect(cell).toHaveTextContent('1h 0m');
      expect(cell.querySelector('div')).toHaveAttribute('title', '1h 0m');
    });

    it('renders ∞ for the infinite sentinel (-1)', () => {
      const { cell } = renderCell('eta', createCtx({ torrent: createTorrent({ eta: -1 }) }));

      expect(cell).toHaveTextContent('∞');
    });

    it('renders ? for the unknown sentinel (-2)', () => {
      const { cell } = renderCell('eta', createCtx({ torrent: createTorrent({ eta: -2 }) }));

      expect(cell).toHaveTextContent('?');
    });

    it('renders ∞ for an eta beyond ten weeks', () => {
      const eta = 11 * 7 * 24 * 60 * 60;
      const { cell } = renderCell('eta', createCtx({ torrent: createTorrent({ eta }) }));

      expect(cell).toHaveTextContent('∞');
    });

    it('appends the idle eta to the tooltip when one is available', () => {
      const torrent = createTorrent({ eta: 3600, etaIdle: 120 });
      const { cell } = renderCell('eta', createCtx({ torrent }));

      expect(cell.querySelector('div')).toHaveAttribute('title', '1h 0m (DT_ETA_IDLE: 2m 0s)');
      expect(cell).toHaveTextContent('1h 0m');
    });

    it('keeps the plain eta as tooltip when no idle eta is reported', () => {
      const torrent = createTorrent({ eta: 3600, etaIdle: -1 });
      const { cell } = renderCell('eta', createCtx({ torrent }));

      expect(cell.querySelector('div')).toHaveAttribute('title', '1h 0m');
    });
  });

  describe('shared (ratio)', () => {
    it.each([
      [0, '0.00'],
      [400, '0.40'],
      [1000, '1.00'],
      [1234, '1.23'],
      [25_000, '25.00'],
    ])('renders shared=%i as %s', (shared, expected) => {
      const { cell } = renderCell('shared', createCtx({ torrent: createTorrent({ shared }) }));

      expect(cell).toHaveTextContent(expected);
    });
  });

  describe('label', () => {
    it('renders a comma separated list of labels as text and tooltip', () => {
      const torrent = createTorrent({ labels: ['movies', 'hd'] });
      const { cell } = renderCell('label', createCtx({ torrent }));

      expect(cell).toHaveTextContent('movies, hd');
      expect(cell.querySelector('div')).toHaveAttribute('title', 'movies, hd');
    });

    it('renders an empty cell when the torrent has no labels', () => {
      const { cell } = renderCell('label', createCtx());

      expect(cell.querySelector('div')?.textContent).toBe('');
    });
  });

  describe('status', () => {
    it('renders the state text with no error icon when there is no error', () => {
      const torrent = createTorrent({ stateText: 'OV_FL_DOWNLOADING' });
      const { cell } = renderCell('status', createCtx({ torrent }));

      expect(cell).toHaveTextContent('OV_FL_DOWNLOADING');
      expect(cell.querySelector('div')).toHaveAttribute('title', 'OV_FL_DOWNLOADING');
      expect(cell.querySelector('.error_icon')).toBeNull();
    });

    it('renders an error icon carrying the error message when the torrent errored', () => {
      const torrent = createTorrent({
        statusCode: 0,
        stateText: 'OV_FL_STOPPED',
        errorCode: 3,
        errorString: 'tracker timeout',
        errorMessage: 'OV_FL_ERROR: tracker timeout',
      });
      const { cell } = renderCell('status', createCtx({ torrent }));

      const icon = screen.getByRole('img', { name: 'OV_FL_ERROR: tracker timeout' });
      expect(icon).toHaveClass('error_icon');
      expect(icon).toHaveAttribute('title', 'OV_FL_ERROR: tracker timeout');
      // The state text stays visible next to the icon.
      expect(cell).toHaveTextContent('OV_FL_STOPPED');
    });
  });

  describe('order', () => {
    it('renders a finite queue position', () => {
      const { cell } = renderCell('order', createCtx({ torrent: createTorrent({ order: 7 }) }));

      expect(cell).toHaveTextContent('7');
    });

    it('renders * for a non finite queue position', () => {
      const torrent = createTorrent({ order: Infinity });
      const { cell } = renderCell('order', createCtx({ torrent }));

      expect(cell).toHaveTextContent('*');
    });
  });

  describe('counters', () => {
    it('renders seeds and peers columns', () => {
      const torrent = createTorrent({ seeds: 8, peers: 10, activeSeeds: 5, activePeers: 3 });

      expect(renderCell('seeds', createCtx({ torrent })).cell).toHaveTextContent('8');
      expect(renderCell('peers', createCtx({ torrent })).cell).toHaveTextContent('10');
    });

    it('renders the combined seeds/peers column as "activeSeeds / activePeers", matching its OV_COL_SEEDS_PEERS label', () => {
      const torrent = createTorrent({ activeSeeds: 5, activePeers: 3 });

      expect(renderCell('seeds_peers', createCtx({ torrent })).cell).toHaveTextContent('5 / 3');
    });

    it('renders blank speed columns when the torrent is idle', () => {
      const { cell } = renderCell('downspd', createCtx());

      expect(cell.querySelector('div')?.textContent).toBe('');
    });
  });

  describe('actions', () => {
    it('fires handleStart and handleStop from the buttons', () => {
      const handleStart = vi.fn();
      const handleStop = vi.fn();
      renderCell('actions', createCtx({ handleStart, handleStop }));

      fireEvent.click(screen.getByRole('button', { name: 'ML_START' }));
      fireEvent.click(screen.getByRole('button', { name: 'ML_STOP' }));

      expect(handleStart).toHaveBeenCalledTimes(1);
      expect(handleStop).toHaveBeenCalledTimes(1);
    });

    it('disables and marks the start button while a start is in flight', () => {
      const handleStart = vi.fn();
      renderCell('actions', createCtx({ handleStart, isStarting: true }));

      const start = screen.getByRole('button', { name: 'ML_START' });
      expect(start).toBeDisabled();
      expect(start).toHaveClass('btn-loading');

      fireEvent.click(start);
      expect(handleStart).not.toHaveBeenCalled();
    });

    it('disables and marks the stop button while a stop is in flight', () => {
      renderCell('actions', createCtx({ isStopping: true }));

      const stop = screen.getByRole('button', { name: 'ML_STOP' });
      expect(stop).toBeDisabled();
      expect(stop).toHaveClass('btn-loading');
      expect(screen.getByRole('button', { name: 'ML_START' })).not.toBeDisabled();
    });
  });
});
