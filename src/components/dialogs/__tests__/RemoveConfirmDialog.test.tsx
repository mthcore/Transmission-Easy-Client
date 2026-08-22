import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RemoveConfirmDialog from '../RemoveConfirmDialog';
import RootStoreCtx from '../../../tools/rootStoreCtx';

/**
 * The confirm dialog for a destructive action: the safe button must own the
 * focus, and the two "remove" variants must reach the right RPC. Nothing
 * covered this before, which is how a fix that focused "Yes" could ship.
 */

const torrentsRemoveTorrent = vi.fn().mockResolvedValue(undefined);
const torrentsRemoveTorrentFiles = vi.fn().mockResolvedValue(undefined);

const rootStore = {
  client: {
    torrentsRemoveTorrent,
    torrentsRemoveTorrentFiles,
    torrents: new Map(),
  },
  config: {},
  destroyDialog: vi.fn(),
};

function makeDialogStore(deleteData: boolean) {
  return {
    id: 'dialog_1',
    type: 'removeConfirm' as const,
    deleteData,
    torrentIds: [7, 9],
    close: vi.fn(),
  };
}

function renderDialog(deleteData = false) {
  const dialogStore = makeDialogStore(deleteData);
  render(
    <RootStoreCtx.Provider value={rootStore as never}>
      <RemoveConfirmDialog dialogStore={dialogStore as never} />
    </RootStoreCtx.Provider>
  );
  return dialogStore;
}

describe('RemoveConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('focuses the safe "No" button, not the destructive submit', () => {
    renderDialog();
    const no = screen.getByDisplayValue('DLG_BTN_NO');
    const yes = screen.getByDisplayValue('DLG_BTN_YES');

    // The focus trap runs after the child's commit, so it must not steal
    // focus back to the first focusable element (the "Yes" submit)
    expect(document.activeElement).toBe(no);
    expect(document.activeElement).not.toBe(yes);
  });

  it('removes the torrents without touching their data by default', () => {
    const dialogStore = renderDialog(false);
    fireEvent.submit(screen.getByDisplayValue('DLG_BTN_YES').closest('form')!);

    expect(torrentsRemoveTorrent).toHaveBeenCalledWith([7, 9]);
    expect(torrentsRemoveTorrentFiles).not.toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('deletes local data only when the dialog was opened for it', () => {
    renderDialog(true);
    fireEvent.submit(screen.getByDisplayValue('DLG_BTN_YES').closest('form')!);

    expect(torrentsRemoveTorrentFiles).toHaveBeenCalledWith([7, 9]);
    expect(torrentsRemoveTorrent).not.toHaveBeenCalled();
  });

  it('closes without removing anything when "No" is clicked', () => {
    const dialogStore = renderDialog(true);
    fireEvent.click(screen.getByDisplayValue('DLG_BTN_NO'));

    expect(torrentsRemoveTorrent).not.toHaveBeenCalled();
    expect(torrentsRemoveTorrentFiles).not.toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('addresses torrents by hash captured at open, surviving a daemon restart', () => {
    // Numeric ids are session-scoped: if the daemon restarts while the
    // confirmation is open, id 7 can suddenly be a DIFFERENT torrent — and
    // delete-with-data would destroy its files. The dialog must capture the
    // hashes when it OPENS and send those.
    rootStore.client.torrents.set(7, { hashString: 'aaa111' } as never);
    rootStore.client.torrents.set(9, { hashString: 'bbb222' } as never);
    renderDialog(true);

    // Daemon restart: the same ids now point at other torrents
    rootStore.client.torrents.set(7, { hashString: 'EVIL77' } as never);
    rootStore.client.torrents.set(9, { hashString: 'EVIL99' } as never);

    fireEvent.submit(screen.getByDisplayValue('DLG_BTN_YES').closest('form')!);
    expect(torrentsRemoveTorrentFiles).toHaveBeenCalledWith(['aaa111', 'bbb222']);

    rootStore.client.torrents.clear();
  });
});
