import React, { ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import { useContextMenuSelection } from '../../hooks/useContextMenuSelection';
import report from '../../tools/reportAction';

interface TorrentContextMenuProps {
  children: ReactNode;
  torrentId: number;
}

interface GroupSubMenuProps {
  loadGroups: () => Promise<{ name: string }[]>;
  onPick: (group: string) => void;
}

/**
 * The daemon's bandwidth groups, fetched when the submenu is opened rather than
 * on every poll: group-get is a separate RPC and the list is only needed when
 * the user goes looking for it.
 */
const GroupSubMenu = ({ loadGroups, onPick }: GroupSubMenuProps) => {
  const [groups, setGroups] = React.useState<{ name: string }[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  const handleOpenChange = (open: boolean) => {
    if (!open || groups) return;
    loadGroups().then(
      (list) => setGroups(list),
      () => setFailed(true)
    );
  };

  return (
    <ContextMenu.Sub onOpenChange={handleOpenChange}>
      <ContextMenu.SubTrigger className="context-menu-item context-menu-subtrigger">
        {chrome.i18n.getMessage('bandwidthGroup')}
        <span className="context-menu-arrow">›</span>
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className="context-menu">
          {/* Always offered: an empty group name is how the daemon detaches a
              torrent from whichever group it is in */}
          <ContextMenu.Item className="context-menu-item" onSelect={() => onPick('')}>
            {chrome.i18n.getMessage('noBandwidthGroup')}
          </ContextMenu.Item>
          {groups?.map((group) => (
            <ContextMenu.Item
              key={group.name}
              className="context-menu-item"
              onSelect={() => onPick(group.name)}
            >
              {group.name}
            </ContextMenu.Item>
          ))}
          {groups === null && !failed && (
            <div className="context-menu-item context-menu-hint">
              {chrome.i18n.getMessage('loading')}
            </div>
          )}
          {failed && (
            <div className="context-menu-item context-menu-hint">
              {chrome.i18n.getMessage('unexpectedError')}
            </div>
          )}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
};

const TorrentContextMenu = observer(({ children, torrentId }: TorrentContextMenuProps) => {
  const rootStore = useRootStore();
  const torrentListStore = rootStore?.torrentList;
  const handleOpenChange = useContextMenuSelection(torrentListStore, torrentId);

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
    report(client.torrentsStart(selectedIds));
  };

  const handleForceStart = () => {
    report(client.torrentsForceStart(selectedIds));
  };

  const handleStop = () => {
    report(client.torrentsStop(selectedIds));
  };

  const handleRecheck = () => {
    report(client.torrentsRecheck(selectedIds));
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
    // magnetLink is optional on old daemons; the store field is required, so
    // passing undefined threw an MST typecheck error inside the menu handler.
    // The hash is enough to rebuild a usable magnet URI.
    const magnetLink =
      firstTorrent.magnetLink ||
      (firstTorrent.hash ? `magnet:?xt=urn:btih:${firstTorrent.hash}` : '');
    if (!magnetLink) return;
    rootStore.createDialog({
      type: 'copyMagnetUrl',
      magnetLink,
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
      // Required string in the store: `directory` is optional on the torrent
      directory: firstTorrent.directory ?? '',
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
    report(client.reannounce(selectedIds));
  };

  const handleQueueTop = () => {
    report(client.torrentsQueueTop(selectedIds));
  };

  const handleQueueUp = () => {
    report(client.torrentsQueueUp(selectedIds));
  };

  const handleQueueDown = () => {
    report(client.torrentsQueueDown(selectedIds));
  };

  const handleQueueBottom = () => {
    report(client.torrentsQueueBottom(selectedIds));
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
            {/* Labels need Transmission 3.0+: on older daemons the dialog
                could open but every Apply was rejected by the bg backstop */}
            {client.settings?.features.labels && (
              <ContextMenu.Item className="context-menu-item" onSelect={handleSetLabels}>
                {chrome.i18n.getMessage('OV_COL_LABEL')}
              </ContextMenu.Item>
            )}
            <ContextMenu.Item className="context-menu-item" onSelect={handleReannounce}>
              {chrome.i18n.getMessage('reannounce')}
            </ContextMenu.Item>
            {/* Bandwidth groups need Transmission 4.0+ (rpc 17); the service
                rejects group-set below that, so the entry is hidden rather
                than left to fail */}
            {client.settings?.features.groups && (
              <GroupSubMenu
                onPick={(group) => report(client.setTorrentGroup(selectedIds, group))}
                loadGroups={() => client.getGroups()}
              />
            )}
            {client.settings?.features.sequentialDownload && (
              <ContextMenu.Item
                className="context-menu-item"
                onSelect={() =>
                  report(
                    client.setSequentialDownload(selectedIds, !firstTorrent?.sequentialDownload)
                  )
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
              onSelect={() => report(client.setBandwidthPriority(selectedIds, 1))}
            >
              {chrome.i18n.getMessage('MF_HIGH')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => report(client.setBandwidthPriority(selectedIds, 0))}
            >
              {chrome.i18n.getMessage('MF_NORMAL')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => report(client.setBandwidthPriority(selectedIds, -1))}
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
