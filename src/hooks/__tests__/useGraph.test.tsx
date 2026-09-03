import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { observable, runInAction } from 'mobx';
import { useGraph } from '../useGraph';

/**
 * The speed graph in the popup footer.
 *
 * Nothing here throws when it goes wrong: a broken scale draws a line in the
 * wrong place, a stale width draws it at the wrong size, and both look like a
 * graph. That is why the comments in this hook read as a list of things that
 * shipped — a spurious lead-in segment after a spike aged out, a width frozen
 * for as long as polling was paused, an autorun that tore itself down on the
 * frame it was created.
 *
 * The curve is quadratic with the control point at the horizontal midpoint, so
 * the path is checked by its shape and its endpoints rather than by matching a
 * string: the exact numbers are arithmetic, the shape is the decision.
 */

interface Point {
  time: number;
  upload: number;
  download: number;
}

function createSpeedRoll(points: Point[]) {
  const state = observable({ points });
  return {
    state,
    roll: {
      get minTime() {
        return state.points.length ? state.points[0].time : 0;
      },
      get maxTime() {
        return state.points.length ? state.points[state.points.length - 1].time : 0;
      },
      get minSpeed() {
        return 0;
      },
      get maxSpeed() {
        return Math.max(0, ...state.points.flatMap((p) => [p.upload, p.download]));
      },
      getDataFromTime: vi.fn((minTime: number) => state.points.filter((p) => p.time >= minTime)),
    },
  };
}

/** Mounts the hook against a container of a known width. */
function draw(roll: ReturnType<typeof createSpeedRoll>['roll'] | null, width = 100) {
  const Harness = () => {
    const ref = useRef<HTMLDivElement>(null);
    useGraph(ref, roll);
    return <div ref={ref} data-testid="chart" />;
  };
  // The width has to be in place before the effect runs, which render() flushes.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    get() {
      return width;
    },
    configurable: true,
  });
  const result = render(<Harness />);
  if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  return result;
}

const svg = () => document.querySelector('svg');
const paths = () => Array.from(document.querySelectorAll('path'));
/** Upload is drawn first, download second — the order they are appended. */
const uploadD = () => paths()[0]?.getAttribute('d') ?? '';
const downloadD = () => paths()[1]?.getAttribute('d') ?? '';

/** The coordinates of an SVG path command list, in order. */
function coords(d: string): [number, number][] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const FLAT: Point[] = [
  { time: 0, upload: 0, download: 0 },
  { time: 10, upload: 0, download: 0 },
];

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useGraph — what it puts on the page', () => {
  it('draws an svg with a line for each direction', () => {
    const { roll } = createSpeedRoll([
      { time: 0, upload: 1, download: 2 },
      { time: 10, upload: 3, download: 4 },
    ]);
    draw(roll);

    expect(svg()).not.toBeNull();
    expect(paths()).toHaveLength(2);
  });

  it('sizes the svg to the container it was given', () => {
    const { roll } = createSpeedRoll(FLAT);
    draw(roll, 240);

    expect(svg()!.getAttribute('width')).toBe('240');
    expect(svg()!.getAttribute('viewBox')).toBe('0,0,240,30');
  });

  it('draws nothing at all without a speed roll', () => {
    // The popup renders before the background has answered.
    draw(null);

    expect(svg()).toBeNull();
  });

  it('waits for a laid-out container rather than drawing into zero width', () => {
    // A width of 0 is jsdom's default and a real state in the popup: the
    // element exists before layout. Scaling into it puts every point at the
    // same coordinate.
    const { roll } = createSpeedRoll(FLAT);
    draw(roll, 0);

    expect(svg()!.hasAttribute('width')).toBe(false);
    expect(uploadD()).toBe('');
  });
});

describe('useGraph — the shape of the line', () => {
  it('maps the first and last samples to the edges of the plot', () => {
    const { roll } = createSpeedRoll([
      { time: 100, upload: 0, download: 0 },
      { time: 200, upload: 0, download: 0 },
    ]);
    draw(roll, 100);

    const points = coords(uploadD());
    expect(points[0][0]).toBe(0);
    expect(points[points.length - 1][0]).toBe(100);
  });

  it('puts a faster sample higher up, since svg y grows downward', () => {
    // The y range is inverted for exactly this. Un-inverted, the graph draws
    // upside down and still looks like a graph.
    const { roll } = createSpeedRoll([
      { time: 0, upload: 0, download: 0 },
      { time: 10, upload: 100, download: 0 },
    ]);
    draw(roll, 100);

    const points = coords(uploadD());
    const [, slowY] = points[0];
    const [, fastY] = points[points.length - 1];
    expect(fastY).toBeLessThan(slowY);
  });

  it('draws a flat line rather than dividing by zero when nothing is moving', () => {
    // An idle client sends minSpeed === maxSpeed === 0 every second.
    const { roll } = createSpeedRoll(FLAT);
    draw(roll, 100);

    const ys = coords(uploadD()).map(([, y]) => y);
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(new Set(ys).size).toBe(1);
  });

  it('curves between samples instead of joining them with corners', () => {
    const { roll } = createSpeedRoll([
      { time: 0, upload: 0, download: 0 },
      { time: 10, upload: 5, download: 0 },
      { time: 20, upload: 1, download: 0 },
    ]);
    draw(roll, 100);

    expect(uploadD()).toMatch(/^M[\d.,-]+ Q/);
    expect(uploadD().match(/Q/g)).toHaveLength(2);
  });

  it('draws a single sample as a point, not as an empty path', () => {
    // The first poll after a service-worker restart has exactly one.
    const { roll } = createSpeedRoll([{ time: 0, upload: 1, download: 1 }]);
    draw(roll, 100);

    expect(uploadD()).toMatch(/^M[\d.-]+,[\d.-]+$/);
    expect(uploadD()).not.toContain('Q');
  });

  it('draws the two directions independently', () => {
    const { roll } = createSpeedRoll([
      { time: 0, upload: 0, download: 10 },
      { time: 10, upload: 10, download: 0 },
    ]);
    draw(roll, 100);

    expect(uploadD()).not.toBe(downloadD());
  });
});

describe('useGraph — the window it reads', () => {
  it('never asks for samples older than the left edge of the plot', () => {
    // Points before the x-domain start map to negative coordinates and drew a
    // lead-in segment entering the plot from outside, which is what a speed
    // spike ageing out of the window used to look like.
    const { roll } = createSpeedRoll([
      { time: 500, upload: 1, download: 1 },
      { time: 600, upload: 2, download: 2 },
    ]);
    draw(roll, 100);

    expect(roll.getDataFromTime).toHaveBeenCalledWith(500);
    const xs = coords(uploadD()).map(([x]) => x);
    expect(xs.every((x) => x >= 0)).toBe(true);
  });

  it('redraws when the samples change', () => {
    const { roll, state } = createSpeedRoll([
      { time: 0, upload: 0, download: 0 },
      { time: 10, upload: 0, download: 0 },
    ]);
    draw(roll, 100);
    const before = uploadD();

    act(() => {
      runInAction(() => {
        state.points = [
          { time: 0, upload: 0, download: 0 },
          { time: 10, upload: 50, download: 0 },
        ];
      });
    });

    expect(uploadD()).not.toBe(before);
  });
});

describe('useGraph — resizing', () => {
  /**
   * clientWidth is not observable, so the autorun alone only re-ran when the
   * speed data changed: the graph kept a stale width after a resize, and
   * indefinitely when polling was paused or the daemon was unreachable.
   *
   * The fix has its own trap, which is why the redraw does not simply restart
   * the autorun. ResizeObserver fires once immediately on observe(), so a
   * dispose-and-recreate tore down the autorun created two lines earlier — and
   * then ran once per frame of a drag.
   *
   * That last part is cost, not output: disposing and recreating leaves an
   * equally live autorun, so the graph draws the same either way. The cases
   * below do not pretend to pin it. What they do pin is that the graph is
   * still drawing after the observer's immediate first callback, which is the
   * half that WAS visible.
   */
  let currentWidth = 100;

  const Harness = ({ roll }: { roll: Parameters<typeof useGraph>[1] }) => {
    const ref = useRef<HTMLDivElement>(null);
    useGraph(ref, roll);
    return <div ref={ref} />;
  };

  const mountLive = (roll: Parameters<typeof useGraph>[1]) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get() {
        return currentWidth;
      },
      configurable: true,
    });
    return render(<Harness roll={roll} />);
  };

  beforeEach(() => {
    currentWidth = 100;
  });

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it('follows the container when the window is resized', () => {
    // jsdom has no ResizeObserver, so this is the fallback path — the one a
    // browser without it would take.
    const { roll } = createSpeedRoll(FLAT);
    mountLive(roll);
    expect(svg()!.getAttribute('width')).toBe('100');

    currentWidth = 250;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(svg()!.getAttribute('width')).toBe('250');
  });

  it('keeps redrawing on new data after a resize', () => {
    // The regression this hook's comment describes: restarting the autorun on
    // resize disposed the one that had just been created, and the graph then
    // froze at whatever it last drew.
    const { roll, state } = createSpeedRoll(FLAT);
    mountLive(roll);
    currentWidth = 250;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const before = uploadD();

    act(() => {
      runInAction(() => {
        state.points = [
          { time: 0, upload: 0, download: 0 },
          { time: 10, upload: 80, download: 0 },
        ];
      });
    });

    expect(uploadD()).not.toBe(before);
  });

  it('watches the element itself where the browser allows it', () => {
    // The real path. A window resize does not fire when a panel is dragged or
    // the popup reflows, which is most of what changes this element's width.
    const observed: Element[] = [];
    let fire!: () => void;
    class StubResizeObserver {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe(el: Element) {
        observed.push(el);
        // A real ResizeObserver delivers an entry as soon as it starts
        // observing. That immediate call is the whole reason the redraw does
        // not restart the autorun: it would tear down the one created three
        // lines earlier, on mount, every time.
        fire();
      }
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    try {
      const { roll } = createSpeedRoll(FLAT);
      mountLive(roll);

      expect(observed).toHaveLength(1);

      currentWidth = 300;
      act(() => {
        fire();
      });

      expect(svg()!.getAttribute('width')).toBe('300');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps drawing when the observer fires the moment it attaches', () => {
    // Mount, with a real observer's immediate first callback. Anything the
    // redraw does to the autorun happens here, before a single poll.
    let fire!: () => void;
    class StubResizeObserver {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {
        fire();
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    try {
      const { roll, state } = createSpeedRoll(FLAT);
      mountLive(roll);
      const before = uploadD();
      expect(before).not.toBe('');

      act(() => {
        runInAction(() => {
          state.points = [
            { time: 0, upload: 0, download: 0 },
            { time: 10, upload: 80, download: 0 },
          ];
        });
      });

      expect(uploadD()).not.toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops drawing while the container has no width', () => {
    // A collapsed panel or a closing popup measures zero. The redraw clears
    // the cached width so the guard below it sees the zero; without that, the
    // graph keeps drawing against the scales it had when it was visible.
    const { roll, state } = createSpeedRoll(FLAT);
    mountLive(roll);
    currentWidth = 0;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const before = uploadD();

    act(() => {
      runInAction(() => {
        state.points = [
          { time: 0, upload: 0, download: 0 },
          { time: 10, upload: 80, download: 0 },
        ];
      });
    });

    expect(uploadD()).toBe(before);
  });

  it('stops watching when it goes away', () => {
    const disconnects: (() => void)[] = [];
    class StubResizeObserver {
      disconnect = vi.fn(() => {});
      observe() {}
      unobserve() {}
      constructor() {
        disconnects.push(this.disconnect);
      }
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    try {
      const { roll } = createSpeedRoll(FLAT);
      const { unmount } = mountLive(roll);

      unmount();

      expect(disconnects).toHaveLength(1);
      expect(disconnects[0]).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('useGraph — when the roll underneath it is replaced', () => {
  /**
   * The effect keys on the speed roll, and the roll really is replaced: the
   * client store is flushed and rebuilt whenever the server config changes.
   * The container stays mounted through that, so React removes nothing — the
   * cleanup is the only thing that does.
   */
  const Harness = ({ roll }: { roll: Parameters<typeof useGraph>[1] }) => {
    const ref = useRef<HTMLDivElement>(null);
    useGraph(ref, roll);
    return <div ref={ref} />;
  };

  const mountWith = (roll: Parameters<typeof useGraph>[1]) => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get() {
        return 100;
      },
      configurable: true,
    });
    const result = render(<Harness roll={roll} />);
    const rerenderWith = (next: Parameters<typeof useGraph>[1]) =>
      result.rerender(<Harness roll={next} />);
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
    return { ...result, rerenderWith };
  };

  it('leaves one graph behind, not two', () => {
    const first = createSpeedRoll(FLAT);
    const second = createSpeedRoll(FLAT);
    const { rerenderWith } = mountWith(first.roll);

    rerenderWith(second.roll);

    expect(document.querySelectorAll('svg')).toHaveLength(1);
  });

  it('stops reading the roll it was replaced with', () => {
    // An autorun left running is a redraw per poll against a store nothing
    // shows any more, for as long as the page is open.
    const first = createSpeedRoll(FLAT);
    const second = createSpeedRoll(FLAT);
    const { rerenderWith } = mountWith(first.roll);
    rerenderWith(second.roll);
    first.roll.getDataFromTime.mockClear();

    act(() => {
      runInAction(() => {
        first.state.points = [{ time: 0, upload: 9, download: 9 }];
      });
    });

    expect(first.roll.getDataFromTime).not.toHaveBeenCalled();
  });
});

describe('useGraph — when it goes away', () => {
  it('takes its svg with it', () => {
    const { roll } = createSpeedRoll(FLAT);
    const { unmount } = draw(roll, 100);

    unmount();

    expect(svg()).toBeNull();
  });

  it('stops redrawing once unmounted', () => {
    // The autorun outliving the component is a write to a detached node on
    // every poll, for the life of the page.
    const { roll, state } = createSpeedRoll(FLAT);
    const { unmount } = draw(roll, 100);
    unmount();
    roll.getDataFromTime.mockClear();

    act(() => {
      runInAction(() => {
        state.points = [{ time: 0, upload: 9, download: 9 }];
      });
    });

    expect(roll.getDataFromTime).not.toHaveBeenCalled();
  });
});
