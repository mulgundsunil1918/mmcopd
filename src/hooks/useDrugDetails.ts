import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

/** "Paracetamol · Syrup · 250 mg/5 ml" — what a medicine IS: its ingredients, its form, how strong. A dash or an empty field is left out. */
export const compositionLine = (d: { generic_name?: string | null; form?: string | null; strength?: string | null }) =>
  [d.generic_name, d.form, d.strength].filter((x) => x && x !== '—').join(' · ');

/**
 * Looks a medicine up in the Drug List by id (or, failing that, by name) and returns its composition line, so a report that only knows
 * "Calpol 250 Syrup" can print "Paracetamol · Syrup · 250 mg/5 ml" under it. One cached list for the whole screen; the key starts with
 * 'pharmacy-drugs', so adding or editing a drug refreshes it. Returns '' when the medicine is not in the Drug List (a free-text line).
 */
export function useDrugDetails() {
  const { data = [] } = useQuery({
    queryKey: ['pharmacy-drugs', 'details'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: false }),
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const byId = new Map<number, any>(data.map((d: any) => [d.id, d]));
    const byName = new Map<string, any>(data.map((d: any) => [String(d.name).trim().toLowerCase(), d]));
    const find = (id: number | null | undefined, name?: string | null) =>
      (id != null ? byId.get(id) : undefined) ?? (name ? byName.get(String(name).trim().toLowerCase()) : undefined);
    const line = (id: number | null | undefined, name?: string | null): string => { const d = find(id, name); return d ? compositionLine(d) : ''; };
    /** Just the strength ("250 mg/5 ml") — short enough to sit in brackets after a name in a chart label. */
    line.short = (id: number | null | undefined, name?: string | null): string => { const d = find(id, name); return d && d.strength && d.strength !== '—' ? String(d.strength) : ''; };
    return line;
  }, [data]);
}
