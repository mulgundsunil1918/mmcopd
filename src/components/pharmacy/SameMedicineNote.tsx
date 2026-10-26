/**
 * Under the ingredient / strength / form of a drug being added or edited: says which drugs it will sit with. A brand is "stuck" to its
 * generic (and to the other brands) by its composition alone — so as soon as the three are written the same way, it joins them and nobody
 * links anything by hand. When they are not written well enough to be matched, this says what is missing instead of failing silently.
 */
import { useQuery } from '@tanstack/react-query';
import { medicineKey, siblingsOf } from '../../lib/medicineGroups';

export function SameMedicineNote({ id, generic, strength, form }: { id?: number; generic?: string | null; strength?: string | null; form?: string | null }) {
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });
  const me = { id: id ?? -1, name: '', generic_name: generic ?? null, strength: strength ?? null, form: form ?? null };
  const key = medicineKey(me);
  if (!key) {
    if (!String(generic ?? '').trim()) return null;               // nothing to match on yet — say nothing
    return (
      <div className="text-[11px] text-gray-500 dark:text-slate-400" data-testid="same-medicine-hint">
        To sit with the same medicine under other brands, write the generic name, the <b>strength with its unit</b> (like 650 mg or 250 mg/5 ml) and the form.
      </div>
    );
  }
  const same = siblingsOf(drugs as any[], { ...me, medicine_key: key } as any);
  if (!same.length) return null;
  return (
    <div className="text-[11px] rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100 px-2.5 py-1.5" data-testid="same-medicine-note">
      <b>Sits with</b> {same.slice(0, 4).map((d: any) => d.name).join(' · ')}{same.length > 4 ? ` +${same.length - 4} more` : ''} — the same medicine (same ingredient, strength and form) under {same.length === 1 ? 'another brand' : 'other brands'}.
      Stock of all of them is shown together, and a prescription written for the generic can be given from any of them.
    </div>
  );
}
