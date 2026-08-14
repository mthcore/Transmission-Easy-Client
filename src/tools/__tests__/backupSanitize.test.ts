import { describe, expect, it } from 'vitest';
import { getConnectionChanges, sanitizeRestoreConfig } from '../backupSanitize';

describe('sanitizeRestoreConfig', () => {
  it('keeps known config keys, including credentials (cloud backup is intentional)', () => {
    const { config, droppedKeys } = sanitizeRestoreConfig({
      hostname: 'nas.local',
      port: 9091,
      ssl: true,
      login: 'admin',
      password: 'secret',
      configVersion: 2,
    });
    expect(config).toEqual({
      hostname: 'nas.local',
      port: 9091,
      ssl: true,
      login: 'admin',
      password: 'secret',
      configVersion: 2,
    });
    expect(droppedKeys).toEqual([]);
  });

  it('drops unknown and transient keys', () => {
    const { config, droppedKeys } = sanitizeRestoreConfig({
      hostname: 'nas.local',
      _notifiedIds: [1, 2],
      evilKey: 'payload',
    });
    expect(config).toEqual({ hostname: 'nas.local' });
    expect(droppedKeys.sort()).toEqual(['_notifiedIds', 'evilKey']);
  });
});

describe('getConnectionChanges', () => {
  it('lists connection keys that differ', () => {
    const changes = getConnectionChanges(
      { hostname: 'evil.example', port: 9091, ssl: false },
      { hostname: 'nas.local', port: 9091, ssl: true, pathname: '/transmission/rpc' }
    );
    expect(changes).toEqual(['hostname: nas.local → evil.example', 'ssl: true → false']);
  });

  it('ignores keys absent from the restored blob', () => {
    expect(getConnectionChanges({}, { hostname: 'nas.local', port: 9091 })).toEqual([]);
  });
});
