import React, {
  useRef,
  useState,
  useCallback,
  type FormEventHandler,
  type MouseEvent,
  type ChangeEvent,
} from 'react';
import { observer } from 'mobx-react';
import { useOptionsPage } from '../../hooks/useOptionsPage';
import type { Folder } from '../../types/bg';
import SettingToggle from '../../components/SettingToggle';

interface ConfigStore {
  folders: Folder[];
  treeViewContextMenu: boolean;
  putDefaultPathInContextMenu: boolean;
  selectDownloadCategoryAfterPutTorrentFromContextMenu: boolean;
  hasFolder: (path: string) => boolean;
  addFolder: (path: string, name: string) => void;
  removeFolders: (folders: Folder[]) => void;
  moveFolders: (folders: Folder[], direction: number) => void;
}

interface CtxOptionsDirsFormElements extends HTMLFormControlsCollection {
  path: HTMLInputElement;
  name: HTMLInputElement;
}

interface CtxOptionsDirsFormElement extends HTMLFormElement {
  elements: CtxOptionsDirsFormElements;
}

interface CtxOptionsDirsProps {
  configStore: ConfigStore;
  handleChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const CtxOptionsDirs = observer(({ configStore, handleChange }: CtxOptionsDirsProps) => {
  const refDirectorySelect = useRef<HTMLSelectElement>(null);

  const getSelectedDirectories = useCallback(() => {
    if (!refDirectorySelect.current) return [];
    return Array.from(refDirectorySelect.current.selectedOptions).map((option) => {
      return configStore.folders[parseInt(option.value, 10)];
    });
  }, [configStore]);

  const [addError, setAddError] = useState('');
  // Editing the path invalidates the duplicate warning: leaving it up left a
  // red "already in the list" under a path that was no longer in the list
  const clearAddError = useCallback(() => setAddError(''), []);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (e) => {
      e.preventDefault();
      const form = e.currentTarget as CtxOptionsDirsFormElement;

      // Trailing slashes are stripped ('/' itself excepted): '/data/x' and
      // '/data/x/' passed the exact-string duplicate check as "different" and
      // then collapsed to one entry in the context-menu folder tree
      let path = form.elements.path.value.trim();
      // 'C:' is a different location from 'C:' + separator on Windows (the
      // former means "the process's current directory on C"), so a drive root
      // keeps its separator
      const isDriveRoot = /^[a-zA-Z]:[\\/]$/.test(path);
      if (path.length > 1 && !isDriveRoot) {
        path = path.replace(/[/\\]+$/, '') || path;
      }
      const name = form.elements.name.value.trim();
      if (!path) return;

      if (configStore.hasFolder(path)) {
        // A silent no-op looked like a broken Add button
        setAddError(
          chrome.i18n.getMessage('folderAlreadyExists') || 'This folder is already in the list'
        );
        return;
      }
      setAddError('');
      configStore.addFolder(path, name);
      form.elements.path.value = '';
      form.elements.name.value = '';
    },
    [configStore]
  );

  const handleRemove = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      configStore.removeFolders(getSelectedDirectories());
    },
    [configStore, getSelectedDirectories]
  );

  const handleMoveUp = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      configStore.moveFolders(getSelectedDirectories(), -1);
    },
    [configStore, getSelectedDirectories]
  );

  const handleMoveDown = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      configStore.moveFolders(getSelectedDirectories(), 1);
    },
    [configStore, getSelectedDirectories]
  );

  const directories = configStore.folders.map((folder: Folder, index: number) => {
    let name = folder.path;
    if (folder.name) {
      name = `${folder.name} (${name})`;
    }
    return (
      <option key={JSON.stringify(folder)} value={index}>
        {name}
      </option>
    );
  });

  return (
    <div className="dir-manager">
      <h3>{chrome.i18n.getMessage('dirList')}</h3>
      <p className="section-hint">{chrome.i18n.getMessage('dirListHint')}</p>
      <form onSubmit={handleSubmit} autoComplete="off" className="dir-form">
        <div className="dir-form-row">
          <input
            name="path"
            type="text"
            required
            onChange={clearAddError}
            placeholder={chrome.i18n.getMessage('subPath')}
          />
          <input name="name" type="text" placeholder={chrome.i18n.getMessage('shortName')} />
          <button type="submit">{chrome.i18n.getMessage('add')}</button>
        </div>
        {addError && <p className="red">{addError}</p>}
      </form>
      <div className="dir-list-container">
        <select ref={refDirectorySelect} id="folderList" multiple>
          {directories}
        </select>
        <div className="dir-list-actions">
          <button type="button" onClick={handleMoveUp} title={chrome.i18n.getMessage('up')}>
            ▲
          </button>
          <button type="button" onClick={handleMoveDown} title={chrome.i18n.getMessage('down')}>
            ▼
          </button>
          <button
            type="button"
            onClick={handleRemove}
            title={chrome.i18n.getMessage('deleteSelected')}
          >
            ✕
          </button>
        </div>
      </div>
      <h3>{chrome.i18n.getMessage('options')}</h3>
      <SettingToggle
        label="treeViewContextMenu"
        onChange={handleChange}
        defaultChecked={configStore.treeViewContextMenu}
        name="treeViewContextMenu"
      />
      <SettingToggle
        label="showDefaultFolderContextMenuItem"
        onChange={handleChange}
        defaultChecked={configStore.putDefaultPathInContextMenu}
        name="putDefaultPathInContextMenu"
      />
      <SettingToggle
        label="selectDownloadCategoryOnAddItemFromContextMenu"
        onChange={handleChange}
        defaultChecked={configStore.selectDownloadCategoryAfterPutTorrentFromContextMenu}
        name="selectDownloadCategoryAfterPutTorrentFromContextMenu"
      />
    </div>
  );
});

const CtxOptions = observer(() => {
  const { configStore, handleChange } = useOptionsPage<ConfigStore>();

  return (
    <div className="page ctx">
      <h2>{chrome.i18n.getMessage('optCtx')}</h2>
      <CtxOptionsDirs configStore={configStore} handleChange={handleChange} />
    </div>
  );
});

export default CtxOptions;
