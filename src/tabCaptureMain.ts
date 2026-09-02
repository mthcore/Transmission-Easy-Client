/**
 * MAIN-world hooks that catch a page's own torrent download.
 *
 * Modern trackers don't expose `<a href="….torrent">` any more: their button
 * runs `fetch('/api/torrents/<id>/download')`, wraps the bytes in a Blob, and
 * clicks a throwaway `<a download>` pointing at `URL.createObjectURL(blob)`.
 * There is no link to right-click, and the bytes never touch the network in a
 * form the extension could re-fetch. So, for the short window of one explicit
 * user action, this script wraps URL.createObjectURL and anchor clicks: when
 * the page produces a torrent blob, the bytes are handed to the extension's
 * isolated world (postMessage, nonce-tagged) and the file download is
 * suppressed. Everything is restored on disarm.
 *
 * Runs in the page's JavaScript world (chrome.scripting world: 'MAIN'), so it
 * must be self-contained: no imports that webpack would turn into shared
 * chunks, and nothing the page could abuse — the hooks are only live while
 * armed by a message carrying the per-capture nonce.
 */
(() => {
  const FLAG = '__tecCaptureMainInstalled';
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;

  // Mirrors MAX_FETCH_SIZE from ../constants; the MAIN world can't import
  const MAX_BYTES = 10 * 1024 * 1024;
  let armedNonce: string | null = null;
  const blobs = new Map<string, Blob>();

  const nativeCreateObjectURL = URL.createObjectURL;
  const nativeRevokeObjectURL = URL.revokeObjectURL;
  const origCreateObjectURL = nativeCreateObjectURL.bind(URL);
  const origRevokeObjectURL = nativeRevokeObjectURL.bind(URL);
  const origAnchorClick = HTMLAnchorElement.prototype.click;

  // Behavioural twin of looksLikeTorrentBuffer in tools/isTorrentData.ts.
  // It cannot be imported (this file runs in the page's world, so webpack must
  // not hand it shared chunks), so the two have to be changed together — they
  // had already drifted apart on which bytes count as leading whitespace.
  const looksLikeTorrent = (bytes: Uint8Array): boolean => {
    let i = 0;
    while (
      i < bytes.length &&
      (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)
    )
      i++;
    if (bytes[i] !== 0x64) return false;
    const needle = [0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f, 0x64]; // "4:infod"
    outer: for (let p = i; p <= bytes.length - needle.length; p++) {
      for (let k = 0; k < needle.length; k++) if (bytes[p + k] !== needle[k]) continue outer;
      return true;
    }
    return false;
  };

  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(binary);
  };

  // Delivered by window.postMessage, so the PAGE sees it too: this script runs
  // in the page's own world, and there is no channel between the two worlds
  // the page cannot read or write. The nonce keeps unrelated messages out — it
  // is not a secret and cannot stop a hostile page forging a 'captured' reply.
  // That is tolerable because the page was already the source of the bytes,
  // and the background re-checks them with looksLikeTorrentBuffer before the
  // daemon is handed anything.
  const post = (payload: Record<string, unknown>) => {
    window.postMessage({ __tecCapture: true, nonce: armedNonce, ...payload }, '*');
  };

  const hookedCreateObjectURL = ((obj: Blob | MediaSource) => {
    const url = origCreateObjectURL(obj);
    if (armedNonce && obj instanceof Blob && obj.size <= MAX_BYTES) {
      blobs.set(url, obj);
    }
    return url;
  }) as typeof URL.createObjectURL;

  const hookedRevokeObjectURL = ((url: string) => {
    // Keep the blob reference while armed: sites revoke right after click(),
    // before our async read finished
    if (!armedNonce) blobs.delete(url);
    return origRevokeObjectURL(url);
  }) as typeof URL.revokeObjectURL;

  const isTorrentAnchor = (a: HTMLAnchorElement): Blob | null => {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('blob:')) return null;
    const blob = blobs.get(href);
    if (!blob) return null;
    const name = a.getAttribute('download') || '';
    if (/\.torrent$/i.test(name) || /bittorrent/i.test(blob.type)) return blob;
    return null;
  };

  let capturing = false;
  const capture = async (a: HTMLAnchorElement, blob: Blob) => {
    if (capturing) return;
    capturing = true;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!looksLikeTorrent(bytes)) {
        // Not a torrent after all: let the page's download proceed
        post({ type: 'notTorrent' });
        origAnchorClick.call(a);
        return;
      }
      post({
        type: 'captured',
        base64: toBase64(bytes),
        name: a.getAttribute('download') || '',
        mime: blob.type || 'application/x-bittorrent',
      });
    } catch (err) {
      post({ type: 'error', message: String(err) });
    } finally {
      capturing = false;
    }
  };

  const hookedAnchorClick = function (this: HTMLAnchorElement) {
    if (armedNonce) {
      const blob = isTorrentAnchor(this);
      if (blob) {
        void capture(this, blob);
        return;
      }
    }
    return origAnchorClick.call(this);
  };

  const installHooks = () => {
    URL.createObjectURL = hookedCreateObjectURL;
    URL.revokeObjectURL = hookedRevokeObjectURL;
    HTMLAnchorElement.prototype.click = hookedAnchorClick;
    document.addEventListener('click', onDocumentClick, true);
  };

  const restoreHooks = () => {
    // Take back only what is still ours: if the page replaced one of these
    // while we were armed, overwriting it would break the page
    if (URL.createObjectURL === hookedCreateObjectURL) {
      URL.createObjectURL = nativeCreateObjectURL;
    }
    if (URL.revokeObjectURL === hookedRevokeObjectURL) {
      URL.revokeObjectURL = nativeRevokeObjectURL;
    }
    if (HTMLAnchorElement.prototype.click === hookedAnchorClick) {
      HTMLAnchorElement.prototype.click = origAnchorClick;
    }
    document.removeEventListener('click', onDocumentClick, true);
  };

  // Anchors attached to the DOM and clicked via dispatchEvent / user gesture
  const onDocumentClick = (event: MouseEvent) => {
    if (!armedNonce) return;
    const target = event.target as Element | null;
    const a = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const blob = isTorrentAnchor(a);
    if (!blob) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void capture(a, blob);
  };

  window.addEventListener('message', (event: MessageEvent) => {
    // Same-window messages only (jsdom reports source as null; the nonce is
    // the actual guard against unrelated messages)
    if (event.source !== window && event.source !== null) return;
    const data = event.data as { __tecCaptureControl?: string; nonce?: string } | null;
    if (!data || !data.__tecCaptureControl) return;
    if (data.__tecCaptureControl === 'arm' && typeof data.nonce === 'string') {
      armedNonce = data.nonce;
      blobs.clear();
      installHooks();
      post({ type: 'armed' });
    } else if (data.__tecCaptureControl === 'disarm' && data.nonce === armedNonce) {
      armedNonce = null;
      blobs.clear();
      restoreHooks();
    }
  });
})();

export {};
