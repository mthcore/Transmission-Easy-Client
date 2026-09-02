import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SETTING_DESCRIPTORS, describeSetting } from '../settingDescriptors';

/**
 * The table says which message field carries each setting's value. Nothing at
 * compile time ties that name to the message union — `arg: 'speed'` on a
 * setting whose message calls the field `value` type-checks perfectly and
 * sends `undefined` to the daemon at runtime.
 *
 * So the two are compared here, by reading the message declarations. The
 * failure this prevents is silent: the setting appears to work, the daemon
 * accepts the request, and the value never arrives.
 */

const MESSAGES = fs.readFileSync(path.join(__dirname, '../../types/messages.ts'), 'utf8');

/** `type SpeedEnabledAction =\n  | 'setDhtEnabled'\n  | ...;` */
function unionMembers(name: string): string[] {
  const match = new RegExp(`type ${name} =([^;]*);`).exec(MESSAGES);
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
}

/**
 * action name -> the fields its message declares. An interface either names
 * its action directly (`action: 'setEncryption'`) or through a union shared by
 * several settings (`action: SpeedEnabledAction`); both forms are resolved.
 */
function fieldsByAction(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const block of MESSAGES.matchAll(/interface \w+ \{([^}]*)\}/g)) {
    const body = block[1];
    const action = /^\s*action:\s*([^;]+);/m.exec(body);
    if (!action) continue;
    const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    const raw = action[1].trim();
    const names = raw.startsWith("'") ? [raw.slice(1, -1)] : unionMembers(raw);
    for (const name of names) result.set(name, fields);
  }
  return result;
}

const FIELDS = fieldsByAction();

describe('the setting descriptor table', () => {
  it('read the message declarations', () => {
    // Without this a parse that matched nothing would make the suite vacuous.
    expect(FIELDS.size).toBeGreaterThan(40);
    expect(FIELDS.get('setEncryption')).toContain('mode');
    expect(FIELDS.get('setDhtEnabled')).toContain('enabled');
  });

  it.each(Object.keys(SETTING_DESCRIPTORS))(
    '%s reads a field its message actually declares',
    (action) => {
      const descriptor = describeSetting(action);
      // An entry with no `arg` is deliberately not dispatched; it has no
      // message to disagree with.
      if (!descriptor) return;
      expect(FIELDS.get(action), `${action} has no message in the union`).toBeDefined();
      expect(FIELDS.get(action)).toContain(descriptor.arg);
    }
  );

  it('does not dispatch a setting the message union does not carry', () => {
    // Serving one would send `undefined` as the value. Every entry currently
    // has a message; this is what keeps that true.
    for (const [action, descriptor] of Object.entries(SETTING_DESCRIPTORS)) {
      if ('arg' in descriptor) continue;
      expect(describeSetting(action)).toBeUndefined();
    }
    const undeclared = Object.keys(SETTING_DESCRIPTORS).filter((a) => !FIELDS.has(a));
    expect(undeclared).toEqual([]);
  });

  it('is not consulted for an action outside the table', () => {
    expect(describeSetting('setPriority')).toBeUndefined();
    expect(describeSetting('noSuchAction')).toBeUndefined();
  });
});
