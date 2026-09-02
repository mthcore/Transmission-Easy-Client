import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({
  createDialog: vi.fn(),
  createFileList: vi.fn(),
  torrentList: {
    selectedIds: [] as number[],
    resetSelectedIds: vi.fn(),
    addSelectedId: vi.fn(),
  },
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import TorrentContextMenu from '../TorrentContextMenu';

/**
 * This menu is where a click becomes a destructive action, and it sat at ~2%
 * covered. The property that matters most is not which RPC runs — it is that
 * removal NEVER runs one: both remove entries have to raise the confirm dialog,
 * carrying the right deleteData flag. A wrong flag here deletes a user's files
 * with a dialog that said it would not.
 *
 * The rest is gating. Entries are shown from each torrent's own `actions` list
 * and from the daemon's feature flags, so an entry offered against a daemon
 * that cannot serve it is an action that fails after the user commits to it.
 */

afterEach(cleanup);

const FEATURES = { labels: true, groups: true, sequentialDownload: true };

function torrent(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ubuntu.iso',
    magnetLink: 'magnet:?xt=urn:btih:abc',
    hash: 'abc',
    directory: '/downloads',
    labelsStr: '',
    actions: ['start', 'stop', 'recheck'],
    sequentialDownload: false,
    ...overrides,
  };
}

function makeClient(torrents: Record<number, ReturnType<typeof torrent>>, features = FEATURES) {
  return {
    settings: { features },
    torrents: new Map<number, unknown>(Object.entries(torrents).map(([id, t]) => [Number(id), t])),
    torrentsStart: vi.fn().mockResolvedValue(undefined),
    torrentsForceStart: vi.fn().mockResolvedValue(undefined),
    torrentsStop: vi.fn().mockResolvedValue(undefined),
    torrentsRecheck: vi.fn().mockResolvedValue(undefined),
    reannounce: vi.fn().mockResolvedValue(undefined),
    torrentsQueueTop: vi.fn().mockResolvedValue(undefined),
    torrentsQueueUp: vi.fn().mockResolvedValue(undefined),
    torrentsQueueDown: vi.fn().mockResolvedValue(undefined),
    torrentsQueueBottom: vi.fn().mockResolvedValue(undefined),
    setTorrentGroup: vi.fn().mockResolvedValue(undefined),
    setSequentialDownload: vi.fn().mockResolvedValue(undefined),
    getGroups: vi.fn().mockResolvedValue([{ name: 'seedbox' }, { name: 'slow' }]),
  };
}

let client: ReturnType<typeof makeClient>;

beforeEach(() => {
  showError.mockClear();
  store.createDialog.mockClear();
  store.createFileList.mockClear();
  client = makeClient({ 1: torrent() });
  store.client = client;
  store.torrentList.selectedIds = [1];
});

function open() {
  render(
    <TorrentContextMenu torrentId={1}>
      <span data-testid="row">row</span>
    </TorrentContextMenu>
  );
  fireEvent.contextMenu(screen.getByTestId('row'));
}

/**
 * Open a submenu by its trigger label and return every item now on screen.
 * The trigger's text is split across two elements (label plus arrow), so it is
 * matched on the element rather than on an exact string.
 */
function openSub(label: string) {
  const trigger = screen
    .getAllByRole('menuitem')
    .find((item) => item.textContent?.startsWith(label));
  if (!trigger) throw new Error(`No submenu trigger starting with "${label}"`);
  fireEvent.click(trigger);
  fireEvent.pointerDown(trigger);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
}

const entries = () => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

describe('TorrentContextMenu — removal is always confirmed', () => {
  it('raises the confirm dialog rather than calling the daemon', () => {
    open();
    fireEvent.click(screen.getByText('ML_REMOVE'));

    expect(store.createDialog).toHaveBeenCalledWith({
      type: 'removeConfirm',
      torrentIds: [1],
    });
  });

  it('asks to delete the torrent only, with deleteData false', () => {
    open();
    openSub('ML_REMOVE_AND');
    fireEvent.click(screen.getByText('ML_DELETE_TORRENT'));

    expect(store.createDialog).toHaveBeenCalledWith({
      type: 'removeConfirm',
      torrentIds: [1],
      deleteData: false,
    });
  });

  it('asks to delete the data too, with deleteData true', () => {
    // The one entry that destroys files. If this flag were ever false the
    // dialog would promise one thing and the daemon would do another.
    open();
    openSub('ML_REMOVE_AND');
    fireEvent.click(screen.getByText('ML_DELETE_DATATORRENT'));

    expect(store.createDialog).toHaveBeenCalledWith({
      type: 'removeConfirm',
      torrentIds: [1],
      deleteData: true,
    });
  });

  it('carries the whole selection, as a copy', () => {
    // slice(0): the dialog must not hold the live selection, which the next
    // click would change under it.
    store.torrentList.selectedIds = [1, 2, 3];
    client.torrents.set(2, torrent());
    client.torrents.set(3, torrent());
    open();
    fireEvent.click(screen.getByText('ML_REMOVE'));

    const passed = store.createDialog.mock.calls[0][0].torrentIds;
    expect(passed).toEqual([1, 2, 3]);
    expect(passed).not.toBe(store.torrentList.selectedIds);
  });
});

describe('TorrentContextMenu — which entries are offered', () => {
  it('offers only the actions the torrent reports', () => {
    client.torrents.set(1, torrent({ actions: ['start'] }));
    open();

    expect(entries()).toContain('ML_START');
    expect(entries()).not.toContain('ML_STOP');
  });

  it('unions the actions across a mixed selection', () => {
    // A running and a stopped torrent selected together must offer both, or
    // one of the two becomes unactionable.
    store.torrentList.selectedIds = [1, 2];
    client.torrents.set(1, torrent({ actions: ['start'] }));
    client.torrents.set(2, torrent({ actions: ['stop'] }));
    open();

    expect(entries()).toContain('ML_START');
    expect(entries()).toContain('ML_STOP');
  });

  it('hides labels on a daemon older than 3.0', () => {
    // The dialog could open, but every Apply was rejected by the bg backstop.
    client = makeClient({ 1: torrent() }, { ...FEATURES, labels: false });
    store.client = client;
    open();

    expect(openSub('extra')).not.toContain('OV_COL_LABEL');
  });

  it('hides bandwidth groups on a daemon older than 4.0', () => {
    client = makeClient({ 1: torrent() }, { ...FEATURES, groups: false });
    store.client = client;
    open();

    expect(openSub('extra').join(' ')).not.toContain('bandwidthGroup');
  });

  it('offers the single-torrent entries only for a single selection', () => {
    // Renaming or copying a name is meaningless for several torrents at once.
    store.torrentList.selectedIds = [1, 2];
    client.torrents.set(2, torrent());
    open();

    expect(openSub('extra')).not.toContain('rename');
  });

  it('hides copy-hash for a torrent the daemon reported no hash for', () => {
    client.torrents.set(1, torrent({ hash: undefined }));
    open();

    expect(openSub('extra')).not.toContain('copyHash');
  });
});

describe('TorrentContextMenu — the magnet link', () => {
  it('passes the daemon magnet link through', () => {
    open();
    openSub('extra');
    fireEvent.click(screen.getByText('magnetUri'));

    expect(store.createDialog).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copyMagnetUrl', magnetLink: 'magnet:?xt=urn:btih:abc' })
    );
  });

  it('rebuilds one from the hash when the daemon reports none', () => {
    // magnetLink is optional on old daemons; passing undefined to the dialog
    // threw an MST typecheck error inside the handler and the menu did nothing.
    client.torrents.set(1, torrent({ magnetLink: '', hash: 'deadbeef' }));
    open();
    openSub('extra');
    fireEvent.click(screen.getByText('magnetUri'));

    expect(store.createDialog).toHaveBeenCalledWith(
      expect.objectContaining({ magnetLink: 'magnet:?xt=urn:btih:deadbeef' })
    );
  });

  it('opens no dialog at all when there is neither link nor hash', () => {
    // Better nothing than a dialog offering an empty URI to copy.
    client.torrents.set(1, torrent({ magnetLink: '', hash: undefined }));
    open();
    openSub('extra');
    fireEvent.click(screen.getByText('magnetUri'));

    expect(store.createDialog).not.toHaveBeenCalled();
  });
});

describe('TorrentContextMenu — the bandwidth group submenu', () => {
  it('does not fetch the groups until the submenu is opened', () => {
    // group-get is its own RPC; fetching it on every menu open would cost one
    // round trip per right click.
    open();
    openSub('extra');

    expect(client.getGroups).not.toHaveBeenCalled();
  });

  it('fetches them once the submenu opens', async () => {
    open();
    openSub('extra');
    fireEvent.click(screen.getByText(/bandwidthGroup/));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getGroups).toHaveBeenCalledTimes(1);
    expect(screen.getByText('seedbox')).toBeInTheDocument();
  });

  it('detaches the torrent with an empty group name', () => {
    // That is how the daemon removes a torrent from whichever group it is in,
    // so the entry has to be offered before the list has even loaded.
    open();
    openSub('extra');
    fireEvent.click(screen.getByText(/bandwidthGroup/));
    fireEvent.click(screen.getByText('noBandwidthGroup'));

    expect(client.setTorrentGroup).toHaveBeenCalledWith([1], '');
  });

  it('says so when the group list cannot be fetched', async () => {
    client.getGroups.mockRejectedValueOnce(new Error('daemon said 500'));
    open();
    openSub('extra');
    fireEvent.click(screen.getByText(/bandwidthGroup/));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('unexpectedError')).toBeInTheDocument();
  });
});

describe('TorrentContextMenu — when there is nothing to act on', () => {
  it('renders no menu without a selection', () => {
    store.torrentList.selectedIds = [];
    open();

    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });

  it('renders no menu before the client exists', () => {
    store.client = undefined;
    open();

    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });
});

describe('TorrentContextMenu — when the daemon refuses', () => {
  it('reports a failed action instead of closing silently', async () => {
    client.torrentsStart.mockRejectedValueOnce(new Error('daemon said 409'));
    open();
    fireEvent.click(screen.getByText('ML_START'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
