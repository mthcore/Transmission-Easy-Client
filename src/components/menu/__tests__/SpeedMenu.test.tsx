import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/showError', () => ({ default: showError }));

const client = vi.hoisted(() => ({
  settings: undefined as unknown,
  setAltSpeedEnabled: vi.fn().mockResolvedValue(undefined),
  setDownloadSpeedLimitEnabled: vi.fn().mockResolvedValue(undefined),
  setUploadSpeedLimitEnabled: vi.fn().mockResolvedValue(undefined),
  setDownloadSpeedLimit: vi.fn().mockResolvedValue(undefined),
  setUploadSpeedLimit: vi.fn().mockResolvedValue(undefined),
  setAltDownloadSpeedLimit: vi.fn().mockResolvedValue(undefined),
  setAltUploadSpeedLimit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => ({ client }) }));

import SpeedContextMenu from '../SpeedMenu';

/**
 * The speed menu decides, per click, which of six setters to call: download or
 * upload, normal or alternative. Nothing covered that fork, and getting it
 * wrong is invisible — the menu still closes, nothing reports an error, and the
 * limit the user meant to change is simply somewhere else.
 *
 * The ladder is seeded from the configured limit, and a limit of 0 has to fall
 * back to a default: seeded from 0 it still produces ten entries, but a useless
 * 1..10 kB/s ladder rather than a usable one. That is why the cases below
 * assert the VALUES, not the count — the count is identical either way.
 */

afterEach(cleanup);

const SETTINGS = {
  altSpeedEnabled: false,
  downloadSpeedLimit: 100,
  uploadSpeedLimit: 50,
  altDownloadSpeedLimit: 10,
  altUploadSpeedLimit: 5,
  downloadSpeedLimitEnabled: true,
  uploadSpeedLimitEnabled: true,
};

const setters = () =>
  Object.entries(client).filter(([, value]) => typeof value === 'function') as [
    string,
    ReturnType<typeof vi.fn>,
  ][];

beforeEach(() => {
  setters().forEach(([, fn]) => fn.mockClear());
  showError.mockClear();
  client.settings = { ...SETTINGS };
});

function open(type: 'download' | 'upload') {
  render(
    <SpeedContextMenu type={type}>
      <span data-testid="trigger">speed</span>
    </SpeedContextMenu>
  );
  fireEvent.contextMenu(screen.getByTestId('trigger'));
}

/** Menu entries other than "Unlimited" — i.e. the speed ladder. */
const ladder = () =>
  screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '')
    .filter((text) => text !== 'MENU_UNLIMITED');

/** Which setter ran, so a mis-routed click names itself in the failure. */
const called = () =>
  setters()
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name, fn]) => name + '(' + fn.mock.calls[0].join(', ') + ')');

const unlimitedItem = () => screen.getByText('MENU_UNLIMITED').closest('[role="menuitem"]');

describe('SpeedMenu — which setter a click reaches', () => {
  it('turns off the download limit', () => {
    open('download');
    fireEvent.click(screen.getByText('MENU_UNLIMITED'));

    expect(called()).toEqual(['setDownloadSpeedLimitEnabled(false)']);
  });

  it('turns off the upload limit, not the download one', () => {
    open('upload');
    fireEvent.click(screen.getByText('MENU_UNLIMITED'));

    expect(called()).toEqual(['setUploadSpeedLimitEnabled(false)']);
  });

  it('turns off ALTERNATIVE speed while it is active, whatever the direction', () => {
    // Alt-speed is one global toggle: with it on, "unlimited" has to lift the
    // alt limit rather than a normal one the user cannot currently feel.
    client.settings = { ...SETTINGS, altSpeedEnabled: true };
    open('download');
    fireEvent.click(screen.getByText('MENU_UNLIMITED'));

    expect(called()).toEqual(['setAltSpeedEnabled(false)']);
  });

  it('writes a chosen speed to the normal download limit', () => {
    open('download');
    fireEvent.click(screen.getAllByRole('menuitem')[1]);

    expect(called()).toEqual([expect.stringMatching(/^setDownloadSpeedLimit\(\d+\)$/)]);
  });

  it('writes a chosen speed to the ALTERNATIVE limit while alt-speed is active', () => {
    client.settings = { ...SETTINGS, altSpeedEnabled: true };
    open('upload');
    fireEvent.click(screen.getAllByRole('menuitem')[1]);

    expect(called()).toEqual([expect.stringMatching(/^setAltUploadSpeedLimit\(\d+\)$/)]);
  });
});

describe('SpeedMenu — the speed ladder', () => {
  it('never offers a limit of zero, whatever the configured limit', () => {
    // 0 is not "unlimited" to the daemon: it is a zero-byte limit that stalls
    // every transfer.
    //
    // Note what this does NOT prove. The filter in the source cannot currently
    // fire: the ladder is seeded with max(limit, count/2), so its first entry
    // is round(seed / (count/2)) >= 1 for every limit. Checked over 0..5000,
    // no zero is producible at SPEED_ARRAY_COUNT = 10. So this pins the
    // invariant — every offered speed is a real speed — rather than the guard,
    // and it is the formula changing that would make it fail.
    for (const downloadSpeedLimit of [0, 1, 2, 9, 100, 5000]) {
      cleanup();
      client.settings = { ...SETTINGS, downloadSpeedLimit };
      open('download');
      const speeds = ladder();
      expect(speeds.length, `limit ${downloadSpeedLimit}`).toBe(10);
      expect(speeds.some((text) => /(^|\s)0(\s|$)/.test(text))).toBe(false);
    }
  });

  it('builds the ladder from the default when no limit is configured', () => {
    // Asserting the COUNT here proves nothing: seeded from 0 the ladder is
    // still ten entries, just a useless 1..10 kB/s one. The values are what
    // says the default was applied.
    client.settings = { ...SETTINGS, downloadSpeedLimit: 0 };
    open('download');

    const speeds = ladder().join(' ');
    expect(speeds).toContain('512');
    expect(speeds).toContain('1');
    expect(ladder()[0]).not.toMatch(/(^|\s)1(\s|$)/);
  });

  it('offers the configured limit itself, so the current value stays reachable', () => {
    open('download');

    expect(ladder().join(' ')).toContain('100');
  });

  it('marks the limit in force, and marks exactly one entry', () => {
    open('download');
    const marked = screen.getAllByRole('menuitem').filter((i) => i.textContent?.includes('●'));

    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).not.toBe('MENU_UNLIMITED');
  });

  it('marks Unlimited instead when no limit is in force', () => {
    client.settings = { ...SETTINGS, downloadSpeedLimitEnabled: false };
    open('download');

    expect(unlimitedItem()?.textContent).toContain('●');
  });
});

describe('SpeedMenu — before the settings arrive', () => {
  it('offers only Unlimited, with no ladder built from absent values', () => {
    client.settings = undefined;
    open('download');

    expect(ladder()).toEqual([]);
    expect(screen.getByText('MENU_UNLIMITED')).toBeInTheDocument();
  });

  it('does not claim "no limit" about a daemon it has not heard from', () => {
    client.settings = undefined;
    open('download');

    expect(unlimitedItem()?.textContent).not.toContain('●');
  });
});

describe('SpeedMenu — when the daemon refuses', () => {
  it('tells the user instead of failing silently', async () => {
    // These RPCs are fire-and-forget; before reportAction the menu just closed
    // and the limit never changed.
    client.setDownloadSpeedLimitEnabled.mockRejectedValueOnce(new Error('daemon said 500'));
    open('download');
    fireEvent.click(screen.getByText('MENU_UNLIMITED'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
