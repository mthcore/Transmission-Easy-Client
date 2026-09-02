import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { observable, runInAction } from 'mobx';
import { useScrollSync } from '../useScrollSync';
import { useTheme } from '../useTheme';

/**
 * The table header is a separate, fixed element: it does not scroll with the
 * body, it is moved to match. Scroll events fire far faster than frames, so the
 * move is coalesced into one animation frame — without that, a horizontal drag
 * queues a style write per event and the header visibly lags the body.
 *
 * The width check exists because the header must only be offset while the
 * table is actually wider than the window. Offsetting a table that fits pushes
 * the header off-screen to the left with nothing to scroll back to.
 */

let frames: (() => void)[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frames.push(cb);
    return frames.length; // never 0: the hook uses the id as a truthy guard
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const runFrame = () => act(() => frames.splice(0).forEach((cb) => cb()));

function scrollEvent(scrollLeft: number, scrollWidth = 2000) {
  return { currentTarget: { scrollLeft, scrollWidth } } as never;
}

function headerRef() {
  const header = document.createElement('div');
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
  ref.current = header;
  return { ref, header };
}

describe('useScrollSync', () => {
  it('offsets the header by the body scroll', () => {
    const { ref, header } = headerRef();
    const { result } = renderHook(() => useScrollSync(ref));

    act(() => result.current(scrollEvent(120)));
    runFrame();

    expect(header.style.left).toBe('-120px');
  });

  it('coalesces a burst of scroll events into one frame', () => {
    // A horizontal drag fires far more scroll events than frames; one style
    // write per event is what made the header lag the body.
    const { ref } = headerRef();
    const { result } = renderHook(() => useScrollSync(ref));

    act(() => {
      result.current(scrollEvent(10));
      result.current(scrollEvent(20));
      result.current(scrollEvent(30));
    });

    expect(frames).toHaveLength(1);
  });

  it('uses the position from the first event of the burst', () => {
    // Later events are dropped rather than queued, so the header settles on
    // the next burst rather than replaying the whole drag.
    const { ref, header } = headerRef();
    const { result } = renderHook(() => useScrollSync(ref));

    act(() => {
      result.current(scrollEvent(10));
      result.current(scrollEvent(999));
    });
    runFrame();

    expect(header.style.left).toBe('-10px');
  });

  it('accepts a new burst once the frame has run', () => {
    const { ref, header } = headerRef();
    const { result } = renderHook(() => useScrollSync(ref));

    act(() => result.current(scrollEvent(10)));
    runFrame();
    act(() => result.current(scrollEvent(50)));
    runFrame();

    expect(header.style.left).toBe('-50px');
  });

  it('does nothing when the header has gone', () => {
    // The frame can land after the table unmounted its header.
    const ref = { current: null } as { current: HTMLElement | null };
    const { result } = renderHook(() => useScrollSync(ref));

    act(() => result.current(scrollEvent(10)));

    expect(runFrame).not.toThrow();
  });

  it('cancels a pending frame when the table goes away', () => {
    const { ref } = headerRef();
    const { result, unmount } = renderHook(() => useScrollSync(ref));

    act(() => result.current(scrollEvent(10)));
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});

describe('useScrollSync — with the width check', () => {
  const draw = (ref: { current: HTMLElement | null }) =>
    renderHook(() => useScrollSync(ref, { withWidthCheck: true }));

  beforeEach(() => {
    Object.defineProperty(document.body, 'clientWidth', { value: 1000, configurable: true });
  });

  it('offsets the header while the table is wider than the window', () => {
    const { ref, header } = headerRef();
    const { result } = draw(ref);

    act(() => result.current(scrollEvent(200, 2000)));
    runFrame();

    expect(header.style.left).toBe('-200px');
  });

  it('leaves a table that fits alone', () => {
    // Offsetting a table narrower than the window pushes its header off-screen
    // with nothing to scroll back to.
    const { ref, header } = headerRef();
    const { result } = draw(ref);

    act(() => result.current(scrollEvent(200, 500)));
    runFrame();

    expect(header.style.left).toBe('');
  });

  it('clears an offset left over from when the table was wide', () => {
    const { ref, header } = headerRef();
    const { result } = draw(ref);

    act(() => result.current(scrollEvent(200, 2000)));
    runFrame();
    act(() => result.current(scrollEvent(0, 2000)));
    runFrame();

    expect(header.style.left).toBe('');
  });
});

/**
 * The theme is applied to the document element rather than to a React tree,
 * because the extension's pages are separate documents and the choice has to
 * survive before React has mounted anything.
 */
describe('useTheme', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('stamps the chosen theme on the document', () => {
    renderHook(() => useTheme({ theme: 'dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('stamps nothing for "system", so the OS preference decides', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderHook(() => useTheme({ theme: 'system' }));

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('follows a later change to the setting', () => {
    // The SAME config node, mutated in place. That is what the options pane
    // does, and it is the only thing the mobx reaction can be responsible for:
    // handing the hook a different object would re-run the effect through its
    // dependency array and prove nothing about the reaction at all.
    const config = observable({ theme: 'light' });
    renderHook(() => useTheme(config));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      runInAction(() => {
        config.theme = 'dark';
      });
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('stops following once the page is gone', () => {
    const config = observable({ theme: 'light' });
    const { unmount } = renderHook(() => useTheme(config));
    unmount();

    act(() => {
      runInAction(() => {
        config.theme = 'dark';
      });
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('does nothing at all before the config is loaded', () => {
    renderHook(() => useTheme(null));

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
