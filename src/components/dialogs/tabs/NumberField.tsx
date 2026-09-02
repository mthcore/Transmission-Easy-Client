import React, { useEffect, useState } from 'react';

/**
 * Number input that tolerates being emptied. A plain controlled number input
 * snapped back to '0' the moment the field was cleared (Number('') === 0),
 * which reads as "stop seeding immediately" once applied — and as "allow no
 * peers at all" in the bandwidth tab, which shares this control.
 */
const NumberField = ({
  value,
  min,
  step,
  onChange,
}: {
  value: number;
  min: string;
  step: string;
  onChange: (value: number) => void;
}) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '') {
          const parsed = Number(e.target.value);
          // The min attribute is validation-only: a typed negative value still
          // reaches .value and would be sent to the daemon
          const floor = Number(min);
          if (Number.isFinite(parsed)) {
            onChange(Number.isFinite(floor) ? Math.max(floor, parsed) : parsed);
          }
        }
      }}
      onBlur={(e) => {
        // onChange clamps what it SENDS but keeps the raw text, so typing -5
        // left the field reading -5 while 0 was applied. Reconcile on blur —
        // the same rule ServerOptions.handleNumberBlur follows — and cover
        // unparsable text ('-', '1e'), not only the empty string.
        const parsed = Number(e.target.value);
        if (e.target.value === '' || !Number.isFinite(parsed)) {
          setText(String(value));
          return;
        }
        const floor = Number(min);
        const clamped = Number.isFinite(floor) ? Math.max(floor, parsed) : parsed;
        if (clamped !== parsed) {
          setText(String(clamped));
        }
      }}
    />
  );
};

export default NumberField;
