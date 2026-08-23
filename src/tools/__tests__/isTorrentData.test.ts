import { describe, it, expect } from 'vitest';
import { looksLikeTorrent } from '../isTorrentData';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('looksLikeTorrent', () => {
  it('accepts a minimal bencoded torrent', () => {
    const t =
      'd8:announce27:http://tracker.example/ann4:infod6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';
    expect(looksLikeTorrent(bytes(t))).toBe(true);
  });

  it('tolerates leading whitespace', () => {
    expect(looksLikeTorrent(bytes('\n d4:infod1:ai1eee'))).toBe(true);
  });

  it('rejects an HTML page (a torrent TITLE link fetched by mistake)', () => {
    expect(looksLikeTorrent(bytes('<!doctype html><html><body>login</body></html>'))).toBe(false);
  });

  it('rejects a JSON error body', () => {
    expect(looksLikeTorrent(bytes('{"error":"unauthenticated"}'))).toBe(false);
  });

  it('rejects a bencoded dictionary without an info dict', () => {
    expect(looksLikeTorrent(bytes('d8:announce3:abce'))).toBe(false);
  });

  it('rejects empty input', () => {
    expect(looksLikeTorrent(new Uint8Array(0))).toBe(false);
  });
});
