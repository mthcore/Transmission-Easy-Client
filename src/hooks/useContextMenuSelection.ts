import { useCallback } from 'react';

interface ListStore {
  selectedIds: (string | number)[];
  resetSelectedIds(): void;
  addSelectedId(id: string | number): void;
}

/**
 * Right-clicking an unselected row selects it first, so the menu always acts on
 * what the user pointed at.
 *
 * The store is optional because both callers pass one that may not exist yet —
 * they cast it to a required shape, and the menu content below them already
 * returns null for that case. Dereferencing it here threw before that guard
 * could run, which is a crash rather than an empty menu.
 */
export function useContextMenuSelection(
  listStore: ListStore | undefined,
  itemId: string | number
): (open: boolean) => void {
  return useCallback(
    (open: boolean) => {
      if (!listStore) return;
      if (open && !listStore.selectedIds.includes(itemId)) {
        listStore.resetSelectedIds();
        listStore.addSelectedId(itemId);
      }
    },
    [listStore, itemId]
  );
}
