import ErrorWithCode from './ErrorWithCode';
import fetchWithTimeout from './fetchWithTimeout';
import isPrivateHost from './isPrivateHost';
import readBoundedBlob from './readBoundedBlob';
import { DOWNLOAD_TIMEOUT, MAX_FETCH_SIZE } from '../constants';

interface DownloadResult {
  blob: Blob;
}

/**
 * True when the response came from a private address the original URL did not
 * already point at. A user typing a LAN address themselves stays allowed; a
 * public link redirecting there does not.
 */
function isRedirectedToPrivateHost(requestedUrl: string, finalUrl: string): boolean {
  if (!finalUrl) return false;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    if (requested.host === final.host) return false;
    return isPrivateHost(final.hostname) && !isPrivateHost(requested.hostname);
  } catch {
    return false;
  }
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

    // response.url is the FINAL url: a redirect chain must not be able to walk
    // this privileged, CORS-exempt fetch onto the local network. Only the final
    // hop is visible — fetch follows redirects itself — so a chain that touches
    // a private address and bounces back out is still REQUESTED, just never
    // read. Refusing that too would mean redirect: 'manual' and following the
    // chain by hand.
    if (isRedirectedToPrivateHost(url, response.url)) {
      throw new ErrorWithCode(
        'Refusing to follow a redirect to a private address',
        'PRIVATE_REDIRECT'
      );
    }

    const contentLength = response.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_SIZE) {
      throw new ErrorWithCode('File size exceeds the allowed limit', 'FILE_SIZE_EXCEEDED');
    }

    return readBoundedBlob(response);
  });
  if (blob.size > MAX_FETCH_SIZE) {
    throw new ErrorWithCode('File size exceeds the allowed limit', 'FILE_SIZE_EXCEEDED');
  }
  return { blob };
}

export default downloadFileFromUrl;
