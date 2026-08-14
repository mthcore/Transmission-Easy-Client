import { beforeEach, describe, expect, it, vi } from 'vitest';
import updateWebUiAuthRule, {
  WEB_UI_MAIN_FRAME_RULE_ID,
  WEB_UI_SUBRESOURCE_RULE_ID,
} from '../webUiAuthRule';
import { toBasicAuthValue } from '../../tools/basicAuth';

const baseConfig = {
  ssl: false,
  hostname: 'nas.example.com',
  port: 9091,
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

  it('registers a main_frame rule and a scoped subresource rule', async () => {
    await updateWebUiAuthRule(baseConfig);
    const call = lastCall();
    expect(call.removeRuleIds).toEqual([WEB_UI_MAIN_FRAME_RULE_ID, WEB_UI_SUBRESOURCE_RULE_ID]);
    expect(call.addRules).toHaveLength(2);

    const [mainFrame, subresource] = call.addRules!;
    expect(mainFrame.id).toBe(WEB_UI_MAIN_FRAME_RULE_ID);
    expect(mainFrame.condition.urlFilter).toBe('|http://nas.example.com:9091/');
    expect(mainFrame.condition.resourceTypes).toEqual(['main_frame']);
    expect(mainFrame.condition.initiatorDomains).toBeUndefined();
    expect(mainFrame.action.type).toBe('modifyHeaders');
    expect(mainFrame.action.requestHeaders).toEqual([
      { header: 'Authorization', operation: 'set', value: toBasicAuthValue('admin', 'secret') },
    ]);

    expect(subresource.id).toBe(WEB_UI_SUBRESOURCE_RULE_ID);
    expect(subresource.condition.urlFilter).toBe('|http://nas.example.com:9091/');
    expect(subresource.condition.resourceTypes).toEqual([
      'xmlhttprequest',
      'script',
      'stylesheet',
      'image',
      'font',
    ]);
    expect(subresource.condition.initiatorDomains).toEqual(['nas.example.com']);
  });

  it('normalizes default ports out of the url filter', async () => {
    await updateWebUiAuthRule({ ...baseConfig, ssl: true, port: 443 });
    expect(lastCall().addRules![0].condition.urlFilter).toBe('|https://nas.example.com/');

    await updateWebUiAuthRule({ ...baseConfig, ssl: false, port: 80 });
    expect(lastCall().addRules![0].condition.urlFilter).toBe('|http://nas.example.com/');
  });

  it('skips initiatorDomains for raw IP hosts', async () => {
    await updateWebUiAuthRule({ ...baseConfig, hostname: '192.168.1.10' });
    const call = lastCall();
    expect(call.addRules![0].condition.urlFilter).toBe('|http://192.168.1.10:9091/');
    expect(call.addRules![1].condition.initiatorDomains).toBeUndefined();
  });

  it('only removes rules when authentication is off', async () => {
    await updateWebUiAuthRule({ ...baseConfig, authenticationRequired: false });
    const call = lastCall();
    expect(call.removeRuleIds).toEqual([WEB_UI_MAIN_FRAME_RULE_ID, WEB_UI_SUBRESOURCE_RULE_ID]);
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

  it('does not throw on non-Latin-1 credentials', async () => {
    await updateWebUiAuthRule({ ...baseConfig, password: 'pâsswörd€' });
    const value = lastCall().addRules![0].action.requestHeaders![0].value!;
    expect(value.startsWith('Basic ')).toBe(true);
    // decodes back to UTF-8 bytes of "admin:pâsswörd€"
    const bytes = Uint8Array.from(atob(value.slice(6)), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('admin:pâsswörd€');
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
