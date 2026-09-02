import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * The isolated-world relay, driven end to end against the MAIN-world hooks it
 * actually talks to. Only the MAIN half had a test, so the protocol between
 * the two halves — arm, re-click, captured — was unverified: renaming a field
 * on one side left the whole feature dead with the suite still green.
 */

const TORRENT =
  'd8:announce9:http://a/4:infod6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';

type Respond = (result: { result?: unknown; error?: { code?: string; message?: string } }) => void;
type Listener = (message: unknown, sender: unknown, respond: Respond) => boolean | void;

let listener: Listener;
let clicks: number;

/** What a tracker's JavaScript download button does when activated. */
function wireDownloadButton(button: HTMLElement, body: string, name = 'black-box.torrent') {
  button.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/x-bittorrent' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  });
}

function capture(): Promise<{ result?: unknown; error?: { code?: string; message?: string } }> {
  return new Promise((resolve) => {
    listener({ action: 'captureTorrent' }, {}, resolve);
  });
}

describe('tabCapture relay', () => {
  beforeAll(async () => {
    // jsdom has no createObjectURL; provide one before the hooks wrap it
    const store = new Map<string, Blob>();
    let n = 0;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      const url = `blob:null/${++n}`;
      store.set(url, b);
      return url;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
      store.delete(u);
    };
    clicks = 0;
    HTMLAnchorElement.prototype.click = function () {
      clicks++;
    };

    await import('../tabCaptureMain');
    await import('../tabCapture');

    const addListener = chrome.runtime.onMessage.addListener as unknown as {
      mock: { calls: [Listener][] };
    };
    listener = addListener.mock.calls[0][0];
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.__tecContextTarget = null;
  });

  it('captures the torrent a JavaScript button produces', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    wireDownloadButton(button, TORRENT);
    window.__tecContextTarget = button;

    const before = clicks;
    const response = await capture();

    expect(response.error).toBeUndefined();
    const result = response.result as { base64: string; name: string; mime: string };
    expect(atob(result.base64)).toBe(TORRENT);
    expect(result.name).toBe('black-box.torrent');
    // The page's own download was suppressed in favour of the capture
    expect(clicks).toBe(before);
  });

  it('activates the control when the user right-clicked its SVG icon', async () => {
    // click() lives on HTMLElement, not SVGElement: calling it straight on the
    // <path> under the cursor threw, and the capture just ran out its timeout.
    const button = document.createElement('button');
    button.innerHTML = '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"></path></svg>';
    document.body.append(button);
    wireDownloadButton(button, TORRENT, 'from-icon.torrent');

    const icon = button.querySelector('path');
    expect(icon).not.toBeNull();
    expect((icon as unknown as { click?: unknown }).click).toBeUndefined();
    window.__tecContextTarget = icon;

    const response = await capture();
    expect(response.error).toBeUndefined();
    expect((response.result as { name: string }).name).toBe('from-icon.torrent');
  });

  it('hands an ancestor link back as a url instead of capturing', async () => {
    const link = document.createElement('a');
    link.href = 'https://tracker.example/file.torrent';
    const label = document.createElement('span');
    link.append(label);
    document.body.append(link);
    window.__tecContextTarget = label;

    const response = await capture();
    expect(response.result).toEqual({ url: 'https://tracker.example/file.torrent' });
  });

  it('reports NOT_A_TORRENT when the button produces something else', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    wireDownloadButton(button, '<html>login page</html>', 'fake.torrent');
    window.__tecContextTarget = button;

    const response = await capture();
    expect(response.error?.code).toBe('NOT_A_TORRENT');
  });

  it('reports NO_TARGET when nothing was right-clicked', async () => {
    const response = await capture();
    expect(response.error?.code).toBe('NO_TARGET');
  });

  it('reports NO_TARGET when the recorded element has left the document', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    window.__tecContextTarget = button;
    button.remove();

    const response = await capture();
    expect(response.error?.code).toBe('NO_TARGET');
  });
});
