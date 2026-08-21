import React, { useEffect } from 'react';
import Spinner from '../Spinner';
import ErrorBoundary from '../ErrorBoundary';
import getLogger from '../../tools/getLogger';

const dialogComponents = {
  putFiles: React.lazy(() => import('./PutFilesDialog')),
  putUrl: React.lazy(() => import('./PutUrlDialog')),
  removeConfirm: React.lazy(() => import('./RemoveConfirmDialog')),
  rename: React.lazy(() => import('./RenameDialog')),
  copyMagnetUrl: React.lazy(() => import('./CopyMagnetUrlDialog')),
  move: React.lazy(() => import('./MoveDialog')),
  setLabels: React.lazy(() => import('./SetLabelsDialog')),
  torrentDetails: React.lazy(() => import('./TorrentDetailsDialog')),
};

type DialogType = keyof typeof dialogComponents;

const logger = getLogger('DialogLoader');

interface DialogLoaderProps {
  type: string;
  dialogStore: unknown;
}

const DialogLoader = ({ type, dialogStore }: DialogLoaderProps) => {
  const Component = dialogComponents[type as DialogType];
  const store = dialogStore as { close?: () => void } | null;

  // Destroy an entry with no renderable component: it can never be closed by
  // the user and would block Escape for the whole session. In an effect, not
  // during render — closing mutates the map the parent is iterating.
  useEffect(() => {
    if (!Component) {
      logger.warn(`Unknown dialog type: ${type}`);
      store?.close?.();
    }
  }, [Component, type, store]);

  if (!Component) {
    return null;
  }

  return (
    <ErrorBoundary
      fallback={
        // Must stay dismissable: a dialog that throws on render has no
        // useDialog handler, so without this button its store entry would
        // live forever (and keep swallowing Escape)
        <div className="dialog-error">
          <p>{chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to load dialog'}</p>
          <button type="button" onClick={() => store?.close?.()}>
            {chrome.i18n.getMessage('DLG_BTN_CANCEL') || 'Close'}
          </button>
        </div>
      }
    >
      <React.Suspense
        fallback={
          <div className="dialog-loading">
            <Spinner />
          </div>
        }
      >
        <Component dialogStore={dialogStore as never} />
      </React.Suspense>
    </ErrorBoundary>
  );
};

export default DialogLoader;
