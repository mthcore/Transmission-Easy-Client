import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

// Every dialog is lazily imported, so each one is stood in for here: what is
// under test is the loader's routing and its two failure paths, not the
// dialogs themselves.
const boom = vi.hoisted(() => ({ current: false }));
vi.mock('../PutUrlDialog', () => ({
  default: () => {
    if (boom.current) throw new Error('a dialog that fails to render');
    return <div data-testid="put-url" />;
  },
}));
vi.mock('../PutFilesDialog', () => ({ default: () => <div data-testid="put-files" /> }));
vi.mock('../RemoveConfirmDialog', () => ({ default: () => <div data-testid="remove" /> }));
vi.mock('../RenameDialog', () => ({ default: () => <div data-testid="rename" /> }));
vi.mock('../CopyMagnetUrlDialog', () => ({ default: () => <div data-testid="magnet" /> }));
vi.mock('../MoveDialog', () => ({ default: () => <div data-testid="move" /> }));
vi.mock('../SetLabelsDialog', () => ({ default: () => <div data-testid="labels" /> }));
vi.mock('../TorrentDetailsDialog', () => ({ default: () => <div data-testid="details" /> }));

import DialogLoader from '../DialogLoader';

/**
 * Every dialog is code-split, so this is the only place that knows which type
 * maps to which component — and the only place that can be handed a type with
 * no component at all.
 *
 * Both failure paths end in the same hazard. A dialog store entry that cannot
 * be closed lives for the rest of the session, and the page's Escape handler
 * closes the topmost dialog, so an unclosable entry swallows Escape for
 * everything behind it. An unknown type is therefore closed outright, and a
 * dialog that throws while rendering gets a fallback with a button — it has no
 * useDialog handler of its own to close it.
 */

afterEach(cleanup);

let store: { close: ReturnType<typeof vi.fn> };
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  boom.current = false;
  store = { close: vi.fn() };
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

async function draw(type: string) {
  const result = render(<DialogLoader type={type} dialogStore={store} />);
  // The component is lazy: let its import settle before asserting.
  await act(async () => undefined);
  return result;
}

describe('DialogLoader — routing', () => {
  it.each([
    ['putFiles', 'put-files'],
    ['putUrl', 'put-url'],
    ['removeConfirm', 'remove'],
    ['rename', 'rename'],
    ['copyMagnetUrl', 'magnet'],
    ['move', 'move'],
    ['setLabels', 'labels'],
    ['torrentDetails', 'details'],
  ])('renders the %s dialog', async (type, testId) => {
    await draw(type);

    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  // The Suspense fallback is deliberately not covered: every dialog is stood in
  // for here, and a mocked module resolves before React ever paints the
  // fallback. A case asserting on it would only be describing the mocks.
});

describe('DialogLoader — a type with no dialog', () => {
  it('renders nothing at all', async () => {
    const { container } = await draw('somethingElse');

    expect(container.firstChild).toBeNull();
  });

  it('closes the entry, which nothing else could', async () => {
    // It has no component, so it has no close button and no Escape handler:
    // left in the map it would sit there for the rest of the session.
    await draw('somethingElse');

    expect(store.close).toHaveBeenCalled();
  });

  it('closes it once, not on every render', async () => {
    // This is what says the close lives in an effect rather than in the render
    // body: closing mutates the map the parent is iterating, and a render-body
    // call would fire again on every re-render of the list.
    const { rerender } = render(<DialogLoader type="somethingElse" dialogStore={store} />);
    await act(async () => undefined);
    rerender(<DialogLoader type="somethingElse" dialogStore={store} />);
    rerender(<DialogLoader type="somethingElse" dialogStore={store} />);
    await act(async () => undefined);

    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('survives a store that cannot be closed', async () => {
    // The entry may already be gone by the time the effect runs.
    const { container } = render(<DialogLoader type="somethingElse" dialogStore={null} />);
    await act(async () => undefined);

    expect(container.firstChild).toBeNull();
  });
});

describe('DialogLoader — a dialog that throws', () => {
  it('shows a message instead of taking the page down', async () => {
    boom.current = true;
    await draw('putUrl');

    expect(document.querySelector('.dialog-error')).not.toBeNull();
  });

  it('offers a way out, since the dialog has no close handler of its own', async () => {
    // Without this button the store entry lives forever and keeps swallowing
    // Escape for every dialog behind it.
    boom.current = true;
    await draw('putUrl');
    fireEvent.click(screen.getByRole('button'));

    expect(store.close).toHaveBeenCalled();
  });

  it('does not close it on its own, so the user sees what happened', async () => {
    boom.current = true;
    await draw('putUrl');

    expect(store.close).not.toHaveBeenCalled();
  });
});
