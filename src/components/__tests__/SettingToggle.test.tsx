import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SettingToggle from '../SettingToggle';

/**
 * The labelled switch every options pane uses. It was written out thirty-odd
 * times, so the shape of a toggle lived in six files at once.
 *
 * The reason it takes the input's props through rather than modelling them is
 * that the panes use two idioms and the difference is real. A daemon setting is
 * controlled, because it changes from outside the page — another client, a
 * scheduled alt-speed window — and the switch has to follow. A local setting is
 * uncontrolled with a `name`, because only this page writes it and the shared
 * handler reads the name to know which one changed. Both are exercised here,
 * because a component that quietly dropped either would look right in review
 * and be wrong on screen.
 */

afterEach(cleanup);

const input = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;

describe('SettingToggle', () => {
  it('translates its label through the locale', () => {
    render(<SettingToggle label="startAddedTorrents" checked={false} onChange={vi.fn()} />);

    expect(screen.getByText('startAddedTorrents')).toBeInTheDocument();
  });

  it('is a checkbox, whatever else it is given', () => {
    // The type is the component's, not the caller's: a pane that passed a
    // different one would render a text field wearing a switch.
    render(<SettingToggle label="x" checked onChange={vi.fn()} />);

    expect(input().type).toBe('checkbox');
  });

  it('draws the switch itself, so the panes do not each spell it out', () => {
    render(<SettingToggle label="x" checked onChange={vi.fn()} />);

    expect(document.querySelector('.toggle-switch')).not.toBeNull();
    expect(document.querySelector('.toggle-slider')).not.toBeNull();
  });

  it('wraps label and control together, so clicking the text toggles it', () => {
    const onChange = vi.fn();
    render(<SettingToggle label="startAddedTorrents" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByText('startAddedTorrents'));

    expect(onChange).toHaveBeenCalled();
  });
});

describe('SettingToggle — a daemon setting, controlled', () => {
  it('shows the state it is given', () => {
    render(<SettingToggle label="x" checked onChange={vi.fn()} />);

    expect(input().checked).toBe(true);
  });

  it('follows a change made elsewhere', () => {
    // Another client, or a scheduled alt-speed window: the switch reflects the
    // daemon rather than what was last clicked here.
    const { rerender } = render(<SettingToggle label="x" checked={false} onChange={vi.fn()} />);
    rerender(<SettingToggle label="x" checked onChange={vi.fn()} />);

    expect(input().checked).toBe(true);
  });

  it('reports the click rather than deciding the next state', () => {
    // The pane latches the pending value: a quick off-then-on double click read
    // the same stale render-time value twice and sent the same state twice.
    const onChange = vi.fn();
    render(<SettingToggle label="x" checked onChange={onChange} />);

    fireEvent.click(input());

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('SettingToggle — a local setting, uncontrolled', () => {
  it('starts from the stored value without owning it afterwards', () => {
    render(
      <SettingToggle label="showFreeSpace" name="showFreeSpace" defaultChecked onChange={vi.fn()} />
    );

    expect(input().checked).toBe(true);
  });

  it('carries the name the shared handler reads', () => {
    // useOptionsPage's handleChange persists `{ [name]: checked }`; without the
    // name it would write an undefined key.
    render(<SettingToggle label="x" name="showFreeSpace" defaultChecked onChange={vi.fn()} />);

    expect(input().name).toBe('showFreeSpace');
  });

  it('lets the browser hold the state, as an uncontrolled input does', () => {
    render(<SettingToggle label="x" name="y" defaultChecked={false} onChange={vi.fn()} />);

    fireEvent.click(input());

    expect(input().checked).toBe(true);
  });
});

describe('SettingToggle — everything else the panes pass', () => {
  it('can be disabled while a save is in flight', () => {
    render(<SettingToggle label="x" checked disabled onChange={vi.fn()} />);

    expect(input().disabled).toBe(true);
  });

  it('takes an aria-label where the visible one is not enough', () => {
    // The bandwidth group rows repeat the same label per group, so each needs
    // its own accessible name.
    render(<SettingToggle label="x" checked aria-label="seedbox download" onChange={vi.fn()} />);

    expect(input().getAttribute('aria-label')).toBe('seedbox download');
  });
});
