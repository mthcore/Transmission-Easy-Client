import { describe, it, expect, afterEach } from 'vitest';
import { types, destroy, Instance } from 'mobx-state-tree';
import FileListStore from '../FileListStore';

/**
 * Filtering and sorting of the file list.
 *
 * The folder filter and the name search compose rather than replace each other:
 * searching inside the folder you are already looking at is the useful
 * behaviour, and the alternative — search resetting the folder — loses the
 * user's place on a torrent with thousands of files.
 */

const Root = types.model('R', {
  config: types.optional(
    types.model({
      filesSort: types.optional(types.model({ by: types.string, direction: types.number }), {
        by: 'name',
        direction: 1,
      }),
    }),
    {}
  ),
  fileList: types.optional(FileListStore, { id: 1 }),
});

let root: Instance<typeof Root> | null = null;
afterEach(() => {
  if (root) {
    destroy(root);
    root = null;
  }
});

function makeList(names: string[]) {
  root = Root.create({
    fileList: {
      id: 1,
      files: names.map((name) => ({
        name,
        shortName: name,
        size: 100,
        downloaded: 0,
        priority: 2,
      })),
    },
  });
  return root.fileList;
}

const FILES = [
  'Season 1/ep01.mkv',
  'Season 1/ep02.mkv',
  'Season 1/Subs/ep01.srt',
  'Season 2/ep01.mkv',
  'règlement.pdf',
];

const names = (list: { sortedFiles: { name: string }[] }) =>
  list.sortedFiles.map((file) => file.name);

describe('FileListStore — folder filter', () => {
  it('shows everything when no folder is selected', () => {
    const list = makeList(FILES);
    expect(names(list)).toHaveLength(5);
  });

  it('restricts to the selected folder, including nested files', () => {
    const list = makeList(FILES);
    list.setFilter('Season 1');
    // Case-insensitive alphabetical: the collator uses sensitivity 'base', so
    // 'ep01.mkv' sorts before 'Subs/' rather than after it
    expect(names(list)).toEqual([
      'Season 1/ep01.mkv',
      'Season 1/ep02.mkv',
      'Season 1/Subs/ep01.srt',
    ]);
  });

  it('matches on a path boundary, so "Season 1" does not catch "Season 10"', () => {
    const list = makeList(['Season 1/a.mkv', 'Season 10/b.mkv']);
    list.setFilter('Season 1');
    expect(names(list)).toEqual(['Season 1/a.mkv']);
  });
});

describe('FileListStore — name search', () => {
  it('filters on any part of the name', () => {
    const list = makeList(FILES);
    list.setNameQuery('ep01');
    expect(names(list)).toEqual([
      'Season 1/ep01.mkv',
      'Season 1/Subs/ep01.srt',
      'Season 2/ep01.mkv',
    ]);
  });

  it('ignores case and diacritics, like the torrent search', () => {
    const list = makeList(FILES);
    list.setNameQuery('REGLEMENT');
    expect(names(list)).toEqual(['règlement.pdf']);
  });

  it('composes with the folder filter instead of replacing it', () => {
    const list = makeList(FILES);
    list.setFilter('Season 1');
    list.setNameQuery('ep01');
    // Season 2's ep01 is excluded by the folder, Subs/ep01.srt survives both
    expect(names(list)).toEqual(['Season 1/ep01.mkv', 'Season 1/Subs/ep01.srt']);
  });

  it('an empty query filters nothing', () => {
    const list = makeList(FILES);
    list.setNameQuery('');
    expect(names(list)).toHaveLength(5);
  });

  it('a query matching nothing yields an empty list rather than everything', () => {
    const list = makeList(FILES);
    list.setNameQuery('nothing-matches-this');
    expect(names(list)).toEqual([]);
  });
});

describe('FileListStore — selection follows the visible rows', () => {
  it('drops a selected file once a filter hides it', () => {
    const list = makeList(FILES);
    list.addSelectedId('Season 2/ep01.mkv' as never);
    expect(list.selectedIds).toContain('Season 2/ep01.mkv');

    // The sorted-ids watcher prunes selections that left the visible set, so a
    // hidden file cannot be acted on by a later bulk action.
    list.setFilter('Season 1');
    list.syncSelectedIds();

    expect(list.selectedIds).not.toContain('Season 2/ep01.mkv');
  });
});
