import 'rc-select/assets/index.css';
import '../assets/css/stylesheet.scss';
import React, { useEffect, useCallback, memo, type ReactNode } from 'react';
import Menu from '../components/menu/Menu';
import { observer } from 'mobx-react';
import { reaction } from 'mobx';
import { createRoot } from 'react-dom/client';
import RootStore from '../stores/RootStore';
import TorrentListTable from '../components/table/TorrentListTable';
import FileListTable from '../components/table/FileListTable';
import Footer from '../components/Footer';
import Interval from '../components/Interval';
import VisiblePage from '../components/VisiblePage';
import getLogger from '../tools/getLogger';
import RootStoreCtx from '../tools/rootStoreCtx';
import useRootStore from '../hooks/useRootStore';
import { useTheme } from '../hooks/useTheme';
import DialogLoader from '../components/dialogs/DialogLoader';
import ErrorBoundary from '../components/ErrorBoundary';
import applyStoredTheme, { applyLocaleDirection } from '../tools/applyStoredTheme';

// Before React renders, so an explicit theme doesn't flash the OS one first
applyStoredTheme();
applyLocaleDirection();

const logger = getLogger('Index');

const Index = observer(() => {
  const rootStore = useRootStore();

  useEffect(() => {
    rootStore.init();

    if (rootStore.isPopup) {
      document.body.classList.add('popup');
    }
  }, [rootStore]);

  // Set popup mode in config for column width separation (after config loads)
  useEffect(() => {
    const dispose = reaction(
      () => rootStore.config,
      (config) => {
        if (config) {
          config.setPopupMode(rootStore.isPopup);
        }
      },
      { fireImmediately: true }
    );
    return () => dispose();
  }, [rootStore]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip while TYPING — but only there. A focused checkbox (clicking a row
      // checkbox leaves focus on it) must not kill the list shortcuts, or the
      // most natural flow of all, select-then-Delete, goes dead.
      const target = e.target as HTMLElement;
      const isTextEntry =
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        (target.tagName === 'INPUT' &&
          !['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type));
      if (isTextEntry) return;
      // Enter on a focused button/link activates that control; firing the
      // start/stop shortcut at the same time acted on the whole selection
      // behind the user's back. (A focused checkbox is fine: Enter is inert
      // on checkboxes, so the shortcut may run.)
      if (
        e.key === 'Enter' &&
        (target.closest('button, a, [role="button"]') !== null ||
          (target.tagName === 'INPUT' &&
            ['button', 'submit'].includes((target as HTMLInputElement).type)))
      ) {
        return;
      }

      // Escape - close the file list. Open dialogs handle Escape themselves,
      // topmost first (useDialog); closing them here too would pop two per press
      if (e.key === 'Escape') {
        if (!rootStore.dialogs.size && rootStore.fileList) {
          rootStore.destroyFileList();
        }
        return;
      }

      if (!rootStore.client) return;

      // Every shortcut below acts on the torrent list behind an open dialog:
      // without this guard, Enter/Delete/F2 kept firing while a confirmation
      // dialog was up (Enter could start the very torrents about to be removed)
      if (rootStore.dialogs.size) return;

      // R - Refresh. Guarded like the toolbar button: key auto-repeat used to
      // fire dozens of forced full refreshes per second.
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.repeat) {
        if (rootStore.isRefreshing) return;
        rootStore.setRefreshing(true);
        Promise.all([
          rootStore.client.updateTorrentList(true).catch((err) => {
            logger.error('refresh shortcut: updateTorrentList error', err);
          }),
          rootStore.client.updateSettings().catch((err) => {
            logger.error('refresh shortcut: updateSettings error', err);
          }),
        ]).finally(() => rootStore.setRefreshing(false));
        return;
      }

      // Ctrl+A - Toggle select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        rootStore.torrentList.toggleSelectAll();
        return;
      }

      // Ctrl+U - Add URL
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        rootStore.createDialog({ type: 'putUrl' });
        return;
      }

      // Delete - Remove selected
      if (e.key === 'Delete' && rootStore.torrentList.selectedIds.length) {
        rootStore.createDialog({
          type: 'removeConfirm',
          torrentIds: rootStore.torrentList.selectedIds.slice(0),
        });
        return;
      }

      // Enter - Start/Stop selected
      if (e.key === 'Enter' && !e.repeat && rootStore.torrentList.selectedIds.length) {
        const ids = rootStore.torrentList.selectedIds;
        // Decide on the run state, not on instantaneous speed: isActive is
        // speed-based, so a started-but-idle torrent could never be paused
        const anyRunning = ids.some(
          (id) => (rootStore.client?.torrents.get(id)?.statusCode ?? 0) !== 0
        );
        if (anyRunning) {
          rootStore.client.torrentsStop(ids);
        } else {
          rootStore.client.torrentsStart(ids);
        }
        return;
      }

      // Ctrl+O (add torrent file) is handled in Menu, next to its file input

      // F2 - Rename selected torrent
      if (e.key === 'F2' && rootStore.torrentList.selectedIds.length === 1) {
        e.preventDefault();
        const id = rootStore.torrentList.selectedIds[0];
        const torrent = rootStore.client.torrents.get(id);
        if (torrent) {
          rootStore.createDialog({
            type: 'rename',
            path: torrent.name,
            torrentIds: [id],
          });
        }
        return;
      }

      // Ctrl+M - Move selected torrent
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        if (rootStore.torrentList.selectedIds.length) {
          const id = rootStore.torrentList.selectedIds[0];
          const torrent = rootStore.client.torrents.get(id);
          // MoveDialogStore.directory is a required string: passing undefined
          // (torrent removed elsewhere between the last sync and this keypress)
          // throws an MST typecheck error out of the keydown handler
          rootStore.createDialog({
            type: 'move',
            directory: torrent?.directory ?? '',
            torrentIds: rootStore.torrentList.selectedIds.slice(0),
          });
        }
        return;
      }

      // Ctrl+I - Show properties
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        if (rootStore.torrentList.selectedIds.length === 1) {
          rootStore.createDialog({
            type: 'torrentDetails',
            torrentId: rootStore.torrentList.selectedIds[0],
          });
        }
        return;
      }

      // Ctrl+Shift+S - Stop all. e.repeat guarded like 'r': holding the chord
      // auto-repeats, and each repeat costs an RPC plus a chained refetch.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S' && !e.repeat) {
        e.preventDefault();
        rootStore.client.torrentsStop(rootStore.client.torrentIds);
        return;
      }

      // Ctrl+Shift+R - Start all
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R' && !e.repeat) {
        e.preventDefault();
        rootStore.client.torrentsStart(rootStore.client.torrentIds);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [rootStore]);

  // Theme application
  useTheme(rootStore.config);

  const settingsTickRef = React.useRef(0);
  const onIntervalFire = useCallback(
    (isInit: boolean) => {
      if (!rootStore.client) return;
      // Session settings were fetched once at init and then never again, so
      // the footer's session totals froze and the turtle button could show
      // OFF for hours while a scheduled alt-speed window was actually ON.
      // One session-get every ~30 ticks keeps them honest for a trivial cost.
      settingsTickRef.current += 1;
      if (isInit || settingsTickRef.current >= 30) {
        settingsTickRef.current = 0;
        rootStore.client.updateSettings().catch((err) => {
          logger.error('onIntervalFire updateSettings error', err);
        });
      }
      rootStore.client.updateTorrentList(isInit).catch((err) => {
        logger.error('onIntervalFire updateTorrentList error', err);
      });
    },
    [rootStore]
  );

  if (['idle', 'pending'].includes(rootStore.state)) {
    return (
      <div className="loading-container">
        <div className="loading" />
      </div>
    );
  }

  // Set together in RootStore.init(), so config is guaranteed once state is 'done'
  const config = rootStore.config;
  if (rootStore.state !== 'done' || !config) {
    // A failed startup is recoverable — offer the retry instead of stranding
    // the user on a dead screen until they reopen the popup
    return (
      <div className="startup-error" role="alert">
        <p>{chrome.i18n.getMessage('OV_FL_ERROR')}</p>
        <button type="button" onClick={() => rootStore.retryInit()}>
          {chrome.i18n.getMessage('errorRetry')}
        </button>
      </div>
    );
  }

  let fileList: ReactNode = null;
  if (rootStore.fileList) {
    fileList = <FileListTable key={rootStore.fileList.id} />;
  }

  const uiUpdateInterval = config.uiUpdateInterval;

  let goInOptions: ReactNode = null;
  if (config.hostname === '') {
    goInOptions = <GoInOptions isPopup={rootStore.isPopup} />;
  }

  return (
    <>
      {/* Unmounted while the tab is hidden, so a backgrounded full-page view
          stops polling the daemon; remounting fires an immediate refresh. */}
      <VisiblePage>
        <Interval onFire={onIntervalFire} interval={uiUpdateInterval} />
      </VisiblePage>
      <Menu />
      <TorrentListTable />
      <Footer />
      {fileList}
      <Dialogs />
      {goInOptions}
    </>
  );
});

const Dialogs = observer(() => {
  const rootStore = useRootStore();

  return (
    <>
      {Array.from(rootStore.dialogs.values()).map((dialog) => {
        // putFiles needs to wait for isReady
        if (dialog.type === 'putFiles' && !dialog.isReady) {
          return null;
        }
        return <DialogLoader key={dialog.id} type={dialog.type} dialogStore={dialog} />;
      })}
    </>
  );
});

interface GoInOptionsProps {
  isPopup: boolean;
}

const GoInOptions = memo<GoInOptionsProps>(({ isPopup }) => {
  const handleOpenOptions = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  useEffect(() => {
    // Only redirect if not in popup (e.g., opened in a tab)
    if (!isPopup) {
      location.href = '/options.html#/#redirect';
    }
  }, [isPopup]);

  // In popup mode, show a message instead of redirecting
  if (isPopup) {
    return (
      <div className="go-in-options">
        <div className="go-in-options-content">
          <h2>{chrome.i18n.getMessage('configureClient')}</h2>
          <p>{chrome.i18n.getMessage('configureClientHint')}</p>
          <button onClick={handleOpenOptions}>{chrome.i18n.getMessage('openOptions')}</button>
        </div>
      </div>
    );
  }

  return null;
});

declare global {
  interface Window {
    rootStore: ReturnType<typeof RootStore.create>;
  }
}

const rootStore = (window.rootStore = RootStore.create());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
createRoot(rootElement).render(
  <RootStoreCtx.Provider value={rootStore}>
    <ErrorBoundary>
      <Index />
    </ErrorBoundary>
  </RootStoreCtx.Provider>
);
