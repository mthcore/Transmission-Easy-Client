import React, { useRef, useEffect } from 'react';
import { MIN_UI_UPDATE_INTERVAL } from '../constants';

interface IntervalProps {
  interval: number;
  onFire: (isInitial: boolean) => void;
}

const Interval = React.memo<IntervalProps>(({ interval, onFire }) => {
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    // Clamp here too, not only where the option is written: a tiny value
    // persisted by an older build (options used to save every keystroke)
    // would otherwise fire hundreds of RPCs per second forever
    const safeInterval = Math.max(MIN_UI_UPDATE_INTERVAL, interval || MIN_UI_UPDATE_INTERVAL);
    const intervalId = setInterval(() => {
      onFireRef.current(false);
    }, safeInterval);

    onFireRef.current(true);
    return () => {
      clearInterval(intervalId);
    };
  }, [interval]);
  return null;
});

export default Interval;
