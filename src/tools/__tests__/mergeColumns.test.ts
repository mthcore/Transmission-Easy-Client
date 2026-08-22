import { describe, it, expect } from 'vitest';
import mergeColumns from '../mergeColumns';
import type { ColumnConfig } from '../../types';

const col = (column: string, extra: Partial<ColumnConfig> = {}): ColumnConfig =>
  ({ column, display: 1, order: 1, width: 100, lang: column, ...extra }) as ColumnConfig;

const names = (columns: ColumnConfig[]) => columns.map((c) => c.column);

describe('mergeColumns', () => {
  it('keeps the stored order and the stored width', () => {
    const stored = [col('name', { width: 500 }), col('size')];
    const merged = mergeColumns(stored, [col('name'), col('size')]);
    expect(names(merged)).toEqual(['name', 'size']);
    expect(merged[0].width).toBe(500);
  });

  it('fills in defaults the user has never seen', () => {
    const merged = mergeColumns([col('name')], [col('name'), col('size')]);
    expect(names(merged)).toEqual(['name', 'size']);
  });

  it('drops columns the defaults no longer define', () => {
    const merged = mergeColumns([col('name'), col('gone')], [col('name')]);
    expect(names(merged)).toEqual(['name']);
  });

  it('inserts a new column next to its default neighbour, not at an absolute index', () => {
    // The user dragged 'actions' to the front; an upgrade adds 'label' after
    // 'size'. Splicing at the default index would drop it in mid-list.
    const stored = [col('actions'), col('name'), col('size')];
    const defaults = [col('name'), col('size'), col('label'), col('actions')];
    expect(names(mergeColumns(stored, defaults))).toEqual(['actions', 'name', 'size', 'label']);
  });

  it('inserts a new first column at the front', () => {
    const stored = [col('name'), col('size')];
    const defaults = [col('checkbox'), col('name'), col('size')];
    expect(names(mergeColumns(stored, defaults))).toEqual(['checkbox', 'name', 'size']);
  });

  it('adds several new columns in their default relative order', () => {
    const stored = [col('name')];
    const defaults = [col('name'), col('a'), col('b'), col('c')];
    expect(names(mergeColumns(stored, defaults))).toEqual(['name', 'a', 'b', 'c']);
  });
});
