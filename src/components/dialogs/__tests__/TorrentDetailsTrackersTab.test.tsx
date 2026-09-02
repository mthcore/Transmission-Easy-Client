import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TorrentDetailsTrackersTab from '../tabs/TorrentDetailsTrackersTab';

/**
 * The tracker table shows numbers the daemon reports as -1 when it does not
 * know them — a tracker never announced to, or one that answered nothing. Shown
 * raw, "-1 seeds" reads as a real figure and a broken tracker looks populated.
 *
 * Announce URLs come from the torrent file, so they are not guaranteed to parse.
 * The column shows the hostname because a full announce URL is far too wide,
 * and a URL that cannot be parsed has to fall back to its own text rather than
 * take the row down.
 *
 * Editing the list needs Transmission 4.0: below that the daemon rejects it, so
 * the table stays and the editor does not appear at all.
 */

afterEach(cleanup);

function tracker(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    announce: 'https://tracker.example.org:443/announce',
    tier: 0,
    seederCount: 12,
    leecherCount: 3,
    lastAnnounceResult: 'Success',
    isBackup: false,
    ...overrides,
  };
}

function draw(props: Record<string, unknown> = {}) {
  const onApplyTrackers = vi.fn();
  const onTrackerListChange = vi.fn();
  const result = render(
    <TorrentDetailsTrackersTab
      details={{ trackerStats: [tracker()], trackerList: '' } as never}
      detailsLoading={false}
      trackerListText="https://tracker.example.org/announce"
      onTrackerListChange={onTrackerListChange}
      onApplyTrackers={onApplyTrackers}
      trackerSaving={false}
      trackerWidths={{ url: 160, tier: 40, seeds: 50, peers: 50, status: 80 }}
      getTrackerResizeProps={() => ({ onMouseDown: vi.fn(), onClick: vi.fn() })}
      canEditTrackers
      {...props}
    />
  );
  return { ...result, onApplyTrackers, onTrackerListChange };
}

const cells = () => Array.from(document.querySelectorAll('tbody td')).map((c) => c.textContent);
const editor = () => document.querySelector('textarea');

describe('TorrentDetailsTrackersTab — the table', () => {
  it('shows the hostname rather than the whole announce URL', () => {
    // A full announce URL does not fit the column at any usable width.
    draw();

    expect(cells()[0]).toBe('tracker.example.org');
  });

  it('keeps the whole URL in the tooltip', () => {
    draw();

    expect(document.querySelector('tbody td')?.getAttribute('title')).toBe(
      'https://tracker.example.org:443/announce'
    );
  });

  it('falls back to the raw text for an announce URL that will not parse', () => {
    // These come from the torrent file; one bad entry must not take the row
    // (and with it the whole tab) down.
    draw({ details: { trackerStats: [tracker({ announce: 'not a url at all' })] } });

    expect(cells()[0]).toBe('not a url at all');
  });

  it('shows a dash where the daemon reports an unknown count', () => {
    // -1 means "not known yet". Printed raw it reads as a real figure.
    draw({ details: { trackerStats: [tracker({ seederCount: -1, leecherCount: -1 })] } });

    expect(cells()[2]).toBe('-');
    expect(cells()[3]).toBe('-');
  });

  it('shows a genuine zero as zero, not as unknown', () => {
    // A tracker that answered with no peers is different from one that has not
    // answered, and the difference is the whole point of the dash.
    draw({ details: { trackerStats: [tracker({ seederCount: 0, leecherCount: 0 })] } });

    expect(cells()[2]).toBe('0');
    expect(cells()[3]).toBe('0');
  });

  it('shows a dash when the tracker has said nothing yet', () => {
    draw({ details: { trackerStats: [tracker({ lastAnnounceResult: '' })] } });

    expect(cells()[4]).toBe('-');
  });

  it('marks a backup tracker, which is not being announced to', () => {
    draw({ details: { trackerStats: [tracker({ isBackup: true })] } });

    expect(document.querySelector('tbody tr')?.className).toContain('tracker-backup');
  });

  it('lists every tracker the torrent has', () => {
    draw({
      details: {
        trackerStats: [tracker(), tracker({ id: 2, announce: 'udp://other.example:80' })],
      },
    });

    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('shows no table for a torrent with no trackers', () => {
    draw({ details: { trackerStats: [] } });

    expect(document.querySelector('table')).toBeNull();
  });

  it('says it is loading only while there is nothing to show', () => {
    draw({ details: null, detailsLoading: true });
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    cleanup();
    draw({ detailsLoading: true });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});

describe('TorrentDetailsTrackersTab — editing the list', () => {
  it('offers the editor on a daemon that accepts one', () => {
    draw();

    expect(editor()).not.toBeNull();
  });

  it('hides it on a daemon older than 4.0, leaving the table readable', () => {
    // The daemon rejects the edit, so offering it would let the user type a
    // list and then be told no.
    draw({ canEditTrackers: false });

    expect(editor()).toBeNull();
    expect(document.querySelector('table')).not.toBeNull();
  });

  it('hides it before the details have arrived', () => {
    draw({ details: null });

    expect(editor()).toBeNull();
  });

  it('reports what is typed rather than keeping its own copy', () => {
    const { onTrackerListChange } = draw();
    fireEvent.change(editor()!, { target: { value: 'udp://a\n\nudp://b' } });

    expect(onTrackerListChange).toHaveBeenCalledWith('udp://a\n\nudp://b');
  });

  it('applies on the button, not on every keystroke', () => {
    const { onApplyTrackers, onTrackerListChange } = draw();
    fireEvent.change(editor()!, { target: { value: 'udp://a' } });
    expect(onApplyTrackers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('DT_APPLY'));
    expect(onApplyTrackers).toHaveBeenCalledTimes(1);
    expect(onTrackerListChange).toHaveBeenCalled();
  });

  it('disables the button while a save is in flight', () => {
    draw({ trackerSaving: true });

    expect(screen.getByText('DT_APPLY')).toBeDisabled();
  });
});
