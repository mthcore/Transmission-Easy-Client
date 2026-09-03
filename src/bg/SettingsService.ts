import type TransmissionTransport from './TransmissionTransport';
import { readKey, assertRpcVersion, RPC_VERSION_4, RPC_VERSION_4_1 } from '../tools/rpcCompat';
import { SETTING_DESCRIPTORS, type SettingDescriptor } from '../protocol/settings';
import ErrorWithCode from '../tools/ErrorWithCode';
import { BLOCKLIST_UPDATE_TIMEOUT } from '../constants';
import type { SessionStatistics, BandwidthGroup } from '../types/transmission';

/** Map a missing field or Transmission's -1 'unknown' sentinel to undefined */
function normalizeFreeSpace(value: number | undefined): number | undefined {
  return typeof value === 'number' && value >= 0 ? value : undefined;
}

export interface NormalizedSettings {
  downloadSpeedLimit: number;
  downloadSpeedLimitEnabled: boolean;
  uploadSpeedLimit: number;
  uploadSpeedLimitEnabled: boolean;
  altSpeedEnabled: boolean;
  altDownloadSpeedLimit: number;
  altUploadSpeedLimit: number;
  downloadDir: string;
  // undefined when the daemon omits the deprecated field (RPC 17+) or reports
  // the -1 'unknown' sentinel — lets the free-space RPC fallback engage
  downloadDirFreeSpace: number | undefined;
  // From session-stats current-stats; undefined when that call failed
  sessionDownloaded?: number;
  sessionUploaded?: number;
  blocklistEnabled: boolean;
  blocklistUrl: string;
  blocklistSize: number;
  peerLimitGlobal: number;
  peerLimitPerTorrent: number;
  seedRatioLimit: number;
  seedRatioLimited: boolean;
  idleSeedingLimit: number;
  idleSeedingLimitEnabled: boolean;
  peerPort: number;
  portForwardingEnabled: boolean;
  encryption: string;
  dhtEnabled: boolean;
  pexEnabled: boolean;
  lpdEnabled: boolean;
  utpEnabled: boolean;
  incompleteDirEnabled: boolean;
  incompleteDir: string;
  renamePartialFiles: boolean;
  downloadQueueEnabled: boolean;
  downloadQueueSize: number;
  seedQueueEnabled: boolean;
  seedQueueSize: number;
  queueStalledEnabled: boolean;
  queueStalledMinutes: number;
  startAddedTorrents: boolean;
  trashOriginalTorrentFiles: boolean;
  altSpeedTimeEnabled: boolean;
  altSpeedTimeBegin: number;
  altSpeedTimeEnd: number;
  altSpeedTimeDay: number;
  scriptTorrentDoneEnabled: boolean;
  scriptTorrentDoneFilename: string;
  // v4.0.0+ fields
  scriptTorrentAddedEnabled?: boolean;
  scriptTorrentAddedFilename?: string;
  scriptTorrentDoneSeedingEnabled?: boolean;
  scriptTorrentDoneSeedingFilename?: string;
  defaultTrackers?: string;
  rpcVersion: number;
  rpcVersionSemver?: string;
  version?: string;
}

export interface NormalizedSessionStats {
  activeTorrentCount: number;
  downloadSpeed: number;
  pausedTorrentCount: number;
  torrentCount: number;
  uploadSpeed: number;
  cumulativeStats: SessionStatistics;
  currentStats: SessionStatistics;
}

export interface NormalizedBandwidthGroup {
  name: string;
  honorsSessionLimits: boolean;
  speedLimitDown: number;
  speedLimitDownEnabled: boolean;
  speedLimitUp: number;
  speedLimitUpEnabled: boolean;
}

class SettingsService {
  private transport: TransmissionTransport;
  private applySettings: (settings: NormalizedSettings) => void;
  private _lastSessionStats: { sessionDownloaded?: number; sessionUploaded?: number } = {};

  constructor(
    transport: TransmissionTransport,
    applySettings: (settings: NormalizedSettings) => void
  ) {
    this.transport = transport;
    this.applySettings = applySettings;
  }

  /**
   * @param withStats also fetch session-stats (the footer's session counters).
   * Off for the echo after a session-set: nothing a setting change does moves
   * those counters, and paying two RPCs per options toggle is pure waste.
   */
  updateSettings(withStats = true): Promise<void> {
    return this.transport.sendAction({ method: 'session-get' }).then((response) => {
      const settings = response.arguments as Record<string, unknown>;
      this.transport.rpcVersion = readKey<number>(settings, 'rpc-version', 0);
      const normalized = this.normalizeSettings(settings);
      if (!withStats) {
        this.applySettings({ ...normalized, ...this._lastSessionStats });
        return;
      }
      // The daemon owns the session counters; summing per-torrent lifetime
      // totals in the UI reports all-time bytes and can even go down when a
      // torrent is removed. Best-effort: a failure here must not fail settings.
      return this.getSessionStats().then(
        (stats) => {
          this._lastSessionStats = {
            sessionDownloaded: stats.currentStats.downloadedBytes,
            sessionUploaded: stats.currentStats.uploadedBytes,
          };
          this.applySettings({ ...normalized, ...this._lastSessionStats });
        },
        () => {
          // Reuse the last known counters: dropping them would flip the footer
          // back to the per-torrent lifetime sum, so the displayed totals would
          // jump between two completely different quantities
          this.applySettings({ ...normalized, ...this._lastSessionStats });
        }
      );
    });
  }

  getSessionStats(): Promise<NormalizedSessionStats> {
    return this.transport.sendAction({ method: 'session-stats' }).then((response) => {
      const args = response.arguments as Record<string, unknown>;
      const cumulative = (args['cumulative_stats'] ?? args['cumulative-stats'] ?? {}) as Record<
        string,
        unknown
      >;
      const current = (args['current_stats'] ?? args['current-stats'] ?? {}) as Record<
        string,
        unknown
      >;
      return {
        activeTorrentCount: (args['active_torrent_count'] ??
          args['activeTorrentCount'] ??
          0) as number,
        downloadSpeed: (args['download_speed'] ?? args['downloadSpeed'] ?? 0) as number,
        pausedTorrentCount: (args['paused_torrent_count'] ??
          args['pausedTorrentCount'] ??
          0) as number,
        torrentCount: (args['torrent_count'] ?? args['torrentCount'] ?? 0) as number,
        uploadSpeed: (args['upload_speed'] ?? args['uploadSpeed'] ?? 0) as number,
        cumulativeStats: this.normalizeStatistics(cumulative),
        currentStats: this.normalizeStatistics(current),
      };
    });
  }

  getFreeSpace(path: string): Promise<{ path: string; sizeBytes: number; totalSize?: number }> {
    return this.transport
      .sendAction({
        method: 'free-space',
        arguments: { path },
      })
      .then((response) => {
        const args = response.arguments as Record<string, unknown>;
        return {
          path: args.path as string,
          sizeBytes: readKey<number>(args, 'size-bytes', 0),
          totalSize: readKey<number>(args, 'total-size', 0) || undefined,
        };
      });
  }

  /** Rejects when the daemon version is known and below `min` (backstop for UI gating). */
  private requireRpc(min: number, what: string): Promise<void> {
    return Promise.resolve().then(() => assertRpcVersion(this.transport.rpcVersion, min, what));
  }

  // Bandwidth groups (v4.0.0+)
  getGroups(names?: string[]): Promise<NormalizedBandwidthGroup[]> {
    const args: Record<string, unknown> = {};
    if (names) {
      args.group = names;
    }
    return this.requireRpc(RPC_VERSION_4, 'group-get')
      .then(() => this.transport.sendAction({ method: 'group-get', arguments: args }))
      .then((response) => {
        const result = response.arguments as { group: BandwidthGroup[] };
        return (result.group || []).map((g): NormalizedBandwidthGroup => ({
          name: g.name,
          honorsSessionLimits: g.honorsSessionLimits,
          speedLimitDown: readKey<number>(
            g as unknown as Record<string, unknown>,
            'speed-limit-down',
            0
          ),
          speedLimitDownEnabled: readKey<boolean>(
            g as unknown as Record<string, unknown>,
            'speed-limit-down-enabled',
            false
          ),
          speedLimitUp: readKey<number>(
            g as unknown as Record<string, unknown>,
            'speed-limit-up',
            0
          ),
          speedLimitUpEnabled: readKey<boolean>(
            g as unknown as Record<string, unknown>,
            'speed-limit-up-enabled',
            false
          ),
        }));
      });
  }

  setGroup(
    name: string,
    options: {
      honorsSessionLimits?: boolean;
      speedLimitDown?: number;
      speedLimitDownEnabled?: boolean;
      speedLimitUp?: number;
      speedLimitUpEnabled?: boolean;
    }
  ): Promise<void> {
    const args: Record<string, unknown> = { name };
    if (options.honorsSessionLimits !== undefined)
      args['honors-session-limits'] = options.honorsSessionLimits;
    if (options.speedLimitDown !== undefined) args['speed-limit-down'] = options.speedLimitDown;
    if (options.speedLimitDownEnabled !== undefined)
      args['speed-limit-down-enabled'] = options.speedLimitDownEnabled;
    if (options.speedLimitUp !== undefined) args['speed-limit-up'] = options.speedLimitUp;
    if (options.speedLimitUpEnabled !== undefined)
      args['speed-limit-up-enabled'] = options.speedLimitUpEnabled;
    return this.requireRpc(RPC_VERSION_4, 'group-set')
      .then(() => this.transport.sendAction({ method: 'group-set', arguments: args }))
      .then(() => {});
  }

  /** Echo after a session-set: re-read the settings, but not the stats */
  private thenUpdateSettings = (): Promise<void> => {
    return this.updateSettings(false);
  };

  /**
   * Build and send one session-set from the descriptor table.
   *
   * The named setters below delegate here, so the payload for every uniform
   * setting is produced in exactly one place. `enables` is written BEFORE the
   * value, matching the order the hand-written payloads used.
   */
  applySetting(name: string, value: boolean | number | string): Promise<void> {
    const descriptor = (SETTING_DESCRIPTORS as Record<string, SettingDescriptor>)[name];
    if (!descriptor) {
      return Promise.reject(new ErrorWithCode(`Unknown setting: ${name}`, 'UNKNOWN_SETTING'));
    }
    const args: Record<string, unknown> = {};
    if (descriptor.enables) args[descriptor.enables] = true;
    args[descriptor.rpcKey] = value;

    const send = () => this.setSessionSetting(args);
    return descriptor.rpcVersionMin
      ? this.requireRpc(descriptor.rpcVersionMin, descriptor.rpcKey).then(send)
      : send();
  }

  private setSessionSetting(args: Record<string, unknown>): Promise<void> {
    return this.transport
      .sendAction({
        method: 'session-set',
        arguments: args,
      })
      .then(this.thenUpdateSettings);
  }

  // v4.0.0+ session-set methods

  portTest(ipProtocol?: 'ipv4' | 'ipv6'): Promise<boolean> {
    const args: Record<string, unknown> = {};
    // The ip-protocol argument was born in Transmission 4.1 (rpc 18), in the
    // snake_case era, so snake is its canonical name on the legacy endpoint
    if (ipProtocol && this.transport.rpcVersion >= RPC_VERSION_4_1) {
      args['ip_protocol'] = ipProtocol;
    }
    return this.transport
      .sendAction({
        method: 'port-test',
        ...(Object.keys(args).length ? { arguments: args } : {}),
      })
      .then((response) => {
        const responseArgs = response.arguments as Record<string, unknown>;
        return readKey<boolean>(responseArgs, 'port-is-open', false);
      });
  }

  blocklistUpdate(): Promise<{ blocklistSize: number }> {
    return (
      this.transport
        // The daemon downloads and parses a multi-MB list before answering,
        // which routinely takes longer than a normal RPC deadline
        .sendAction({ method: 'blocklist-update' }, undefined, BLOCKLIST_UPDATE_TIMEOUT)
        .then((response) => {
          const args = response.arguments as Record<string, unknown>;
          return { blocklistSize: readKey<number>(args, 'blocklist-size', 0) };
        })
        .then((result) => {
          return this.updateSettings().then(() => result);
        })
    );
  }

  private normalizeStatistics = (stats: Record<string, unknown>): SessionStatistics => {
    return {
      uploadedBytes: (stats['uploaded_bytes'] ?? stats['uploadedBytes'] ?? 0) as number,
      downloadedBytes: (stats['downloaded_bytes'] ?? stats['downloadedBytes'] ?? 0) as number,
      filesAdded: (stats['files_added'] ?? stats['filesAdded'] ?? 0) as number,
      sessionCount: (stats['session_count'] ?? stats['sessionCount'] ?? 0) as number,
      secondsActive: (stats['seconds_active'] ?? stats['secondsActive'] ?? 0) as number,
    };
  };

  private normalizeSettings = (settings: Record<string, unknown>): NormalizedSettings => {
    return {
      downloadSpeedLimit: readKey<number>(settings, 'speed-limit-down', 0),
      downloadSpeedLimitEnabled: readKey<boolean>(settings, 'speed-limit-down-enabled', false),
      uploadSpeedLimit: readKey<number>(settings, 'speed-limit-up', 0),
      uploadSpeedLimitEnabled: readKey<boolean>(settings, 'speed-limit-up-enabled', false),
      altSpeedEnabled: readKey<boolean>(settings, 'alt-speed-enabled', false),
      altDownloadSpeedLimit: readKey<number>(settings, 'alt-speed-down', 0),
      altUploadSpeedLimit: readKey<number>(settings, 'alt-speed-up', 0),
      downloadDir: readKey<string>(settings, 'download-dir', ''),
      downloadDirFreeSpace: normalizeFreeSpace(
        readKey<number | undefined>(settings, 'download-dir-free-space', undefined)
      ),
      blocklistEnabled: readKey<boolean>(settings, 'blocklist-enabled', false),
      blocklistUrl: readKey<string>(settings, 'blocklist-url', ''),
      blocklistSize: readKey<number>(settings, 'blocklist-size', 0),
      peerLimitGlobal: readKey<number>(settings, 'peer-limit-global', 200),
      peerLimitPerTorrent: readKey<number>(settings, 'peer-limit-per-torrent', 50),
      seedRatioLimit: (settings['seed_ratio_limit'] ?? settings['seedRatioLimit'] ?? 2.0) as number,
      seedRatioLimited: (settings['seed_ratio_limited'] ??
        settings['seedRatioLimited'] ??
        false) as boolean,
      idleSeedingLimit: readKey<number>(settings, 'idle-seeding-limit', 30),
      idleSeedingLimitEnabled: readKey<boolean>(settings, 'idle-seeding-limit-enabled', false),
      peerPort: readKey<number>(settings, 'peer-port', 51413),
      portForwardingEnabled: readKey<boolean>(settings, 'port-forwarding-enabled', false),
      encryption: (settings['encryption'] as string) ?? 'preferred',
      dhtEnabled: readKey<boolean>(settings, 'dht-enabled', true),
      pexEnabled: readKey<boolean>(settings, 'pex-enabled', true),
      lpdEnabled: readKey<boolean>(settings, 'lpd-enabled', true),
      utpEnabled: readKey<boolean>(settings, 'utp-enabled', true),
      incompleteDirEnabled: readKey<boolean>(settings, 'incomplete-dir-enabled', false),
      incompleteDir: readKey<string>(settings, 'incomplete-dir', ''),
      renamePartialFiles: readKey<boolean>(settings, 'rename-partial-files', true),
      downloadQueueEnabled: readKey<boolean>(settings, 'download-queue-enabled', true),
      downloadQueueSize: readKey<number>(settings, 'download-queue-size', 5),
      seedQueueEnabled: readKey<boolean>(settings, 'seed-queue-enabled', false),
      seedQueueSize: readKey<number>(settings, 'seed-queue-size', 10),
      queueStalledEnabled: readKey<boolean>(settings, 'queue-stalled-enabled', true),
      queueStalledMinutes: readKey<number>(settings, 'queue-stalled-minutes', 30),
      startAddedTorrents: readKey<boolean>(settings, 'start-added-torrents', true),
      trashOriginalTorrentFiles: readKey<boolean>(settings, 'trash-original-torrent-files', false),
      altSpeedTimeEnabled: readKey<boolean>(settings, 'alt-speed-time-enabled', false),
      altSpeedTimeBegin: readKey<number>(settings, 'alt-speed-time-begin', 540),
      altSpeedTimeEnd: readKey<number>(settings, 'alt-speed-time-end', 1020),
      altSpeedTimeDay: readKey<number>(settings, 'alt-speed-time-day', 127),
      scriptTorrentDoneEnabled: readKey<boolean>(settings, 'script-torrent-done-enabled', false),
      scriptTorrentDoneFilename: readKey<string>(settings, 'script-torrent-done-filename', ''),
      // v4.0.0+ fields (optional, undefined on older versions)
      scriptTorrentAddedEnabled:
        readKey<boolean | undefined>(settings, 'script-torrent-added-enabled', undefined) ??
        undefined,
      scriptTorrentAddedFilename:
        readKey<string | undefined>(settings, 'script-torrent-added-filename', undefined) ??
        undefined,
      scriptTorrentDoneSeedingEnabled:
        readKey<boolean | undefined>(settings, 'script-torrent-done-seeding-enabled', undefined) ??
        undefined,
      scriptTorrentDoneSeedingFilename:
        readKey<string | undefined>(settings, 'script-torrent-done-seeding-filename', undefined) ??
        undefined,
      defaultTrackers:
        readKey<string | undefined>(settings, 'default-trackers', undefined) ?? undefined,
      rpcVersion: readKey<number>(settings, 'rpc-version', 0),
      rpcVersionSemver:
        readKey<string | undefined>(settings, 'rpc-version-semver', undefined) ?? undefined,
      version: (settings['version'] as string) ?? undefined,
    };
  };
}

export default SettingsService;
