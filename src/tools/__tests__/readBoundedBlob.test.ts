import { describe, it, expect, vi } from 'vitest';
import readBoundedBlob from '../readBoundedBlob';
import { MAX_FETCH_SIZE } from '../../constants';

/**
 * The cap only means something if it stops the read. response.blob() buffered
 * first and checked afterwards, so a chunked reply with no Content-Length
 * could spend the whole timeout window filling memory before anyone objected.
 */

/** A Response-alike whose body streams `chunkCount` chunks of `chunkSize`. */
function streamingResponse(
  chunkSize: number,
  chunkCount: number,
  onCancel?: () => void
): { response: Response; delivered: () => number } {
  let delivered = 0;
  let index = 0;
  const reader = {
    read: () => {
      if (index >= chunkCount) return Promise.resolve({ done: true, value: undefined });
      index++;
      delivered += chunkSize;
      return Promise.resolve({ done: false, value: new Uint8Array(chunkSize) });
    },
    cancel: () => {
      onCancel?.();
      return Promise.resolve();
    },
    releaseLock: () => {},
  };
  const response = {
    body: { getReader: () => reader },
    headers: new Headers({ 'Content-Type': 'application/x-bittorrent' }),
    blob: () => Promise.resolve(new Blob(['buffered'])),
  } as unknown as Response;
  return { response, delivered: () => delivered };
}

describe('readBoundedBlob', () => {
  it('returns the streamed body, tagged with its content type', async () => {
    const { response } = streamingResponse(1024, 4);
    const blob = await readBoundedBlob(response);
    expect(blob.size).toBe(4096);
    expect(blob.type).toBe('application/x-bittorrent');
  });

  it('aborts as soon as the running total passes the cap', async () => {
    const cancel = vi.fn();
    // A body that would run to 4x the cap if nothing stopped it
    const chunk = 1024 * 1024;
    const { response, delivered } = streamingResponse(chunk, (MAX_FETCH_SIZE / chunk) * 4, cancel);

    await expect(readBoundedBlob(response)).rejects.toMatchObject({
      code: 'FILE_SIZE_EXCEEDED',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    // Stopped near the cap rather than reading the whole hostile body
    expect(delivered()).toBeLessThanOrEqual(MAX_FETCH_SIZE + chunk);
  });

  it('accepts a body that lands exactly on the cap', async () => {
    const { response } = streamingResponse(MAX_FETCH_SIZE, 1);
    const blob = await readBoundedBlob(response);
    expect(blob.size).toBe(MAX_FETCH_SIZE);
  });

  it('falls back to the buffered read when there is no stream', async () => {
    const response = {
      body: null,
      headers: new Headers(),
      blob: () => Promise.resolve(new Blob(['buffered'])),
    } as unknown as Response;
    const blob = await readBoundedBlob(response);
    expect(await blob.text()).toBe('buffered');
  });
});
