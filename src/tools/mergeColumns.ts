import type { ColumnConfig } from '../types';

function mergeColumns(columns: ColumnConfig[], defColumns: ColumnConfig[]): ColumnConfig[] {
  const defIdIndex: Record<string, number> = {};

  const defIdColumn = defColumns.reduce(
    (result, item, index) => {
      defIdIndex[item.column] = index;
      result[item.column] = item;
      return result;
    },
    {} as Record<string, ColumnConfig>
  );

  const removedIds = Object.keys(defIdColumn);
  const unknownColumns: ColumnConfig[] = [];

  columns.forEach((column) => {
    const id = column.column;

    const pos = removedIds.indexOf(id);
    if (pos !== -1) {
      removedIds.splice(pos, 1);
    } else {
      unknownColumns.push(column);
    }

    const normColumn = { ...defIdColumn[id], ...column };
    Object.assign(column, normColumn);
  });

  // Drop columns the defaults no longer define BEFORE inserting the new ones,
  // so the insertion positions aren't shifted by entries about to disappear.
  unknownColumns.forEach((column) => {
    const pos = columns.indexOf(column);
    if (pos !== -1) {
      columns.splice(pos, 1);
    }
  });

  // Insert each missing column next to the neighbour it follows in the
  // defaults, instead of at its absolute default index: the stored array is
  // the user's own order (drag & drop), so an absolute index dropped new
  // columns in the middle of a reordered list.
  removedIds
    .slice()
    .sort((a, b) => defIdIndex[a] - defIdIndex[b])
    .forEach((id) => {
      const column = { ...defIdColumn[id] };
      const defPos = defIdIndex[id];
      // Place it after the nearest preceding default column the user still
      // has; with none present it belongs ahead of everything we know.
      let insertAt: number | null = null;
      for (let i = defPos - 1; i >= 0 && insertAt === null; i--) {
        const pos = columns.findIndex((item) => item.column === defColumns[i].column);
        if (pos !== -1) {
          insertAt = pos + 1;
        }
      }
      columns.splice(insertAt ?? 0, 0, column);
    });

  return columns;
}

export default mergeColumns;
