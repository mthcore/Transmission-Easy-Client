import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsService, { type NormalizedSettings } from '../SettingsService';
import type TransmissionTransport from '../TransmissionTransport';

function createService(rpcVersion = 0) {
  const sendAction = vi.fn();
  const transport = { sendAction, rpcVersion } as unknown as TransmissionTransport;
  const applySettings = vi.fn();
  const service = new SettingsService(transport, applySettings);
  return { service, sendAction, transport, applySettings };
}

const LEGACY_SESSION = {
  'rpc-version': 15,
  version: '2.94',
  'speed-limit-down': 100,
  'speed-limit-down-enabled': true,
  'speed-limit-up': 50,
  'alt-speed-enabled': false,
  'download-dir': '/downloads',
  'peer-port': 51413,
  encryption: 'preferred',
  seedRatioLimit: 2,
  seedRatioLimited: true,
};

const MODERN_SESSION = {
  rpc_version: 18,
  rpc_version_semver: '6.0.0',
  version: '4.1.0',
  speed_limit_down: 100,
  speed_limit_down_enabled: true,
  speed_limit_up: 50,
  alt_speed_enabled: false,
  download_dir: '/downloads',
  peer_port: 51413,
  encryption: 'preferred',
  seed_ratio_limit: 2,
  seed_ratio_limited: true,
};

describe('SettingsService.updateSettings', () => {
  it('normalizes a legacy (2.94, kebab/camel) session and captures rpc-version', async () => {
    const { service, sendAction, transport, applySettings } = createService();
    sendAction.mockResolvedValue({ result: 'success', arguments: LEGACY_SESSION });

    await service.updateSettings();

    expect(transport.rpcVersion).toBe(15);
    const normalized = applySettings.mock.calls[0][0] as NormalizedSettings;
    expect(normalized.rpcVersion).toBe(15);
    expect(normalized.version).toBe('2.94');
    expect(normalized.rpcVersionSemver).toBeUndefined();
    expect(normalized.downloadSpeedLimit).toBe(100);
    expect(normalized.downloadSpeedLimitEnabled).toBe(true);
    expect(normalized.downloadDir).toBe('/downloads');
    expect(normalized.seedRatioLimit).toBe(2);
    expect(normalized.seedRatioLimited).toBe(true);
    expect(normalized.scriptTorrentAddedEnabled).toBeUndefined();
  });

  it('normalizes a 4.1 (snake_case) session to the same shape', async () => {
    const { service, sendAction, transport, applySettings } = createService();
    sendAction.mockResolvedValue({ result: 'success', arguments: MODERN_SESSION });

    await service.updateSettings();

    expect(transport.rpcVersion).toBe(18);
    const normalized = applySettings.mock.calls[0][0] as NormalizedSettings;
    expect(normalized.rpcVersion).toBe(18);
    expect(normalized.version).toBe('4.1.0');
    expect(normalized.rpcVersionSemver).toBe('6.0.0');
    expect(normalized.downloadSpeedLimit).toBe(100);
    expect(normalized.downloadDir).toBe('/downloads');
    expect(normalized.seedRatioLimit).toBe(2);
  });
});

describe('SettingsService version gating', () => {
  it('rejects 4.x-only calls when the daemon is known to be too old', async () => {
    const { service, sendAction } = createService(15);
    await expect(service.setDefaultTrackers('udp://a')).rejects.toMatchObject({
      code: 'UNSUPPORTED_RPC_VERSION',
    });
    await expect(service.getGroups()).rejects.toMatchObject({ code: 'UNSUPPORTED_RPC_VERSION' });
    await expect(service.setScriptTorrentAddedEnabled(true)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RPC_VERSION',
    });
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('sends 4.x calls when the daemon supports them', async () => {
    const { service, sendAction } = createService(17);
    sendAction.mockResolvedValue({ result: 'success', arguments: { group: [] } });
    await service.getGroups();
    expect(sendAction).toHaveBeenCalledWith({ method: 'group-get', arguments: {} });
  });

  it('passes through when the version is not known yet (backstop only)', async () => {
    const { service, sendAction } = createService(0);
    sendAction.mockResolvedValue({ result: 'success', arguments: {} });
    await expect(service.setDefaultTrackers('udp://a')).resolves.toBeUndefined();
  });
});

describe('SettingsService.portTest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends no arguments on old daemons', async () => {
    const { service, sendAction } = createService(16);
    sendAction.mockResolvedValue({ result: 'success', arguments: { 'port-is-open': true } });
    await expect(service.portTest()).resolves.toBe(true);
    expect(sendAction).toHaveBeenCalledWith({ method: 'port-test' });
  });

  it('ignores ipProtocol below rpc 18', async () => {
    const { service, sendAction } = createService(17);
    sendAction.mockResolvedValue({ result: 'success', arguments: { 'port-is-open': false } });
    await expect(service.portTest('ipv6')).resolves.toBe(false);
    expect(sendAction).toHaveBeenCalledWith({ method: 'port-test' });
  });

  it('sends ip-protocol at rpc 18 and reads a snake_case response', async () => {
    const { service, sendAction } = createService(18);
    sendAction.mockResolvedValue({
      result: 'success',
      arguments: { port_is_open: true, ip_protocol: 'ipv6' },
    });
    await expect(service.portTest('ipv6')).resolves.toBe(true);
    expect(sendAction).toHaveBeenCalledWith({
      method: 'port-test',
      arguments: { 'ip-protocol': 'ipv6' },
    });
  });
});
