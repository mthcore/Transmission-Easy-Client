import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const store = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import SetLabelsDialog from '../SetLabelsDialog';

/**
 * Labels are typed as one comma-separated line and sent as a list, so this
 * dialog is entirely about turning the former into the latter.
 *
 * The rule that matters is deduplication. Transmission rejects the WHOLE
 * torrent-set request with "labels cannot be duplicated", so a single repeated
 * label did not merely arrive twice — it dropped every label the user had just
 * typed, and the toast said nothing about which one was at fault.
 */

afterEach(cleanup);

let client: { setLabels: ReturnType<typeof vi.fn> };
let dialogStore: {
  close: ReturnType<typeof vi.fn>;
  currentLabels: string;
  torrentIds: number[];
};

beforeEach(() => {
  showError.mockClear();
  client = { setLabels: vi.fn().mockResolvedValue(undefined) };
  store.client = client;
  dialogStore = { close: vi.fn(), currentLabels: 'tv, hd', torrentIds: [8, 9] };
});

function open() {
  render(<SetLabelsDialog dialogStore={dialogStore as never} />);
}

const field = () => document.querySelector('input[name="labels"]') as HTMLInputElement;
const submit = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement);

/** Type a line of labels and submit it; returns what reached the daemon. */
function send(line: string) {
  open();
  fireEvent.change(field(), { target: { value: line } });
  submit();
  return client.setLabels.mock.calls[0]?.[1];
}

describe('SetLabelsDialog — turning a line into a list', () => {
  it('offers the current labels to edit', () => {
    open();

    expect(field().value).toBe('tv, hd');
  });

  it('splits on commas', () => {
    expect(send('tv,hd,fr')).toEqual(['tv', 'hd', 'fr']);
  });

  it('trims each label, not just the line', () => {
    expect(send(' tv ,  hd ')).toEqual(['tv', 'hd']);
  });

  it('drops the empty entry a trailing comma leaves behind', () => {
    // Typing "tv," is the normal state of a line mid-edit.
    expect(send('tv,')).toEqual(['tv']);
  });

  it('drops an entry that is only spaces', () => {
    expect(send('tv, , hd')).toEqual(['tv', 'hd']);
  });

  it('sends an empty list to clear every label', () => {
    // Emptying the field is how a user removes labels; it must reach the
    // daemon as [] rather than not be sent at all.
    expect(send('')).toEqual([]);
  });

  it('sends an empty list for a line of nothing but separators', () => {
    expect(send(' , , ')).toEqual([]);
  });
});

describe('SetLabelsDialog — deduplication', () => {
  it('sends a repeated label once', () => {
    // Sent twice, Transmission rejects the whole request and NO label is set.
    expect(send('tv,tv')).toEqual(['tv']);
  });

  it('catches a duplicate that differs only by surrounding spaces', () => {
    expect(send('tv,  tv  ')).toEqual(['tv']);
  });

  it('keeps the first occurrence, so the order the user typed survives', () => {
    expect(send('hd,tv,hd')).toEqual(['hd', 'tv']);
  });

  it('leaves labels that merely look alike alone', () => {
    // Deduplication is exact: TV and tv are different labels to the daemon.
    expect(send('tv,TV')).toEqual(['tv', 'TV']);
  });
});

describe('SetLabelsDialog — sending', () => {
  it('labels every selected torrent', () => {
    open();
    fireEvent.change(field(), { target: { value: 'tv' } });
    submit();

    expect(client.setLabels).toHaveBeenCalledWith([8, 9], ['tv']);
  });

  it('closes once the request is on its way', () => {
    open();
    submit();

    expect(dialogStore.close).toHaveBeenCalled();
  });

  it('reports a refusal from the daemon', async () => {
    client.setLabels.mockRejectedValueOnce(new Error('labels cannot be duplicated'));
    open();
    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalled();
  });

  it('closes without throwing when the client is not ready', () => {
    store.client = undefined;
    open();

    expect(submit).not.toThrow();
    expect(dialogStore.close).toHaveBeenCalled();
  });
});
