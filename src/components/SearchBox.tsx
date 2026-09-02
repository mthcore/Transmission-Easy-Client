import React, {
  useState,
  useRef,
  useCallback,
  ChangeEvent,
  KeyboardEvent,
  MouseEvent,
} from 'react';
import { observer } from 'mobx-react';
import useRootStore from '../hooks/useRootStore';

const SearchBox = observer(() => {
  const rootStore = useRootStore();
  const config = rootStore?.config;
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      // Both branches used to run INSIDE the setExpanded updater. Updaters run
      // in the render phase and React may invoke them twice, so the MST action
      // mutated observable state during render and could fire the clear twice.
      if (expanded) {
        // Collapsing must clear the filter, exactly like Escape: a hidden
        // input kept filtering the list with no visible indicator, and
        // torrents just seemed to be missing
        config?.setSearchQuery('');
      } else {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      setExpanded(!expanded);
    },
    [config, expanded]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      config?.setSearchQuery(e.target.value);
    },
    [config]
  );

  const handleClear = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      config?.setSearchQuery('');
      inputRef.current?.focus();
    },
    [config]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        config?.setSearchQuery('');
        setExpanded(false);
      }
    },
    [config]
  );

  const query = config?.searchQuery || '';

  return (
    <li className={`search ${expanded ? 'expanded' : ''}`}>
      {expanded && (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={chrome.i18n.getMessage('search')}
          aria-label={chrome.i18n.getMessage('search')}
        />
      )}
      <a
        onClick={handleToggle}
        title={chrome.i18n.getMessage('search')}
        aria-label={chrome.i18n.getMessage('search')}
        className="btn search-icon"
        href="#search"
      />
      {expanded && query && (
        <a
          onClick={handleClear}
          className="btn clear-icon"
          aria-label={chrome.i18n.getMessage('clearSearch')}
          href="#clear"
        />
      )}
    </li>
  );
});

export default SearchBox;
