import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn, formatINR } from '../../lib/utils';
import { MODALITY_LABEL, RADIOLOGY_MODALITIES } from '../../data/radiology-catalog';
import type { RadiologyTest } from '../../types';

/**
 * Pick scans from the radiology catalogue — search, filter by modality (X-Ray, USG, CT, MRI…),
 * tick what is needed. Prices are shown so whoever orders can see what it will cost before
 * committing, and an unpriced scan is flagged (it is done but never added to a bill).
 *
 * Shared by the Radiology desk's "New request", the doctor's consultation panel, and
 * "Add a scan" on an existing order.
 */
export function RadiologyTestPicker({
  tests, selected, onToggle, exclude, heightClass = 'max-h-60',
}: {
  tests: RadiologyTest[];
  selected: Record<number, true>;
  onToggle: (id: number, on: boolean) => void;
  /** Lower-cased names already on the order — hidden so the same scan is not added twice. */
  exclude?: Set<string>;
  heightClass?: string;
}) {
  const [q, setQ] = useState('');
  const [mod, setMod] = useState<string>('all');

  const pool = useMemo(() => tests.filter((t) => !exclude?.has(t.name.toLowerCase())), [tests, exclude]);
  const mods = useMemo(
    () => RADIOLOGY_MODALITIES.filter((m) => pool.some((t) => t.modality === m)),
    [pool],
  );
  const needle = q.trim().toLowerCase();
  const shown = pool
    .filter((t) => mod === 'all' || t.modality === mod)
    .filter((t) => !needle || t.name.toLowerCase().includes(needle));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
        <input
          className="input pl-9"
          placeholder="Search scans — chest, knee, abdomen, brain…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...mods] as string[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMod(m)}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-full border transition',
              mod === m
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-sky-400',
            )}
          >
            {m === 'all' ? `All (${pool.length})` : `${MODALITY_LABEL[m as keyof typeof MODALITY_LABEL]} (${pool.filter((t) => t.modality === m).length})`}
          </button>
        ))}
      </div>

      <div className={cn('overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800', heightClass)}>
        {shown.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-gray-500">
            {pool.length === 0 ? 'No scans in the catalogue yet — add them under Radiology → Catalogue & Prices.' : 'No scan matches that search.'}
          </div>
        ) : (
          shown.map((t) => (
            <label key={t.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60">
              <input type="checkbox" checked={!!selected[t.id]} onChange={(e) => onToggle(t.id, e.target.checked)} />
              <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-slate-100">{t.name}</span>
              <span className="text-[10px] text-gray-400 dark:text-slate-500 hidden sm:inline">{MODALITY_LABEL[t.modality] ?? t.modality}</span>
              <span className={cn('text-[11px] tabular-nums whitespace-nowrap', t.price > 0 ? 'text-gray-600 dark:text-slate-300' : 'text-amber-600 font-semibold')}>
                {t.price > 0 ? formatINR(t.price) : 'no price'}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/** Total + a plain warning if any ticked scan has no price (it would be done but not billed). */
export function pickedSummary(tests: RadiologyTest[], selected: Record<number, true>) {
  const chosen = tests.filter((t) => selected[t.id]);
  return {
    count: chosen.length,
    total: chosen.reduce((s, t) => s + (Number(t.price) || 0), 0),
    unpriced: chosen.filter((t) => !(Number(t.price) > 0)),
  };
}
