import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

/**
 * The last line of defence for the whole page: it wraps the popup's entire tree
 * and every lazily loaded dialog. If it fails to catch, a render error blanks
 * the extension with no way back — the user has to close and reopen it, and
 * whatever they were half-way through is gone.
 *
 * So what is pinned here is that it catches, that it says something, that it
 * offers a way out, and — the part that is easy to lose — that retrying really
 * re-renders the tree rather than leaving the fallback up for ever.
 */

afterEach(cleanup);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself; the test output is not the subject.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

const Boom = ({ throws }: { throws: boolean }) => {
  if (throws) throw new Error('the daemon sent something impossible');
  return <p>content</p>;
};

describe('ErrorBoundary', () => {
  it('shows the children while nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('replaces a tree that threw rather than blanking the page', () => {
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('carries the underlying message, not just "an error occurred"', () => {
    // Without it every failure reads the same and there is nothing to report.
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByText('the daemon sent something impossible')).toBeInTheDocument();
  });

  it('keeps the detail folded away behind a summary', () => {
    // A stack-ish message in the middle of the popup is not what the user
    // needs to see first; the retry button is.
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );

    expect(document.querySelector('details')).not.toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders the children again after a retry', () => {
    // The state reset is only half of it: if the child still throws, the
    // fallback has to come back rather than the page breaking outright.
    const { rerender } = render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back again when the retry hits the same failure', () => {
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses the caller’s own fallback when there is one', () => {
    // DialogLoader supplies one so a broken dialog fails inside its frame
    // instead of replacing it with a bare error panel.
    render(
      <ErrorBoundary fallback={<p>dialog unavailable</p>}>
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByText('dialog unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('logs what it caught, with the component that threw', () => {
    // The only record of a render failure: nothing else reports it, and the
    // user sees a panel rather than a stack.
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );

    const logged = consoleError.mock.calls.find(
      (call: unknown[]) => call[0] === 'ErrorBoundary caught an error:'
    );
    expect(logged).toBeDefined();
    expect(logged?.[1]).toBe('the daemon sent something impossible');
  });

  it('catches a failure that appears only on a later render', () => {
    // The first paint succeeding proves nothing: these trees re-render on
    // every poll, and a torrent field can turn unexpected at any tick.
    const { rerender } = render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('content')).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
