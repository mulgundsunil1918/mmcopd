/**
 * What a person can do to a draft on the review screen, as plain functions (no React), so the rules can be tested and the website demo uses the same ones:
 * pick a medicine, confirm a match, add a new medicine, set a line aside — and the figures the screen shows (cost per unit, profit, what the import comes to).
 */
import { computePurchase, profitMetrics } from '../pharmacyMath';
import { planParts } from './parts';
import type { Draft, DraftBill, DraftLine, NewDrugSpec } from './types';

export const patchBill = (d: Draft, patch: Partial<DraftBill>): Draft => ({ ...d, bill: { ...d.bill, ...patch } });
export const patchLine = (d: Draft, id: number, patch: Partial<DraftLine>): Draft => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

/** The person chose a medicine from the list for this line (a deliberate choice, so it counts as confirmed). */
export const chooseDrug = (d: Draft, id: number, drugId: number | null): Draft =>
  patchLine(d, id, { drug_id: drugId, new_drug: null, confirmed: drugId !== null });

/** "Yes, it is this one" for a match that was not certain. */
export const confirmLine = (d: Draft, id: number): Draft => patchLine(d, id, { confirmed: true });

/** The medicine is not on the Drug List: it will be added when the bill is imported. */
export const addAsNew = (d: Draft, id: number, spec?: NewDrugSpec): Draft => {
  const line = d.lines.find((l) => l.id === id);
  if (!line) return d;
  return patchLine(d, id, { new_drug: spec ?? line.new_drug ?? { ...line.suggested_new }, drug_id: null, confirmed: true });
};

/** Back to "choose the medicine" (the line keeps its suggested match as a starting point). */
export const clearChoice = (d: Draft, id: number): Draft => {
  const line = d.lines.find((l) => l.id === id);
  if (!line) return d;
  return patchLine(d, id, { new_drug: null, drug_id: null, confirmed: false });
};

export const setAside = (d: Draft, id: number, aside: boolean): Draft => patchLine(d, id, { aside });

/** How many different new medicines the import will add (two lines of one new medicine are one medicine). */
export function newMedicineCount(lines: DraftLine[]): number {
  const names = new Set<string>();
  for (const l of lines) if (!l.aside && l.new_drug && l.new_drug.name.trim()) names.add(l.new_drug.name.trim().replace(/\s+/g, ' ').toLowerCase());
  return names.size;
}

export interface ImportSummary {
  lines: number;
  /** Units that arrive: paid + free. */
  units: number;
  free_units: number;
  /** What the part being imported now comes to (with its share of the invoice discount, charges and round-off). */
  total: number;
  new_medicines: number;
  aside: number;
}

export function summarize(d: Draft): ImportSummary {
  const plan = planParts(d.bill, d.lines);
  const real = plan.importLines;
  return {
    lines: real.length,
    units: real.reduce((s, l) => s + (l.qty ?? 0) + (l.free_qty || 0), 0),
    free_units: real.reduce((s, l) => s + (l.free_qty || 0), 0),
    total: plan.importedTotal,
    new_medicines: newMedicineCount(d.lines),
    aside: plan.asideLines.length,
  };
}

export interface LineMoney {
  /** What the line comes to before GST, after its own discount and its share of the invoice discount. */
  taxable: number;
  gst: number;
  /** Paid + free units. */
  units: number;
  /** What one unit really cost (free units, discounts, freight — and GST when it cannot be claimed back). */
  unit_cost: number;
  /** Profit on one unit at the selling price (or the MRP), GST taken out of the price when the clinic charges it. */
  profit: number | null;
  margin_pct: number | null;
}

/** The money on every line being imported, worked out the way the main process will save it. */
export function lineMoney(d: Draft, opts: { gstInCost: boolean; gstCharged: boolean }): Map<number, LineMoney> {
  const plan = planParts(d.bill, d.lines);
  const usable = plan.importLines.filter((l) => l.qty !== null && l.qty > 0 && l.rate !== null && l.rate >= 0);
  const out = new Map<number, LineMoney>();
  if (usable.length === 0) return out;
  const calc = computePurchase(
    usable.map((l) => ({ qty: l.qty as number, free_qty: l.free_qty || 0, rate: l.rate as number, disc_pct: l.disc_pct || 0, gst_rate: l.gst_rate ?? 0 })),
    { header_discount: plan.header.discount, other_charges: plan.header.other_charges, interstate: d.bill.interstate, gst_in_cost: opts.gstInCost, round_off: plan.header.round_off },
  );
  usable.forEach((l, i) => {
    const r = calc.lines[i];
    const price = l.selling_price ?? l.mrp ?? 0;
    const net = opts.gstCharged && (l.gst_rate ?? 0) > 0 ? price / (1 + (l.gst_rate as number) / 100) : price;
    const m = r.unit_cost > 0 && price > 0 ? profitMetrics(net, r.unit_cost) : null;
    out.set(l.id, { taxable: r.taxable, gst: r.gst, units: r.units, unit_cost: r.unit_cost, profit: m ? m.profit : null, margin_pct: m ? m.marginPct : null });
  });
  return out;
}

/** The totals box: the same function the main process saves with, shown line by line. */
export function billTotals(d: Draft, gstInCost: boolean) {
  const plan = planParts(d.bill, d.lines);
  const usable = plan.importLines.filter((l) => l.qty !== null && l.qty > 0 && l.rate !== null && l.rate >= 0);
  return computePurchase(
    usable.map((l) => ({ qty: l.qty as number, free_qty: l.free_qty || 0, rate: l.rate as number, disc_pct: l.disc_pct || 0, gst_rate: l.gst_rate ?? 0 })),
    { header_discount: plan.header.discount, other_charges: plan.header.other_charges, interstate: d.bill.interstate, gst_in_cost: gstInCost, round_off: plan.header.round_off },
  );
}
