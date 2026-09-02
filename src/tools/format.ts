import { filesize } from 'filesize';

const sizeList: string[] = JSON.parse(chrome.i18n.getMessage('sizeList'));
const sizePsList: string[] = JSON.parse(chrome.i18n.getMessage('sizePsList'));

/**
 * The unit the daemon's own speed limits are expressed in. Taken from the
 * localised unit list rather than hard-coded, so a field labelled with it
 * matches the speeds displayed everywhere else.
 */
export const KILOBYTES_PER_SECOND = sizePsList[1] ?? 'kB/s';

export const formatBytes = (bytes: number): string => {
  return filesize(bytes, { fullform: true, fullforms: sizeList }) as string;
};

export const formatSpeed = (bytes: number): string => {
  return filesize(bytes, { fullform: true, fullforms: sizePsList }) as string;
};

export function speedToStr(speed: number): string {
  if (!Number.isFinite(speed)) {
    return '';
  }
  return formatSpeed(speed);
}
