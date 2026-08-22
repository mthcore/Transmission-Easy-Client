import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react';
import Dialog from './Dialog';
import { useDialogClose } from '../../hooks/useDialogClose';
import useRootStore from '../../hooks/useRootStore';
import { useResizableColumns } from '../../hooks/useResizableColumns';
import type { PeerData, TorrentDetailData } from '../../bg/TorrentService';
import TorrentDetailsInfoTab from './tabs/TorrentDetailsInfoTab';
import TorrentDetailsTrackersTab from './tabs/TorrentDetailsTrackersTab';
import TorrentDetailsSeedLimitsTab from './tabs/TorrentDetailsSeedLimitsTab';
import showError from '../../tools/showError';

interface RootStore {
  client: {
    settings: { features: { trackerList: boolean } } | null;
    getPeers: (id: number) => Promise<PeerData[]>;
    getTorrentDetails: (id: number) => Promise<TorrentDetailData>;
    setTrackerList: (ids: number[], trackerList: string) => Promise<void>;
    setSeedLimits: (
      ids: number[],
      seedRatioMode: number,
      seedRatioLimit: number,
      seedIdleMode: number,
      seedIdleLimit: number
    ) => Promise<void>;
  };
  config: {
    detailPeerWidths: Record<string, number>;
    detailTrackerWidths: Record<string, number>;
    setDetailPeerWidths: (widths: Record<string, number>) => void;
    setDetailTrackerWidths: (widths: Record<string, number>) => void;
  };
}

interface Torrent {
  id: number;
  name: string;
  sizeStr: string;
  sizeWhenDoneStr: string;
  progressStr: string;
  downloadedStr: string;
  uploadedStr: string;
  downloaded: number;
  uploaded: number;
  activeSeeds: number;
  seeds: number;
  activePeers: number;
  peers: number;
  downloadSpeedStr: string;
  uploadSpeedStr: string;
  etaStr: string;
  etaIdleStr: string;
  stateText: string;
  addedTimeStr: string;
  completedTimeStr: string;
  activityDateStr: string;
  startDateStr: string;
  directory?: string;
  errorMessage?: string;
  hash?: string | null;
  peersConnected?: number;
  isPrivate?: boolean;
  size: number;
  sizeWhenDone?: number;
}

interface TorrentDetailsDialogStore {
  close: () => void;
  torrent: Torrent | null;
}

interface TorrentDetailsDialogProps {
  dialogStore: TorrentDetailsDialogStore;
}

type TabId = 'info' | 'trackers' | 'seedLimits';

const TorrentDetailsDialog = observer(({ dialogStore }: TorrentDetailsDialogProps) => {
  const torrent = dialogStore.torrent;
  const handleClose = useDialogClose(dialogStore);
  const rootStore = useRootStore() as unknown as RootStore;
  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [peersLoading, setPeersLoading] = useState(false);
  const [details, setDetails] = useState<TorrentDetailData | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);

  // Tracker edit state
  const [trackerListText, setTrackerListText] = useState('');
  const [trackerSaving, setTrackerSaving] = useState(false);

  // Seed limits state
  const [seedRatioMode, setSeedRatioMode] = useState(0);
  const [seedRatioLimit, setSeedRatioLimit] = useState(0);
  const [seedIdleMode, setSeedIdleMode] = useState(0);
  const [seedIdleLimit, setSeedIdleLimit] = useState(0);
  const [seedSaving, setSeedSaving] = useState(false);

  // Resizable columns
  const defaultPeerWidths = useMemo(
    () => ({ ip: 100, client: 90, pct: 38, dl: 70, ul: 70, flags: 55 }),
    []
  );
  const defaultTrackerWidths = useMemo(
    () => ({ url: 160, tier: 40, seeds: 50, peers: 50, status: 80 }),
    []
  );
  const peerResize = useResizableColumns({
    defaultWidths: defaultPeerWidths,
    savedWidths: rootStore.config.detailPeerWidths,
    onSave: (w) => rootStore.config.setDetailPeerWidths(w),
  });
  const trackerResize = useResizableColumns({
    defaultWidths: defaultTrackerWidths,
    savedWidths: rootStore.config.detailTrackerWidths,
    onSave: (w) => rootStore.config.setDetailTrackerWidths(w),
  });

  const torrentId = torrent?.id;

  // The torrent was removed elsewhere while the dialog was open: destroy the
  // store entry, or it stays in rootStore.dialogs forever with no handler to
  // close it (and keeps swallowing Escape for the rest of the session)
  useEffect(() => {
    if (!torrent) {
      handleClose();
    }
  }, [torrent, handleClose]);

  useEffect(() => {
    if (torrentId == null) return;
    setPeersLoading(true);
    rootStore.client?.getPeers(torrentId).then(
      (data) => {
        setPeers(data);
        setPeersLoading(false);
      },
      () => setPeersLoading(false)
    );
  }, [torrentId, rootStore.client]);

  const fetchDetails = useCallback(
    (initFields: boolean) => {
      if (torrentId == null) return;
      setDetailsLoading(true);
      rootStore.client?.getTorrentDetails(torrentId).then(
        (data) => {
          setDetails(data);
          // The edit fields only re-seed on load/retry — a background refetch
          // (after Apply) must not clobber what the user is typing
          if (initFields) {
            setTrackerListText(data.trackerList);
            setSeedRatioMode(data.seedRatioMode);
            setSeedRatioLimit(data.seedRatioLimit);
            setSeedIdleMode(data.seedIdleMode);
            setSeedIdleLimit(data.seedIdleLimit);
          }
          setDetailsError(false);
          setDetailsLoading(false);
        },
        () => {
          // Without an error state the Trackers and Seed-limit tabs rendered
          // permanently blank with no explanation and no way to retry
          setDetailsError(true);
          setDetailsLoading(false);
        }
      );
    },
    [torrentId, rootStore.client]
  );

  useEffect(() => {
    fetchDetails(true);
  }, [fetchDetails]);

  const handleApplyTrackers = useCallback(() => {
    if (torrentId == null) return;
    setTrackerSaving(true);
    rootStore.client?.setTrackerList([torrentId], trackerListText).then(
      () => {
        setTrackerSaving(false);
        // The tracker table above the editor reads the one-shot details
        // snapshot: without a refetch it kept showing the pre-edit trackers,
        // making a successful apply look like a failure
        fetchDetails(false);
      },
      (err) => {
        setTrackerSaving(false);
        showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Apply failed', err as Error);
      }
    );
  }, [torrentId, trackerListText, rootStore.client, fetchDetails]);

  const handleApplySeedLimits = useCallback(() => {
    if (torrentId == null) return;
    setSeedSaving(true);
    rootStore.client
      ?.setSeedLimits([torrentId], seedRatioMode, seedRatioLimit, seedIdleMode, seedIdleLimit)
      .then(
        () => setSeedSaving(false),
        (err) => {
          setSeedSaving(false);
          showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Apply failed', err as Error);
        }
      );
  }, [torrentId, seedRatioMode, seedRatioLimit, seedIdleMode, seedIdleLimit, rootStore.client]);

  if (!torrent) {
    return null;
  }

  return (
    <Dialog onClose={handleClose} className="torrent-details-dialog">
      <div className="nf-notifi">
        <div className="nf-subItem torrent-details-header">
          <strong>{torrent.name}</strong>
        </div>

        <div className="torrent-details-tabs">
          <button
            className={activeTab === 'info' ? 'active' : ''}
            onClick={() => setActiveTab('info')}
          >
            {chrome.i18n.getMessage('DT_TAB_INFO')}
          </button>
          <button
            className={activeTab === 'trackers' ? 'active' : ''}
            onClick={() => setActiveTab('trackers')}
          >
            {chrome.i18n.getMessage('DT_TAB_TRACKERS')}
          </button>
          <button
            className={activeTab === 'seedLimits' ? 'active' : ''}
            onClick={() => setActiveTab('seedLimits')}
          >
            {chrome.i18n.getMessage('DT_TAB_SEED_LIMITS')}
          </button>
        </div>

        <div className="torrent-details-content">
          {/* A failed details fetch used to leave the Trackers and Seed-limit
              tabs permanently blank with no explanation */}
          {detailsError && !detailsLoading && (
            <div className="dialog-error-inline" role="alert">
              <span>{chrome.i18n.getMessage('OV_FL_ERROR')}</span>{' '}
              <button type="button" onClick={() => fetchDetails(true)}>
                {chrome.i18n.getMessage('errorRetry')}
              </button>
            </div>
          )}
          {activeTab === 'info' && (
            <TorrentDetailsInfoTab
              torrent={torrent}
              details={details}
              detailsLoading={detailsLoading}
              peers={peers}
              peersLoading={peersLoading}
              peerWidths={peerResize.widths}
              getPeerResizeProps={peerResize.getResizeProps}
            />
          )}

          {activeTab === 'trackers' && (
            <TorrentDetailsTrackersTab
              details={details}
              detailsLoading={detailsLoading}
              trackerListText={trackerListText}
              onTrackerListChange={setTrackerListText}
              onApplyTrackers={handleApplyTrackers}
              trackerSaving={trackerSaving}
              trackerWidths={trackerResize.widths}
              getTrackerResizeProps={trackerResize.getResizeProps}
              canEditTrackers={rootStore.client?.settings?.features.trackerList ?? false}
            />
          )}

          {activeTab === 'seedLimits' && (
            <TorrentDetailsSeedLimitsTab
              detailsLoading={detailsLoading}
              hasDetails={details !== null}
              seedRatioMode={seedRatioMode}
              onSeedRatioModeChange={setSeedRatioMode}
              seedRatioLimit={seedRatioLimit}
              onSeedRatioLimitChange={setSeedRatioLimit}
              seedIdleMode={seedIdleMode}
              onSeedIdleModeChange={setSeedIdleMode}
              seedIdleLimit={seedIdleLimit}
              onSeedIdleLimitChange={setSeedIdleLimit}
              onApplySeedLimits={handleApplySeedLimits}
              seedSaving={seedSaving}
            />
          )}
        </div>

        <div className="nf-subItem">
          <input
            onClick={handleClose}
            type="button"
            value={chrome.i18n.getMessage('DLG_BTN_CLOSE')}
          />
        </div>
      </div>
    </Dialog>
  );
});

export default TorrentDetailsDialog;
