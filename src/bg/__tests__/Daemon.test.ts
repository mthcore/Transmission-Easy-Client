import { describe, it, expect, vi, beforeEach } from 'vitest';
import Daemon, { ALARM_NAME } from '../Daemon';
import type { IBgForDaemon } from '../../types';

function createMockBg(overrides?: Partial<IBgForDaemon>): IBgForDaemon {
  return {
    client: {
      updateTorrents: vi.fn().mockResolvedValue(undefined),
    },
    bgStore: {
      config: {
        backgroundUpdateInterval: 120000, // 2 minutes
      },
    },
    ...overrides,
  } as unknown as IBgForDaemon;
}

describe('Daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const daemon = new Daemon(createMockBg());
    expect(daemon.isActive).toBe(false);
    expect(daemon.retryCount).toBe(0);
    expect(daemon.inProgress).toBe(false);
  });

  describe('start', () => {
    it('sets isActive and resets retryCount', () => {
      const daemon = new Daemon(createMockBg());
      daemon.retryCount = 5;
      daemon.start();
      expect(daemon.isActive).toBe(true);
      expect(daemon.retryCount).toBe(0);
    });

    it('creates a chrome alarm with correct period', () => {
      const daemon = new Daemon(createMockBg());
      daemon.start();
      expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });

    it('enforces minimum 1 minute period', () => {
      const bg = createMockBg();
      (bg.bgStore.config as { backgroundUpdateInterval: number }).backgroundUpdateInterval = 30000; // 30 seconds
      const daemon = new Daemon(bg);
      daemon.start();
      expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    });

    it('clamps sub-second intervals instead of leaving polling dead', () => {
      const bg = createMockBg();
      (bg.bgStore.config as { backgroundUpdateInterval: number }).backgroundUpdateInterval = 500;
      const daemon = new Daemon(bg);
      daemon.start();
      expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    });
  });

  describe('stop', () => {
    it('sets isActive to false and clears alarm', () => {
      const daemon = new Daemon(createMockBg());
      daemon.start();
      daemon.stop();
      expect(daemon.isActive).toBe(false);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAME);
    });
  });

  describe('destroy', () => {
    it('calls stop', () => {
      const daemon = new Daemon(createMockBg());
      daemon.start();
      daemon.destroy();
      expect(daemon.isActive).toBe(false);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAME);
    });
  });

  describe('handleFire', () => {
    it('calls updateTorrents when client exists', () => {
      const bg = createMockBg();
      const daemon = new Daemon(bg);
      daemon.handleFire();
      expect(bg.client!.updateTorrents).toHaveBeenCalled();
    });

    it('does not fire when already in progress', () => {
      const bg = createMockBg();
      const daemon = new Daemon(bg);
      daemon.inProgress = true;
      daemon.handleFire();
      expect(bg.client!.updateTorrents).not.toHaveBeenCalled();
    });

    it('does not fire when client is null', () => {
      const bg = createMockBg({ client: null as never });
      const daemon = new Daemon(bg);
      daemon.handleFire();
      expect(daemon.inProgress).toBe(false);
    });

    it('resets retryCount on success', async () => {
      const bg = createMockBg();
      const daemon = new Daemon(bg);
      daemon.retryCount = 2;
      daemon.handleFire();
      await vi.waitFor(() => expect(daemon.inProgress).toBe(false));
      expect(daemon.retryCount).toBe(0);
    });

    it('increments retryCount on error', async () => {
      const bg = createMockBg();
      vi.mocked(bg.client!.updateTorrents).mockRejectedValue(new Error('Network error'));
      const daemon = new Daemon(bg);
      daemon.handleFire();
      await vi.waitFor(() => expect(daemon.inProgress).toBe(false));
      expect(daemon.retryCount).toBe(1);
    });

    it('stops after exceeding max retries', async () => {
      const bg = createMockBg();
      vi.mocked(bg.client!.updateTorrents).mockRejectedValue(new Error('Network error'));
      const daemon = new Daemon(bg);
      daemon.retryCount = 3; // Already at max
      daemon.handleFire();
      await vi.waitFor(() => expect(daemon.inProgress).toBe(false));
      expect(daemon.isActive).toBe(false);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAME);
    });

    it('sets inProgress during execution', () => {
      const bg = createMockBg();
      vi.mocked(bg.client!.updateTorrents).mockReturnValue(new Promise(() => {})); // never resolves
      const daemon = new Daemon(bg);
      daemon.handleFire();
      expect(daemon.inProgress).toBe(true);
    });

    it('clears inProgress after completion', async () => {
      const bg = createMockBg();
      const daemon = new Daemon(bg);
      daemon.handleFire();
      await vi.waitFor(() => expect(daemon.inProgress).toBe(false));
    });
  });
});
