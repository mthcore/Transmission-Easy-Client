import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const store = vi.hoisted(() => ({
  config: { searchQuery: '', setSearchQuery: vi.fn() } as {
    searchQuery: string;
    setSearchQuery: ReturnType<typeof vi.fn>;
  },
}));
vi.mock('../../hooks/useRootStore', () => ({ default: () => store }));

import SearchBox from '../SearchBox';

/**
 * The search field is hidden until asked for, and that is where the trap is:
 * a collapsed field went on filtering the list with nothing on screen to say
 * so, and torrents simply appeared to be missing. Collapsing therefore clears
 * the query — and so does Escape, which is the same gesture by keyboard.
 *
 * The clear also has to happen exactly once. Both branches used to run inside
 * a setState updater, which React runs during render and may invoke twice, so
 * a mutation of observable state could fire the clear a second time.
 */

afterEach(cleanup);

beforeEach(() => {
  store.config = { searchQuery: '', setSearchQuery: vi.fn() };
});

const draw = () => render(<SearchBox />);
// Once expanded, the input carries the same label as the icon, so the toggle
// is addressed by its own element rather than by label.
const toggle = () => document.querySelector('a.search-icon') as HTMLAnchorElement;
const field = () => document.querySelector('input[type="text"]') as HTMLInputElement | null;
const clearButton = () => screen.queryByLabelText('clearSearch');

/** Open the field, as clicking the magnifier does. */
function expand() {
  act(() => {
    fireEvent.click(toggle());
  });
}

describe('SearchBox — opening and closing', () => {
  it('starts collapsed, with no field to type in', () => {
    draw();

    expect(field()).toBeNull();
  });

  it('opens the field when the icon is clicked', () => {
    draw();
    expand();

    expect(field()).not.toBeNull();
  });

  it('clears the query when it is collapsed again', () => {
    // A hidden field that still filters makes torrents look like they vanished.
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    act(() => {
      fireEvent.click(toggle());
    });

    expect(store.config.setSearchQuery).toHaveBeenCalledWith('');
    expect(field()).toBeNull();
  });

  it('clears exactly once, not twice', () => {
    // The clear used to run inside a setState updater; React runs those during
    // render and may invoke them twice.
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    store.config.setSearchQuery.mockClear();
    act(() => {
      fireEvent.click(toggle());
    });

    expect(store.config.setSearchQuery).toHaveBeenCalledTimes(1);
  });

  it('clears nothing on the way in', () => {
    // Opening the field must not wipe a query restored from the config.
    draw();
    expand();

    expect(store.config.setSearchQuery).not.toHaveBeenCalled();
  });

  it('marks itself expanded, so the layout can make room', () => {
    draw();
    expand();

    expect(document.querySelector('li.search')?.className).toContain('expanded');
  });
});

describe('SearchBox — typing', () => {
  it('sends what is typed to the config', () => {
    draw();
    expand();
    fireEvent.change(field()!, { target: { value: 'ubuntu' } });

    expect(store.config.setSearchQuery).toHaveBeenCalledWith('ubuntu');
  });

  it('shows the query the config holds, not its own copy', () => {
    // The query lives in the config so the list and the box cannot disagree.
    store.config.searchQuery = 'from elsewhere';
    draw();
    expand();

    expect(field()!.value).toBe('from elsewhere');
  });

  it('offers a clear button only once something has been typed', () => {
    draw();
    expand();
    expect(clearButton()).not.toBeInTheDocument();

    cleanup();
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    expect(clearButton()).toBeInTheDocument();
  });

  it('empties the query without closing the field', () => {
    // Clearing is for typing something else; closing would be a different act.
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    fireEvent.click(clearButton()!);

    expect(store.config.setSearchQuery).toHaveBeenCalledWith('');
    expect(field()).not.toBeNull();
  });
});

describe('SearchBox — Escape', () => {
  it('clears the query and closes the field', () => {
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    act(() => {
      fireEvent.keyDown(field()!, { key: 'Escape' });
    });

    expect(store.config.setSearchQuery).toHaveBeenCalledWith('');
    expect(field()).toBeNull();
  });

  it('keeps Escape from reaching the page behind it', () => {
    // The page treats Escape as "close the dialog"; leaving the search box
    // would otherwise close whatever is open behind it as well.
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const onPage = vi.fn();
    document.addEventListener('keydown', onPage);
    act(() => {
      field()!.dispatchEvent(event);
    });
    document.removeEventListener('keydown', onPage);

    expect(onPage).not.toHaveBeenCalled();
  });

  it('leaves other keys alone', () => {
    store.config.searchQuery = 'ubuntu';
    draw();
    expand();
    act(() => {
      fireEvent.keyDown(field()!, { key: 'Enter' });
    });

    expect(store.config.setSearchQuery).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
  });
});
