import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { useResizableColumns } from '../useResizableColumns';
import { MIN_COLUMN_WIDTH } from '../../constants';

/**
 * The file named `tools/__tests__/useResizableColumns.test.ts` never imports
 * this hook — it re-declares mergeWidths/clampWidth/MIN_WIDTH locally and
 * tests those copies. So the hook itself was unexecuted, and the two fixes
 * this branch made to it (end the drag when the button was released outside
 * the window, invert the delta under RTL) had nothing holding them in place.
 */
const DEFAULTS = { name: 100, size: 80 };
// Module scope on purpose: the hook re-syncs whenever savedWidths changes
// IDENTITY, so an inline {} would re-render forever. Production passes an MST
// types.frozen value, which is stable until reassigned.
const NO_SAVED: Record<string, number> = {};

let saved: Record<string, number> | null = null;

function Host({ savedWidths = NO_SAVED }: { savedWidths?: Record<string, number> }) {
  const { widths, getResizeProps } = useResizableColumns({
    defaultWidths: DEFAULTS,
    savedWidths,
    onSave: (w) => {
      saved = w;
    },
  });
  return (
    <div>
      <span data-testid="name-width">{widths.name}</span>
      <div data-testid="name-handle" {...getResizeProps('name')} />
    </div>
  );
}

function drag(handle: HTMLElement, from: number, to: number, buttons = 1) {
  fireEvent.mouseDown(handle, { button: 0, clientX: from });
  act(() => {
    document.body.dispatchEvent(
      new MouseEvent('mousemove', { clientX: to, buttons, bubbles: true })
    );
  });
}

afterEach(() => {
  document.documentElement.dir = '';
  saved = null;
  vi.clearAllMocks();
});

describe('useResizableColumns', () => {
  it('widens the column by the drag distance', () => {
    const { getByTestId } = render(<Host />);

    drag(getByTestId('name-handle'), 200, 260);

    expect(getByTestId('name-width').textContent).toBe('160');
  });

  it('never shrinks below the shared minimum', () => {
    const { getByTestId } = render(<Host />);

    drag(getByTestId('name-handle'), 200, 0);

    expect(getByTestId('name-width').textContent).toBe(String(MIN_COLUMN_WIDTH));
  });

  it('inverts the delta under RTL, where columns grow leftward', () => {
    document.documentElement.dir = 'rtl';
    const { getByTestId } = render(<Host />);

    // Pulling LEFT must widen, not shrink
    drag(getByTestId('name-handle'), 200, 140);

    expect(getByTestId('name-width').textContent).toBe('160');
  });

  it('ends the drag when the button was released outside the window', () => {
    const { getByTestId } = render(<Host />);
    const handle = getByTestId('name-handle');

    // buttons === 0: the mouseup happened somewhere we never heard about
    drag(handle, 200, 260, 0);
    const afterRelease = getByTestId('name-width').textContent;

    // A later move must no longer resize anything
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 500, buttons: 1, bubbles: true })
      );
    });

    expect(getByTestId('name-width').textContent).toBe(afterRelease);
  });

  it('persists the widths when the drag finishes', () => {
    const { getByTestId } = render(<Host />);

    drag(getByTestId('name-handle'), 200, 260);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(saved).toMatchObject({ name: 160 });
  });

  it('prefers a saved width over the default', () => {
    const stored = { name: 250 };
    const { getByTestId } = render(<Host savedWidths={stored} />);

    expect(getByTestId('name-width').textContent).toBe('250');
  });
});
