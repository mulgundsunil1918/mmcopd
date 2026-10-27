import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_WA_TEMPLATES, OLD_LOCAL_KEYS, readOldLocalOverrides, resolveWaTemplates, serializeWaTemplates } from '../lib/whatsappTemplates';

let carriedOver = false;      // the one-time carry-over is tried once each time the app runs

/**
 * The seven one-click WhatsApp messages as they will be sent (the built-in wording with the clinic's changes laid over it), read from the saved setting.
 *
 * It also does the ONE-TIME CARRY-OVER: older versions kept the clinic's wording in this computer's browser storage. If the saved setting is still empty and that
 * storage holds wording that differs from the built-in one, it is saved into the setting (so it is in every backup and on every computer), and the old copy is
 * removed so it can never come back over a later change. If nothing can be carried over now (read-only licence, a client PC), the old copy stays for next time.
 */
export function useWhatsAppTemplates() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const json = settings?.whatsapp_templates_json ?? '';
  const templates = useMemo(() => resolveWaTemplates(json), [json]);

  useEffect(() => {
    if (!settings || carriedOver) return;
    carriedOver = true;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    if (!storage) return;
    const hasOld = OLD_LOCAL_KEYS.some((k) => { try { return storage!.getItem(k) !== null; } catch { return false; } });
    if (!hasOld) return;
    (async () => {
      try {
        if (!(settings.whatsapp_templates_json || '').trim()) {
          const old = readOldLocalOverrides(storage);
          if (Object.keys(old).length) {
            await window.electronAPI.settings.save({ whatsapp_templates_json: serializeWaTemplates({ ...DEFAULT_WA_TEMPLATES, ...old }) });
            await qc.invalidateQueries({ queryKey: ['settings'] });
          }
        }
        for (const k of OLD_LOCAL_KEYS) { try { storage!.removeItem(k); } catch { /* storage unavailable: nothing to remove */ } }
      } catch { /* could not save now: the old copy stays and the next start tries again */ }
    })();
  }, [settings, qc]);

  return { templates, json, settings };
}
