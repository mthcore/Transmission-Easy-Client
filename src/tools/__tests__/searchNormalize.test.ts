import { describe, it, expect } from 'vitest';
import searchNormalize from '../searchNormalize';

describe('searchNormalize', () => {
  it('lowercases', () => {
    expect(searchNormalize('Ubuntu ISO')).toBe('ubuntu iso');
  });

  it('strips diacritics so "amelie" matches "Amélie"', () => {
    expect(searchNormalize('Amélie.2001.mkv')).toBe('amelie.2001.mkv');
    expect(searchNormalize('Amélie')).toContain(searchNormalize('amelie'));
  });

  it('handles a mixed set of accented letters', () => {
    expect(searchNormalize('Œ é à ü ñ Č ø')).toBe('œ e a u n c ø');
  });

  it('leaves plain ASCII and numbers alone', () => {
    expect(searchNormalize('linux-6.8.tar.xz')).toBe('linux-6.8.tar.xz');
  });

  it('leaves non-Latin scripts intact', () => {
    expect(searchNormalize('日本語タイトル')).toBe('日本語タイトル');
    expect(searchNormalize('Привет')).toBe('привет');
  });
});
