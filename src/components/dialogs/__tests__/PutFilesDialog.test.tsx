import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({
  config: { folders: [] as { name: string; path: string }[] },
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import PutFilesDialog from '../PutFilesDialog';
import { MAX_FETCH_SIZE } from '../../../constants';

/**
 * Adding .torrent files hands the background a set of blob URLs and waits.
 *
 * The waiting is the point. The blobs belong to the popup document, so closing
 * as soon as the request left revoked them while the background was still
 * reading — the add simply did not happen, with nothing to show for it. Every
 * path here therefore has to revoke exactly once, and only after the transfer
 * has settled one way or the other.
 */

afterEach(cleanup);

let created: string[];
let revoked: string[];
let client: { sendFiles: ReturnType<typeof vi.fn> };
let dialogStore: { close: ReturnType<typeof vi.fn>; files: File[] };
let resolveSend: (value?: unknown) => void;
let rejectSend: (reason?: unknown) => void;

function fileOf(size: number, name = 'a.torrent') {
  return { name, size } as File;
}

beforeEach(() => {
  showError.mockClear();
  created = [];
  revoked = [];
  let counter = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:${++counter}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });

  client = {
    sendFiles: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolveSend = resolve;
          rejectSend = reject;
        })
    ),
  };
  store.client = client;
  store.config = { folders: [] };
  dialogStore = { close: vi.fn(), files: [fileOf(1000)] };
});

afterEach(() => vi.unstubAllGlobals());

function open() {
  render(<PutFilesDialog dialogStore={dialogStore as never} />);
}

const submit = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement);
const settle = async (settleWith: 'ok' | 'fail' = 'ok') => {
  await act(async () => {
    if (settleWith === 'ok') resolveSend();
    else rejectSend(new Error('daemon said 500'));
  });
};

describe('PutFilesDialog — without a folder to choose', () => {
  it('sends the files straight away, with no dialog to confirm', () => {
    // No folders configured means there is nothing to ask; making the user
    // press OK on an empty dialog would be a step for nothing.
    open();

    expect(client.sendFiles).toHaveBeenCalledWith(created, undefined);
  });

  it('submits once even though React runs the effect twice', () => {
    // The ref guard is what makes this idempotent. The empty dependency array
    // alone does not: StrictMode mounts, unmounts and remounts, preserving
    // refs but running the effect again — and a second submit here uploads the
    // same torrents twice.
    render(
      <React.StrictMode>
        <PutFilesDialog dialogStore={dialogStore as never} />
      </React.StrictMode>
    );

    expect(client.sendFiles).toHaveBeenCalledTimes(1);
  });

  it('submits once across a re-render', () => {
    const { rerender } = render(<PutFilesDialog dialogStore={dialogStore as never} />);
    rerender(<PutFilesDialog dialogStore={dialogStore as never} />);

    expect(client.sendFiles).toHaveBeenCalledTimes(1);
  });
});

describe('PutFilesDialog — waiting for the transfer', () => {
  it('stays open while the background is still reading the blobs', () => {
    // The blobs belong to this document: closing here revokes them mid-read
    // and the add is silently lost.
    open();

    expect(dialogStore.close).not.toHaveBeenCalled();
    expect(revoked).toEqual([]);
  });

  it('closes and revokes once the transfer has landed', async () => {
    open();
    await settle('ok');

    expect(revoked).toEqual(created);
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('revokes and reports when the daemon refuses', async () => {
    open();
    await settle('fail');

    expect(revoked).toEqual(created);
    expect(showError).toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('leaves Cancel usable while sending', () => {
    // Disabling every control dropped focus to <body>, and the tab trap then
    // walked the page behind the modal.
    open();
    const buttons = Array.from(document.querySelectorAll('input'));
    const cancel = buttons.find((b) => b.type === 'button');
    const ok = buttons.find((b) => b.type === 'submit');

    expect(ok?.disabled).toBe(true);
    expect(cancel?.disabled).toBe(false);
  });
});

describe('PutFilesDialog — files it will not send', () => {
  it('sends nothing at all for an empty drop', () => {
    // sendFiles([]) reached the daemon, added nothing, and still closed on a
    // success path.
    dialogStore.files = [];
    open();

    expect(client.sendFiles).not.toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('drops a file past the size cap and says so', () => {
    // Oversized files are read fully into memory before upload.
    dialogStore.files = [fileOf(MAX_FETCH_SIZE + 1)];
    open();

    expect(client.sendFiles).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('sends the acceptable files and still reports the rejected one', () => {
    dialogStore.files = [fileOf(1000, 'ok.torrent'), fileOf(MAX_FETCH_SIZE + 1, 'huge.torrent')];
    open();

    expect(showError).toHaveBeenCalled();
    expect(client.sendFiles).toHaveBeenCalledWith(created, undefined);
    expect(created).toHaveLength(1);
  });

  it('accepts a file exactly at the cap', () => {
    // The cap is inclusive; an off-by-one here rejects a legitimate file.
    dialogStore.files = [fileOf(MAX_FETCH_SIZE)];
    open();

    expect(client.sendFiles).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('creates no blob URL for a drop it will not send', () => {
    dialogStore.files = [];
    open();

    expect(created).toEqual([]);
  });
});

describe('PutFilesDialog — before the client is ready', () => {
  it('revokes the URLs it had already created', async () => {
    // They were made for a consumer that will never read them.
    store.client = undefined;
    open();

    expect(revoked).toEqual(created);
    expect(created).not.toEqual([]);
  });

  it('says so rather than closing as if it had worked', () => {
    store.client = undefined;
    open();

    expect(showError).toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });
});

describe('PutFilesDialog — choosing a folder', () => {
  beforeEach(() => {
    store.config = {
      folders: [
        { name: 'Films', path: '/mnt/films' },
        { name: 'Séries', path: '/mnt/series' },
      ],
    };
  });

  it('waits for the user rather than sending on open', () => {
    open();

    expect(client.sendFiles).not.toHaveBeenCalled();
  });

  it('sends to the chosen folder’s path', () => {
    open();
    fireEvent.change(document.querySelector('select[name="directory"]') as HTMLSelectElement, {
      target: { value: '1' },
    });
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(created, '/mnt/series');
  });

  it('lets the daemon decide when the default entry is kept', () => {
    // The default option is negative: it means "wherever the daemon puts
    // things", which is an absent directory rather than a chosen one.
    open();
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(created, undefined);
  });
});
