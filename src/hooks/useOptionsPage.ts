import { useCallback, useEffect, useRef, ChangeEvent } from 'react';
import useRootStore from './useRootStore';
import type { IConfigStore } from '../stores/ConfigStore';

/** Quiet period before a typed number is persisted (see handleSetInt) */
const INT_COMMIT_DELAY = 400;

export function useOptionsPage<T = IConfigStore>() {
  const rootStore = useRootStore();
  const configStore = rootStore.config;
  const intTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (intTimerRef.current) clearTimeout(intTimerRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const checkbox = e.currentTarget;
      configStore?.setOptions({
        [checkbox.name]: checkbox.checked,
      });
    },
    [configStore]
  );

  const handleSetInt = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      let value = parseInt(input.value, 10);
      if (!Number.isFinite(value)) return;
      // The HTML min/max attributes don't block typed input, and this fires
      // on every keystroke — without clamping, a half-typed '1' persists and
      // drives the polling intervals at millisecond rates
      const min = parseInt(input.min, 10);
      const max = parseInt(input.max, 10);
      if (Number.isFinite(min) && value < min) value = min;
      if (Number.isFinite(max) && value > max) value = max;
      // Debounced: a config write is broadcast to every context and refires
      // the client flush + rebuild, the DNR rewrite and the context-menu
      // rebuild, so typing '1200' used to pay for that four times.
      const name = input.name;
      if (intTimerRef.current) clearTimeout(intTimerRef.current);
      intTimerRef.current = setTimeout(() => {
        intTimerRef.current = null;
        configStore?.setOptions({ [name]: value });
      }, INT_COMMIT_DELAY);
    },
    [configStore]
  );

  // On blur, show what was actually persisted: the store gets the clamped
  // value on every keystroke, but the input kept displaying the raw typed one
  // (type 500 with min 1000 → store holds 1000, field said 500 all session)
  const handleIntBlur = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      // Leaving the field commits immediately: the debounce must not let a
      // value the user has finished typing sit unsaved
      if (intTimerRef.current) {
        clearTimeout(intTimerRef.current);
        intTimerRef.current = null;
        let value = parseInt(input.value, 10);
        if (Number.isFinite(value)) {
          const min = parseInt(input.min, 10);
          const max = parseInt(input.max, 10);
          if (Number.isFinite(min) && value < min) value = min;
          if (Number.isFinite(max) && value > max) value = max;
          configStore?.setOptions({ [input.name]: value });
          input.value = String(value);
          return;
        }
      }
      const stored = (configStore as unknown as Record<string, unknown> | undefined)?.[input.name];
      if (typeof stored === 'number' && input.value !== String(stored)) {
        input.value = String(stored);
      }
    },
    [configStore]
  );

  const handleRadioChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const radio = e.currentTarget;
      configStore?.setOptions({
        [radio.name]: radio.value,
      });
    },
    [configStore]
  );

  return {
    rootStore,
    configStore: configStore as unknown as T,
    handleChange,
    handleSetInt,
    handleIntBlur,
    handleRadioChange,
  };
}
