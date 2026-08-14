import { describe, expect, it } from 'vitest';
import {
  RPC_VERSION_4,
  RPC_VERSION_4_1,
  assertRpcVersion,
  getRpcFeatures,
  readKey,
} from '../rpcCompat';
import ErrorWithCode from '../ErrorWithCode';

describe('readKey', () => {
  it('reads the snake_case key first', () => {
    expect(readKey({ speed_limit_down: 1, 'speed-limit-down': 2 }, 'speed-limit-down', 0)).toBe(1);
  });

  it('falls back to the kebab-case key', () => {
    expect(readKey({ 'speed-limit-down': 2 }, 'speed-limit-down', 0)).toBe(2);
  });

  it('returns the fallback when neither key exists', () => {
    expect(readKey({}, 'speed-limit-down', 42)).toBe(42);
  });
});

describe('getRpcFeatures', () => {
  it('reports everything unavailable while the version is unknown (0)', () => {
    const features = getRpcFeatures(0);
    expect(Object.values(features).every((v) => v === false)).toBe(true);
  });

  it('reports everything unavailable for Transmission 2.x/3.x (rpc 15/16)', () => {
    for (const version of [15, 16]) {
      const features = getRpcFeatures(version);
      expect(features.groups).toBe(false);
      expect(features.trackerList).toBe(false);
      expect(features.scriptTorrentAdded).toBe(false);
      expect(features.sequentialDownload).toBe(false);
    }
  });

  it('enables 4.0 features at rpc 17 but not 4.1 features', () => {
    const features = getRpcFeatures(RPC_VERSION_4);
    expect(features.groups).toBe(true);
    expect(features.defaultTrackers).toBe(true);
    expect(features.trackerList).toBe(true);
    expect(features.scriptTorrentAdded).toBe(true);
    expect(features.extendedFileInfo).toBe(true);
    expect(features.sequentialDownload).toBe(false);
    expect(features.portTestIpProtocol).toBe(false);
  });

  it('enables everything at rpc 18', () => {
    const features = getRpcFeatures(RPC_VERSION_4_1);
    expect(Object.values(features).every((v) => v === true)).toBe(true);
  });
});

describe('assertRpcVersion', () => {
  it('passes when the version is unknown (0)', () => {
    expect(() => assertRpcVersion(0, RPC_VERSION_4, 'group-get')).not.toThrow();
  });

  it('passes when the version is high enough', () => {
    expect(() => assertRpcVersion(17, RPC_VERSION_4, 'group-get')).not.toThrow();
    expect(() => assertRpcVersion(18, RPC_VERSION_4_1, 'sequential download')).not.toThrow();
  });

  it('throws UNSUPPORTED_RPC_VERSION when the daemon is too old', () => {
    try {
      assertRpcVersion(15, RPC_VERSION_4, 'group-get');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorWithCode);
      expect((err as ErrorWithCode).code).toBe('UNSUPPORTED_RPC_VERSION');
    }
  });
});
