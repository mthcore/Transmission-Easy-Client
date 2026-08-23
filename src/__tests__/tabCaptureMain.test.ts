import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The MAIN-world hooks: armed with a nonce, they must catch the page's own
 * blob torrent download (createObjectURL + <a download>.click()), relay the
 * bytes by postMessage, and suppress the file download; disarmed, they must be
 * inert.
 */

const TORRENT =
  'd8:announce9:http://a/4:infod6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';

function waitForMessage(predicate: (data: Record<string, unknown>) => boolean, ms = 1500) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('timeout'));
    }, ms);
    function onMessage(e: MessageEvent) {
      const data = e.data as Record<string, unknown>;
      if (data && predicate(data)) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data);
      }
    }
    window.addEventListener('message', onMessage);
  });
}

describe('tabCaptureMain hooks', () => {
  let clicks = 0;

  beforeAll(async () => {
    // jsdom has no createObjectURL: provide a minimal one before the hooks wrap it
    const store = new Map<string, Blob>();
    let n = 0;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      const u = `blob:null/${++n}`;
      store.set(u, b);
      return u;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
      store.delete(u);
    };
    // Count the downloads that would have happened
    HTMLAnchorElement.prototype.click = function () {
      clicks++;
    };
    await import('../tabCaptureMain');
  });

  it('captures a torrent blob download and suppresses the file download', async () => {
    const nonce = 'n1';
    const armed = waitForMessage((d) => d.__tecCapture === true && d.type === 'armed');
    window.postMessage({ __tecCaptureControl: 'arm', nonce }, '*');
    await armed;

    const captured = waitForMessage((d) => d.__tecCapture === true && d.type === 'captured');
    const before = clicks;
    // What a tracker's download button does
    const blob = new Blob([TORRENT], { type: 'application/x-bittorrent' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'black-box.torrent';
    a.click();

    const msg = await captured;
    expect(msg.nonce).toBe(nonce);
    expect(atob(msg.base64 as string)).toBe(TORRENT);
    expect(msg.name).toBe('black-box.torrent');
    expect(clicks).toBe(before); // the real download did not happen
    window.postMessage({ __tecCaptureControl: 'disarm', nonce }, '*');
    await new Promise((r) => setTimeout(r, 20));
  });

  it('lets a non-torrent blob download through, reporting notTorrent', async () => {
    const nonce = 'n2';
    const armed = waitForMessage((d) => d.__tecCapture === true && d.type === 'armed');
    window.postMessage({ __tecCaptureControl: 'arm', nonce }, '*');
    await armed;

    const report = waitForMessage((d) => d.__tecCapture === true && d.type === 'notTorrent');
    const before = clicks;
    const blob = new Blob(['<html>nope</html>'], { type: 'application/x-bittorrent' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fake.torrent';
    a.click();
    await report;
    expect(clicks).toBe(before + 1); // original download performed
    window.postMessage({ __tecCaptureControl: 'disarm', nonce }, '*');
    await new Promise((r) => setTimeout(r, 20));
  });

  it('is inert when not armed', async () => {
    const before = clicks;
    const blob = new Blob([TORRENT], { type: 'application/x-bittorrent' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'x.torrent';
    a.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(clicks).toBe(before + 1);
  });

  it('ignores a disarm carrying the wrong nonce', async () => {
    const nonce = 'n3';
    const armed = waitForMessage((d) => d.__tecCapture === true && d.type === 'armed');
    window.postMessage({ __tecCaptureControl: 'arm', nonce }, '*');
    await armed;
    window.postMessage({ __tecCaptureControl: 'disarm', nonce: 'other' }, '*');
    await new Promise((r) => setTimeout(r, 20));

    const captured = waitForMessage((d) => d.__tecCapture === true && d.type === 'captured');
    const blob = new Blob([TORRENT], { type: 'application/x-bittorrent' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'y.torrent';
    a.click();
    await captured; // still armed
    window.postMessage({ __tecCaptureControl: 'disarm', nonce }, '*');
    await new Promise((r) => setTimeout(r, 20));
  });
});
