import '../../assets/css/options.scss';
import React, { useEffect } from 'react';
import RootStore from '../../stores/RootStore';
import { createRoot } from 'react-dom/client';
import { observer } from 'mobx-react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import RootStoreCtx from '../../tools/rootStoreCtx';
import useRootStore from '../../hooks/useRootStore';
import { useTheme } from '../../hooks/useTheme';
import applyStoredTheme, { applyLocaleDirection } from '../../tools/applyStoredTheme';
import ClientOptions from './ClientOptions';
import UiOptions from './UiOptions';
import NotifyOptions from './NotifyOptions';
import CtxOptions from './CtxOptions';
import BackupRestoreOptions from './BackupRestoreOptions';
import ServerOptions from './ServerOptions';

// Before React renders, so an explicit theme doesn't flash the OS one first
applyStoredTheme();
applyLocaleDirection();

const Options = observer(() => {
  const rootStore = useRootStore();
  useTheme(rootStore.config);

  useEffect(() => {
    rootStore.init();

    if (rootStore.isPopup) {
      document.body.classList.add('popup');
    }
  }, [rootStore]);

  if (rootStore.state === 'pending') {
    return <div className="loading" />;
  }

  if (rootStore.state !== 'done') {
    return <>{`Loading: ${rootStore.state}`}</>;
  }

  return (
    <div className="container">
      <div className="search_panel">
        <h1>{chrome.i18n.getMessage('appName')}</h1>
      </div>
      <HashRouter>
        <div className="content">
          <div className="left menu">
            <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')} end>
              {chrome.i18n.getMessage('optClient')}
            </NavLink>
            <NavLink to="/main" className={({ isActive }) => (isActive ? 'active' : '')}>
              {chrome.i18n.getMessage('optMain')}
            </NavLink>
            <NavLink to="/notify" className={({ isActive }) => (isActive ? 'active' : '')}>
              {chrome.i18n.getMessage('optNotify')}
            </NavLink>
            <NavLink to="/ctx" className={({ isActive }) => (isActive ? 'active' : '')}>
              {chrome.i18n.getMessage('optCtx')}
            </NavLink>
            <NavLink to="/server" className={({ isActive }) => (isActive ? 'active' : '')}>
              {chrome.i18n.getMessage('optServer')}
            </NavLink>
            <NavLink to="/backup" className={({ isActive }) => (isActive ? 'active' : '')}>
              {chrome.i18n.getMessage('backupRestore')}
            </NavLink>
          </div>
          <div className="right">
            <Routes>
              <Route path="/" element={<ClientOptions />} />
              <Route path="/main" element={<UiOptions />} />
              <Route path="/notify" element={<NotifyOptions />} />
              <Route path="/ctx" element={<CtxOptions />} />
              <Route path="/server" element={<ServerOptions />} />
              <Route path="/backup" element={<BackupRestoreOptions />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </div>
      </HashRouter>
      <footer className="bottom">
        <a
          href="https://github.com/mthcore/transmission_extension"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
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
    <Options />
  </RootStoreCtx.Provider>
);
