import { beforeEach, describe, expect, it, vi } from 'vitest';
import updateWebUiAuthRule, {
  RPC_SUBRESOURCE_RULE_ID,
  WEB_UI_MAIN_FRAME_RULE_ID,
  WEB_UI_ROOT_RULE_ID,
  WEB_UI_SUBRESOURCE_RULE_ID,
} from '../webUiAuthRule';
import { toBasicAuthValue } from '../../tools/basicAuth';

const baseConfig = {
  ssl: false,
  hostname: 'nas.example.com',
  port: 9091,
  pathname: '/transmission/rpc',
  webPathname: '',
  authenticationRequired: true,
  login: 'admin',
  password: 'secret',
};

type UpdateCall = {
  removeRuleIds: number[];
  addRules?: chrome.declarativeNetRequest.Rule[];
};

function lastCall(): UpdateCall {
  const mock = chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>;
  return mock.mock.calls[mock.mock.calls.length - 1][0] as UpdateCall;
}

describe('updateWebUiAuthRule', () => {
  beforeEach(() => {
    (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mockClear();
  });

  it('registers main_frame, web subresource, RPC subresource and root rules', async () => {
    await updateWebUiAuthRule(baseConfig);
    const call = lastCall();
    expect(call.removeRuleIds).toEqual([
      WEB_UI_MAIN_FRAME_RULE_ID,
      WEB_UI_SUBRESOURCE_RULE_ID,
      RPC_SUBRESOURCE_RULE_ID,
      WEB_UI_ROOT_RULE_ID,
    ]);
    expect(call.addRules).toHaveLength(4);

    const [mainFrame, webSub, rpcSub, root] = call.addRules!;
    expect(mainFrame.id).toBe(WEB_UI_MAIN_FRAME_RULE_ID);
    // No explicit web path: scoped to the RPC path's parent, NOT the origin
    expect(mainFrame.condition.urlFilter).toBe('|http://nas.example.com:9091/transmission/');
    expect(mainFrame.condition.resourceTypes).toEqual(['main_frame']);
    expect(mainFrame.condition.initiatorDomains).toBeUndefined();
    expect(mainFrame.action.type).toBe('modifyHeaders');
    expect(mainFrame.action.requestHeaders).toEqual([
      { header: 'Authorization', operation: 'set', value: toBasicAuthValue('admin', 'secret') },
    ]);

    expect(webSub.id).toBe(WEB_UI_SUBRESOURCE_RULE_ID);
    expect(webSub.condition.urlFilter).toBe('|http://nas.example.com:9091/transmission/');
    expect(webSub.condition.resourceTypes).toEqual([
      'xmlhttprequest',
      'script',
      'stylesheet',
      'image',
      'font',
    ]);
    expect(webSub.condition.initiatorDomains).toEqual(['nas.example.com']);

    expect(rpcSub.id).toBe(RPC_SUBRESOURCE_RULE_ID);
    expect(rpcSub.condition.urlFilter).toBe('|http://nas.example.com:9091/transmission/rpc');
    expect(rpcSub.condition.initiatorDomains).toEqual(['nas.example.com']);

    // The daemon's '/' → Web UI redirect entry: anchored at BOTH ends so it
    // never becomes an origin-wide prefix
    expect(root.id).toBe(WEB_UI_ROOT_RULE_ID);
    expect(root.condition.urlFilter).toBe('|http://nas.example.com:9091/|');
    expect(root.condition.resourceTypes).toEqual(['main_frame']);
  });

  it('scopes rules to the configured web path on shared-origin deployments', async () => {
    await updateWebUiAuthRule({
      ...baseConfig,
      ssl: true,
      port: 443,
      webPathname: '/transmission/web/',
    });
    const call = lastCall();
    // Explicit web path: no root-redirect rule is needed
    expect(call.addRules).toHaveLength(3);
    expect(call.addRules![0].condition.urlFilter).toBe(
      '|https://nas.example.com/transmission/web/'
    );
    expect(call.addRules![1].condition.urlFilter).toBe(
      '|https://nas.example.com/transmission/web/'
    );
    expect(call.addRules![2].condition.urlFilter).toBe('|https://nas.example.com/transmission/rpc');
  });

  it('never injects on the whole origin when no web path is set (shared reverse proxy)', async () => {
    await updateWebUiAuthRule({ ...baseConfig, ssl: true, port: 443 });
    const filters = lastCall().addRules!.map((rule) => rule.condition.urlFilter);
    // An unanchored '|https://host/' prefix would match every URL on the
    // origin and leak the credentials to co-hosted applications
    expect(filters).not.toContain('|https://nas.example.com/');
    expect(filters).toEqual([
      '|https://nas.example.com/transmission/',
      '|https://nas.example.com/transmission/',
      '|https://nas.example.com/transmission/rpc',
      '|https://nas.example.com/|',
    ]);
  });

  it('normalizes default ports out of the url filter', async () => {
    await updateWebUiAuthRule({ ...baseConfig, ssl: true, port: 443 });
    expect(lastCall().addRules![0].condition.urlFilter).toBe(
      '|https://nas.example.com/transmission/'
    );

    await updateWebUiAuthRule({ ...baseConfig, ssl: false, port: 80 });
    expect(lastCall().addRules![0].condition.urlFilter).toBe(
      '|http://nas.example.com/transmission/'
    );
  });

  it('brackets unbracketed IPv6 hostnames instead of dropping the rules', async () => {
    await updateWebUiAuthRule({ ...baseConfig, hostname: 'fd00::2' });
    const call = lastCall();
    expect(call.addRules).toHaveLength(4);
    expect(call.addRules![0].condition.urlFilter).toBe('|http://[fd00::2]:9091/transmission/');
    expect(call.addRules![1].condition.initiatorDomains).toBeUndefined();
  });

  it('skips initiatorDomains for raw IPv4 hosts', async () => {
    await updateWebUiAuthRule({ ...baseConfig, hostname: '192.168.1.10' });
    const call = lastCall();
    expect(call.addRules![0].condition.urlFilter).toBe('|http://192.168.1.10:9091/transmission/');
    expect(call.addRules![1].condition.initiatorDomains).toBeUndefined();
  });

  it('only removes rules when authentication is off', async () => {
    await updateWebUiAuthRule({ ...baseConfig, authenticationRequired: false });
    const call = lastCall();
    expect(call.removeRuleIds).toHaveLength(4);
    expect(call.addRules).toBeUndefined();
  });

  it('only removes rules when hostname is empty', async () => {
    await updateWebUiAuthRule({ ...baseConfig, hostname: '' });
    expect(lastCall().addRules).toBeUndefined();
  });

  it('still registers rules with an empty password (parity with RPC transport)', async () => {
    await updateWebUiAuthRule({ ...baseConfig, password: '' });
    const call = lastCall();
    expect(call.addRules![0].action.requestHeaders![0].value).toBe(toBasicAuthValue('admin', ''));
  });

  it('encodes credentials as UTF-8, including Latin-1-range characters', async () => {
    // U+0080–U+00FF chars don't make btoa throw, but must still be UTF-8
    for (const password of ['café', 'pâsswörd€']) {
      await updateWebUiAuthRule({ ...baseConfig, password });
      const value = lastCall().addRules![0].action.requestHeaders![0].value!;
      expect(value.startsWith('Basic ')).toBe(true);
      const bytes = Uint8Array.from(atob(value.slice(6)), (c) => c.charCodeAt(0));
      expect(new TextDecoder().decode(bytes)).toBe(`admin:${password}`);
    }
  });

  it('no-ops when declarativeNetRequest is unavailable', async () => {
    const saved = chrome.declarativeNetRequest;
    delete (chrome as { declarativeNetRequest?: unknown }).declarativeNetRequest;
    try {
      await expect(updateWebUiAuthRule(baseConfig)).resolves.toBeUndefined();
    } finally {
      (chrome as { declarativeNetRequest: typeof saved }).declarativeNetRequest = saved;
    }
  });
});
