import ErrorWithCode from '../tools/ErrorWithCode';
import fetchWithTimeout from '../tools/fetchWithTimeout';
import { toBasicAuthValue } from '../tools/basicAuth';
import { storageGet, storageSet, storageRemove } from '../tools/chromeStorage';
import { FETCH_TIMEOUT } from '../constants';

export interface TransmissionResponse {
  result: string;
  arguments: Record<string, unknown>;
}

interface ErrorWithToken extends Error {
  code: string;
  status?: number;
  statusText?: string;
  token?: string;
}

interface TransportConfig {
  authenticationRequired: boolean;
  login: string;
  password: string;
}

interface TransportOptions {
  url: string;
  getConfig: () => TransportConfig;
  onConnected: () => void;
  onTokenRefresh?: () => void;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

// A timed-out or reset request may still have reached the daemon, so blindly
// re-sending it can apply the operation twice. Everything else (reads, absolute
// sets, start/stop/remove) is safe to repeat.
const NON_IDEMPOTENT_METHODS = new Set([
  'torrent-add',
  'queue-move-up',
  'queue-move-down',
  'torrent-rename-path',
  'blocklist-update',
]);

function isRetryableFetchError(err: unknown): boolean {
  // TypeError is thrown by fetch for network failures (DNS, connection refused, etc.).
  // FETCH_TIMEOUT is thrown by fetchWithTimeout when the daemon never responds at all
  // (hung connection behind a proxy/firewall, no TypeError ever raised). Both are
  // transient conditions worth the same retry-with-backoff treatment.
  if (err instanceof TypeError) return true;
  return err instanceof ErrorWithCode && err.code === 'FETCH_TIMEOUT';
}

/**
 * Session storage survives service-worker termination but not a browser
 * restart, which matches the lifetime of a Transmission session id.
 */
const TOKEN_STORAGE_KEY = '_sessionToken';

class TransmissionTransport {
  url: string;
  token: string | null;
  rpcVersion = 0;
  private getConfig: () => TransportConfig;
  private onConnected: () => void;
  private onTokenRefresh?: () => void;

  constructor(options: TransportOptions) {
    this.url = options.url;
    this.token = null;
    this.getConfig = options.getConfig;
    this.onConnected = options.onConnected;
    this.onTokenRefresh = options.onTokenRefresh;

    // Restore the cached session id so an MV3 wake-up doesn't cost a 409
    // round-trip on its first request. Goes through the callback-based helpers:
    // Firefox's chrome.* namespace has no promise support and returns
    // undefined, so `chrome.storage.session.get(...).then(...)` would throw
    // right here and leave the whole client unbuilt.
    if (chrome.storage.session) {
      storageGet<Record<string, { url: string; token: string } | undefined>>(
        TOKEN_STORAGE_KEY,
        'session'
      )
        .then((data) => {
          const cached = data?.[TOKEN_STORAGE_KEY];
          if (this.token === null && cached?.url === this.url && cached.token) {
            this.token = cached.token;
          }
        })
        .catch(() => {
          // A missing cache only costs one extra 409 round-trip
        });
    }
  }

  private persistToken(): void {
    if (!chrome.storage.session) return;
    const promise = this.token
      ? storageSet({ [TOKEN_STORAGE_KEY]: { url: this.url, token: this.token } }, 'session')
      : storageRemove(TOKEN_STORAGE_KEY, 'session');
    promise.catch(() => {
      // Best-effort cache only
    });
  }

  sendAction(
    body: Record<string, unknown>,
    customParser?: (text: string) => TransmissionResponse,
    timeoutMs: number = FETCH_TIMEOUT
  ): Promise<TransmissionResponse> {
    // Legacy argument names are sent as-is: the bespoke /transmission/rpc
    // endpoint accepts them on every daemon from 2.x through 4.2+.
    return this.retryIfTokenInvalid(() => {
      return this.fetchWithRetry(body, customParser, 0, timeoutMs);
    }).then((response) => {
      if (response.result !== 'success') {
        throw new ErrorWithCode(response.result, 'TRANSMISSION_ERROR');
      }
      return response;
    });
  }

  private fetchWithRetry(
    body: Record<string, unknown>,
    customParser?: (text: string) => TransmissionResponse,
    attempt = 0,
    timeoutMs: number = FETCH_TIMEOUT
  ): Promise<TransmissionResponse> {
    return fetchWithTimeout(
      this.url,
      this.sign({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Transmission-Session-Id': this.token || '',
        },
        body: JSON.stringify(body),
      }),
      timeoutMs,
      // The body is read inside the timeout window: a daemon/proxy that sends
      // headers then stalls the body must still trip FETCH_TIMEOUT
      (response) => {
        if (!response.ok) {
          const error = new ErrorWithCode(
            `${response.status}: ${response.statusText}`,
            'RESPONSE_IS_NOT_OK'
          ) as ErrorWithToken;
          error.status = response.status;
          error.statusText = response.statusText;
          if (error.status === 409) {
            error.token = response.headers.get('X-Transmission-Session-Id') || undefined;
            error.code = 'INVALID_TOKEN';
          }
          throw error;
        }

        this.onConnected();

        if (customParser) {
          return response.text().then((text) => customParser(text));
        }
        return response.json() as Promise<TransmissionResponse>;
      }
    ).catch((err: Error) => {
      // Retry only on network/timeout errors (fetch failures), not HTTP or
      // auth errors — and never for methods a duplicate delivery could apply
      // twice, since an aborted request may still have reached the daemon
      if (
        attempt < MAX_RETRIES &&
        isRetryableFetchError(err) &&
        !NON_IDEMPOTENT_METHODS.has(body.method as string)
      ) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        return new Promise<TransmissionResponse>((resolve) =>
          setTimeout(
            () => resolve(this.fetchWithRetry(body, customParser, attempt + 1, timeoutMs)),
            delay
          )
        );
      }
      throw err;
    });
  }

  private retryIfTokenInvalid<T>(callback: () => Promise<T>): Promise<T> {
    return Promise.resolve(callback()).catch((err: ErrorWithToken) => {
      if (err.code === 'INVALID_TOKEN') {
        this.token = err.token || null;
        this.persistToken();
        this.onTokenRefresh?.();
        return callback();
      }
      throw err;
    });
  }

  private sign(fetchOptions: RequestInit): RequestInit {
    const config = this.getConfig();
    if (config.authenticationRequired) {
      if (!fetchOptions.headers) {
        fetchOptions.headers = {};
      }
      (fetchOptions.headers as Record<string, string>).Authorization = toBasicAuthValue(
        config.login,
        config.password
      );
    }
    return fetchOptions;
  }
}

export default TransmissionTransport;
