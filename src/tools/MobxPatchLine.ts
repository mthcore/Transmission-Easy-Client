import { getSnapshot, onPatch, IDisposer } from 'mobx-state-tree';
import type { IJsonPatch } from 'mobx-state-tree';
import ErrorWithCode from './ErrorWithCode';
import escapeStringRegexp from 'escape-string-regexp';

const INDEX_LIMIT = 1e9;

interface DeltaResult {
  id: number;
  branches: string[] | null;
  patchId: number | null;
  type: 'patch' | 'snapshot';
  result: IJsonPatch[] | Record<string, unknown>;
}

class MobxPatchLine {
  id: number;
  patchLine: IJsonPatch[];
  timeLine: number[];
  idLine: number[];
  branches: string[] | null;
  branchesRe: RegExp | null;
  index: number;
  store: Record<string, unknown>;
  patchDisposer: IDisposer | null;
  cleanTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(store: Record<string, unknown>, branches: string[] | null) {
    this.id = Math.trunc(Math.random() * 1000);

    this.patchLine = [];
    this.timeLine = [];
    this.idLine = [];
    this.branches = branches;
    this.branchesRe =
      branches && new RegExp(`^/(${branches.map(escapeStringRegexp).join('|')})(\\/|$)`);

    this.index = 0;

    this.store = store;
    this.patchDisposer = null;

    this.init();
  }

  get patchId(): number {
    if (this.index > INDEX_LIMIT) {
      this.index = 0;
    }

    let id = -1;
    while (id === -1 || this.idLine.includes(id)) {
      id = ++this.index;
    }

    return id;
  }

  get lastPatchId(): number | null {
    return this.idLine[this.idLine.length - 1] ?? null;
  }

  getDelta(id: number, fromPatchId: number | null): DeltaResult {
    const patchId = this.lastPatchId;
    try {
      if (id !== this.id) {
        throw new ErrorWithCode('store id is not equal', 'ID_IS_NOT_EQUAL');
      }
      return {
        id: this.id,
        branches: this.branches,
        patchId,
        type: 'patch',
        result: this.getPatchAfterId(fromPatchId),
      };
    } catch (err) {
      if (
        err instanceof ErrorWithCode &&
        ['ID_IS_NOT_EQUAL', 'PATCH_ID_IS_NOT_FOUND'].includes(err.code || '')
      ) {
        return {
          id: this.id,
          branches: this.branches,
          patchId,
          type: 'snapshot',
          result: this.getSnapshot(),
        };
      }
      throw err;
    }
  }

  getSnapshot(): Record<string, unknown> {
    let snapshot: Record<string, unknown>;
    if (this.branches) {
      snapshot = {};
      this.branches.forEach((key) => {
        const branch = this.store[key];
        if (!isObjectOrArray(branch)) {
          snapshot[key] = branch;
        } else {
          snapshot[key] = getSnapshot(branch as never);
        }
      });
    } else {
      snapshot = getSnapshot(this.store as never) as Record<string, unknown>;
    }
    return snapshot;
  }

  getPatchAfterId(id: number | null): IJsonPatch[] {
    if (this.lastPatchId === id) return [];
    const pos = this.idLine.indexOf(id as number);
    if (pos === -1) {
      throw new ErrorWithCode('Patch is is not found', 'PATCH_ID_IS_NOT_FOUND');
    }
    return this.patchLine.slice(pos + 1);
  }

  init(): void {
    if (this.patchDisposer) {
      this.patchDisposer();
    }

    this.patchDisposer = onPatch(this.store as never, this.handlePath);
  }

  handlePath = (patch: IJsonPatch) => {
    if (this.branchesRe) {
      if (!this.branchesRe.test(patch.path)) return;
      patch = { ...patch, path: '.' + patch.path };
    }
    this.patchLine.push(patch);
    this.idLine.push(this.patchId);
    this.timeLine.push(Date.now());

    this.callClean();
  };

  callClean(): void {
    if (this.cleanTimeoutId !== null) return;
    this.cleanTimeoutId = setTimeout(() => {
      this.cleanTimeoutId = null;
      this.clean();
    }, 1000);
  }

  clean(): void {
    const oldestTime = Date.now() - 60 * 1000;
    let cornerIndex = -1;
    for (let i = 0; i < this.timeLine.length; i++) {
      if (this.timeLine[i] < oldestTime) {
        cornerIndex = i;
      } else {
        break;
      }
    }
    if (cornerIndex !== -1) {
      this.patchLine.splice(0, cornerIndex + 1);
      this.idLine.splice(0, cornerIndex + 1);
      this.timeLine.splice(0, cornerIndex + 1);
    }
  }

  destroy(): void {
    this.store = null as unknown as Record<string, unknown>;
    if (this.patchDisposer) {
      this.patchDisposer();
      this.patchDisposer = null;
    }
    if (this.cleanTimeoutId !== null) {
      clearTimeout(this.cleanTimeoutId);
      this.cleanTimeoutId = null;
    }
    this.patchLine.splice(0);
    this.idLine.splice(0);
    this.timeLine.splice(0);
  }
}

export function isObjectOrArray(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

export default MobxPatchLine;
