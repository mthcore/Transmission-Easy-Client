import { afterEach, describe, expect, it, vi } from 'vitest';
import { types, getSnapshot, cast } from 'mobx-state-tree';
import type { IJsonPatch } from 'mobx-state-tree';
import MobxPatchLine, { isObjectOrArray } from '../MobxPatchLine';
import mobxApplyPatchLine from '../mobxApplyPatchLine';

interface Session {
  id: number | null;
  patchId: number | null;
}

interface Delta {
  id: number;
  branches: string[] | null;
  patchId: number | null;
  type: 'patch' | 'snapshot';
  result: Record<string, unknown> | IJsonPatch[];
}

const Leaf = types
  .model('Leaf', {
    count: types.optional(types.number, 0),
    label: types.optional(types.string, ''),
    tags: types.optional(types.array(types.string), []),
  })
  .actions((self) => ({
    setCount(value: number) {
      self.count = value;
    },
    setLabel(value: string) {
      self.label = value;
    },
    pushTag(value: string) {
      self.tags.push(value);
    },
    removeTag(index: number) {
      self.tags.splice(index, 1);
    },
  }));

const Store = types
  .model('Store', {
    client: types.optional(Leaf, {}),
    other: types.optional(Leaf, {}),
  })
  .actions((self) => ({
    applyDelta(session: Session, delta: Delta) {
      mobxApplyPatchLine(self as unknown as Record<string, unknown>, session, delta);
    },
  }));

const MaybeStore = types
  .model('MaybeStore', {
    client: types.maybe(Leaf),
  })
  .actions((self) => ({
    createClient(count: number) {
      self.client = cast({ count });
    },
    dropClient() {
      self.client = undefined;
    },
    applyDelta(session: Session, delta: Delta) {
      mobxApplyPatchLine(self as unknown as Record<string, unknown>, session, delta);
    },
  }));

function createLine(store: unknown, branches: string[] | null) {
  return new MobxPatchLine(store as Record<string, unknown>, branches);
}

function newSession(): Session {
  return { id: null, patchId: null };
}

/** Mimics RootStore.syncClient: fetch a delta for the session, then apply it. */
function sync(
  line: MobxPatchLine,
  session: Session,
  mirror: { applyDelta: (s: Session, d: Delta) => void }
) {
  const delta = line.getDelta(session.id as number, session.patchId) as Delta;
  mirror.applyDelta(session, delta);
  return delta;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MobxPatchLine', () => {
  describe('instance identity', () => {
    it('assigns a numeric instance id in the generated range', () => {
      const line = createLine(Store.create(), null);
      expect(Number.isInteger(line.id)).toBe(true);
      expect(line.id).toBeGreaterThanOrEqual(0);
      expect(line.id).toBeLessThan(1000);
    });

    it('starts with an empty line and a null lastPatchId', () => {
      const line = createLine(Store.create(), null);
      expect(line.patchLine).toEqual([]);
      expect(line.idLine).toEqual([]);
      expect(line.timeLine).toEqual([]);
      expect(line.lastPatchId).toBeNull();
    });
  });

  describe('getDelta - first call without a cursor', () => {
    it('returns a full snapshot when the session has no id yet', () => {
      const store = Store.create({ client: { count: 7, label: 'a' }, other: { count: 1 } });
      const line = createLine(store, null);

      const delta = line.getDelta(null as unknown as number, null);

      expect(delta.type).toBe('snapshot');
      expect(delta.id).toBe(line.id);
      expect(delta.branches).toBeNull();
      expect(delta.patchId).toBeNull();
      expect(delta.result).toEqual(getSnapshot(store));
    });

    it('scopes the first snapshot to the configured branches', () => {
      const store = Store.create({ client: { count: 7 }, other: { count: 99 } });
      const line = createLine(store, ['client']);

      const delta = line.getDelta(null as unknown as number, null);

      expect(delta.type).toBe('snapshot');
      expect(delta.branches).toEqual(['client']);
      expect(delta.result).toEqual({ client: getSnapshot(store.client) });
      expect(delta.result).not.toHaveProperty('other');
    });

    it('reports the current lastPatchId on the fallback snapshot so the next call can be a delta', () => {
      const store = Store.create();
      const line = createLine(store, null);
      store.client.setCount(1);
      store.client.setCount(2);

      const delta = line.getDelta(null as unknown as number, null);

      expect(delta.type).toBe('snapshot');
      expect(delta.patchId).toBe(line.lastPatchId);
      expect(delta.patchId).toBe(line.idLine[line.idLine.length - 1]);
    });
  });

  describe('getDelta - incremental patches', () => {
    it('returns only the patches recorded after the given patchId', () => {
      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1);
      const cursor = line.lastPatchId;

      store.client.setCount(2);
      store.client.setLabel('hello');

      const delta = line.getDelta(line.id, cursor);

      expect(delta.type).toBe('patch');
      expect(delta.result).toEqual([
        { op: 'replace', path: '/client/count', value: 2 },
        { op: 'replace', path: '/client/label', value: 'hello' },
      ]);
      expect(delta.patchId).toBe(line.lastPatchId);
    });

    it('returns an empty patch list when the cursor is already at the head', () => {
      const store = Store.create();
      const line = createLine(store, null);
      store.client.setCount(1);

      const delta = line.getDelta(line.id, line.lastPatchId);

      expect(delta.type).toBe('patch');
      expect(delta.result).toEqual([]);
      expect(delta.patchId).toBe(line.lastPatchId);
    });

    it('returns an empty patch list when nothing was ever recorded and the cursor is null', () => {
      const store = Store.create();
      const line = createLine(store, null);

      const delta = line.getDelta(line.id, null);

      expect(delta.type).toBe('patch');
      expect(delta.result).toEqual([]);
      expect(delta.patchId).toBeNull();
    });

    it('does not re-send patches already delivered on a previous call', () => {
      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1);
      const first = line.getDelta(line.id, null as unknown as number);
      expect(first.type).toBe('snapshot');

      store.client.setCount(2);
      const second = line.getDelta(line.id, first.patchId);
      expect(second.type).toBe('patch');
      expect(second.result).toEqual([{ op: 'replace', path: '/client/count', value: 2 }]);

      const third = line.getDelta(line.id, second.patchId);
      expect(third.type).toBe('patch');
      expect(third.result).toEqual([]);
    });

    it('records nothing when a mutation writes an identical value', () => {
      const store = Store.create({ client: { count: 3 } });
      const line = createLine(store, null);

      store.client.setCount(3);

      expect(line.patchLine).toHaveLength(0);
      expect(line.lastPatchId).toBeNull();
    });

    it('records patches in mutation order with strictly increasing ids', () => {
      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1);
      store.client.pushTag('a');
      store.client.pushTag('b');
      store.client.removeTag(0);

      expect(line.patchLine.map((p) => p.op)).toEqual(['replace', 'add', 'add', 'remove']);
      expect(line.idLine).toHaveLength(4);
      expect(new Set(line.idLine).size).toBe(4);
      for (let i = 1; i < line.idLine.length; i++) {
        expect(line.idLine[i]).toBeGreaterThan(line.idLine[i - 1]);
      }
      expect(line.timeLine).toHaveLength(4);
    });
  });

  describe('getDelta - fallbacks', () => {
    it('falls back to a full snapshot for an unknown patchId (PATCH_ID_IS_NOT_FOUND)', () => {
      const store = Store.create({ client: { count: 5 } });
      const line = createLine(store, null);
      store.client.setCount(6);

      const delta = line.getDelta(line.id, 999999);

      expect(delta.type).toBe('snapshot');
      expect(delta.id).toBe(line.id);
      expect(delta.result).toEqual(getSnapshot(store));
    });

    it('falls back to a full snapshot for a stale (already pruned) patchId', () => {
      const store = Store.create();
      const line = createLine(store, null);
      store.client.setCount(1);
      const staleCursor = line.lastPatchId;
      store.client.setCount(2);

      // Simulate the ring buffer having dropped the entry the client still points at.
      line.patchLine.splice(0, 1);
      line.idLine.splice(0, 1);
      line.timeLine.splice(0, 1);

      const delta = line.getDelta(line.id, staleCursor);

      expect(delta.type).toBe('snapshot');
      expect(delta.result).toEqual(getSnapshot(store));
    });

    it('falls back to a full snapshot when the instance id does not match (ID_IS_NOT_EQUAL)', () => {
      const store = Store.create({ client: { count: 3 } });
      const line = createLine(store, null);
      store.client.setCount(4);
      const cursor = line.lastPatchId;

      const delta = line.getDelta(line.id + 1, cursor);

      expect(delta.type).toBe('snapshot');
      // The response always advertises the *current* instance id so the client can re-key.
      expect(delta.id).toBe(line.id);
      expect(delta.patchId).toBe(cursor);
      expect(delta.result).toEqual(getSnapshot(store));
    });

    it('prefers the id check over the patch lookup', () => {
      const store = Store.create();
      const line = createLine(store, null);
      store.client.setCount(1);

      // Valid cursor, wrong instance id -> still a snapshot.
      const delta = line.getDelta(line.id + 7, line.lastPatchId);
      expect(delta.type).toBe('snapshot');
    });
  });

  describe('branch filtering', () => {
    it('ignores patches outside of the observed branches', () => {
      const store = Store.create();
      const line = createLine(store, ['client']);

      store.other.setCount(42);
      expect(line.patchLine).toHaveLength(0);
      expect(line.lastPatchId).toBeNull();

      store.client.setCount(1);
      expect(line.patchLine).toHaveLength(1);
    });

    it('rewrites branch patch paths as relative paths', () => {
      const store = Store.create();
      const line = createLine(store, ['client']);

      store.client.setCount(3);

      expect(line.patchLine[0]).toEqual({ op: 'replace', path: './client/count', value: 3 });
    });

    it('matches a whole-branch replacement as well as nested paths', () => {
      const store = MaybeStore.create({});
      const line = createLine(store, ['client']);

      store.createClient(2);
      expect(line.patchLine).toHaveLength(1);
      expect(line.patchLine[0].path).toBe('./client');

      store.client?.setCount(5);
      expect(line.patchLine[1].path).toBe('./client/count');
    });

    it('does not treat a branch name as a regexp (escapes metacharacters)', () => {
      const Weird = types
        .model('Weird', {
          'a.b': types.optional(Leaf, {}),
          axb: types.optional(Leaf, {}),
        })
        .actions(() => ({}));
      const store = Weird.create();
      const line = createLine(store, ['a.b']);

      store.axb.setCount(1);
      expect(line.patchLine).toHaveLength(0);

      store['a.b'].setCount(1);
      expect(line.patchLine).toHaveLength(1);
      expect(line.patchLine[0].path).toBe('./a.b/count');
    });

    it('does not match a branch name that is only a prefix of another key', () => {
      const Prefixed = types.model('Prefixed', {
        client: types.optional(Leaf, {}),
        clientExtra: types.optional(Leaf, {}),
      });
      const store = Prefixed.create();
      const line = createLine(store, ['client']);

      store.clientExtra.setCount(1);
      expect(line.patchLine).toHaveLength(0);
    });
  });

  describe('ring buffer retention', () => {
    it('debounces cleaning and keeps entries inside the 60s window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));

      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1);
      expect(line.cleanTimeoutId).not.toBeNull();

      // clean() is debounced by 1s; the single entry is 1s old, well inside the window.
      vi.advanceTimersByTime(1000);
      expect(line.cleanTimeoutId).toBeNull();
      expect(line.patchLine).toHaveLength(1);

      store.client.setCount(2);
      vi.advanceTimersByTime(1000);
      expect(line.patchLine).toHaveLength(2);
    });

    it('prunes entries older than the retention window when new patches arrive', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));

      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1);
      const oldCursor = line.lastPatchId;
      vi.advanceTimersByTime(1000); // flush the pending clean, nothing to prune yet
      expect(line.patchLine).toHaveLength(1);

      // Age the recorded entry past the 60s retention window.
      vi.advanceTimersByTime(61 * 1000);
      expect(line.patchLine).toHaveLength(1); // no patch activity -> no clean scheduled

      store.client.setCount(2);
      const freshCursor = line.lastPatchId;
      vi.advanceTimersByTime(1000);

      expect(line.patchLine).toHaveLength(1);
      expect(line.idLine).toEqual([freshCursor]);
      expect(line.timeLine).toHaveLength(1);
      expect(line.patchLine[0]).toEqual({ op: 'replace', path: '/client/count', value: 2 });

      // A client still holding the pruned cursor is forced back to a full snapshot.
      const delta = line.getDelta(line.id, oldCursor);
      expect(delta.type).toBe('snapshot');
      expect(delta.patchId).toBe(freshCursor);
    });

    it('prunes only the leading expired entries and keeps the rest contiguous', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));

      const store = Store.create();
      const line = createLine(store, null);

      store.client.setCount(1); // t = 0    -> expired
      vi.advanceTimersByTime(1000);
      store.client.setCount(2); // t = 1s   -> expired
      vi.advanceTimersByTime(59_000);
      store.client.setCount(3); // t = 60s  -> kept
      const keptA = line.lastPatchId;
      vi.advanceTimersByTime(1500); // clean fires at t = 61s: window starts at t = 1s

      // Entry at t=0 is strictly older than the window; the t=1s entry is not.
      expect(line.patchLine.map((p) => p.value)).toEqual([2, 3]);

      store.client.setCount(4); // t = 61.5s -> kept
      const keptB = line.lastPatchId;
      vi.advanceTimersByTime(1000); // clean at t = 62.5s: window starts at t = 2.5s

      expect(line.patchLine.map((p) => p.value)).toEqual([3, 4]);
      expect(line.idLine).toEqual([keptA, keptB]);
      expect(line.getDelta(line.id, keptA).result).toEqual([
        { op: 'replace', path: '/client/count', value: 4 },
      ]);
    });

    it('keeps patchLine, idLine and timeLine aligned after pruning', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));

      const store = Store.create();
      const line = createLine(store, null);

      for (let i = 0; i < 5; i++) {
        store.client.setCount(i);
        vi.advanceTimersByTime(20_000);
      }
      store.client.setLabel('done');
      vi.advanceTimersByTime(1000);

      expect(line.idLine).toHaveLength(line.patchLine.length);
      expect(line.timeLine).toHaveLength(line.patchLine.length);
      expect(line.patchLine.length).toBeLessThan(6);
      expect(line.patchLine[line.patchLine.length - 1]).toEqual({
        op: 'replace',
        path: '/client/label',
        value: 'done',
      });
    });
  });

  describe('destroy', () => {
    it('stops recording patches and empties the buffers', () => {
      const store = Store.create();
      const line = createLine(store, null);
      store.client.setCount(1);
      expect(line.patchLine).toHaveLength(1);

      line.destroy();

      expect(line.patchLine).toEqual([]);
      expect(line.idLine).toEqual([]);
      expect(line.timeLine).toEqual([]);

      store.client.setCount(2);
      expect(line.patchLine).toEqual([]);
    });
  });
});

describe('MobxPatchLine <-> mobxApplyPatchLine round trip', () => {
  it('reproduces the source state on a mirror store through snapshot + patches', () => {
    const source = Store.create({ client: { count: 1, label: 'init' }, other: { count: 5 } });
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();

    // Warm up the line so the first snapshot carries a usable cursor.
    source.client.setLabel('warmed');

    // First sync: no cursor -> full snapshot.
    const first = sync(line, session, mirror);
    expect(first.type).toBe('snapshot');
    expect(session.id).toBe(line.id);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));

    // Subsequent mutations arrive as patches only.
    source.client.setCount(2);
    source.client.pushTag('x');
    source.other.setLabel('changed');

    const second = sync(line, session, mirror);
    expect(second.type).toBe('patch');
    expect(second.result).toHaveLength(3);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));
    expect(session.patchId).toBe(line.lastPatchId);

    // A no-op sync must not disturb the mirror.
    const third = sync(line, session, mirror);
    expect(third.type).toBe('patch');
    expect(third.result).toEqual([]);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));
  });

  // Documents a real quirk: when the very first sync happens before any patch was
  // recorded, the snapshot carries patchId === null. `null` is never a member of
  // idLine, so the *next* sync hits PATCH_ID_IS_NOT_FOUND and costs a second full
  // snapshot before incremental patching can start. State still converges.
  it('needs a second snapshot when the first sync happened on an empty patch line', () => {
    const source = Store.create();
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();

    const first = sync(line, session, mirror);
    expect(first.type).toBe('snapshot');
    expect(first.patchId).toBeNull();
    expect(session.patchId).toBeNull();

    source.client.setCount(1);
    const second = sync(line, session, mirror);
    expect(second.type).toBe('snapshot');
    expect(second.patchId).toBe(line.lastPatchId);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));

    // From here on, incremental patching works.
    source.client.setCount(2);
    const third = sync(line, session, mirror);
    expect(third.type).toBe('patch');
    expect(third.result).toEqual([{ op: 'replace', path: '/client/count', value: 2 }]);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));
  });

  it('replays array mutations (add / remove) in order', () => {
    const source = Store.create();
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();
    source.client.setLabel('warmup');
    sync(line, session, mirror);

    source.client.pushTag('a');
    source.client.pushTag('b');
    source.client.pushTag('c');
    source.client.removeTag(1);
    source.client.pushTag('d');

    sync(line, session, mirror);

    expect(getSnapshot(mirror.client.tags)).toEqual(['a', 'c', 'd']);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));
  });

  it('syncs only the observed branch and leaves the rest of the mirror untouched', () => {
    const source = Store.create({ client: { count: 1 }, other: { count: 111 } });
    const mirror = Store.create({ client: { count: 0 }, other: { count: 222 } });
    const line = createLine(source, ['client']);
    const session = newSession();

    source.client.setLabel('warmed'); // warm up the line so the snapshot carries a cursor

    const first = sync(line, session, mirror);
    expect(first.type).toBe('snapshot');
    expect(getSnapshot(mirror.client)).toEqual(getSnapshot(source.client));
    expect(mirror.other.count).toBe(222);

    source.client.setCount(9);
    source.other.setCount(333);

    const second = sync(line, session, mirror);
    expect(second.type).toBe('patch');
    expect(mirror.client.count).toBe(9);
    expect(mirror.other.count).toBe(222);
  });

  it('recovers from a service worker restart (new instance id) with a fresh snapshot', () => {
    const source = Store.create({ client: { count: 1 } });
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();
    sync(line, session, mirror);

    source.client.setCount(2);
    sync(line, session, mirror);
    expect(mirror.client.count).toBe(2);

    // Simulate the SW being torn down and rebuilt: a brand new line over a new store.
    line.destroy();
    const restarted = Store.create({ client: { count: 42, label: 'after-restart' } });
    const newLine = createLine(restarted, null);
    newLine.id = line.id + 1; // guarantee a different instance id

    const delta = sync(newLine, session, mirror);
    expect(delta.type).toBe('snapshot');
    expect(session.id).toBe(newLine.id);
    expect(getSnapshot(mirror)).toEqual(getSnapshot(restarted));
  });

  it('recovers from a pruned cursor with a snapshot and resumes patching afterwards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));

    const source = Store.create();
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();

    source.client.setCount(1);
    sync(line, session, mirror);
    expect(mirror.client.count).toBe(1);

    // The UI goes to sleep long enough for its cursor to be pruned.
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(61 * 1000);
    source.client.setCount(2);
    source.client.setLabel('late');
    vi.advanceTimersByTime(1000);

    const recovery = sync(line, session, mirror);
    expect(recovery.type).toBe('snapshot');
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));

    source.client.setCount(3);
    const resumed = sync(line, session, mirror);
    expect(resumed.type).toBe('patch');
    expect(mirror.client.count).toBe(3);
  });

  it('resets the session and throws APPLY_PATH_ERROR when a patch cannot be applied', () => {
    const source = Store.create();
    const mirror = Store.create();
    const line = createLine(source, null);
    const session = newSession();
    source.client.setLabel('warmup'); // ensure the first snapshot carries a cursor
    sync(line, session, mirror);

    source.client.setCount(1);
    const delta = line.getDelta(session.id as number, session.patchId) as Delta;
    expect(delta.type).toBe('patch');
    // Corrupt the patch the way a schema drift between SW and UI would.
    (delta.result as IJsonPatch[])[0] = {
      op: 'replace',
      path: '/nope/count',
      value: 1,
    };

    expect(() => mirror.applyDelta(session, delta)).toThrowError(/Apply path error/);
    expect(session.id).toBeNull();
    expect(session.patchId).toBeNull();

    // The next sync starts from scratch and converges again.
    const recovery = sync(line, session, mirror);
    expect(recovery.type).toBe('snapshot');
    expect(getSnapshot(mirror)).toEqual(getSnapshot(source));
  });

  it('handles a branch that becomes undefined', () => {
    const source = MaybeStore.create({});
    const mirror = MaybeStore.create({});
    const line = createLine(source, ['client']);
    const session = newSession();

    source.createClient(4);
    sync(line, session, mirror);
    expect(mirror.client?.count).toBe(4);

    source.dropClient();
    sync(line, session, mirror);
    expect(mirror.client).toBeUndefined();

    // And back again.
    source.createClient(8);
    sync(line, session, mirror);
    expect(mirror.client?.count).toBe(8);
  });
});

describe('isObjectOrArray', () => {
  it('accepts objects and arrays', () => {
    expect(isObjectOrArray({})).toBe(true);
    expect(isObjectOrArray([])).toBe(true);
    expect(isObjectOrArray(Store.create() as unknown)).toBe(true);
  });

  it('rejects null, undefined and primitives', () => {
    expect(isObjectOrArray(null)).toBe(false);
    expect(isObjectOrArray(undefined)).toBe(false);
    expect(isObjectOrArray(0)).toBe(false);
    expect(isObjectOrArray('')).toBe(false);
    expect(isObjectOrArray(false)).toBe(false);
  });
});
