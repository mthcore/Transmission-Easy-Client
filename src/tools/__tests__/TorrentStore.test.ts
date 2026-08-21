import { describe, it, expect } from 'vitest';
import TorrentStore from '../../stores/TorrentStore';

function createTorrent(overrides: Partial<Record<string, unknown>> = {}) {
  return TorrentStore.create({
    id: 1,
    statusCode: 4,
    errorCode: 0,
    errorString: '',
    name: 'Test Torrent',
    size: 1000000,
    percentDone: 0.5,
    recheckProgress: 0,
    downloaded: 500000,
    uploaded: 250000,
    shared: 500,
    uploadSpeed: 1024,
    downloadSpeed: 2048,
    eta: 3600,
    activePeers: 5,
    peers: 10,
    activeSeeds: 3,
    seeds: 8,
    order: 1,
    addedTime: 1700000000,
    completedTime: 0,
    directory: '/downloads',
    magnetLink: 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test',
    hashString: undefined,
    isStalled: false,
    peersConnected: 7,
    labels: [],
    bandwidthPriority: 0,
    ...overrides,
  } as never);
}

describe('TorrentStore computed views', () => {
  describe('remaining / remainingStr', () => {
    it('derives remaining bytes from percentDone', () => {
      const t = createTorrent({ size: 1000, sizeWhenDone: 1000, percentDone: 0.7 });
      expect(t.remaining).toBe(300);
    });

    it('returns 0 for a complete torrent seeded from existing data', () => {
      // downloadedEver is 0 here: deriving from it reported the whole size
      const t = createTorrent({ size: 1000, sizeWhenDone: 1000, percentDone: 1, downloaded: 0 });
      expect(t.remaining).toBe(0);
    });

    it('ignores lifetime downloadedEver overshoot on a re-download', () => {
      const t = createTorrent({
        size: 1000,
        sizeWhenDone: 1000,
        percentDone: 0.5,
        downloaded: 1800,
      });
      expect(t.remaining).toBe(500);
    });
  });

  describe('isCompleted', () => {
    it('returns true when percentDone is 1', () => {
      const t = createTorrent({ percentDone: 1 });
      expect(t.isCompleted).toBe(true);
    });

    it('returns false when percentDone < 1', () => {
      const t = createTorrent({ percentDone: 0.99 });
      expect(t.isCompleted).toBe(false);
    });
  });

  describe('progress / progressStr', () => {
    it('computes progress as integer per-mille', () => {
      const t = createTorrent({ percentDone: 0.5, recheckProgress: 0 });
      expect(t.progress).toBe(500);
    });

    it('uses recheckProgress while the torrent is checking', () => {
      const t = createTorrent({ percentDone: 0.5, recheckProgress: 0.3, statusCode: 2 });
      expect(t.progress).toBe(300);
    });

    it('shows recheckProgress even at exactly 0 while checking', () => {
      const t = createTorrent({ percentDone: 1, recheckProgress: 0, statusCode: 2 });
      expect(t.progress).toBe(0);
    });

    it('ignores a stale recheckProgress when not checking', () => {
      const t = createTorrent({ percentDone: 0.5, recheckProgress: 0.3, statusCode: 4 });
      expect(t.progress).toBe(500);
    });

    it('formats progress below 100% with one decimal', () => {
      const t = createTorrent({ percentDone: 0.505, recheckProgress: 0 });
      expect(t.progressStr).toBe('50.5%');
    });

    it('formats 100% as integer', () => {
      const t = createTorrent({ percentDone: 1, recheckProgress: 0 });
      expect(t.progressStr).toBe('100%');
    });
  });

  describe('speed strings', () => {
    it('returns empty string for zero upload speed', () => {
      const t = createTorrent({ uploadSpeed: 0 });
      expect(t.uploadSpeedStr).toBe('');
    });

    it('returns formatted string for non-zero upload speed', () => {
      const t = createTorrent({ uploadSpeed: 1024 });
      expect(t.uploadSpeedStr).not.toBe('');
    });

    it('returns empty string for zero download speed', () => {
      const t = createTorrent({ downloadSpeed: 0 });
      expect(t.downloadSpeedStr).toBe('');
    });

    it('returns formatted string for non-zero download speed', () => {
      const t = createTorrent({ downloadSpeed: 2048 });
      expect(t.downloadSpeedStr).not.toBe('');
    });
  });

  describe('stateText', () => {
    it('returns OV_FL_FINISHED for stopped + complete', () => {
      const t = createTorrent({ statusCode: 0, percentDone: 1 });
      expect(t.stateText).toBe('OV_FL_FINISHED');
    });

    it('returns OV_FL_STOPPED for stopped + incomplete', () => {
      const t = createTorrent({ statusCode: 0, percentDone: 0.5 });
      expect(t.stateText).toBe('OV_FL_STOPPED');
    });

    it('returns OV_FL_QUEUED for status 1 (queue to check)', () => {
      const t = createTorrent({ statusCode: 1 });
      expect(t.stateText).toBe('OV_FL_QUEUED');
    });

    it('returns OV_FL_CHECKED with progress for status 2', () => {
      const t = createTorrent({ statusCode: 2, recheckProgress: 0.45 });
      expect(t.stateText).toBe('OV_FL_CHECKED 45.0%');
    });

    it('returns OV_FL_DOWNLOADING for status 4', () => {
      const t = createTorrent({ statusCode: 4, isStalled: false });
      expect(t.stateText).toBe('OV_FL_DOWNLOADING');
    });

    it('adds stalled indicator for stalled download', () => {
      const t = createTorrent({ statusCode: 4, isStalled: true });
      expect(t.stateText).toBe('OV_FL_DOWNLOADING (OV_FL_STALLED)');
    });

    it('returns OV_FL_SEEDING for status 6', () => {
      const t = createTorrent({ statusCode: 6, isStalled: false });
      expect(t.stateText).toBe('OV_FL_SEEDING');
    });

    it('adds stalled indicator for stalled seeding', () => {
      const t = createTorrent({ statusCode: 6, isStalled: true });
      expect(t.stateText).toBe('OV_FL_SEEDING (OV_FL_STALLED)');
    });
  });

  describe('status booleans', () => {
    it('isStopped for statusCode 0', () => {
      expect(createTorrent({ statusCode: 0 }).isStopped).toBe(true);
      expect(createTorrent({ statusCode: 4 }).isStopped).toBe(false);
    });

    it('isChecking for statusCode 2', () => {
      expect(createTorrent({ statusCode: 2 }).isChecking).toBe(true);
      expect(createTorrent({ statusCode: 4 }).isChecking).toBe(false);
    });

    it('isDownloading for statusCode 4', () => {
      expect(createTorrent({ statusCode: 4 }).isDownloading).toBe(true);
      expect(createTorrent({ statusCode: 6 }).isDownloading).toBe(false);
    });

    it('isSeeding for statusCode 6', () => {
      expect(createTorrent({ statusCode: 6 }).isSeeding).toBe(true);
      expect(createTorrent({ statusCode: 4 }).isSeeding).toBe(false);
    });

    it('isQueuedToSeed for statusCode 5', () => {
      expect(createTorrent({ statusCode: 5 }).isQueuedToSeed).toBe(true);
    });
  });

  describe('isActive', () => {
    it('returns true when downloading', () => {
      expect(createTorrent({ downloadSpeed: 100, uploadSpeed: 0 }).isActive).toBe(true);
    });

    it('returns true when uploading', () => {
      expect(createTorrent({ downloadSpeed: 0, uploadSpeed: 100 }).isActive).toBe(true);
    });

    it('returns false when no speed', () => {
      expect(createTorrent({ downloadSpeed: 0, uploadSpeed: 0 }).isActive).toBe(false);
    });
  });

  describe('isFinished', () => {
    it('returns true when isFinished field is true', () => {
      expect(createTorrent({ isFinished: true }).isFinished).toBe(true);
    });

    it('returns false when isFinished field is false', () => {
      expect(createTorrent({ isFinished: false }).isFinished).toBe(false);
    });

    it('defaults to false when not provided', () => {
      expect(createTorrent({}).isFinished).toBe(false);
    });
  });

  describe('errorMessage', () => {
    it('returns empty string for no error', () => {
      const t = createTorrent({ errorCode: 0, errorString: '' });
      expect(t.errorMessage).toBe('');
    });

    it('returns error message with prefix stripped', () => {
      const t = createTorrent({ errorCode: 1, errorString: 'Error: tracker timeout' });
      expect(t.errorMessage).toBe('OV_FL_ERROR: tracker timeout');
    });

    it('returns generic error for empty errorString', () => {
      const t = createTorrent({ errorCode: 1, errorString: '' });
      expect(t.errorMessage).toBe('OV_FL_ERROR');
    });
  });

  describe('hash', () => {
    it('returns uppercase hashString when available', () => {
      const t = createTorrent({ hashString: 'abcdef1234567890abcdef1234567890abcdef12' });
      expect(t.hash).toBe('ABCDEF1234567890ABCDEF1234567890ABCDEF12');
    });

    it('extracts hash from magnetLink when no hashString', () => {
      const t = createTorrent({
        hashString: undefined,
        magnetLink: 'magnet:?xt=urn:btih:aabbccddee1234567890aabbccddee1234567890&dn=test',
      });
      expect(t.hash).toBe('AABBCCDDEE1234567890AABBCCDDEE1234567890');
    });

    it('returns null when no hash source', () => {
      const t = createTorrent({ hashString: undefined, magnetLink: undefined });
      expect(t.hash).toBeNull();
    });
  });

  describe('bandwidthPriorityStr', () => {
    it('returns MF_LOW for -1', () => {
      expect(createTorrent({ bandwidthPriority: -1 }).bandwidthPriorityStr).toBe('MF_LOW');
    });

    it('returns MF_NORMAL for 0', () => {
      expect(createTorrent({ bandwidthPriority: 0 }).bandwidthPriorityStr).toBe('MF_NORMAL');
    });

    it('returns MF_HIGH for 1', () => {
      expect(createTorrent({ bandwidthPriority: 1 }).bandwidthPriorityStr).toBe('MF_HIGH');
    });
  });

  describe('labelsStr', () => {
    it('returns empty string for no labels', () => {
      expect(createTorrent({ labels: [] }).labelsStr).toBe('');
    });

    it('joins labels with comma', () => {
      expect(createTorrent({ labels: ['movies', 'hd'] }).labelsStr).toBe('movies, hd');
    });
  });

  describe('addedTimeStr / completedTimeStr', () => {
    it('returns a dash for zero addedTime', () => {
      expect(createTorrent({ addedTime: 0 }).addedTimeStr).toBe('-');
    });

    it('returns formatted date for non-zero addedTime', () => {
      const t = createTorrent({ addedTime: 1700000000 });
      expect(t.addedTimeStr).not.toBe('-');
    });

    it('returns a dash for zero completedTime', () => {
      expect(createTorrent({ completedTime: 0 }).completedTimeStr).toBe('-');
    });

    it('formats the share ratio with two decimals', () => {
      expect(createTorrent({ shared: 123 }).sharedStr).toBe('0.12');
      expect(createTorrent({ shared: 1000 }).sharedStr).toBe('1.00');
    });
  });

  describe('actions', () => {
    it('includes start when stopped', () => {
      const t = createTorrent({ statusCode: 0 });
      expect(t.actions).toContain('start');
      expect(t.actions).not.toContain('stop');
    });

    it('includes stop when active', () => {
      const t = createTorrent({ statusCode: 4 });
      expect(t.actions).toContain('stop');
      expect(t.actions).not.toContain('start');
    });

    it('includes forcestart when stopped or queued', () => {
      expect(createTorrent({ statusCode: 0 }).actions).toContain('forcestart');
      expect(createTorrent({ statusCode: 1 }).actions).toContain('forcestart');
      expect(createTorrent({ statusCode: 3 }).actions).toContain('forcestart');
      expect(createTorrent({ statusCode: 5 }).actions).toContain('forcestart');
    });

    it('excludes recheck when checking', () => {
      expect(createTorrent({ statusCode: 2 }).actions).not.toContain('recheck');
      expect(createTorrent({ statusCode: 4 }).actions).toContain('recheck');
    });
  });
});
