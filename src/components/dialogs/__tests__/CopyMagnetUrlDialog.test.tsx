import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

vi.mock('../../../hooks/useRootStore', () => ({ default: () => ({}) }));

import CopyMagnetUrlDialog from '../CopyMagnetUrlDialog';

/**
 * Copying a magnet URI is one of the few actions whose success the extension
 * cannot assume. The clipboard API rejects for reasons that have nothing to do
 * with this code — a Firefox permission, focus lost between the click and the
 * write — and closing anyway claimed success with an empty clipboard.
 *
 * So the dialog closes only when the write actually landed. On failure it stays
 * open and selects the text, because the URI is right there to copy by hand,
 * which is the only recovery the user has.
 */

afterEach(cleanup);

const LINK = 'magnet:?xt=urn:btih:deadbeef';

let dialogStore: { close: ReturnType<typeof vi.fn>; magnetLink: string };
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  showError.mockClear();
  dialogStore = { close: vi.fn(), magnetLink: LINK };
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

function open() {
  render(<CopyMagnetUrlDialog dialogStore={dialogStore as never} />);
}

const field = () => document.querySelector('input[name="magnetLink"]') as HTMLInputElement;
const submit = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement);
const flush = () => act(async () => undefined);

describe('CopyMagnetUrlDialog', () => {
  it('shows the URI, so it can be copied by hand whatever happens', () => {
    open();

    expect(field().value).toBe(LINK);
  });

  it('writes the URI to the clipboard', async () => {
    open();
    submit();
    await flush();

    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('closes only once the write has landed', async () => {
    let settle!: () => void;
    writeText.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    open();
    submit();

    expect(dialogStore.close).not.toHaveBeenCalled();

    await act(async () => settle());
    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('writes whatever is in the field, which the user may have edited', () => {
    open();
    fireEvent.change(field(), { target: { value: 'magnet:?xt=urn:btih:other' } });
    submit();

    expect(writeText).toHaveBeenCalledWith('magnet:?xt=urn:btih:other');
  });
});

describe('CopyMagnetUrlDialog — when the clipboard refuses', () => {
  it('stays open rather than claiming success', async () => {
    writeText.mockRejectedValueOnce(new Error('permission denied'));
    open();
    submit();
    await flush();

    expect(dialogStore.close).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  it('selects the text, which is the only recovery left', async () => {
    writeText.mockRejectedValueOnce(new Error('permission denied'));
    open();
    const select = vi.spyOn(field(), 'select');
    submit();
    await flush();

    expect(select).toHaveBeenCalled();
  });
});

describe('CopyMagnetUrlDialog — with no clipboard at all', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it('reports it instead of throwing out of the submit handler', () => {
    // Reading .writeText off a missing clipboard threw synchronously, so
    // nothing was reported and the dialog never closed — it just stopped.
    open();

    expect(submit).not.toThrow();
    expect(showError).toHaveBeenCalled();
  });

  it('selects the text and stays open', () => {
    open();
    const select = vi.spyOn(field(), 'select');
    submit();

    expect(select).toHaveBeenCalled();
    expect(dialogStore.close).not.toHaveBeenCalled();
  });
});
