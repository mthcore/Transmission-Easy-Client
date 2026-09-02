import { describe, it, expect } from 'vitest';
import { types, Instance } from 'mobx-state-tree';
import ListSelectStore from '../ListSelectStore';

/**
 * The selection shared by the torrent list and the file list. Two of its rules
 * only show themselves against a list that is sorted or filtered, which is
 * every list here.
 *
 * A shift-click selects a RANGE, and the range is taken in display order, not
 * in id order — the anchor is the id selected last, and both directions have to
 * work. And the selection is kept in step with what is actually listed: ids
 * that leave the list are dropped, because a selection holding torrents nobody
 * can see makes the next action reach further than the user meant.
 */

const TestStore = ListSelectStore.props({
  // The display order, as the concrete stores derive it from their own sort
  order: types.optional(types.array(types.number), []),
})
  .views((self) => ({
    get _sortedIds(): number[] {
      return self.order.slice();
    },
  }))
  // MST protects its nodes, so the list can only be changed from an action of
  // its own — runInAction is not enough.
  .actions((self) => ({
    setOrder(order: number[]) {
      self.order.replace(order);
    },
  }));

type ITestStore = Instance<typeof TestStore>;

const create = (order: number[] = [10, 20, 30, 40, 50]) =>
  TestStore.create({ order }) as ITestStore;

describe('ListSelectStore — one at a time', () => {
  it('adds an id', () => {
    const store = create();
    store.addSelectedId(20);

    expect(store.selectedIds.slice()).toEqual([20]);
  });

  it('adds the same id only once', () => {
    const store = create();
    store.addSelectedId(20);
    store.addSelectedId(20);

    expect(store.selectedIds.slice()).toEqual([20]);
  });

  it('replaces the selection when asked to reset', () => {
    // Right-clicking an unselected row selects it alone.
    const store = create();
    store.addSelectedId(10);
    store.addSelectedId(30, true);

    expect(store.selectedIds.slice()).toEqual([30]);
  });

  it('removes an id', () => {
    const store = create();
    store.addSelectedId(10);
    store.addSelectedId(20);
    store.removeSelectedId(10);

    expect(store.selectedIds.slice()).toEqual([20]);
  });

  it('ignores a removal of something not selected', () => {
    const store = create();
    store.addSelectedId(10);
    store.removeSelectedId(99);

    expect(store.selectedIds.slice()).toEqual([10]);
  });

  it('answers whether an id is selected', () => {
    const store = create();
    store.addSelectedId(10);

    expect(store.isSelectedId(10)).toBe(true);
    expect(store.isSelectedId(20)).toBe(false);
  });
});

describe('ListSelectStore — selecting a range', () => {
  it('takes the range in display order, not in id order', () => {
    // The ids are arbitrary; only the order the user sees means anything.
    const store = create([50, 40, 30, 20, 10]);
    store.addSelectedId(50);
    store.addMultipleSelectedId(30);

    expect(store.selectedIds.slice()).toEqual([50, 40, 30]);
  });

  it('anchors on the id selected last', () => {
    const store = create();
    store.addSelectedId(10);
    store.addSelectedId(30);
    store.addMultipleSelectedId(50);

    expect(store.selectedIds.slice()).toEqual([30, 40, 50]);
  });

  it('works upwards as well as downwards', () => {
    const store = create();
    store.addSelectedId(40);
    store.addMultipleSelectedId(20);

    expect(store.selectedIds.slice()).toEqual([20, 30, 40]);
  });

  it('selects a single row when the anchor is the target', () => {
    const store = create();
    store.addSelectedId(30);
    store.addMultipleSelectedId(30);

    expect(store.selectedIds.slice()).toEqual([30]);
  });

  it('selects just the row when nothing was selected to anchor on', () => {
    // Shift-clicking into an empty selection has no range to take.
    const store = create();
    store.addMultipleSelectedId(30);

    expect(store.selectedIds.slice()).toEqual([30]);
  });

  it('replaces the previous selection rather than adding to it', () => {
    // A range is what the user asked for, not a range on top of odds and ends.
    const store = create();
    store.addSelectedId(10);
    store.addSelectedId(50);
    store.addMultipleSelectedId(30);

    expect(store.selectedIds.slice()).toEqual([30, 40, 50]);
  });
});

describe('ListSelectStore — select all', () => {
  it('selects everything listed', () => {
    const store = create();
    store.toggleSelectAll();

    expect(store.selectedIds.slice()).toEqual([10, 20, 30, 40, 50]);
  });

  it('clears the selection when everything is already selected', () => {
    const store = create();
    store.toggleSelectAll();
    store.toggleSelectAll();

    expect(store.selectedIds.slice()).toEqual([]);
  });

  it('selects everything when only some rows were selected', () => {
    const store = create();
    store.addSelectedId(20);
    store.toggleSelectAll();

    expect(store.selectedIds).toHaveLength(5);
  });

  it('reports select-all only when the whole list is selected', () => {
    const store = create();
    store.addSelectedId(10);
    expect(store.isSelectedAll).toBe(false);

    store.toggleSelectAll();
    expect(store.isSelectedAll).toBe(true);
  });

  it('reports nothing selected for an empty list', () => {
    // Otherwise an empty list shows its header checkbox ticked.
    const store = create([]);

    expect(store.isSelectedAll).toBe(false);
  });
});

describe('ListSelectStore — keeping up with the list', () => {
  it('drops ids that have left the list', () => {
    // A selection holding torrents nobody can see makes the next action reach
    // further than the user meant.
    const store = create();
    store.addSelectedId(20);
    store.addSelectedId(30);
    store.setOrder([10, 20]);
    store.syncSelectedIds();

    expect(store.selectedIds.slice()).toEqual([20]);
  });

  it('keeps the ones that are still there', () => {
    const store = create();
    store.toggleSelectAll();
    store.setOrder([30, 10]);
    store.syncSelectedIds();

    expect(store.selectedIds.slice().sort()).toEqual([10, 30]);
  });

  it('follows the list on its own once the watcher is started', () => {
    // The concrete stores start this so a filter change prunes the selection
    // without anyone remembering to ask.
    const store = create();
    store.startSortedIdsWatcher();
    store.addSelectedId(50);

    store.setOrder([10, 20]);

    expect(store.selectedIds.slice()).toEqual([]);
    store.stopSortedIdsWatcher();
  });

  it('stops following once the watcher is stopped', () => {
    const store = create();
    store.startSortedIdsWatcher();
    store.stopSortedIdsWatcher();
    store.addSelectedId(50);

    store.setOrder([10, 20]);

    expect(store.selectedIds.slice()).toEqual([50]);
  });

  it('can be stopped twice without complaint', () => {
    const store = create();
    store.startSortedIdsWatcher();
    store.stopSortedIdsWatcher();

    expect(() => store.stopSortedIdsWatcher()).not.toThrow();
  });

  it('clears the selection outright', () => {
    const store = create();
    store.toggleSelectAll();
    store.resetSelectedIds();

    expect(store.selectedIds.slice()).toEqual([]);
  });
});
