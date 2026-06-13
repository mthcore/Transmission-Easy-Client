import getLogger from '../tools/getLogger';

const logger = getLogger('webUiAuthRule');

// A single dynamic declarativeNetRequest rule injects the HTTP Basic auth
// header into requests bound for the Transmission server, so the Web UI tab
// (and the RPC calls it makes) are authenticated without embedding
// credentials in the opened URL. Browsers don't reliably apply URL-embedded
// credentials to a page's background requests, which left the Web UI showing
// an empty torrent list until a manual reload.
const WEB_UI_AUTH_RULE_ID = 1;

// Every resource the server returns is behind Basic auth: the redirect, the
// HTML, its assets, and the RPC endpoint — so the header must be added to all
// request types, not just the document.
const RESOURCE_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
  chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
  chrome.declarativeNetRequest.ResourceType.STYLESHEET,
  chrome.declarativeNetRequest.ResourceType.SCRIPT,
  chrome.declarativeNetRequest.ResourceType.IMAGE,
  chrome.declarativeNetRequest.ResourceType.FONT,
  chrome.declarativeNetRequest.ResourceType.OBJECT,
  chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
  chrome.declarativeNetRequest.ResourceType.PING,
  chrome.declarativeNetRequest.ResourceType.MEDIA,
  chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
  chrome.declarativeNetRequest.ResourceType.OTHER,
];

interface WebUiAuthConfig {
  ssl: boolean;
  hostname: string;
  port: number;
  authenticationRequired: boolean;
  login: string;
  password: string;
}

/**
 * Keep the Web UI auth header-injection rule in sync with the current config.
 * Removes the rule when authentication isn't required (or no host is set).
 */
export default async function updateWebUiAuthRule(config: WebUiAuthConfig): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  // Guard so a missing permission/old runtime degrades gracefully rather than
  // throwing inside an autorun.
  if (!dnr?.updateDynamicRules) return;

  const removeRuleIds = [WEB_UI_AUTH_RULE_ID];

  try {
    if (!config.authenticationRequired || !config.hostname) {
      await dnr.updateDynamicRules({ removeRuleIds });
      return;
    }

    const scheme = config.ssl ? 'https' : 'http';
    const rule: chrome.declarativeNetRequest.Rule = {
      id: WEB_UI_AUTH_RULE_ID,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            header: 'Authorization',
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: 'Basic ' + btoa([config.login, config.password].join(':')),
          },
        ],
      },
      condition: {
        // Anchor to the exact scheme://host:port so the header is only sent to
        // the configured Transmission server.
        urlFilter: `|${scheme}://${config.hostname}:${config.port}/`,
        resourceTypes: RESOURCE_TYPES,
      },
    };

    await dnr.updateDynamicRules({ removeRuleIds, addRules: [rule] });
  } catch (err) {
    logger.error('failed to update Web UI auth rule', err);
  }
}
