import { useCallback, ChangeEvent } from 'react';
import useRootStore from './useRootStore';
import type { IConfigStore } from '../stores/ConfigStore';

export function useOptionsPage<T = IConfigStore>() {
  const rootStore = useRootStore();
  const configStore = rootStore.config;

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
      configStore?.setOptions({
        [input.name]: value,
      });
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
    handleRadioChange,
  };
}
