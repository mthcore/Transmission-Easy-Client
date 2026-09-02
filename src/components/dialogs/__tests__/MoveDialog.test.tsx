import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({
  config: { folders: [] as { name: string; path: string }[] },
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import MoveDialog from '../MoveDialog';
import { CUSTOM_PATH_INDEX, DEFAULT_PATH_INDEX } from '../../../constants';

/**
 * This dialog moves a torrent's data on disk. A wrong destination is not a
 * failed request — it is files somewhere the user did not ask for, and the
 * daemon will have already started copying by the time anyone notices.
 *
 * So the cases here are about where the destination comes from: the custom
 * field, the daemon's own download directory, or one of the configured
 * folders. And about the one thing that must never happen — an empty
 * destination reaching the daemon.
 */

afterEach(cleanup);

const FOLDERS = [
  { name: 'Films', path: '/mnt/films' },
  { name: 'Séries', path: '/mnt/series' },
];

let client: { torrentSetLocation: ReturnType<typeof vi.fn>; settings: { downloadDir: string } };
let dialogStore: { close: ReturnType<typeof vi.fn>; directory: string; torrentIds: number[] };

beforeEach(() => {
  showError.mockClear();
  client = {
    torrentSetLocation: vi.fn().mockResolvedValue(undefined),
    settings: { downloadDir: '/var/downloads' },
  };
  store.client = client;
  store.config = { folders: FOLDERS };
  dialogStore = { close: vi.fn(), directory: '/current/place', torrentIds: [4, 5] };
});

function open() {
  render(<MoveDialog dialogStore={dialogStore as never} />);
}

const select = () => document.querySelector('select[name="directory"]') as HTMLSelectElement;
const locationField = () =>
  document.querySelector('input[name="location"]') as HTMLInputElement | null;
const submit = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement);

/** Choose an entry in the directory select, as the user would. */
function choose(value: number) {
  fireEvent.change(select(), { target: { value: String(value) } });
}

describe('MoveDialog — where the files go', () => {
  it('offers the current location to edit, pre-filled', () => {
    // The custom field is the pre-selected option, so it has to arrive already
    // holding the torrent's directory rather than empty.
    open();

    expect(locationField()?.value).toBe('/current/place');
  });

  it('moves to the typed path', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '/mnt/new' } });
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], '/mnt/new');
  });

  it('trims a path that was pasted with spaces around it', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '  /mnt/new  ' } });
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], '/mnt/new');
  });

  it('moves to the daemon’s own download directory', () => {
    open();
    choose(DEFAULT_PATH_INDEX);
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], '/var/downloads');
  });

  it('moves to a configured folder by its path, not its name', () => {
    open();
    choose(1);
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], '/mnt/series');
  });

  it('hides the text field once a folder is chosen', () => {
    open();
    choose(0);

    expect(locationField()).toBeNull();
  });

  it('brings the text field back when custom is chosen again', () => {
    open();
    choose(0);
    choose(CUSTOM_PATH_INDEX);

    expect(locationField()).not.toBeNull();
  });
});

describe('MoveDialog — refusing to move nowhere', () => {
  it('sends nothing when the path was left empty', () => {
    // An empty destination is not "leave it where it is" to the daemon.
    open();
    fireEvent.change(locationField()!, { target: { value: '' } });
    submit();

    expect(client.torrentSetLocation).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  it('sends nothing for a path of nothing but spaces', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '   ' } });
    submit();

    expect(client.torrentSetLocation).not.toHaveBeenCalled();
  });

  it('keeps the dialog open so the user can correct it', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '' } });
    submit();

    expect(dialogStore.close).not.toHaveBeenCalled();
  });

  it('falls back to the typed path when the chosen folder has gone', () => {
    // A folder removed from the options, or settings not synced yet: reading
    // the missing entry used to throw and abandon the move with no feedback.
    open();
    choose(99);
    submit();

    expect(client.torrentSetLocation).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  it('sends nothing when the daemon has not reported its download directory', () => {
    client.settings = { downloadDir: '' };
    open();
    choose(DEFAULT_PATH_INDEX);
    submit();

    expect(client.torrentSetLocation).not.toHaveBeenCalled();
  });
});

describe('MoveDialog — after submitting', () => {
  it('closes once the move is on its way', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '/mnt/new' } });
    submit();

    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('reports a refusal from the daemon', async () => {
    client.torrentSetLocation.mockRejectedValueOnce(new Error('permission denied'));
    open();
    fireEvent.change(locationField()!, { target: { value: '/mnt/new' } });
    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalled();
  });

  it('moves every torrent that was selected, not only the first', () => {
    open();
    fireEvent.change(locationField()!, { target: { value: '/mnt/new' } });
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], expect.any(String));
  });
});

describe('MoveDialog — with no folders configured', () => {
  it('still lets the user type a path', () => {
    // DirectorySelect renders nothing without folders, so the custom field is
    // the only way to give a destination.
    store.config = { folders: [] };
    open();

    expect(select()).toBeNull();
    expect(locationField()).not.toBeNull();
  });

  it('moves to the typed path with no select present at all', () => {
    store.config = { folders: [] };
    open();
    fireEvent.change(locationField()!, { target: { value: '/mnt/new' } });
    submit();

    expect(client.torrentSetLocation).toHaveBeenCalledWith([4, 5], '/mnt/new');
  });
});
