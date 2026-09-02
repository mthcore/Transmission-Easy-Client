import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsService from '../SettingsService';
import { RPC_VERSION_4 } from '../../tools/rpcCompat';

/**
 * The wire contract of every session-set method: the exact
 * `{method, arguments}` handed to the transport, key spelling included.
 *
 * These ~40 methods are near-identical by hand, which makes them a natural
 * target for consolidation behind one generic path. The only thing that makes
 * such a change safe is a test that fails the moment a payload differs, so any
 * setting whose payload cannot be reproduced exactly must keep its own method.
 *
 * Three shapes are pinned, and the differences between them are the trap:
 *
 *  1. SIMPLE      one key, one value
 *  2. AUTO-ENABLE writing a value ALSO forces its companion `-enabled` to true
 *  3. RPC-GATED   rejects when the daemon is known to be older than RPC 17
 *
 * Shape 2 is not uniform across the API (see the asymmetry test at the end),
 * so any generic path assuming it applies everywhere would silently enable
 * settings the user never enabled.
 */

type Payload = { method: string; arguments: Record<string, unknown> };

function createTransport(rpcVersion = 0) {
  const sendAction = vi.fn((query: Payload) => {
    if (query.method === 'session-get') {
      // Enough for normalizeSettings: every field is read through readKey with
      // a default, so an empty bag is a valid response.
      return Promise.resolve({ result: 'success', arguments: {} });
    }
    return Promise.resolve({ result: 'success', arguments: {} });
  });
  return { sendAction, rpcVersion };
}

function createService(rpcVersion = 0) {
  const transport = createTransport(rpcVersion);
  const applySettings = vi.fn();
  const service = new SettingsService(transport as never, applySettings);
  return { service, transport, applySettings };
}

/** The first call is always the mutation; session-get follows as the echo. */
const mutation = (transport: { sendAction: ReturnType<typeof vi.fn> }): Payload =>
  transport.sendAction.mock.calls[0][0];

type Case = { method: string; args: unknown[]; expected: Record<string, unknown> };

const SIMPLE: Case[] = [
  {
    method: 'setDownloadSpeedLimitEnabled',
    args: [true],
    expected: { 'speed-limit-down-enabled': true },
  },
  {
    method: 'setUploadSpeedLimitEnabled',
    args: [false],
    expected: { 'speed-limit-up-enabled': false },
  },
  { method: 'setAltSpeedEnabled', args: [true], expected: { 'alt-speed-enabled': true } },
  { method: 'setBlocklistEnabled', args: [true], expected: { 'blocklist-enabled': true } },
  {
    method: 'setBlocklistUrl',
    args: ['http://list'],
    expected: { 'blocklist-url': 'http://list' },
  },
  { method: 'setPeerLimitGlobal', args: [240], expected: { 'peer-limit-global': 240 } },
  { method: 'setPeerLimitPerTorrent', args: [60], expected: { 'peer-limit-per-torrent': 60 } },
  // camelCase on purpose: these are Transmission's own key names, and they are
  // the exception among otherwise kebab-case keys
  { method: 'setSeedRatioLimited', args: [true], expected: { seedRatioLimited: true } },
  {
    method: 'setIdleSeedingLimitEnabled',
    args: [true],
    expected: { 'idle-seeding-limit-enabled': true },
  },
  { method: 'setPeerPort', args: [51413], expected: { 'peer-port': 51413 } },
  {
    method: 'setPortForwardingEnabled',
    args: [true],
    expected: { 'port-forwarding-enabled': true },
  },
  { method: 'setEncryption', args: ['required'], expected: { encryption: 'required' } },
  { method: 'setDhtEnabled', args: [false], expected: { 'dht-enabled': false } },
  { method: 'setPexEnabled', args: [false], expected: { 'pex-enabled': false } },
  { method: 'setLpdEnabled', args: [true], expected: { 'lpd-enabled': true } },
  { method: 'setUtpEnabled', args: [true], expected: { 'utp-enabled': true } },
  { method: 'setIncompleteDirEnabled', args: [true], expected: { 'incomplete-dir-enabled': true } },
  { method: 'setIncompleteDir', args: ['/tmp/x'], expected: { 'incomplete-dir': '/tmp/x' } },
  { method: 'setRenamePartialFiles', args: [false], expected: { 'rename-partial-files': false } },
  { method: 'setDownloadQueueEnabled', args: [true], expected: { 'download-queue-enabled': true } },
  { method: 'setSeedQueueEnabled', args: [true], expected: { 'seed-queue-enabled': true } },
  { method: 'setQueueStalledEnabled', args: [true], expected: { 'queue-stalled-enabled': true } },
  { method: 'setStartAddedTorrents', args: [false], expected: { 'start-added-torrents': false } },
  {
    method: 'setTrashOriginalTorrentFiles',
    args: [true],
    expected: { 'trash-original-torrent-files': true },
  },
  { method: 'setAltSpeedTimeEnabled', args: [true], expected: { 'alt-speed-time-enabled': true } },
  { method: 'setAltSpeedTimeBegin', args: [540], expected: { 'alt-speed-time-begin': 540 } },
  { method: 'setAltSpeedTimeEnd', args: [1020], expected: { 'alt-speed-time-end': 1020 } },
  { method: 'setAltSpeedTimeDay', args: [127], expected: { 'alt-speed-time-day': 127 } },
  {
    method: 'setScriptTorrentDoneEnabled',
    args: [true],
    expected: { 'script-torrent-done-enabled': true },
  },
  {
    method: 'setScriptTorrentDoneFilename',
    args: ['/s.sh'],
    expected: { 'script-torrent-done-filename': '/s.sh' },
  },
];

const AUTO_ENABLE: Case[] = [
  {
    method: 'setDownloadSpeedLimit',
    args: [512],
    expected: { 'speed-limit-down-enabled': true, 'speed-limit-down': 512 },
  },
  {
    method: 'setUploadSpeedLimit',
    args: [256],
    expected: { 'speed-limit-up-enabled': true, 'speed-limit-up': 256 },
  },
  {
    method: 'setAltDownloadSpeedLimit',
    args: [100],
    expected: { 'alt-speed-enabled': true, 'alt-speed-down': 100 },
  },
  {
    method: 'setAltUploadSpeedLimit',
    args: [50],
    expected: { 'alt-speed-enabled': true, 'alt-speed-up': 50 },
  },
  {
    method: 'setSeedRatioLimit',
    args: [2.5],
    expected: { seedRatioLimited: true, seedRatioLimit: 2.5 },
  },
  {
    method: 'setIdleSeedingLimit',
    args: [30],
    expected: { 'idle-seeding-limit-enabled': true, 'idle-seeding-limit': 30 },
  },
  {
    method: 'setDownloadQueueSize',
    args: [5],
    expected: { 'download-queue-enabled': true, 'download-queue-size': 5 },
  },
  {
    method: 'setSeedQueueSize',
    args: [10],
    expected: { 'seed-queue-enabled': true, 'seed-queue-size': 10 },
  },
  {
    method: 'setQueueStalledMinutes',
    args: [30],
    expected: { 'queue-stalled-enabled': true, 'queue-stalled-minutes': 30 },
  },
];

const RPC4_GATED: Case[] = [
  {
    method: 'setScriptTorrentAddedEnabled',
    args: [true],
    expected: { 'script-torrent-added-enabled': true },
  },
  {
    method: 'setScriptTorrentAddedFilename',
    args: ['/a.sh'],
    expected: { 'script-torrent-added-filename': '/a.sh' },
  },
  {
    method: 'setScriptTorrentDoneSeedingEnabled',
    args: [false],
    expected: { 'script-torrent-done-seeding-enabled': false },
  },
  {
    method: 'setScriptTorrentDoneSeedingFilename',
    args: ['/d.sh'],
    expected: { 'script-torrent-done-seeding-filename': '/d.sh' },
  },
  {
    method: 'setDefaultTrackers',
    args: ['udp://tr'],
    expected: { 'default-trackers': 'udp://tr' },
  },
];

const invoke = (service: SettingsService, name: string, args: unknown[]): Promise<void> =>
  (service as unknown as Record<string, (...a: unknown[]) => Promise<void>>)[name](...args);

describe('SettingsService session-set payloads (wire contract)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('shape 1 — one key, one value', () => {
    it.each(SIMPLE)('$method sends $expected', async ({ method, args, expected }) => {
      const { service, transport } = createService();
      await invoke(service, method, args);
      expect(mutation(transport)).toEqual({ method: 'session-set', arguments: expected });
    });
  });

  describe('shape 2 — writing a value also enables it', () => {
    it.each(AUTO_ENABLE)('$method sends $expected', async ({ method, args, expected }) => {
      const { service, transport } = createService();
      await invoke(service, method, args);
      expect(mutation(transport)).toEqual({ method: 'session-set', arguments: expected });
    });
  });

  describe('shape 3 — gated on RPC 17', () => {
    it.each(RPC4_GATED)(
      '$method sends $expected on a 4.x daemon',
      async ({ method, args, expected }) => {
        const { service, transport } = createService(RPC_VERSION_4);
        await invoke(service, method, args);
        expect(mutation(transport)).toEqual({ method: 'session-set', arguments: expected });
      }
    );

    it.each(RPC4_GATED)('$method rejects on a known older daemon', async ({ method, args }) => {
      const { service, transport } = createService(RPC_VERSION_4 - 1);
      await expect(invoke(service, method, args)).rejects.toThrow(/requires Transmission RPC 17/);
      // Nothing must reach the daemon when the gate rejects
      expect(transport.sendAction).not.toHaveBeenCalled();
    });

    it.each(RPC4_GATED)(
      '$method proceeds when the version is not yet known (0)',
      async ({ method, args }) => {
        // Fail-open by design: an MV3 wake-up can fire before session-get lands,
        // and blocking there would break the call for no reason.
        const { service, transport } = createService(0);
        await invoke(service, method, args);
        expect(mutation(transport).method).toBe('session-set');
      }
    );
  });

  describe('the echo after a mutation', () => {
    it('follows every session-set with session-get, and NOT session-stats', async () => {
      const { service, transport } = createService();
      await service.setDhtEnabled(true);

      const methods = transport.sendAction.mock.calls.map((call) => call[0].method);
      // Paying two RPCs per options toggle is waste: nothing a setting change
      // does moves the session counters.
      expect(methods).toEqual(['session-set', 'session-get']);
    });

    it('applies the refreshed settings to the store', async () => {
      const { service, applySettings } = createService();
      await service.setDhtEnabled(true);
      expect(applySettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('the auto-enable asymmetry — do NOT regularise it', () => {
    // These write a value WITHOUT touching their companion flag, unlike the
    // nine in AUTO_ENABLE. Treating "value implies enabled" as a universal rule
    // would start enabling settings the user never turned on — an alt-speed
    // schedule or a post-download script firing unbidden.
    it.each([
      { method: 'setAltSpeedTimeBegin', args: [540], absent: 'alt-speed-time-enabled' },
      { method: 'setAltSpeedTimeEnd', args: [1020], absent: 'alt-speed-time-enabled' },
      { method: 'setAltSpeedTimeDay', args: [127], absent: 'alt-speed-time-enabled' },
      { method: 'setBlocklistUrl', args: ['http://l'], absent: 'blocklist-enabled' },
      { method: 'setIncompleteDir', args: ['/x'], absent: 'incomplete-dir-enabled' },
      {
        method: 'setScriptTorrentDoneFilename',
        args: ['/s.sh'],
        absent: 'script-torrent-done-enabled',
      },
    ])('$method does NOT set $absent', async ({ method, args, absent }) => {
      const { service, transport } = createService();
      await invoke(service, method, args);
      expect(mutation(transport).arguments).not.toHaveProperty(absent);
    });
  });

  describe('coverage of the contract itself', () => {
    it('pins every session-set method the service exposes', () => {
      const covered = new Set(
        [...SIMPLE, ...AUTO_ENABLE, ...RPC4_GATED].map((entry) => entry.method)
      );
      const { service } = createService();
      // Arrow-function properties live on the instance, not the prototype
      const exposed = Object.keys(service).filter(
        (key) =>
          key.startsWith('set') &&
          typeof (service as unknown as Record<string, unknown>)[key] === 'function'
      );
      const unpinned = exposed.filter((name) => !covered.has(name));
      // A new session-set method must arrive with its payload pinned here, or
      // there is nothing to verify a later consolidation against.
      expect(unpinned).toEqual([]);
    });
  });
});
