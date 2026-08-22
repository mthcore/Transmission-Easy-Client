import React, { useCallback, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import useRootStore from '../../hooks/useRootStore';
import showError from '../../tools/showError';
import { useDialogClose } from '../../hooks/useDialogClose';

interface SetLabelsDialogStore {
  close: () => void;
  currentLabels: string;
  torrentIds: number[];
}

interface SetLabelsDialogProps {
  dialogStore: SetLabelsDialogStore;
}

const SetLabelsDialog = observer(({ dialogStore }: SetLabelsDialogProps) => {
  const rootStore = useRootStore();
  const client = rootStore?.client;
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const labelsInput = form.elements.namedItem('labels') as HTMLInputElement;
      const labelsStr = labelsInput.value.trim();
      // Deduplicate: Transmission rejects the WHOLE torrent-set request with
      // "labels cannot be duplicated", so one repeated label dropped them all
      const labels = labelsStr
        ? Array.from(
            new Set(
              labelsStr
                .split(',')
                .map((l) => l.trim())
                .filter(Boolean)
            )
          )
        : [];

      client?.setLabels(dialogStore.torrentIds, labels).catch((err: Error) => {
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to set labels', err);
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
            <label>{chrome.i18n.getMessage('enterNewLabel')}</label>
            <input type="text" name="labels" defaultValue={dialogStore.currentLabels} autoFocus />
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

export default SetLabelsDialog;
