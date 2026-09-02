import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import ConfigStore from '../../stores/ConfigStore';
import type { BgMessage } from '../../types';

// Safety net: the singleton in Bg.ts is constructed at import time and its
// autoruns would build a real TransmissionClient (network) if fetchConfig ever
// settled. It cannot settle here (chromeMock's storage.local.get never invokes
// its callback), but automocking keeps this test hermetic either way.
vi.mock('../TransmissionClient');

// Bg exports the singleton, not the class, so the instance is re-wired with
// stubs instead. handleMessage is a bound arrow property, so it keeps working.
import bgSingleton from '../Bg';

interface ResponseBody {
  result?: unknown;
  error?: unknown;
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

const CLIENT_METHODS = [
  'start',
  'forcestart',
  'stop',
  'recheck',
  'removetorrent',
  'removedatatorrent',
  'reannounce',
  'queueTop',
  'queueUp',
  'queueDown',
  'queueBottom',
  'updateTorrents',
  'updateSettings',
  'sendFiles',
  'getFreeSpace',
  'getFileList',
  'getPeers',
  'setPriority',
  'rename',
  'torrentSetLocation',
  'setLabels',
  'setBandwidthPriority',
  'setDhtEnabled',
  'setAltSpeedEnabled',
  'setDownloadSpeedLimit',
  'setAltUploadSpeedLimit',
  'setPeerLimitGlobal',
  'setAltSpeedTimeBegin',
  'setEncryption',
  'setBlocklistUrl',
  'blocklistUpdate',
  'setIncompleteDir',
  'setScriptTorrentDoneFilename',
  'portTest',
  'setSequentialDownload',
  'getTorrentDetails',
  'setTrackerList',
  'setSeedLimits',
] as const;

type ClientStub = Record<(typeof CLIENT_METHODS)[number], Mock>;

function createClientStub(): ClientStub {
  const client = {} as Record<string, Mock>;
  CLIENT_METHODS.forEach((name) => {
    client[name] = vi.fn().mockResolvedValue({ from: name });
  });
  return client as ClientStub;
}

/**
 * A message from one of the extension's own pages (popup/options). The url is
 * part of the fixture because Chrome always sets it — the boundary requires it
 * rather than only checking it when present.
 */
const ownPageSender = {
  id: chrome.runtime.id,
  url: `${chrome.runtime.getURL('')}index.html#popup`,
} as chrome.runtime.MessageSender;

function dispatch(message: BgMessage, sender: chrome.runtime.MessageSender = ownPageSender) {
  const calls: ResponseBody[] = [];
  let settle!: (value: ResponseBody) => void;
  const responded = new Promise<ResponseBody>((resolve) => {
    settle = resolve;
  });
  const returned = bg.handleMessage(message, sender, (value) => {
    calls.push(value as ResponseBody);
    settle(value as ResponseBody);
  });
  return { returned, responded, calls };
}

/** Lets every already-queued microtask/macrotask run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let client: ClientStub;

beforeEach(() => {
  client = createClientStub();
  bg.client = client;
  bg.initPromise = Promise.resolve();
  // updateSettings re-reads the config before validating (connection-change race)
  bg.bgStore = { config: undefined, fetchConfig: vi.fn().mockResolvedValue(undefined) };
  bg.bgStorePathLine = { getDelta: vi.fn().mockReturnValue({ type: 'patch', result: [] }) };
});

describe('Bg.handleMessage — sender trust boundary', () => {
  it('ignores a message coming from a web page (content-script context)', () => {
    // The content script runs in arbitrary pages; the dispatcher serves the
    // daemon password and every destructive action, so a web-page URL is refused
    const { returned, calls } = dispatch({ action: 'getConfigStore' }, {
      id: chrome.runtime.id,
      url: 'https://evil.example/page',
      tab: { id: 4 },
    } as chrome.runtime.MessageSender);

    expect(returned).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('serves the options page, which legitimately runs in a tab', async () => {
    const { returned, responded } = dispatch({ action: 'updateSettings' }, {
      id: chrome.runtime.id,
      url: `${chrome.runtime.getURL('')}options.html#/server`,
      tab: { id: 9 },
    } as chrome.runtime.MessageSender);

    expect(returned).toBe(true);
    await expect(responded).resolves.toEqual({ result: { from: 'updateSettings' } });
  });

  it('ignores a sender that reports no url at all', () => {
    // A url-less sender used to pass: the check only ran when sender.url was
    // truthy, so anything claiming our extension id walked straight through to
    // the daemon password.
    const { returned, calls } = dispatch({ action: 'getConfigStore' }, {
      id: chrome.runtime.id,
    } as chrome.runtime.MessageSender);

    expect(returned).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('ignores a message from another extension', () => {
    const { returned, calls } = dispatch({ action: 'getConfigStore' }, {
      id: 'some-other-extension',
    } as chrome.runtime.MessageSender);

    expect(returned).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('serves the extension’s own pages', async () => {
    const { returned, responded } = dispatch({ action: 'updateSettings' });
    expect(returned).toBe(true);
    await expect(responded).resolves.toEqual({ result: { from: 'updateSettings' } });
  });
});

describe('Bg.handleMessage — id actions', () => {
  it('forwards ids to the same-named client method and answers {result}', async () => {
    const { returned, responded } = dispatch({ action: 'start', ids: [1, 2] });

    expect(returned).toBe(true);
    await expect(responded).resolves.toEqual({ result: { from: 'start' } });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledWith([1, 2]);
  });

  it.each([
    'forcestart',
    'stop',
    'recheck',
    'removetorrent',
    'removedatatorrent',
    'reannounce',
    'queueTop',
    'queueUp',
    'queueDown',
    'queueBottom',
  ] as const)('routes %s to client.%s only', async (action) => {
    const { responded } = dispatch({ action, ids: [7] });

    await expect(responded).resolves.toEqual({ result: { from: action } });
    expect(client[action]).toHaveBeenCalledWith([7]);
    // No sibling of the shared case block may fire.
    expect(client.start).not.toHaveBeenCalled();
    const otherCalls = CLIENT_METHODS.filter(
      (name) => name !== action && client[name].mock.calls.length > 0
    );
    expect(otherCalls).toEqual([]);
  });
});

describe('Bg.handleMessage — session setters', () => {
  it('unwraps `enabled` for boolean session setters', async () => {
    const { responded } = dispatch({ action: 'setDhtEnabled', enabled: false });

    await expect(responded).resolves.toEqual({ result: { from: 'setDhtEnabled' } });
    expect(client.setDhtEnabled).toHaveBeenCalledWith(false);
  });

  it('unwraps `speed` for speed setters', async () => {
    const { responded } = dispatch({ action: 'setAltUploadSpeedLimit', speed: 512 });

    await responded;
    expect(client.setAltUploadSpeedLimit).toHaveBeenCalledWith(512);
    expect(client.setDownloadSpeedLimit).not.toHaveBeenCalled();
  });

  it('unwraps `value` for numeric session setters', async () => {
    const { responded } = dispatch({ action: 'setPeerLimitGlobal', value: 240 });

    await responded;
    expect(client.setPeerLimitGlobal).toHaveBeenCalledWith(240);
  });

  it('unwraps `filename` for script setters', async () => {
    const { responded } = dispatch({
      action: 'setScriptTorrentDoneFilename',
      filename: '/opt/done.sh',
    });

    await responded;
    expect(client.setScriptTorrentDoneFilename).toHaveBeenCalledWith('/opt/done.sh');
  });

  it('unwraps `mode` for setEncryption', async () => {
    const { responded } = dispatch({ action: 'setEncryption', mode: 'required' });

    await responded;
    expect(client.setEncryption).toHaveBeenCalledWith('required');
  });

  it('passes 0 through instead of dropping it', async () => {
    const { responded } = dispatch({ action: 'setAltSpeedTimeBegin', value: 0 });

    await responded;
    expect(client.setAltSpeedTimeBegin).toHaveBeenCalledWith(0);
  });
});

describe('Bg.handleMessage — torrent detail / 4.x actions', () => {
  it('getTorrentDetails forwards the id and returns the payload', async () => {
    client.getTorrentDetails.mockResolvedValue({ id: 42, name: 'ubuntu.iso' });

    const { returned, responded } = dispatch({ action: 'getTorrentDetails', id: 42 });

    expect(returned).toBe(true);
    await expect(responded).resolves.toEqual({ result: { id: 42, name: 'ubuntu.iso' } });
    expect(client.getTorrentDetails).toHaveBeenCalledWith(42);
  });

  it('portTest passes undefined when no ipProtocol is given', async () => {
    client.portTest.mockResolvedValue(true);

    const { responded } = dispatch({ action: 'portTest' });

    await expect(responded).resolves.toEqual({ result: true });
    expect(client.portTest).toHaveBeenCalledWith(undefined);
  });

  it('portTest forwards the ipProtocol when given', async () => {
    client.portTest.mockResolvedValue(false);

    const { responded } = dispatch({ action: 'portTest', ipProtocol: 'ipv6' });

    await expect(responded).resolves.toEqual({ result: false });
    expect(client.portTest).toHaveBeenCalledWith('ipv6');
  });

  it('setSequentialDownload forwards ids and the flag', async () => {
    const { responded } = dispatch({
      action: 'setSequentialDownload',
      ids: [3, 4],
      enabled: true,
    });

    await responded;
    expect(client.setSequentialDownload).toHaveBeenCalledWith([3, 4], true);
  });

  it('setSeedLimits forwards all five positional arguments in order', async () => {
    const { responded } = dispatch({
      action: 'setSeedLimits',
      ids: [9],
      seedRatioMode: 1,
      seedRatioLimit: 2.5,
      seedIdleMode: 2,
      seedIdleLimit: 30,
    });

    await responded;
    expect(client.setSeedLimits).toHaveBeenCalledWith([9], 1, 2.5, 2, 30);
  });

  it('updateTorrentList forwards the force flag', async () => {
    await dispatch({ action: 'updateTorrentList', force: true }).responded;
    expect(client.updateTorrents).toHaveBeenLastCalledWith(true);

    await dispatch({ action: 'updateTorrentList' }).responded;
    expect(client.updateTorrents).toHaveBeenLastCalledWith(undefined);
  });
});

describe('Bg.handleMessage — store actions', () => {
  it('getBgStoreDelta forwards id and patchId to the patch line after init', async () => {
    bg.bgStorePathLine.getDelta.mockReturnValue({ type: 'snapshot', result: { client: {} } });

    const { responded } = dispatch({ action: 'getBgStoreDelta', id: 12, patchId: null });

    await expect(responded).resolves.toEqual({
      result: { type: 'snapshot', result: { client: {} } },
    });
    expect(bg.bgStorePathLine.getDelta).toHaveBeenCalledWith(12, null);
  });

  it('getConfigStore returns a plain snapshot of the config model', async () => {
    bg.bgStore = { config: ConfigStore.create({ hostname: 'nas.local', port: 9092 }) };

    const { responded } = dispatch({ action: 'getConfigStore' });
    const response = await responded;

    const result = response.result as Record<string, unknown>;
    expect(result.hostname).toBe('nas.local');
    expect(result.port).toBe(9092);
    // A snapshot, not the live MST node.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('getConfigStore answers null while the config has not been loaded', async () => {
    bg.bgStore = { config: undefined };

    await expect(dispatch({ action: 'getConfigStore' }).responded).resolves.toEqual({
      result: null,
    });
  });
});

describe('Bg.handleMessage — response contract', () => {
  it('serializes a rejection into {error} and never sends a result', async () => {
    const err = Object.assign(new Error('rpc down'), { code: 'ECONNREFUSED' });
    client.getFileList.mockRejectedValue(err);

    const { returned, responded } = dispatch({ action: 'getFileList', id: 1 });
    const response = await responded;

    expect(returned).toBe(true);
    expect(response).not.toHaveProperty('result');
    expect(response.error).toMatchObject({
      name: 'Error',
      message: 'rpc down',
      code: 'ECONNREFUSED',
    });
    // Serialized, not the live Error instance (structured clone would drop it).
    expect(response.error).not.toBeInstanceOf(Error);
  });

  it('reports a non-Error rejection value instead of swallowing it', async () => {
    client.blocklistUpdate.mockRejectedValue('boom');

    const response = await dispatch({ action: 'blocklistUpdate' }).responded;

    expect(response).not.toHaveProperty('result');
    // serialize-error wraps bare values so the receiver still gets a message.
    expect(response.error).toMatchObject({
      name: 'NonError',
      message: expect.stringContaining('boom'),
    });
  });

  it('invokes the response callback exactly once', async () => {
    const { responded, calls } = dispatch({ action: 'stop', ids: [1] });

    await responded;
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('keeps the async channel open (returns true) for every dispatched action', async () => {
    const messages: BgMessage[] = [
      { action: 'start', ids: [1] },
      { action: 'getTorrentDetails', id: 1 },
      { action: 'portTest' },
      { action: 'setDhtEnabled', enabled: true },
      { action: 'updateSettings' },
      { action: 'getConfigStore' },
    ];

    for (const message of messages) {
      const { returned, responded } = dispatch(message);
      expect(returned, `${message.action} must return true`).toBe(true);
      await responded;
    }
  });

  it('rejects an unknown action instead of ignoring it', async () => {
    const { returned, responded } = dispatch({ action: 'totallyBogus' } as unknown as BgMessage);
    const response = await responded;

    // Must answer, otherwise the caller's sendMessage promise would hang.
    expect(returned).toBe(true);
    expect(response).not.toHaveProperty('result');
    expect(response.error).toMatchObject({ message: 'Unknown request: totallyBogus' });
  });
});

describe('Bg.handleMessage — init gating', () => {
  it('whenReady-guarded actions wait for init instead of throwing when the client is missing', async () => {
    const init = deferred();
    bg.client = null;
    bg.initPromise = init.promise;

    const { returned, responded, calls } = dispatch({
      action: 'setAltSpeedEnabled',
      enabled: true,
    });

    expect(returned).toBe(true);
    await flush();
    // Still waiting for init: no answer yet, and the client was never touched.
    expect(calls).toHaveLength(0);
    expect(client.setAltSpeedEnabled).not.toHaveBeenCalled();

    // init completes and installs the client, exactly as the config autorun does.
    bg.client = client;
    init.resolve();

    await expect(responded).resolves.toEqual({ result: { from: 'setAltSpeedEnabled' } });
    expect(client.setAltSpeedEnabled).toHaveBeenCalledWith(true);
  });

  it('reports "Client not initialized" through {error} when init finished without a client', async () => {
    bg.client = null;
    bg.initPromise = Promise.resolve();

    const { returned, responded } = dispatch({ action: 'updateSettings' });
    const response = await responded;

    expect(returned).toBe(true);
    expect(response.error).toMatchObject({ message: 'Client not initialized' });
  });

  it('treats a null initPromise as ready', async () => {
    bg.initPromise = null;

    await expect(dispatch({ action: 'updateSettings' }).responded).resolves.toEqual({
      result: { from: 'updateSettings' },
    });
    expect(client.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('id-actions (previously unguarded) also wait for init instead of throwing', async () => {
    const init = deferred();
    bg.client = null;
    bg.initPromise = init.promise;

    const { returned, responded, calls } = dispatch({ action: 'start', ids: [1] });

    expect(returned).toBe(true);
    await flush();
    // Still waiting for init: no answer yet, and the client was never touched.
    expect(calls).toHaveLength(0);
    expect(client.start).not.toHaveBeenCalled();

    bg.client = client;
    init.resolve();

    await expect(responded).resolves.toEqual({ result: { from: 'start' } });
    expect(client.start).toHaveBeenCalledWith([1]);
  });

  it('id-actions report "Client not initialized" through {error} rather than throwing', async () => {
    bg.client = null;
    bg.initPromise = Promise.resolve();

    const { returned, responded } = dispatch({ action: 'start', ids: [1] });
    const response = await responded;

    expect(returned).toBe(true);
    expect(response.error).toMatchObject({ message: 'Client not initialized' });
  });
});
