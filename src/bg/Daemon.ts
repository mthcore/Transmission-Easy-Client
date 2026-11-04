import getLogger from '../tools/getLogger';
import type { IBgForDaemon } from '../types';
import {
  BG_UPDATE_INTERVAL,
  DAEMON_BACKOFF_PERIOD_MINUTES,
  DAEMON_MAX_RETRIES,
  MIN_BG_UPDATE_INTERVAL,
} from '../constants';

const logger = getLogger('Daemon');

const ALARM_NAME = 'transmissionDaemon';

class Daemon {
  bg: IBgForDaemon;
  isActive: boolean;
  retryCount: number;
  inProgress: boolean;
  /** Polling at DAEMON_BACKOFF_PERIOD_MINUTES after repeated failures. */
  isBackedOff: boolean;

  constructor(bg: IBgForDaemon) {
    this.bg = bg;

    this.isActive = false;
    this.retryCount = 0;
    this.inProgress = false;
    this.isBackedOff = false;
  }

  get bgStore(): IBgForDaemon['bgStore'] {
    return this.bg.bgStore;
  }

  handleFire(): void {
    logger.info('Fire');
    if (this.inProgress) return;

    const client = this.bg.client;
    if (!client) return;

    this.inProgress = true;
    client
      .updateTorrents()
      .then(
        () => {
          this.retryCount = 0;
          if (this.isBackedOff && this.isActive) this.start();
        },
        (err) => {
          logger.error('updateTorrents error', err);
          if (++this.retryCount > DAEMON_MAX_RETRIES && !this.isBackedOff) {
            // Slow down rather than stop. Stopping cleared the alarm, and only a
            // successful request could recreate it — which, with every page
            // closed, never came: a daemon that rebooted overnight left the
            // badge and completion notifications dead until the popup was opened
            logger.warn(`Daemon backing off after ${DAEMON_MAX_RETRIES} retries, cause`, err);
            this.backOff();
          }
        }
      )
      .finally(() => {
        this.inProgress = false;
      });
  }

  start(): void {
    logger.info('Start');
    // chrome.alarms.create replaces any existing alarm with the same name,
    // so no need to clear first (chrome.alarms.clear is async and would race)
    this.isActive = true;
    this.isBackedOff = false;
    this.retryCount = 0;
    this.schedule(this.configuredPeriod());
  }

  backOff(): void {
    this.isBackedOff = true;
    this.schedule(Math.max(DAEMON_BACKOFF_PERIOD_MINUTES, this.configuredPeriod()));
  }

  private configuredPeriod(): number {
    // Clamp instead of skipping: a persisted sub-1000 value used to create no
    // alarm at all (and left any stale alarm running), silently killing badge
    // updates and notifications after the next alarm loss
    // Math.max(n, NaN) is NaN, which chrome.alarms.create rejects outright —
    // background polling would then never start at all
    const configured = Number(this.bgStore.requireConfig().backgroundUpdateInterval);
    const intervalMs = Math.max(
      MIN_BG_UPDATE_INTERVAL,
      Number.isFinite(configured) ? configured : BG_UPDATE_INTERVAL
    );
    // chrome.alarms survives service worker termination (MV3)
    // Minimum period is 1 minute
    return Math.max(1, intervalMs / 60000);
  }

  private schedule(periodInMinutes: number): void {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
    logger.info('Alarm created, period:', periodInMinutes, 'min');
  }

  stop(force?: boolean): void {
    if (!force) {
      logger.info('Stop');
    }
    this.isActive = false;
    this.isBackedOff = false;
    chrome.alarms.clear(ALARM_NAME);
  }

  destroy(): void {
    logger.info('Destroyed');
    this.stop();
  }
}

export { ALARM_NAME };
export default Daemon;
