import React, { useCallback, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import DirectorySelect from '../DirectorySelect';
import useRootStore from '../../hooks/useRootStore';
import showError from '../../tools/showError';
import { useDialogClose } from '../../hooks/useDialogClose';

interface Folder {
  name?: string;
  path: string;
}

interface PutUrlDialogStore {
  close: () => void;
}

interface PutUrlDialogProps {
  dialogStore: PutUrlDialogStore;
}

const PutUrlDialog = observer(({ dialogStore }: PutUrlDialogProps) => {
  const rootStore = useRootStore();
  const config = rootStore?.config;
  const client = rootStore?.client;
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;

      const urlInput = form.elements.namedItem('url') as HTMLInputElement;
      const url = urlInput.value.trim();
      if (!url) {
        // Whitespace passes the `required` check (spaces count as a value), so
        // a silent return here looked like a dead OK button — clear the field
        // and let the browser's own validation bubble explain
        urlInput.value = '';
        form.reportValidity();
        return;
      }

      const urls = [url];

      let directory: Folder | undefined = undefined;
      const directorySelect = form.elements.namedItem('directory') as HTMLSelectElement | null;
      if (directorySelect) {
        const directoryIndex = parseInt(directorySelect.value, 10);
        if (directoryIndex > -1 && config?.folders) {
          directory = config.folders[directoryIndex] as Folder;
        }
      }

      client?.sendFiles(urls, directory?.path ?? undefined).catch((err) => {
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to add torrent', err);
      });

      dialogStore.close();
    },
    [client, config, dialogStore]
  );

  const folders = (config?.folders as Folder[] | undefined) || [];

  return (
    <Dialog onClose={handleClose}>
      <div className="nf-notifi">
        <form onSubmit={handleSubmit}>
          <div className="nf-subItem">
            <label>{chrome.i18n.getMessage('Paste_a_torrent_URL')}</label>
            <input type="text" name="url" autoFocus required />
          </div>
          <DirectorySelect folders={folders} />
          <div className="nf-subItem">
            <input type="submit" value={chrome.i18n.getMessage('DLG_BTN_OK')} />
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

export default PutUrlDialog;
