import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TransmissionTransport from '../../bg/TransmissionTransport';

describe('TransmissionTransport', () => {
  let transport: TransmissionTransport;
  const onConnected = vi.fn();
  const onTokenRefresh = vi.fn();
  const getConfig = () => ({
    authenticationRequired: false,
    login: '',
    password: '',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    transport = new TransmissionTransport({
      url: 'http://localhost:9091/transmission/rpc',
      getConfig,
      onConnected,
      onTokenRefresh,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with null token', () => {
    expect(transport.token).toBeNull();
  });

  it('caches a refreshed session token in session storage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: { get: () => 'fresh-token' },
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await transport.sendAction({ method: 'session-get' });

    expect(transport.token).toBe('fresh-token');
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      _sessionToken: { url: transport.url, token: 'fresh-token' },
    });
  });

  it('restores a cached session token for the same url', async () => {
    (chrome.storage.session.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sessionToken: { url: 'http://localhost:9091/transmission/rpc', token: 'cached-token' },
    });
    const restored = new TransmissionTransport({
      url: 'http://localhost:9091/transmission/rpc',
      getConfig,
      onConnected,
      onTokenRefresh,
    });
    await vi.waitFor(() => expect(restored.token).toBe('cached-token'));
  });

  it('ignores a cached session token belonging to another url', async () => {
    (chrome.storage.session.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sessionToken: { url: 'http://other-host:9091/transmission/rpc', token: 'stale-token' },
    });
    const restored = new TransmissionTransport({
      url: 'http://localhost:9091/transmission/rpc',
      getConfig,
      onConnected,
      onTokenRefresh,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(restored.token).toBeNull();
  });

  it('sends a successful request', async () => {
    const responseData = { result: 'success', arguments: { torrents: [] } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseData),
      })
    );

    const result = await transport.sendAction({ method: 'torrent-get' });
    expect(result).toEqual(responseData);
    expect(onConnected).toHaveBeenCalled();
  });

  it('sends legacy argument names unchanged even when the daemon is 4.1+ (rpc 18)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success', arguments: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    transport.rpcVersion = 18;
    await transport.sendAction({
      method: 'session-set',
      arguments: { 'speed-limit-down': 100, seedRatioLimit: 2 },
    });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.arguments).toEqual({ 'speed-limit-down': 100, seedRatioLimit: 2 });
  });

  it('throws on non-success result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'no method name', arguments: {} }),
      })
    );

    await expect(transport.sendAction({ method: 'bad' })).rejects.toThrow('no method name');
  });

  it('uses custom parser when provided', async () => {
    const raw = '{"result":"success","arguments":{}}';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(raw),
      })
    );
    const parser = vi.fn().mockReturnValue({ result: 'success', arguments: { custom: true } });

    const result = await transport.sendAction({ method: 'test' }, parser);
    expect(parser).toHaveBeenCalledWith(raw);
    expect(result.arguments).toEqual({ custom: true });
  });

  it('retries on 409 with new token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: { get: () => 'new-token-123' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transport.sendAction({ method: 'torrent-get' });
    expect(result.result).toBe('success');
    expect(transport.token).toBe('new-token-123');
    expect(onTokenRefresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors with exponential backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const promise = transport.sendAction({ method: 'torrent-get' });

    // First retry: 1000ms delay
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry: 2000ms delay
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.result).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-network errors', async () => {
    const httpError = new Error('Server error');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(httpError));

    await expect(transport.sendAction({ method: 'test' })).rejects.toThrow('Server error');
  });

  it('aborts a request that never resolves and retries it with backoff', async () => {
    // Simulates a daemon that accepts the connection but never answers (hung
    // proxy/firewall) -- no TypeError is ever thrown, so only a timeout can
    // unblock this. fetch() here never settles on its own; it only resolves
    // once fetchWithTimeout's AbortController fires the abort signal.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const abortError = new DOMException('The operation was aborted.', 'AbortError');
              reject(abortError);
            });
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const promise = transport.sendAction({ method: 'torrent-get' });

    // FETCH_TIMEOUT (30s) elapses and aborts the hung request.
    await vi.advanceTimersByTimeAsync(30_000);
    // Then the retry backoff (1000ms) fires.
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.result).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a response whose body stalls after the headers arrived', async () => {
    // Headers come back 200 but the body never arrives (proxy died upstream).
    // The timeout must cover the body read, or the RPC hangs forever.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }),
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const promise = transport.sendAction({ method: 'torrent-get' });

    // FETCH_TIMEOUT (30s) elapses mid-body-read, then the retry backoff fires.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.result).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent methods on timeout/network errors', async () => {
    // A timed-out torrent-add may already have reached the daemon; re-sending
    // it could apply the operation twice.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transport.sendAction({ method: 'torrent-add' })).rejects.toThrow(
      'Failed to fetch'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds auth header when authentication is required', async () => {
    const authTransport = new TransmissionTransport({
      url: 'http://localhost:9091/transmission/rpc',
      getConfig: () => ({
        authenticationRequired: true,
        login: 'admin',
        password: 'secret',
      }),
      onConnected,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      })
    );

    await authTransport.sendAction({ method: 'test' });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic ' + btoa('admin:secret'));
  });

  it('sends session token in header', async () => {
    transport.token = 'my-token';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'success', arguments: {} }),
      })
    );

    await transport.sendAction({ method: 'test' });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Transmission-Session-Id']).toBe('my-token');
  });
});
