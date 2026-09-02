import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../tools/showError', () => ({ default: showError }));

vi.mock('../SpaceWatcher', () => ({ default: () => <div data-testid="space" /> }));
vi.mock('../menu/SpeedMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const store = vi.hoisted(() => ({
  isPopup: false,
  config: undefined as unknown,
  client: undefined as unknown,
}));
vi.mock('../../hooks/useRootStore', () => ({ default: () => store }));

import Footer from '../Footer';

/**
 * The status bar shows the current speed and, beside it, the limit in force —
 * and that badge is a button: clicking it lifts the limit. Which limit it
 * lifts depends on whether alternative speed is on, the same fork the speed
 * menu has, and getting it wrong lifts a limit the user cannot currently feel
 * while leaving the one they can.
 *
 * The badge is also the only sign that a limit exists at all, so it has to
 * appear exactly when one is in force and show the value that is actually
 * applying.
 */

afterEach(cleanup);

const SETTINGS = {
  altSpeedEnabled: false,
  downloadSpeedLimitEnabled: false,
  uploadSpeedLimitEnabled: false,
  downloadSpeedLimitStr: '100 kB/s',
  uploadSpeedLimitStr: '50 kB/s',
  altDownloadSpeedLimitStr: '10 kB/s',
  altUploadSpeedLimitStr: '5 kB/s',
};

let client: Record<string, unknown>;

function makeClient(settings: Record<string, unknown> | undefined = { ...SETTINGS }) {
  return {
    settings,
    currentSpeedStr: { downloadSpeedStr: '1.2 MB/s', uploadSpeedStr: '300 kB/s' },
    sessionTotalsStr: { downloadedStr: '4 GB', uploadedStr: '2 GB' },
    torrentCountsStr: '3 / 12',
    lastErrorMessage: '',
    setAltSpeedEnabled: vi.fn().mockResolvedValue(undefined),
    setDownloadSpeedLimitEnabled: vi.fn().mockResolvedValue(undefined),
    setUploadSpeedLimitEnabled: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  showError.mockClear();
  client = makeClient();
  store.client = client;
  store.config = { showFreeSpace: false };
  store.isPopup = false;
});

const draw = () => render(<Footer />);
const badge = (which: 'dl' | 'up') => document.querySelector(`.limit.${which}`);

describe('Footer — what it shows', () => {
  it('shows the current speeds', () => {
    draw();

    expect(screen.getByText('1.2 MB/s')).toBeInTheDocument();
    expect(screen.getByText('300 kB/s')).toBeInTheDocument();
  });

  it('shows the session totals and the torrent counts', () => {
    draw();

    expect(screen.getByText('4 GB')).toBeInTheDocument();
    expect(screen.getByText('2 GB')).toBeInTheDocument();
    expect(screen.getByText('3 / 12')).toBeInTheDocument();
  });

  it('shows the last error where a screen reader will announce it', () => {
    client.lastErrorMessage = 'Connection refused';
    draw();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connection refused');
    expect(status).toHaveAttribute('aria-live', 'assertive');
  });

  it('shows no error area while nothing is wrong', () => {
    draw();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers to open a tab only from the popup', () => {
    draw();
    expect(document.querySelector('.openInTab')).toBeNull();

    cleanup();
    store.isPopup = true;
    draw();
    expect(document.querySelector('.openInTab')).not.toBeNull();
  });

  it('shows the free space only when that is switched on', () => {
    draw();
    expect(screen.queryByTestId('space')).not.toBeInTheDocument();

    cleanup();
    store.config = { showFreeSpace: true };
    draw();
    expect(screen.getByTestId('space')).toBeInTheDocument();
  });

  it('renders nothing before the client and config exist', () => {
    store.client = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });

  it('survives a daemon that reported no speeds yet', () => {
    // currentSpeedStr and sessionTotalsStr are computed from settings that may
    // not have landed; a missing one must not blank the whole bar.
    client.currentSpeedStr = undefined;
    client.sessionTotalsStr = undefined;
    draw();

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

describe('Footer — the limit badge', () => {
  it('is absent while no limit is in force', () => {
    draw();

    expect(badge('dl')).toBeNull();
    expect(badge('up')).toBeNull();
  });

  it('appears for the direction that is limited, and only that one', () => {
    client.settings = { ...SETTINGS, downloadSpeedLimitEnabled: true };
    draw();

    expect(badge('dl')).toHaveTextContent('100 kB/s');
    expect(badge('up')).toBeNull();
  });

  it('appears for both directions while alternative speed is on', () => {
    // Alt-speed is one switch that limits both, whatever the per-direction
    // flags say.
    client.settings = { ...SETTINGS, altSpeedEnabled: true };
    draw();

    expect(badge('dl')).toHaveTextContent('10 kB/s');
    expect(badge('up')).toHaveTextContent('5 kB/s');
  });

  it('shows the alternative value, not the normal one, while alt-speed is on', () => {
    // Showing the normal limit here reads as a limit that is not applying.
    client.settings = { ...SETTINGS, altSpeedEnabled: true, downloadSpeedLimitEnabled: true };
    draw();

    expect(badge('dl')).toHaveTextContent('10 kB/s');
    expect(badge('dl')).not.toHaveTextContent('100 kB/s');
  });

  it('shows nothing at all before the settings arrive', () => {
    client.settings = undefined;
    draw();

    expect(badge('dl')).toBeNull();
    expect(badge('up')).toBeNull();
  });
});

describe('Footer — clicking the badge lifts the limit', () => {
  it('lifts the normal download limit', () => {
    client.settings = { ...SETTINGS, downloadSpeedLimitEnabled: true };
    draw();
    fireEvent.click(badge('dl')!);

    expect(client.setDownloadSpeedLimitEnabled).toHaveBeenCalledWith(false);
    expect(client.setAltSpeedEnabled).not.toHaveBeenCalled();
  });

  it('lifts the normal upload limit, not the download one', () => {
    client.settings = { ...SETTINGS, uploadSpeedLimitEnabled: true };
    draw();
    fireEvent.click(badge('up')!);

    expect(client.setUploadSpeedLimitEnabled).toHaveBeenCalledWith(false);
    expect(client.setDownloadSpeedLimitEnabled).not.toHaveBeenCalled();
  });

  it('turns off ALTERNATIVE speed while that is what is limiting', () => {
    // Lifting the normal limit here would change nothing the user can feel.
    client.settings = { ...SETTINGS, altSpeedEnabled: true, downloadSpeedLimitEnabled: true };
    draw();
    fireEvent.click(badge('dl')!);

    expect(client.setAltSpeedEnabled).toHaveBeenCalledWith(false);
    expect(client.setDownloadSpeedLimitEnabled).not.toHaveBeenCalled();
  });

  it('turns off alternative speed from the upload badge too', () => {
    client.settings = { ...SETTINGS, altSpeedEnabled: true };
    draw();
    fireEvent.click(badge('up')!);

    expect(client.setAltSpeedEnabled).toHaveBeenCalledWith(false);
    expect(client.setUploadSpeedLimitEnabled).not.toHaveBeenCalled();
  });

  it('reports a refusal instead of leaving the badge in place in silence', async () => {
    // Fire and forget: without a guard the limit stays, the badge stays, and
    // nothing says the click did not work.
    client.settings = { ...SETTINGS, downloadSpeedLimitEnabled: true };
    (client.setDownloadSpeedLimitEnabled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('daemon said 500')
    );
    draw();
    await act(async () => {
      fireEvent.click(badge('dl')!);
    });

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
