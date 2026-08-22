import React, { useState, useCallback, useRef, type FormEventHandler, type ReactNode } from 'react';
import { observer } from 'mobx-react';
import { useLocation } from 'react-router-dom';
import useRootStore from '../../hooks/useRootStore';
import callApi from '../../tools/callApi';

interface FormElements extends HTMLFormControlsCollection {
  login: HTMLInputElement;
  password: HTMLInputElement;
  hostname: HTMLInputElement;
  port: HTMLInputElement;
  ssl: HTMLInputElement;
  pathname: HTMLInputElement;
  webPathname: HTMLInputElement;
  authenticationRequired: HTMLInputElement;
}

interface ClientFormElement extends HTMLFormElement {
  elements: FormElements;
}

type ClientStatus = 'pending' | 'done' | 'error' | null;

const ClientOptions = observer(() => {
  const rootStore = useRootStore();
  const configStore = rootStore.config;
  const location = useLocation();
  const refPage = useRef<HTMLDivElement>(null);

  const [clientStatus, setClientStatus] = useState<ClientStatus>(null);
  const [clientStatusText, setClientStatusText] = useState('');
  const [sslChecked, setSslChecked] = useState(configStore?.ssl ?? true);
  const [authChecked, setAuthChecked] = useState(configStore?.authenticationRequired ?? false);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (e) => {
      e.preventDefault();
      if (!configStore) return;
      const form = e.currentTarget as ClientFormElement;
      const login = form.elements.login.value;
      const password = form.elements.password.value;
      let hostname = form.elements.hostname.value.trim();
      // valueAsNumber, not parseInt: '1e3' is legal in a number input and
      // parseInt read it as 1 — the config was then saved with port 1 before
      // any check could complain
      const rawPort = form.elements.port.valueAsNumber;
      let port = Number.isFinite(rawPort) ? Math.trunc(rawPort) : NaN;
      let ssl = form.elements.ssl.checked;
      const pathname = form.elements.pathname.value.trim();
      const webPathname = form.elements.webPathname.value.trim();
      const authenticationRequired = form.elements.authenticationRequired.checked;

      // A pasted 'http://nas.local:9091' used to be bracketed like an IPv6
      // literal into https://[http://nas.local]:9091/… — normalize instead of
      // saving a hostname that can never work
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostname)) {
        try {
          const parsed = new URL(hostname);
          hostname = parsed.hostname.replace(/^\[|\]$/g, '');
          if (parsed.port) port = parseInt(parsed.port, 10);
          if (parsed.protocol === 'https:') ssl = true;
          else if (parsed.protocol === 'http:') ssl = false;
        } catch {
          // Fall through: the range check below reports it
        }
      } else {
        // 'nas.local:9091' (exactly one colon, numeric suffix — an unbracketed
        // IPv6 literal has several colons)
        const hostPort = hostname.match(/^([^:]+):(\d{1,5})$/);
        if (hostPort) {
          hostname = hostPort[1];
          port = parseInt(hostPort[2], 10);
        }
      }

      setClientStatus('pending');
      try {
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          throw new Error(chrome.i18n.getMessage('portIncorrect'));
        }
        await configStore.setOptions({
          login,
          password,
          hostname,
          port,
          ssl,
          pathname,
          webPathname,
          authenticationRequired,
        });
        if (!refPage.current) return;
        // Direct message, not the mirror store: a missing mirror used to skip
        // the check silently and show a green OK for an unverified config
        await callApi({ action: 'updateSettings' });
        if (!refPage.current) return;
        setClientStatus('done');

        if (location.hash === '#redirect') {
          window.location.href = '/index.html';
        } else if (location.hash === '#redirectPopup') {
          window.location.href = '/index.html#popup';
        }
      } catch (err) {
        if (!refPage.current) return;
        setClientStatus('error');
        const error = err as Error;
        setClientStatusText(`${error.name}: ${error.message}`);
      }
    },
    [configStore, location]
  );

  if (!configStore) {
    return (
      <div ref={refPage} className="page client">
        <div className="loading-inline" />
      </div>
    );
  }

  let status: ReactNode = null;
  if (clientStatus) {
    switch (clientStatus) {
      case 'pending': {
        status = (
          <div>
            <div className="loading-inline" />
          </div>
        );
        break;
      }
      case 'done': {
        status = (
          <div>
            <span className="green">{chrome.i18n.getMessage('DLG_BTN_OK')}</span>
          </div>
        );
        break;
      }
      case 'error': {
        status = (
          <div>
            <span className="red">{clientStatusText}</span>
          </div>
        );
        break;
      }
    }
  }

  return (
    <div ref={refPage} className="page client">
      <form onSubmit={handleSubmit} autoComplete="off">
        <h2>{chrome.i18n.getMessage('optClient')}</h2>
        <label>
          <span>{chrome.i18n.getMessage('DLG_SETTINGS_4_CONN_16')}</span>
          <input name="login" type="text" defaultValue={configStore.login} />
        </label>
        <label>
          <span>{chrome.i18n.getMessage('DLG_SETTINGS_4_CONN_18')}</span>
          <input name="password" type="password" defaultValue={configStore.password} />
        </label>
        <label>
          <span>{chrome.i18n.getMessage('PRS_COL_IP')}</span>
          <input
            name="hostname"
            type="text"
            defaultValue={configStore.hostname}
            placeholder="127.0.0.1"
            required
          />
        </label>
        <label>
          <span>{chrome.i18n.getMessage('PRS_COL_PORT')}</span>
          <input name="port" type="number" defaultValue={configStore.port} required />
        </label>
        <h3>{chrome.i18n.getMessage('ST_CAPT_ADVANCED')}</h3>
        <label>
          <span>{chrome.i18n.getMessage('requireAuthentication')}</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              name="authenticationRequired"
              checked={authChecked}
              onChange={(e) => setAuthChecked(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </span>
        </label>
        <label>
          <span>{chrome.i18n.getMessage('guiPath')}</span>
          <input type="text" name="webPathname" defaultValue={configStore.webPathname} />
        </label>
        <label>
          <span>{chrome.i18n.getMessage('useSSL')}</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              name="ssl"
              checked={sslChecked}
              onChange={(e) => setSslChecked(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </span>
        </label>
        {authChecked && !sslChecked && (
          <p className="red">{chrome.i18n.getMessage('warningBasicAuthNoSsl')}</p>
        )}
        <label>
          <span>{chrome.i18n.getMessage('path')}</span>
          <input type="text" name="pathname" defaultValue={configStore.pathname} />
        </label>
        <div id="checkContainer">
          <div>
            <button type="submit">{chrome.i18n.getMessage('DLG_BTN_APPLY')}</button>
          </div>
          {status}
        </div>
      </form>
    </div>
  );
});

export default ClientOptions;
