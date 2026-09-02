import React, { ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import report from '../../tools/reportAction';
import { useContextMenuSelection } from '../../hooks/useContextMenuSelection';
import type { FileEntry } from '../../types/stores';

interface FileContextMenuProps {
  children: ReactNode;
  fileId: string;
}

interface FileListStore {
  selectedIds: (string | number)[];
  resetSelectedIds: () => void;
  addSelectedId: (id: string | number) => void;
  getFileById: (id: string) => FileEntry | undefined;
  id: number;
  selectedIndexes: number[];
  visibleIndexes: number[];
  filter: string;
}

const FileContextMenu = observer(({ children, fileId }: FileContextMenuProps) => {
  const rootStore = useRootStore();
  const fileListStore = rootStore?.fileList as FileListStore | undefined;
  const handleOpenChange = useContextMenuSelection(fileListStore, fileId);

  return (
    <ContextMenu.Root onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <FileMenuContent />
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

const FileMenuContent = observer(() => {
  const rootStore = useRootStore();
  const fileListStore = rootStore?.fileList as FileListStore | undefined;
  const client = rootStore?.client;
  const selectedIds = (fileListStore?.selectedIds as string[]) || [];

  if (!selectedIds.length || !fileListStore || !client) return null;

  // A tick is only shown when the whole selection agrees; a mixed selection
  // has no single current value to display.
  const files = selectedIds
    .map((id) => fileListStore.getFileById(id))
    .filter((file): file is NonNullable<typeof file> => Boolean(file));
  const agreedPriority =
    files.length && files.every((file) => file.priority === files[0].priority)
      ? files[0].priority
      : null;
  const allWanted = files.length > 0 && files.every((file) => file.wanted);
  const noneWanted = files.length > 0 && files.every((file) => !file.wanted);

  const firstFile = selectedIds.length > 0 ? fileListStore.getFileById(selectedIds[0]) : null;

  const handleSetPriority = (priority: number) => {
    report(client.filesSetPriority(fileListStore.id, fileListStore.selectedIndexes, priority));
  };

  // Independent of priority: excluding a file leaves the priority it will have
  // if it is included again.
  const handleSetWanted = (wanted: boolean) => {
    report(client.filesSetWanted(fileListStore.id, fileListStore.selectedIndexes, wanted));
  };

  // The list is flat: drilling into a folder sets a filter rather than showing
  // folder rows, so "this folder" means everything the folder and search
  // filters currently leave visible. Applying to it without making the user
  // select several thousand rows first is the whole point.
  const visible = fileListStore.visibleIndexes;
  const handleFolderPriority = (priority: number) => {
    report(client.filesSetPriority(fileListStore.id, visible, priority));
  };
  const handleFolderWanted = (wanted: boolean) => {
    report(client.filesSetWanted(fileListStore.id, visible, wanted));
  };

  const handleRename = () => {
    const id = fileListStore.id;
    if (!firstFile) return;

    rootStore.createDialog({
      type: 'rename',
      path: firstFile.name,
      torrentIds: [id],
    });
  };

  return (
    <ContextMenu.Content className="context-menu">
      <ContextMenu.Item className="context-menu-item" onSelect={() => handleSetWanted(true)}>
        {(allWanted ? '✓ ' : '') + chrome.i18n.getMessage('downloadFile')}
      </ContextMenu.Item>
      <ContextMenu.Item className="context-menu-item" onSelect={() => handleSetWanted(false)}>
        {(noneWanted ? '✓ ' : '') + chrome.i18n.getMessage('MF_DONT')}
      </ContextMenu.Item>

      <ContextMenu.Separator className="context-menu-separator" />

      <PriorityItem
        level={3}
        selected={agreedPriority === 3}
        onSelect={() => handleSetPriority(3)}
      />
      <PriorityItem
        level={2}
        selected={agreedPriority === 2}
        onSelect={() => handleSetPriority(2)}
      />
      <PriorityItem
        level={1}
        selected={agreedPriority === 1}
        onSelect={() => handleSetPriority(1)}
      />

      <ContextMenu.Separator className="context-menu-separator" />

      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
          {`${chrome.i18n.getMessage('applyToShownFiles')} (${visible.length})`}
          <span className="context-menu-arrow">›</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="context-menu">
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => handleFolderWanted(true)}
            >
              {chrome.i18n.getMessage('downloadFile')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => handleFolderWanted(false)}
            >
              {chrome.i18n.getMessage('MF_DONT')}
            </ContextMenu.Item>
            <ContextMenu.Separator className="context-menu-separator" />
            <PriorityItem level={3} selected={false} onSelect={() => handleFolderPriority(3)} />
            <PriorityItem level={2} selected={false} onSelect={() => handleFolderPriority(2)} />
            <PriorityItem level={1} selected={false} onSelect={() => handleFolderPriority(1)} />
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>

      <ContextMenu.Separator className="context-menu-separator" />

      <ContextMenu.Item className="context-menu-item" onSelect={handleRename}>
        {chrome.i18n.getMessage('rename')}
      </ContextMenu.Item>
    </ContextMenu.Content>
  );
});

interface PriorityItemProps {
  level: number;
  selected: boolean;
  onSelect: () => void;
}

const PriorityItem = ({ level, selected, onSelect }: PriorityItemProps) => {
  let name: string;
  switch (level) {
    case 3:
      name = chrome.i18n.getMessage('MF_HIGH');
      break;
    case 2:
      name = chrome.i18n.getMessage('MF_NORMAL');
      break;
    case 1:
      name = chrome.i18n.getMessage('MF_LOW');
      break;
    default:
      name = '';
  }

  return (
    <ContextMenu.Item className="context-menu-item" onSelect={onSelect}>
      {selected && <span className="context-menu-check">●</span>}
      {name}
    </ContextMenu.Item>
  );
};

export default FileContextMenu;
