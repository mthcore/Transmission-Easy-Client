import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const configStore = vi.hoisted(() => ({
  showDownloadCompleteNotifications: false,
  showActiveCountBadge: true,
  badgeColor: '20,30,40,0.4',
  backgroundUpdateInterval: 60000,
  setOptions: vi.fn(),
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => ({ config: configStore }) }));

// The picker itself is a third-party control; what matters is which colour
// reaches the config and when.
vi.mock('react-colorful', () => ({
  RgbColorPicker: ({ onChange }: { onChange: (c: Record<string, number>) => void }) => (
    <button data-testid="pick" onClick={() => onChange({ r: 1, g: 2, b: 3 })} />
  ),
}));
vi.mock('react-tiny-popover', () => ({
  Popover: ({
    isOpen,
    content,
    children,
  }: {
    isOpen: boolean;
    content: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {children}
      {isOpen ? content : null}
    </>
  ),
}));

import NotifyOptions from '../NotifyOptions';

/**
 * The badge colour is stored as "r,g,b,alpha" but the picker only edits RGB,
 * so the alpha has to survive a round trip through it. Two things went wrong
 * there: closing the picker without touching anything committed anyway, which
 * rewrote the default's 0.40 alpha to 1 and made the badge opaque; and the
 * alpha had to be read back rather than assumed.
 */

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  configStore.badgeColor = '20,30,40,0.4';
  configStore.backgroundUpdateInterval = 60000;
});

const draw = () => render(<NotifyOptions />);
const swatch = () => document.querySelector('.selectColor') as HTMLElement;
const picker = () => screen.queryByTestId('pick');

describe('NotifyOptions — the badge colour', () => {
  it('shows the stored colour', () => {
    draw();

    expect(swatch().style.backgroundColor).toBe('rgb(20, 30, 40)');
  });

  it('opens the picker on the swatch', () => {
    draw();
    fireEvent.click(swatch());

    expect(picker()).toBeInTheDocument();
  });

  it('writes nothing when the picker is closed untouched', () => {
    // This is what rewrote the default's 0.40 alpha to 1 and made every badge
    // opaque for anyone who merely looked at the picker.
    draw();
    fireEvent.click(swatch());
    fireEvent.click(swatch());

    expect(configStore.setOptions).not.toHaveBeenCalled();
  });

  it('writes the chosen colour once the picker closes', () => {
    // Not on every drag of the picker: that is one config broadcast per pixel.
    draw();
    fireEvent.click(swatch());
    fireEvent.click(picker()!);
    expect(configStore.setOptions).not.toHaveBeenCalled();

    fireEvent.click(swatch());
    expect(configStore.setOptions).toHaveBeenCalledWith({ badgeColor: '1,2,3,0.4' });
  });

  it('keeps the configured alpha, which the picker cannot edit', () => {
    configStore.badgeColor = '9,9,9,0.75';
    draw();
    fireEvent.click(swatch());
    fireEvent.click(picker()!);
    fireEvent.click(swatch());

    expect(configStore.setOptions).toHaveBeenCalledWith({ badgeColor: '1,2,3,0.75' });
  });

  it('falls back to opaque when the stored colour carries no alpha', () => {
    configStore.badgeColor = '9,9,9';
    draw();
    fireEvent.click(swatch());
    fireEvent.click(picker()!);
    fireEvent.click(swatch());

    expect(configStore.setOptions).toHaveBeenCalledWith({ badgeColor: '1,2,3,1' });
  });

  it('reads a malformed colour as black rather than as NaN', () => {
    configStore.badgeColor = 'not,a,colour,x';
    draw();

    expect(swatch().style.backgroundColor).toBe('rgb(0, 0, 0)');
  });

  it('forgets an untouched change from a previous opening', () => {
    // Reopening resets the "touched" flag, so a colour dragged and then
    // abandoned does not commit the next time the picker is merely opened.
    draw();
    fireEvent.click(swatch());
    fireEvent.click(picker()!);
    fireEvent.click(swatch());
    configStore.setOptions.mockClear();

    fireEvent.click(swatch());
    fireEvent.click(swatch());

    expect(configStore.setOptions).not.toHaveBeenCalled();
  });
});

describe('NotifyOptions — the toggles', () => {
  it('persists the completion notification setting', () => {
    draw();
    fireEvent.click(
      screen
        .getByText('showNotificationOnDownloadComplete')
        .closest('label')!
        .querySelector('input[type="checkbox"]')!
    );

    expect(configStore.setOptions).toHaveBeenCalledWith({
      showDownloadCompleteNotifications: true,
    });
  });

  it('persists the badge setting', () => {
    draw();
    fireEvent.click(
      screen
        .getByText('displayActiveTorrentCountIcon')
        .closest('label')!
        .querySelector('input[type="checkbox"]')!
    );

    expect(configStore.setOptions).toHaveBeenCalledWith({ showActiveCountBadge: false });
  });
});

describe('NotifyOptions — the background interval', () => {
  it('offers no value the platform cannot deliver', () => {
    // MV3 alarms floor at one minute: offering 1000ms promised a granularity
    // that does not exist, and every value from 1000 to 59999 silently behaved
    // as 60000.
    draw();
    const field = document.querySelector('input[type="number"]') as HTMLInputElement;

    expect(field.min).toBe('60000');
    expect(field.step).toBe('60000');
  });

  it('shows the stored interval', () => {
    configStore.backgroundUpdateInterval = 120000;
    draw();
    const field = document.querySelector('input[type="number"]') as HTMLInputElement;

    expect(field.value).toBe('120000');
  });
});
