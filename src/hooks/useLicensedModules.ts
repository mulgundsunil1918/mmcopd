import { useQuery } from '@tanstack/react-query';

/**
 * Single source of truth for "is this module available to this clinic?" —
 * driven by the signed licence, not app_mode. Use it to gate any module-specific
 * feature woven into another screen (billing tabs, settings sections, quick-add
 * chips, WhatsApp automation…), so nothing leaks past the subscription.
 *
 *  - Base modules (reception, opd, peds, analytics) are always on.
 *  - Dev builds have everything.
 *  - While the licence hasn't loaded yet we allow (return true) to avoid flicker
 *    and never trap a clinic out of its own screens.
 */
const BASE = new Set(['reception', 'opd', 'peds', 'analytics']);

export function useLicensedModules() {
  const { data } = useQuery({
    queryKey: ['license'],
    queryFn: () => window.electronAPI.license.status(),
    staleTime: 60_000,
  });
  const modules = data?.modules as string[] | undefined;
  const isDev = data?.state === 'dev';

  const has = (m: string): boolean => {
    if (isDev) return true;
    if (BASE.has(m)) return true;
    if (!modules) return true; // not loaded — don't hide
    return modules.includes(m);
  };

  return {
    has,
    isDev,
    modules,
    /** WhatsApp Pro (Meta-API automation) — Basic clinics have `whatsapp` only. */
    whatsappPro: has('whatsapp_pro'),
    /** WhatsApp module at all (Basic or Pro). */
    whatsapp: has('whatsapp'),
  };
}
