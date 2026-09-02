import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const configStore = vi.hoisted(() => ({
  setOptions: vi.fn(),
  backgroundUpdateInterval: 60000,
}));
vi.mock('../useRootStore', () => ({ default: () => ({ config: configStore }) }));

import { useOptionsPage } from '../useOptionsPage';

/**
 * The options panes write straight into the config, and a config write is
 * broadcast to every context: it refires the client rebuild, the header-rule
 * rewrite and the context-menu rebuild. So a number field cannot simply persist
 * what it is given, on every keystroke.
 *
 * Three rules come out of that, each of them a bug once:
 *
 *  - Clamp. The HTML min/max attributes do not block typed input, so a
 *    half-typed "1" reached the store and drove the polling intervals at
 *    millisecond rates.
 *  - Debounce. Typing "1200" paid for the whole broadcast four times.
 *  - Reconcile on blur. The store received the clamped value while the input
 *    went on displaying the raw one, so a field could read 500 all session
 *    while the daemon was polled every 1000.
 */

const DELAY = 400; // INT_COMMIT_DELAY

beforeEach(() => {
  vi.useFakeTimers();
  configStore.setOptions.mockClear();
  configStore.backgroundUpdateInterval = 60000;
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The handlers only ever read `currentTarget`, so the event is that element.
 * Kept typed rather than cast to never: the blur cases assert on the field's
 * value afterwards, which is the behaviour under test.
 */
type FieldEvent = { currentTarget: HTMLInputElement };

/** A number input as the pane renders it, with its min/max attributes. */
function numberField(
  value: string,
  { min = '1000', max = '3600000', name = 'interval' } = {}
): FieldEvent {
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.min = min;
  input.max = max;
  input.value = value;
  return { currentTarget: input };
}

function checkbox(name: string, checked: boolean): FieldEvent {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.checked = checked;
  return { currentTarget: input };
}

const draw = () => renderHook(() => useOptionsPage());

describe('useOptionsPage — typing a number', () => {
  it('persists nothing until the user stops typing', () => {
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('1200') as never));
    expect(configStore.setOptions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(DELAY));
    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 1200 });
  });

  it('writes once for a four-keystroke number, not four times', () => {
    // Each write is broadcast to every context; this is the whole point.
    const { result } = draw();

    ['1', '12', '120', '1200'].forEach((value) => {
      act(() => result.current.handleSetInt(numberField(value) as never));
      act(() => vi.advanceTimersByTime(100));
    });
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).toHaveBeenCalledTimes(1);
    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 1200 });
  });

  it('clamps a value below the minimum', () => {
    // "1" on the way to "1200" would otherwise poll the daemon every 1 ms.
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('1') as never));
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 1000 });
  });

  it('clamps a value above the maximum', () => {
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('99999999') as never));
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 3600000 });
  });

  it('ignores a field that is not a number at all', () => {
    // Clearing the field must not persist NaN, nor 0.
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('') as never));
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).not.toHaveBeenCalled();
  });

  it('leaves a field with no min or max alone', () => {
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('5', { min: '', max: '' }) as never));
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 5 });
  });

  it('writes each field under its own name', () => {
    const { result } = draw();

    act(() => result.current.handleSetInt(numberField('2000', { name: 'otherInterval' }) as never));
    act(() => vi.advanceTimersByTime(DELAY));

    expect(configStore.setOptions).toHaveBeenCalledWith({ otherInterval: 2000 });
  });
});

describe('useOptionsPage — leaving the field', () => {
  it('commits immediately rather than leaving a finished value unsaved', () => {
    const { result } = draw();
    const field = numberField('1200');

    act(() => result.current.handleSetInt(field as never));
    act(() => result.current.handleIntBlur(field as never));

    // No timer advance: blur must not wait out the debounce
    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 1200 });
  });

  it('does not write again when the debounce fires afterwards', () => {
    const { result } = draw();
    const field = numberField('1200');

    act(() => result.current.handleSetInt(field as never));
    act(() => result.current.handleIntBlur(field as never));
    act(() => vi.advanceTimersByTime(DELAY * 2));

    expect(configStore.setOptions).toHaveBeenCalledTimes(1);
  });

  it('shows the clamped value instead of the one that was typed', () => {
    // Typing 500 with min 1000 stored 1000 while the field read 500 all
    // session, so the page disagreed with the daemon and neither was wrong.
    const { result } = draw();
    const field = numberField('500');

    act(() => result.current.handleSetInt(field as never));
    act(() => result.current.handleIntBlur(field as never));

    expect(configStore.setOptions).toHaveBeenCalledWith({ interval: 1000 });
    expect(field.currentTarget.value).toBe('1000');
  });

  it('restores the stored value when the field was left unparsable', () => {
    const { result } = draw();
    const field = numberField('', { name: 'backgroundUpdateInterval' });

    act(() => result.current.handleIntBlur(field as never));

    expect(field.currentTarget.value).toBe('60000');
    expect(configStore.setOptions).not.toHaveBeenCalled();
  });

  it('leaves an untouched field exactly as it is', () => {
    const { result } = draw();
    const field = numberField('60000', { name: 'backgroundUpdateInterval' });

    act(() => result.current.handleIntBlur(field as never));

    expect(field.currentTarget.value).toBe('60000');
    expect(configStore.setOptions).not.toHaveBeenCalled();
  });
});

describe('useOptionsPage — checkboxes and radios', () => {
  it('persists a checkbox by name and checked state', () => {
    const { result } = draw();

    act(() => result.current.handleChange(checkbox('showSpeedGraph', true) as never));

    expect(configStore.setOptions).toHaveBeenCalledWith({ showSpeedGraph: true });
  });

  it('persists an unchecked box as false, not as absent', () => {
    const { result } = draw();

    act(() => result.current.handleChange(checkbox('showSpeedGraph', false) as never));

    expect(configStore.setOptions).toHaveBeenCalledWith({ showSpeedGraph: false });
  });

  it('persists a radio by its value', () => {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = 'dark';
    const { result } = draw();

    act(() => result.current.handleRadioChange({ currentTarget: radio } as never));

    expect(configStore.setOptions).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('writes a checkbox straight away, with no debounce', () => {
    // Only the number fields are expensive to write on every change.
    const { result } = draw();

    act(() => result.current.handleChange(checkbox('showSpeedGraph', true) as never));

    expect(configStore.setOptions).toHaveBeenCalledTimes(1);
  });
});

describe('useOptionsPage — leaving the page', () => {
  it('drops a pending write rather than firing it after unmount', () => {
    const { result, unmount } = draw();

    act(() => result.current.handleSetInt(numberField('1200') as never));
    unmount();
    act(() => vi.advanceTimersByTime(DELAY * 2));

    expect(configStore.setOptions).not.toHaveBeenCalled();
  });
});
