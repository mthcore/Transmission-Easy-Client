import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { applyPatch } from 'mobx-state-tree';
import RootStoreCtx from '../../../tools/rootStoreCtx';
import RootStore from '../../../stores/RootStore';
import ServerOptions from '../ServerOptions';

afterEach(cleanup);

// A ClientStore.settings snapshot covering every field required by the MST
// model (types.number/types.boolean without a default) plus the handful this
// component reads directly.
const SETTINGS_SNAPSHOT = {
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
};

describe('ServerOptions', () => {
  it('renders through the loading -> loaded transition without a hook-count mismatch', async () => {
    // Regression test for React error #310 ("Rendered fewer hooks than
    // expected"): the component used to declare a bunch of useCallback hooks
    // AFTER an `if (!settings) return (...)` early return, so the hook count
    // differed between the "still loading" render (client/settings not synced
    // yet) and the "loaded" render (settings arrived) of the SAME mounted
    // instance — exactly what happens in production once the background
    // client's settings snapshot lands via MobxPatchLine.
    const rootStore = RootStore.create({});

    render(
      <RootStoreCtx.Provider value={rootStore}>
        <ServerOptions />
      </RootStoreCtx.Provider>
    );

    // First render: no client yet, shows the loading/retry shell.
    expect(screen.queryByText(/blocklistRules/)).not.toBeInTheDocument();

    // Client attaches (config autorun / patch sync), still no settings.
    act(() => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client',
        value: { torrents: {} },
      });
    });

    // Settings arrive on a later patch — this is the transition that used to
    // crash with "Rendered fewer hooks than expected".
    await act(async () => {
      applyPatch(rootStore as never, {
        op: 'replace',
        path: '/client/settings',
        value: SETTINGS_SNAPSHOT,
      });
    });

    expect(screen.getByText(chrome.i18n.getMessage('startAddedTorrents'))).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/blocklist')).toBeInTheDocument();
  });
});
