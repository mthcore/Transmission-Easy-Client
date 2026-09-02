import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({
  config: { folders: [] as { name: string; path: string }[] },
  client: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import PutUrlDialog from '../PutUrlDialog';

/**
 * Adding a torrent by URL. The field is marked `required`, which is exactly the
 * trap: whitespace counts as a value to the browser, so a line of spaces passed
 * validation, reached the trim, and left the handler with nothing to send — the
 * OK button simply appeared dead.
 */

afterEach(cleanup);

let client: { sendFiles: ReturnType<typeof vi.fn> };
let dialogStore: { close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  showError.mockClear();
  client = { sendFiles: vi.fn().mockResolvedValue(undefined) };
  store.client = client;
  store.config = { folders: [] };
  dialogStore = { close: vi.fn() };
});

function open() {
  render(<PutUrlDialog dialogStore={dialogStore as never} />);
}

const field = () => document.querySelector('input[name="url"]') as HTMLInputElement;
const form = () => document.querySelector('form') as HTMLFormElement;
const submit = () => fireEvent.submit(form());
const type = (value: string) => fireEvent.change(field(), { target: { value } });

describe('PutUrlDialog — sending a URL', () => {
  it('sends what was typed', () => {
    open();
    type('https://example.org/ubuntu.torrent');
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(
      ['https://example.org/ubuntu.torrent'],
      undefined
    );
  });

  it('trims a URL pasted with surrounding spaces', () => {
    open();
    type('  magnet:?xt=urn:btih:abc  ');
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(['magnet:?xt=urn:btih:abc'], undefined);
  });

  it('sends one URL, as a list', () => {
    // sendFiles takes a list because the drop path can carry several; this
    // path always carries exactly one.
    open();
    type('https://example.org/a.torrent');
    submit();

    expect(client.sendFiles.mock.calls[0][0]).toHaveLength(1);
  });

  it('closes once the request is on its way', () => {
    open();
    type('https://example.org/a.torrent');
    submit();

    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('reports a refusal from the daemon', async () => {
    client.sendFiles.mockRejectedValueOnce(new Error('could not fetch'));
    open();
    type('https://example.org/a.torrent');
    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalled();
  });
});

describe('PutUrlDialog — refusing an empty URL', () => {
  it('sends nothing for a line of spaces, which `required` accepts', () => {
    open();
    const reportValidity = vi.spyOn(form(), 'reportValidity').mockReturnValue(false);
    type('   ');
    submit();

    expect(client.sendFiles).not.toHaveBeenCalled();
    expect(reportValidity).toHaveBeenCalled();
  });

  it('clears the field so the browser can say why', () => {
    // A silent return left the spaces in place, so the validation bubble had
    // nothing to complain about and the button looked dead.
    open();
    vi.spyOn(form(), 'reportValidity').mockReturnValue(false);
    type('   ');
    submit();

    expect(field().value).toBe('');
  });

  it('stays open so the user can correct it', () => {
    open();
    vi.spyOn(form(), 'reportValidity').mockReturnValue(false);
    type('   ');
    submit();

    expect(dialogStore.close).not.toHaveBeenCalled();
  });
});

describe('PutUrlDialog — choosing a folder', () => {
  beforeEach(() => {
    store.config = {
      folders: [
        { name: 'Films', path: '/mnt/films' },
        { name: 'Séries', path: '/mnt/series' },
      ],
    };
  });

  it('sends to the chosen folder’s path', () => {
    open();
    type('https://example.org/a.torrent');
    fireEvent.change(document.querySelector('select[name="directory"]') as HTMLSelectElement, {
      target: { value: '0' },
    });
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(expect.any(Array), '/mnt/films');
  });

  it('lets the daemon decide when the default entry is kept', () => {
    open();
    type('https://example.org/a.torrent');
    submit();

    expect(client.sendFiles).toHaveBeenCalledWith(expect.any(Array), undefined);
  });

  it('offers no folder select at all when none are configured', () => {
    store.config = { folders: [] };
    open();

    expect(document.querySelector('select[name="directory"]')).toBeNull();
  });
});
