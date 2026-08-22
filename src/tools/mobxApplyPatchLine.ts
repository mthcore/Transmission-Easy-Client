import { isObjectOrArray } from './MobxPatchLine';
import { applyPatch, applySnapshot } from 'mobx-state-tree';
import type { IJsonPatch } from 'mobx-state-tree';
import ErrorWithCode from './ErrorWithCode';

interface Session {
  id: number | null;
  patchId: number | null;
}

interface Delta {
  id: number;
  type: 'snapshot' | 'patch';
  patchId: number | null;
  branches: string[] | null;
  result: Record<string, unknown> | IJsonPatch[];
}

interface ExtendedError extends ErrorWithCode {
  original?: Error;
}

const mobxApplyPatchLine = (target: Record<string, unknown>, session: Session, delta: Delta) => {
  const { id, type, patchId, branches, result } = delta;
  switch (type) {
    case 'snapshot': {
      const snapshot = result as Record<string, unknown>;
      try {
        if (branches) {
          mobxApplySnapshotBranches(target, snapshot, branches);
        } else {
          applySnapshot(target as never, snapshot);
        }
      } catch (_err) {
        // MST actions are not transactional: a typecheck failure part-way
        // through leaves the tree half-written. Invalidating the cursor (like
        // the patch branch does) forces a fresh snapshot next time instead of
        // stacking incremental patches onto corrupt state.
        session.id = null;
        session.patchId = null;
        const err: ExtendedError = new ErrorWithCode('Apply path error', 'APPLY_PATH_ERROR');
        err.original = _err as Error;
        throw err;
      }
      session.id = id;
      session.patchId = patchId;
      break;
    }
    case 'patch': {
      const patch = result as IJsonPatch[];
      try {
        if (id !== session.id) {
          throw new Error('store id is changed');
        }
        if (patchId !== session.patchId) {
          applyPatch(target as never, patch);
          session.patchId = patchId;
        }
      } catch (_err) {
        session.id = null;
        session.patchId = null;
        const err: ExtendedError = new ErrorWithCode('Apply path error', 'APPLY_PATH_ERROR');
        err.original = _err as Error;
        throw err;
      }
      break;
    }
  }
};

function mobxApplySnapshotBranches(
  target: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  branches: string[]
): void {
  for (let i = 0, len = branches.length; i < len; i++) {
    const key = branches[i];
    const snapshotBranch = snapshot[key];
    const targetBranch = target[key];
    if (!isObjectOrArray(targetBranch) || !isObjectOrArray(snapshotBranch)) {
      target[key] = snapshotBranch;
    } else {
      applySnapshot(targetBranch as never, snapshotBranch);
    }
  }
}

export default mobxApplyPatchLine;
