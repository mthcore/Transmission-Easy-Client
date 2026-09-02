import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TorrentDetailsInfoTab from '../tabs/TorrentDetailsInfoTab';

/**
 * The info tab is mostly labels, but three of its figures are computed and each
 * has been wrong in a way that reads as fact rather than as a gap.
 *
 * The ratio divides uploaded by downloaded, and a torrent added for data
 * already on disk has downloaded nothing at all.
 *
 * The swarm size cannot come from the list: the list only carries seeds and
 * peers while those columns are shown, because trackerStats is far too heavy to
 * poll otherwise — so with the default column set this dialog rendered "N / 0".
 * The details request always asks for trackerStats, which makes it the reliable
 * source, and every tracker scrapes the SAME swarm, so the figure is the
 * maximum rather than the sum.
 *
 * Durations and dates are omitted entirely rather than shown as "never": a zero
 * timestamp rendered as 1970, and a zero duration as "0m", both look like real
 * answers. The row is gated on the value, so formatDuration's own dash branch
 * is unreachable from here — the cases below say so rather than pretend to pin
 * it.
 */

afterEach(cleanup);

function torrent(overrides: Record<string, unknown> = {}) {
  return {
    sizeStr: '1 GB',
    sizeWhenDoneStr: '900 MB',
    progressStr: '50%',
    downloadedStr: '500 MB',
    uploadedStr: '250 MB',
    downloaded: 1000,
    uploaded: 500,
    activeSeeds: 1,
    seeds: 4,
    activePeers: 2,
    peers: 8,
    downloadSpeedStr: '1 MB/s',
    uploadSpeedStr: '0 B/s',
    etaStr: '10m',
    etaIdleStr: '',
    stateText: 'Downloading',
    addedTimeStr: '2026-01-01',
    completedTimeStr: '',
    activityDateStr: '',
    startDateStr: '',
    directory: '/downloads',
    hash: 'abc',
    peersConnected: 3,
    isPrivate: false,
    size: 1_000_000,
    sizeWhenDone: 1_000_000,
    ...overrides,
  };
}

function draw(props: Record<string, unknown> = {}) {
  return render(
    <TorrentDetailsInfoTab
      torrent={torrent() as never}
      details={null}
      detailsLoading={false}
      peers={[]}
      peersLoading={false}
      peerWidths={{ ip: 100, client: 90, pct: 38, dl: 70, ul: 70, flags: 55 }}
      getPeerResizeProps={() => ({ onMouseDown: vi.fn(), onClick: vi.fn() })}
      {...props}
    />
  );
}

/** The value rendered beside a given label. */
function valueFor(label: string): string {
  const row = screen.getAllByText(label)[0].closest('.nf-subItem');
  return row?.querySelector('span')?.textContent ?? '';
}

function tracker(seederCount: number, leecherCount: number, id = 1) {
  return { id, announce: 'https://t/announce', tier: 0, seederCount, leecherCount };
}

/** Every field the tab walks, so a missing one is never the reason a case fails. */
function detailsOf(overrides: Record<string, unknown> = {}) {
  return {
    trackerStats: [],
    webseeds: [],
    peersFrom: null,
    comment: '',
    creator: '',
    dateCreated: 0,
    corruptEver: 0,
    pieceCount: 100,
    pieceSize: 262144,
    secondsDownloading: 0,
    secondsSeeding: 0,
    downloadLimit: 0,
    downloadLimited: false,
    uploadLimit: 0,
    uploadLimited: false,
    honorsSessionLimits: true,
    fileCount: 1,
    primaryMimeType: 'video/x-matroska',
    ...overrides,
  } as never;
}

describe('TorrentDetailsInfoTab — the ratio', () => {
  it('divides what was uploaded by what was downloaded', () => {
    draw({ torrent: torrent({ downloaded: 1000, uploaded: 500 }) as never });

    expect(valueFor('OV_COL_SHARED')).toContain('0.500');
  });

  it('shows infinity for a torrent that uploaded without downloading', () => {
    // Added for data already on disk: dividing by zero is not the answer.
    draw({ torrent: torrent({ downloaded: 0, uploaded: 500 }) as never });

    expect(valueFor('OV_COL_SHARED')).toContain('∞');
  });

  it('shows zero when nothing has moved either way', () => {
    // NaN is what a bare division gives here, and it renders as "NaN".
    draw({ torrent: torrent({ downloaded: 0, uploaded: 0 }) as never });

    expect(valueFor('OV_COL_SHARED')).toContain('0.000');
  });
});

describe('TorrentDetailsInfoTab — the swarm', () => {
  it('takes the swarm from the trackers, not from the list', () => {
    // The list carries these only while its Seeds/Peers columns are shown, so
    // with the default columns this dialog showed "N / 0".
    draw({
      torrent: torrent({ seeds: 0, peers: 0 }) as never,
      details: detailsOf({ trackerStats: [tracker(50, 20)] }),
    });

    expect(valueFor('OV_COL_SEEDS')).toContain('50');
    expect(valueFor('OV_COL_PEERS')).toContain('20');
  });

  it('takes the maximum across trackers, not the sum', () => {
    // Every tracker scrapes the SAME swarm; adding them multiplies it.
    draw({
      details: detailsOf({ trackerStats: [tracker(50, 20), tracker(30, 25, 2)] }),
    });

    expect(valueFor('OV_COL_SEEDS')).toContain('50');
    expect(valueFor('OV_COL_PEERS')).toContain('25');
  });

  it('falls back to the list when the torrent has no trackers', () => {
    draw({ details: detailsOf() });

    expect(valueFor('OV_COL_SEEDS')).toContain('4');
    expect(valueFor('OV_COL_PEERS')).toContain('8');
  });

  it('falls back to the list before the details have arrived', () => {
    draw({ details: null });

    expect(valueFor('OV_COL_SEEDS')).toContain('4');
  });
});

describe('TorrentDetailsInfoTab — the size', () => {
  it('mentions the effective size only when it differs', () => {
    // Deselecting files makes the two differ; showing both otherwise is noise.
    draw({ torrent: torrent({ size: 1000, sizeWhenDone: 900 }) as never });

    expect(valueFor('OV_COL_SIZE')).toContain('900 MB');
  });

  it('says nothing extra when the whole torrent is wanted', () => {
    draw({ torrent: torrent({ size: 1000, sizeWhenDone: 1000 }) as never });

    expect(valueFor('OV_COL_SIZE')).not.toContain('900 MB');
  });

  it('says nothing extra when the daemon reported no effective size', () => {
    draw({ torrent: torrent({ size: 1000, sizeWhenDone: 0 }) as never });

    expect(valueFor('OV_COL_SIZE')).not.toContain('900 MB');
  });
});

describe('TorrentDetailsInfoTab — durations and dates', () => {
  it('composes days, hours and minutes', () => {
    // Units come from the locale, so these durations read like the ETA rather
    // than hardcoding English.
    draw({ details: detailsOf({ secondsDownloading: 90_061 }) });

    expect(document.body.textContent).toMatch(/1d 1h 1m/);
  });

  it('says less than a minute rather than dropping the row to nothing', () => {
    draw({ details: detailsOf({ secondsDownloading: 30 }) });

    expect(document.body.textContent).toContain('< 1m');
  });

  it('omits the row entirely for a duration that never happened', () => {
    // The row is gated on the value, so formatDuration's own "-" branch never
    // runs from here. What must not appear is a row reading "0m".
    draw({ details: detailsOf({ secondsDownloading: 0, secondsSeeding: 0 }) });

    expect(screen.queryByText('DT_TIME_DOWNLOADING')).not.toBeInTheDocument();
    expect(screen.queryByText('DT_TIME_SEEDING')).not.toBeInTheDocument();
  });

  it('shows the row once there is a duration to show', () => {
    draw({ details: detailsOf({ secondsSeeding: 3600 }) });

    expect(screen.getByText('DT_TIME_SEEDING')).toBeInTheDocument();
  });

  it('omits a creation date the daemon reports as zero', () => {
    // Rendered as a date, a zero timestamp reads as 1 January 1970.
    draw({ details: detailsOf({ dateCreated: 0 }) });

    expect(document.body.textContent).not.toContain('1970');
  });

  it('shows a real creation date', () => {
    draw({ details: detailsOf({ dateCreated: 1_700_000_000 }) });

    expect(document.body.textContent).toContain(
      new Date(1_700_000_000 * 1000).toLocaleDateString()
    );
  });
});
