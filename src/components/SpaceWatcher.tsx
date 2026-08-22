import { observer } from 'mobx-react';
import React, { useEffect, useCallback, MouseEvent } from 'react';
import Interval from './Interval';
import VisiblePage from './VisiblePage';
import useRootStore from '../hooks/useRootStore';
import { SPACE_WATCHER_INTERVAL } from '../constants';

const SpaceWatcher = observer(() => {
  const rootStore = useRootStore();
  const spaceWatcherStore = rootStore?.spaceWatcher;

  useEffect(() => {
    rootStore?.createSpaceWatcher();
    return () => rootStore?.destroySpaceWatcher();
  }, [rootStore]);

  const onIntervalFire = useCallback(() => {
    spaceWatcherStore?.fetchDownloadDirs();
  }, [spaceWatcherStore]);

  const handleUpdate = useCallback(
    (e: MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      onIntervalFire();
    },
    [onIntervalFire]
  );

  if (!spaceWatcherStore) return null;

  let title: string | null = null;
  let body: React.ReactNode = null;

  if (spaceWatcherStore.state === 'pending') {
    title = 'Loading...';
    body = '...';
  } else if (spaceWatcherStore.state === 'error') {
    title = spaceWatcherStore.errorMessage;
    body = '-';
  } else if (spaceWatcherStore.state === 'done') {
    const status = [`${chrome.i18n.getMessage('freeSpace')}:`];
    body = spaceWatcherStore.downloadDirs.map((directory) => {
      status.push(`${directory.availableStr} (${directory.path})`);
      return <span key={directory.path}>{directory.availableStr} </span>;
    });
    title = status.join('\n');
  }

  return (
    <>
      <span className="space disk" onClick={handleUpdate} title={title || undefined}>
        {body}
      </span>
      {/* Gated on visibility: a backgrounded tab kept waking the service worker
          with a free-space RPC every minute, forever */}
      <VisiblePage>
        <Interval interval={SPACE_WATCHER_INTERVAL} onFire={onIntervalFire} />
      </VisiblePage>
    </>
  );
});

export default SpaceWatcher;
