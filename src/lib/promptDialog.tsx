import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A drop-in async replacement for window.prompt(), which Electron does not
 * support ("prompt() is not supported" — it crashes the renderer).
 *
 * Usage:  const value = await promptDialog('Section title', 'Examination');
 * Resolves to the entered string, or null if cancelled.
 *
 * Renders its own modal into a detached root so it can be called from anywhere,
 * without a provider at the app root.
 */
export interface PromptOptions {
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'number';
  multiline?: boolean;
  confirmLabel?: string;
}

export function promptDialog(message: string, options: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (val: string | null) => {
      root.unmount();
      host.remove();
      resolve(val);
    };
    root.render(<PromptModal message={message} options={options} onDone={done} />);
  });
}

function PromptModal({ message, options, onDone }: { message: string; options: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(options.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  // Keep the latest value in a ref so the keydown handler can read it without
  // re-subscribing (and re-selecting) on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Focus + select ONCE on mount. Doing this on every value change would
  // re-select the text after each keystroke, so the next key would overwrite it
  // and the field would never hold more than one character.
  useEffect(() => {
    inputRef.current?.focus();
    (inputRef.current as HTMLInputElement)?.select?.();
  }, []);

  // Enter to confirm, Esc to cancel — subscribed once, reads value from the ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone(null);
      if (e.key === 'Enter' && !options.multiline) { e.preventDefault(); onDone(valueRef.current); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options.multiline, onDone]);

  return (
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" onClick={() => onDone(null)}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100 mb-3 whitespace-pre-wrap">{message}</div>
        {options.multiline ? (
          <textarea
            ref={inputRef as any}
            className="input w-full" rows={3}
            placeholder={options.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            ref={inputRef as any}
            className="input w-full"
            type={options.type === 'number' ? 'number' : 'text'}
            placeholder={options.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost text-sm" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn-primary text-sm" onClick={() => onDone(value)}>{options.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
