// Bill import — what a person can do on the checking screen, as plain functions (lib/billImport/edit.ts), plus the figures that screen shows:
//   · picking a medicine, confirming a match, adding a new medicine, setting a line aside — each changes only that line and never the original draft;
//   · "two lines of one new medicine" count as ONE new medicine, a set-aside line counts for nothing;
//   · the summary (lines, units, free units, what the import comes to, new medicines, lines waiting) agrees with the main process' plan;
//   · what one unit really costs and the profit on it are worked the way the purchase bill works them (free units, discounts, freight, GST in or out of cost);
//   · the invoice discount lowers every unit's cost, and the totals box equals the whole-bill reconcile figure when nothing is set aside.
import * as XLSX from 'xlsx';
import { PHARMACY_CATALOG } from '../../src/data/pharmacy-catalog';
import {
  addAsNew, billTotals, buildDraft, buildTemplateWorkbook, checkDraft, chooseDrug, clearChoice, confirmLine, lineMoney, newMedicineCount, patchBill, patchLine,
  planParts, readBillRows, readWorkbook, setAside, summarize, type Draft,
} from '../../src/lib/billImport';
import { profitMetrics } from '../../src/lib/pharmacyMath';
import { ok, eq, near, section, finish } from './lib';

const TODAY = '2026-10-25';
const drugs = PHARMACY_CATALOG.map((d, i) => ({ id: i + 1, name: d.name, generic_name: d.generic_name, form: d.form, strength: d.strength }));
const w = readWorkbook(XLSX, buildTemplateWorkbook(XLSX, true, TODAY));
const read = readBillRows(w.billRows, w.itemRows);
const base: Draft = buildDraft(read, { drugs, aliases: [], suppliers: [], today: TODAY });
const frozen = JSON.stringify(base);
const check = (d: Draft) => checkDraft(d, { today: TODAY });

// ============================================================================================================
section('1 · one change, one line');
const dolo = drugs.find((d) => d.name === 'Dolo 650')!;
const a = chooseDrug(base, 3, dolo.id);
ok(a.lines[2].drug_id === dolo.id && a.lines[2].confirmed && a.lines[2].new_drug === null, 'choosing a medicine sets it and counts as confirmed');
ok(a.lines.filter((_, i) => i !== 2).every((l, i) => l === base.lines[i < 2 ? i : i + 1]), '…and the other four lines are the very same objects');
const b1 = confirmLine(base, 1);
ok(base.lines[0].drug_id !== null && !base.lines[0].confirmed && b1.lines[0].confirmed, '"Yes, it is this one" confirms the suggested match');
const c = addAsNew(base, 2);
ok(c.lines[1].new_drug !== null && c.lines[1].new_drug.name === base.lines[1].suggested_new.name && c.lines[1].drug_id === null && c.lines[1].confirmed, 'adding as new starts from what the bill (and the lookup) said');
ok(c.lines[1].new_drug !== base.lines[1].suggested_new, '…as a copy, so editing the form never edits the suggestion');
const c2 = addAsNew(c, 2, { ...c.lines[1].new_drug!, name: 'Alprax 10', schedule: 'H1' });
eq(c2.lines[1].new_drug?.name, 'Alprax 10', 'the person can rename the new medicine');
const c3 = clearChoice(c2, 2);
ok(c3.lines[1].new_drug === null && c3.lines[1].drug_id === null && !c3.lines[1].confirmed, 'going back clears the choice (the line needs a medicine again)');
eq(setAside(base, 5, true).lines[4].aside, true, 'set aside…');
eq(setAside(setAside(base, 5, true), 5, false).lines[4].aside, false, '…and include again');
eq(patchLine(base, 1, { batch: 'Z9' }).lines[0].batch, 'Z9', 'patching a figure changes that line');
eq(patchBill(base, { discount: 12 }).bill.discount, 12, '…and patching the bill changes the bill');
eq(JSON.stringify(base), frozen, 'none of this touched the original draft');
ok(addAsNew(base, 99) === base, 'a line that does not exist changes nothing');

// ============================================================================================================
section('2 · counting new medicines');
let d = base;
for (const n of [2, 3, 4, 5]) d = addAsNew(d, n);
eq(newMedicineCount(d.lines), 4, 'four lines added as new → four new medicines');
d = patchLine(d, 3, { new_drug: { ...d.lines[2].new_drug!, name: d.lines[1].new_drug!.name } });
eq(newMedicineCount(d.lines), 3, 'two lines with the same new name → one medicine');
d = patchLine(d, 3, { new_drug: { ...d.lines[2].new_drug!, name: `  ${d.lines[1].new_drug!.name.toUpperCase()}  ` } });
eq(newMedicineCount(d.lines), 3, '…even typed in capitals with spaces round it');
eq(newMedicineCount(setAside(setAside(d, 4, true), 5, true).lines), 1, 'set-aside lines add nothing (only the one name on lines 2 and 3 is left)');

// ============================================================================================================
section('3 · the summary under the IMPORT box');
const ready = (): Draft => {
  let x = confirmLine(base, 1);
  for (const n of [2, 3, 4, 5]) x = addAsNew(x, n);
  x = patchLine(x, 2, { batch: 'AX2024' });
  x = patchLine(x, 4, { expiry: '2030-12-31' });
  x = patchLine(x, 5, { expiry: '2030-12-31' });
  return x;
};
const r = ready();
ok(check(r).ready, 'the sample, with its red boxes filled, is ready');
const s = summarize(r);
eq(s.lines, 5, 'five lines'); eq(s.units, 1 + 10 + 7 + 1 + 6, 'twenty-five units (paid + free)'); eq(s.free_units, 2, 'two of them free');
near(s.total, 2556.36, 'it comes to the printed ₹2,556.36'); eq(s.new_medicines, 4, 'four new medicines'); eq(s.aside, 0, 'nothing set aside');
const part = setAside(setAside(r, 4, true), 5, true);
const s2 = summarize(part);
ok(s2.lines === 3 && s2.aside === 2 && s2.new_medicines === 2, 'setting two lines aside: three lines import now, two wait, two new medicines');
near(s2.total, planParts(part.bill, part.lines).importedTotal, 'the total is the main process\' plan for that part');
ok(s2.total < s.total && s2.total > 0, '…and it is less than the whole bill');

// ============================================================================================================
section('4 · what one unit really costs, and the profit');
const m = lineMoney(r, { gstInCost: true, gstCharged: false });
const ciplox100 = m.get(3)!;
near(ciplox100.unit_cost, 617.4 / 7, 'Ciplox 100 (5 paid + 2 free, 2% off, 5% GST): ₹617.40 over 7 units = ₹88.20 each, GST counted in the cost');
near(lineMoney(r, { gstInCost: false, gstCharged: false }).get(3)!.unit_cost, 588 / 7, '…₹84.00 each when the GST is claimed back');
const pm = profitMetrics(150, 88.2);
near(ciplox100.profit, pm.profit, 'profit per unit = the MRP ₹150 less that cost'); near(ciplox100.margin_pct, pm.marginPct, '…and its margin');
const claimed = lineMoney(r, { gstInCost: false, gstCharged: true }).get(3)!;
const pm2 = profitMetrics(150 / 1.05, 84);
near(claimed.profit, pm2.profit, 'for a clinic that charges GST the selling price is taken without GST first'); near(claimed.margin_pct, pm2.marginPct, '…and so is the margin');
const sold = lineMoney(patchLine(r, 3, { selling_price: 140 }), { gstInCost: true, gstCharged: false }).get(3)!;
near(sold.profit, 140 - 88.2, 'a lower selling price than the MRP is what the profit uses');
const free0 = lineMoney(patchLine(r, 3, { free_qty: 0 }), { gstInCost: true, gstCharged: false }).get(3)!;
near(free0.unit_cost, 617.4 / 5, 'without the free units the same bill costs ₹123.48 a unit');
const disc = lineMoney(patchBill(r, { discount: 100 }), { gstInCost: true, gstCharged: false });
ok([...m.keys()].every((k) => disc.get(k)!.unit_cost < m.get(k)!.unit_cost), 'a ₹100 invoice discount lowers the cost of every unit');
const freight = lineMoney(patchBill(r, { other_charges: 100 }), { gstInCost: true, gstCharged: false });
ok([...m.keys()].every((k) => freight.get(k)!.unit_cost > m.get(k)!.unit_cost), 'and ₹100 of freight raises it');
eq(lineMoney(patchLine(r, 1, { qty: null }), { gstInCost: true, gstCharged: false }).has(1), false, 'a line with no quantity has no figures yet');
eq(lineMoney(setAside(r, 1, true), { gstInCost: true, gstCharged: false }).has(1), false, '…and neither has a set-aside line');

// ============================================================================================================
section('5 · the totals box agrees with the check');
const t = billTotals(r, true);
near(t.total, check(r).reconciliation.computed_total, 'the totals box equals the bill-wide figure the check compares with the printed net');
near(t.total, 2556.36, '…₹2,556.36');
near(t.line_discount, 112, 'line discounts ₹112 (Alprax 10% of ₹1,000 and Ciplox 100 2% of ₹600)');
const withExtra = billTotals(patchBill(patchBill(r, { discount: 50 }), { other_charges: 30 }), true);
near(withExtra.total, 2556.36 - 50 - (50 * 0.0) + 30 - (0), 'the invoice discount and freight move the total (the GST on the discount comes off too)', 6);
ok(withExtra.total < t.total + 30 && withExtra.total > t.total - 50 - 6, 'by a sensible amount');
ok(check(patchBill(r, { discount: 50 })).problems.some((p) => p.code === 'totals_differ'), 'a discount typed on the screen that the bill did not print makes the totals differ — the person must look');

eq(JSON.stringify(base), frozen, 'and the original draft is still untouched');
finish();
