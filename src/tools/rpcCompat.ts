import ErrorWithCode from './ErrorWithCode';

/**
 * RPC version compatibility.
 *
 * The extension always speaks the legacy bespoke protocol on
 * /transmission/rpc with the legacy camelCase/kebab-case argument names,
 * which every daemon from 2.x through 4.2 accepts (snake_case is only
 * mandatory for the new JSON-RPC 2.0 protocol introduced in 4.1).
 * Feature availability is gated on the daemon's reported rpc-version.
 */

/** Transmission 3.00: torrent labels */
export const RPC_VERSION_3 = 16;
/** Transmission 4.0.0: groups, default-trackers, trackerList, script-torrent-added, ... */
export const RPC_VERSION_4 = 17;
/** Transmission 4.1.0: sequential download, port-test ip-protocol, ... */
export const RPC_VERSION_4_1 = 18;

export interface RpcFeatures {
  labels: boolean;
  groups: boolean;
  defaultTrackers: boolean;
  trackerList: boolean;
  scriptTorrentAdded: boolean;
  extendedFileInfo: boolean;
  sequentialDownload: boolean;
  portTestIpProtocol: boolean;
}

/** Feature availability for a daemon rpc-version; all false while unknown (0). */
export function getRpcFeatures(rpcVersion: number): RpcFeatures {
  return {
    labels: rpcVersion >= RPC_VERSION_3,
    groups: rpcVersion >= RPC_VERSION_4,
    defaultTrackers: rpcVersion >= RPC_VERSION_4,
    trackerList: rpcVersion >= RPC_VERSION_4,
    scriptTorrentAdded: rpcVersion >= RPC_VERSION_4,
    extendedFileInfo: rpcVersion >= RPC_VERSION_4,
    sequentialDownload: rpcVersion >= RPC_VERSION_4_1,
    portTestIpProtocol: rpcVersion >= RPC_VERSION_4_1,
  };
}

/**
 * Backstop guard for calls the UI should already have hidden: throws when the
 * daemon version is known and too old. Version 0 (not yet known) passes.
 */
export function assertRpcVersion(rpcVersion: number, min: number, what: string): void {
  if (rpcVersion > 0 && rpcVersion < min) {
    throw new ErrorWithCode(
      `${what} requires Transmission RPC ${min}+ (daemon reports ${rpcVersion})`,
      'UNSUPPORTED_RPC_VERSION'
    );
  }
}

/** Read a key trying snake_case then kebab-case (defensive incoming read) */
export function readKey<T>(obj: Record<string, unknown>, kebabKey: string, fallback: T): T {
  const snakeKey = kebabKey.replace(/-/g, '_');
  return (obj[snakeKey] ?? obj[kebabKey] ?? fallback) as T;
}
