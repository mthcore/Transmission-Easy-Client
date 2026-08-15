import { getRoot, types, Instance } from 'mobx-state-tree';

/**
 * Base model for all dialog stores.
 * Provides common id property and close() method.
 *
 * Usage: types.compose('MyDialogStore', BaseDialogStore, types.model({ ... }))
 */

interface RootStoreWithDialog {
  destroyDialog: (id: string) => void;
}

const BaseDialogStore = types
  .model('BaseDialogStore', {
    id: types.identifier,
  })
  .actions((self) => ({
    close() {
      const rootStore = getRoot<RootStoreWithDialog>(self);
      rootStore.destroyDialog(self.id);
    },
  }));

export type IBaseDialogStore = Instance<typeof BaseDialogStore>;
export default BaseDialogStore;
