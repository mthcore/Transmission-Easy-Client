import React, { useCallback, type ChangeEvent } from 'react';
import { observer } from 'mobx-react';
import { useOptionsPage } from '../../hooks/useOptionsPage';
import SettingToggle from '../../components/SettingToggle';

interface ConfigStore {
  theme: string;
  showFreeSpace: boolean;
  hideSeedingTorrents: boolean;
  hideFinishedTorrents: boolean;
  showSpeedGraph: boolean;
  uiUpdateInterval: number;
  setTheme: (theme: string) => void;
}

const UiOptions = observer(() => {
  const { configStore, handleChange, handleSetInt, handleIntBlur } = useOptionsPage<ConfigStore>();

  const handleThemeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      configStore.setTheme(e.target.value);
    },
    [configStore]
  );

  return (
    <div className="page main">
      <h2>{chrome.i18n.getMessage('optMain')}</h2>
      <label>
        <span>{chrome.i18n.getMessage('theme')}</span>
        <select value={configStore.theme} onChange={handleThemeChange}>
          <option value="system">{chrome.i18n.getMessage('themeSystem')}</option>
          <option value="light">{chrome.i18n.getMessage('themeLight')}</option>
          <option value="dark">{chrome.i18n.getMessage('themeDark')}</option>
        </select>
      </label>
      <SettingToggle
        label="showFreeSpace"
        onChange={handleChange}
        name="showFreeSpace"
        defaultChecked={configStore.showFreeSpace}
      />
      <SettingToggle
        label="hideSeedStatusItem"
        onChange={handleChange}
        name="hideSeedingTorrents"
        defaultChecked={configStore.hideSeedingTorrents}
      />
      <SettingToggle
        label="hideFinishStatusItem"
        onChange={handleChange}
        name="hideFinishedTorrents"
        defaultChecked={configStore.hideFinishedTorrents}
      />
      <SettingToggle
        label="showSpeedGraph"
        onChange={handleChange}
        name="showSpeedGraph"
        defaultChecked={configStore.showSpeedGraph}
      />
      <label>
        <span>{chrome.i18n.getMessage('popupUpdateInterval')}</span>
        <input
          onChange={handleSetInt}
          onBlur={handleIntBlur}
          name="uiUpdateInterval"
          type="number"
          min="100"
          defaultValue={configStore.uiUpdateInterval}
        />{' '}
        <span>{chrome.i18n.getMessage('ms')}</span>
      </label>
    </div>
  );
});

export default UiOptions;
