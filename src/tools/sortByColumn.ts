type ColumnMap = Record<string, string>;
type SpecialHandler = (value: unknown) => unknown;
type SpecialHandlers = Record<string, SpecialHandler>;

interface Sortable {
  [key: string]: unknown;
}

/**
 * Creates a sorter function for sorting items by column
 */
export function createColumnSorter<T extends Sortable>(
  columnMap: ColumnMap = {},
  specialHandlers: SpecialHandlers = {}
) {
  return function sortByColumn(items: T[], sortBy: string, direction: 1 | -1): T[] {
    const byColumn = columnMap[sortBy] || sortBy;
    const result = items.slice(0);

    const upDown: [number, number] = [-1, 1];
    if (direction === 1) {
      upDown.reverse();
    }

    result.sort((aa, bb) => {
      let a = aa[byColumn];
      let b = bb[byColumn];
      const [up, down] = upDown;

      // Apply special handlers if defined for this column
      const handler = specialHandlers[byColumn];
      if (handler) {
        a = handler(a);
        b = handler(b);
      }

      if (a === b) {
        return 0;
      }
      // Missing values always land at the end, whichever direction is active
      // (returning a direction-dependent value floated them to the top when
      // sorting ascending)
      if (a == null) return 1;
      if (b == null) return -1;
      // Names must not split into an uppercase block and a lowercase one
      if (typeof a === 'string' && typeof b === 'string') {
        const compared = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        if (compared === 0) return 0;
        return compared > 0 ? up : down;
      }
      if (a > b) {
        return up;
      }
      return down;
    });

    return result;
  };
}

// Special handler for ETA column (-1 = infinite, -2 = unknown: both sort last)
const etaHandler: SpecialHandler = (value) => ((value as number) < 0 ? Infinity : value);

// Special handler for date columns (0/null/undefined means infinite)
const dateHandler: SpecialHandler = (value) => (!value ? Infinity : value);

// -2 is Transmission's infinite-ratio sentinel: it belongs at the TOP, not
// below every finite ratio
const sharedHandler: SpecialHandler = (value) => ((value as number) === -2 ? Infinity : value);

// Pre-configured sorter for torrents
export const torrentColumnMap: ColumnMap = {
  done: 'progress',
  downspd: 'downloadSpeed',
  upspd: 'uploadSpeed',
  upped: 'uploaded',
  added: 'addedTime',
  completed: 'completedTime',
  activity: 'activityDate',
  started: 'startDate',
  edited: 'editDate',
  status: 'statusCode',
  label: 'labelsStr',
  priority: 'bandwidthPriority',
  // The cell shows activeSeeds/activePeers; without this entry the comparator
  // read an undefined property and the column silently refused to sort
  seeds_peers: 'activeSeeds',
};

export const torrentSpecialHandlers: SpecialHandlers = {
  eta: etaHandler,
  addedTime: dateHandler,
  completedTime: dateHandler,
  activityDate: dateHandler,
  startDate: dateHandler,
  editDate: dateHandler,
  shared: sharedHandler,
};

// Pre-configured sorter for files
export const fileColumnMap: ColumnMap = {
  done: 'progress',
  prio: 'priority',
};
