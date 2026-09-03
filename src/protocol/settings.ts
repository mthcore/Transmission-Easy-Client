import { RPC_VERSION_4 } from '../tools/rpcCompat';

/**
 * Every uniform session-set setting, in one table — the shared description of
 * the settings protocol.
 *
 * It lives here rather than under bg/ because BOTH independently built halves
 * read it: the service worker to build the daemon payload, and the UI store to
 * know which message field carries the value. Once two units have to agree on
 * something, that something is the contract, not either one's implementation.
 *
 * These ~40 settings differ only in three facts: which key the daemon expects,
 * what type the value is, and whether writing it also flips a companion flag.
 * Restating those facts by hand in the message types, the dispatcher, the
 * client, the service and the store is what made adding one setting a
 * five-file change, and it is why several were implemented and left unwired.
 *
 * Two things this table must NOT be tidied into:
 *
 *  - `enables` is not universal. Nine settings force their companion flag,
 *    and six lookalikes deliberately do not (the alt-speed schedule fields,
 *    the blocklist URL, the incomplete directory, the done-script filename).
 *    Treating "writing a value implies enabling it" as a rule would switch on
 *    an alt-speed schedule or a post-download script the user never enabled.
 *  - `rpcKey` is not derivable from the method name. Most are kebab-case, but
 *    seedRatioLimit, seedRatioLimited and encryption are Transmission's own
 *    camelCase names, and the label a UI shows is a separate i18n key again.
 *
 * The exact payload each entry produces is pinned in
 * SettingsService.payloads.test.ts; any change here that alters one will fail
 * there.
 */
export interface SettingDescriptor {
  /** Key inside the session-set arguments object */
  rpcKey: string;
  type: 'boolean' | 'number' | 'string';
  /** Field of the message that carries the value; absent when not dispatched */
  arg?: 'enabled' | 'speed' | 'value' | 'mode' | 'dir' | 'url' | 'filename' | 'trackers';
  /** Companion flag forced true alongside the value. Deliberately not uniform */
  enables?: string;
  /** Daemon rpc-version below which the daemon rejects the key */
  rpcVersionMin?: number;
}

export const SETTING_DESCRIPTORS = {
  setAltDownloadSpeedLimit: {
    rpcKey: 'alt-speed-down',
    type: 'number',
    arg: 'speed',
    enables: 'alt-speed-enabled',
  },
  setAltSpeedEnabled: { rpcKey: 'alt-speed-enabled', type: 'boolean', arg: 'enabled' },
  setAltSpeedTimeBegin: { rpcKey: 'alt-speed-time-begin', type: 'number', arg: 'value' },
  setAltSpeedTimeDay: { rpcKey: 'alt-speed-time-day', type: 'number', arg: 'value' },
  setAltSpeedTimeEnabled: { rpcKey: 'alt-speed-time-enabled', type: 'boolean', arg: 'enabled' },
  setAltSpeedTimeEnd: { rpcKey: 'alt-speed-time-end', type: 'number', arg: 'value' },
  setAltUploadSpeedLimit: {
    rpcKey: 'alt-speed-up',
    type: 'number',
    arg: 'speed',
    enables: 'alt-speed-enabled',
  },
  setBlocklistEnabled: { rpcKey: 'blocklist-enabled', type: 'boolean', arg: 'enabled' },
  setBlocklistUrl: { rpcKey: 'blocklist-url', type: 'string', arg: 'url' },
  setDefaultTrackers: {
    rpcKey: 'default-trackers',
    type: 'string',
    arg: 'trackers',
    rpcVersionMin: RPC_VERSION_4,
  },
  setDhtEnabled: { rpcKey: 'dht-enabled', type: 'boolean', arg: 'enabled' },
  setDownloadQueueEnabled: { rpcKey: 'download-queue-enabled', type: 'boolean', arg: 'enabled' },
  setDownloadQueueSize: {
    rpcKey: 'download-queue-size',
    type: 'number',
    arg: 'value',
    enables: 'download-queue-enabled',
  },
  setDownloadSpeedLimit: {
    rpcKey: 'speed-limit-down',
    type: 'number',
    arg: 'speed',
    enables: 'speed-limit-down-enabled',
  },
  setDownloadSpeedLimitEnabled: {
    rpcKey: 'speed-limit-down-enabled',
    type: 'boolean',
    arg: 'enabled',
  },
  setEncryption: { rpcKey: 'encryption', type: 'string', arg: 'mode' },
  setIdleSeedingLimit: {
    rpcKey: 'idle-seeding-limit',
    type: 'number',
    arg: 'value',
    enables: 'idle-seeding-limit-enabled',
  },
  setIdleSeedingLimitEnabled: {
    rpcKey: 'idle-seeding-limit-enabled',
    type: 'boolean',
    arg: 'enabled',
  },
  setIncompleteDir: { rpcKey: 'incomplete-dir', type: 'string', arg: 'dir' },
  setIncompleteDirEnabled: { rpcKey: 'incomplete-dir-enabled', type: 'boolean', arg: 'enabled' },
  setLpdEnabled: { rpcKey: 'lpd-enabled', type: 'boolean', arg: 'enabled' },
  setPeerLimitGlobal: { rpcKey: 'peer-limit-global', type: 'number', arg: 'value' },
  setPeerLimitPerTorrent: { rpcKey: 'peer-limit-per-torrent', type: 'number', arg: 'value' },
  setPeerPort: { rpcKey: 'peer-port', type: 'number', arg: 'value' },
  setPexEnabled: { rpcKey: 'pex-enabled', type: 'boolean', arg: 'enabled' },
  setPortForwardingEnabled: { rpcKey: 'port-forwarding-enabled', type: 'boolean', arg: 'enabled' },
  setQueueStalledEnabled: { rpcKey: 'queue-stalled-enabled', type: 'boolean', arg: 'enabled' },
  setQueueStalledMinutes: {
    rpcKey: 'queue-stalled-minutes',
    type: 'number',
    arg: 'value',
    enables: 'queue-stalled-enabled',
  },
  setRenamePartialFiles: { rpcKey: 'rename-partial-files', type: 'boolean', arg: 'enabled' },
  setScriptTorrentAddedEnabled: {
    rpcKey: 'script-torrent-added-enabled',
    type: 'boolean',
    arg: 'enabled',
    rpcVersionMin: RPC_VERSION_4,
  },
  setScriptTorrentAddedFilename: {
    rpcKey: 'script-torrent-added-filename',
    type: 'string',
    arg: 'filename',
    rpcVersionMin: RPC_VERSION_4,
  },
  setScriptTorrentDoneEnabled: {
    rpcKey: 'script-torrent-done-enabled',
    type: 'boolean',
    arg: 'enabled',
  },
  setScriptTorrentDoneFilename: {
    rpcKey: 'script-torrent-done-filename',
    type: 'string',
    arg: 'filename',
  },
  setScriptTorrentDoneSeedingEnabled: {
    rpcKey: 'script-torrent-done-seeding-enabled',
    type: 'boolean',
    arg: 'enabled',
    rpcVersionMin: RPC_VERSION_4,
  },
  setScriptTorrentDoneSeedingFilename: {
    rpcKey: 'script-torrent-done-seeding-filename',
    type: 'string',
    arg: 'filename',
    rpcVersionMin: RPC_VERSION_4,
  },
  setSeedQueueEnabled: { rpcKey: 'seed-queue-enabled', type: 'boolean', arg: 'enabled' },
  setSeedQueueSize: {
    rpcKey: 'seed-queue-size',
    type: 'number',
    arg: 'value',
    enables: 'seed-queue-enabled',
  },
  setSeedRatioLimit: {
    rpcKey: 'seedRatioLimit',
    type: 'number',
    arg: 'value',
    enables: 'seedRatioLimited',
  },
  setSeedRatioLimited: { rpcKey: 'seedRatioLimited', type: 'boolean', arg: 'enabled' },
  setStartAddedTorrents: { rpcKey: 'start-added-torrents', type: 'boolean', arg: 'enabled' },
  setTrashOriginalTorrentFiles: {
    rpcKey: 'trash-original-torrent-files',
    type: 'boolean',
    arg: 'enabled',
  },
  setUploadSpeedLimit: {
    rpcKey: 'speed-limit-up',
    type: 'number',
    arg: 'speed',
    enables: 'speed-limit-up-enabled',
  },
  setUploadSpeedLimitEnabled: { rpcKey: 'speed-limit-up-enabled', type: 'boolean', arg: 'enabled' },
  setUtpEnabled: { rpcKey: 'utp-enabled', type: 'boolean', arg: 'enabled' },
} satisfies Record<string, SettingDescriptor>;

/**
 * `satisfies` rather than a type annotation, so the keys stay literal: the
 * dispatcher subtracts them from the message union and keeps its exhaustiveness
 * check meaningful over whatever is left.
 */
export type SettingAction = keyof typeof SETTING_DESCRIPTORS;

/** A setting the dispatcher can serve: one the message union actually carries */
export interface DispatchableSetting extends SettingDescriptor {
  arg: NonNullable<SettingDescriptor['arg']>;
}

/**
 * Undefined for an action no message carries, so such a setting falls through
 * to the dispatcher's exhaustiveness check instead of being sent to the daemon
 * with an undefined value. Every entry currently carries one; the guard stays
 * because a setting implemented on the service before it has a page is the
 * normal order of work here.
 */
export function describeSetting(action: string): DispatchableSetting | undefined {
  const descriptor = (SETTING_DESCRIPTORS as Record<string, SettingDescriptor>)[action];
  return descriptor && descriptor.arg ? (descriptor as DispatchableSetting) : undefined;
}
