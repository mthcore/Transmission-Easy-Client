import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, renderHook, act } from '@testing-library/react';

vi.mock('../../menu/FileContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../fileColumns', () => ({
  default: {
    select: (ctx: { handleSelect: (e: unknown) => void }) => (
      <td key="select">
        <input type="checkbox" onChange={ctx.handleSelect} />
      </td>
    ),
    name: () => <td key="name">name</td>,
  },
}));

const store = vi.hoisted(() => ({
  config: undefined as unknown,
  fileList: undefined as unknown,
}));
vi.mock('../../../hooks/useRootStore', () => ({ default: () => store }));

import FileListTableItem from '../FileListTableItem';
import { useLoading } from '../../../hooks/useLoading';

/**
 * A file row selects by NAME rather than by index. Names are what the daemon
 * addresses in a rename, and what the folder filter matches on, so the
 * selection has to survive a list that reorders or is filtered down — an index
 * would point at a different file the moment either happened.
 */

afterEach(cleanup);

function file(overrides: Record<string, unknown> = {}) {
  return { name: 'pack/ep01.mkv', selected: false, ...overrides };
}

beforeEach(() => {
  store.config = { visibleFileColumns: [{ column: 'select' }, { column: 'name' }] };
  store.fileList = {
    addMultipleSelectedId: vi.fn(),
    addSelectedId: vi.fn(),
    removeSelectedId: vi.fn(),
    filterLevel: 0,
    setFilter: vi.fn(),
  };
});

const draw = (props: Record<string, unknown> = {}) =>
  render(<FileListTableItem file={file() as never} {...props} />);

const checkbox = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;
const list = () => store.fileList as Record<string, ReturnType<typeof vi.fn>>;

describe('FileListTableItem — selecting', () => {
  it('selects by name, not by position', () => {
    draw();
    fireEvent.click(checkbox());

    expect(list().addSelectedId).toHaveBeenCalledWith('pack/ep01.mkv');
  });

  it('extends the selection when shift is held', () => {
    draw();
    fireEvent.click(checkbox(), { shiftKey: true });

    expect(list().addMultipleSelectedId).toHaveBeenCalledWith('pack/ep01.mkv');
    expect(list().addSelectedId).not.toHaveBeenCalled();
  });

  it('removes a file that was already selected', () => {
    draw({ file: file({ selected: true }) as never });
    fireEvent.click(checkbox());

    expect(list().removeSelectedId).toHaveBeenCalledWith('pack/ep01.mkv');
  });

  it('ignores shift when deselecting, which is not a range', () => {
    draw({ file: file({ selected: true }) as never });
    fireEvent.click(checkbox(), { shiftKey: true });

    expect(list().removeSelectedId).toHaveBeenCalled();
    expect(list().addMultipleSelectedId).not.toHaveBeenCalled();
  });

  it('marks a selected row so the styling can follow', () => {
    draw({ file: file({ selected: true }) as never });

    expect(document.querySelector('tr')?.className).toContain('selected');
  });
});

describe('FileListTableItem — the columns', () => {
  it('renders one cell per visible column', () => {
    draw();

    expect(document.querySelectorAll('td')).toHaveLength(2);
  });

  it('skips a column with no renderer rather than failing the row', () => {
    store.config = {
      visibleFileColumns: [{ column: 'select' }, { column: 'somethingRemoved' }],
    };

    expect(draw).not.toThrow();
    expect(document.querySelectorAll('td')).toHaveLength(1);
  });

  it('renders nothing before the config is loaded', () => {
    store.config = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing before the file list exists', () => {
    store.fileList = undefined;
    const { container } = draw();

    expect(container.firstChild).toBeNull();
  });
});

/**
 * The per-row start/stop buttons disable themselves while their request is in
 * flight, which is the only thing stopping a double click from sending the same
 * action twice.
 */
describe('useLoading', () => {
  it('is not loading before anything has been asked for', () => {
    const { result } = renderHook(() => useLoading());

    expect(result.current.isLoading).toBe(false);
  });

  it('reports loading while the action is in flight', async () => {
    const { result } = renderHook(() => useLoading());
    let settle!: () => void;

    await act(async () => {
      result.current.withLoading(() => new Promise<void>((resolve) => (settle = resolve)));
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => settle());
    expect(result.current.isLoading).toBe(false);
  });

  it('clears the flag when the action fails', async () => {
    // Left set, the button stays disabled for the rest of the session and the
    // row can never be started again.
    const { result } = renderHook(() => useLoading());

    await act(async () => {
      await result.current
        .withLoading(() => Promise.reject(new Error('daemon said 500')))
        .catch(() => undefined);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('passes the action’s result back to the caller', async () => {
    const { result } = renderHook(() => useLoading());
    let value: unknown;

    await act(async () => {
      value = await result.current.withLoading(() => Promise.resolve('done'));
    });

    expect(value).toBe('done');
  });

  it('rethrows rather than swallowing the failure', async () => {
    // The caller decides whether a failure is worth reporting; hiding it here
    // would make every failed start look like a successful one.
    const { result } = renderHook(() => useLoading());

    await expect(
      act(async () => {
        await result.current.withLoading(() => Promise.reject(new Error('nope')));
      })
    ).rejects.toThrow('nope');
  });
});
