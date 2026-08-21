import { arrayBufferToBase64 } from './tools/binaryConversion';
import getLogger from './tools/getLogger';
import ErrorWithCode from './tools/ErrorWithCode';
import fetchWithTimeout from './tools/fetchWithTimeout';
import { serializeError } from 'serialize-error';
import { MAX_FETCH_SIZE } from './constants';

const logger = getLogger('tabUrlFetch');

interface FetchMessage {
  action: string;
  url?: string;
}

interface FetchResult {
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    url: string;
    type: ResponseType;
    redirected: boolean;
    headers: [string, string][];
  };
  base64: string;
}

declare global {
  interface Window {
    tabUrlFetch?: boolean;
    onbeforeunload: ((this: WindowEventHandlers, ev: BeforeUnloadEvent) => unknown) | null;
  }
}

!window.tabUrlFetch &&
  (() => {
    window.tabUrlFetch = true;

    chrome.runtime.onMessage.addListener(
      (
        message: FetchMessage,
        _sender: chrome.runtime.MessageSender,
        response: (result: { result?: FetchResult; error?: unknown }) => void
      ) => {
        let promise: Promise<FetchResult> | null = null;

        switch (message && message.action) {
          case 'fetchUrl': {
            if (!message.url) {
              promise = Promise.reject(new Error('URL is required'));
            } else {
              promise = closeLockWrap(fetchUrl(message.url));
            }
            break;
          }
          default: {
            promise = Promise.reject(new Error('Unknown request'));
          }
        }

        if (promise) {
          promise
            .then(
              (result) => {
                response({ result });
              },
              (err) => {
                response({ error: serializeError(err) });
              }
            )
            .catch((err) => {
              logger.error('Send response error', err);
            });
          return true;
        }
      }
    );

    function fetchUrl(url: string): Promise<FetchResult> {
      // Timeout spans the body read too — a stalled server must not keep the
      // closeLockWrap beforeunload handler engaged forever
      return fetchWithTimeout(url, undefined, undefined, (response) => {
        if (!response.ok) {
          throw new ErrorWithCode(
            `${response.status}: ${response.statusText}`,
            `RESPONSE_IS_NOT_OK`
          );
        }

        const contentLength = response.headers.get('Content-Length');
        if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_SIZE) {
          throw new ErrorWithCode(`Size is more then 10mb`, 'FILE_SIZE_EXCEEDED');
        }

        const safeResponse = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          type: response.type,
          redirected: response.redirected,
          headers: Array.from(response.headers.entries()) as [string, string][],
        };

        return response.arrayBuffer().then((arrayBuffer) => {
          // Content-Length is absent on chunked responses — enforce the cap
          // on what actually arrived, like downloadFileFromUrl does
          if (arrayBuffer.byteLength > MAX_FETCH_SIZE) {
            throw new ErrorWithCode(`Size is more then 10mb`, 'FILE_SIZE_EXCEEDED');
          }
          return { response: safeResponse, base64: arrayBufferToBase64(arrayBuffer) };
        });
      });
    }

    let lockCount = 0;
    function closeLockWrap<T>(promise: Promise<T>): Promise<T> {
      lockCount++;
      window.onbeforeunload = () => true;
      return promise.finally(() => {
        if (--lockCount === 0) {
          window.onbeforeunload = null;
        }
      });
    }
  })();
