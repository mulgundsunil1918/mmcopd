/** Small pieces every Accounts / Doctors screen shares: period chips, tiles, the date range of a chip, and "what may I do". */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatINR, todayISO } from '../../lib/utils';
import { localISO } from '../../lib/localDate';

export const inr = (n: number | null | undefined) => formatINR(Number(n) || 0);
export const MUTED = 'text-xs text-gray-500 dark:text-slate-400';
export type PeriodId = 'today' | 'yesterday' | '7d' | 'month' | 'lastmonth' | 'custom';
export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' }, { id: 'lastmonth', label: 'Last month' }, { id: 'custom', label: 'Pick days' },
];
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
export function rangeOf(id: PeriodId, custom: { from: string; to: string }): { from: string; to: string } {
  const t = todayISO();
  switch (id) {
    case 'today': return { from: t, to: t };
    case 'yesterday': return { from: addDays(-1), to: addDays(-1) };
    case '7d': return { from: addDays(-6), to: t };
    case 'month': return { from: t.slice(0, 8) + '01', to: t };
    case 'lastmonth': { const d = new Date(); d.setDate(1); d.setDate(0); const e = localISO(d); return { from: e.slice(0, 8) + '01', to: e }; }
    default: return custom;
  }
}
/** Period chips + (for "Pick days") two date boxes. Returns the chosen range. */
export function usePeriod(initial: PeriodId = 'month') {
  const [id, setId] = useState<PeriodId>(initial);
  const [custom, setCustom] = useState({ from: addDays(-6), to: todayISO() });
  const range = rangeOf(id, custom);
  const ui = (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden">
      {PERIODS.map((p) => (
        <button key={p.id} type="button" onClick={() => setId(p.id)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${id === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300 border-gray-300 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>{p.label}</button>
      ))}
      {id === 'custom' && (
        <span className="inline-flex items-center gap-1.5 ml-1">
          <input type="date" className="input w-auto py-1" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className={MUTED}>to</span>
          <input type="date" className="input w-auto py-1" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </span>
      )}
    </div>
  );
  return { id, range, ui };
}

const TONE: Record<string, string> = {
  blue: 'text-blue-700 dark:text-blue-300', green: 'text-emerald-700 dark:text-emerald-300', red: 'text-rose-700 dark:text-rose-300',
  amber: 'text-amber-700 dark:text-amber-300', gray: 'text-gray-900 dark:text-slate-100',
};
export function Tile({ label, value, sub, tone = 'gray' }: { label: string; value: string; sub?: string; tone?: keyof typeof TONE }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${TONE[tone]}`}>{value}</div>
      {sub && <div className={MUTED + ' mt-0.5'}>{sub}</div>}
    </div>
  );
}
export function usePermissions(adminPassword?: string) {
  return useQuery({ queryKey: ['acct-permissions', adminPassword || ''], queryFn: () => window.electronAPI.accounts.permissions(adminPassword), staleTime: 15_000 });
}
export const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
  part: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
  to_pay: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800',
  none: 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};
export const STATUS_LABEL: Record<string, string> = { paid: 'Paid', part: 'Part paid', to_pay: 'To pay', none: '—' };
export const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
