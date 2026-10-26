/**
 * The discount box on a pharmacy sale (the counter sale and the dispensing of a prescription).
 *
 * The person chooses how to give it — as a PERCENTAGE of the bill (the first choice) or as a plain amount in RUPEES — and types the figure; what they type is what
 * counts. The percentage is worked out in rupees on the screen (the sale engine takes rupees), and a percentage is remembered on the sale, so the receipt can say
 * "Discount (5%)" instead of only "− ₹15.62". Switching the choice keeps the SAME discount (5% of ₹312.45 becomes ₹15.62, and back).
 */
import { useState } from 'react';
import { cn, formatINR } from '../../lib/utils';

export type DiscountMode = 'pct' | 'amt';
const r2 = (n: number) => Math.round(n * 100) / 100;

export function useSaleDiscount(subtotal: number) {
  const [mode, setModeRaw] = useState<DiscountMode>('pct');
  const [typed, setTyped] = useState('');                     // exactly what the person typed ("03" stays "03")
  const n = Number(typed);
  const num = Number.isFinite(n) && n > 0 ? n : 0;
  const tooMuch = mode === 'pct' ? num > 100 : num > subtotal + 0.004;
  /** The discount in rupees: a percentage of the bill, or the amount typed. Nothing is taken off while the figure is impossible (over 100%, or more than the bill). */
  const amount = tooMuch ? 0 : r2(mode === 'pct' ? (subtotal * num) / 100 : Math.min(subtotal, num));
  /** The percentage, when that is how it was typed (so it can be remembered and printed). */
  const pct = mode === 'pct' && amount > 0 ? r2(num) : null;
  const problem = tooMuch ? (mode === 'pct' ? 'A discount cannot be more than 100%.' : 'A discount cannot be more than the bill.') : null;
  const setMode = (next: DiscountMode) => {
    if (next === mode) return;
    // the same discount, written the other way
    if (next === 'amt') setTyped(amount > 0 ? String(amount) : '');
    else setTyped(subtotal > 0 && amount > 0 ? String(r2((amount / subtotal) * 100)) : '');
    setModeRaw(next);
  };
  return { mode, setMode, typed, setTyped, amount, pct, problem };
}
export type SaleDiscount = ReturnType<typeof useSaleDiscount>;

/** "Discount  [ % | ₹ ] [ 5 ]" with what it comes to underneath. `over` = more than the signed-in role may give (the red border the old box had). */
export function DiscountRow({ d, subtotal, over = false }: { d: SaleDiscount; subtotal: number; over?: boolean }) {
  const other = d.mode === 'pct'
    ? (d.amount > 0 ? `= ${formatINR(d.amount)} off` : '')
    : (d.amount > 0 && subtotal > 0 ? `= ${r2((d.amount / subtotal) * 100)}% off` : '');
  const seg = (m: DiscountMode, label: string, title: string) => (
    <button type="button" title={title} aria-pressed={d.mode === m} onClick={() => d.setMode(m)}
      className={cn('px-2.5 py-1 leading-none transition', d.mode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700')}>
      {label}
    </button>
  );
  return (
    <>
      <div className="flex justify-between text-xs items-center gap-2">
        <span>Discount</span>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-md border border-gray-300 dark:border-slate-600 overflow-hidden text-[12px] font-semibold" role="group" aria-label="Give the discount as a percentage or as an amount in rupees">
            {seg('pct', '%', 'Discount as a percentage of the bill')}
            {seg('amt', '₹', 'Discount as an amount in rupees')}
          </div>
          <input
            type="number" min={0} max={d.mode === 'pct' ? 100 : undefined} step="any" inputMode="decimal"
            aria-label={d.mode === 'pct' ? 'Discount in percent' : 'Discount in rupees'} placeholder="0"
            className={cn('input w-24 text-right py-1', (over || d.problem) && 'border-red-400 focus:ring-red-300')}
            value={d.typed} onFocus={(e) => e.target.select()} onChange={(e) => d.setTyped(e.target.value)}
          />
        </div>
      </div>
      {(other || d.problem) && (
        <div className={cn('text-[10px] text-right', d.problem ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-slate-400')}>{d.problem ?? other}</div>
      )}
    </>
  );
}
