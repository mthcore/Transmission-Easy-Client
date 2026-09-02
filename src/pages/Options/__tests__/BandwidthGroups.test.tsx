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
import BandwidthGroups from '../BandwidthGroups';

afterEach(cleanup);

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

/** Minimum the SettingsStore model requires, plus the rpc version under test. */
const settings = (rpcVersion: number) => ({
  downloadSpeedLimit: 0,
  downloadSpeedLimitEnabled: false,
  uploadSpeedLimit: 0,
  uploadSpeedLimitEnabled: false,
  altSpeedEnabled: false,
  altDownloadSpeedLimit: 0,
  altUploadSpeedLimit: 0,
  downloadDir: '/d',
  rpcVersion,
});

async function mount(rpcVersion = 17, groups: unknown = GROUPS) {
  callApi.mockImplementation((message) =>
    message?.action === 'getGroups' ? Promise.resolve(groups) : Promise.resolve({})
  );
  const rootStore = RootStore.create({});
  render(
    <RootStoreCtx.Provider value={rootStore}>
      <BandwidthGroups />
    </RootStoreCtx.Provider>
  );
  act(() => {
    applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
  });
  await act(async () => {
    applyPatch(rootStore as never, {
      op: 'replace',
      path: '/client/settings',
      value: settings(rpcVersion),
    });
  });
  return rootStore;
}

const sent = (action: string) =>
  callApi.mock.calls
    .map((c) => c[0] as Record<string, unknown> | undefined)
    .filter((m) => m?.action === action);

beforeEach(() => callApi.mockClear());

describe('BandwidthGroups — version gating', () => {
  it('renders nothing on a daemon below Transmission 4.0', async () => {
    // rpc 16 is Transmission 3.0: the service rejects group-get there, so the
    // section must not appear rather than appear and fail.
    await mount(16);
    expect(screen.queryByText('bandwidthGroups')).not.toBeInTheDocument();
    expect(sent('getGroups')).toEqual([]);
  });

  it('loads the groups once the daemon reports rpc 17', async () => {
    await mount(17);
    expect(sent('getGroups')).toHaveLength(1);
    expect(screen.getByText('night')).toBeInTheDocument();
  });
});

describe('BandwidthGroups — editing', () => {
  it('toggling a limit sends only that field, keyed by group name', async () => {
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('night DT_DOWNLOAD_LIMIT'));
    });

    expect(sent('setSessionGroup')).toEqual([
      { action: 'setSessionGroup', name: 'night', options: { speedLimitDownEnabled: false } },
    ]);
  });

  it('a numeric limit commits on blur, not on keystroke', async () => {
    await mount();
    const input = screen.getByDisplayValue('500');

    await act(async () => {
      fireEvent.change(input, { target: { value: '750' } });
    });
    expect(sent('setSessionGroup')).toEqual([]);

    await act(async () => {
      fireEvent.blur(input);
    });
    expect(sent('setSessionGroup')).toEqual([
      { action: 'setSessionGroup', name: 'night', options: { speedLimitDown: 750 } },
    ]);
  });

  it('sends nothing when the value is unchanged or not a number', async () => {
    await mount();
    const input = screen.getByDisplayValue('500') as HTMLInputElement;

    await act(async () => {
      fireEvent.blur(input);
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: 'abc' } });
      fireEvent.blur(input);
    });

    expect(sent('setSessionGroup')).toEqual([]);
    expect(input.value).toBe('500');
  });

  it('re-reads the list after a save, since group-set does not resync', async () => {
    await mount();
    callApi.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('night honorsSessionLimits'));
    });

    expect(sent('setSessionGroup')).toHaveLength(1);
    expect(sent('getGroups')).toHaveLength(1);
  });
});

describe('BandwidthGroups — creating', () => {
  it('creates a group by upserting its name with no options', async () => {
    // The daemon has no create method: group-set is an upsert keyed by name.
    await mount();
    const field = screen.getByLabelText('bandwidthGroup');

    await act(async () => {
      fireEvent.change(field, { target: { value: '  day  ' } });
      fireEvent.click(screen.getByText('add'));
    });

    expect(sent('setSessionGroup')).toEqual([
      { action: 'setSessionGroup', name: 'day', options: {} },
    ]);
  });

  it('refuses a blank name', async () => {
    await mount();
    const field = screen.getByLabelText('bandwidthGroup');

    await act(async () => {
      fireEvent.change(field, { target: { value: '   ' } });
    });

    expect((screen.getByText('add') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText('add'));
    });
    expect(sent('setSessionGroup')).toEqual([]);
  });

  it('creates on Enter as well as on the button', async () => {
    await mount();
    const field = screen.getByLabelText('bandwidthGroup');

    await act(async () => {
      fireEvent.change(field, { target: { value: 'day' } });
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    expect(sent('setSessionGroup')).toHaveLength(1);
  });
});

describe('BandwidthGroups — states', () => {
  it('shows an empty state rather than a bare heading', async () => {
    await mount(17, []);
    expect(screen.getByText('noGroupsYet')).toBeInTheDocument();
  });

  it('surfaces a load failure instead of staying blank', async () => {
    callApi.mockImplementation((message) =>
      message?.action === 'getGroups'
        ? Promise.reject(Object.assign(new Error('daemon refused'), { name: 'Error' }))
        : Promise.resolve({})
    );
    const rootStore = RootStore.create({});
    render(
      <RootStoreCtx.Provider value={rootStore}>
        <BandwidthGroups />
      </RootStoreCtx.Provider>
    );
    act(() => {
      applyPatch(rootStore as never, { op: 'replace', path: '/client', value: { torrents: {} } });
    });
    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings',
        value: settings(17),
      });
    });

    expect(screen.getByText(/daemon refused/)).toBeInTheDocument();
  });
});
