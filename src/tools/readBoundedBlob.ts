import ErrorWithCode from './ErrorWithCode';
import { MAX_FETCH_SIZE } from '../constants';

/**
 * Reads a response body, aborting as soon as it exceeds MAX_FETCH_SIZE.
 *
 * response.blob() buffers everything first, so the size check only ran once the
 * memory was already spent: a chunked response with no Content-Length could
 * stream for the whole timeout window and OOM the page or the worker. Streaming
 * lets the cap actually bound what is read.
 */
export default async function readBoundedBlob(response: Response): Promise<Blob> {
  const body = response.body;
  if (!body) {
    // No streams (very old runtimes): fall back to the buffered read, which is
    // still bounded afterwards by the caller's size check
    return response.blob();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_FETCH_SIZE) {
        await reader.cancel();
        throw new ErrorWithCode('File size exceeds the allowed limit', 'FILE_SIZE_EXCEEDED');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  return new Blob(chunks as BlobPart[], {
    type: response.headers.get('Content-Type') ?? '',
  });
}
