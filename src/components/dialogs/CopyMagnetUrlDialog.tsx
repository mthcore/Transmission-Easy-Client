import React, { useCallback, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import { useDialogClose } from '../../hooks/useDialogClose';
import showError from '../../tools/showError';

interface CopyMagnetUrlDialogStore {
  close: () => void;
  magnetLink: string;
}

interface CopyMagnetUrlDialogProps {
  dialogStore: CopyMagnetUrlDialogStore;
}

const CopyMagnetUrlDialog = observer(({ dialogStore }: CopyMagnetUrlDialogProps) => {
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;

      const magnetLinkInput = form.elements.namedItem('magnetLink') as HTMLInputElement;
      const magnetLink = magnetLinkInput.value;
      // Close only when the write actually landed: the clipboard API can
      // reject (Firefox permission, focus lost between click and write), and
      // closing anyway claimed success with nothing on the clipboard. On
      // failure the dialog stays open — the URI is right there to copy by hand.
      navigator.clipboard.writeText(magnetLink).then(
        () => dialogStore.close(),
        (err) => {
          showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Copy failed', err as Error);
          magnetLinkInput.select();
        }
      );
    },
    [dialogStore]
  );

  return (
    <Dialog onClose={handleClose}>
      <div className="nf-notifi">
        <form onSubmit={handleSubmit}>
          <div className="nf-subItem">
            <label>{chrome.i18n.getMessage('magnetUri')}</label>
            <input type="text" name="magnetLink" defaultValue={dialogStore.magnetLink} />
          </div>
          <div className="nf-subItem">
            <input type="submit" value={chrome.i18n.getMessage('copy')} autoFocus />
            <input
              onClick={handleClose}
              type="button"
              value={chrome.i18n.getMessage('DLG_BTN_CLOSE')}
            />
          </div>
        </form>
      </div>
    </Dialog>
  );
});

export default CopyMagnetUrlDialog;
