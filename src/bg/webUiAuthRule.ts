import { toBasicAuthValue } from '../tools/basicAuth';

/**
 * Authenticates the Web UI tab (and its own background RPC calls) by injecting
 * an Authorization header via declarativeNetRequest, instead of embedding
 * credentials in the URL (which leaks into DOM/history and is not applied by
 * browsers to the page's background requests).
 *
 * Based on PR #19 by @robross0606, hardened:
 * - string-literal resource types (the ResourceType enum objects don't exist
 *   on Firefox and would throw at rule build time);
 * - origin computed through new URL() so default ports (80/443) and IPv6
 *   literals produce a urlFilter that actually matches;
 * - subresource requests are scoped to pages served by the Transmission host
 *   itself (initiatorDomains), so third-party websites cannot make the browser
 *   attach the header via <img>/fetch;
 * - credentials encoded UTF-8-safely (btoa alone throws on non-Latin-1).
 */

export const WEB_UI_MAIN_FRAME_RULE_ID = 1;
export const WEB_UI_SUBRESOURCE_RULE_ID = 2;

export interface WebUiAuthConfig {
  ssl: boolean;
  hostname: string;
  port: number;
  authenticationRequired: boolean;
  login: string;
  password: string;
}

// What the stock Transmission Web UI actually loads: the page, its JS/CSS,
// images/favicon, fonts, and the RPC XHRs. No websocket/media/sub_frame/ping.
const SUBRESOURCE_TYPES = [
  'xmlhttprequest',
  'script',
  'stylesheet',
  'image',
  'font',
] as chrome.declarativeNetRequest.ResourceType[];

const MAIN_FRAME_TYPES = ['main_frame'] as chrome.declarativeNetRequest.ResourceType[];

function isIpHost(hostname: string): boolean {
  // IPv6 hostnames from URL come bracketed ([::1]); IPv4 is dotted digits
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

async function updateWebUiAuthRule(config: WebUiAuthConfig): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return;

  const removeRuleIds = [WEB_UI_MAIN_FRAME_RULE_ID, WEB_UI_SUBRESOURCE_RULE_ID];

  if (!config.authenticationRequired || !config.hostname) {
    await dnr.updateDynamicRules({ removeRuleIds });
    return;
  }

  let origin: string;
  let originHostname: string;
  try {
    const parsed = new URL(`${config.ssl ? 'https' : 'http'}://${config.hostname}:${config.port}`);
    origin = parsed.origin;
    originHostname = parsed.hostname;
  } catch {
    await dnr.updateDynamicRules({ removeRuleIds });
    return;
  }

  const requestHeaders = [
    {
      header: 'Authorization',
      operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
      value: toBasicAuthValue(config.login, config.password),
    },
  ];
  const actionType = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType;

  const subresourceCondition: chrome.declarativeNetRequest.RuleCondition = {
    urlFilter: `|${origin}/`,
    resourceTypes: SUBRESOURCE_TYPES,
  };
  // initiatorDomains matching is only reliable for real domain names; for raw
  // IP hosts skip it (residual risk is presence probing only — RPC mutations
  // stay protected by the X-Transmission-Session-Id CSRF token).
  if (!isIpHost(originHostname)) {
    subresourceCondition.initiatorDomains = [originHostname];
  }

  await dnr.updateDynamicRules({
    removeRuleIds,
    addRules: [
      {
        id: WEB_UI_MAIN_FRAME_RULE_ID,
        priority: 1,
        action: { type: actionType, requestHeaders },
        condition: {
          urlFilter: `|${origin}/`,
          resourceTypes: MAIN_FRAME_TYPES,
        },
      },
      {
        id: WEB_UI_SUBRESOURCE_RULE_ID,
        priority: 1,
        action: { type: actionType, requestHeaders },
        condition: subresourceCondition,
      },
    ],
  });
}

export default updateWebUiAuthRule;
