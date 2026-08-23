/**
 * Sniffs whether a byte buffer is a bencoded .torrent. A torrent is a bencoded
 * dictionary ('d' … 'e') that always carries an `info` dictionary. HTML login
 * pages, JSON error bodies and SPA shells all fail this — and they used to be
 * posted to the daemon as `metainfo`, which answered "invalid or corrupt
 * torrent file" with nothing telling the user the link was a web page.
 */
export function looksLikeTorrent(bytes: Uint8Array): boolean {
  // Skip leading whitespace/BOM
  let i = 0;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)
  ) {
    i++;
  }
  if (bytes[i] !== 0x64 /* 'd' */) return false;
  // Must contain "4:infod" (the info dictionary) somewhere in the file
  const needle = [0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f, 0x64]; // "4:infod"
  const limit = bytes.length - needle.length;
  outer: for (let p = i; p <= limit; p++) {
    for (let k = 0; k < needle.length; k++) {
      if (bytes[p + k] !== needle[k]) continue outer;
    }
    return true;
  }
  return false;
}

export function looksLikeTorrentBuffer(buffer: ArrayBuffer): boolean {
  return looksLikeTorrent(new Uint8Array(buffer));
}
