import React, { useCallback, useEffect, useRef, FormEvent } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import DirectorySelect from '../DirectorySelect';
import useRootStore from '../../hooks/useRootStore';
import showError from '../../tools/showError';
import { useDialogClose } from '../../hooks/useDialogClose';
import { MAX_FETCH_SIZE } from '../../constants';
import type { Folder } from '../../types/bg';

interface PutFilesDialogStore {
  close: () => void;
  files: File[];
  setReady: (ready: boolean) => void;
}

interface PutFilesDialogProps {
  dialogStore: PutFilesDialogStore;
}

const PutFilesDialog = observer(({ dialogStore }: PutFilesDialogProps) => {
  const rootStore = useRootStore();
  const config = rootStore?.config;
  const client = rootStore?.client;
  const folders = (config?.folders as Folder[] | undefined) ?? [];
  const hasDirectorySelect = folders.length > 0;
  const autoSubmittedRef = useRef(false);
  const handleClose = useDialogClose(dialogStore);

  const handleSubmit = useCallback(
    (e?: FormEvent<HTMLFormElement>) => {
      let directory: Folder | undefined = undefined;
      if (e) {
        e.preventDefault();
        const form = e.currentTarget;

        const directorySelect = form.elements.namedItem('directory') as HTMLSelectElement | null;
        if (directorySelect) {
          const directoryIndex = parseInt(directorySelect.value, 10);
          if (directoryIndex > -1 && config?.folders) {
            directory = config.folders[directoryIndex] as Folder;
          }
        }
      }

      // Same size cap as the tab-fetch path: oversized files would be read
      // fully into memory before upload
      const files = dialogStore.files.filter((file: File) => file.size <= MAX_FETCH_SIZE);
      if (files.length < dialogStore.files.length) {
        showError(
          chrome.i18n.getMessage('OV_FL_ERROR') || 'File too large',
          new Error('FILE_SIZE_EXCEEDED')
        );
        if (!files.length) {
          dialogStore.close();
          return;
        }
      }
      const urls = files.map((file: File) => URL.createObjectURL(file));

      client
        ?.sendFiles(urls, directory?.path ?? undefined)
        .then(() => {
          for (const url of urls) {
            URL.revokeObjectURL(url);
          }
        })
        .catch((err) => {
          for (const url of urls) {
            URL.revokeObjectURL(url);
          }
          showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to send files', err);
        });

      dialogStore.close();
    },
    [client, config, dialogStore]
  );

  // Auto-submit when no directory selection is needed
  useEffect(() => {
    if (!hasDirectorySelect && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      handleSubmit();
    }
  }, [hasDirectorySelect, handleSubmit]);

  const directorySelect = hasDirectorySelect ? <DirectorySelect folders={folders} /> : null;

  return (
    <Dialog onClose={handleClose}>
      <div className="nf-notifi">
        <form onSubmit={handleSubmit}>
          {directorySelect}
          <div className="nf-subItem">
            <input type="submit" value={chrome.i18n.getMessage('DLG_BTN_OK')} autoFocus />
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

export default PutFilesDialog;
