import ErrorWithCode from './ErrorWithCode';
import { base64ToArrayBuffer } from './binaryConversion';

interface CaptureResponse {
  result?: { url: string } | { base64: string; name: string; mime: string };
  error?: { message: string; code?: string; name?: string };
}

interface ExtendedError extends Error {
  code?: string;
}

/**
 * "Add to Transmission" on an element that is not a link: the tracker's own
 * JavaScript download button. Installs the MAIN-world hooks, then the isolated
 * relay, and asks it to resolve the right-clicked element into a URL or the
 * captured torrent bytes.
 */
async function captureTorrentFromTab(
  tabId: number,
  frameId?: number
): Promise<{ blob?: Blob; url?: string }> {
  const target: chrome.scripting.InjectionTarget = { tabId };
  if (frameId !== undefined) {
    (target as { frameIds?: number[] }).frameIds = [frameId];
  }

  // Extension-injected MAIN-world scripts bypass the page's CSP (sites with a
  // nonce CSP block an inline <script>, which is why this is not done by the
  // isolated script itself)
  await executeScript({ target, files: ['tabCaptureMain.js'], world: 'MAIN' });
  await executeScript({ target, files: ['tabCapture.js'] });

  const response = await tabsSendMessage<CaptureResponse | undefined>(
    tabId,
    { action: 'captureTorrent' },
    { frameId }
  );
  if (!response) throw new Error('Response is empty');
  if (response.error) {
    const err: ExtendedError = new Error(response.error.message || 'Unknown error');
    if (response.error.code) err.code = response.error.code;
    throw err;
  }
  const result = response.result;
  if (!result) throw new Error('Response result is empty');
  if ('url' in result) return { url: result.url };
  const buffer = base64ToArrayBuffer(result.base64);
  return { blob: new Blob([buffer], { type: result.mime || 'application/x-bittorrent' }) };
}

const executeScript = (injection: {
  target: chrome.scripting.InjectionTarget;
  files: string[];
  world?: 'MAIN' | 'ISOLATED';
}): Promise<void> => {
  // Callback form: chrome.* has no promise support on Firefox
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      injection as chrome.scripting.ScriptInjection<unknown[], unknown>,
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new ErrorWithCode(err.message || 'executeScript failed', 'INJECT_FAILED'));
          return;
        }
        resolve();
      }
    );
  });
};

const tabsSendMessage = <T>(
  tabId: number,
  message: unknown,
  options?: { frameId?: number }
): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, options || {}, (response: T) => {
      const err = chrome.runtime.lastError;
      err ? reject(err) : resolve(response);
    });
  });
};

export default captureTorrentFromTab;
