// Pure-maths tests for the invoice calculator (main/billing-engine.ts): over thousands of random bills — mixed
// exempt and taxable lines, flat and percent discounts, GST on and off — the printed parts must add up to the total.
import { computeBill, money } from '../../src/main/billing-engine';

let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const near = (a: number, b: number, eps = 0.0051) => Math.abs(a - b) <= eps;

console.log('\n== worked examples ==');
{
  const b = computeBill([{ description: 'Consultation', qty: 1, rate: 300 }], { discount: 0, gstEnabled: true, roundOff: false });
  ok(b.total === 300 && b.isTaxInvoice === false, 'exempt consultation: ₹300, Bill of Supply');
  const t = computeBill([{ description: 'Cosmetic', qty: 1, rate: 1000, is_taxable: true, gst_rate: 18 }], { gstEnabled: true, roundOff: false });
  ok(t.taxableTotal === 1000 && t.cgstTotal === 90 && t.sgstTotal === 90 && t.total === 1180 && t.isTaxInvoice, 'taxable ₹1,000 at 18% → CGST 90 + SGST 90 = ₹1,180, Tax Invoice');
  const d = computeBill([{ description: 'A', qty: 1, rate: 1000, is_taxable: true, gst_rate: 18 }, { description: 'B', qty: 1, rate: 500 }], { discount: 10, discount_type: 'percent', gstEnabled: true, roundOff: false });
  ok(d.subtotal === 1500 && d.discountValue === 150 && d.taxableTotal === 900 && d.exemptTotal === 450 && d.cgstTotal === 81 && d.sgstTotal === 81 && d.total === 1512, '10% off ₹1,500 (₹1,000 taxable + ₹500 exempt): tax is charged on the DISCOUNTED ₹900 → 81 + 81; total ₹1,512');
  const off = computeBill([{ description: 'A', qty: 1, rate: 1000, is_taxable: true, gst_rate: 18 }], { gstEnabled: false, roundOff: false });
  ok(off.total === 1000 && !off.isTaxInvoice, 'GST switched off: nothing is taxed whatever the line says');
  const over = computeBill([{ description: 'A', qty: 1, rate: 100 }], { discount: 500, gstEnabled: true, roundOff: false });
  ok(over.discountValue === 100 && over.total === 0, 'a discount bigger than the bill is capped at the bill (total ₹0, never negative)');
  const neg = computeBill([{ description: 'A', qty: 1, rate: 100 }], { discount: -50, gstEnabled: true, roundOff: false });
  ok(neg.discountValue === 0 && neg.total === 100, 'a negative discount is ignored');
  const r = computeBill([{ description: 'A', qty: 1, rate: 99.6 }], { gstEnabled: true });
  ok(r.total === 100 && near(r.roundOff, 0.4), 'round-off to the nearest rupee: ₹99.60 → ₹100.00 (+₹0.40)');
}

console.log('\n== 5,000 random bills: the parts must add up ==');
{
  let identity1 = 0, identity2 = 0, subtotalOk = 0, taxSplit = 0, bounds = 0, worst = 0, n = 5000;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (let t = 0; t < n; t++) {
    const k = 1 + Math.floor(Math.random() * 6);
    const lines = Array.from({ length: k }, (_, i) => ({
      description: `L${i}`, qty: 1 + Math.floor(Math.random() * 4), rate: Math.round(rnd(1, 2000) * 100) / 100,
      is_taxable: Math.random() < 0.5, gst_rate: [0, 5, 12, 18, 28][Math.floor(Math.random() * 5)],
    }));
    const pct = Math.random() < 0.5;
    const opts = { discount: pct ? Math.round(rnd(0, 100) * 100) / 100 : Math.round(rnd(0, 3000) * 100) / 100, discount_type: pct ? 'percent' as const : 'flat' as const, gstEnabled: Math.random() < 0.8, roundOff: Math.random() < 0.5 };
    const b = computeBill(lines, opts);
    const sum = money(lines.reduce((s, l) => s + money(l.qty * l.rate), 0));
    if (near(b.subtotal, sum)) subtotalOk++;
    const e1 = Math.abs((b.exemptTotal + b.taxableTotal) - (b.subtotal - b.discountValue));
    worst = Math.max(worst, e1);
    if (e1 <= 0.0051) identity1++;
    const e2 = Math.abs(b.total - (b.subtotal - b.discountValue + b.cgstTotal + b.sgstTotal + b.roundOff));
    if (e2 <= 0.0051) identity2++;
    if (b.lines.every((l) => near(l.cgst + l.sgst, money(((money(l.amount * ((b.subtotal - b.discountValue) / (b.subtotal || 1)))) * l.gst_rate) / 100), 0.0101))) taxSplit++;
    if (b.total >= 0 && b.discountValue >= 0 && b.discountValue <= b.subtotal + 0.0001 && Math.abs(b.roundOff) <= 0.5001) bounds++;
  }
  ok(subtotalOk === n, `the subtotal is the sum of the lines (${subtotalOk}/${n})`);
  ok(identity1 === n, `exempt + taxable value = subtotal − discount, to the paisa (${identity1}/${n}; worst gap ₹${worst.toFixed(2)})`);
  ok(identity2 === n, `total = subtotal − discount + CGST + SGST + round-off, to the paisa (${identity2}/${n})`);
  ok(taxSplit === n, `each line's CGST + SGST matches its tax (${taxSplit}/${n})`);
  ok(bounds === n, `total never negative, discount never above the bill, round-off within 50 paise (${bounds}/${n})`);
}
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
