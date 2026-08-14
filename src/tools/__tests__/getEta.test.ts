import { describe, expect, it } from 'vitest';
import getEta from '../getEta';

// chromeMock's timeOutList is ["w", "d", "h", "m", "s"]
describe('getEta', () => {
  it('renders -1 (not available / infinite) as ∞', () => {
    expect(getEta(-1)).toBe('∞');
  });

  it('renders -2 (unknown) as ?', () => {
    expect(getEta(-2)).toBe('?');
  });

  it('renders 0 as empty', () => {
    expect(getEta(0)).toBe('');
  });

  it('renders seconds', () => {
    expect(getEta(59)).toBe('59s');
  });

  it('renders minutes and seconds', () => {
    expect(getEta(90)).toBe('1m 30s');
  });

  it('renders hours and minutes', () => {
    expect(getEta(3660)).toBe('1h 1m');
  });

  it('renders days and hours', () => {
    expect(getEta(90000)).toBe('1d 1h');
  });

  it('renders weeks and days', () => {
    expect(getEta(8 * 24 * 3600)).toBe('1w 1d');
  });

  it('renders more than 10 weeks as ∞', () => {
    expect(getEta(11 * 7 * 24 * 3600)).toBe('∞');
  });
});
