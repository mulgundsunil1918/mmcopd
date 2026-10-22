import { useCallback, useState } from 'react';

/**
 * useState that REMEMBERS the person's choice on this PC (localStorage): a sort order, a time window, a list/column view. Without it every
 * such choice was forgotten the moment they left the screen or restarted the app and the list went back to its default.
 *
 * Only a value from `allowed` is ever read back, so a stale or edited entry cannot put the screen in a state it does not know; anything
 * unreadable (storage blocked, private window) falls back to `initial`. A `null` value forgets the choice — the screen then follows the
 * clinic's own default again.
 */
export function usePersistedState<T extends string | null>(key: string, initial: T, allowed: readonly Exclude<T, null>[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && (allowed as readonly string[]).includes(raw)) return raw as T;
    } catch { /* storage unavailable — use the default */ }
    return initial;
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(v));
    } catch { /* the choice still applies for this visit */ }
  }, [key]);
  return [value, set];
}
