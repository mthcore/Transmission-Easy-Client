import React, { useCallback, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import useRootStore from '../../hooks/useRootStore';
import showError from '../../tools/showError';
import { useDialogClose } from '../../hooks/useDialogClose';
import stripBidiControls from '../../tools/stripBidiControls';

interface RemoveConfirmDialogStore {
  close: () => void;
  torrentIds: number[];
  deleteData: boolean;
}

interface RemoveConfirmDialogProps {
  dialogStore: RemoveConfirmDialogStore;
}

const RemoveConfirmDialog = observer(({ dialogStore }: RemoveConfirmDialogProps) => {
  const rootStore = useRootStore();
  const client = rootStore?.client;
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();

      if (!client) return;

      const removeMethod = dialogStore.deleteData
        ? client.torrentsRemoveTorrentFiles
        : client.torrentsRemoveTorrent;

      removeMethod(dialogStore.torrentIds).catch((err) => {
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to remove torrent', err);
      });

      dialogStore.close();
    },
    [client, dialogStore]
  );

  let label: React.ReactNode = null;
  let filename: React.ReactNode = null;

  const count = dialogStore.torrentIds.length;
  const deleteData = dialogStore.deleteData;

  if (count === 1) {
    const id = dialogStore.torrentIds[0];
    const torrent = client?.torrents.get(id);
    if (torrent) {
      // Strip bidi overrides: the delete confirmation is exactly where a
      // spoofed extension must not mislead the user
      filename = <span className="fileName">{stripBidiControls(torrent.name)}</span>;
    }

    const messageKey = deleteData ? 'OV_CONFIRM_DELETE_DATA_ONE' : 'OV_CONFIRM_DELETE_ONE';
    label = <label>{chrome.i18n.getMessage(messageKey)}</label>;
  } else {
    const messageKey = deleteData
      ? 'OV_CONFIRM_DELETE_DATA_MULTIPLE'
      : 'OV_CONFIRM_DELETE_MULTIPLE';
    label = <label>{chrome.i18n.getMessage(messageKey).replace('%d', String(count))}</label>;
  }

  return (
    <Dialog onClose={handleClose} isAlert>
      <div className="nf-notifi">
        <form onSubmit={handleSubmit}>
          <div className="nf-subItem">
            {label}
            {filename}
          </div>
          <div className="nf-subItem">
            <input type="submit" value={chrome.i18n.getMessage('DLG_BTN_YES')} />
            <input
              onClick={handleClose}
              autoFocus
              data-autofocus
              type="button"
              value={chrome.i18n.getMessage('DLG_BTN_NO')}
            />
          </div>
        </form>
      </div>
    </Dialog>
  );
});

export default RemoveConfirmDialog;
