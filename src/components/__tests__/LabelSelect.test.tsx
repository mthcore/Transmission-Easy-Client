import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { observable, runInAction } from 'mobx';

const store = vi.hoisted(() => ({
  config: undefined as unknown,
  torrentList: { filters: [] as { label: string; custom: boolean }[] },
}));
vi.mock('../../hooks/useRootStore', () => ({ default: () => store }));

import LabelSelect from '../LabelSelect';

/**
 * The label filter has one hard problem: the list of choices is rebuilt from
 * the labels present on the CURRENT torrents, while the selection itself is
 * persisted. So the selected label can stop existing.
 *
 * When it did, the list filtered down to nothing and the dropdown rendered
 * blank — the user could see neither what was filtering nor how to stop it.
 * The selection is therefore added back as an entry of its own whenever the
 * rebuilt list has lost it. Matching has to consider the `custom` flag as well
 * as the text: a persisted built-in from another build, matched on text alone,
 * left the control with no value and it fell back to uncontrolled and blank —
 * exactly the symptom this exists to prevent.
 */

afterEach(cleanup);

const label = (text: string, custom = false) => ({ label: text, custom });

function config(selected: { label: string; custom: boolean }) {
  return {
    selectedLabel: { ...selected, id: JSON.stringify(selected) },
    setSelectedLabel: vi.fn(),
  };
}

beforeEach(() => {
  store.config = config(label('ALL', true));
  store.torrentList = { filters: [label('ALL', true), label('DL', true), label('tv')] };
});

const draw = () => render(<LabelSelect />);

/** What the closed control currently displays. */
const shown = () => document.querySelector('.rc-select-selection-item')?.textContent ?? '';

/** Open the dropdown and read the entries it offers. */
function openOptions() {
  fireEvent.mouseDown(document.querySelector('.rc-select-selector') as HTMLElement);
  return Array.from(document.querySelectorAll('.rc-select-item-option-content')).map(
    (el) => el.textContent ?? ''
  );
}

describe('LabelSelect — a selection that no longer exists', () => {
  it('keeps the vanished label visible, so the filter can be seen', () => {
    // The last torrent carrying it was removed; without this the list is
    // filtered by something the user cannot see.
    store.config = config(label('tv'));
    store.torrentList = { filters: [label('ALL', true)] };
    draw();

    expect(shown()).toBe('tv');
  });

  it('offers it as an entry, so the filter can be left', () => {
    store.config = config(label('tv'));
    store.torrentList = { filters: [label('ALL', true)] };
    draw();

    expect(openOptions()).toContain('tv');
  });

  it('does not add it twice when it is still there', () => {
    store.config = config(label('tv'));
    draw();

    expect(openOptions().filter((text) => text === 'tv')).toHaveLength(1);
  });

  it('keeps a built-in that the current build no longer offers', () => {
    // A persisted selection from another build, or one dropped from the
    // built-in list: the control had no value and went blank.
    store.config = config(label('ARCHIVED', true));
    draw();

    expect(shown()).not.toBe('');
  });

  it('tells a user label apart from a built-in with the same text', () => {
    // Matching on text alone treats a user label called DL as the built-in
    // one, so the real selection is never added back.
    store.config = config(label('DL', false));
    store.torrentList = { filters: [label('DL', true)] };
    draw();

    expect(openOptions()).toHaveLength(2);
  });
});

describe('LabelSelect — what it displays', () => {
  it('shows a user label by its own text', () => {
    store.config = config(label('tv'));
    draw();

    expect(shown()).toBe('tv');
  });

  it('translates a built-in category rather than showing its key', () => {
    store.config = config(label('DL', true));
    draw();

    expect(shown()).toBe('OV_CAT_DL');
  });

  it('uses the filter wording for SEEDING, which is a state and not a category', () => {
    store.config = config(label('SEEDING', true));
    draw();

    expect(shown()).toBe('OV_FL_SEEDING');
  });

  it('follows a selection changed from elsewhere', () => {
    // The context menu switches to DL on its own, and another window's config
    // sync can change it too. Uncontrolled, the dropdown kept the stale label
    // while the list was already filtered by the new one.
    //
    // The SAME config node, mutated in place: observer wraps the component in
    // React.memo, so re-rendering it with unchanged props proves nothing —
    // only the observable read can bring the new value in.
    const live = observable({
      selectedLabel: { label: 'ALL', custom: true, id: JSON.stringify(label('ALL', true)) },
      setSelectedLabel: vi.fn(),
    });
    store.config = live;
    draw();
    expect(shown()).toBe('OV_CAT_ALL');

    act(() => {
      runInAction(() => {
        live.selectedLabel = { label: 'tv', custom: false, id: JSON.stringify(label('tv')) };
      });
    });

    expect(shown()).toBe('tv');
  });

  it('renders nothing before the config is loaded', () => {
    store.config = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});

describe('LabelSelect — choosing', () => {
  it('persists the label and whether it is a built-in', () => {
    // Both halves matter: the store needs the flag to filter correctly.
    draw();
    openOptions();
    fireEvent.click(screen.getByText('tv'));

    expect((store.config as ReturnType<typeof config>).setSelectedLabel).toHaveBeenCalledWith(
      'tv',
      false
    );
  });

  it('persists a built-in with its flag set', () => {
    draw();
    openOptions();
    fireEvent.click(screen.getByText('OV_CAT_DL'));

    expect((store.config as ReturnType<typeof config>).setSelectedLabel).toHaveBeenCalledWith(
      'DL',
      true
    );
  });
});
