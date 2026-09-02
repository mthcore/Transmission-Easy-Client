import React, { useCallback, MouseEvent } from 'react';
import { observer } from 'mobx-react';
import SpeedContextMenu from './menu/SpeedMenu';
import SpaceWatcher from './SpaceWatcher';
import useRootStore from '../hooks/useRootStore';
import report from '../tools/reportAction';

const Footer = observer(() => {
  const rootStore = useRootStore();

  const handleResetDownloadSpeed = useCallback(
    (e: MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      const client = rootStore?.client;
      if (!client) return;
      // Fire and forget: without report() a refusal left the limit in place,
      // the badge in place, and nothing to say the click had not worked.
      if (client.settings?.altSpeedEnabled) {
        report(client.setAltSpeedEnabled(false));
      } else {
        report(client.setDownloadSpeedLimitEnabled(false));
      }
    },
    [rootStore]
  );

  const handleResetUploadSpeed = useCallback(
    (e: MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      const client = rootStore?.client;
      if (!client) return;
      if (client.settings?.altSpeedEnabled) {
        report(client.setAltSpeedEnabled(false));
      } else {
        report(client.setUploadSpeedLimitEnabled(false));
      }
    },
    [rootStore]
  );

  const handleOpenTab = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${location.origin}${location.pathname}` });
  }, []);

  if (!rootStore.client || !rootStore.config) return null;

  const client = rootStore.client;
  const config = rootStore.config;

  const { downloadSpeedStr, uploadSpeedStr } = client.currentSpeedStr ?? {
    downloadSpeedStr: '',
    uploadSpeedStr: '',
  };
  const { downloadedStr, uploadedStr } = client.sessionTotalsStr ?? {
    downloadedStr: '',
    uploadedStr: '',
  };

  let downloadLimit: React.ReactNode = null;
  let uploadLimit: React.ReactNode = null;
  const settings = client.settings;

  if (settings) {
    if (settings.altSpeedEnabled || settings.downloadSpeedLimitEnabled) {
      const speedStr = settings.altSpeedEnabled
        ? settings.altDownloadSpeedLimitStr
        : settings.downloadSpeedLimitStr;
      downloadLimit = (
        <span onClick={handleResetDownloadSpeed} className="limit dl">
          {speedStr}
        </span>
      );
    }
    if (settings.altSpeedEnabled || settings.uploadSpeedLimitEnabled) {
      const speedStr = settings.altSpeedEnabled
        ? settings.altUploadSpeedLimitStr
        : settings.uploadSpeedLimitStr;
      uploadLimit = (
        <span onClick={handleResetUploadSpeed} className="limit up">
          {speedStr}
        </span>
      );
    }
  }

  let openInTab: React.ReactNode = null;
  if (rootStore.isPopup) {
    openInTab = (
      <div
        onClick={handleOpenTab}
        className="openInTab"
        title={chrome.i18n.getMessage('openInTab')}
      />
    );
  }

  let spaceWatcher: React.ReactNode = null;
  if (config.showFreeSpace) {
    spaceWatcher = <SpaceWatcher />;
  }

  const torrentCounts = client.torrentCountsStr;

  return (
    <div className="status-panel" role="contentinfo">
      {spaceWatcher}
      {torrentCounts && (
        <span className="torrent-counts" title={torrentCounts}>
          {torrentCounts}
        </span>
      )}
      <span className="session-totals" title={chrome.i18n.getMessage('sessionTotals')}>
        <span className="total-dl">{downloadedStr}</span>
        <span className="total-up">{uploadedStr}</span>
      </span>
      <SpeedContextMenu type="download">
        <span className="speed download" aria-live="polite">
          {downloadSpeedStr}
          {downloadLimit}
        </span>
      </SpeedContextMenu>
      <SpeedContextMenu type="upload">
        <span className="speed upload" aria-live="polite">
          {uploadSpeedStr}
          {uploadLimit}
        </span>
      </SpeedContextMenu>
      {client.lastErrorMessage && (
        <span
          className="status"
          role="status"
          aria-live="assertive"
          title={client.lastErrorMessage}
        >
          {client.lastErrorMessage}
        </span>
      )}
      {openInTab}
    </div>
  );
});

export default Footer;
