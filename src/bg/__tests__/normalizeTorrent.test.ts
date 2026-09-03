import { describe, it, expect } from 'vitest';
import { normalizeTorrent } from '../normalizeTorrent';

/**
 * Every field the stores hold comes through here, and every line of it is a
 * claim about what the daemon sent. The claims are only ever checked at
 * runtime, by the value being wrong on screen.
 *
 * Two of them are decisions rather than transcription, and both have been wrong
 * before:
 *
 *  - The swarm counts are the MAXIMUM across trackers, not the sum. Every
 *    tracker scrapes the same swarm, so adding them multiplied the figure by
 *    the number of working trackers.
 *  - The eta sentinels are preserved. Transmission uses -1 for "not available"
 *    and -2 for "unknown"; defaulting them to 0 would render as "done in 0s".
 *
 * The rest is about a daemon that answers with less than expected. An older
 * Transmission, or one that was not asked for a field, simply omits it — so
 * every optional field needs a value the UI can render rather than `undefined`
 * arriving in a typed store.
 */

/** The fields a 4.x daemon sends for a healthy torrent. */
const RAW = {
  id: 7,
  status: 4,
  error: 0,
  errorString: '',
  name: 'ubuntu.iso',
  totalSize: 1000,
  sizeWhenDone: 900,
  percentDone: 0.5,
  recheckProgress: 0,
  downloadedEver: 500,
  uploadedEver: 250,
  uploadRatio: 0.5,
  rateUpload: 10,
  rateDownload: 20,
  eta: 120,
  etaIdle: -1,
  peersGettingFromUs: 2,
  peersSendingToUs: 3,
  queuePosition: 1,
  addedDate: 1_700_000_000,
  doneDate: 0,
  downloadDir: '/downloads',
  hashString: 'abc',
};

const of = (overrides: Record<string, unknown> = {}) =>
  normalizeTorrent({ ...RAW, ...overrides }) as unknown as Record<string, unknown>;

describe('normalizeTorrent — the swarm', () => {
  it('takes the largest count across trackers, not their sum', () => {
    // Summing multiplied the swarm by the number of working trackers.
    const torrent = of({
      trackerStats: [
        { seederCount: 50, leecherCount: 20 },
        { seederCount: 30, leecherCount: 25 },
      ],
    });

    expect(torrent.seeds).toBe(50);
    expect(torrent.peers).toBe(25);
  });

  it('reports no swarm when the daemon sent no tracker stats', () => {
    // trackerStats is only requested while its columns are shown.
    const torrent = of({});

    expect(torrent.seeds).toBe(0);
    expect(torrent.peers).toBe(0);
  });

  it('ignores a trackerStats that is not a list', () => {
    const torrent = of({ trackerStats: 'unexpected' });

    expect(torrent.seeds).toBe(0);
  });

  it('keeps the connected-peer counts separate from the swarm', () => {
    // "2 of 25" — how many we are talking to, and how many exist.
    const torrent = of({
      peersGettingFromUs: 2,
      peersSendingToUs: 3,
      trackerStats: [{ seederCount: 50, leecherCount: 25 }],
    });

    expect(torrent.activePeers).toBe(2);
    expect(torrent.activeSeeds).toBe(3);
    expect(torrent.peers).toBe(25);
  });
});

describe('normalizeTorrent — the eta sentinels', () => {
  it('keeps a real estimate', () => {
    expect(of({ eta: 120 }).eta).toBe(120);
  });

  it('keeps -1, which means the daemon cannot say', () => {
    // Defaulting it to 0 renders as "done in 0s" on a torrent that is stalled.
    expect(of({ eta: -1 }).eta).toBe(-1);
  });

  it('keeps -2, which means unknown', () => {
    expect(of({ eta: -2 }).eta).toBe(-2);
  });

  it('falls back to -1 when the field is missing entirely', () => {
    // Absent is not "finished"; it is the same as "cannot say".
    const { eta, ...raw } = { ...RAW };
    void eta;
    expect((normalizeTorrent(raw) as unknown as Record<string, unknown>).eta).toBe(-1);
  });
});

describe('normalizeTorrent — a daemon that sends less', () => {
  const without = (field: string) => {
    const raw: Record<string, unknown> = { ...RAW };
    delete raw[field];
    return normalizeTorrent(raw) as unknown as Record<string, unknown>;
  };

  it.each([
    ['labels', 'labels', []],
    ['bandwidthPriority', 'bandwidthPriority', 0],
    ['peersConnected', 'peersConnected', 0],
    ['metadataPercentComplete', 'metadataPercentComplete', 1],
    ['isStalled', 'isStalled', false],
    ['isPrivate', 'isPrivate', false],
    ['isFinished', 'isFinished', false],
    ['activityDate', 'activityDate', 0],
    ['startDate', 'startDate', 0],
  ])('gives %s a value the UI can render', (_label, field, expected) => {
    expect(without(field)[field]).toEqual(expected);
  });

  it('assumes complete metadata rather than none', () => {
    // A daemon that does not report it has the whole torrent; defaulting to 0
    // would show every torrent as still fetching its metadata.
    expect(without('metadataPercentComplete').metadataPercentComplete).toBe(1);
  });

  it('falls back to the total size when the wanted size is absent', () => {
    // sizeWhenDone differs only when files are deselected.
    expect(without('sizeWhenDone').sizeWhenDone).toBe(RAW.totalSize);
  });

  it('leaves the magnet link undefined rather than inventing one', () => {
    // The menu rebuilds it from the hash; an empty string would look like a
    // link and copy nothing.
    expect(without('magnetLink').magnetLink).toBeUndefined();
  });
});

describe('normalizeTorrent — sequential download', () => {
  it('reads the snake_case name Transmission actually sends', () => {
    expect(of({ sequential_download: true }).sequentialDownload).toBe(true);
  });

  it('accepts the camelCase spelling too', () => {
    // Both appear in the wild depending on the daemon build.
    expect(of({ sequentialDownload: true }).sequentialDownload).toBe(true);
  });

  it('prefers the snake_case one when a daemon sends both', () => {
    expect(of({ sequential_download: true, sequentialDownload: false }).sequentialDownload).toBe(
      true
    );
  });

  it('leaves it undefined on a daemon that has no such field', () => {
    // Below Transmission 4.1 it does not exist, and the menu entry is hidden.
    expect(of({}).sequentialDownload).toBeUndefined();
  });
});

describe('normalizeTorrent — what it carries through', () => {
  it('keeps the identity the stores key on', () => {
    const torrent = of({});

    expect(torrent.id).toBe(7);
    expect(torrent.hashString).toBe('abc');
  });

  it('keeps the hash undefined rather than empty when absent', () => {
    // The stores replace a node when the same id arrives under a DIFFERENT
    // hash; an empty string would compare unequal to every real hash and
    // replace the node on every poll.
    const raw: Record<string, unknown> = { ...RAW };
    delete raw.hashString;

    expect(
      (normalizeTorrent(raw) as unknown as Record<string, unknown>).hashString
    ).toBeUndefined();
  });

  it('carries the daemon error through untouched', () => {
    const torrent = of({ error: 2, errorString: 'Unregistered torrent' });

    expect(torrent.errorCode).toBe(2);
    expect(torrent.errorString).toBe('Unregistered torrent');
  });
});
