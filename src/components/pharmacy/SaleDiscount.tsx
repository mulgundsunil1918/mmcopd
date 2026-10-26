/**
 * The discount box on a pharmacy sale (the counter sale and the dispensing of a prescription).
 *
 * The discount is given as a PERCENTAGE of the bill (the owner's choice, 2026-10-26: "percentage only"). The person types the percentage; the rupees it comes to are
 * worked out on the screen (the sale engine takes rupees) and shown under the box, and the percentage is remembered on the sale so the receipt can say
 * "Discount (5%)". The rupees are never rounded up, so typing exactly your limit is never refused for half a paisa (see percentDiscountPaise).
 */
import { useState } from 'react';
import { cn, formatINR } from '../../lib/utils';
import { percentDiscountPaise } from '../../lib/discountLimit';
import { fromPaise } from '../../lib/pharmacyMath';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** `subtotalPaise` = the value of the sale before the discount, in whole paise (saleSubtotalPaise). */
export function useSaleDiscount(subtotalPaise: number) {
  const [typed, setTyped] = useState('');                     // exactly what the person typed ("03" stays "03")
  const n = Number(typed);
  const num = Number.isFinite(n) && n > 0 ? n : 0;
  const tooMuch = num > 100;
  const pctUsed = tooMuch ? 0 : r2(num);                      // a percentage to two decimals: what is worked out AND what is printed
  /** The discount in rupees. Nothing is taken off while the figure is impossible (over 100%). */
  const amount = fromPaise(percentDiscountPaise(subtotalPaise, pctUsed));
  /** The percentage to remember on the sale (null = no discount). */
  const pct = amount > 0 ? pctUsed : null;
  const problem = tooMuch ? 'A discount cannot be more than 100%.' : null;
  return { typed, setTyped, amount, pct, problem };
}
export type SaleDiscount = ReturnType<typeof useSaleDiscount>;

/** "Discount  [ 5 ] %" with what it comes to underneath. `over` = more than the signed-in role may give (the red border the old box had). */
export function DiscountRow({ d, over = false }: { d: SaleDiscount; over?: boolean }) {
  return (
    <>
      <div className="flex justify-between text-xs items-center gap-2">
        <span>Discount</span>
        <div className="flex items-center gap-1">
          <input
            type="number" min={0} max={100} step="any" inputMode="decimal"
            aria-label="Discount in percent" placeholder="0"
            className={cn('input w-20 text-right py-1', (over || d.problem) && 'border-red-400 focus:ring-red-300')}
            value={d.typed} onFocus={(e) => e.target.select()} onChange={(e) => d.setTyped(e.target.value)}
          />
          <span className="font-semibold text-gray-600 dark:text-slate-300" aria-hidden="true">%</span>
        </div>
      </div>
      {(d.amount > 0 || d.problem) && (
        <div className={cn('text-[10px] text-right', d.problem ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-slate-400')}>
          {d.problem ?? `= ${formatINR(d.amount)} off`}
        </div>
      )}
    </>
  );
}
