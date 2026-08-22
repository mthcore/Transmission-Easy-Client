import React, { useCallback, useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import { observer } from 'mobx-react';
import ComponentLoader from '../ComponentLoader';
import showError from '../../tools/showError';
import VisiblePage from '../VisiblePage';
import useRootStore from '../../hooks/useRootStore';
import SearchBox from '../SearchBox';
import LabelSelect from '../LabelSelect';

const Menu = observer(() => {
  const rootStore = useRootStore();
  const [showDropLayer, setShowDropLayer] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const refFileInput = useRef<HTMLInputElement>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const client = rootStore?.client;
  const config = rootStore?.config;
  const isRefreshing = rootStore?.isRefreshing ?? false;

  const onPutFiles = useCallback(
    (files: FileList) => {
      if (!files.length || !rootStore) return;

      const dialog = rootStore.createDialog({
        type: 'putFiles',
      }) as unknown as { setFiles: (files: File[]) => void; setReady: (ready: boolean) => void };

      dialog.setFiles(Array.from(files));
      dialog.setReady(true);
    },
    [rootStore]
  );

  const handleDropOver = useCallback((e: DragEvent<HTMLBodyElement> | globalThis.DragEvent) => {
    if (e.dataTransfer?.types.length === 2) return;
    e.preventDefault();

    setShowDropLayer(true);

    if (dropTimerRef.current) {
      clearTimeout(dropTimerRef.current);
    }
    dropTimerRef.current = setTimeout(() => {
      if (!refFileInput.current) return;
      setShowDropLayer(false);
      setIsDropped(false);
    }, 300);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLBodyElement> | globalThis.DragEvent) => {
      e.preventDefault();
      setIsDropped(true);
      if (e.dataTransfer?.files) {
        onPutFiles(e.dataTransfer.files);
      }
    },
    [onPutFiles]
  );

  useEffect(() => {
    const dropOverHandler = (e: globalThis.DragEvent) => handleDropOver(e);
    const dropHandler = (e: globalThis.DragEvent) => handleDrop(e);

    document.body.addEventListener('dragover', dropOverHandler);
    document.body.addEventListener('drop', dropHandler);

    return () => {
      document.body.removeEventListener('dragover', dropOverHandler);
      document.body.removeEventListener('drop', dropHandler);
      if (dropTimerRef.current) {
        clearTimeout(dropTimerRef.current);
      }
    };
  }, [handleDropOver, handleDrop]);

  const handleRefresh = useCallback(async () => {
    if (!rootStore || isRefreshing) return;
    rootStore.setRefreshing(true);
    try {
      await Promise.all([
        client?.updateTorrentList(true).catch((err) => {
          showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to refresh', err);
        }),
        client?.updateSettings().catch((err) => {
          showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Failed to update settings', err);
        }),
      ]);
    } finally {
      rootStore.setRefreshing(false);
    }
  }, [client, rootStore, isRefreshing]);

  const handleAddFile = useCallback(() => {
    refFileInput.current?.dispatchEvent(new MouseEvent('click'));
  }, []);

  // Ctrl+O lives here, next to the hidden file input: creating a bare
  // 'putFiles' dialog from the page shortcut handler produced an invisible
  // never-ready dialog (the renderer waits for isReady) instead of a picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      // Same guard as the page-level shortcuts: opening a file picker on top of
      // a modal (and stacking a second dialog behind it) is never wanted
      if (rootStore?.dialogs.size) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleAddFile();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleAddFile, rootStore]);

  const handleAddUrl = useCallback(() => {
    rootStore?.createDialog({
      type: 'putUrl',
    });
  }, [rootStore]);

  const handleStartAll = useCallback(() => {
    const ids = client?.torrentIds;
    if (ids && client) {
      client.torrentsStart(ids);
    }
  }, [client]);

  const handleStopAll = useCallback(() => {
    const ids = client?.torrentIds;
    if (ids && client) {
      client.torrentsStop(ids);
    }
  }, [client]);

  const handleToggleAltSpeed = useCallback(() => {
    if (client?.settings) {
      client.setAltSpeedEnabled(!client.settings.altSpeedEnabled);
    }
  }, [client]);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (refFileInput.current?.files) {
        onPutFiles(refFileInput.current.files);
      }
      e.currentTarget.value = '';
    },
    [onPutFiles]
  );

  if (!config) return null;

  let dropLayer: React.ReactNode = null;
  if (showDropLayer) {
    const classList = ['drop_layer'];
    if (isDropped) {
      classList.push('dropped');
    }
    dropLayer = <div className={classList.join(' ')} />;
  }

  let graph: React.ReactNode = null;
  if (config.showSpeedGraph && client) {
    graph = (
      <VisiblePage>
        <ComponentLoader load-page={'graph'} />
      </VisiblePage>
    );
  }

  const altSpeedClassList = ['btn alt_speed'];
  if (client && client.settings) {
    if (client.settings.altSpeedEnabled) {
      altSpeedClassList.push('active');
    }
  }

  return (
    <>
      <ul className="menu">
        <li>
          <button
            onClick={handleRefresh}
            title={chrome.i18n.getMessage('refresh')}
            className="btn refresh"
            aria-label={chrome.i18n.getMessage('refresh')}
            type="button"
            disabled={isRefreshing}
          />
        </li>
        <li>
          <a
            href={config.webUiUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={chrome.i18n.getMessage('ST_CAPT_WEBUI')}
            aria-label={chrome.i18n.getMessage('ST_CAPT_WEBUI')}
            className="btn wui"
          />
        </li>
        <li className="separate" />
        <li>
          <button
            onClick={handleAddFile}
            title={chrome.i18n.getMessage('Open_file')}
            className="btn add_file"
            aria-label={chrome.i18n.getMessage('Open_file')}
            type="button"
          />
          <input
            ref={refFileInput}
            onChange={handleFileChange}
            type="file"
            accept="application/x-bittorrent"
            multiple
            style={{ display: 'none' }}
          />
        </li>
        <li>
          <button
            onClick={handleAddUrl}
            title={chrome.i18n.getMessage('MM_FILE_ADD_URL')}
            aria-label={chrome.i18n.getMessage('MM_FILE_ADD_URL')}
            className="btn add_magnet"
            type="button"
          />
        </li>
        <li className="separate" />
        <li>
          <button
            onClick={handleToggleAltSpeed}
            title={chrome.i18n.getMessage('altSpeedEnable')}
            aria-label={chrome.i18n.getMessage('altSpeedEnable')}
            className={altSpeedClassList.join(' ')}
            type="button"
          />
        </li>
        <li className="separate" />
        <li>
          <button
            onClick={handleStartAll}
            title={chrome.i18n.getMessage('STM_TORRENTS_RESUMEALL')}
            aria-label={chrome.i18n.getMessage('STM_TORRENTS_RESUMEALL')}
            className="btn start_all"
            type="button"
          />
        </li>
        <li>
          <button
            onClick={handleStopAll}
            title={chrome.i18n.getMessage('STM_TORRENTS_PAUSEALL')}
            aria-label={chrome.i18n.getMessage('STM_TORRENTS_PAUSEALL')}
            className="btn pause_all"
            type="button"
          />
        </li>
        <li className="graph">{graph}</li>
        <SearchBox />
        <LabelSelect />
      </ul>

      {dropLayer}
    </>
  );
});

export default Menu;
