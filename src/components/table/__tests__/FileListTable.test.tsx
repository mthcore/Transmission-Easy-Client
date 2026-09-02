import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { applyPatch } from 'mobx-state-tree';

const callApi = vi.hoisted(() =>
  vi.fn((_message: Record<string, unknown>) => Promise.resolve({} as unknown))
);
vi.mock('../../../tools/callApi', () => ({ default: callApi }));

import RootStoreCtx from '../../../tools/rootStoreCtx';
import RootStore from '../../../stores/RootStore';
import FileListTable from '../FileListTable';

/**
 * Windowing on the file list.
 *
 * jsdom reports every element as zero-sized, so useVirtualRows falls back to its
 * default row height and a 600px viewport. That is enough to prove the property
 * that matters: the DOM holds a bounded window plus spacers, not one row per
 * file. Without it a season pack put thousands of live <tr> on the page and made
 * every sort and select-all walk all of them.
 */

afterEach(cleanup);
beforeEach(() => callApi.mockReset());

function files(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Pack/file-${String(i).padStart(4, '0')}.mkv`,
    shortName: `file-${String(i).padStart(4, '0')}.mkv`,
    size: 100,
    downloaded: 0,
    priority: 2,
  }));
}

const torrent = {
  id: 7,
  statusCode: 6,
  errorCode: 0,
  errorString: '',
  name: 'Pack',
  size: 100,
  percentDone: 1,
  recheckProgress: 0,
  downloaded: 100,
  uploaded: 0,
  shared: 0,
  uploadSpeed: 0,
  downloadSpeed: 0,
  eta: -1,
  activePeers: 0,
  peers: 0,
  activeSeeds: 0,
  seeds: 0,
  addedTime: 0,
  completedTime: 0,
  directory: '/d',
};

async function mountWith(fileCount: number) {
  callApi.mockImplementation((message) =>
    message?.action === 'getFileList' ? Promise.resolve(files(fileCount)) : Promise.resolve({})
  );

  const rootStore = RootStore.create({});
  act(() => {
    applyPatch(rootStore as never, [
      { op: 'replace', path: '/config', value: {} },
      { op: 'replace', path: '/client', value: { torrents: { 7: torrent } } },
    ]);
  });

  const fileList = rootStore.createFileList(7);
  await act(async () => {
    await fileList.fetchFiles();
  });

  render(
    <RootStoreCtx.Provider value={rootStore}>
      <FileListTable />
    </RootStoreCtx.Provider>
  );
  // Let the post-commit measure/range pass settle
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return rootStore;
}

/** Real rows only — the spacers carry the scroll height, not content. */
const renderedRows = () =>
  Array.from(document.querySelectorAll('tbody tr')).filter(
    (row) => !row.hasAttribute('data-virtual-spacer')
  );

const spacers = () => document.querySelectorAll('tbody tr[data-virtual-spacer]');

describe('FileListTable — windowing', () => {
  it('renders every row of a small list, with no spacers', async () => {
    await mountWith(5);
    expect(renderedRows()).toHaveLength(5);
    expect(spacers()).toHaveLength(0);
  });

  it('renders a bounded window of a large list, not one row per file', async () => {
    await mountWith(2000);
    const rows = renderedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
  });

  it('holds the remaining height in a spacer so the scrollbar stays honest', async () => {
    await mountWith(2000);
    const trailing = spacers()[spacers().length - 1] as HTMLElement | undefined;
    expect(trailing).toBeTruthy();
    expect(parseInt(trailing!.style.height, 10)).toBeGreaterThan(0);
  });

  it('narrows the window as the search filters the list down', async () => {
    const rootStore = await mountWith(2000);
    const before = renderedRows().length;

    await act(async () => {
      rootStore.fileList?.setNameQuery('file-0001');
    });

    const after = renderedRows();
    expect(after.length).toBeLessThan(before);
    expect(after).toHaveLength(1);
    expect(screen.getByText(/file-0001\.mkv/)).toBeInTheDocument();
  });
});
