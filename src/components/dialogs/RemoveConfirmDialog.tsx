import React, { useCallback, useState, FormEvent } from 'react';
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

  // Hashes captured the moment the dialog opens: numeric ids are session
  // scoped, so a daemon restart while this confirmation sits open can hand
  // the same id to a DIFFERENT torrent — and "delete with data" would then
  // destroy that torrent's files. The hash addresses the torrent immutably;
  // the RPC accepts both forms in `ids`.
  const [removalIds] = useState<(number | string)[]>(() =>
    dialogStore.torrentIds.map((id) => {
      const hash = (rootStore?.client?.torrents.get(id) as { hashString?: string } | undefined)
        ?.hashString;
      return hash ?? id;
    })
  );

  // Frozen for the same reason as removalIds. Read live, the name came from
  // whatever torrent currently holds that id — so in the exact case the hash
  // capture exists for, the dialog named one torrent while deleting another.
  const [removalName] = useState<string | null>(() => {
    if (dialogStore.torrentIds.length !== 1) return null;
    const torrent = rootStore?.client?.torrents.get(dialogStore.torrentIds[0]);
    return torrent ? torrent.name : null;
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();

      if (!client) return;

      const removeMethod = dialogStore.deleteData
        ? client.torrentsRemoveTorrentFiles
        : client.torrentsRemoveTorrent;

      removeMethod(removalIds).catch((err) => {
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to remove torrent', err);
      });

      dialogStore.close();
    },
    [client, dialogStore, removalIds]
  );

  let label: React.ReactNode;
  let filename: React.ReactNode = null;

  const count = dialogStore.torrentIds.length;
  const deleteData = dialogStore.deleteData;

  if (count === 1) {
    if (removalName !== null) {
      // Strip bidi overrides: the delete confirmation is exactly where a
      // spoofed extension must not mislead the user
      filename = <span className="fileName">{stripBidiControls(removalName)}</span>;
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
