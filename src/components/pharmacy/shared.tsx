/** Small pieces the Pharmacy tabs share. */
import { cn } from '../../lib/utils';
import { localISO } from '../../lib/localDate';
import type { DrugSchedule } from '../../types';

export function ScheduleBadge({ schedule }: { schedule: DrugSchedule }) {
  const tones: Record<DrugSchedule, string> = {
    H: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    H1: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-100',
    G: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    X: 'bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100',
    OTC: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return <span className={cn('badge', tones[schedule])}>{schedule}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

/** The date n days ago, as YYYY-MM-DD on the PC's own calendar. */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISO(d);
}

/** Whole days from today (on the PC's calendar) to a YYYY-MM-DD date; negative once it has passed. */
export function daysUntil(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((new Date(y, (m || 1) - 1, d || 1).getTime() - today) / 86_400_000);
}
