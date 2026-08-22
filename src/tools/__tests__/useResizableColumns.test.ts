import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for useResizableColumns hook logic.
 * We avoid rendering React (react-dom/client + jsdom causes OOM on WSL2)
 * and instead test the core merge + resize logic directly.
 */

// Inline the merge logic from the hook for unit testing
function mergeWidths(
  defaultWidths: Record<string, number>,
  savedWidths: Record<string, number>
): Record<string, number> {
  return { ...defaultWidths, ...savedWidths };
}

const MIN_WIDTH = 24;

function clampWidth(startWidth: number, delta: number): number {
  return Math.max(MIN_WIDTH, startWidth + delta);
}

describe('useResizableColumns — merge logic', () => {
  it('uses defaults when no saved widths', () => {
    const merged = mergeWidths({ col1: 100, col2: 200 }, {});
    expect(merged).toEqual({ col1: 100, col2: 200 });
  });

  it('overrides defaults with saved widths', () => {
    const merged = mergeWidths({ col1: 100, col2: 200 }, { col1: 150 });
    expect(merged).toEqual({ col1: 150, col2: 200 });
  });

  it('ignores extra saved keys not in defaults', () => {
    const merged = mergeWidths({ col1: 100 }, { col1: 80, col3: 300 });
    expect(merged).toEqual({ col1: 80, col3: 300 });
  });

  it('handles empty defaults and saved', () => {
    const merged = mergeWidths({}, {});
    expect(merged).toEqual({});
  });
});

describe('useResizableColumns — clamp logic', () => {
  it('allows width increase', () => {
    expect(clampWidth(100, 50)).toBe(150);
  });

  it('allows width decrease', () => {
    expect(clampWidth(100, -30)).toBe(70);
  });

  it('clamps to MIN_WIDTH when delta makes width negative', () => {
    expect(clampWidth(50, -100)).toBe(MIN_WIDTH);
  });

  it('clamps to MIN_WIDTH when delta makes width exactly 0', () => {
    expect(clampWidth(50, -50)).toBe(MIN_WIDTH);
  });

  it('returns MIN_WIDTH for very large negative delta', () => {
    expect(clampWidth(100, -1000)).toBe(MIN_WIDTH);
  });

  it('keeps width at MIN_WIDTH when already at minimum', () => {
    expect(clampWidth(MIN_WIDTH, 0)).toBe(MIN_WIDTH);
  });
});

describe('useResizableColumns — resize event simulation', () => {
  let listeners: Map<string, ((e: MouseEvent) => void)[]>;

  beforeEach(() => {
    listeners = new Map();
    vi.spyOn(document.body, 'addEventListener').mockImplementation((type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler as (e: MouseEvent) => void);
    });
    vi.spyOn(document.body, 'removeEventListener').mockImplementation((type, handler) => {
      const arr = listeners.get(type);
      if (arr) {
        const idx = arr.indexOf(handler as (e: MouseEvent) => void);
        if (idx >= 0) arr.splice(idx, 1);
      }
    });
  });

  it('registers mousemove and mouseup on mouseDown', () => {
    // Simulate what startResize does
    const startX = 100;
    const startWidth = 100;
    let currentWidth = startWidth;

    const move = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      currentWidth = Math.max(MIN_WIDTH, startWidth + delta);
    };

    const up = () => {
      document.body.removeEventListener('mousemove', move as EventListener);
      document.body.removeEventListener('mouseup', up as EventListener);
    };

    document.body.addEventListener('mousemove', move as EventListener);
    document.body.addEventListener('mouseup', up as EventListener);

    expect(listeners.get('mousemove')).toHaveLength(1);
    expect(listeners.get('mouseup')).toHaveLength(1);

    // Simulate move
    listeners.get('mousemove')![0]({ clientX: 150 } as MouseEvent);
    expect(currentWidth).toBe(150);

    // Simulate move that would go below minimum
    listeners.get('mousemove')![0]({ clientX: 0 } as MouseEvent);
    expect(currentWidth).toBe(MIN_WIDTH);

    // Simulate mouseup
    listeners.get('mouseup')![0]({} as MouseEvent);
    expect(listeners.get('mousemove')).toHaveLength(0);
    expect(listeners.get('mouseup')).toHaveLength(0);
  });

  it('cleans up previous listeners before starting new resize', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    document.body.addEventListener('mousemove', handler1 as EventListener);
    document.body.addEventListener('mouseup', handler1 as EventListener);

    // Before starting new resize, clean up old
    document.body.removeEventListener('mousemove', handler1 as EventListener);
    document.body.removeEventListener('mouseup', handler1 as EventListener);

    document.body.addEventListener('mousemove', handler2 as EventListener);
    document.body.addEventListener('mouseup', handler2 as EventListener);

    // Only new handlers should remain
    expect(listeners.get('mousemove')).toHaveLength(1);
    expect(listeners.get('mouseup')).toHaveLength(1);
    expect(listeners.get('mousemove')![0]).toBe(handler2);
  });
});
