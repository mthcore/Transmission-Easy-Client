import React, { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import { SPEED_LIMIT_UNIT } from '../../stores/ClientStore';

/**
 * Bandwidth groups (Transmission 4.0+, rpc 17).
 *
 * A separate component rather than another section inside ServerOptions, which
 * is already long enough that a hook declared on the wrong side of an early
 * return once shipped a "Rendered fewer hooks than expected" crash.
 *
 * group-set is an upsert keyed by name, so creating a group and editing one are
 * the same call — there is no separate create method on the daemon.
 */

interface Group {
  name: string;
  honorsSessionLimits: boolean;
  speedLimitDown: number;
  speedLimitDownEnabled: boolean;
  speedLimitUp: number;
  speedLimitUpEnabled: boolean;
}

/** Transmission expresses these in K = 1000 bytes/s, like the session limits. */
const unit = () => `${SPEED_LIMIT_UNIT === 1000 ? 'kB/s' : 'KiB/s'}`;

const BandwidthGroups = observer(() => {
  const rootStore = useRootStore();
  const client = rootStore.client;

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!client) return;
    setError('');
    client.getGroups().then(
      // Checked rather than cast: the service guarantees an array, but a cast
      // that turns out to be wrong takes the whole options page down with a
      // render error instead of failing inside this one section.
      (list) =>
        Array.isArray(list)
          ? setGroups(list as Group[])
          : setError(chrome.i18n.getMessage('unexpectedError')),
      (err: Error) => setError(`${err.name}: ${err.message}`)
    );
  }, [client]);

  // Read the flag in the render body so the observer tracks it: `client` is the
  // same MST node before and after its settings land, so an effect keyed on the
  // client alone never re-runs and the list stays empty forever.
  const supported = client?.settings?.features.groups ?? false;

  // Every hook above runs unconditionally; the feature gate is in the JSX.
  useEffect(() => {
    if (supported) refresh();
  }, [supported, refresh]);

  const save = useCallback(
    (name: string, patch: Partial<Omit<Group, 'name'>>) => {
      if (!client) return;
      setBusy(true);
      setError('');
      client
        .setSessionGroup(name, patch)
        .then(
          () => refresh(),
          (err: Error) => setError(`${err.name}: ${err.message}`)
        )
        .finally(() => setBusy(false));
    },
    [client, refresh]
  );

  const handleAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    // An upsert with no options creates the group at the daemon's defaults
    save(name, {});
    setNewName('');
  }, [newName, save]);

  if (!supported) return null;

  return (
    <div className="bandwidth-groups">
      <h3>{chrome.i18n.getMessage('bandwidthGroups')}</h3>

      {error && <p className="red">{error}</p>}

      {groups === null && !error && <div className="loading-inline" />}

      {groups?.length === 0 && <p>{chrome.i18n.getMessage('noGroupsYet')}</p>}

      {groups?.map((group) => (
        <GroupRow key={group.name} group={group} busy={busy} onSave={save} />
      ))}

      <label>
        <span>{chrome.i18n.getMessage('OV_COL_NAME')}</span>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          aria-label={chrome.i18n.getMessage('bandwidthGroup')}
        />
      </label>
      <button type="button" onClick={handleAdd} disabled={busy || !newName.trim()}>
        {chrome.i18n.getMessage('add')}
      </button>
    </div>
  );
});

interface GroupRowProps {
  group: Group;
  busy: boolean;
  onSave: (name: string, patch: Partial<Omit<Group, 'name'>>) => void;
}

const GroupRow = ({ group, busy, onSave }: GroupRowProps) => {
  // Uncontrolled inputs keyed on the value they were seeded with, so a refresh
  // after a save re-seeds them instead of fighting whatever is being typed.
  const commitNumber =
    (field: 'speedLimitDown' | 'speedLimitUp') => (e: React.FocusEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!Number.isFinite(value) || value < 0) {
        e.target.value = String(group[field]);
        return;
      }
      if (value === group[field]) return;
      onSave(group.name, { [field]: value });
    };

  return (
    <fieldset className="bandwidth-group">
      <legend>{group.name}</legend>

      <label>
        <span>{chrome.i18n.getMessage('DT_DOWNLOAD_LIMIT')}</span>
        <span className="toggle-switch">
          <input
            type="checkbox"
            checked={group.speedLimitDownEnabled}
            disabled={busy}
            onChange={() =>
              onSave(group.name, { speedLimitDownEnabled: !group.speedLimitDownEnabled })
            }
            aria-label={`${group.name} ${chrome.i18n.getMessage('DT_DOWNLOAD_LIMIT')}`}
          />
          <span className="toggle-slider"></span>
        </span>
        <input
          type="number"
          min="0"
          key={`down-${group.name}-${group.speedLimitDown}`}
          defaultValue={group.speedLimitDown}
          onBlur={commitNumber('speedLimitDown')}
          disabled={busy}
        />
        <span className="unit">{unit()}</span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('DT_UPLOAD_LIMIT')}</span>
        <span className="toggle-switch">
          <input
            type="checkbox"
            checked={group.speedLimitUpEnabled}
            disabled={busy}
            onChange={() => onSave(group.name, { speedLimitUpEnabled: !group.speedLimitUpEnabled })}
            aria-label={`${group.name} ${chrome.i18n.getMessage('DT_UPLOAD_LIMIT')}`}
          />
          <span className="toggle-slider"></span>
        </span>
        <input
          type="number"
          min="0"
          key={`up-${group.name}-${group.speedLimitUp}`}
          defaultValue={group.speedLimitUp}
          onBlur={commitNumber('speedLimitUp')}
          disabled={busy}
        />
        <span className="unit">{unit()}</span>
      </label>

      <label>
        <span>{chrome.i18n.getMessage('honorsSessionLimits')}</span>
        <span className="toggle-switch">
          <input
            type="checkbox"
            checked={group.honorsSessionLimits}
            disabled={busy}
            onChange={() => onSave(group.name, { honorsSessionLimits: !group.honorsSessionLimits })}
            aria-label={`${group.name} ${chrome.i18n.getMessage('honorsSessionLimits')}`}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>
    </fieldset>
  );
};

export default BandwidthGroups;
