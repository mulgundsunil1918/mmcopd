import { useEffect } from 'react';

export function useKeyboardShortcut(
  combo: { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string },
  handler: () => void,
  deps: unknown[] = []
) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (combo.ctrl && !(e.ctrlKey || e.metaKey)) return;
      if (combo.shift && !e.shiftKey) return;
      if (combo.alt && !e.altKey) return;
      if (e.key.toLowerCase() !== combo.key.toLowerCase()) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
