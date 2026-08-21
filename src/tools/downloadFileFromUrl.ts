import ErrorWithCode from './ErrorWithCode';
import fetchWithTimeout from './fetchWithTimeout';
import { DOWNLOAD_TIMEOUT, MAX_FETCH_SIZE } from '../constants';

interface DownloadResult {
  blob: Blob;
}

async function downloadFileFromUrl(url: string): Promise<DownloadResult> {
  if (!/^(blob|https?):/.test(url)) {
    throw new ErrorWithCode('Link is not supported', 'LINK_IS_NOT_SUPPORTED');
  }

  // The body is read inside the timeout window so a stalled server can't
  // hang the download after headers are received
  const blob = await fetchWithTimeout(url, undefined, DOWNLOAD_TIMEOUT, (response) => {
    if (!response.ok) {
      throw new ErrorWithCode(`${response.status}: ${response.statusText}`, 'RESPONSE_IS_NOT_OK');
    }

    const contentLength = response.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_SIZE) {
      throw new ErrorWithCode('File size exceeds the allowed limit', 'FILE_SIZE_EXCEEDED');
    }

    return response.blob();
  });
  if (blob.size > MAX_FETCH_SIZE) {
    throw new ErrorWithCode('File size exceeds the allowed limit', 'FILE_SIZE_EXCEEDED');
  }
  return { blob };
}

export default downloadFileFromUrl;
