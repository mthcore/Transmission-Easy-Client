import React, { useRef } from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { useVirtualRows, type VirtualRows } from '../useVirtualRows';

/**
 * Windowing decides which torrents exist in the DOM at all, and nothing
 * exercised it: an off-by-one in the range, or a padTop that disagrees with
 * start, silently drops rows out of the extension's primary surface.
 *
 * jsdom reports every layout metric as 0, so the hook keeps its
 * DEFAULT_ROW_HEIGHT and falls back to a 600px viewport — both stable enough
 * to assert the arithmetic against.
 */
const ROW_HEIGHT = 27;
const VIEW_HEIGHT = 600;
const OVERSCAN = 15;

let captured: VirtualRows;
let container: HTMLDivElement | null = null;

function Host({ rowCount }: { rowCount: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(scrollRef, rowCount);
  captured = virtual;
  return (
    <div
      ref={(el) => {
        scrollRef.current = el;
        container = el;
      }}
      onScroll={virtual.onScroll}
    >
      <table>
        <tbody ref={virtual.bodyRef}>
          {virtual.padTop > 0 && (
            <tr data-virtual-spacer style={{ height: virtual.padTop }}>
              <td />
            </tr>
          )}
          {Array.from({ length: virtual.end - virtual.start }, (_, i) => (
            <tr key={virtual.start + i} data-index={virtual.start + i}>
              <td>row {virtual.start + i}</td>
            </tr>
          ))}
          {virtual.padBottom > 0 && (
            <tr data-virtual-spacer style={{ height: virtual.padBottom }}>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

beforeAll(() => {
  // jsdom has no layout; give the scroll container a viewport height
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'DIV' ? VIEW_HEIGHT : 0;
    },
  });
});

/**
 * scroll does not bubble, so React's delegated onScroll never sees a dispatched
 * event here; and the hook throttles through requestAnimationFrame. Drive the
 * handler the container is wired to, then let the frame run.
 */
async function scrollTo(top: number) {
  container!.scrollTop = top;
  await act(async () => {
    captured.onScroll();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('useVirtualRows', () => {
  it('renders from the top of the list with no space above it', () => {
    render(<Host rowCount={2000} />);

    expect(captured.start).toBe(0);
    expect(captured.padTop).toBe(0);
    expect(captured.end).toBeGreaterThan(0);
  });

  it('spans the full list height, so the scrollbar matches the real row count', () => {
    const rowCount = 2000;
    render(<Host rowCount={rowCount} />);

    const rendered = (captured.end - captured.start) * ROW_HEIGHT;
    expect(captured.padTop + rendered + captured.padBottom).toBe(rowCount * ROW_HEIGHT);
  });

  it('renders every row of a list that fits in the viewport', () => {
    const { container: dom } = render(<Host rowCount={5} />);

    expect(captured.start).toBe(0);
    expect(captured.end).toBe(5);
    expect(captured.padBottom).toBe(0);
    expect(dom.querySelectorAll('tr[data-index]')).toHaveLength(5);
  });

  it('covers the viewport plus a full overscan band at each edge', () => {
    render(<Host rowCount={2000} />);

    // Both bands, not one: fast scrolling must never expose a blank strip
    const visibleRows = Math.ceil(VIEW_HEIGHT / ROW_HEIGHT);
    expect(captured.end - captured.start).toBeGreaterThanOrEqual(visibleRows + OVERSCAN * 2);
  });

  it('keeps an overscan band above the viewport once scrolled into the list', async () => {
    render(<Host rowCount={2000} />);

    await scrollTo(500 * ROW_HEIGHT);

    expect(500 - captured.start).toBeGreaterThanOrEqual(OVERSCAN);
    expect(captured.end - 500).toBeGreaterThanOrEqual(OVERSCAN);
  });

  it('moves the window when the container is scrolled', async () => {
    render(<Host rowCount={2000} />);
    const firstStart = captured.start;

    await scrollTo(500 * ROW_HEIGHT);

    expect(captured.start).toBeGreaterThan(firstStart);
    // The row at the new scroll position is inside the window
    expect(captured.start).toBeLessThanOrEqual(500);
    expect(captured.end).toBeGreaterThan(500);
    // ...and the invariant still holds after the move
    const rendered = (captured.end - captured.start) * ROW_HEIGHT;
    expect(captured.padTop + rendered + captured.padBottom).toBe(2000 * ROW_HEIGHT);
  });

  it('keeps the last row reachable at the bottom of the list', async () => {
    const rowCount = 2000;
    render(<Host rowCount={rowCount} />);

    await scrollTo(rowCount * ROW_HEIGHT);

    expect(captured.end).toBe(rowCount);
    expect(captured.padBottom).toBe(0);
  });

  it('clamps the window when the list shrinks under it', async () => {
    const { rerender } = render(<Host rowCount={2000} />);
    await scrollTo(1500 * ROW_HEIGHT);
    expect(captured.start).toBeGreaterThan(0);

    act(() => {
      rerender(<Host rowCount={3} />);
    });

    expect(captured.start).toBeLessThanOrEqual(2);
    expect(captured.end).toBeLessThanOrEqual(3);
    expect(captured.padBottom).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty list', () => {
    render(<Host rowCount={0} />);

    expect(captured.start).toBe(0);
    expect(captured.end).toBe(0);
    expect(captured.padTop).toBe(0);
    expect(captured.padBottom).toBe(0);
  });
});
