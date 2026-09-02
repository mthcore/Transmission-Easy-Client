import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({
  createDialog: vi.fn(),
  fileList: undefined as unknown,
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import FileContextMenu from '../FileContextMenu';

/**
 * Two properties carry this menu, and both are invisible when broken.
 *
 * Whether a file is wanted is independent of its priority. The daemon keeps
 * them apart; the UI used to collapse them into one 0..3 scale where 0 meant
 * "do not download", so excluding a file discarded its priority and including
 * it again silently returned it to normal. Nothing here may set one while
 * meaning the other.
 *
 * "All shown files" applies to what the folder and search filters currently
 * leave visible — never to the whole torrent. The list is flat, so a folder is
 * a filter rather than a row, and an action reaching past the filter would act
 * on files the user cannot see and did not choose.
 */

afterEach(cleanup);

function file(overrides: Record<string, unknown> = {}) {
  return { name: 'ep01.mkv', priority: 2, wanted: true, ...overrides };
}

function makeFileList(files: Record<string, ReturnType<typeof file>>, extra = {}) {
  return {
    id: 7,
    selectedIds: Object.keys(files),
    selectedIndexes: Object.keys(files).map((_, index) => index),
    visibleIndexes: [0, 1, 2, 3, 4],
    filter: '',
    resetSelectedIds: vi.fn(),
    addSelectedId: vi.fn(),
    getFileById: (id: string) => files[id],
    ...extra,
  };
}

let client: {
  filesSetPriority: ReturnType<typeof vi.fn>;
  filesSetWanted: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  showError.mockClear();
  store.createDialog.mockClear();
  client = {
    filesSetPriority: vi.fn().mockResolvedValue(undefined),
    filesSetWanted: vi.fn().mockResolvedValue(undefined),
  };
  store.client = client;
  store.fileList = makeFileList({ a: file() });
});

function open() {
  render(
    <FileContextMenu fileId="a">
      <span data-testid="row">row</span>
    </FileContextMenu>
  );
  fireEvent.contextMenu(screen.getByTestId('row'));
}

/** The submenu trigger's text is split across label and arrow. */
function openSub(prefix: string) {
  const trigger = screen
    .getAllByRole('menuitem')
    .find((item) => item.textContent?.startsWith(prefix));
  if (!trigger) throw new Error(`No submenu trigger starting with "${prefix}"`);
  fireEvent.click(trigger);
  fireEvent.pointerDown(trigger);
  return screen.getAllByRole('menuitem');
}

/** Items in the currently open submenu, i.e. those after its trigger. */
function subItems(prefix: string) {
  const all = openSub(prefix);
  const at = all.findIndex((item) => item.textContent?.startsWith(prefix));
  return all.slice(at + 1);
}

const byText = (text: string) =>
  screen.getAllByRole('menuitem').find((item) => item.textContent?.includes(text));

describe('FileContextMenu — wanted and priority stay apart', () => {
  it('excludes a file without touching its priority', () => {
    open();
    fireEvent.click(byText('MF_DONT')!);

    expect(client.filesSetWanted).toHaveBeenCalledWith(7, [0], false);
    expect(client.filesSetPriority).not.toHaveBeenCalled();
  });

  it('includes a file without touching its priority', () => {
    open();
    fireEvent.click(byText('downloadFile')!);

    expect(client.filesSetWanted).toHaveBeenCalledWith(7, [0], true);
    expect(client.filesSetPriority).not.toHaveBeenCalled();
  });

  it('sets a priority without re-including an excluded file', () => {
    // The old conflation made "high priority" silently mean "download it too".
    store.fileList = makeFileList({ a: file({ wanted: false }) });
    open();
    fireEvent.click(byText('MF_HIGH')!);

    expect(client.filesSetPriority).toHaveBeenCalledWith(7, [0], 3);
    expect(client.filesSetWanted).not.toHaveBeenCalled();
  });

  it.each([
    ['MF_HIGH', 3],
    ['MF_NORMAL', 2],
    ['MF_LOW', 1],
  ])('%s sends level %i', (label, level) => {
    open();
    fireEvent.click(byText(label)!);

    expect(client.filesSetPriority).toHaveBeenCalledWith(7, [0], level);
  });
});

describe('FileContextMenu — ticks only where the selection agrees', () => {
  it('ticks the shared priority', () => {
    store.fileList = makeFileList({ a: file({ priority: 3 }), b: file({ priority: 3 }) });
    open();

    expect(byText('MF_HIGH')?.textContent).toContain('●');
    expect(byText('MF_LOW')?.textContent).not.toContain('●');
  });

  it('ticks no priority when the selection disagrees', () => {
    // A mixed selection has no single current value to show.
    store.fileList = makeFileList({ a: file({ priority: 3 }), b: file({ priority: 1 }) });
    open();

    ['MF_HIGH', 'MF_NORMAL', 'MF_LOW'].forEach((label) => {
      expect(byText(label)?.textContent, label).not.toContain('●');
    });
  });

  it('ticks Download only when every selected file is wanted', () => {
    store.fileList = makeFileList({ a: file({ wanted: true }), b: file({ wanted: false }) });
    open();

    expect(byText('downloadFile')?.textContent).not.toContain('✓');
    expect(byText('MF_DONT')?.textContent).not.toContain('✓');
  });

  it('ticks Do not download when every selected file is excluded', () => {
    store.fileList = makeFileList({ a: file({ wanted: false }), b: file({ wanted: false }) });
    open();

    expect(byText('MF_DONT')?.textContent).toContain('✓');
    expect(byText('downloadFile')?.textContent).not.toContain('✓');
  });
});

describe('FileContextMenu — "all shown files"', () => {
  it('applies to what is visible, not to the selection', () => {
    // The point of the entry: acting on a season pack without selecting a
    // few thousand rows by hand first.
    open();
    const items = subItems('applyToShownFiles');
    fireEvent.click(items.find((item) => item.textContent?.includes('MF_HIGH'))!);

    expect(client.filesSetPriority).toHaveBeenCalledWith(7, [0, 1, 2, 3, 4], 3);
  });

  it('never reaches a file the filters are hiding', () => {
    // Narrowing the folder or the search narrows what this can touch.
    store.fileList = makeFileList({ a: file() }, { visibleIndexes: [2, 3] });
    open();
    const items = subItems('applyToShownFiles');
    fireEvent.click(items.find((item) => item.textContent?.includes('MF_DONT'))!);

    expect(client.filesSetWanted).toHaveBeenCalledWith(7, [2, 3], false);
  });

  it('says how many files it would touch', () => {
    // Without the count the entry is a blind action on an unknown number of
    // files, which is exactly when it is dangerous.
    store.fileList = makeFileList({ a: file() }, { visibleIndexes: [0, 1, 2] });
    open();

    expect(screen.getAllByRole('menuitem').some((i) => i.textContent?.includes('(3)'))).toBe(true);
  });

  it('keeps wanted and priority apart there too', () => {
    open();
    const items = subItems('applyToShownFiles');
    fireEvent.click(items.find((item) => item.textContent?.includes('downloadFile'))!);

    expect(client.filesSetWanted).toHaveBeenCalledWith(7, [0, 1, 2, 3, 4], true);
    expect(client.filesSetPriority).not.toHaveBeenCalled();
  });
});

describe('FileContextMenu — renaming', () => {
  it('renames the first selected file within its torrent', () => {
    open();
    fireEvent.click(byText('rename')!);

    expect(store.createDialog).toHaveBeenCalledWith({
      type: 'rename',
      path: 'ep01.mkv',
      torrentIds: [7],
    });
  });

  it('opens no dialog when the file is gone from the store', () => {
    store.fileList = makeFileList({}, { selectedIds: ['missing'] });
    open();
    const item = byText('rename');
    if (item) fireEvent.click(item);

    expect(store.createDialog).not.toHaveBeenCalled();
  });
});

describe('FileContextMenu — when there is nothing to act on', () => {
  it('renders no menu without a selection', () => {
    store.fileList = makeFileList({}, { selectedIds: [] });
    open();

    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });

  it('renders no menu before the file list exists', () => {
    store.fileList = undefined;
    open();

    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });
});

describe('FileContextMenu — when the daemon refuses', () => {
  it('reports it instead of leaving the file unchanged in silence', async () => {
    client.filesSetWanted.mockRejectedValueOnce(new Error('daemon said 409'));
    open();
    fireEvent.click(byText('MF_DONT')!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
