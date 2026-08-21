import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedRollStore from '../SpeedRollStore';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SpeedRollStore', () => {
  it('includes the very first sample in maxSpeed and getDataFromTime', () => {
    const roll = SpeedRollStore.create({});
    roll.add(5_000_000, 1_000);

    // The loops used to stop at i > 0, permanently skipping data[0]
    expect(roll.maxSpeed).toBe(5_000_000);
    expect(roll.getDataFromTime(roll.minTime)).toHaveLength(1);
  });

  it('includes the oldest in-window sample', () => {
    const roll = SpeedRollStore.create({});
    roll.add(9_000_000, 0);
    vi.advanceTimersByTime(1000);
    roll.add(4_000_000, 0);
    vi.advanceTimersByTime(1000);
    roll.add(3_000_000, 0);

    expect(roll.maxSpeed).toBe(9_000_000);
    expect(roll.getDataFromTime(roll.minTime)).toHaveLength(3);
  });

  it('still excludes samples older than the window', () => {
    const roll = SpeedRollStore.create({});
    roll.add(9_000_000, 0);
    vi.advanceTimersByTime(2 * 60 * 1000);
    roll.add(4_000_000, 0);

    // First sample is outside the 60s window ending at the newest sample
    expect(roll.maxSpeed).toBe(4_000_000);
    expect(roll.getDataFromTime(roll.minTime)).toHaveLength(1);
  });
});
