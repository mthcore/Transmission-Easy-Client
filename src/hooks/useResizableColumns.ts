import { useState, useRef, useCallback, useEffect, useMemo, MouseEvent } from 'react';
import { MIN_COLUMN_WIDTH } from '../constants';

interface UseResizableColumnsProps {
  defaultWidths: Record<string, number>;
  savedWidths: Record<string, number>;
  onSave: (widths: Record<string, number>) => void;
}

interface ResizeHandleProps {
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
}

const MIN_WIDTH = MIN_COLUMN_WIDTH;

export function useResizableColumns({
  defaultWidths,
  savedWidths,
  onSave,
}: UseResizableColumnsProps) {
  const merged = useMemo(
    () => ({ ...defaultWidths, ...savedWidths }),
    [defaultWidths, savedWidths]
  );
  const [widths, setWidths] = useState<Record<string, number>>(merged);

  // Sync when savedWidths change (e.g. from storage)
  useEffect(() => {
    setWidths({ ...defaultWidths, ...savedWidths });
  }, [defaultWidths, savedWidths]);

  // Use refs for callbacks to keep event listeners stable across re-renders
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const resizeRef = useRef({ key: '', startX: 0, startWidth: 0 });
  const listenersRef = useRef<{ move: (e: globalThis.MouseEvent) => void; up: () => void } | null>(
    null
  );

  const startResize = useCallback((key: string, clientX: number, currentWidth: number) => {
    // Clean up any leftover listeners
    if (listenersRef.current) {
      document.body.removeEventListener('mousemove', listenersRef.current.move);
      document.body.removeEventListener('mouseup', listenersRef.current.up);
    }

    resizeRef.current = { key, startX: clientX, startWidth: currentWidth };

    const move = (e: globalThis.MouseEvent) => {
      // Button released outside the window: no mouseup reaches us, so the drag
      // would stay armed and keep resizing on the next mouse move
      if (e.buttons === 0) {
        up();
        return;
      }
      // RTL: columns grow leftward, so the raw delta is inverted
      const rtl = document.documentElement.dir === 'rtl' ? -1 : 1;
      const delta = (e.clientX - resizeRef.current.startX) * rtl;
      const newWidth = Math.max(MIN_WIDTH, resizeRef.current.startWidth + delta);
      setWidths((prev) => ({ ...prev, [resizeRef.current.key]: newWidth }));
    };

    const up = () => {
      document.body.removeEventListener('mousemove', move);
      document.body.removeEventListener('mouseup', up);
      listenersRef.current = null;
      setWidths((current) => {
        onSaveRef.current(current);
        return current;
      });
    };

    listenersRef.current = { move, up };
    document.body.addEventListener('mousemove', move);
    document.body.addEventListener('mouseup', up);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        document.body.removeEventListener('mousemove', listenersRef.current.move);
        document.body.removeEventListener('mouseup', listenersRef.current.up);
      }
    };
  }, []);

  const getResizeProps = useCallback(
    (key: string): ResizeHandleProps => ({
      onMouseDown: (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        startResize(key, e.clientX, widths[key] ?? defaultWidths[key] ?? 50);
      },
      onClick: (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
      },
    }),
    [widths, defaultWidths, startResize]
  );

  return { widths, getResizeProps };
}
