import React, { ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { observer } from 'mobx-react';
import { speedToStr } from '../../tools/format';
import useRootStore from '../../hooks/useRootStore';
import { SPEED_ARRAY_COUNT, DEFAULT_SPEED_LIMIT } from '../../constants';
import { SPEED_LIMIT_UNIT } from '../../stores/ClientStore';
import report from '../../tools/reportAction';

type SpeedType = 'download' | 'upload';

interface SpeedContextMenuProps {
  children: ReactNode;
  type: SpeedType;
}

const SpeedContextMenu = observer(({ children, type }: SpeedContextMenuProps) => {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <SpeedMenuContent type={type} />
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

interface SpeedMenuContentProps {
  type: SpeedType;
}

const SpeedMenuContent = observer(({ type }: SpeedMenuContentProps) => {
  const rootStore = useRootStore();
  const client = rootStore?.client;
  const settings = client?.settings;

  const isAltSpeed = settings?.altSpeedEnabled;

  const getSpeedLimit = (): number => {
    if (type === 'download') {
      if (isAltSpeed) {
        return settings?.altDownloadSpeedLimit || 0;
      } else {
        return settings?.downloadSpeedLimit || 0;
      }
    } else if (type === 'upload') {
      if (isAltSpeed) {
        return settings?.altUploadSpeedLimit || 0;
      } else {
        return settings?.uploadSpeedLimit || 0;
      }
    }
    return 0;
  };

  const getSpeedLimitEnabled = (): boolean => {
    if (isAltSpeed) {
      return true;
    }
    if (type === 'download') {
      return settings?.downloadSpeedLimitEnabled || false;
    } else if (type === 'upload') {
      return settings?.uploadSpeedLimitEnabled || false;
    }
    return false;
  };

  const handleUnlimited = () => {
    if (type === 'download') {
      if (isAltSpeed) {
        report(client?.setAltSpeedEnabled(false));
      } else {
        report(client?.setDownloadSpeedLimitEnabled(false));
      }
    } else if (type === 'upload') {
      if (isAltSpeed) {
        report(client?.setAltSpeedEnabled(false));
      } else {
        report(client?.setUploadSpeedLimitEnabled(false));
      }
    }
  };

  const handleSetSpeedLimit = (speed: number) => {
    if (type === 'download') {
      if (isAltSpeed) {
        report(client?.setAltDownloadSpeedLimit(speed));
      } else {
        report(client?.setDownloadSpeedLimit(speed));
      }
    } else if (type === 'upload') {
      if (isAltSpeed) {
        report(client?.setAltUploadSpeedLimit(speed));
      } else {
        report(client?.setUploadSpeedLimit(speed));
      }
    }
  };

  const speedLimit = getSpeedLimit();
  const speedLimitEnabled = getSpeedLimitEnabled();

  return (
    <ContextMenu.Content className="context-menu">
      <ContextMenu.Item className="context-menu-item" onSelect={handleUnlimited}>
        {settings && !speedLimitEnabled && <span className="context-menu-check">●</span>}
        {chrome.i18n.getMessage('MENU_UNLIMITED')}
      </ContextMenu.Item>

      {settings && (
        <>
          <ContextMenu.Separator className="context-menu-separator" />
          {getSpeedArray(speedLimit, SPEED_ARRAY_COUNT).map((speed) => {
            const selected = speedLimitEnabled && speed === speedLimit;
            const isDefault = speed === speedLimit;
            return (
              <ContextMenu.Item
                key={`speed-${speed}`}
                className="context-menu-item"
                onSelect={() => handleSetSpeedLimit(speed)}
              >
                {selected && <span className="context-menu-check">●</span>}
                {isDefault ? (
                  <b>{speedToStr(speed * SPEED_LIMIT_UNIT)}</b>
                ) : (
                  speedToStr(speed * SPEED_LIMIT_UNIT)
                )}
              </ContextMenu.Item>
            );
          })}
        </>
      )}
    </ContextMenu.Content>
  );
});

function getSpeedArray(currentLimit: number, count: number): number[] {
  // A configured limit of 0 can no longer seed the ladder — the filter below
  // would drop every entry it produced — so it always falls back
  const limit = currentLimit || DEFAULT_SPEED_LIMIT;
  const middle = Math.round(count / 2);
  let middleSpeed = limit;
  if (middleSpeed < middle) {
    middleSpeed = middle;
  }
  const arr: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    arr[i] = Math.round(((i + 1) / middle) * middleSpeed);
  }
  // Never offer 0: picking it would ENABLE a zero-byte limit and stall every
  // transfer. "Unlimited" is the menu's first entry for turning limits off.
  return arr.filter((speed) => speed > 0);
}

export default SpeedContextMenu;
