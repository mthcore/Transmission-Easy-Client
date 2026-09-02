import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const callApi = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/callApi', () => ({ default: callApi }));

const location = vi.hoisted(() => ({ current: { hash: '' } }));
vi.mock('react-router-dom', () => ({ useLocation: () => location.current }));

const configStore = vi.hoisted(() => ({
  ssl: true,
  authenticationRequired: false,
  hostname: 'nas.local',
  port: 9091,
  pathname: '/transmission/rpc',
  webPathname: '',
  login: '',
  password: '',
  setOptions: vi.fn(),
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => ({ config: configStore }) }));

import ClientOptions from '../ClientOptions';

/**
 * The connection form, and the place people paste things.
 *
 * A hostname field gets given whole URLs, host:port pairs and bracketed IPv6
 * literals, and each of those used to be saved as a hostname that could never
 * work: 'http://nas.local:9091' was bracketed as if it were an IPv6 literal
 * into https://[http://nas.local]:9091/, and '[::1]:9091' was re-bracketed into
 * '[[::1]:9091]:9091'. They are normalised into a host, a port and a scheme
 * instead.
 *
 * The port is read as valueAsNumber rather than parsed: '1e3' is legal in a
 * number input and parseInt read it as 1, so the config was saved with port 1
 * before any check could complain.
 */

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  configStore.ssl = true;
  configStore.authenticationRequired = false;
  configStore.setOptions.mockResolvedValue(undefined);
  callApi.mockResolvedValue(undefined);
  location.current = { hash: '' };
});

const draw = () => render(<ClientOptions />);
const at = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;

/** Fill the connection fields and submit; returns what was saved. */
async function submit(fields: Record<string, string | boolean> = {}) {
  draw();
  Object.entries({ hostname: 'nas.local', port: '9091', ...fields }).forEach(([name, value]) => {
    const input = at(name);
    if (!input) return;
    if (typeof value === 'boolean') input.checked = value;
    else fireEvent.change(input, { target: { value } });
  });
  await act(async () => {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  });
  return configStore.setOptions.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

describe('ClientOptions — what people paste into the hostname', () => {
  it('keeps a plain hostname as it is', async () => {
    const saved = await submit({ hostname: 'nas.local', port: '9091' });

    expect(saved).toMatchObject({ hostname: 'nas.local', port: 9091 });
  });

  it('splits a pasted URL into host, port and scheme', async () => {
    // This used to be bracketed like an IPv6 literal into
    // https://[http://nas.local]:9091/, which can never connect.
    const saved = await submit({ hostname: 'http://other.host:8080' });

    expect(saved).toMatchObject({ hostname: 'other.host', port: 8080, ssl: false });
  });

  it('turns SSL on for an https URL', async () => {
    const saved = await submit({ hostname: 'https://secure.host:8443' });

    expect(saved).toMatchObject({ hostname: 'secure.host', port: 8443, ssl: true });
  });

  it('does NOT take a port that is the scheme’s own default', async () => {
    // Pinning current behaviour, not endorsing it. URL.port is empty for a
    // scheme's default port, so an explicitly pasted ':443' is indistinguishable
    // from no port at all and the typed one is kept. Reachable in practice —
    // Transmission behind a reverse proxy on 443 — and worth deciding on
    // separately rather than changing under a coverage pass.
    const saved = await submit({ hostname: 'https://secure.host:443', port: '9091' });

    expect(saved).toMatchObject({ hostname: 'secure.host', port: 9091, ssl: true });
  });

  it('keeps the typed port when the pasted URL carries none', async () => {
    const saved = await submit({ hostname: 'http://other.host', port: '9091' });

    expect(saved).toMatchObject({ hostname: 'other.host', port: 9091 });
  });

  it('splits a host:port pair', async () => {
    const saved = await submit({ hostname: 'other.host:8080' });

    expect(saved).toMatchObject({ hostname: 'other.host', port: 8080 });
  });

  it('splits a bracketed IPv6 literal with a port', async () => {
    // Without this it fell through whole and was re-bracketed into
    // '[[::1]:9091]:9091'.
    const saved = await submit({ hostname: '[::1]:8080' });

    expect(saved).toMatchObject({ hostname: '::1', port: 8080 });
  });

  it('unwraps a bare bracketed IPv6 literal', async () => {
    const saved = await submit({ hostname: '[fe80::1]' });

    expect(saved).toMatchObject({ hostname: 'fe80::1' });
  });

  it('leaves an unbracketed IPv6 literal alone', async () => {
    // Several colons and no numeric suffix: not a host:port pair.
    const saved = await submit({ hostname: 'fe80::1:2:3' });

    expect(saved).toMatchObject({ hostname: 'fe80::1:2:3' });
  });

  it('trims surrounding whitespace', async () => {
    const saved = await submit({ hostname: '  nas.local  ' });

    expect(saved).toMatchObject({ hostname: 'nas.local' });
  });

  it('shows the normalised values back in the form', async () => {
    // The inputs are uncontrolled: after pasting a URL the form went on
    // showing the pasted string, the old port and the old SSL toggle while the
    // config held something else entirely.
    await submit({ hostname: 'http://other.host:8080' });

    expect(at('hostname')!.value).toBe('other.host');
    expect(at('port')!.value).toBe('8080');
    expect(at('ssl')!.checked).toBe(false);
  });
});

describe('ClientOptions — the port', () => {
  it('refuses a port outside the range, without saving', async () => {
    const saved = await submit({ port: '99999' });

    expect(saved).toBeUndefined();
    expect(document.body.textContent).toContain('portIncorrect');
  });

  it('refuses zero', async () => {
    expect(await submit({ port: '0' })).toBeUndefined();
  });

  it('refuses an empty port rather than saving NaN', async () => {
    expect(await submit({ port: '' })).toBeUndefined();
  });

  it('reads exponent notation as the number it is', async () => {
    // '1e3' is legal in a number input, and parseInt read it as 1 — the config
    // was saved with port 1 before any check could complain.
    const saved = await submit({ port: '1e3' });

    expect(saved).toMatchObject({ port: 1000 });
  });

  it('truncates a fractional port rather than sending it', async () => {
    const saved = await submit({ port: '9091.7' });

    expect(saved).toMatchObject({ port: 9091 });
  });
});

describe('ClientOptions — checking the connection', () => {
  it('asks the background directly rather than through the mirror', async () => {
    // A missing mirror used to skip the check silently and show a green OK for
    // a configuration nothing had verified.
    await submit();

    expect(callApi).toHaveBeenCalledWith({ action: 'updateSettings' });
  });

  it('reports a daemon that will not answer', async () => {
    callApi.mockRejectedValueOnce(Object.assign(new Error('Connection refused'), { name: 'Err' }));
    await submit();

    expect(document.body.textContent).toContain('Connection refused');
  });

  it('saves before checking, so a wrong password can be corrected', async () => {
    callApi.mockRejectedValueOnce(new Error('401'));
    const saved = await submit();

    expect(saved).toBeDefined();
  });

  it('carries the credentials it was given', async () => {
    const saved = await submit({ login: 'user', password: 'secret' });

    expect(saved).toMatchObject({ login: 'user', password: 'secret' });
  });
});

describe('ClientOptions — where it goes afterwards', () => {
  it('stays put by default', async () => {
    await submit();

    expect(document.body.textContent).not.toBe('');
  });

  it('returns to the page that sent the user here', async () => {
    // The popup sends people to the options with a hash so a first successful
    // save lands them back where they started.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        get href() {
          return '';
        },
        set href(v: string) {
          assign(v);
        },
        hash: '',
      },
      configurable: true,
    });
    location.current = { hash: '#redirect' };
    await submit();

    expect(assign).toHaveBeenCalledWith('/index.html');
  });
});
