import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Rows rendered beyond each edge of the viewport, so fast scrolling and
 * keyboard navigation never hit a blank strip */
const OVERSCAN = 15;

/** Until the first real row is measured */
const DEFAULT_ROW_HEIGHT = 27;

export interface VirtualRows {
  /** First rendered row index (inclusive) */
  start: number;
  /** Last rendered row index (exclusive) */
  end: number;
  /** Height of the spacer above the rendered slice, px */
  padTop: number;
  /** Height of the spacer below the rendered slice, px */
  padBottom: number;
  /** Attach to the scroll container's onScroll (compose with other handlers) */
  onScroll: () => void;
  /** Ref for the tbody, used to measure the real row height */
  bodyRef: RefObject<HTMLTableSectionElement | null>;
}

/**
 * Fixed-height row windowing for the torrent table. With no windowing, 2000
 * torrents were 2000 live <tr> (38k DOM nodes, 128 MB heap) and every sort or
 * select-all re-rendered them all — 0.5-0.9s per interaction. Rendering only
 * the viewport (~30 rows) plus overscan makes those costs independent of
 * library size.
 *
 * Row height is uniform by construction (single-line cells) and measured from
 * the first rendered row, so zoom levels and font settings are respected.
 */
export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number
): VirtualRows {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const frameRef = useRef(0);

  const computeRange = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const viewTop = container.scrollTop;
    const viewHeight = container.clientHeight || 600;
    const start = Math.max(0, Math.floor(viewTop / rowHeight) - OVERSCAN);
    const visible = Math.ceil(viewHeight / rowHeight) + OVERSCAN * 2;
    const end = Math.min(rowCount, start + visible);
    // Functional update: scroll events outnumber actual range changes, and a
    // same-value set skips the re-render entirely
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [scrollRef, rowHeight, rowCount]);

  // One rAF per burst of scroll events
  const onScroll = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      computeRange();
    });
  }, [computeRange]);

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // Recompute when the list length or row height changes, and on resize
  useEffect(() => {
    computeRange();
    window.addEventListener('resize', computeRange);
    return () => window.removeEventListener('resize', computeRange);
  }, [computeRange]);

  // After every commit: measure the real row height (querySelector skips the
  // spacer rows), and self-heal drift — a scroll event can slip past the rAF
  // throttle during a long render, or the browser can rewrite scrollTop
  // (anchoring, zoom), leaving the window stranded away from the viewport.
  // Deliberately dependency-free: it must observe EVERY commit (polls replace
  // rows without any dep changing); setRowHeight is gated on a >0.5px delta
  // and computeRange on an actual range change, so the chain terminates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const rows = bodyRef.current?.querySelectorAll<HTMLTableRowElement>(
      'tr:not([data-virtual-spacer])'
    );
    if (rows && rows.length) {
      // Minimum over a few rows: a single outlier (a glyph the CSS clamp
      // missed) must not poison the uniform height and strand the window
      let measured = Infinity;
      for (let i = 0; i < rows.length && i < 5; i++) {
        const h = rows[i].offsetHeight;
        if (h > 0 && h < measured) measured = h;
      }
      if (Number.isFinite(measured) && Math.abs(measured - rowHeight) > 0.5) {
        setRowHeight(measured);
      }
    }
    computeRange();
  });

  const start = Math.min(range.start, Math.max(0, rowCount - 1));
  const end = Math.max(start, Math.min(range.end, rowCount));
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
    onScroll,
    bodyRef,
  };
}
