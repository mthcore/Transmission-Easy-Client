import React, { ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import { useContextMenuSelection } from '../../hooks/useContextMenuSelection';

interface TorrentContextMenuProps {
  children: ReactNode;
  torrentId: number;
}

const TorrentContextMenu = observer(({ children, torrentId }: TorrentContextMenuProps) => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore?.torrentList;
  const handleOpenChange = useContextMenuSelection(
    torrentListStore as unknown as {
      selectedIds: (string | number)[];
      resetSelectedIds: () => void;
      addSelectedId: (id: string | number) => void;
    },
    torrentId
  );

  return (
    <ContextMenu.Root onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <TorrentMenuContent />
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

interface Torrent {
  name: string;
  magnetLink: string;
  hash?: string;
  directory: string;
  labelsStr: string;
  actions: string[];
  sequentialDownload?: boolean;
}

const TorrentMenuContent = observer(() => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore?.torrentList;
  const client = rootStore?.client;
  const selectedIds = (torrentListStore?.selectedIds as number[]) || [];

  if (!selectedIds.length || !client) return null;

  const firstTorrent =
    selectedIds.length > 0 ? (client.torrents.get(selectedIds[0]) as Torrent | undefined) : null;

  // Collect available actions from selected torrents
  const actions: string[] = ['_', 'remove', 'remove_with', 'extra', 'order', 'torrent_files'];
  selectedIds.forEach((id) => {
    const torrent = client.torrents.get(id) as { actions: string[] } | undefined;
    if (torrent) {
      torrent.actions.forEach((action) => {
        if (!actions.includes(action)) {
          actions.push(action);
        }
      });
    }
  });

  const handleStart = () => {
    client.torrentsStart(selectedIds);
  };

  const handleForceStart = () => {
    client.torrentsForceStart(selectedIds);
  };

  const handleStop = () => {
    client.torrentsStop(selectedIds);
  };

  const handleRecheck = () => {
    client.torrentsRecheck(selectedIds);
  };

  const handleRemove = () => {
    rootStore.createDialog({
      type: 'removeConfirm',
      torrentIds: selectedIds.slice(0),
    });
  };

  const handleRemoveTorrent = () => {
    rootStore.createDialog({
      type: 'removeConfirm',
      torrentIds: selectedIds.slice(0),
      deleteData: false,
    });
  };

  const handleRemoveTorrentFiles = () => {
    rootStore.createDialog({
      type: 'removeConfirm',
      torrentIds: selectedIds.slice(0),
      deleteData: true,
    });
  };

  const handleRename = () => {
    if (!firstTorrent) return;
    rootStore.createDialog({
      type: 'rename',
      path: firstTorrent.name,
      torrentIds: selectedIds.slice(0),
    });
  };

  const handleCopyMagnetUrl = () => {
    if (!firstTorrent) return;
    rootStore.createDialog({
      type: 'copyMagnetUrl',
      magnetLink: firstTorrent.magnetLink,
      torrentIds: selectedIds.slice(0),
    });
  };

  const handleCopyName = () => {
    if (!firstTorrent) return;
    navigator.clipboard.writeText(firstTorrent.name);
  };

  const handleCopyHash = () => {
    if (!firstTorrent || !firstTorrent.hash) return;
    navigator.clipboard.writeText(firstTorrent.hash);
  };

  const handleMove = () => {
    if (!firstTorrent) return;
    rootStore.createDialog({
      type: 'move',
      directory: firstTorrent.directory,
      torrentIds: selectedIds.slice(0),
    });
  };

  const handleSetLabels = () => {
    if (!firstTorrent) return;
    rootStore.createDialog({
      type: 'setLabels',
      currentLabels: firstTorrent.labelsStr,
      torrentIds: selectedIds.slice(0),
    });
  };

  const handleReannounce = () => {
    client.reannounce(selectedIds);
  };

  const handleQueueTop = () => {
    client.torrentsQueueTop(selectedIds);
  };

  const handleQueueUp = () => {
    client.torrentsQueueUp(selectedIds);
  };

  const handleQueueDown = () => {
    client.torrentsQueueDown(selectedIds);
  };

  const handleQueueBottom = () => {
    client.torrentsQueueBottom(selectedIds);
  };

  const handleShowFiles = () => {
    if (selectedIds.length) {
      rootStore.createFileList(selectedIds[0]);
    }
  };

  const handleShowProperties = () => {
    if (selectedIds.length) {
      rootStore.createDialog({
        type: 'torrentDetails',
        torrentId: selectedIds[0],
      });
    }
  };

  return (
    <ContextMenu.Content className="context-menu">
      {actions.includes('start') && (
        <ContextMenu.Item className="context-menu-item" onSelect={handleStart}>
          {chrome.i18n.getMessage('ML_START')}
        </ContextMenu.Item>
      )}
      {actions.includes('forcestart') && (
        <ContextMenu.Item className="context-menu-item" onSelect={handleForceStart}>
          {chrome.i18n.getMessage('startNow')}
        </ContextMenu.Item>
      )}
      {actions.includes('stop') && (
        <ContextMenu.Item className="context-menu-item" onSelect={handleStop}>
          {chrome.i18n.getMessage('ML_STOP')}
        </ContextMenu.Item>
      )}

      <ContextMenu.Separator className="context-menu-separator" />

      {actions.includes('recheck') && (
        <ContextMenu.Item className="context-menu-item" onSelect={handleRecheck}>
          {chrome.i18n.getMessage('ML_FORCE_RECHECK')}
        </ContextMenu.Item>
      )}

      <ContextMenu.Item className="context-menu-item" onSelect={handleRemove}>
        {chrome.i18n.getMessage('ML_REMOVE')}
      </ContextMenu.Item>

      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
          {chrome.i18n.getMessage('ML_REMOVE_AND')}
          <span className="context-menu-arrow">&#9656;</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="context-menu">
            <ContextMenu.Item className="context-menu-item" onSelect={handleRemoveTorrent}>
              {chrome.i18n.getMessage('ML_DELETE_TORRENT')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleRemoveTorrentFiles}>
              {chrome.i18n.getMessage('ML_DELETE_DATATORRENT')}
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>

      <ContextMenu.Separator className="context-menu-separator" />

      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
          {chrome.i18n.getMessage('extra')}
          <span className="context-menu-arrow">&#9656;</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="context-menu">
            {selectedIds.length === 1 && (
              <>
                <ContextMenu.Item className="context-menu-item" onSelect={handleRename}>
                  {chrome.i18n.getMessage('rename')}
                </ContextMenu.Item>
                <ContextMenu.Item className="context-menu-item" onSelect={handleCopyName}>
                  {chrome.i18n.getMessage('copyName')}
                </ContextMenu.Item>
                {firstTorrent?.hash && (
                  <ContextMenu.Item className="context-menu-item" onSelect={handleCopyHash}>
                    {chrome.i18n.getMessage('copyHash')}
                  </ContextMenu.Item>
                )}
                <ContextMenu.Item className="context-menu-item" onSelect={handleCopyMagnetUrl}>
                  {chrome.i18n.getMessage('magnetUri')}
                </ContextMenu.Item>
              </>
            )}
            <ContextMenu.Item className="context-menu-item" onSelect={handleMove}>
              {chrome.i18n.getMessage('move')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleSetLabels}>
              {chrome.i18n.getMessage('OV_COL_LABEL')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleReannounce}>
              {chrome.i18n.getMessage('reannounce')}
            </ContextMenu.Item>
            {client.settings?.features.sequentialDownload && (
              <ContextMenu.Item
                className="context-menu-item"
                onSelect={() =>
                  client.setSequentialDownload(selectedIds, !firstTorrent?.sequentialDownload)
                }
              >
                {(firstTorrent?.sequentialDownload ? '✓ ' : '') +
                  chrome.i18n.getMessage('sequentialDownload')}
              </ContextMenu.Item>
            )}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>

      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
          {chrome.i18n.getMessage('OV_COL_ORDER')}
          <span className="context-menu-arrow">&#9656;</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="context-menu">
            <ContextMenu.Item className="context-menu-item" onSelect={handleQueueTop}>
              {chrome.i18n.getMessage('queueTop')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleQueueUp}>
              {chrome.i18n.getMessage('up')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleQueueDown}>
              {chrome.i18n.getMessage('down')}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleQueueBottom}>
              {chrome.i18n.getMessage('queueBottom')}
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>

      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
          {chrome.i18n.getMessage('FI_COL_PRIO')}
          <span className="context-menu-arrow">&#9656;</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="context-menu">
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => client.setBandwidthPriority(selectedIds, 1)}
            >
              {chrome.i18n.getMessage('MF_HIGH')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => client.setBandwidthPriority(selectedIds, 0)}
            >
              {chrome.i18n.getMessage('MF_NORMAL')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => client.setBandwidthPriority(selectedIds, -1)}
            >
              {chrome.i18n.getMessage('MF_LOW')}
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>

      {selectedIds.length === 1 && (
        <>
          <ContextMenu.Separator className="context-menu-separator" />
          <ContextMenu.Item className="context-menu-item" onSelect={handleShowFiles}>
            {chrome.i18n.getMessage('showFileList')}
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={handleShowProperties}>
            {chrome.i18n.getMessage('properties')}
          </ContextMenu.Item>
        </>
      )}
    </ContextMenu.Content>
  );
});

export default TorrentContextMenu;
