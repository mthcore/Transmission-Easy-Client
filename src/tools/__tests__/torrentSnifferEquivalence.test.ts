import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { looksLikeTorrent } from '../isTorrentData';

/**
 * `looksLikeTorrent` exists TWICE: here in tools/isTorrentData.ts (isolated
 * world) and inline in tabCaptureMain.ts, which runs in the page's own
 * JavaScript world and therefore must be self-contained — webpack must not hand
 * it shared chunks. The duplication is forced and legitimate.
 *
 * The DRIFT is not. The two copies had already diverged once, on whether a tab
 * counts as leading whitespace, which meant a torrent produced with a leading
 * tab was accepted by one path and rejected by the other. A comment asking
 * future editors to change both cannot enforce that; this test can.
 *
 * It evaluates the ACTUAL source of the MAIN-world copy rather than a
 * transcription, so editing one implementation and not the other fails here.
 */

const MAIN_WORLD_FILE = path.join(__dirname, '../../tabCaptureMain.ts');
const MARKER = 'const looksLikeTorrent = (bytes: Uint8Array): boolean => {';

/** Pull the MAIN-world implementation out of the file and make it callable. */
function extractMainWorldSniffer(): (bytes: Uint8Array) => boolean {
  const source = fs.readFileSync(MAIN_WORLD_FILE, 'utf8');
  const start = source.indexOf(MARKER);
  if (start === -1) {
    throw new Error(
      `Could not find the MAIN-world looksLikeTorrent in ${MAIN_WORLD_FILE}. ` +
        'If it was renamed or removed, update MARKER — do not delete this test: ' +
        'it is the only thing keeping the two sniffers in step.'
    );
  }

  // Walk braces from the arrow body to find the matching close
  const bodyStart = source.indexOf('{', start + MARKER.length - 1);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Unbalanced braces while extracting the MAIN-world sniffer');

  const body = source.slice(bodyStart, end + 1);
  // The only TypeScript in the body is the parameter/return annotation, which
  // lives in the signature we are replacing anyway.
  const factory = new Function(`return (bytes) => ${body};`);
  return factory() as (bytes: Uint8Array) => boolean;
}

const mainWorldLooksLikeTorrent = extractMainWorldSniffer();

/** ASCII/latin1 helper — every fixture below is byte-oriented, not text */
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

const MINIMAL_TORRENT =
  'd8:announce9:http://a/4:infod6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';

const CASES: Array<{ label: string; input: Uint8Array; expected: boolean }> = [
  { label: 'a minimal valid torrent', input: bytes(MINIMAL_TORRENT), expected: true },
  { label: 'leading space', input: bytes(' ' + MINIMAL_TORRENT), expected: true },
  { label: 'leading newline', input: bytes('\n' + MINIMAL_TORRENT), expected: true },
  { label: 'leading carriage return', input: bytes('\r' + MINIMAL_TORRENT), expected: true },
  // The exact case the two copies once disagreed on
  { label: 'leading TAB', input: bytes('\t' + MINIMAL_TORRENT), expected: true },
  {
    label: 'mixed leading whitespace',
    input: bytes(' \r\n\t' + MINIMAL_TORRENT),
    expected: true,
  },
  { label: 'an HTML login page', input: bytes('<!DOCTYPE html><html>...'), expected: false },
  { label: 'a JSON error body', input: bytes('{"error":"nope"}'), expected: false },
  { label: 'an empty body', input: new Uint8Array(), expected: false },
  { label: 'whitespace only', input: bytes('   \r\n\t'), expected: false },
  {
    label: 'a bencoded dict with no info dictionary',
    input: bytes('d8:announce9:http://a/e'),
    expected: false,
  },
  { label: 'the needle but not starting with d', input: bytes('x4:infod'), expected: false },
  { label: 'an uppercase D', input: bytes('D4:infod'), expected: false },
  { label: 'the needle at the very end', input: bytes('d4:infod'), expected: true },
  {
    label: 'a truncated needle at the end',
    input: bytes('d8:announce4:infi'),
    expected: false,
  },
  {
    label: 'high bytes in the announce URL (arbitrary bytes are legal)',
    input: bytes('d8:announce4:\xff\xfe\xfd\x004:infod'),
    expected: true,
  },
];

describe('torrent sniffer: tools/isTorrentData vs the MAIN-world copy', () => {
  it.each(CASES)('agree on $label', ({ input, expected }) => {
    expect(looksLikeTorrent(input)).toBe(expected);
    expect(mainWorldLooksLikeTorrent(input)).toBe(expected);
  });

  it('KNOWN GAP: neither skips a UTF-8 BOM, despite the comment saying "whitespace/BOM"', () => {
    // isTorrentData.ts says "Skip leading whitespace/BOM" but the skip list is
    // only 0x20/0x0a/0x0d/0x09 — EF BB BF is not skipped, so a BOM-prefixed
    // torrent is rejected. Pinned as current behaviour; the point here is that
    // BOTH copies are wrong in the SAME way, which is what this suite
    // guarantees.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(MINIMAL_TORRENT)]);
    expect(looksLikeTorrent(withBom)).toBe(false);
    expect(mainWorldLooksLikeTorrent(withBom)).toBe(false);
  });

  it('extraction actually found the shipped implementation', () => {
    // Guards against the suite silently degrading into "a function I wrote in
    // the test agrees with itself" if the marker ever stops matching.
    expect(typeof mainWorldLooksLikeTorrent).toBe('function');
    expect(mainWorldLooksLikeTorrent(bytes(MINIMAL_TORRENT))).toBe(true);
    expect(mainWorldLooksLikeTorrent(bytes('nope'))).toBe(false);
  });
});
