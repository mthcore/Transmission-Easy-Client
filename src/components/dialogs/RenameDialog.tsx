import React, { useCallback, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import useRootStore from '../../hooks/useRootStore';
import showError from '../../tools/showError';
import { useDialogClose } from '../../hooks/useDialogClose';

interface RenameDialogStore {
  close: () => void;
  path: string;
  name: string;
  torrentIds: number[];
}

interface RenameDialogProps {
  dialogStore: RenameDialogStore;
}

const RenameDialog = observer(({ dialogStore }: RenameDialogProps) => {
  const rootStore = useRootStore();
  const client = rootStore?.client;
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;

      const nameInput = form.elements.namedItem('name') as HTMLInputElement;
      const name = nameInput.value.trim();

      // An empty name is never valid — the daemon rejects it, and the only
      // trace was a generic error toast after the dialog had already closed.
      // Keep the dialog open, like MoveDialog does for an empty location.
      if (!name) {
        // A bare return gave no feedback at all; the browser's own validation
        // bubble says why, next to the field
        nameInput.value = '';
        form.reportValidity();
        return;
      }
      // Unchanged: nothing to send
      if (name === dialogStore.name) {
        dialogStore.close();
        return;
      }

      client?.rename(dialogStore.torrentIds, dialogStore.path, name).catch((err) => {
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to rename', err);
      });

      dialogStore.close();
    },
    [client, dialogStore]
  );

  return (
    <Dialog onClose={handleClose}>
      <div className="nf-notifi">
        <form onSubmit={handleSubmit}>
          <div className="nf-subItem">
            <label>{chrome.i18n.getMessage('renameText')}</label>
            <input type="text" name="name" defaultValue={dialogStore.name} autoFocus />
          </div>
          <div className="nf-subItem">
            <input type="submit" value={chrome.i18n.getMessage('DLG_BTN_APPLY')} />
            <input
              onClick={handleClose}
              type="button"
              value={chrome.i18n.getMessage('DLG_BTN_CANCEL')}
            />
          </div>
        </form>
      </div>
    </Dialog>
  );
});

export default RenameDialog;
