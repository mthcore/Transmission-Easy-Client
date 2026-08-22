import { types, Instance } from 'mobx-state-tree';
import BaseDialogStore from './BaseDialogStore';

const RenameDialogStore = types
  .compose(
    'RenameDialogStore',
    BaseDialogStore,
    types.model({
      type: types.literal('rename'),
      path: types.string,
      torrentIds: types.array(types.number),
    })
  )
  .views((self) => ({
    get name(): string | undefined {
      // Transmission paths are '/'-separated; '\' is a legal character in a
      // file name on Linux daemons, so splitting on it truncated real names
      const parts = self.path.split('/');
      return parts.pop();
    },
  }));

export type IRenameDialogStore = Instance<typeof RenameDialogStore>;
export default RenameDialogStore;
