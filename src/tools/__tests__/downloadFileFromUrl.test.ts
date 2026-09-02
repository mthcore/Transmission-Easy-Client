import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import downloadFileFromUrl from '../downloadFileFromUrl';

/**
 * The background fetch holds host permissions for every origin and is exempt
 * from CORS, so a redirect chain must not be able to walk it onto the local
 * network and hand the result to the configured daemon. isPrivateHost is unit
 * tested on its own; what is checked here is that it is actually wired in, and
 * against the FINAL url rather than the requested one.
 */

const TORRENT = 'd8:announce9:http://a/4:infod6:lengthi1e4:name1:aee';

function respond(finalUrl: string, body = TORRENT) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: finalUrl,
    headers: new Headers({ 'Content-Type': 'application/x-bittorrent' }),
    body: null, // no stream: readBoundedBlob falls back to blob()
    blob: () => Promise.resolve(new Blob([body], { type: 'application/x-bittorrent' })),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadFileFromUrl — redirect guard', () => {
  it('refuses a public link that redirects to loopback', async () => {
    fetchMock.mockResolvedValue(respond('http://127.0.0.1/admin'));
    await expect(downloadFileFromUrl('https://tracker.example/get?id=1')).rejects.toMatchObject({
      code: 'PRIVATE_REDIRECT',
    });
  });

  it('refuses a redirect to the cloud metadata endpoint', async () => {
    fetchMock.mockResolvedValue(respond('http://169.254.169.254/latest/meta-data/'));
    await expect(downloadFileFromUrl('https://tracker.example/get?id=1')).rejects.toMatchObject({
      code: 'PRIVATE_REDIRECT',
    });
  });

  it('refuses an IPv4-mapped IPv6 redirect, which spells the same loopback', async () => {
    fetchMock.mockResolvedValue(respond('http://[::ffff:127.0.0.1]/admin'));
    await expect(downloadFileFromUrl('https://tracker.example/get?id=1')).rejects.toMatchObject({
      code: 'PRIVATE_REDIRECT',
    });
  });

  it('allows a LAN address the user asked for themselves', async () => {
    // Typing a private host is a deliberate act; only a redirect ONTO one is not
    fetchMock.mockResolvedValue(respond('http://192.168.1.10/file.torrent'));
    const { blob } = await downloadFileFromUrl('http://192.168.1.10/file.torrent');
    expect(await blob.text()).toBe(TORRENT);
  });

  it('allows a private host redirecting elsewhere on the local network', async () => {
    // The guard is about CROSSING the boundary: a request the user already
    // aimed at the LAN may move around inside it
    fetchMock.mockResolvedValue(respond('http://10.0.0.5/file.torrent'));
    const { blob } = await downloadFileFromUrl('http://192.168.1.10/file.torrent');
    expect(await blob.text()).toBe(TORRENT);
  });

  it('refuses a public name that resolves onward to a private host', async () => {
    // A public hostname is not a licence to reach the LAN, whatever DNS says
    fetchMock.mockResolvedValue(respond('http://10.0.0.5/file.torrent'));
    await expect(downloadFileFromUrl('http://nas.example.org/file.torrent')).rejects.toMatchObject({
      code: 'PRIVATE_REDIRECT',
    });
  });

  it('allows an ordinary public redirect', async () => {
    fetchMock.mockResolvedValue(respond('https://cdn.example/file.torrent'));
    const { blob } = await downloadFileFromUrl('https://tracker.example/get?id=1');
    expect(await blob.text()).toBe(TORRENT);
  });

  it('rejects a scheme it cannot download before any fetch happens', async () => {
    await expect(downloadFileFromUrl('magnet:?xt=urn:btih:abc')).rejects.toMatchObject({
      code: 'LINK_IS_NOT_SUPPORTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
