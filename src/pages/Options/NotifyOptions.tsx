import React, { useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react';
import { RgbColorPicker, RgbColor } from 'react-colorful';
import { Popover } from 'react-tiny-popover';
import { useOptionsPage } from '../../hooks/useOptionsPage';
import SettingToggle from '../../components/SettingToggle';

interface ConfigStore {
  showDownloadCompleteNotifications: boolean;
  showActiveCountBadge: boolean;
  badgeColor: string;
  backgroundUpdateInterval: number;
  setOptions: (options: Record<string, unknown>) => void;
}

function parseBadgeColor(badgeColor: string): RgbColor {
  const [r, g, b] = badgeColor.split(',');
  return {
    r: parseInt(r, 10) || 0,
    g: parseInt(g, 10) || 0,
    b: parseInt(b, 10) || 0,
  };
}

function parseBadgeAlpha(badgeColor: string): number {
  const alpha = parseFloat(badgeColor.split(',')[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}

function rgbToStorageString(color: RgbColor, alpha: number): string {
  return [color.r, color.g, color.b, alpha].join(',');
}

const NotifyOptions = observer(() => {
  const { configStore, handleChange, handleSetInt, handleIntBlur } = useOptionsPage<ConfigStore>();
  const [colorPickerOpened, setColorPickerOpened] = useState(false);
  const [pickerColor, setPickerColor] = useState<RgbColor>(() =>
    parseBadgeColor(configStore.badgeColor)
  );
  const pickerColorRef = useRef(pickerColor);

  // Tracks whether the user actually picked a colour: closing the picker
  // untouched used to commit anyway, rewriting the default's 0.40 alpha to 1
  const colorTouchedRef = useRef(false);

  const handleColorChange = useCallback((color: RgbColor) => {
    colorTouchedRef.current = true;
    pickerColorRef.current = color;
    setPickerColor(color);
  }, []);

  const handleOpenColorPicker = useCallback(() => {
    const color = parseBadgeColor(configStore.badgeColor);
    colorTouchedRef.current = false;
    pickerColorRef.current = color;
    setPickerColor(color);
    setColorPickerOpened(true);
  }, [configStore]);

  const handleCloseColorPicker = useCallback(() => {
    setColorPickerOpened(false);
    if (!colorTouchedRef.current) return;
    // Preserve the configured alpha — the picker only edits RGB
    const alpha = parseBadgeAlpha(configStore.badgeColor);
    configStore.setOptions({ badgeColor: rgbToStorageString(pickerColorRef.current, alpha) });
  }, [configStore]);

  return (
    <div className="page notify">
      <h2>{chrome.i18n.getMessage('optNotify')}</h2>
      <SettingToggle
        label="showNotificationOnDownloadComplete"
        defaultChecked={configStore.showDownloadCompleteNotifications}
        onChange={handleChange}
        name="showDownloadCompleteNotifications"
      />
      <SettingToggle
        label="displayActiveTorrentCountIcon"
        defaultChecked={configStore.showActiveCountBadge}
        onChange={handleChange}
        name="showActiveCountBadge"
      />
      <label>
        <span>{chrome.i18n.getMessage('badgeColor')}</span>
        <Popover
          isOpen={colorPickerOpened}
          onClickOutside={handleCloseColorPicker}
          positions={['bottom']}
          content={<RgbColorPicker color={pickerColor} onChange={handleColorChange} />}
        >
          <span
            onClick={colorPickerOpened ? handleCloseColorPicker : handleOpenColorPicker}
            className="selectColor"
            style={{ backgroundColor: `rgb(${pickerColor.r},${pickerColor.g},${pickerColor.b})` }}
          />
        </Popover>
      </label>
      <label>
        <span>{chrome.i18n.getMessage('backgroundUpdateInterval')}</span>
        {/* MV3 alarms floor at one minute: offering 1000ms promised a
            granularity the platform cannot deliver — every value from 1000 to
            59999 silently behaved as 60000 */}
        <input
          defaultValue={configStore.backgroundUpdateInterval}
          onChange={handleSetInt}
          onBlur={handleIntBlur}
          type="number"
          name="backgroundUpdateInterval"
          min="60000"
          step="60000"
        />{' '}
        <span>{chrome.i18n.getMessage('ms')}</span>
      </label>
    </div>
  );
});

export default NotifyOptions;
