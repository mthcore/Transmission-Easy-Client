import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { types, destroy, Instance } from 'mobx-state-tree';

const callApi = vi.hoisted(() =>
  vi.fn((_message: Record<string, unknown>) => Promise.resolve({} as unknown))
);
vi.mock('../../tools/callApi', () => ({ default: callApi }));

import ClientStore from '../ClientStore';
import { SETTING_DESCRIPTORS, describeSetting } from '../../protocol/settings';

/**
 * The store's session setters read which message field carries the value from
 * the protocol table, rather than restating it. The background dispatcher reads
 * the same entry to build the daemon payload, so a setter that spells the field
 * out again is a second statement of the same fact — and the two can disagree
 * without anything failing, because a message with the wrong field is still a
 * valid message. It reaches the daemon and sets nothing.
 *
 * This file is the reason that stays true: every setting is driven through the
 * store and the field it puts the value in is compared against the table.
 */

const syncClient = vi.fn(() => Promise.resolve());

const TestRoot = types
  .model('TestRoot', { client: types.optional(ClientStore, {}) })
  .actions(() => ({ syncClient }));

type ITestRoot = Instance<typeof TestRoot>;

let root: ITestRoot | null = null;

function createClient() {
  root = TestRoot.create({});
  return root.client as unknown as Record<string, (value: unknown) => Promise<unknown>>;
}

/** A value of the type the descriptor declares. */
const sampleFor = (type: string) => (type === 'boolean' ? true : type === 'number' ? 4242 : 'x');

beforeEach(() => {
  callApi.mockClear();
  syncClient.mockClear();
});

afterEach(() => {
  if (root) destroy(root);
  root = null;
});

/** Every setting the table says the UI can send. */
const dispatchable = Object.keys(SETTING_DESCRIPTORS).filter((name) => describeSetting(name));

describe('ClientStore — the session settings', () => {
  it('has one store action per dispatchable setting', () => {
    // A setting in the table with no way to reach it from a page is a setting
    // that exists only in the protocol.
    const client = createClient();
    const missing = dispatchable.filter((name) => typeof client[name] !== 'function');

    expect(missing).toEqual([]);
  });

  it.each(dispatchable)('%s sends the value in the field the table names', async (name) => {
    const client = createClient();
    const setting = describeSetting(name)!;
    const value = sampleFor(setting.type);

    await client[name](value);

    expect(callApi).toHaveBeenCalledWith({ action: name, [setting.arg]: value });
  });

  it.each(dispatchable)('%s refreshes the mirrored state afterwards', async (name) => {
    // Without this the page shows the old value until the next poll, and a
    // toggle appears not to have worked.
    const client = createClient();
    await client[name](sampleFor(describeSetting(name)!.type));

    expect(syncClient).toHaveBeenCalled();
  });

  it('does not send a setting the table does not describe', async () => {
    // Reaching the generic path with an unknown name would put the value in
    // `undefined` and the daemon would accept a message that sets nothing.
    const client = createClient();
    const applySetting = (client as unknown as Record<string, unknown>).setDhtEnabled;
    expect(typeof applySetting).toBe('function');

    // The factory itself is not exported; this asserts the property it gives
    // every setter — the field comes from the table, so an entry with no field
    // has no setter to call in the first place.
    const undescribed = Object.keys(SETTING_DESCRIPTORS).filter((n) => !describeSetting(n));
    for (const name of undescribed) {
      expect(callApi).not.toHaveBeenCalledWith(expect.objectContaining({ action: name }));
    }
  });
});

describe('ClientStore — the settings stay table-driven', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ClientStore.ts'), 'utf8');

  /**
   * Actions written out by hand, in either form: the one-line
   * `callApi({ action: 'x', field })` and the wrapped one whose object spans
   * several lines. Matching only the first would let a multi-line setter past
   * the guard below — which is exactly the shape the longest ones use.
   */
  const handWrittenActions = () =>
    [...source.matchAll(/callApi\(\{\s*action: '(\w+)'/g)].map((match) => match[1]);

  it('spells no setting field out by hand', () => {
    // The point of the consolidation. A setter written the old way passes every
    // other test in this file — it would send the right field today — and then
    // drifts from the table the first time the message changes.
    const handWritten = handWrittenActions().filter((action) => describeSetting(action));

    expect(handWritten).toEqual([]);
  });

  it('still writes the actions that are not settings by hand', () => {
    // The table earns its place because the settings share one shape. These do
    // not — they are torrent-scoped or carry several values — and forcing them
    // through it would be the abstraction eating its own justification.
    const handWritten = new Set(handWrittenActions());

    expect(handWritten.has('setSeedLimits')).toBe(true);
    expect(handWritten.has('setTorrentLimits')).toBe(true);
    expect(handWritten.has('rename')).toBe(true);
    expect(handWritten.size).toBeGreaterThan(10);
  });
});
