/**
 * Importing a bill in parts. A line the pharmacist cannot settle now (an unreadable batch, a medicine nobody can identify) is SET ASIDE; the others
 * are imported, and the set-aside ones wait to be finished later. The bill-level money — the invoice discount, freight and round-off — belongs to the
 * whole bill, so it is shared between the parts IN PROPORTION TO THE VALUE OF THEIR LINES. Sharing is additive, so a bill saved in two parts gives
 * every unit exactly the cost it would have had if it had been saved in one go.
 */
import { allocatePaise, computePurchase, fromPaise, toPaise } from '../pharmacyMath';
import type { DraftBill, DraftLine } from './types';

export interface PartPlan {
  importLines: DraftLine[];
  asideLines: DraftLine[];
  /** The bill-level money for the part being imported now. */
  header: { discount: number; other_charges: number; round_off: 'auto' | number };
  /** What is left for the part that waits. */
  rest: { discount: number; other_charges: number; round_off: 'auto' | number };
  /** What CureDesk will record for the part being imported. */
  importedTotal: number;
}

const asLine = (l: DraftLine) => ({ qty: l.qty as number, free_qty: l.free_qty || 0, rate: l.rate as number, disc_pct: l.disc_pct || 0, gst_rate: l.gst_rate ?? 0 });

export function planParts(bill: Pick<DraftBill, 'discount' | 'other_charges' | 'round_off' | 'interstate'>, lines: DraftLine[]): PartPlan {
  const importLines = lines.filter((l) => !l.aside);
  const asideLines = lines.filter((l) => l.aside);
  // the value of each line before any invoice-level money: ex-GST, after its own discount. A set-aside line counts by its printed amount.
  const valueP = (l: DraftLine): number => {
    if (!l.aside && l.qty !== null && l.rate !== null) return toPaise(computePurchase([asLine(l)], {}).lines[0].taxable);
    return toPaise((l.printed_amount ?? 0) / (1 + (l.gst_rate ?? 0) / 100));
  };
  const imp = importLines.reduce((s, l) => s + valueP(l), 0);
  const all = imp + asideLines.reduce((s, l) => s + valueP(l), 0);
  let discountP = toPaise(bill.discount), otherP = toPaise(bill.other_charges);
  let partDiscP = discountP, partOtherP = otherP;
  if (asideLines.length > 0 && all > 0) {
    [partDiscP] = allocatePaise(discountP, [imp, all - imp]);
    [partOtherP] = allocatePaise(otherP, [imp, all - imp]);
  }
  const roundPart: 'auto' | number = bill.round_off === 'auto' || asideLines.length === 0 ? bill.round_off
    : fromPaise(allocatePaise(toPaise(bill.round_off), [imp, Math.max(0, all - imp)])[0]);
  const roundRest: 'auto' | number = bill.round_off === 'auto' ? 'auto' : fromPaise(toPaise(bill.round_off) - toPaise(roundPart as number));
  const real = importLines.filter((l) => l.qty !== null && l.rate !== null).map(asLine);
  const importedTotal = real.length
    ? computePurchase(real, { header_discount: fromPaise(partDiscP), other_charges: fromPaise(partOtherP), interstate: bill.interstate, gst_in_cost: false, round_off: roundPart }).total
    : 0;
  return {
    importLines, asideLines,
    header: { discount: fromPaise(partDiscP), other_charges: fromPaise(partOtherP), round_off: roundPart },
    rest: { discount: fromPaise(discountP - partDiscP), other_charges: fromPaise(otherP - partOtherP), round_off: roundRest },
    importedTotal,
  };
}
