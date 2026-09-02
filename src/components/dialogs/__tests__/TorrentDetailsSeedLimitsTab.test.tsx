import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TorrentDetailsSeedLimitsTab from '../tabs/TorrentDetailsSeedLimitsTab';

/**
 * Seed limits decide when a torrent stops sharing, and each has three modes:
 * follow the global setting, use a value of its own, or never stop. The value
 * field only exists in the middle one, because a number shown beside "use the
 * global setting" says nothing about what will actually happen.
 *
 * The field itself is the delicate part, and it is shared with the bandwidth
 * tab. A plain controlled number input snaps an emptied field back to 0, and 0
 * here means "stop seeding immediately" — so it tolerates being emptied while
 * typing, and reconciles on blur rather than sending what it cannot parse.
 */

afterEach(cleanup);

function draw(props: Record<string, unknown> = {}) {
  const handlers = {
    onSeedRatioModeChange: vi.fn(),
    onSeedRatioLimitChange: vi.fn(),
    onSeedIdleModeChange: vi.fn(),
    onSeedIdleLimitChange: vi.fn(),
    onApplySeedLimits: vi.fn(),
  };
  const result = render(
    <TorrentDetailsSeedLimitsTab
      detailsLoading={false}
      hasDetails
      seedRatioMode={1}
      seedRatioLimit={2}
      seedIdleMode={1}
      seedIdleLimit={30}
      seedSaving={false}
      {...handlers}
      {...props}
    />
  );
  return { ...result, ...handlers };
}

const numbers = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
const selects = () => Array.from(document.querySelectorAll<HTMLSelectElement>('select'));

/**
 * React wires onBlur to the focusout event, which bubbles; a plain `blur`
 * event does not reach it. The value comes from the preceding change, so it is
 * not restated here.
 */
const leave = (field: HTMLInputElement) => fireEvent.focusOut(field);

describe('TorrentDetailsSeedLimitsTab — the modes', () => {
  it('offers a value field only for the custom mode', () => {
    draw();
    expect(numbers()).toHaveLength(2);

    cleanup();
    draw({ seedRatioMode: 0, seedIdleMode: 0 });
    expect(numbers()).toHaveLength(0);
  });

  it('hides the value for "never stop" too', () => {
    // A ratio shown beside "unlimited" is a number that will never apply.
    draw({ seedRatioMode: 2, seedIdleMode: 2 });

    expect(numbers()).toHaveLength(0);
  });

  it('shows one field when only one of the two is custom', () => {
    draw({ seedRatioMode: 1, seedIdleMode: 0 });

    expect(numbers()).toHaveLength(1);
  });

  it('reports a mode change as a number, not as the select’s string', () => {
    const { onSeedRatioModeChange } = draw();
    fireEvent.change(selects()[0], { target: { value: '2' } });

    expect(onSeedRatioModeChange).toHaveBeenCalledWith(2);
  });

  it('keeps the two modes apart', () => {
    const { onSeedIdleModeChange, onSeedRatioModeChange } = draw();
    fireEvent.change(selects()[1], { target: { value: '0' } });

    expect(onSeedIdleModeChange).toHaveBeenCalledWith(0);
    expect(onSeedRatioModeChange).not.toHaveBeenCalled();
  });
});

describe('TorrentDetailsSeedLimitsTab — the value field', () => {
  it('shows the current limits', () => {
    draw();

    expect(numbers().map((input) => input.value)).toEqual(['2', '30']);
  });

  it('reports a typed value as a number', () => {
    const { onSeedRatioLimitChange } = draw();
    fireEvent.change(numbers()[0], { target: { value: '3.5' } });

    expect(onSeedRatioLimitChange).toHaveBeenCalledWith(3.5);
  });

  it('reports nothing while the field is empty', () => {
    // Number('') is 0, and a seed ratio of 0 stops the torrent at once.
    const { onSeedRatioLimitChange } = draw();
    fireEvent.change(numbers()[0], { target: { value: '' } });

    expect(onSeedRatioLimitChange).not.toHaveBeenCalled();
  });

  it('lets the field sit empty while the user types', () => {
    // Snapping back to 0 mid-edit makes the field impossible to clear.
    draw();
    fireEvent.change(numbers()[0], { target: { value: '' } });

    expect(numbers()[0].value).toBe('');
  });

  it('clamps a negative value rather than sending it', () => {
    // The min attribute is validation-only: a typed -5 still reaches .value.
    const { onSeedIdleLimitChange } = draw();
    fireEvent.change(numbers()[1], { target: { value: '-5' } });

    expect(onSeedIdleLimitChange).toHaveBeenCalledWith(0);
  });

  it('shows the clamped value on blur, not the one that was typed', () => {
    // onChange clamped what it SENT but kept the raw text, so the field read
    // -5 while 0 had been applied.
    draw();
    const field = numbers()[1];
    fireEvent.change(field, { target: { value: '-5' } });
    leave(field);

    expect(field.value).toBe('0');
  });

  it('restores the stored value when the field is left empty', () => {
    draw();
    const field = numbers()[1];
    fireEvent.change(field, { target: { value: '' } });
    leave(field);

    expect(field.value).toBe('30');
  });

  it('restores it when the field is left unparsable', () => {
    // "-" and "1e" are states a number field passes through while typing.
    draw();
    const field = numbers()[1];
    fireEvent.change(field, { target: { value: '-' } });
    leave(field);

    expect(field.value).toBe('30');
  });

  it('follows the value when it changes from outside', () => {
    // Applying refetches the details, and the field has to adopt what the
    // daemon actually stored.
    const { rerender } = draw();
    rerender(
      <TorrentDetailsSeedLimitsTab
        detailsLoading={false}
        hasDetails
        seedRatioMode={1}
        seedRatioLimit={2}
        seedIdleMode={1}
        seedIdleLimit={45}
        seedSaving={false}
        onSeedRatioModeChange={vi.fn()}
        onSeedRatioLimitChange={vi.fn()}
        onSeedIdleModeChange={vi.fn()}
        onSeedIdleLimitChange={vi.fn()}
        onApplySeedLimits={vi.fn()}
      />
    );

    expect(numbers()[1].value).toBe('45');
  });
});

describe('TorrentDetailsSeedLimitsTab — applying', () => {
  it('applies on the button', () => {
    const { onApplySeedLimits } = draw();
    fireEvent.click(screen.getByText('DT_APPLY'));

    expect(onApplySeedLimits).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a save is in flight', () => {
    draw({ seedSaving: true });

    expect(screen.getByText('DT_APPLY')).toBeDisabled();
  });

  it('shows nothing to edit before the details arrive', () => {
    draw({ hasDetails: false, detailsLoading: true });

    expect(numbers()).toHaveLength(0);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
