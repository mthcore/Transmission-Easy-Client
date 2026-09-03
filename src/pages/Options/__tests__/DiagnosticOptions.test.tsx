import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { DiagnosticEntry } from '../../../tools/diagnosticLog';

const log = vi.hoisted(() => ({
  readDiagnosticLog: vi.fn(),
  clearDiagnosticLog: vi.fn(),
}));
vi.mock('../../../tools/diagnosticLog', async (importOriginal) => {
  // The formatter is the real one: what the pane shows IS the deliverable, and
  // a stub here would let the two drift while every case still passed.
  const actual = await importOriginal<typeof import('../../../tools/diagnosticLog')>();
  return { ...actual, ...log };
});

const settings = vi.hoisted(() => ({ daemonVersionStr: 'Transmission 4.0.5 (RPC 18)' }));
vi.mock('../../../hooks/useRootStore', () => ({
  default: () => ({ client: { settings } }),
}));

import DiagnosticOptions from '../DiagnosticOptions';

/**
 * The pane that turns "it does not work" into a report worth reading.
 *
 * Its central decision is that the report is shown in full, as plain text,
 * before anything is copied. Redaction on the way in strips the daemon host,
 * the Basic-auth header and anything shaped like a credential, but it cannot
 * recognise a torrent name inside a free-form message. Copying publishes —
 * usually into a public issue — so what actually protects the user is having
 * read it. A pane that copied without showing would look identical in review
 * and be a different feature.
 */

afterEach(cleanup);

const ENTRIES: DiagnosticEntry[] = [
  {
    time: Date.UTC(2026, 8, 3, 10, 12, 4),
    level: 'error',
    name: 'TransmissionTransport',
    message: 'HTTP 409 on torrent-get',
  },
  {
    time: Date.UTC(2026, 8, 3, 10, 13, 0),
    level: 'warn',
    name: 'Bg',
    message: 'rejected a message from outside',
    count: 4,
  },
];

const clipboard = { writeText: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  log.readDiagnosticLog.mockResolvedValue(ENTRIES);
  log.clearDiagnosticLog.mockResolvedValue(undefined);
  clipboard.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
});

const report = () => document.querySelector('textarea') as HTMLTextAreaElement;
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label);

const draw = async () => {
  const result = render(<DiagnosticOptions />);
  await waitFor(() => expect(log.readDiagnosticLog).toHaveBeenCalled());
  return result;
};

describe('DiagnosticOptions — what it shows', () => {
  it('shows the report before anything is copied', async () => {
    // The safeguard the redaction cannot provide.
    await draw();

    await waitFor(() => expect(report().value).toContain('HTTP 409 on torrent-get'));
  });

  it('leads with the daemon version, which is what a report is missing', async () => {
    // The version guards branch on RPC 16, 17 and 18, and no user knows which
    // one their daemon speaks.
    await draw();

    await waitFor(() => expect(report().value).toContain('Transmission 4.0.5 (RPC 18)'));
  });

  it('carries the extension version', async () => {
    await draw();

    await waitFor(() => expect(report().value).toMatch(/Transmission Easy Client \d/));
  });

  it('shows a repeat count, so a fold does not read as one event', async () => {
    await draw();

    await waitFor(() => expect(report().value).toContain('(x4)'));
  });

  it('cannot be edited in place', async () => {
    // It is evidence, and the button copies the field's value.
    await draw();

    expect(report().readOnly).toBe(true);
  });

  it('says so when there is nothing recorded', async () => {
    log.readDiagnosticLog.mockResolvedValue([]);
    await draw();

    await waitFor(() => expect(screen.getByText('diagnosticEmpty')).toBeInTheDocument());
  });

  it('does not claim an empty log before the first read has answered', async () => {
    // A pane that flashes "nothing recorded" and then fills in reads as a bug
    // report that was lost.
    let resolveRead!: (entries: DiagnosticEntry[]) => void;
    log.readDiagnosticLog.mockReturnValue(
      new Promise<DiagnosticEntry[]>((resolve) => {
        resolveRead = resolve;
      })
    );
    render(<DiagnosticOptions />);

    expect(screen.queryByText('diagnosticEmpty')).toBeNull();
    resolveRead([]);
  });

  it('still shows the environment when the log is empty', async () => {
    // An empty log is itself an answer: the failure was not one we record.
    log.readDiagnosticLog.mockResolvedValue([]);
    await draw();

    await waitFor(() => expect(report().value).toContain('Transmission 4.0.5'));
  });
});

describe('DiagnosticOptions — copying', () => {
  it('copies exactly what is on screen', async () => {
    await draw();
    await waitFor(() => expect(report().value).toContain('HTTP 409'));

    fireEvent.click(button('copy')!);

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(report().value));
  });

  it('confirms once the write actually landed', async () => {
    await draw();

    fireEvent.click(button('copy')!);

    await waitFor(() => expect(button('diagnosticCopied')).toBeDefined());
  });

  it('does not claim success when the clipboard rejects', async () => {
    // Firefox permission, or focus lost between the click and the write.
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    await draw();

    fireEvent.click(button('copy')!);

    await waitFor(() => expect(document.querySelector('.red')).not.toBeNull());
    expect(button('diagnosticCopied')).toBeUndefined();
  });

  it('selects the text so it can be taken by hand when the write fails', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    await draw();
    const select = vi.spyOn(report(), 'select');

    fireEvent.click(button('copy')!);

    await waitFor(() => expect(select).toHaveBeenCalled());
  });

  it('survives a browser with no clipboard object at all', async () => {
    // Property access, not a rejected promise: this threw synchronously out of
    // the handler in the magnet dialog, and nothing was reported.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await draw();
    const select = vi.spyOn(report(), 'select');

    expect(() => fireEvent.click(button('copy')!)).not.toThrow();
    expect(select).toHaveBeenCalled();
  });
});

describe('DiagnosticOptions — the other two buttons', () => {
  it('re-reads the log on Refresh', async () => {
    // The worker keeps failing while the pane is open.
    await draw();
    log.readDiagnosticLog.mockClear();

    fireEvent.click(button('refresh')!);

    await waitFor(() => expect(log.readDiagnosticLog).toHaveBeenCalled());
  });

  it('clears the log and shows the result', async () => {
    await draw();
    log.readDiagnosticLog.mockResolvedValue([]);

    fireEvent.click(button('diagnosticClear')!);

    await waitFor(() => expect(log.clearDiagnosticLog).toHaveBeenCalled());
    await waitFor(() => expect(report().value).not.toContain('HTTP 409'));
  });

  it('re-reads after clearing rather than assuming it worked', async () => {
    // Storage can refuse. The pane shows what is there, not what it asked for.
    await draw();
    log.readDiagnosticLog.mockClear();

    fireEvent.click(button('diagnosticClear')!);

    await waitFor(() => expect(log.readDiagnosticLog).toHaveBeenCalled());
  });
});
