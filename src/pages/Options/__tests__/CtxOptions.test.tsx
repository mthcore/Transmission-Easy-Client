import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const configStore = vi.hoisted(() => ({
  folders: [] as { path: string; name?: string }[],
  hasFolder: vi.fn(),
  addFolder: vi.fn(),
  removeFolders: vi.fn(),
  moveFolders: vi.fn(),
  setOptions: vi.fn(),
  treeViewContextMenu: false,
  putDefaultPathInContextMenu: false,
  selectDownloadCategoryAfterPutTorrentFromContextMenu: false,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => ({ config: configStore }) }));

import CtxOptions from '../CtxOptions';

/**
 * The folder list that becomes the browser context menu. Its one subtle rule is
 * about trailing slashes: '/data/x' and '/data/x/' pass an exact-string
 * duplicate check as different paths and then collapse into a single entry in
 * the menu tree, so the list holds two rows that behave as one.
 *
 * A drive root is the exception. On Windows 'C:' means "the process's current
 * directory on C", which is not the same place as 'C:\', so that separator
 * stays.
 */

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  configStore.folders = [];
  configStore.hasFolder.mockReturnValue(false);
});

const draw = () => render(<CtxOptions />);
const pathField = () => document.querySelector('input[name="path"]') as HTMLInputElement;
const nameField = () => document.querySelector('input[name="name"]') as HTMLInputElement;
const form = () => document.querySelector('form.dir-form') as HTMLFormElement;

/** Fill the add form and submit it; returns the path that was stored. */
function add(path: string, name = '') {
  fireEvent.change(pathField(), { target: { value: path } });
  fireEvent.change(nameField(), { target: { value: name } });
  fireEvent.submit(form());
  return configStore.addFolder.mock.calls[0]?.[0];
}

describe('CtxOptions — adding a folder', () => {
  it('stores the path and its label', () => {
    draw();
    add('/mnt/films', 'Films');

    expect(configStore.addFolder).toHaveBeenCalledWith('/mnt/films', 'Films');
  });

  it('strips a trailing slash, which would otherwise duplicate the entry', () => {
    // '/data/x' and '/data/x/' are different strings and the same folder.
    draw();

    expect(add('/mnt/films/')).toBe('/mnt/films');
  });

  it('strips several trailing separators', () => {
    draw();

    expect(add('/mnt/films//')).toBe('/mnt/films');
  });

  it('keeps the separator on a Windows drive root', () => {
    // 'C:' means the process's current directory on C, which is a different
    // place from 'C:\'.
    draw();

    expect(add('C:\\')).toBe('C:\\');
  });

  it('keeps a lone slash, which is a real path', () => {
    draw();

    expect(add('/')).toBe('/');
  });

  it('trims surrounding whitespace', () => {
    draw();

    expect(add('  /mnt/films  ')).toBe('/mnt/films');
  });

  it('adds nothing for an empty path', () => {
    draw();
    add('   ');

    expect(configStore.addFolder).not.toHaveBeenCalled();
  });

  it('says so instead of looking like a broken button', () => {
    // A silent no-op on a duplicate is indistinguishable from Add not working.
    configStore.hasFolder.mockReturnValue(true);
    draw();
    add('/mnt/films');

    expect(configStore.addFolder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('folderAlreadyExists');
  });

  it('checks for the duplicate on the stripped path', () => {
    draw();
    add('/mnt/films/');

    expect(configStore.hasFolder).toHaveBeenCalledWith('/mnt/films');
  });

  it('clears the form once the folder is in', () => {
    draw();
    add('/mnt/films', 'Films');

    expect(pathField().value).toBe('');
    expect(nameField().value).toBe('');
  });

  it('drops the duplicate warning as soon as the path is edited', () => {
    // Left up, a red "already in the list" sat under a path that was no longer
    // in the list.
    configStore.hasFolder.mockReturnValue(true);
    draw();
    add('/mnt/films');
    expect(document.body.textContent).toContain('folderAlreadyExists');

    fireEvent.change(pathField(), { target: { value: '/mnt/other' } });

    expect(document.body.textContent).not.toContain('folderAlreadyExists');
  });
});

describe('CtxOptions — the existing folders', () => {
  beforeEach(() => {
    configStore.folders = [{ path: '/mnt/films', name: 'Films' }, { path: '/mnt/series' }];
  });

  const list = () => document.querySelector('select') as HTMLSelectElement;

  it('shows a labelled folder as "label (path)"', () => {
    draw();

    expect(list().options[0].textContent).toBe('Films (/mnt/films)');
  });

  it('shows an unlabelled folder by its path alone', () => {
    draw();

    expect(list().options[1].textContent).toBe('/mnt/series');
  });

  it('removes the folders that are selected', () => {
    draw();
    list().options[1].selected = true;
    fireEvent.click(screen.getByTitle('deleteSelected'));

    expect(configStore.removeFolders).toHaveBeenCalledWith([{ path: '/mnt/series' }]);
  });

  it('moves a selection up', () => {
    draw();
    list().options[1].selected = true;
    fireEvent.click(screen.getByTitle('up'));

    expect(configStore.moveFolders).toHaveBeenCalledWith([{ path: '/mnt/series' }], -1);
  });

  it('moves a selection down', () => {
    draw();
    list().options[0].selected = true;
    fireEvent.click(screen.getByTitle('down'));

    expect(configStore.moveFolders).toHaveBeenCalledWith(
      [{ path: '/mnt/films', name: 'Films' }],
      1
    );
  });

  it('acts on every selected folder, not only the first', () => {
    draw();
    list().options[0].selected = true;
    list().options[1].selected = true;
    fireEvent.click(screen.getByTitle('up'));

    expect(configStore.moveFolders.mock.calls[0][0]).toHaveLength(2);
  });

  it('does nothing with nothing selected', () => {
    draw();
    fireEvent.click(screen.getByTitle('up'));

    expect(configStore.moveFolders).toHaveBeenCalledWith([], -1);
  });
});
