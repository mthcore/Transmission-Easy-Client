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
import getLogger from '../tools/getLogger';
import RootStoreCtx from '../tools/rootStoreCtx';
import useRootStore from '../hooks/useRootStore';
import { useTheme } from '../hooks/useTheme';
import DialogLoader from '../components/dialogs/DialogLoader';

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
      // Skip if focus in input/textarea
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      // Escape - close dialogs/filelist
      if (e.key === 'Escape') {
        if (rootStore.dialogs.size) {
          const lastId = Array.from(rootStore.dialogs.keys()).pop();
          if (lastId) rootStore.destroyDialog(lastId);
        } else if (rootStore.fileList) {
          rootStore.destroyFileList();
        }
        return;
      }

      if (!rootStore.client) return;

      // R - Refresh
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        rootStore.client.updateTorrentList(true);
        rootStore.client.updateSettings();
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
      if (e.key === 'Enter' && rootStore.torrentList.selectedIds.length) {
        const ids = rootStore.torrentList.selectedIds;
        const firstTorrent = rootStore.client.torrents.get(ids[0]);
        if (firstTorrent?.isActive) {
          rootStore.client.torrentsStop(ids);
        } else {
          rootStore.client.torrentsStart(ids);
        }
        return;
      }

      // Ctrl+O - Add torrent file
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        rootStore.createDialog({ type: 'putFiles' });
        return;
      }

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
          rootStore.createDialog({
            type: 'move',
            directory: torrent?.directory,
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

      // Ctrl+Shift+S - Stop all
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        rootStore.client.torrentsStop(rootStore.client.torrentIds);
        return;
      }

      // Ctrl+Shift+R - Start all
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
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

  const onIntervalFire = useCallback(
    (isInit: boolean) => {
      if (!rootStore.client) return;
      if (isInit) {
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
    return <>{`Loading: ${rootStore.state}`}</>;
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
      <Interval onFire={onIntervalFire} interval={uiUpdateInterval} />
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
    <Index />
  </RootStoreCtx.Provider>
);
