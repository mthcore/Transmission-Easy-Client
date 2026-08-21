import ErrorWithCode from './ErrorWithCode';
import { FETCH_TIMEOUT } from '../constants';

/**
 * fetch() with a hard deadline. fetch() resolves at headers-received, so a
 * server that stalls mid-body would hang a later response.json()/text()/blob()
 * forever — pass `readBody` to consume the body while the abort timer is
 * still armed, making the timeout span the whole exchange.
 */
async function fetchWithTimeout<T = Response>(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT,
  readBody?: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    if (!readBody) {
      return response as unknown as T;
    }
    return await readBody(response);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ErrorWithCode(`Request timed out after ${timeoutMs}ms`, 'FETCH_TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default fetchWithTimeout;
