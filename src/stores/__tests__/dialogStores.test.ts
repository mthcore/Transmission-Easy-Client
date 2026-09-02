import { describe, it, expect, vi, beforeEach } from 'vitest';
import { types, getSnapshot } from 'mobx-state-tree';
import BaseDialogStore from '../BaseDialogStore';
import PutFilesDialogStore from '../PutFilesDialogStore';
import RemoveConfirmDialogStore from '../RemoveConfirmDialogStore';
import MoveDialogStore from '../MoveDialogStore';
import RenameDialogStore from '../RenameDialogStore';
import SetLabelsDialogStore from '../SetLabelsDialogStore';
import CopyMagnetUrlDialogStore from '../CopyMagnetUrlDialogStore';
import TorrentDetailsDialogStore from '../TorrentDetailsDialogStore';

/**
 * Every dialog is an entry in a map on the root store, and closing one means
 * asking the root to remove that entry. A dialog that cannot name itself to the
 * root cannot be closed at all, and an unclosable entry goes on swallowing
 * Escape for every dialog behind it — so the id and close() are what these
 * models are really for.
 *
 * The dropped files are the one exception to living in the tree: File objects
 * are not serializable, so they are volatile. That is not a detail — a view
 * getter would become an MST computed backed by a plain closure variable, and
 * would keep returning the first FileList for ever once read reactively.
 */

let destroyDialog: ReturnType<typeof vi.fn>;

/**
 * A root that holds one dialog, as the real one does. Loosely typed on purpose:
 * the point is that every dialog model composes the same base, so they are all
 * handled through it.
 */
function rootFor(
  model: typeof BaseDialogStore,
  snapshot: Record<string, unknown>
): { dialog: { close: () => void } } {
  const Root = types.model('TestRoot', { dialog: model }).actions(() => ({ destroyDialog }));
  return Root.create({ dialog: snapshot } as never) as never;
}

beforeEach(() => {
  destroyDialog = vi.fn();
});

describe('dialog stores — closing', () => {
  it('asks the root to remove this dialog by id', () => {
    const root = rootFor(PutFilesDialogStore as never, { id: 'dialog_7', type: 'putFiles' });
    root.dialog.close();

    expect(destroyDialog).toHaveBeenCalledWith('dialog_7');
  });

  it.each([
    ['putFiles', PutFilesDialogStore, { type: 'putFiles' }],
    ['removeConfirm', RemoveConfirmDialogStore, { type: 'removeConfirm', torrentIds: [1] }],
    ['move', MoveDialogStore, { type: 'move', torrentIds: [1], directory: '/d' }],
    ['rename', RenameDialogStore, { type: 'rename', torrentIds: [1], path: 'a', name: 'a' }],
    ['setLabels', SetLabelsDialogStore, { type: 'setLabels', torrentIds: [1], currentLabels: '' }],
    [
      'copyMagnetUrl',
      CopyMagnetUrlDialogStore,
      { type: 'copyMagnetUrl', torrentIds: [1], magnetLink: 'magnet:?x' },
    ],
    ['torrentDetails', TorrentDetailsDialogStore, { type: 'torrentDetails', torrentId: 1 }],
  ])('%s can close itself', (_name, model, props) => {
    const root = rootFor(model as never, { id: 'dialog_1', ...props });
    root.dialog.close();

    expect(destroyDialog).toHaveBeenCalledWith('dialog_1');
  });
});

describe('PutFilesDialogStore — the dropped files', () => {
  const create = () =>
    rootFor(PutFilesDialogStore as never, { id: 'dialog_1', type: 'putFiles' }).dialog as never as {
      files: File[];
      isReady: boolean;
      setFiles: (f: File[]) => void;
      setReady: (v: boolean) => void;
    };

  it('starts with nothing and not ready', () => {
    // The renderer waits for isReady; a dialog that never becomes ready is an
    // invisible entry nothing can close.
    const dialog = create();

    expect(dialog.files).toEqual([]);
    expect(dialog.isReady).toBe(false);
  });

  it('holds the files it was given', () => {
    const dialog = create();
    const files = [{ name: 'a.torrent', size: 10 } as File];
    dialog.setFiles(files);

    expect(dialog.files).toBe(files);
  });

  it('takes a second set of files rather than caching the first', () => {
    // A computed backed by a closure variable would keep returning the first
    // FileList for ever once read from a reactive context.
    const dialog = create();
    dialog.setFiles([{ name: 'a.torrent' } as File]);
    dialog.setFiles([{ name: 'b.torrent' } as File]);

    expect(dialog.files.map((f) => f.name)).toEqual(['b.torrent']);
  });

  it('keeps the files out of the serialized tree', () => {
    // File objects are not serializable; in the tree they would break every
    // snapshot and patch the replication depends on.
    const dialog = create();
    dialog.setFiles([{ name: 'a.torrent' } as File]);

    expect(getSnapshot(dialog as never)).not.toHaveProperty('files');
  });

  it('becomes ready when told to', () => {
    const dialog = create();
    dialog.setReady(true);

    expect(dialog.isReady).toBe(true);
  });
});

describe('dialog stores — what each carries', () => {
  it('remove-confirm carries the ids and whether the data goes too', () => {
    const root = rootFor(RemoveConfirmDialogStore as never, {
      id: 'd',
      type: 'removeConfirm',
      torrentIds: [1, 2],
      deleteData: true,
    });

    expect(getSnapshot(root.dialog as never)).toMatchObject({
      torrentIds: [1, 2],
      deleteData: true,
    });
  });

  it('remove-confirm keeps the data by default', () => {
    // The safe default: an absent flag must not mean "delete the files".
    const root = rootFor(RemoveConfirmDialogStore as never, {
      id: 'd',
      type: 'removeConfirm',
      torrentIds: [1],
    });

    expect(getSnapshot(root.dialog as never)).toMatchObject({ deleteData: false });
  });

  it('rename keeps the path, which is what the daemon renames', () => {
    const root = rootFor(RenameDialogStore as never, {
      id: 'd',
      type: 'rename',
      torrentIds: [1],
      path: 'pack/ep01.mkv',
    });

    expect(getSnapshot(root.dialog as never)).toMatchObject({ path: 'pack/ep01.mkv' });
  });

  it('rename derives the name to edit from the last path segment', () => {
    const root = rootFor(RenameDialogStore as never, {
      id: 'd',
      type: 'rename',
      torrentIds: [1],
      path: 'pack/season 1/ep01.mkv',
    });

    expect((root.dialog as unknown as { name?: string }).name).toBe('ep01.mkv');
  });

  it('rename splits on a slash only, since a backslash is legal in a name', () => {
    // Transmission paths are '/'-separated and the daemon may be on Linux,
    // where a backslash is part of the file name — splitting on it truncated
    // real names to their last fragment.
    const root = rootFor(RenameDialogStore as never, {
      id: 'd',
      type: 'rename',
      torrentIds: [1],
      path: 'pack/AC\\DC - Back in Black.mp3',
    });

    expect((root.dialog as unknown as { name?: string }).name).toBe('AC\\DC - Back in Black.mp3');
  });

  it('rename gives the whole path back when there is no folder', () => {
    const root = rootFor(RenameDialogStore as never, {
      id: 'd',
      type: 'rename',
      torrentIds: [1],
      path: 'single.mkv',
    });

    expect((root.dialog as unknown as { name?: string }).name).toBe('single.mkv');
  });

  it('move carries a directory, even an empty one', () => {
    // Required string: a torrent removed between the last sync and the
    // keypress would otherwise throw an MST typecheck error at the caller.
    const root = rootFor(MoveDialogStore as never, {
      id: 'd',
      type: 'move',
      torrentIds: [1],
      directory: '',
    });

    expect(getSnapshot(root.dialog as never)).toMatchObject({ directory: '' });
  });
});
