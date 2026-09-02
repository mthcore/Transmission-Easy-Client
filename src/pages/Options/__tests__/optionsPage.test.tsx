import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

// The page mounts itself on import; the element it renders is captured and
// driven from here, since the component is not exported.
const mounted = vi.hoisted(() => ({ element: null as React.ReactElement | null }));
vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (element: React.ReactElement) => {
      mounted.element = element;
    },
    unmount: () => undefined,
  }),
}));

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../stores/RootStore', () => ({ default: { create: () => store.current } }));

vi.mock('../../../tools/applyStoredTheme', () => ({
  default: () => undefined,
  applyLocaleDirection: () => undefined,
}));

// Each pane is covered on its own; what is under test here is which one the
// navigation reaches.
vi.mock('../ClientOptions', () => ({ default: () => <div data-testid="pane">client</div> }));
vi.mock('../UiOptions', () => ({ default: () => <div data-testid="pane">main</div> }));
vi.mock('../NotifyOptions', () => ({ default: () => <div data-testid="pane">notify</div> }));
vi.mock('../CtxOptions', () => ({ default: () => <div data-testid="pane">ctx</div> }));
vi.mock('../ServerOptions', () => ({ default: () => <div data-testid="pane">server</div> }));
vi.mock('../BackupRestoreOptions', () => ({ default: () => <div data-testid="pane">backup</div> }));

/**
 * The options page shell: what it shows before the config has loaded, and where
 * its navigation goes.
 *
 * Both of the pre-ready states used to dead-end on a raw state string. 'idle'
 * is the first paint before init has even started, and it flashed the
 * untranslated "Loading: idle" on every open; and a failed startup showed the
 * literal 'Loading: error' with nothing to press — on the very page a user with
 * a broken setup needs most.
 */

afterEach(cleanup);

async function draw(overrides: Record<string, unknown> = {}, hash = '') {
  store.current = {
    state: 'done',
    isPopup: false,
    config: { theme: 'system' },
    init: vi.fn().mockResolvedValue(undefined),
    retryInit: vi.fn(),
    ...overrides,
  };
  mounted.element = null;
  document.body.innerHTML = '<div id="root"></div>';
  window.location.hash = hash;
  vi.resetModules();
  await import('../index');
  await act(async () => {
    render(mounted.element as React.ReactElement);
  });
  return store.current;
}

const pane = () => screen.queryByTestId('pane')?.textContent;

describe('options page — before the config is ready', () => {
  it('shows a spinner on the very first paint', async () => {
    // 'idle' is before init has even started; the raw state string flashed
    // "Loading: idle" on every open.
    await draw({ state: 'idle' });

    expect(document.querySelector('.loading')).not.toBeNull();
    expect(document.body.textContent).not.toContain('idle');
  });

  it('shows a spinner while it is loading', async () => {
    await draw({ state: 'pending' });

    expect(document.querySelector('.loading')).not.toBeNull();
  });

  it('offers a retry when the startup failed', async () => {
    // This is the page a user with a broken setup needs most, and it used to
    // dead-end on the literal 'Loading: error'.
    const root = await draw({ state: 'error' });
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(root.retryInit).toHaveBeenCalled();
  });

  it('says nothing raw about its own state', async () => {
    // The literal the bug produced. Asserting on the bare word would match the
    // i18n keys themselves ('OV_FL_ERROR', 'errorRetry') and prove nothing.
    await draw({ state: 'error' });

    expect(document.body.textContent).not.toContain('Loading:');
  });

  it('starts the store on mount', async () => {
    const root = await draw();

    expect(root.init).toHaveBeenCalled();
  });
});

describe('options page — the navigation', () => {
  it('opens on the connection pane', async () => {
    // The first thing a new install needs is a server to talk to.
    await draw();

    expect(pane()).toBe('client');
  });

  it.each([
    ['optMain', 'main'],
    ['optNotify', 'notify'],
    ['optCtx', 'ctx'],
    ['optServer', 'server'],
    ['backupRestore', 'backup'],
  ])('%s reaches its own pane', async (label, expected) => {
    await draw();
    await act(async () => {
      fireEvent.click(screen.getByText(label));
    });

    expect(pane()).toBe(expected);
  });

  it('marks the pane the user is on', async () => {
    await draw();
    await act(async () => {
      fireEvent.click(screen.getByText('optNotify'));
    });

    expect(screen.getByText('optNotify').className).toContain('active');
    expect(screen.getByText('optCtx').className).not.toContain('active');
  });

  it('sends an unknown route back to the connection pane', async () => {
    // A hash left over from an older build must not leave the page blank. The
    // hash goes through draw(), which sets it after clearing: setting it
    // beforehand was overwritten and the case never reached the route at all.
    await draw({}, '#/somethingRemoved');

    expect(pane()).toBe('client');
  });
});
