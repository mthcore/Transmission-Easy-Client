import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { applyPatch } from 'mobx-state-tree';

const callApi = vi.hoisted(() =>
  vi.fn((_message: Record<string, unknown>) => Promise.resolve({} as unknown))
);
vi.mock('../../../tools/callApi', () => ({ default: callApi }));

import RootStoreCtx from '../../../tools/rootStoreCtx';
import RootStore from '../../../stores/RootStore';
import ServerOptions from '../ServerOptions';

/**
 * ServerOptions drives ~40 daemon settings through several near-identical
 * layers. This suite pins what the UI must keep producing.
 *
 * It asserts on the MESSAGE that leaves the page (callApi is mocked) rather
 * than on the store method, because the message is the contract: the store
 * action in between is the part most likely to be consolidated later, and this
 * file should keep passing unchanged when it is.
 *
 * The control table is deliberately data-driven so new settings are one row.
 */

afterEach(cleanup);

/** Every field the SettingsStore model requires, plus the ones under test. */
const SETTINGS = {
  downloadSpeedLimit: 100,
  downloadSpeedLimitEnabled: false,
  uploadSpeedLimit: 50,
  uploadSpeedLimitEnabled: false,
  altSpeedEnabled: false,
  altDownloadSpeedLimit: 10,
  altUploadSpeedLimit: 5,
  downloadDir: '/downloads',
  blocklistUrl: 'https://example.com/blocklist',
  incompleteDir: '',
  scriptTorrentDoneFilename: '',
  scriptTorrentAddedFilename: '',
  scriptTorrentDoneSeedingFilename: '',
  altSpeedTimeDay: 127,
  // toggles under test — explicit so the expected "next" value is unambiguous
  startAddedTorrents: true,
  seedRatioLimited: false,
  downloadQueueEnabled: true,
  seedQueueEnabled: true,
  queueStalledEnabled: true,
  // These three gate the visibility of their companion field (see the
  // conditional-rendering tests below), so they must be on for the numeric
  // table to reach idleSeedingLimit / seedQueueSize / downloadQueueSize.
  idleSeedingLimitEnabled: true,
  incompleteDirEnabled: false,
  renamePartialFiles: true,
  portForwardingEnabled: false,
  dhtEnabled: true,
  pexEnabled: true,
  lpdEnabled: false,
  utpEnabled: true,
  altSpeedTimeEnabled: false,
  blocklistEnabled: false,
  // numbers under test
  peerLimitGlobal: 200,
  peerLimitPerTorrent: 50,
  idleSeedingLimit: 30,
  downloadQueueSize: 5,
  seedQueueSize: 10,
  queueStalledMinutes: 30,
  peerPort: 51413,
};

/** label i18n key -> { action, settings key }. chromeMock renders the key itself. */
const TOGGLES = [
  { label: 'startAddedTorrents', action: 'setStartAddedTorrents', key: 'startAddedTorrents' },
  { label: 'seedRatioLimited', action: 'setSeedRatioLimited', key: 'seedRatioLimited' },
  { label: 'downloadQueueEnabled', action: 'setDownloadQueueEnabled', key: 'downloadQueueEnabled' },
  { label: 'seedQueueEnabled', action: 'setSeedQueueEnabled', key: 'seedQueueEnabled' },
  { label: 'queueStalledEnabled', action: 'setQueueStalledEnabled', key: 'queueStalledEnabled' },
  { label: 'incompleteDirEnabled', action: 'setIncompleteDirEnabled', key: 'incompleteDirEnabled' },
  { label: 'renamePartialFiles', action: 'setRenamePartialFiles', key: 'renamePartialFiles' },
  {
    label: 'portForwardingEnabled',
    action: 'setPortForwardingEnabled',
    key: 'portForwardingEnabled',
  },
  { label: 'dhtEnabled', action: 'setDhtEnabled', key: 'dhtEnabled' },
  { label: 'pexEnabled', action: 'setPexEnabled', key: 'pexEnabled' },
  { label: 'lpdEnabled', action: 'setLpdEnabled', key: 'lpdEnabled' },
  { label: 'utpEnabled', action: 'setUtpEnabled', key: 'utpEnabled' },
  { label: 'altSpeedTimeEnabled', action: 'setAltSpeedTimeEnabled', key: 'altSpeedTimeEnabled' },
  // NB: the label key is 'blocklistEnable', the setting is 'blocklistEnabled'
  { label: 'blocklistEnable', action: 'setBlocklistEnabled', key: 'blocklistEnabled' },
] as const;

const NUMBERS = [
  { label: 'peerLimitGlobal', action: 'setPeerLimitGlobal', typed: '240', expected: 240 },
  { label: 'peerLimitPerTorrent', action: 'setPeerLimitPerTorrent', typed: '75', expected: 75 },
  { label: 'idleSeedingLimit', action: 'setIdleSeedingLimit', typed: '45', expected: 45 },
  { label: 'downloadQueueSize', action: 'setDownloadQueueSize', typed: '8', expected: 8 },
  { label: 'seedQueueSize', action: 'setSeedQueueSize', typed: '12', expected: 12 },
  { label: 'queueStalledMinutes', action: 'setQueueStalledMinutes', typed: '20', expected: 20 },
  { label: 'peerPort', action: 'setPeerPort', typed: '6881', expected: 6881 },
] as const;

async function mountLoaded() {
  const rootStore = RootStore.create({});
  render(
    <RootStoreCtx.Provider value={rootStore}>
      <ServerOptions />
    </RootStoreCtx.Provider>
  );
  act(() => {
    applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
  });
  await act(async () => {
    applyPatch(rootStore as never, { op: 'replace', path: '/client/settings', value: SETTINGS });
  });
  // The mount-time settings refresh is noise for these assertions
  callApi.mockClear();
  return rootStore;
}

const controlIn = (label: string, selector: string): HTMLInputElement => {
  const row = screen.getByText(label).closest('label');
  if (!row) throw new Error(`No <label> wrapping "${label}"`);
  const input = row.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No ${selector} inside the "${label}" label`);
  return input;
};

/** Messages this page sent, ignoring the background sync chatter. */
const sent = (action: string) =>
  callApi.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message.action === action);

beforeEach(() => {
  callApi.mockClear();
  callApi.mockImplementation(() => Promise.resolve({}));
});

describe('ServerOptions — toggle controls', () => {
  it.each(TOGGLES)(
    '$label sends $action with the negated value',
    async ({ label, action, key }) => {
      await mountLoaded();
      const before = SETTINGS[key as keyof typeof SETTINGS] as boolean;

      await act(async () => {
        fireEvent.click(controlIn(label, 'input[type="checkbox"]'));
      });

      expect(sent(action)).toEqual([{ action, enabled: !before }]);
    }
  );

  it('renders each toggle from the settings snapshot, not from local state', async () => {
    await mountLoaded();
    for (const { label, key } of TOGGLES) {
      const input = controlIn(label, 'input[type="checkbox"]');
      expect(input.checked, `${label} did not reflect settings.${key}`).toBe(
        SETTINGS[key as keyof typeof SETTINGS]
      );
    }
  });
});

describe('ServerOptions — numeric controls', () => {
  it.each(NUMBERS)(
    '$label sends $action on blur, not on keystroke',
    async ({ label, action, typed, expected }) => {
      await mountLoaded();
      const input = controlIn(label, 'input[type="number"]');

      await act(async () => {
        fireEvent.change(input, { target: { value: typed } });
      });
      // Typing must not hammer the daemon — the commit happens on blur
      expect(sent(action)).toEqual([]);

      await act(async () => {
        fireEvent.blur(input);
      });
      expect(sent(action)).toEqual([{ action, value: expected }]);
    }
  );

  it('clamps below the input minimum and writes the clamped value back', async () => {
    await mountLoaded();
    const input = controlIn('peerLimitGlobal', 'input[type="number"]');

    await act(async () => {
      fireEvent.change(input, { target: { value: '0' } });
      fireEvent.blur(input);
    });

    // min="1": the daemon receives the clamp, and the field stops showing 0
    expect(sent('setPeerLimitGlobal')).toEqual([{ action: 'setPeerLimitGlobal', value: 1 }]);
    expect(input.value).toBe('1');
  });

  it('clamps above the input maximum', async () => {
    await mountLoaded();
    const input = controlIn('peerPort', 'input[type="number"]');

    await act(async () => {
      fireEvent.change(input, { target: { value: '99999' } });
      fireEvent.blur(input);
    });

    expect(sent('setPeerPort')).toEqual([{ action: 'setPeerPort', value: 65535 }]);
    expect(input.value).toBe('65535');
  });

  it('sends nothing and restores the field when the value is not a number', async () => {
    // The blur handler had no branch for a cleared or unparsable field, so it
    // stayed blank for the rest of the session: the input is uncontrolled and
    // nothing remounts it.
    await mountLoaded();
    const input = controlIn('peerPort', 'input[type="number"]');

    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);
    });

    expect(sent('setPeerPort')).toEqual([]);
    expect(input.value).toBe(String(SETTINGS.peerPort));
  });
});

describe('ServerOptions — behaviours a rewrite must not lose', () => {
  it('a fast double click sends both states, not the same one twice', async () => {
    // The pendingToggles latch: without it both clicks read the same
    // render-time value, so the second click did not undo the first.
    await mountLoaded();
    let release!: () => void;
    callApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );
    const input = controlIn('dhtEnabled', 'input[type="checkbox"]');

    await act(async () => {
      fireEvent.click(input);
      fireEvent.click(input);
    });

    expect(sent('setDhtEnabled')).toEqual([
      { action: 'setDhtEnabled', enabled: false },
      { action: 'setDhtEnabled', enabled: true },
    ]);
    await act(async () => {
      release();
    });
  });

  it('surfaces a rejected setting change instead of failing silently', async () => {
    // Every daemon mutation on this page used to fail silently: the error only
    // reached ClientStore.lastErrorMessage, which no options component renders.
    await mountLoaded();
    callApi.mockImplementation(() => Promise.reject(new Error('daemon refused')));

    await act(async () => {
      fireEvent.click(controlIn('dhtEnabled', 'input[type="checkbox"]'));
    });

    expect(screen.getByText(/daemon refused/)).toBeInTheDocument();
  });

  it('refreshes the settings on mount rather than trusting the background mirror', async () => {
    // The page has no polling loop, so a warm service worker used to leave it
    // displaying values fetched long ago.
    const rootStore = RootStore.create({});
    render(
      <RootStoreCtx.Provider value={rootStore}>
        <ServerOptions />
      </RootStoreCtx.Provider>
    );
    act(() => {
      applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
    });
    await act(async () => {
      applyPatch(rootStore as never, { op: 'replace', path: '/client/settings', value: SETTINGS });
    });

    expect(sent('updateSettings').length).toBeGreaterThan(0);
  });
});

describe('ServerOptions — conditionally rendered fields', () => {
  // A value field only exists while its companion flag is on. Rendering every
  // setting unconditionally would show an idle-seeding limit for a daemon that
  // is not idle-seeding, and a queue size for a disabled queue.
  it.each([
    { field: 'idleSeedingLimit', flag: 'idleSeedingLimitEnabled' },
    { field: 'seedQueueSize', flag: 'seedQueueEnabled' },
    { field: 'downloadQueueSize', flag: 'downloadQueueEnabled' },
    { field: 'queueStalledMinutes', flag: 'queueStalledEnabled' },
  ])('$field is hidden while $flag is off', async ({ field, flag }) => {
    const rootStore = RootStore.create({});
    render(
      <RootStoreCtx.Provider value={rootStore}>
        <ServerOptions />
      </RootStoreCtx.Provider>
    );
    act(() => {
      applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
    });
    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings',
        value: { ...SETTINGS, [flag]: false },
      });
    });

    expect(screen.queryByText(field)).not.toBeInTheDocument();
  });

  it('shows the field again once the flag is on', async () => {
    await mountLoaded();
    for (const field of [
      'idleSeedingLimit',
      'seedQueueSize',
      'downloadQueueSize',
      'queueStalledMinutes',
    ]) {
      expect(screen.getByText(field), `${field} should be visible`).toBeInTheDocument();
    }
  });
});

describe('ServerOptions — the control table itself', () => {
  it('every table entry resolves to a real control', () => {
    // Guards against the suite quietly shrinking: a renamed i18n key would
    // otherwise make an entry unreachable rather than failing.
    expect(TOGGLES.length + NUMBERS.length).toBe(21);
  });
});

/**
 * The default tracker list is a Transmission 4.0 setting, so the page must not
 * offer it to a daemon that would reject it. It is also the first multi-line
 * setting on this page, which is why it is a textarea with its own Apply
 * button rather than a row in the tables above.
 */
describe('ServerOptions — default trackers (Transmission 4.0+)', () => {
  const mountWithRpc = async (rpcVersion: number, defaultTrackers?: string) => {
    // rpc 17 also switches on the bandwidth-groups section, which fetches on
    // mount; without a shaped answer it fails for a reason unrelated to this
    // suite.
    callApi.mockImplementation((message: Record<string, unknown>) =>
      Promise.resolve(message.action === 'getGroups' ? [] : ({} as unknown))
    );
    const rootStore = RootStore.create({});
    render(
      <RootStoreCtx.Provider value={rootStore}>
        <ServerOptions />
      </RootStoreCtx.Provider>
    );
    act(() => {
      applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
    });
    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings',
        value: { ...SETTINGS, rpcVersion, defaultTrackers },
      });
    });
    callApi.mockClear();
    return rootStore;
  };

  const textarea = () => {
    const row = screen.getByText('defaultTrackers').closest('label');
    const found = row?.querySelector('textarea');
    if (!found) throw new Error('No textarea in the defaultTrackers label');
    return found;
  };

  it('is hidden on a daemon older than 4.0', async () => {
    await mountWithRpc(16);

    expect(screen.queryByText('defaultTrackers')).not.toBeInTheDocument();
  });

  it('shows the list the daemon reported', async () => {
    await mountWithRpc(17, 'udp://a:1337\n\nudp://b:1337');

    expect(textarea().value).toBe('udp://a:1337\n\nudp://b:1337');
  });

  it('is empty, not undefined, when the daemon reports no list', async () => {
    // maybe(string): an uncontrolled textarea would warn and lose the edit.
    await mountWithRpc(17, undefined);

    expect(textarea().value).toBe('');
  });

  it('sends the whole list on Apply, not on every keystroke', async () => {
    await mountWithRpc(17, '');
    const field = textarea();

    fireEvent.change(field, { target: { value: 'udp://tr:1337\n\nudp://tr2:80' } });
    expect(sent('setDefaultTrackers')).toEqual([]);

    const row = screen.getByText('defaultTrackers').closest('label');
    fireEvent.click(row!.querySelector('button')!);

    expect(sent('setDefaultTrackers')).toEqual([
      { action: 'setDefaultTrackers', trackers: 'udp://tr:1337\n\nudp://tr2:80' },
    ]);
  });

  it('keeps what is being typed when an unrelated setting changes', async () => {
    // The page re-syncs from the store on every settings refresh; a naive
    // reset would discard a half-typed list on the next poll.
    const rootStore = await mountWithRpc(17, 'udp://a:1337');
    fireEvent.change(textarea(), { target: { value: 'udp://half' } });

    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings/peerLimitGlobal',
        value: 321,
      });
    });

    expect(textarea().value).toBe('udp://half');
  });

  it('adopts a list changed by another client', async () => {
    const rootStore = await mountWithRpc(17, 'udp://a:1337');

    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings/defaultTrackers',
        value: 'udp://elsewhere:1337',
      });
    });

    expect(textarea().value).toBe('udp://elsewhere:1337');
  });
});
