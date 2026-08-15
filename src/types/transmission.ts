/**
 * Transmission RPC shared types.
 *
 * Only types consumed outside this file live here. Request/response shapes are
 * declared locally by the service that parses them (src/bg/*Service.ts), and
 * the transport's own TransmissionResponse is exported from
 * src/bg/TransmissionTransport.ts.
 */

/** Torrent bandwidth priority: low, normal, high */
export type BandwidthPriority = -1 | 0 | 1;

/** session-stats cumulative/current statistics block */
export interface SessionStatistics {
  uploadedBytes: number;
  downloadedBytes: number;
  filesAdded: number;
  sessionCount: number;
  secondsActive: number;
}

/** Bandwidth group (group-get/group-set, Transmission 4.0+ / rpc 17) */
export interface BandwidthGroup {
  name: string;
  honorsSessionLimits: boolean;
  'speed-limit-down': number;
  'speed-limit-down-enabled': boolean;
  'speed-limit-up': number;
  'speed-limit-up-enabled': boolean;
}
