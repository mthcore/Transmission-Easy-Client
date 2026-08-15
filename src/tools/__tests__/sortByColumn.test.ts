import { describe, it, expect } from 'vitest';
import {
  createColumnSorter,
  torrentColumnMap,
  torrentSpecialHandlers,
  fileColumnMap,
} from '../sortByColumn';

describe('createColumnSorter', () => {
  const items = [
    { name: 'Charlie', size: 300, eta: 100 },
    { name: 'Alpha', size: 100, eta: -1 },
    { name: 'Bravo', size: 200, eta: 50 },
  ];

  const sorter = createColumnSorter();

  // direction: 1 = ascending (smallest first), -1 = descending (biggest first)

  it('sorts ascending by string column', () => {
    const result = sorter(items, 'name', 1);
    expect(result.map((i) => i.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts descending by string column', () => {
    const result = sorter(items, 'name', -1);
    expect(result.map((i) => i.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts ascending by numeric column', () => {
    const result = sorter(items, 'size', 1);
    expect(result.map((i) => i.size)).toEqual([100, 200, 300]);
  });

  it('sorts descending by numeric column', () => {
    const result = sorter(items, 'size', -1);
    expect(result.map((i) => i.size)).toEqual([300, 200, 100]);
  });

  it('does not mutate the original array', () => {
    const original = [...items];
    sorter(items, 'name', 1);
    expect(items).toEqual(original);
  });

  it('handles null values by pushing them to the end (descending)', () => {
    const withNulls = [
      { name: 'B', value: 2 },
      { name: 'A', value: null },
      { name: 'C', value: 1 },
    ];
    const result = sorter(withNulls, 'value', -1);
    expect(result.map((i) => i.name)).toEqual(['B', 'C', 'A']);
  });

  it('handles undefined values by pushing them to the end (descending)', () => {
    const withUndefined = [{ name: 'B', value: 2 }, { name: 'A' }, { name: 'C', value: 1 }];
    const result = sorter(withUndefined, 'value', -1);
    expect(result.map((i) => i.name)).toEqual(['B', 'C', 'A']);
  });

  it('handles equal values', () => {
    const items = [
      { name: 'A', value: 1 },
      { name: 'B', value: 1 },
    ];
    const result = sorter(items, 'value', 1);
    expect(result.length).toBe(2);
    // Both have value 1, order preserved (stable sort) or at least both present
    expect(result.map((i) => i.value)).toEqual([1, 1]);
  });
});

describe('createColumnSorter with column mapping', () => {
  const sorter = createColumnSorter(torrentColumnMap, torrentSpecialHandlers);

  it('maps column names (done -> progress)', () => {
    const items = [
      { name: 'A', progress: 0.5 },
      { name: 'B', progress: 0.9 },
      { name: 'C', progress: 0.1 },
    ];
    const result = sorter(items, 'done', 1);
    expect(result.map((i) => i.name)).toEqual(['C', 'A', 'B']);
  });

  it('applies eta special handler (-1 treated as Infinity)', () => {
    const items = [
      { name: 'A', eta: -1 },
      { name: 'B', eta: 100 },
      { name: 'C', eta: 50 },
    ];
    const result = sorter(items, 'eta', 1);
    expect(result.map((i) => i.name)).toEqual(['C', 'B', 'A']);
  });

  it('sorts eta -2 (unknown) with -1 (infinite) at the end, not before real ETAs', () => {
    const items = [
      { name: 'A', eta: -2 },
      { name: 'B', eta: 100 },
      { name: 'C', eta: -1 },
      { name: 'D', eta: 10 },
    ];
    const result = sorter(items, 'eta', 1);
    expect(result.map((i) => i.name).slice(0, 2)).toEqual(['D', 'B']);
    expect(
      result
        .map((i) => i.name)
        .slice(2)
        .sort()
    ).toEqual(['A', 'C']);
  });

  it('applies date handler (0 treated as Infinity)', () => {
    const items = [
      { name: 'A', addedTime: 0 },
      { name: 'B', addedTime: 1000 },
      { name: 'C', addedTime: 500 },
    ];
    const result = sorter(items, 'added', 1);
    expect(result.map((i) => i.name)).toEqual(['C', 'B', 'A']);
  });
});

describe('file column mapping', () => {
  const sorter = createColumnSorter(fileColumnMap);

  it('maps done -> progress for files', () => {
    const items = [
      { name: 'a.txt', progress: 1.0 },
      { name: 'b.txt', progress: 0.5 },
    ];
    const result = sorter(items, 'done', 1);
    expect(result.map((i) => i.name)).toEqual(['b.txt', 'a.txt']);
  });
});
