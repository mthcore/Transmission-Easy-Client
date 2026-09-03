import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { BgMessage } from '../../types';
import { SETTING_DESCRIPTORS, describeSetting } from '../../protocol/settings';

vi.mock('../TransmissionClient');
import bgSingleton from '../Bg';

/**
 * Bg.handleMessage.test.ts pins the trust boundary, the argument shapes and the
 * error protocol. This file pins something different: **completeness**.
 *
 * Whenever actions are moved off the hand-written switch, the failure mode is
 * an action served by NEITHER path — dropped from the union in the same change
 * that was meant to relocate it. The compiler's exhaustiveness check catches an
 * action in the union with no case; it cannot catch an action that left the
 * union entirely while a caller still sends it.
 *
 * So: every `case` label in Bg.ts source is dispatched here, and must not fall
 * through to "Unknown request". After each migration batch this file is the
 * thing that says whether anything was dropped on the floor.
 */

interface ResponseBody {
  result?: unknown;
  error?: { message?: string };
}

interface BgHandle {
  handleMessage(
    message: BgMessage,
    sender: chrome.runtime.MessageSender,
    response: (result: unknown) => void
  ): boolean | void;
  client: unknown;
  bgStore: unknown;
  bgStorePathLine: { getDelta: Mock };
  initPromise: Promise<void> | null;
}

const bg = bgSingleton as unknown as BgHandle;

/**
 * Every action the dispatcher serves, over BOTH of its paths: the `case 'x':`
 * labels read from the shipped source, and the descriptor table it consults
 * before the switch. Reading only the labels would have quietly stopped
 * covering the ~40 settings the day they moved onto the table — which is the
 * migration this file exists to police.
 */
function dispatchedActions(): string[] {
  const source = fs.readFileSync(path.join(__dirname, '../Bg.ts'), 'utf8');
  const labels = [...source.matchAll(/^\s+case '([^']+)':/gm)].map((match) => match[1]);
  const tabled = Object.keys(SETTING_DESCRIPTORS).filter((action) => describeSetting(action));
  return [...new Set([...labels, ...tabled])];
}

const ACTIONS = dispatchedActions();

/**
 * Any property is a resolved mock, so a new action calling a new client method
 * does not fail here for the wrong reason — this suite is about routing, not
 * about what the client does.
 */
function permissiveClient() {
  const cache = new Map<string, Mock>();
  return new Proxy(
    {},
    {
      get(_target, property: string) {
        if (!cache.has(property)) cache.set(property, vi.fn().mockResolvedValue({ ok: true }));
        return cache.get(property);
      },
      has: () => true,
    }
  );
}

const ownPageSender = {
  id: chrome.runtime.id,
  url: `${chrome.runtime.getURL('')}index.html#popup`,
} as chrome.runtime.MessageSender;

/** Superset of every field any action reads, so shape is never the failure. */
function messageFor(action: string): BgMessage {
  return {
    action,
    ids: [1],
    id: 1,
    patchId: null,
    enabled: true,
    speed: 0,
    value: 0,
    limit: 0,
    level: 0,
    fileIdxs: [0],
    filename: '',
    mode: 'preferred',
    url: '',
    urls: [],
    dir: '',
    path: '',
    name: '',
    location: '',
    directory: '',
    labels: [],
    priority: 0,
    force: false,
    trackerList: '',
    seedRatioMode: 0,
    seedRatioLimit: 0,
    seedIdleMode: 0,
    seedIdleLimit: 0,
  } as unknown as BgMessage;
}

function dispatch(message: BgMessage) {
  let settle!: (value: ResponseBody) => void;
  const responded = new Promise<ResponseBody>((resolve) => {
    settle = resolve;
  });
  const returned = bg.handleMessage(message, ownPageSender, (value) =>
    settle(value as ResponseBody)
  );
  return { returned, responded };
}

beforeEach(() => {
  bg.client = permissiveClient();
  bg.initPromise = Promise.resolve();
  bg.bgStore = { config: undefined, fetchConfig: vi.fn().mockResolvedValue(undefined) };
  bg.bgStorePathLine = { getDelta: vi.fn().mockReturnValue({ type: 'patch', result: [] }) };
});

describe('Bg.handleMessage — dispatch completeness', () => {
  it('found the dispatcher source and a plausible number of actions', () => {
    // Without this, a parse that silently matched nothing would make every
    // assertion below vacuous — the suite would pass while testing air.
    expect(ACTIONS.length).toBeGreaterThan(60);
    expect(ACTIONS).toContain('getConfigStore');
    expect(ACTIONS).toContain('updateTorrentList');
    expect(ACTIONS).toContain('setSeedLimits');
  });

  it.each(ACTIONS.map((action) => ({ action })))(
    '$action is routed, not rejected as unknown',
    async ({ action }) => {
      const { returned, responded } = dispatch(messageFor(action));
      // true keeps the async response channel open; every dispatched action
      // answers asynchronously
      expect(returned).toBe(true);
      const body = await responded;
      expect(body.error?.message ?? '').not.toMatch(/Unknown request/);
    }
  );

  it('still rejects an action that is genuinely absent', () => {
    // The complement of the assertion above: if this stopped failing, the
    // per-action check would prove nothing.
    const { returned, responded } = dispatch({ action: 'noSuchAction' } as unknown as BgMessage);
    expect(returned).toBe(true);
    return expect(responded).resolves.toMatchObject({
      error: { message: expect.stringMatching(/Unknown request/) },
    });
  });

  it('answers every action with exactly one of result or error', async () => {
    for (const action of ACTIONS) {
      const { responded } = dispatch(messageFor(action));
      const body = await responded;
      const hasResult = Object.prototype.hasOwnProperty.call(body, 'result');
      const hasError = Object.prototype.hasOwnProperty.call(body, 'error');
      expect(hasResult !== hasError, `${action} answered with both or neither`).toBe(true);
    }
  });

  it('routes no action while the sender is untrusted', () => {
    // Completeness must not become a hole: the boundary applies to all of them.
    const webPage = { id: chrome.runtime.id, url: 'https://tracker.example/x' };
    for (const action of ACTIONS) {
      const returned = bg.handleMessage(
        messageFor(action),
        webPage as chrome.runtime.MessageSender,
        () => {
          throw new Error(`${action} answered a web-page sender`);
        }
      );
      expect(returned, `${action} kept the channel open for a web page`).toBeUndefined();
    }
  });
});
