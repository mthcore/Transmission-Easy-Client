import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BgMessage } from '../../types';

vi.mock('../TransmissionClient');
import bgSingleton from '../Bg';

/**
 * Bandwidth groups (Transmission 4.0+, rpc 17) reach the daemon through their
 * own RPC methods — group-get and group-set — rather than the session-set path
 * every other setting uses, so they carry their own message types and their own
 * dispatch cases.
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
  initPromise: Promise<void> | null;
}

const bg = bgSingleton as unknown as BgHandle;

const ownPageSender = {
  id: chrome.runtime.id,
  url: `${chrome.runtime.getURL('')}options.html#/server`,
} as chrome.runtime.MessageSender;

function dispatch(message: BgMessage) {
  let settle!: (value: ResponseBody) => void;
  const responded = new Promise<ResponseBody>((resolve) => {
    settle = resolve;
  });
  bg.handleMessage(message, ownPageSender, (value) => settle(value as ResponseBody));
  return responded;
}

let client: {
  getGroups: Mock;
  setSessionGroup: Mock;
  setTorrentGroup: Mock;
};

const GROUPS = [
  {
    name: 'night',
    honorsSessionLimits: false,
    speedLimitDown: 500,
    speedLimitDownEnabled: true,
    speedLimitUp: 100,
    speedLimitUpEnabled: false,
  },
];

beforeEach(() => {
  client = {
    getGroups: vi.fn().mockResolvedValue(GROUPS),
    setSessionGroup: vi.fn().mockResolvedValue(undefined),
    setTorrentGroup: vi.fn().mockResolvedValue({ result: 'success' }),
  };
  bg.client = client;
  bg.initPromise = Promise.resolve();
  bg.bgStore = { config: undefined, fetchConfig: vi.fn().mockResolvedValue(undefined) };
});

describe('Bg.handleMessage — bandwidth groups', () => {
  it('getGroups returns the normalized list', async () => {
    const body = await dispatch({ action: 'getGroups' } as BgMessage);
    expect(client.getGroups).toHaveBeenCalledWith(undefined);
    expect(body).toEqual({ result: GROUPS });
  });

  it('getGroups forwards a name filter when one is given', async () => {
    await dispatch({ action: 'getGroups', names: ['night'] } as BgMessage);
    expect(client.getGroups).toHaveBeenCalledWith(['night']);
  });

  it('setSessionGroup forwards the name and the options object unchanged', async () => {
    const options = { speedLimitDown: 500, speedLimitDownEnabled: true };
    await dispatch({ action: 'setSessionGroup', name: 'night', options } as BgMessage);
    expect(client.setSessionGroup).toHaveBeenCalledWith('night', options);
  });

  it('setTorrentGroup forwards the ids and the group name', async () => {
    await dispatch({ action: 'setTorrentGroup', ids: [1, 2], group: 'night' } as BgMessage);
    expect(client.setTorrentGroup).toHaveBeenCalledWith([1, 2], 'night');
  });

  it('an empty group name is passed through — that is how a torrent is removed from its group', async () => {
    await dispatch({ action: 'setTorrentGroup', ids: [3], group: '' } as BgMessage);
    expect(client.setTorrentGroup).toHaveBeenCalledWith([3], '');
  });

  it('addresses torrents by hash as well as by id', async () => {
    // Numeric ids are reassigned when the daemon restarts; the destructive and
    // long-lived paths use hashes for that reason.
    const hash = 'a'.repeat(40);
    await dispatch({ action: 'setTorrentGroup', ids: [hash], group: 'night' } as BgMessage);
    expect(client.setTorrentGroup).toHaveBeenCalledWith([hash], 'night');
  });

  it('surfaces a version rejection from an older daemon as {error}', async () => {
    // The service gates group-get/group-set on rpc 17; the UI hides the feature
    // below that, and this is the backstop behind it.
    client.getGroups.mockRejectedValue(
      Object.assign(new Error('group-get requires Transmission RPC 17+ (daemon reports 16)'), {
        code: 'UNSUPPORTED_RPC_VERSION',
      })
    );

    const body = await dispatch({ action: 'getGroups' } as BgMessage);
    expect(body.error?.message).toMatch(/requires Transmission RPC 17/);
    expect(body).not.toHaveProperty('result');
  });

  it('refuses all three actions from a web page', async () => {
    const webPage = { id: chrome.runtime.id, url: 'https://tracker.example/x' };
    const actions: BgMessage[] = [
      { action: 'getGroups' } as BgMessage,
      { action: 'setSessionGroup', name: 'x', options: {} } as BgMessage,
      { action: 'setTorrentGroup', ids: [1], group: 'x' } as BgMessage,
    ];
    for (const message of actions) {
      const returned = bg.handleMessage(message, webPage as chrome.runtime.MessageSender, () => {
        throw new Error(`${message.action} answered a web page`);
      });
      expect(returned).toBeUndefined();
    }
    expect(client.getGroups).not.toHaveBeenCalled();
    expect(client.setSessionGroup).not.toHaveBeenCalled();
    expect(client.setTorrentGroup).not.toHaveBeenCalled();
  });
});
