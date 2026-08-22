import React, { ChangeEvent } from 'react';
import stripBidiControls from '../../tools/stripBidiControls';
import { observer } from 'mobx-react';
import ProgressBar from '../ProgressBar';
import type { FileEntry } from '../../types/stores';

interface FileListStore {
  filterLevel: number;
  setFilter: (filter: string) => void;
}

export interface FileColumnCtx {
  file: FileEntry;
  handleSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  fileListStore: FileListStore;
}

type ColumnRenderer = (ctx: FileColumnCtx) => React.ReactNode;

const fileColumnRenderers: Record<string, ColumnRenderer> = {
  checkbox: ({ file, handleSelect }) => (
    <td key="checkbox" className="checkbox">
      <input
        checked={file.selected}
        onChange={handleSelect}
        type="checkbox"
        aria-label={file.shortName}
      />
    </td>
  ),

  name: ({ file, fileListStore }) => (
    <td key="name" className="name">
      <FileName fileStore={file} fileListStore={fileListStore} />
    </td>
  ),

  size: ({ file }) => (
    <td key="size" className="size">
      <div>{file.sizeStr}</div>
    </td>
  ),

  downloaded: ({ file }) => (
    <td key="downloaded" className="downloaded">
      <div>{file.downloadedStr}</div>
    </td>
  ),

  done: ({ file }) => {
    const isComplete = file.size === file.downloaded && file.priority !== 0;
    const progressClass = isComplete ? 'complete' : 'downloading';
    return (
      <td key="done" className="done">
        <ProgressBar progressStr={file.progressStr} progressClass={progressClass} />
      </td>
    );
  },

  prio: ({ file }) => (
    <td key="prio" className="prio">
      <div>{file.priorityStr}</div>
    </td>
  ),
};

interface FileNameProps {
  fileStore: FileEntry;
  fileListStore: FileListStore;
}

// observer, not a plain memo: this reads the observable fileListStore.filterLevel
// while its props never change, so a memo alone left the breadcrumb frozen and
// the folder drill-down (and its "←" back entry) never rendered
const FileName = observer(({ fileStore, fileListStore }: FileNameProps) => {
  const handleSetFilter = React.useCallback(
    (level: number) => {
      let targetLevel = level;
      if (targetLevel === fileListStore.filterLevel) {
        targetLevel--;
      }
      const filter = fileStore.nameParts.slice(0, targetLevel).join('/');
      fileListStore.setFilter(filter);
    },
    [fileStore, fileListStore]
  );

  const parts: string[] = [];
  const nameParts = fileStore.nameParts;
  const filterLevel = fileListStore.filterLevel;

  for (let i = filterLevel; i < nameParts.length; i++) {
    parts.push(nameParts[i]);
  }

  // File names are attacker-controlled: strip bidi overrides so a U+202E
  // cannot spoof the displayed extension in the file list
  const filename = stripBidiControls(parts.pop() ?? '');
  const links = parts.map((name, index) => (
    // Key by depth: a path repeating a directory name ('Season 1/Season 1')
    // produced duplicate sibling keys
    <FileNamePart
      key={`${filterLevel + index + 1}:${name}`}
      onSetFilter={handleSetFilter}
      level={filterLevel + index + 1}
      name={stripBidiControls(name)}
    />
  ));

  if (filterLevel > 0) {
    const name = '\u2190';
    links.unshift(
      <FileNamePart key="__back__" onSetFilter={handleSetFilter} level={filterLevel} name={name} />
    );
  }

  return (
    <div title={stripBidiControls(fileStore.shortName)}>
      <span>
        {links}
        {filename}
      </span>
    </div>
  );
});

interface FileNamePartProps {
  level: number;
  name: string;
  onSetFilter: (level: number) => void;
}

const FileNamePart = React.memo<FileNamePartProps>(({ level, name, onSetFilter }) => {
  const handleClick = React.useCallback(() => {
    onSetFilter(level);
  }, [level, onSetFilter]);

  const classList = ['folder', `c${level - 1}`];

  return (
    <button onClick={handleClick} className={classList.join(' ')} type="button">
      {name}
    </button>
  );
});

export default fileColumnRenderers;
