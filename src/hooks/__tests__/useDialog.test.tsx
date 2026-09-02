import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, within } from '@testing-library/react';
import { useDialog } from '../useDialog';

/**
 * Dialogs portal as SIBLINGS under document.body, with no backdrop. Everything
 * hard about this hook follows from that.
 *
 * A click inside the top dialog is "outside" every dialog below it, and each
 * dialog listens for Escape on the document — so one keypress reached all of
 * them and closed the whole stack. Only the topmost may react.
 *
 * With no backdrop and identical coordinates, a stacked dialog was completely
 * invisible behind the one above it, so each is offset. The offset goes on the
 * PANEL, never on the wrapper: the wrapper is portalled after a full-height
 * root, and a transform there would make it the fixed panel's containing block,
 * resolving "top: 0" to the bottom of the viewport.
 */

afterEach(cleanup);

function Dialog({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  const ref = useDialog(onClose);
  return (
    <div ref={ref} data-testid="wrapper">
      <div className="panel">
        <button>first</button>
        <button>last</button>
        {children}
      </div>
    </div>
  );
}

/**
 * Mount a dialog and let the deferred outside-click listeners attach. The
 * queries are scoped to THIS dialog: the default ones search the whole body,
 * and every stacking case has two dialogs mounted at once.
 */
function open(onClose = vi.fn(), children?: React.ReactNode) {
  const result = render(<Dialog onClose={onClose} children={children} />);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  return { ...result, ...within(result.container), onClose };
}

const escape = (init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
    );
  });

/** A full press: mousedown somewhere, then the click that follows. */
function press(target: Element) {
  act(() => {
    fireEvent.mouseDown(target);
    fireEvent.click(target);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => vi.useRealTimers());

describe('useDialog — closing on Escape', () => {
  it('closes on Escape', () => {
    const { onClose } = open();
    escape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape pressed during IME composition', () => {
    // It cancels the composition, not the dialog — closing here lost
    // everything that had been typed.
    const { onClose } = open();
    escape({ isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores an Escape a layered menu has already consumed', () => {
    // A radix context menu closes itself on Escape; one press must not pop
    // both it and the dialog behind it.
    const { onClose } = open();
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      document.dispatchEvent(event);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves other keys alone', () => {
    const { onClose } = open();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once closed', () => {
    const { onClose, unmount } = open();
    unmount();
    escape();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useDialog — closing on a click outside', () => {
  it('closes when the click started outside', () => {
    const { onClose } = open();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    press(outside);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a click inside', () => {
    const { onClose, getByText } = open();

    press(getByText('first'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open for a selection dragged from inside to outside', () => {
    // click fires on the common ancestor of mousedown and mouseup, so such a
    // drag reports <body> and used to close the dialog, losing the input.
    const { onClose, getByText } = open();
    act(() => {
      fireEvent.mouseDown(getByText('first'));
      fireEvent.click(document.body);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores the very click that opened it', () => {
    // The listeners attach on a timeout for exactly this: the click that
    // opened the dialog is still travelling when it mounts.
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    press(outside);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useDialog — a stack of dialogs', () => {
  it('closes only the topmost on Escape', () => {
    // Each dialog listens on the document, so one press reached them all and
    // closed the whole stack.
    const lower = vi.fn();
    const upper = vi.fn();
    open(lower);
    open(upper);

    escape();

    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('lets the one underneath react again once the top has gone', () => {
    const lower = vi.fn();
    open(lower);
    const top = open(vi.fn());
    top.unmount();

    escape();

    expect(lower).toHaveBeenCalledTimes(1);
  });

  it('treats a click in the top dialog as outside the lower one, and ignores it', () => {
    // They are siblings, so it genuinely is outside — but closing the lower
    // dialog because the user used the upper one is never right.
    const lower = vi.fn();
    open(lower);
    const top = open(vi.fn());

    press(top.getByText('first'));

    expect(lower).not.toHaveBeenCalled();
  });

  it('offsets a stacked dialog so the one underneath can be seen', () => {
    // No backdrop, identical coordinates: the lower one was invisible and
    // nothing said another dialog was queued.
    open();
    const second = open();

    expect(
      second.getByTestId('wrapper').querySelector<HTMLElement>('.panel')?.style.transform
    ).toBe('translate(24px, 24px)');
  });

  it('offsets the panel and never the wrapper', () => {
    // A transform on the wrapper makes it the fixed panel's containing block;
    // the wrapper sits after a full-height root, so "top: 0" would resolve to
    // the bottom of the viewport and the dialog would vanish.
    open();
    const second = open();

    expect(second.getByTestId('wrapper').style.transform).toBe('');
  });

  it('leaves the first dialog unoffset', () => {
    const first = open();

    expect(first.getByTestId('wrapper').querySelector<HTMLElement>('.panel')?.style.transform).toBe(
      ''
    );
  });
});

describe('useDialog — focus', () => {
  it('focuses the first control so the keyboard lands inside', () => {
    const { getByText } = open();

    expect(document.activeElement).toBe(getByText('first'));
  });

  it('respects a control the dialog marked as the safe default', () => {
    // The destructive confirm dialog marks its "No" button; focusing the first
    // control instead would put a reflex Enter on "Yes".
    const { getByText } = open(vi.fn(), <button data-autofocus>safe</button>);

    expect(document.activeElement).toBe(getByText('safe'));
  });

  it('wraps Tab from the last control back to the first', () => {
    const { getByText, getByTestId } = open();
    getByText('last').focus();

    fireEvent.keyDown(getByTestId('wrapper'), { key: 'Tab' });

    expect(document.activeElement).toBe(getByText('first'));
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    const { getByText, getByTestId } = open();
    getByText('first').focus();

    fireEvent.keyDown(getByTestId('wrapper'), { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(getByText('last'));
  });

  it('traps against the controls present now, not those present at mount', () => {
    // The move dialog shows its custom-path input only for one option, and a
    // snapshot taken at mount traps against detached nodes — Shift+Tab then
    // escapes onto the page behind the modal.
    const { getByTestId, getByText, rerender } = open();
    rerender(
      <Dialog onClose={vi.fn()}>
        <button>added later</button>
      </Dialog>
    );
    getByText('added later').focus();

    fireEvent.keyDown(getByTestId('wrapper'), { key: 'Tab' });

    expect(document.activeElement).toBe(getByText('first'));
  });

  it('skips a disabled control when wrapping', () => {
    const { getByTestId, getByText, rerender } = open();
    rerender(
      <Dialog onClose={vi.fn()}>
        <button disabled>unusable</button>
      </Dialog>
    );
    getByText('last').focus();

    fireEvent.keyDown(getByTestId('wrapper'), { key: 'Tab' });

    expect(document.activeElement).toBe(getByText('first'));
  });

  it('gives focus back to whatever had it before', () => {
    // Without this focus fell to <body>: a keyboard user lost their place, and
    // with a dialog still open underneath, body's Tab walked the page BEHIND
    // the remaining modal.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = open();
    unmount();

    expect(document.activeElement).toBe(opener);
  });

  it('does not chase an element that has since been removed', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = open();
    opener.remove();

    expect(unmount).not.toThrow();
  });
});
