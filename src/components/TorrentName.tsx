import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ANIMATION_TIME_MULTIPLIER } from '../constants';

interface StyleCacheEntry {
  style: HTMLStyleElement;
  useCount: number;
}

// Global style cache for TorrentName animations
const styleCache = new Map<string, StyleCacheEntry>();

function getOrCreateStyle(moveName: string, width: number, elWidth: number): string {
  const existing = styleCache.get(moveName);
  if (existing) {
    existing.useCount++;
    return moveName;
  }

  const timeCalc = Math.round((elWidth / width) * ANIMATION_TIME_MULTIPLIER);
  const style = document.createElement('style');
  style.classList.add(moveName);
  style.textContent = `@keyframes a_${moveName}{0%{margin-left:2px;}50%{margin-left:-${elWidth - width}px;}90%{margin-left:6px;}100%{margin-left:2px;}}div.${moveName}:hover>span{overflow:visible;animation:a_${moveName} ${timeCalc}s;}`;
  document.body.appendChild(style);

  styleCache.set(moveName, { style, useCount: 1 });
  return moveName;
}

function releaseStyle(moveName: string | null): void {
  if (!moveName) return;
  const cached = styleCache.get(moveName);
  if (!cached) return;

  cached.useCount--;

  if (cached.useCount <= 0) {
    cached.style.remove();
    styleCache.delete(moveName);
  }
}

interface TorrentNameProps {
  name: string;
  width: number;
  title?: string;
}

const TorrentName = React.memo<TorrentNameProps>(({ name, width, title }) => {
  const [movebleClassName, setMovebleClassName] = useState<string | null>(null);
  const [shouldUpdateCalc, setShouldUpdateCalc] = useState(true);
  const refSpan = useRef<HTMLSpanElement>(null);
  const prevNameRef = useRef(name);
  const prevWidthRef = useRef(width);
  const acquiredClassRef = useRef<string | null>(null);

  // Reset calculation flag when name or width changes
  useEffect(() => {
    if (prevNameRef.current !== name || prevWidthRef.current !== width) {
      setShouldUpdateCalc(true);
      prevNameRef.current = name;
      prevWidthRef.current = width;
    }
  }, [name, width]);

  // Releases the previous class when it changes, and on unmount. This is the
  // ONLY release path: releasing in the handler too double-decremented the
  // shared refcount and deleted a <style> other rows were still using.
  useEffect(() => {
    return () => releaseStyle(movebleClassName);
  }, [movebleClassName]);

  const handleMouseEnter = useCallback(() => {
    setShouldUpdateCalc(false);

    const spanWidth = refSpan.current?.offsetWidth || 0;
    if (spanWidth < width) {
      setMovebleClassName(null);
      return;
    }

    // Round elWidth to reduce unique style combinations
    let elWidth = Math.ceil(spanWidth / 50) * 50;
    if (elWidth < 100) elWidth = 100;

    const moveName = `mv_${width}_${elWidth}`;
    // Acquire once per distinct class: re-hovering the same bucket would
    // otherwise bump the refcount with no matching release
    if (moveName === acquiredClassRef.current) return;
    getOrCreateStyle(moveName, width, elWidth);
    acquiredClassRef.current = moveName;
    setMovebleClassName(moveName);
  }, [width]);

  const classList = ['title'];
  if (!shouldUpdateCalc && movebleClassName) {
    classList.push(movebleClassName);
  }

  return (
    <div className={classList.join(' ')}>
      <span
        ref={refSpan}
        onMouseEnter={shouldUpdateCalc ? handleMouseEnter : undefined}
        title={title ?? name}
      >
        {name}
      </span>
    </div>
  );
});

export default TorrentName;
