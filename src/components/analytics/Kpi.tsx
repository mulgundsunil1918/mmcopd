import { cn } from '../../lib/utils';

/** Small presentational pieces shared by the Analytics tabs. */

export function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</div>
      {subtitle && <div className="text-[11px] text-gray-500 dark:text-slate-400">· {subtitle}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone = 'blue' }: { label: string; value: string | number; sub?: string; tone?: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'indigo' | 'gray' | 'rose' }) {
  const tones: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40',
    emerald: 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40',
    amber: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40',
    red: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
    violet: 'text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-900/40',
    indigo: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-900/40',
    gray: 'text-gray-600 bg-gray-100 dark:text-slate-300 dark:bg-slate-800',
    rose: 'text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-900/40',
  };
  return (
    <div className="card p-3">
      <div className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold', tones[tone])}>{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1.5">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
