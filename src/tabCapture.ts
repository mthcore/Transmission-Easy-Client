import { serializeError } from 'serialize-error';
import ErrorWithCode from './tools/ErrorWithCode';

/**
 * Isolated-world relay for "Add to Transmission" on a NON-link element.
 *
 * Resolves what the user right-clicked (recorded by ctxTarget.ts) into either
 * a plain URL (an ancestor link — the background then uses the normal fetch
 * path) or the bytes of the torrent the page itself produces when that
 * element is clicked (hooks in tabCaptureMain.ts, armed here with a nonce, then
 * the element is re-clicked and the captured blob is relayed back).
 */

declare global {
  interface Window {
    __tecContextTarget?: Element | null;
    tabCapture?: boolean;
  }
}

interface CaptureMessage {
  action: string;
}

type CaptureResult = { url: string } | { base64: string; name: string; mime: string };

const CAPTURE_TIMEOUT = 8000;

!window.tabCapture &&
  (() => {
    window.tabCapture = true;

    chrome.runtime.onMessage.addListener(
      (
        message: CaptureMessage,
        _sender: chrome.runtime.MessageSender,
        respond: (result: { result?: CaptureResult; error?: unknown }) => void
      ) => {
        if (!message || message.action !== 'captureTorrent') return;
        captureTorrent().then(
          (result) => respond({ result }),
          (err) => respond({ error: serializeError(err) })
        );
        return true;
      }
    );

    function captureTorrent(): Promise<CaptureResult> {
      const target = window.__tecContextTarget;
      if (!target || !target.isConnected) {
        return Promise.reject(new ErrorWithCode('No right-clicked element', 'NO_TARGET'));
      }

      // An ancestor link: hand the URL back, the normal download path owns it
      const anchor = (target.closest('a[href]') as HTMLAnchorElement | null) ?? null;
      const href = anchor?.href || '';
      if (/^(https?|magnet):/i.test(href)) {
        return Promise.resolve({ url: href });
      }

      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

      return new Promise<CaptureResult>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          window.postMessage({ __tecCaptureControl: 'disarm', nonce }, '*');
          fn();
        };

        const onMessage = (event: MessageEvent) => {
          // Same-window messages only (jsdom reports source as null; the nonce is
          // the actual guard against unrelated messages)
          if (event.source !== window && event.source !== null) return;
          const data = event.data as {
            __tecCapture?: boolean;
            nonce?: string;
            type?: string;
            base64?: string;
            name?: string;
            mime?: string;
            message?: string;
          } | null;
          if (!data || !data.__tecCapture || data.nonce !== nonce) return;
          switch (data.type) {
            case 'armed':
              // Re-trigger the page's own handler on the element the user chose
              (target as HTMLElement).click();
              break;
            case 'captured':
              finish(() =>
                resolve({ base64: data.base64 || '', name: data.name || '', mime: data.mime || '' })
              );
              break;
            case 'notTorrent':
              finish(() =>
                reject(new ErrorWithCode('The download was not a torrent file', 'NOT_A_TORRENT'))
              );
              break;
            case 'error':
              finish(() => reject(new Error(data.message || 'Capture failed')));
              break;
          }
        };

        const timer = setTimeout(() => {
          finish(() =>
            reject(
              new ErrorWithCode(
                'No torrent file was produced by this element',
                'NO_TORRENT_CAPTURED'
              )
            )
          );
        }, CAPTURE_TIMEOUT);

        window.addEventListener('message', onMessage);
        window.postMessage({ __tecCaptureControl: 'arm', nonce }, '*');
      });
    }
  })();
