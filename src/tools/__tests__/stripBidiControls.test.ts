import { describe, it, expect } from 'vitest';
import stripBidiControls from '../stripBidiControls';

/**
 * The character class is written with escapes precisely so it can be reviewed,
 * but nothing stopped it silently becoming a no-op: every one of these cases
 * passed with the function returning its input unchanged. Build the control
 * characters from code points here too, so the fixtures stay readable.
 */
const cp = (hex: string) => String.fromCodePoint(parseInt(hex, 16));

const RLO = cp('202E'); // RIGHT-TO-LEFT OVERRIDE — the extension spoof
const PDF = cp('202C');
const LRM = cp('200E');
const RLM = cp('200F');
const LRE = cp('202A');
const RLE = cp('202B');
const LRO = cp('202D');
const LRI = cp('2066');
const RLI = cp('2067');
const FSI = cp('2068');
const PDI = cp('2069');
const ALM = cp('061C');

describe('stripBidiControls', () => {
  it('defuses the classic extension spoof', () => {
    // Renders as "holiday-photosexe.png" in a notification or a list row
    const spoofed = `holiday-photos${RLO}gnp.exe`;
    expect(stripBidiControls(spoofed)).toBe('holiday-photosgnp.exe');
  });

  it.each([
    ['LRM', LRM],
    ['RLM', RLM],
    ['LRE', LRE],
    ['RLE', RLE],
    ['PDF', PDF],
    ['LRO', LRO],
    ['RLO', RLO],
    ['LRI', LRI],
    ['RLI', RLI],
    ['FSI', FSI],
    ['PDI', PDI],
    ['ALM', ALM],
  ])('strips %s', (_name, control) => {
    expect(stripBidiControls(`a${control}b`)).toBe('ab');
  });

  it('strips every occurrence, not just the first', () => {
    expect(stripBidiControls(`${RLO}a${RLO}b${RLO}`)).toBe('ab');
  });

  it('leaves legitimate right-to-left text alone', () => {
    // The bidi algorithm renders these on its own; no control characters needed
    expect(stripBidiControls('שלום עולם')).toBe('שלום עולם');
    expect(stripBidiControls('مرحبا بالعالم')).toBe('مرحبا بالعالم');
  });

  it('leaves ordinary names untouched', () => {
    expect(stripBidiControls('Ubuntu 24.04.iso.torrent')).toBe('Ubuntu 24.04.iso.torrent');
    expect(stripBidiControls('')).toBe('');
  });
});
