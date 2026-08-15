import { types, Instance, cast } from 'mobx-state-tree';
import { autorun, IReactionDisposer } from 'mobx';

// Interface for self-references within actions/views
// Using a separate interface to avoid circular reference issues
interface IListSelectStoreViews {
  _sortedIds: number[];
  _selectedIdsSet: Set<number>;
  isSelectedAll: boolean;
  addSelectedId(id: number, reset?: boolean): void;
  selectedIds: number[];
  syncSelectedIds(): void;
}

const ListSelectStore = types
  .model('ListSelectStore', {
    selectedIds: types.array(types.number),
  })
  .actions((self) => {
    return {
      addSelectedId(id: number, reset?: boolean) {
        const ids = self.selectedIds.slice(0);
        if (reset) {
          ids.splice(0);
        }
        const pos = ids.indexOf(id);
        if (pos === -1) {
          ids.push(id);
        }
        self.selectedIds = cast(ids);
      },
      isSelectedId(id: number): boolean {
        return (self as unknown as IListSelectStoreViews)._selectedIdsSet.has(id);
      },
      removeSelectedId(id: number) {
        const ids = self.selectedIds.slice(0);
        const pos = ids.indexOf(id);
        if (pos !== -1) {
          ids.splice(pos, 1);
        }
        self.selectedIds = cast(ids);
      },
      addMultipleSelectedId(toId: number): void {
        const selfWithViews = self as unknown as IListSelectStoreViews;
        if (!self.selectedIds.length) {
          selfWithViews.addSelectedId(toId);
          return;
        }

        const fromId = self.selectedIds.slice(-1)[0];
        const ids = selfWithViews._sortedIds;
        const fromPos = ids.indexOf(fromId);
        const toPos = ids.indexOf(toId);
        if (fromPos < toPos) {
          self.selectedIds = cast(ids.slice(fromPos, toPos + 1));
        } else {
          self.selectedIds = cast(ids.slice(toPos, fromPos + 1));
        }
      },
      toggleSelectAll() {
        const selfWithViews = self as unknown as IListSelectStoreViews;
        if (selfWithViews.isSelectedAll) {
          self.selectedIds = cast([]);
        } else {
          self.selectedIds = cast(selfWithViews._sortedIds.slice(0));
        }
      },
      resetSelectedIds() {
        self.selectedIds = cast([]);
      },
      syncSelectedIds() {
        const selfWithViews = self as unknown as IListSelectStoreViews;
        const sortedSet = new Set(selfWithViews._sortedIds);
        self.selectedIds = cast(self.selectedIds.filter((id) => sortedSet.has(id)));
      },
    };
  })
  .views((self) => {
    return {
      get _sortedIds(): number[] {
        throw new Error('Overwrite me!');
      },
      get _selectedIdsSet(): Set<number> {
        return new Set(self.selectedIds);
      },
      get _sortedIdsSet(): Set<number> {
        return new Set(this._sortedIds);
      },
      get isSelectedAll(): boolean {
        const ids = this._sortedIds;
        const sortedSet = this._sortedIdsSet;
        if (ids.length > 0 && self.selectedIds.length === ids.length) {
          return self.selectedIds.every((id) => sortedSet.has(id));
        }
        return false;
      },
    };
  })
  .actions((self) => {
    let _autorun: IReactionDisposer | null = null;

    return {
      startSortedIdsWatcher() {
        _autorun = autorun(() => {
          if ((self as unknown as IListSelectStore)._sortedIds) {
            self.syncSelectedIds();
          }
        });
      },
      stopSortedIdsWatcher() {
        _autorun && _autorun();
        _autorun = null;
      },
    };
  });

export type IListSelectStore = Instance<typeof ListSelectStore>;
export default ListSelectStore;
