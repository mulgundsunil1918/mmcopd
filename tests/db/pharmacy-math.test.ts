// Pure-maths tests for src/lib/pharmacyMath.ts — no database. Covers the user's reference example
// (₹50 cost / ₹100 price → ₹50 profit, 50% margin, 100% markup) and checks, over hundreds of random
// invoices, that every allocation adds back to the exact paisa.
import {
  toPaise, r2, r4, allocatePaise, computePurchase, validatePurchase, blendUnitCost, profitMetrics, netRevenueExGst,
} from '../../src/lib/pharmacyMath';

let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const eq = (a: any, b: any, m: string) => ok(a === b, `${m}  (got ${a}${a === b ? '' : `, expected ${b}`})`);
const close = (a: number, b: number, m: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${m}  (got ${a}${Math.abs(a - b) <= eps ? '' : `, expected ${b}`})`);
const p = (n: number) => toPaise(n);

console.log('\n== paise helpers ==');
eq(toPaise(1.005), 101, '1.005 → 101 paise (naive 1.005×100 gives 100)');
eq(toPaise(0.1 + 0.2), 30, '0.1 + 0.2 → 30 paise');
eq(toPaise(-2.675), -268, 'negatives round half away from zero');
eq(toPaise('12.34'), 1234, 'numeric strings');
eq(toPaise(NaN), 0, 'NaN → 0');
eq(r2(10.005), 10.01, 'r2 rounds the paisa');
eq(r4(45.45454545), 45.4545, 'unit costs keep 4 decimals');

console.log('\n== allocatePaise (largest remainder) ==');
{
  const a = allocatePaise(1000, [1, 1, 1]);
  eq(a.reduce((s, x) => s + x, 0), 1000, '₹10.00 over 3 equal lines adds back to exactly ₹10.00');
  ok(JSON.stringify(a) === JSON.stringify([334, 333, 333]), 'the odd paisa goes to the first line, not lost');
  eq(JSON.stringify(allocatePaise(300, [3000, 1000])), JSON.stringify([225, 75]), 'proportional to value (75% / 25%)');
  eq(JSON.stringify(allocatePaise(10, [0, 0])), JSON.stringify([5, 5]), 'no usable weights → equal split');
  eq(JSON.stringify(allocatePaise(0, [5, 5])), JSON.stringify([0, 0]), 'nothing to allocate');
  eq(allocatePaise(-100, [1, 1]).reduce((s, x) => s + x, 0), -100, 'negative totals allocate too');
  let exact = true;
  for (let t = 0; t < 400; t++) {
    const n = 1 + Math.floor(Math.random() * 9);
    const w = Array.from({ length: n }, () => Math.floor(Math.random() * 100000));
    const total = Math.floor(Math.random() * 5_000_000);
    if (allocatePaise(total, w).reduce((s, x) => s + x, 0) !== total) exact = false;
  }
  ok(exact, '400 random splits all add back to the exact total');
}

console.log('\n== purchase bill: the ₹50 / ₹100 reference case ==');
{
  const r = computePurchase([{ qty: 100, rate: 50, gst_rate: 12 }]);
  eq(r.subtotal, 5000, 'goods ₹5,000');
  eq(r.gst, 600, 'GST ₹600');
  eq(r.cgst + r.sgst, 600, 'CGST + SGST = GST');
  eq(r.total, 5600, 'invoice total ₹5,600');
  eq(r.lines[0].unit_cost, 50, 'reclaimable GST → unit cost is the ₹50 rate');
}

console.log('\n== free units lower the unit cost ==');
{
  const r = computePurchase([{ qty: 100, free_qty: 10, rate: 50, gst_rate: 12 }]);
  eq(r.lines[0].units, 110, '110 units received');
  eq(r.lines[0].unit_cost, 45.4545, '₹5,000 ÷ 110 units = ₹45.4545');
  eq(r.total, 5600, 'you still pay for 100 units only');
  eq(r2(110 * r.lines[0].unit_cost), 5000, '110 units at that cost = the ₹5,000 actually paid (to the paisa)');
}

console.log('\n== discounts ==');
{
  const r = computePurchase([{ qty: 100, rate: 50, disc_pct: 10, gst_rate: 12 }]);
  eq(r.line_discount, 500, '10% line discount = ₹500');
  eq(r.taxable, 4500, 'GST is charged on ₹4,500 (after discount)');
  eq(r.gst, 540, 'GST ₹540, not ₹600');
  eq(r.total, 5040, 'total ₹5,040');
  eq(r.lines[0].unit_cost, 45, 'unit cost ₹45');
}
{
  const r = computePurchase([{ qty: 10, rate: 100, gst_rate: 5 }, { qty: 30, rate: 100, gst_rate: 12 }], { header_discount: 400 });
  eq(r.lines[0].header_discount + r.lines[1].header_discount, 400, 'invoice discount ₹400 shared with no paisa lost');
  eq(r.lines[0].header_discount, 100, 'shared by value: ₹1,000 of ₹4,000 → ₹100');
  eq(r.taxable, 3600, 'taxable value after the invoice discount');
  eq(r.gst, r2(r.lines[0].taxable * 0.05 + r.lines[1].taxable * 0.12), 'GST charged on each line at its own rate, after the discount');
}

console.log('\n== freight is part of what the stock cost ==');
{
  const r = computePurchase([{ qty: 100, rate: 50, gst_rate: 12 }, { qty: 100, rate: 100, gst_rate: 12 }], { other_charges: 300 });
  eq(r.lines[0].charges + r.lines[1].charges, 300, 'freight ₹300 fully allocated');
  eq(r.lines[0].charges, 100, 'cheaper line carries 1/3 of it (by value)');
  eq(r.lines[0].unit_cost, 51, '₹50 + ₹100 freight ÷ 100 units = ₹51');
  eq(r.lines[1].unit_cost, 102, '₹100 + ₹200 freight ÷ 100 units = ₹102');
}

console.log('\n== GST that cannot be reclaimed is part of the cost ==');
{
  const r = computePurchase([{ qty: 100, rate: 50, gst_rate: 12 }], { gst_in_cost: true });
  eq(r.lines[0].unit_cost, 56, 'unregistered / composition clinic: ₹50 + 12% = ₹56 per unit');
  eq(r.total, 5600, 'invoice total is unchanged — only the cost basis differs');
}

console.log('\n== IGST vs CGST/SGST and round-off ==');
{
  const inter = computePurchase([{ qty: 3, rate: 33.33, gst_rate: 12 }], { interstate: true });
  eq(inter.igst, inter.gst, 'interstate → all tax is IGST');
  eq(inter.cgst + inter.sgst, 0, '…and none is CGST/SGST');
  const intra = computePurchase([{ qty: 3, rate: 33.33, gst_rate: 12 }]);
  eq(r2(intra.cgst + intra.sgst), intra.gst, 'intrastate → CGST + SGST add to the tax exactly (odd paisa goes to SGST)');
  ok(Number.isInteger(r2(intra.total * 100) ) && intra.total === Math.round(intra.total), "'auto' rounds the invoice to a whole rupee");
  const manual = computePurchase([{ qty: 1, rate: 100.4 }], { round_off: -0.4 });
  eq(manual.total, 100, 'a typed round-off of −₹0.40 is applied as typed');
}

console.log('\n== the invoice identity holds on 500 random bills ==');
{
  let identity = true, costTie = true, shares = true;
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(Math.random() * 8);
    const lines = Array.from({ length: n }, () => ({
      qty: 1 + Math.floor(Math.random() * 200),
      free_qty: Math.random() < 0.3 ? Math.floor(Math.random() * 20) : 0,
      rate: Math.round(Math.random() * 50000) / 100,
      disc_pct: Math.random() < 0.5 ? Math.round(Math.random() * 2500) / 100 : 0,
      gst_rate: [0, 5, 12, 18][Math.floor(Math.random() * 4)],
    }));
    const goods = lines.reduce((s, l) => s + Math.round(l.qty * l.rate * 100) - Math.round(Math.round(l.qty * l.rate * 100) * l.disc_pct / 100), 0);
    const opts = {
      header_discount: Math.random() < 0.5 ? Math.round(Math.random() * Math.min(goods, 100000)) / 100 : 0,
      other_charges: Math.random() < 0.5 ? Math.round(Math.random() * 50000) / 100 : 0,
      gst_in_cost: Math.random() < 0.5, interstate: Math.random() < 0.5,
    };
    const r = computePurchase(lines, opts);
    // total = subtotal − discount + GST + charges + round-off, to the paisa
    if (p(r.subtotal) - p(r.discount) + p(r.gst) + p(r.other_charges) + p(r.round_off) !== p(r.total)) identity = false;
    // per-line costs add to taxable + charges (+ GST when it is a cost)
    const lineCost = r.lines.reduce((s, l) => s + p(l.cost), 0);
    if (lineCost !== p(r.taxable) + p(r.other_charges) + (opts.gst_in_cost ? p(r.gst) : 0)) costTie = false;
    // shares add up
    if (r.lines.reduce((s, l) => s + p(l.header_discount), 0) !== p(r.header_discount)) shares = false;
    if (r.lines.reduce((s, l) => s + p(l.charges), 0) !== p(r.other_charges)) shares = false;
  }
  ok(identity, 'total = subtotal − discount + GST + other charges + round-off (to the paisa) on every bill');
  ok(costTie, 'the line costs add up to goods + freight (+ GST when it is a cost) on every bill');
  ok(shares, 'invoice discount and freight shares add back exactly on every bill');
}

console.log('\n== validation messages ==');
eq(validatePurchase([]), 'Add at least one medicine line to the bill.', 'empty bill');
ok(/quantity/.test(validatePurchase([{ qty: 0, rate: 10 }]) || ''), 'zero quantity');
ok(/quantity/.test(validatePurchase([{ qty: 1.5, rate: 10 }]) || ''), 'fractional quantity');
ok(/rate/.test(validatePurchase([{ qty: 1, rate: -1 }]) || ''), 'negative rate');
ok(/discount/.test(validatePurchase([{ qty: 1, rate: 1, disc_pct: 101 }]) || ''), 'discount over 100%');
ok(/larger than/.test(validatePurchase([{ qty: 1, rate: 100 }], { header_discount: 150 }) || ''), 'invoice discount bigger than the goods');
eq(validatePurchase([{ qty: 1, rate: 100, free_qty: 2, gst_rate: 12 }], { header_discount: 10 }), null, 'a good bill passes');

console.log('\n== weighted cost when a batch number is bought again ==');
close(blendUnitCost(60, 50, 100, 60), 56.25, '60 left @₹50 + 100 new @₹60 → ₹56.25', 1e-9);
eq(blendUnitCost(0, 50, 100, 60), 60, 'nothing left from the old purchase → the new cost');
eq(blendUnitCost(60, null, 100, 60), 60, 'unknown old cost cannot be blended → new cost');
eq(blendUnitCost(40, 45.4545, 0, 99), 45.4545, 'no new units → unchanged');

console.log('\n== profit metrics (margin ≠ markup) ==');
{
  const m = profitMetrics(100, 50);
  eq(m.profit, 50, 'sold at ₹100, cost ₹50 → profit ₹50');
  eq(m.marginPct, 50, 'gross margin = 50 ÷ 100 = 50%');
  eq(m.markupPct, 100, 'markup = 50 ÷ 50 = 100%');
  const lo = profitMetrics(2000, 1000);
  eq(lo.marginPct, 50, '20 units: margin still 50%');
  eq(lo.markupPct, 100, '…and markup 100%');
  eq(profitMetrics(0, 0).marginPct, null, 'no revenue → margin is not a number, not 0%');
  eq(profitMetrics(100, 0).markupPct, null, 'zero cost → markup is undefined');
  eq(profitMetrics(80, 100).profit, -20, 'selling below cost → a loss');
  eq(profitMetrics(80, 100).marginPct, -25, '…margin −25%');
  const mix = profitMetrics(1000, 300);
  eq(mix.marginPct, 70, '70% margin');
  ok(mix.markupPct !== null && Math.abs(mix.markupPct - 233.33) < 0.01, 'while the SAME sale is a 233.33% markup — different numbers, never to be swapped');
}

console.log('\n== net revenue: after discount, without the GST owed onward ==');
eq(netRevenueExGst(112, 0, 12), 100, '₹112 incl. 12% GST → ₹100 of revenue');
eq(netRevenueExGst(112, 11.2, 12), 90, '₹112 less ₹11.20 discount → ₹100.80 paid → ₹90 of revenue');
eq(netRevenueExGst(100, 10, 0), 90, 'no GST charged → just the discounted amount');

console.log(`\n  → ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
