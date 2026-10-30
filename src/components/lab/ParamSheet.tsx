import { Fragment } from 'react';
/** The boxes for one test of an order: each parameter with its unit and normal range beside it; type the value and the H / L flag appears as you type. */
import { flagFor } from '../../lib/labRanges';
import type { SheetItem } from '../../db/labParams';

const FLAG: Record<string, { text: string; cls: string }> = {
  H: { text: 'High', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200' },
  L: { text: 'Low', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  A: { text: 'Abnormal', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200' },
};

export function ParamSheet({ item, values, onChange }: { item: SheetItem; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  let last: string | null | undefined;
  const next = (e: React.KeyboardEvent<HTMLInputElement>) => {                       // Enter moves to the next box, like filling a form
    if (e.key !== 'Enter') return; e.preventDefault();
    const all = Array.from((e.currentTarget.closest('table') as HTMLElement).querySelectorAll('input[data-param]')) as HTMLInputElement[];
    all[all.indexOf(e.currentTarget) + 1]?.focus();
  };
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400"><th className="py-1 w-[34%]">Parameter</th><th className="w-[22%]">Result</th><th className="w-[12%]">Unit</th><th>Normal range</th><th className="w-20"></th></tr></thead>
      <tbody>
        {item.rows.map((r) => {
          const val = values[r.key] ?? r.value; const flag = flagFor(val, { low: r.low, high: r.high, ref_text: r.ref_text, no_flag: r.no_flag }, null);
          const head = r.grp && r.grp !== last ? <tr key={`g${r.key}`}><td colSpan={5} className="pt-2 pb-0.5 text-[11px] font-bold text-gray-600 dark:text-slate-300">{r.grp}</td></tr> : null; last = r.grp;
          return (
            <Fragment key={r.key}>{head}
              <tr className="border-t border-gray-100 dark:border-slate-800">
                <td className={`py-1 ${r.grp ? 'pl-3' : ''}`}>{r.name}</td>
                <td><input data-param className={`input py-1 ${flag ? 'border-rose-400 font-semibold' : ''}`} value={val} onChange={(e) => onChange(r.key, e.target.value)} onKeyDown={next} /></td>
                <td className="text-xs text-gray-500 dark:text-slate-400">{r.unit || ''}</td>
                <td className="text-xs text-gray-600 dark:text-slate-300">{r.range_text || '—'}</td>
                <td>{flag && <span className={`badge ${FLAG[flag].cls}`}>{FLAG[flag].text}</span>}</td>
              </tr></Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
