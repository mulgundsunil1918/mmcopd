/**
 * Small pieces shared by the bill-import screens: coloured notices, the match badges, the red box on a field that still needs filling,
 * and the three-step header.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { HelpTip } from '../../HelpTip';
import type { MatchKind } from '../../../lib/billImport';

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'gray';

const TONE: Record<Tone, string> = {
  red: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200',
  amber: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200',
  green: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200',
  blue: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100',
  gray: 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-300',
};
const ICON = { red: XCircle, amber: AlertTriangle, green: CheckCircle2, blue: Info, gray: Info } as const;

/** A coloured notice: an icon, a bold title and the plain-words detail. */
export function Banner({ tone = 'blue', title, children, className, icon = true }: {
  tone?: Tone; title?: string; children?: React.ReactNode; className?: string; icon?: boolean;
}) {
  const I = ICON[tone];
  return (
    <div className={cn('rounded-lg border p-3 text-xs leading-relaxed', TONE[tone], className)} role={tone === 'red' ? 'alert' : undefined}>
      <div className="flex gap-2">
        {icon && <I className="w-4 h-4 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1 space-y-1">
          {title && <div className="font-semibold text-[13px]">{title}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The red box: a field that must be filled (or fixed) before the bill can be imported. */
export const errCls = (bad: boolean): string => (bad ? 'border-red-500 bg-red-50 dark:bg-red-900/20 ring-1 ring-red-300 dark:ring-red-800' : '');
/** The amber box: worth a second look, does not block the import. */
export const warnCls = (warn: boolean): string => (warn ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-900/10' : '');

/** A field label with a little "?" that explains the word in plain language. */
export function Tip({ label, title, align, children }: { label: string; title?: string; align?: 'left' | 'right'; children: React.ReactNode }) {
  return <label className="label inline-flex items-center gap-1">{label}<HelpTip title={title ?? label.replace(/[ *₹%]+$/, '')} align={align}>{children}</HelpTip></label>;
}

/** How a name on the bill was matched to the Drug List, in words. `sure` = nothing for the person to confirm. */
export function matchInfo(kind: MatchKind): { label: string; tone: Tone; sure: boolean } {
  switch (kind) {
    case 'exact': return { label: 'Same as your Drug List', tone: 'green', sure: true };
    case 'alias': return { label: 'Remembered from an earlier bill', tone: 'green', sure: true };
    case 'close': return { label: 'Close match — please confirm', tone: 'amber', sure: false };
    case 'ingredient': return { label: 'Same medicine, another brand — please check', tone: 'amber', sure: false };
    case 'lookup': return { label: 'Found by ChatGPT’s lookup — please check', tone: 'amber', sure: false };
    case 'ambiguous': return { label: 'Could be more than one — please choose', tone: 'red', sure: false };
    default: return { label: 'Not in your Drug List', tone: 'red', sure: false };
  }
}

const PILL: Record<Tone, string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  gray: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
};
export function Pill({ tone = 'gray', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight', PILL[tone], className)}>{children}</span>;
}

/** "Step 1 of 3" — the three things a person does, with the current one highlighted. */
export function Stepper({ step, labels, onGo }: { step: number; labels: string[]; onGo?: (n: number) => void }) {
  return (
    <ol className="flex items-center gap-2 w-full" aria-label="Steps">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'now' : 'todo';
        const clickable = !!onGo && n < step;
        return (
          <li key={label} className="flex items-center gap-2 flex-1 min-w-0" aria-current={state === 'now' ? 'step' : undefined}>
            <button type="button" disabled={!clickable} onClick={() => onGo?.(n)}
              className={cn('flex items-center gap-2 min-w-0 text-left', clickable ? 'cursor-pointer' : 'cursor-default')}>
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                state === 'done' && 'bg-emerald-600 text-white', state === 'now' && 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/50',
                state === 'todo' && 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-300')}>
                {state === 'done' ? '✓' : n}
              </span>
              <span className={cn('truncate text-xs font-semibold', state === 'now' ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400')}>{label}</span>
            </button>
            {i < labels.length - 1 && <span className={cn('h-0.5 flex-1 rounded', n < step ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-700')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** A titled block on the review screen. */
export function Section({ title, hint, right, children, className }: { title: string; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-gray-200 dark:border-slate-700 p-3 space-y-3', className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</h3>
          {hint && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Entering a number box selects what is in it, so typing replaces the value rather than sitting beside it. */
export const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

/** A number box value: '' → null. */
export const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));
