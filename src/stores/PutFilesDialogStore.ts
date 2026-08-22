import { types, Instance } from 'mobx-state-tree';
import BaseDialogStore from './BaseDialogStore';

const PutFilesDialogStore = types
  .compose(
    'PutFilesDialogStore',
    BaseDialogStore,
    types.model({
      type: types.literal('putFiles'),
      isReady: types.optional(types.boolean, false),
    })
  )
  // File objects can't live in the MST tree (not serializable), so they are
  // volatile state rather than a getter/setter pair on .views(): MST turns view
  // getters into computeds, and a computed backed by a plain closure variable
  // caches with no observable dependency — it would keep returning the first
  // FileList forever once read from a reactive context.
  .volatile(() => ({
    files: [] as File[],
  }))
  .actions((self) => ({
    setReady(value: boolean) {
      self.isReady = value;
    },
    setFiles(files: File[]) {
      self.files = files;
    },
  }));

export type IPutFilesDialogStore = Instance<typeof PutFilesDialogStore>;
export default PutFilesDialogStore;
