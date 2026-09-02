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
 *   literals (stored unbracketed, matching the RPC transport's convention)
 *   produce a urlFilter that actually matches;
 * - rules are scoped to the configured Web UI and RPC paths, not the whole
 *   origin, so a shared host behind a reverse proxy doesn't get Transmission
 *   credentials on unrelated applications;
 * - subresource requests are scoped to pages served by the Transmission host
 *   itself (initiatorDomains), so third-party websites cannot make the browser
 *   attach the header via <img>/fetch;
 * - credentials encoded UTF-8-safely (btoa alone emits Latin-1 or throws).
 */

export const WEB_UI_MAIN_FRAME_RULE_ID = 1;
export const WEB_UI_SUBRESOURCE_RULE_ID = 2;
export const RPC_SUBRESOURCE_RULE_ID = 3;
export const WEB_UI_ROOT_RULE_ID = 4;

const ALL_RULE_IDS = [
  WEB_UI_MAIN_FRAME_RULE_ID,
  WEB_UI_SUBRESOURCE_RULE_ID,
  RPC_SUBRESOURCE_RULE_ID,
  WEB_UI_ROOT_RULE_ID,
];

export interface WebUiAuthConfig {
  ssl: boolean;
  hostname: string;
  port: number;
  pathname: string;
  webPathname: string;
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

/**
 * updateDynamicRules through a callback, so a rejected rule set actually
 * rejects: on Firefox the chrome.* namespace returns undefined, so `await`
 * resolved instantly and a rule the validator refused (or missing host access)
 * silently left the Web UI unauthenticated with nothing logged.
 */
function updateRules(
  dnr: typeof chrome.declarativeNetRequest,
  options: chrome.declarativeNetRequest.UpdateRuleOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    dnr.updateDynamicRules(options, () => {
      const err = chrome.runtime.lastError;
      err ? reject(new Error(err.message)) : resolve();
    });
  });
}

function isIpHost(hostname: string): boolean {
  // IPv6 hostnames from URL come bracketed ([::1]); IPv4 is dotted digits
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/** Leading slash enforced; empty path means the origin root. */
function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

/** Parent directory with trailing slash: '/transmission/rpc' → '/transmission/' */
function parentDir(path: string): string {
  // Trailing slashes would make a path its own parent ('/transmission/rpc/')
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx + 1);
}

/**
 * A DNR urlFilter is a plain prefix, so '/transmission/web' would also match
 * '/transmission/webmail' and leak the credentials to a co-hosted app. Anchor
 * the prefix on a path boundary by making sure it ends with a slash.
 */
function asDirectoryPrefix(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

async function updateWebUiAuthRule(config: WebUiAuthConfig): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return;

  if (!config.authenticationRequired || !config.hostname) {
    await updateRules(dnr, { removeRuleIds: ALL_RULE_IDS });
    return;
  }

  // IPv6 literals are stored unbracketed (url.format brackets them for the
  // RPC URL); new URL() needs them bracketed
  const urlHost =
    config.hostname.includes(':') && !config.hostname.startsWith('[')
      ? `[${config.hostname}]`
      : config.hostname;

  let origin: string;
  let originHostname: string;
  try {
    const parsed = new URL(`${config.ssl ? 'https' : 'http'}://${urlHost}:${config.port}`);
    origin = parsed.origin;
    originHostname = parsed.hostname;
  } catch {
    await updateRules(dnr, { removeRuleIds: ALL_RULE_IDS });
    return;
  }

  const rpcPath = normalizePath(config.pathname);
  // With no explicit Web UI path the old fallback was '/', which turned the
  // prefix rules into an origin-wide credential injection — exactly the leak
  // this file promises to prevent on shared reverse-proxy hosts. Instead,
  // scope to the RPC path's parent directory (stock daemon: '/transmission/',
  // which contains '/transmission/web/'), and cover the daemon's '/' → Web UI
  // redirect with a separate EXACT-match root rule, never a prefix.
  const hasExplicitWebPath = Boolean(config.webPathname);
  const webPath = hasExplicitWebPath
    ? asDirectoryPrefix(normalizePath(config.webPathname))
    : parentDir(rpcPath);
  // A '/' web path (RPC mounted at the origin root, e.g. pathname '/rpc')
  // would turn the prefix rules back into origin-wide injection, so those
  // rules are dropped entirely: only the exact RPC and root rules remain.
  // Users on such a deployment set an explicit "GUI path" to get Web UI auth.
  const webPathIsOriginRoot = webPath === '/';

  const requestHeaders = [
    {
      header: 'Authorization',
      operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
      value: toBasicAuthValue(config.login, config.password),
    },
  ];
  const actionType = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType;

  // initiatorDomains matching is only reliable for real domain names; for raw
  // IP hosts skip it (residual risk is presence probing only — RPC mutations
  // stay protected by the X-Transmission-Session-Id CSRF token).
  const initiatorDomains = isIpHost(originHostname) ? undefined : [originHostname];

  const addRules: chrome.declarativeNetRequest.Rule[] = [];

  if (!webPathIsOriginRoot) {
    addRules.push(
      {
        id: WEB_UI_MAIN_FRAME_RULE_ID,
        priority: 1,
        action: { type: actionType, requestHeaders },
        condition: {
          urlFilter: `|${origin}${webPath}`,
          resourceTypes: MAIN_FRAME_TYPES,
        },
      },
      {
        id: WEB_UI_SUBRESOURCE_RULE_ID,
        priority: 1,
        action: { type: actionType, requestHeaders },
        condition: {
          urlFilter: `|${origin}${webPath}`,
          resourceTypes: SUBRESOURCE_TYPES,
          ...(initiatorDomains ? { initiatorDomains } : {}),
        },
      }
    );
  }

  // The Web UI's own RPC calls target the RPC path, which may live outside
  // the Web UI path prefix
  addRules.push({
    id: RPC_SUBRESOURCE_RULE_ID,
    priority: 1,
    action: { type: actionType, requestHeaders },
    condition: {
      urlFilter: `|${origin}${rpcPath}`,
      resourceTypes: SUBRESOURCE_TYPES,
      ...(initiatorDomains ? { initiatorDomains } : {}),
    },
  });

  if (!hasExplicitWebPath || webPathIsOriginRoot) {
    // Entry point when no Web UI path is set: the extension opens the bare
    // origin and the daemon 301s to its Web UI. Anchored at BOTH ends so it
    // matches only the root navigation itself. Also the ONLY rule left when
    // the user set the GUI path to '/' — without it that configuration got no
    // Web UI credentials at all, which is the opposite of what they asked for.
    addRules.push({
      id: WEB_UI_ROOT_RULE_ID,
      priority: 1,
      action: { type: actionType, requestHeaders },
      condition: {
        urlFilter: `|${origin}/|`,
        resourceTypes: MAIN_FRAME_TYPES,
      },
    });
  }

  await updateRules(dnr, { removeRuleIds: ALL_RULE_IDS, addRules });
}

export default updateWebUiAuthRule;
