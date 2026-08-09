import { useEffect, useState } from 'react';

/**
 * A numeric input that does NOT suffer the classic controlled-`<input type="number">`
 * leading-zero bug.
 *
 * Why this exists: with a native number input, React compares the DOM value to the
 * prop with LOOSE equality (`node.value != value`). Typing "5000" into a field that
 * shows "0" briefly makes the DOM "05000"; `Number("05000")` is 5000, so state is
 * right, but `"05000" != 5000` is false, so React never repaints — the stray leading
 * zero sticks on screen. See WardsBedsEditor bug report.
 *
 * This component sidesteps it entirely: it is a plain text input with `inputMode`
 * numeric, it owns its display string, strips junk + leading zeros as you type, and
 * emits a clean number. An empty field means 0, so there is never a "0" to type over.
 */
export interface NumberInputProps {
  value: number | null | undefined;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** "05000" -> "5000", but keep a lone "0" and decimals like "0.5". */
function stripLeadingZeros(s: string): string {
  return s.replace(/^0+(?=\d)/, '');
}

export function NumberInput({
  value, onChange, allowDecimal = false, min, max, className, placeholder, id, disabled, ...rest
}: NumberInputProps) {
  // Display string. '' represents 0/unset — so there is no leading "0" to append to.
  const [text, setText] = useState(() => (value ? String(value) : ''));

  // Re-sync when the external value changes for a reason other than our own typing
  // (e.g. the form was reset, or a different row loaded into the editor).
  useEffect(() => {
    const shown = text === '' || text === '.' ? 0 : Number(text);
    if (Number.isFinite(shown) && shown !== (value ?? 0)) {
      setText(value ? String(value) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (raw: string) => {
    let cleaned = raw.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
    if (allowDecimal) {
      const parts = cleaned.split('.');
      if (parts.length > 1) cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
    cleaned = stripLeadingZeros(cleaned);
    setText(cleaned);
    const n = cleaned === '' || cleaned === '.' ? 0 : Number(cleaned);
    onChange(Number.isFinite(n) ? n : 0);
  };

  const clampOnBlur = () => {
    let n = text === '' || text === '.' ? 0 : Number(text);
    if (!Number.isFinite(n)) n = 0;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    setText(n ? String(n) : '');
    onChange(n);
  };

  return (
    <input
      {...rest}
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      className={className}
      placeholder={placeholder ?? '0'}
      value={text}
      disabled={disabled}
      onChange={(e) => handle(e.target.value)}
      onBlur={clampOnBlur}
    />
  );
}
