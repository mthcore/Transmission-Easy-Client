import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import TorrentDetailsDialog from '../TorrentDetailsDialog';
import RootStoreCtx from '../../../tools/rootStoreCtx';

/**
 * The tab itself is covered in isolation. What this pins is the wiring the tab
 * cannot see: that the fields are seeded from the torrent's OWN limits rather
 * than from defaults, and that Apply sends all six together in one request.
 *
 * Seeding is the part that silently misbehaves — a tab that opens on zeros and
 * is then applied would wipe a torrent's limits without the user typing
 * anything.
 */

afterEach(cleanup);

const DETAILS = {
  // The info tab renders first, so the fixture carries the fields it walks
  webseeds: [],
  labels: [],
  trackerList: '',
  trackerStats: [],
  seedRatioMode: 0,
  seedRatioLimit: 0,
  seedIdleMode: 0,
  seedIdleLimit: 0,
  peersFrom: null,
  honorsSessionLimits: false,
  downloadLimited: true,
  downloadLimit: 750,
  uploadLimited: false,
  uploadLimit: 90,
  peerLimit: 45,
};

const TORRENT = {
  id: 7,
  name: 'ubuntu.iso',
  sizeStr: '1 GB',
  sizeWhenDoneStr: '1 GB',
  progressStr: '50%',
  downloadedStr: '500 MB',
  uploadedStr: '0 B',
  downloaded: 500,
  uploaded: 0,
  activeSeeds: 1,
  seeds: 2,
  activePeers: 1,
  peers: 2,
  downloadSpeedStr: '0 B/s',
  uploadSpeedStr: '0 B/s',
  etaStr: '',
  etaIdleStr: '',
  stateText: 'Downloading',
  addedTimeStr: '',
  completedTimeStr: '',
  activityDateStr: '',
  startDateStr: '',
  size: 1,
};

async function openBandwidthTab() {
  const setTorrentLimits = vi.fn().mockResolvedValue(undefined);
  const rootStore = {
    client: {
      settings: { features: { trackerList: true } },
      getPeers: vi.fn().mockResolvedValue([]),
      getTorrentDetails: vi.fn().mockResolvedValue(DETAILS),
      setTrackerList: vi.fn().mockResolvedValue(undefined),
      setSeedLimits: vi.fn().mockResolvedValue(undefined),
      setTorrentLimits,
    },
    config: {
      detailPeerWidths: {},
      detailTrackerWidths: {},
      setDetailPeerWidths: vi.fn(),
      setDetailTrackerWidths: vi.fn(),
    },
  };

  await act(async () => {
    render(
      <RootStoreCtx.Provider value={rootStore as never}>
        <TorrentDetailsDialog dialogStore={{ close: vi.fn(), torrent: TORRENT } as never} />
      </RootStoreCtx.Provider>
    );
  });

  await act(async () => {
    fireEvent.click(screen.getByText('DT_TAB_BANDWIDTH'));
  });

  return { setTorrentLimits };
}

const numberFields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));

const applyButton = () =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'DT_APPLY')!;

describe('TorrentDetailsDialog — the bandwidth tab', () => {
  it('seeds the fields from the torrent, not from defaults', async () => {
    await openBandwidthTab();

    expect(numberFields().map((input) => input.value)).toEqual(['750', '90', '45']);
    const [honors, download, upload] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    );
    expect(honors.checked).toBe(false);
    expect(download.checked).toBe(true);
    expect(upload.checked).toBe(false);
  });

  it('applies every field together, edited or not', async () => {
    const { setTorrentLimits } = await openBandwidthTab();

    fireEvent.change(numberFields()[1], { target: { value: '200' } });
    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(setTorrentLimits).toHaveBeenCalledTimes(1);
    expect(setTorrentLimits).toHaveBeenCalledWith([7], {
      honorsSessionLimits: false,
      downloadLimited: true,
      downloadLimit: 750,
      uploadLimited: false,
      uploadLimit: 200,
      peerLimit: 45,
    });
  });

  it('sends a toggle even when no value was touched', async () => {
    const { setTorrentLimits } = await openBandwidthTab();

    fireEvent.click(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]);
    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(setTorrentLimits).toHaveBeenCalledWith(
      [7],
      expect.objectContaining({ honorsSessionLimits: true, downloadLimit: 750 })
    );
  });
});

describe('TorrentDetailsDialog — after a daemon restart while open', () => {
  /**
   * Numeric ids are session scoped. When id 7 comes back as another torrent,
   * the dialog used to show that one while its forms still held the first
   * one's limits — and Apply wrote them onto the wrong torrent.
   */
  function renderWith(torrent: object, close: () => void, rootStore: object) {
    return (
      <RootStoreCtx.Provider value={rootStore as never}>
        <TorrentDetailsDialog dialogStore={{ close, torrent } as never} />
      </RootStoreCtx.Provider>
    );
  }

  function makeRootStore() {
    return {
      client: {
        settings: { features: { trackerList: true } },
        getPeers: vi.fn().mockResolvedValue([]),
        getTorrentDetails: vi.fn().mockResolvedValue(DETAILS),
        setTrackerList: vi.fn().mockResolvedValue(undefined),
        setSeedLimits: vi.fn().mockResolvedValue(undefined),
        setTorrentLimits: vi.fn().mockResolvedValue(undefined),
      },
      config: {
        detailPeerWidths: {},
        detailTrackerWidths: {},
        setDetailPeerWidths: vi.fn(),
        setDetailTrackerWidths: vi.fn(),
      },
    };
  }

  it('addresses writes by the hash captured at open', async () => {
    const rootStore = makeRootStore();
    await act(async () => {
      render(renderWith({ ...TORRENT, hashString: 'aaa7' }, vi.fn(), rootStore));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('DT_TAB_BANDWIDTH'));
    });
    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(rootStore.client.setTorrentLimits).toHaveBeenCalledWith(['aaa7'], expect.any(Object));
  });

  it('closes when its id now belongs to a different torrent', async () => {
    const rootStore = makeRootStore();
    const close = vi.fn();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(renderWith({ ...TORRENT, hashString: 'aaa7' }, close, rootStore));
    });
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(renderWith({ ...TORRENT, hashString: 'OTHER' }, close, rootStore));
    });

    expect(close).toHaveBeenCalled();
  });
});
