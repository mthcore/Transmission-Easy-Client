import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TorrentDetailsBandwidthTab, {
  type BandwidthTabValues,
} from '../tabs/TorrentDetailsBandwidthTab';

/**
 * The per-torrent limits were reachable from the daemon protocol but from no
 * page. What matters now that they are on screen is that a limit's value and
 * whether it applies stay independent: the daemon stores them separately, and
 * collapsing them (a single "0 means unlimited" field) would throw away the
 * user's number every time they switched a limit off.
 */

afterEach(cleanup);

const VALUES: BandwidthTabValues = {
  honorsSessionLimits: true,
  downloadLimited: false,
  downloadLimit: 500,
  uploadLimited: true,
  uploadLimit: 120,
  peerLimit: 60,
};

function renderTab(values: Partial<BandwidthTabValues> = {}) {
  const onChange = vi.fn();
  const onApply = vi.fn();
  render(
    <TorrentDetailsBandwidthTab
      detailsLoading={false}
      hasDetails
      values={{ ...VALUES, ...values }}
      onChange={onChange}
      onApply={onApply}
      saving={false}
    />
  );
  return { onChange, onApply };
}

const numberFields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));

describe('TorrentDetailsBandwidthTab', () => {
  it('shows nothing until the details have loaded', () => {
    render(
      <TorrentDetailsBandwidthTab
        detailsLoading
        hasDetails={false}
        values={VALUES}
        onChange={vi.fn()}
        onApply={vi.fn()}
        saving={false}
      />
    );

    expect(numberFields()).toHaveLength(0);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the limit value even while that limit is switched off', () => {
    // downloadLimited is false; the 500 must still be visible and editable.
    renderTab();

    expect(numberFields().map((input) => input.value)).toEqual(['500', '120', '60']);
  });

  it('reports a toggle without touching the value beside it', () => {
    const { onChange } = renderTab();
    const [honors, download] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    );

    fireEvent.click(download);
    expect(onChange).toHaveBeenCalledWith({ downloadLimited: true });

    fireEvent.click(honors);
    expect(onChange).toHaveBeenLastCalledWith({ honorsSessionLimits: false });
  });

  it('reports a typed limit as a number', () => {
    const { onChange } = renderTab();

    fireEvent.change(numberFields()[1], { target: { value: '256' } });

    expect(onChange).toHaveBeenCalledWith({ uploadLimit: 256 });
  });

  it('does not report an emptied field as zero', () => {
    // Number('') === 0, which would read as "no bandwidth at all" once applied.
    const { onChange } = renderTab();

    fireEvent.change(numberFields()[0], { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps a negative limit rather than sending it', () => {
    const { onChange } = renderTab();

    fireEvent.change(numberFields()[0], { target: { value: '-5' } });

    expect(onChange).toHaveBeenCalledWith({ downloadLimit: 0 });
  });

  it('keeps the peer limit above zero', () => {
    // Zero peers would stall the torrent silently; the daemon's own floor is 1.
    const { onChange } = renderTab();

    fireEvent.change(numberFields()[2], { target: { value: '0' } });

    expect(onChange).toHaveBeenCalledWith({ peerLimit: 1 });
  });

  it('applies once, on the button', () => {
    const { onApply, onChange } = renderTab();

    fireEvent.change(numberFields()[0], { target: { value: '900' } });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button'));
    expect(onApply).toHaveBeenCalledTimes(1);
    // The parent owns the value; the tab never applies what it did not report
    expect(onChange).toHaveBeenCalledWith({ downloadLimit: 900 });
  });

  it('disables the button while a save is in flight', () => {
    render(
      <TorrentDetailsBandwidthTab
        detailsLoading={false}
        hasDetails
        values={VALUES}
        onChange={vi.fn()}
        onApply={vi.fn()}
        saving
      />
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
