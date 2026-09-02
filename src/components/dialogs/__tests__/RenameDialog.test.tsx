import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import RenameDialog from '../RenameDialog';

/**
 * Renaming addresses a path inside a torrent, so the daemon has to be given
 * both the old path and the new name. Two inputs it must never be given: an
 * empty name, which it rejects — and the only trace was a generic toast after
 * the dialog had already closed — and a name identical to the current one,
 * which is a request that changes nothing.
 */

afterEach(cleanup);

let client: { rename: ReturnType<typeof vi.fn> };
let dialogStore: {
  close: ReturnType<typeof vi.fn>;
  path: string;
  name: string;
  torrentIds: number[];
};

beforeEach(() => {
  showError.mockClear();
  client = { rename: vi.fn().mockResolvedValue(undefined) };
  store.client = client;
  dialogStore = { close: vi.fn(), path: 'pack/ep01.mkv', name: 'ep01.mkv', torrentIds: [3] };
});

function open() {
  render(<RenameDialog dialogStore={dialogStore as never} />);
}

const field = () => document.querySelector('input[name="name"]') as HTMLInputElement;
const form = () => document.querySelector('form') as HTMLFormElement;
const submit = () => fireEvent.submit(form());

describe('RenameDialog', () => {
  it('offers the current name to edit', () => {
    open();

    expect(field().value).toBe('ep01.mkv');
  });

  it('renames the path inside the torrent, not the torrent', () => {
    // The daemon needs both: the path identifies what is being renamed.
    open();
    fireEvent.change(field(), { target: { value: 'ep01-fr.mkv' } });
    submit();

    expect(client.rename).toHaveBeenCalledWith([3], 'pack/ep01.mkv', 'ep01-fr.mkv');
  });

  it('trims a name that was pasted with spaces', () => {
    open();
    fireEvent.change(field(), { target: { value: '  ep01-fr.mkv  ' } });
    submit();

    expect(client.rename).toHaveBeenCalledWith([3], 'pack/ep01.mkv', 'ep01-fr.mkv');
  });

  it('sends nothing when the name was not changed', () => {
    open();
    submit();

    expect(client.rename).not.toHaveBeenCalled();
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('treats a name changed only by spaces as unchanged', () => {
    open();
    fireEvent.change(field(), { target: { value: '  ep01.mkv  ' } });
    submit();

    expect(client.rename).not.toHaveBeenCalled();
  });

  it('refuses an empty name and stays open', () => {
    // The daemon rejects it, and the dialog used to close first — so the user
    // saw a generic error with nothing left to correct.
    open();
    const reportValidity = vi.spyOn(form(), 'reportValidity').mockReturnValue(false);
    fireEvent.change(field(), { target: { value: '' } });
    submit();

    expect(client.rename).not.toHaveBeenCalled();
    expect(dialogStore.close).not.toHaveBeenCalled();
    expect(reportValidity).toHaveBeenCalled();
  });

  it('refuses a name of nothing but spaces, next to the field', () => {
    // A bare return gave no feedback at all; the browser's own bubble says why.
    open();
    const reportValidity = vi.spyOn(form(), 'reportValidity').mockReturnValue(false);
    fireEvent.change(field(), { target: { value: '   ' } });
    submit();

    expect(client.rename).not.toHaveBeenCalled();
    expect(reportValidity).toHaveBeenCalled();
    expect(field().value).toBe('');
  });

  it('closes once the rename is on its way', () => {
    open();
    fireEvent.change(field(), { target: { value: 'other.mkv' } });
    submit();

    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('reports a refusal from the daemon', async () => {
    client.rename.mockRejectedValueOnce(new Error('path not found'));
    open();
    fireEvent.change(field(), { target: { value: 'other.mkv' } });
    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalled();
  });

  it('closes without sending when the client is not ready', () => {
    store.client = undefined;
    open();
    fireEvent.change(field(), { target: { value: 'other.mkv' } });

    expect(submit).not.toThrow();
    expect(dialogStore.close).toHaveBeenCalled();
  });
});
