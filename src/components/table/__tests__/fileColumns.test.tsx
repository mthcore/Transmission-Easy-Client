import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import fileColumnRenderers, { type FileColumnCtx } from '../fileColumns';

/**
 * The file list is flat, so a folder is not a row — it is a breadcrumb built
 * from the parts of each file's path, and clicking one sets a filter. Two
 * things there are easy to get wrong and invisible when they are.
 *
 * File names come from the torrent, so a right-to-left override in one can
 * reverse everything after it and spoof the extension the user reads. And a
 * path that repeats a directory name ('Season 1/Season 1') produced duplicate
 * sibling keys — not visibly wrong on the first paint, but React then
 * reconciles the two as one element and the breadcrumb misbehaves as the list
 * updates. What is observable is the warning, so that is what is checked.
 */

afterEach(cleanup);

let setFilter: ReturnType<typeof vi.fn>;

function ctx(nameParts: string[], filterLevel = 0, overrides: Record<string, unknown> = {}) {
  return {
    file: {
      nameParts,
      shortName: nameParts[nameParts.length - 1] ?? '',
      name: nameParts.join('/'),
      selected: false,
      ...overrides,
    },
    handleSelect: vi.fn(),
    fileListStore: { filterLevel, setFilter },
  } as unknown as FileColumnCtx;
}

const drawName = (context: FileColumnCtx) =>
  render(
    <table>
      <tbody>
        <tr>{fileColumnRenderers.name(context)}</tr>
      </tbody>
    </table>
  );

const crumbs = () => screen.queryAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  setFilter = vi.fn();
});

describe('fileColumns — the name column', () => {
  it('shows the file name and the folders above it', () => {
    drawName(ctx(['Season 1', 'Extras', 'ep01.mkv']));

    expect(crumbs()).toEqual(['Season 1', 'Extras']);
    expect(document.body.textContent).toContain('ep01.mkv');
  });

  it('shows no breadcrumb for a file at the root', () => {
    drawName(ctx(['single.mkv']));

    expect(crumbs()).toEqual([]);
  });

  it('shows only the folders below the level already filtered', () => {
    // Drilling in hides what the user has already narrowed to.
    drawName(ctx(['Season 1', 'Extras', 'ep01.mkv'], 1));

    expect(crumbs()).toContain('Extras');
    expect(crumbs()).not.toContain('Season 1');
  });

  it('offers a way back up once the list is filtered', () => {
    drawName(ctx(['Season 1', 'ep01.mkv'], 1));

    expect(crumbs()[0]).toBe('←');
  });

  it('offers no way back at the root', () => {
    drawName(ctx(['Season 1', 'ep01.mkv'], 0));

    expect(crumbs()).not.toContain('←');
  });

  it('gives each folder its own key when a path repeats a name', () => {
    // Keyed by name alone, the two levels of 'Season 1/Season 1' collide and
    // React reconciles them as one element. The first paint looks right either
    // way, so the warning is the observable part.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    drawName(ctx(['Season 1', 'Season 1', 'ep01.mkv']));
    const messages = warn.mock.calls.map((call) => String(call[0])).join(' ');
    warn.mockRestore();

    expect(crumbs()).toEqual(['Season 1', 'Season 1']);
    expect(messages).not.toMatch(/same key|unique "key"/i);
  });
});

describe('fileColumns — hostile names', () => {
  const OVERRIDE = '‮';

  it('strips a right-to-left override from the file name', () => {
    // Left in, the extension the user reads is not the extension they get.
    drawName(ctx([`photo${OVERRIDE}gnp.exe`]));

    expect(document.body.textContent).not.toContain(OVERRIDE);
  });

  it('strips it from a folder name too', () => {
    drawName(ctx([`Season${OVERRIDE}1`, 'ep01.mkv']));

    expect(crumbs().join('')).not.toContain(OVERRIDE);
  });

  it('strips it from the tooltip', () => {
    drawName(ctx(['ep01.mkv'], 0, { shortName: `photo${OVERRIDE}gnp.exe` }));

    // The element carrying the title, not the first div on the page — that is
    // the render container and has no title at all.
    const titled = document.querySelector('div[title]');
    expect(titled).not.toBeNull();
    expect(titled!.getAttribute('title')).not.toContain(OVERRIDE);
  });
});

describe('fileColumns — drilling in and out', () => {
  it('filters to the folder that was clicked', () => {
    drawName(ctx(['Season 1', 'Extras', 'ep01.mkv']));
    fireEvent.click(screen.getByText('Extras'));

    expect(setFilter).toHaveBeenCalledWith('Season 1/Extras');
  });

  it('filters to a single top-level folder', () => {
    drawName(ctx(['Season 1', 'ep01.mkv']));
    fireEvent.click(screen.getByText('Season 1'));

    expect(setFilter).toHaveBeenCalledWith('Season 1');
  });

  it('goes one level up rather than nowhere when the current level is clicked', () => {
    // The back arrow sits at the level already filtered; treating it like any
    // other crumb would re-apply the same filter and go nowhere.
    drawName(ctx(['Season 1', 'Extras', 'ep01.mkv'], 2));
    fireEvent.click(screen.getByText('←'));

    expect(setFilter).toHaveBeenCalledWith('Season 1');
  });

  it('clears the filter when the back arrow leaves the last level', () => {
    drawName(ctx(['Season 1', 'ep01.mkv'], 1));
    fireEvent.click(screen.getByText('←'));

    expect(setFilter).toHaveBeenCalledWith('');
  });
});
