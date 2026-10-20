// Real-SQLite tests for main/pharmacy-finance.ts — purchase bills, supplier payments, FEFO sales with
// frozen cost, profit / valuation / supplier reports, retries, and the v4 → v5 upgrade.
//
// Every figure below is SYNTHETIC test data in an in-memory database — nothing here touches a clinic's
// real data. Expected values are worked out by hand in the comments, not copied from the code's output.
// Run under several time zones by tests/db/run.mjs: "which day is this sale on" is the kind of thing
// that is only wrong on a PC whose zone is not the developer's.
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import * as fin from '../../src/main/pharmacy-finance';
import { rankProfit } from '../../src/lib/pharmacyReports';

let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const eq = (a: any, b: any, m: string) => ok(a === b, `${m}  (got ${a}${a === b ? '' : `, expected ${b}`})`);
const near = (a: number | null, b: number, m: string, eps = 0.005) => ok(a !== null && Math.abs(a - b) <= eps, `${m}  (got ${a}${a !== null && Math.abs(a - b) <= eps ? '' : `, expected ${b}`})`);
const throws = (fn: () => any, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL:', m, '(did not throw)'); }
  catch (e: any) { ok(re.test(String(e?.message)), `${m}  (message: "${e?.message}")`); }
};
const skip = (m: string) => console.log('  –', m);

// ----------------------------------------------------------------------------------------------
// fixtures
// ----------------------------------------------------------------------------------------------
function fresh() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
const setting = (db: Database.Database, k: string, v: string) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
const names = new Map<number, string>();
function drug(db: Database.Database, name: string, gst = 0, mrp = 100): number {
  const id = Number(db.prepare("INSERT INTO drug_master (name, schedule, gst_rate, default_mrp, low_stock_threshold) VALUES (?, 'OTC', ?, ?, 5)").run(name, gst, mrp).lastInsertRowid);
  names.set(id, name);
  return id;
}
function supplier(db: Database.Database, name = 'Acme Pharma'): number {
  return Number(db.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES (?, 'DL-TEST-1')").run(name).lastInsertRowid);
}
let invSeq = 0;
function buy(db: Database.Database, sup: number, lines: Partial<fin.PurchaseLineIn>[], o: Partial<fin.PurchaseIn> = {}) {
  return fin.createPurchase(db, {
    invoice_number: o.invoice_number ?? `INV-${++invSeq}`,
    wholesaler_id: sup,
    invoice_date: '2026-03-01',
    gst_in_cost: false,
    ...o,
    items: lines.map((l, i) => ({
      drug_master_id: 0, batch_no: `B${invSeq}-${i + 1}`, expiry: '2030-12-31',
      qty_received: 100, purchase_price: 50, mrp: 100, gst_rate: 0, ...l,
    })) as fin.PurchaseLineIn[],
  });
}
const stockOf = (db: Database.Database, d: number) =>
  (db.prepare('SELECT COALESCE(SUM(qty_remaining),0) AS q FROM drug_stock_batches WHERE drug_master_id=?').get(d) as any).q as number;
const batchOf = (db: Database.Database, d: number, batch: string) =>
  db.prepare('SELECT * FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?').get(d, batch) as any;
const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as any).c as number;
function sell(db: Database.Database, items: { d: number; qty: number; rate: number }[], o: Partial<fin.SellIn> = {}) {
  return fin.sellItems(db, {
    items: items.map((i) => ({ drug_master_id: i.d, drug_name: names.get(i.d) || 'X', qty: i.qty, rate: i.rate })),
    payment_mode: 'Cash', ...o,
  });
}
const utcStr = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
function backdate(db: Database.Database, saleId: number, utc: string) {
  db.prepare('UPDATE pharmacy_sales SET created_at=? WHERE id=?').run(utc, saleId);
  db.prepare('UPDATE dispensing_register SET dispensed_at=? WHERE sale_id=?').run(utc, saleId);
}
const today = fin.localISO();
const wide = { from: '2000-01-01', to: '2100-01-01' };

console.log(`\n(process time zone: ${process.env.TZ || 'system default'} · SQLite ${(new Database(':memory:').prepare('select sqlite_version() v').get() as any).v})`);

// ==============================================================================================
console.log('\n== TEST 1 · purchase 100 @ ₹50, sell 20 @ ₹100 (the reference case) ==');
{
  const db = fresh();
  const d = drug(db, 'Paracetamol 500', 0, 100);
  const s = supplier(db);
  const p = buy(db, s, [{ drug_master_id: d, batch_no: 'PX1', qty_received: 100, purchase_price: 50, mrp: 100 }], { invoice_number: 'ACME-1' });
  ok(p.id > 0 && !p.duplicate, 'purchase saved');
  eq(stockOf(db, d), 100, 'stock after purchase = 100');
  const inv = fin.getPurchase(db, p.id)!;
  eq(inv.total, 5000, 'invoice total ₹5,000 (100 × ₹50, no GST)');
  eq(inv.payment_status, 'unpaid', 'a recorded bill is not a paid bill');
  eq(inv.outstanding, 5000, '…₹5,000 outstanding');
  eq(batchOf(db, d, 'PX1').unit_cost, 50, 'batch unit cost ₹50');
  eq(inv.items[0].unit_cost, 50, 'purchase line unit cost ₹50');

  const sale = sell(db, [{ d, qty: 20, rate: 100 }]);
  eq(stockOf(db, d), 80, 'stock after selling 20 = 80');
  eq(sale.total, 2000, 'sale total ₹2,000');
  const reg = db.prepare('SELECT qty, rate, unit_cost FROM dispensing_register WHERE sale_id=?').all(sale.id) as any[];
  eq(reg.length, 1, 'one register row');
  eq(reg[0].unit_cost, 50, 'register froze unit cost ₹50');

  const r = fin.profitReport(db, wide);
  eq(r.totals.units, 20, 'units sold 20');
  eq(r.totals.revenue, 2000, 'revenue ₹2,000');
  eq(r.totals.cogs, 1000, 'COGS ₹1,000');
  eq(r.totals.profit, 1000, 'gross profit ₹1,000');
  eq(r.totals.margin_pct, 50, 'margin 50%  = (100−50)/100');
  eq(r.totals.markup_pct, 100, 'markup 100% = (100−50)/50');
  const row = r.drugs.find((x) => x.drug_master_id === d)!;
  eq(row.gp_per_unit, 50, 'gross profit per unit ₹50');
  eq(row.avg_price, 100, 'average realised price ₹100');
  eq(row.avg_cost, 50, 'average cost ₹50');
  eq(row.stock_units, 80, 'report knows stock on hand (80)');

  const v = fin.valuation(db, today);
  eq(v.sellable.units, 80, 'valuation: 80 units on the shelf');
  eq(v.sellable.at_cost, 4000, '  at cost  80 × ₹50 = ₹4,000');
  eq(v.sellable.at_mrp, 8000, '  at MRP   80 × ₹100 = ₹8,000');
  eq(v.sellable.at_selling, 8000, '  at selling price (blank → MRP) = ₹8,000');
  eq(v.sellable.expected_profit, 4000, '  expected gross profit ₹4,000');
  eq(v.sellable.expected_margin_pct, 50, '  expected margin 50%');
  eq(v.sellable.at_replacement_cost, 4000, '  replacement cost = latest purchase cost ₹50 × 80');

  // retry safety
  const ref = 'attempt-1';
  const a = buy(db, s, [{ drug_master_id: d, batch_no: 'PX2' }], { client_ref: ref, invoice_number: 'ACME-2' });
  const b = buy(db, s, [{ drug_master_id: d, batch_no: 'PX2' }], { client_ref: ref, invoice_number: 'ACME-2' });
  ok(!a.duplicate && b.duplicate && a.id === b.id, 'saving the same attempt twice returns the first bill');
  eq(stockOf(db, d), 180, '…and stock was added once (80 + 100)');
  eq(count(db, 'purchase_invoices'), 2, '…only two invoices exist');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'PX3' }], { invoice_number: ' acme-2 ' }), /already recorded/, 'same supplier invoice number entered again (different case/spaces) is refused');
  eq(stockOf(db, d), 180, '…and no stock was added by the refused one');
}

// ==============================================================================================
console.log('\n== TEST 2 · different costs, batches, free units, freight, discounts, GST ==');
{
  const db = fresh();
  const d = drug(db, 'Amoxicillin 250', 0, 100);
  const s = supplier(db);
  // two purchases of the same drug at different costs, different expiries
  buy(db, s, [{ drug_master_id: d, batch_no: 'EARLY', expiry: '2027-01-31', qty_received: 100, purchase_price: 50, mrp: 100 }]);
  buy(db, s, [{ drug_master_id: d, batch_no: 'LATE', expiry: '2027-06-30', qty_received: 100, purchase_price: 60, mrp: 100 }]);
  eq(stockOf(db, d), 200, '200 units across two batches');

  // FEFO: 150 sold = 100 from EARLY @50 + 50 from LATE @60 → COGS 5,000 + 3,000 = 8,000
  const sale = sell(db, [{ d, qty: 150, rate: 100 }]);
  const slices = db.prepare('SELECT batch_no, qty, unit_cost FROM dispensing_register WHERE sale_id=? ORDER BY id').all(sale.id) as any[];
  eq(JSON.stringify(slices.map((x) => [x.batch_no, x.qty, x.unit_cost])), JSON.stringify([['EARLY', 100, 50], ['LATE', 50, 60]]), 'FEFO slices carry their own batch cost');
  let r = fin.profitReport(db, wide);
  eq(r.totals.revenue, 15000, 'revenue 150 × ₹100 = ₹15,000');
  eq(r.totals.cogs, 8000, 'COGS = 100×50 + 50×60 = ₹8,000 (not 150 × any single cost)');
  eq(r.totals.profit, 7000, 'profit ₹7,000');
  near(r.totals.margin_pct, 46.67, 'margin 46.67%');
  near(r.totals.markup_pct, 87.5, 'markup 87.5%');

  // the SAME manufacturer batch bought again at a new price: remaining units blend, sold units keep their cost
  eq(batchOf(db, d, 'LATE').qty_remaining, 50, 'LATE has 50 left');
  buy(db, s, [{ drug_master_id: d, batch_no: 'LATE', expiry: '2027-06-30', qty_received: 50, purchase_price: 70, mrp: 100 }]);
  const late = batchOf(db, d, 'LATE');
  eq(late.qty_remaining, 100, 'LATE now 100');
  eq(late.unit_cost, 65, 'LATE unit cost blends the 50 left @₹60 with 50 new @₹70 → ₹65 (was overwritten with ₹70 before)');
  eq(late.purchase_price, 70, 'LATE shows the latest supplier rate ₹70');
  // …and a deliberate manual cost edit
  db.prepare('UPDATE drug_stock_batches SET purchase_price=99, unit_cost=99 WHERE drug_master_id=? AND batch_no=?').run(d, 'EARLY');
  r = fin.profitReport(db, wide);
  eq(r.totals.cogs, 8000, 'earlier profit UNCHANGED after both the re-buy and the cost edit (cost frozen on the sale)');
  eq(r.totals.profit, 7000, '…profit still ₹7,000');
  // new sale uses the new cost
  const s2 = sell(db, [{ d, qty: 10, rate: 100 }]);
  eq((db.prepare('SELECT unit_cost FROM dispensing_register WHERE sale_id=?').get(s2.id) as any).unit_cost, 65, 'a later sale takes the current batch cost');

  // free units: 100 paid + 10 free @ ₹50 = ₹5,000 for 110 units
  const f = drug(db, 'Cetirizine 10', 0, 100);
  buy(db, s, [{ drug_master_id: f, batch_no: 'FREE1', qty_received: 100, free_qty: 10, purchase_price: 50 }]);
  eq(batchOf(db, f, 'FREE1').qty_remaining, 110, 'free units reach the shelf (110)');
  eq(batchOf(db, f, 'FREE1').unit_cost, 45.4545, 'unit cost = ₹5,000 ÷ 110 = ₹45.4545');
  sell(db, [{ d: f, qty: 110, rate: 100 }]);
  r = fin.profitReport(db, wide);
  const fr = r.drugs.find((x) => x.drug_master_id === f)!;
  eq(fr.cogs, 5000, 'selling all 110 costs back exactly ₹5,000 (no rounding leak)');
  eq(fr.profit, 6000, '…profit ₹11,000 − ₹5,000');

  // freight is part of what the stock cost
  const g = drug(db, 'ORS sachet', 0, 100);
  const pf = buy(db, s, [{ drug_master_id: g, batch_no: 'FRT1', qty_received: 100, purchase_price: 50 }], { other_charges: 100 });
  eq(fin.getPurchase(db, pf.id)!.total, 5100, 'freight ₹100 added to the invoice total');
  eq(batchOf(db, g, 'FRT1').unit_cost, 51, 'freight capitalised: (5,000 + 100) ÷ 100 = ₹51');

  // trade discount: 10% off the line
  const h = drug(db, 'Vitamin C', 0, 100);
  const pd = buy(db, s, [{ drug_master_id: h, batch_no: 'DSC1', qty_received: 100, purchase_price: 50, disc_pct: 10 }]);
  eq(fin.getPurchase(db, pd.id)!.total, 4500, '10% line discount: bill ₹4,500');
  eq(batchOf(db, h, 'DSC1').unit_cost, 45, '…unit cost ₹45');
  eq(fin.getPurchase(db, pd.id)!.discount, 500, '…discount recorded ₹500');

  // header discount shared over lines by value, adds back exactly
  const i1 = drug(db, 'Drug I1'), i2 = drug(db, 'Drug I2');
  const ph = buy(db, s, [
    { drug_master_id: i1, batch_no: 'H1', qty_received: 10, purchase_price: 100 },   // 1,000
    { drug_master_id: i2, batch_no: 'H2', qty_received: 10, purchase_price: 200 },   // 2,000
  ], { discount: 300 });
  const hp = fin.getPurchase(db, ph.id)!;
  eq(hp.total, 2700, 'invoice discount ₹300 → total ₹2,700');
  eq(hp.items[0].discount_amount + hp.items[1].discount_amount, 300, 'lines carry the discount and it adds back to exactly ₹300');
  eq(hp.items[0].discount_amount, 100, '  ₹1,000 line takes ₹100');
  eq(batchOf(db, i2, 'H2').unit_cost, 180, '  ₹2,000 line: (2,000 − 200) ÷ 10 = ₹180 a unit');

  // GST: reclaimable vs not
  const gA = drug(db, 'GST drug A', 12, 112), gB = drug(db, 'GST drug B', 12, 112);
  const rec = buy(db, s, [{ drug_master_id: gA, batch_no: 'GA', qty_received: 100, purchase_price: 50, gst_rate: 12, mrp: 112 }], { gst_in_cost: false });
  eq(fin.getPurchase(db, rec.id)!.total, 5600, 'GST 12% on ₹5,000 → invoice ₹5,600');
  eq(batchOf(db, gA, 'GA').unit_cost, 50, 'GST that is claimed back is NOT stock cost → ₹50');
  const nrec = buy(db, s, [{ drug_master_id: gB, batch_no: 'GB', qty_received: 100, purchase_price: 50, gst_rate: 12, mrp: 112 }], { gst_in_cost: true });
  eq(batchOf(db, gB, 'GB').unit_cost, 56, 'GST that cannot be claimed IS stock cost → ₹56');
  const pi = buy(db, s, [{ drug_master_id: gA, batch_no: 'GA2', qty_received: 100, purchase_price: 50, gst_rate: 12, mrp: 112 }], { interstate: true });
  const ip = fin.getPurchase(db, pi.id)!;
  ok(ip.igst === 600 && ip.cgst === 0 && ip.sgst === 0, 'interstate bill: IGST ₹600, no CGST/SGST');
  const pc = fin.getPurchase(db, rec.id)!;
  ok(pc.cgst === 300 && pc.sgst === 300 && pc.igst === 0, 'intrastate bill: CGST ₹300 + SGST ₹300');
  // default follows the clinic's GST set-up: an unregistered clinic cannot reclaim input GST
  const gC = drug(db, 'GST drug C', 12, 112);
  fin.createPurchase(db, { invoice_number: 'DEF-1', wholesaler_id: s, invoice_date: '2026-03-01', items: [{ drug_master_id: gC, batch_no: 'GC', expiry: '2030-01-01', qty_received: 100, purchase_price: 50, mrp: 112, gst_rate: 12 }] });
  eq(batchOf(db, gC, 'GC').unit_cost, 56, 'default for a clinic that does not charge GST: input GST is a cost');
  setting(db, 'gst_enabled', 'true'); setting(db, 'gst_registration_type', 'regular');
  const gD = drug(db, 'GST drug D', 12, 112);
  fin.createPurchase(db, { invoice_number: 'DEF-2', wholesaler_id: s, invoice_date: '2026-03-01', items: [{ drug_master_id: gD, batch_no: 'GD', expiry: '2030-01-01', qty_received: 100, purchase_price: 50, mrp: 112, gst_rate: 12 }] });
  eq(batchOf(db, gD, 'GD').unit_cost, 50, 'default for a GST-registered clinic: input GST is claimed back');

  // round-off
  const rr = buy(db, s, [{ drug_master_id: d, batch_no: 'RND1', qty_received: 3, purchase_price: 33.33 }], { round_off: 'auto' });
  eq(fin.getPurchase(db, rr.id)!.total, 100, '₹99.99 rounds to ₹100 with round-off ₹0.01');
  eq(fin.getPurchase(db, rr.id)!.round_off, 0.01, '…round-off recorded');

  // validation: nothing partial is stored
  const before = count(db, 'purchase_invoices');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V1' }, { drug_master_id: d, batch_no: '' }]), /Line 2.*batch number/, 'a blank batch number is refused with the line named');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V2', qty_received: 0 }]), /quantity/, 'zero quantity refused');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V3', expiry: '2026-02-30' }]), /expiry/, 'an impossible expiry date (30 Feb) refused');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V4', mrp: 0 }]), /MRP/, 'missing MRP refused');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V5', mrp: 100, selling_price: 120 }]), /cannot be higher than the MRP/, 'selling price above MRP refused');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V6', disc_pct: 120 }]), /discount/i, 'discount over 100% refused');
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'V7' }], { amount_paid: 99999 }), /more than the bill total/, 'paying more than the bill refused');
  throws(() => buy(db, 9999, [{ drug_master_id: d, batch_no: 'V8' }]), /supplier/i, 'unknown supplier refused');
  eq(count(db, 'purchase_invoices'), before, 'none of the refused bills left a trace');
}

// ==============================================================================================
console.log('\n== TEST 3 · sales discounts and GST on the sale ==');
{
  const db = fresh();
  const s = supplier(db);
  const a = drug(db, 'Disc A'), b = drug(db, 'Disc B');
  buy(db, s, [
    { drug_master_id: a, batch_no: 'A1', qty_received: 100, purchase_price: 50, mrp: 100 },
    { drug_master_id: b, batch_no: 'B1', qty_received: 100, purchase_price: 120, mrp: 200 },
  ]);
  // A: 10 × ₹100 = 1,000 (cost 500). B: 10 × ₹200 = 2,000 (cost 1,200). Bill discount ₹300 → A takes ₹100, B ₹200.
  const sale = sell(db, [{ d: a, qty: 10, rate: 100 }, { d: b, qty: 10, rate: 200 }], { discount: 300 });
  eq(sale.subtotal, 3000, 'subtotal ₹3,000');
  eq(sale.discount, 300, 'discount ₹300');
  eq(sale.total, 2700, 'customer pays ₹2,700');
  const items = db.prepare('SELECT drug_master_id, amount, discount_alloc FROM pharmacy_sale_items WHERE sale_id=? ORDER BY id').all(sale.id) as any[];
  eq(items[0].discount_alloc, 100, 'A carries ₹100 of the discount (1,000/3,000 × 300)');
  eq(items[1].discount_alloc, 200, 'B carries ₹200');
  const r = fin.profitReport(db, wide);
  eq(r.totals.gross_amount, 3000, 'report: gross ₹3,000');
  eq(r.totals.discount, 300, 'report: discount ₹300');
  eq(r.totals.revenue, 2700, 'report: actual revenue ₹2,700 (after discount)');
  eq(r.totals.cogs, 1700, 'report: COGS 500 + 1,200');
  eq(r.totals.profit, 1000, 'report: profit ₹1,000 — the discount comes out of profit, not cost');
  near(r.totals.margin_pct, 37.04, 'report: margin 37.04% of what was actually collected');
  const ra = r.drugs.find((x) => x.drug_master_id === a)!, rb = r.drugs.find((x) => x.drug_master_id === b)!;
  ok(ra.revenue === 900 && ra.profit === 400, 'A: revenue ₹900, profit ₹400');
  ok(rb.revenue === 1800 && rb.profit === 600, 'B: revenue ₹1,800, profit ₹600');
  eq(ra.avg_price, 90, 'A realised ₹90 a unit against ₹100 MRP — the report shows the real price');

  // odd paisa: ₹10.00 over three equal lines
  const t = [drug(db, 'T1'), drug(db, 'T2'), drug(db, 'T3')];
  buy(db, s, t.map((d, i) => ({ drug_master_id: d, batch_no: `T${i}`, qty_received: 50, purchase_price: 10, mrp: 20 })));
  const s3 = sell(db, t.map((d) => ({ d, qty: 1, rate: 20 })), { discount: 10 });
  const allocs = (db.prepare('SELECT discount_alloc FROM pharmacy_sale_items WHERE sale_id=? ORDER BY id').all(s3.id) as any[]).map((x) => x.discount_alloc);
  eq(JSON.stringify(allocs), JSON.stringify([3.34, 3.33, 3.33]), '₹10.00 over 3 equal lines → 3.34 / 3.33 / 3.33');
  eq(Math.round(allocs.reduce((x, y) => x + y, 0) * 100), 1000, '…adds back to exactly ₹10.00');
  // floating point: 3 × ₹33.33
  const fp = drug(db, 'FP');
  buy(db, s, [{ drug_master_id: fp, batch_no: 'FP1', qty_received: 50, purchase_price: 10, mrp: 40 }]);
  const sfp = sell(db, [{ d: fp, qty: 3, rate: 33.33 }]);
  eq(sfp.total, 99.99, '3 × ₹33.33 = ₹99.99 exactly (no 99.99000000000001)');

  throws(() => sell(db, [{ d: a, qty: 1, rate: 100 }], { discount: 101 }), /discount.*more than the bill/i, 'a discount bigger than the bill is refused');
  throws(() => sell(db, [{ d: a, qty: 1, rate: 100 }], { discount: -5 }), /negative/i, 'a negative discount is refused');
  throws(() => sell(db, [], {}), /at least one/i, 'an empty bill is refused');

  // GST: a registered clinic's revenue is without the GST it owes onward
  setting(db, 'gst_enabled', 'true'); setting(db, 'gst_registration_type', 'regular');
  const g = drug(db, 'Taxed', 12, 112);
  buy(db, s, [{ drug_master_id: g, batch_no: 'G1', qty_received: 100, purchase_price: 50, gst_rate: 12, mrp: 112 }], { gst_in_cost: false });
  const sg = sell(db, [{ d: g, qty: 10, rate: 112 }]);     // ₹1,120 inclusive = ₹1,000 + ₹120 GST
  const line = db.prepare('SELECT cgst, sgst, gst_rate FROM pharmacy_sale_items WHERE sale_id=?').get(sg.id) as any;
  eq(line.cgst + line.sgst, 120, 'receipt carries ₹120 GST extracted from ₹1,120');
  let rg = fin.profitReport(db, wide);
  const grow = rg.drugs.find((x) => x.drug_master_id === g)!;
  eq(rg.revenue_excludes_gst, true, 'report says revenue excludes GST');
  eq(grow.revenue, 1000, 'revenue ₹1,000 (the ₹120 GST is not the pharmacy\'s income)');
  eq(grow.cogs, 500, 'COGS ₹500 (input GST was claimed back)');
  eq(grow.profit, 500, 'profit ₹500, margin 50%');
  const sgd = sell(db, [{ d: g, qty: 10, rate: 112 }], { discount: 112 });   // 10% off ₹1,120
  rg = fin.profitReport(db, wide);
  const gr2 = rg.drugs.find((x) => x.drug_master_id === g)!;
  eq(gr2.revenue, 1900, 'second sale with ₹112 off: (1,120 − 112) ÷ 1.12 = ₹900 → total ₹1,900');
  ok(sgd.id > 0, 'discounted taxed sale saved');
  const vv = fin.valuation(db, today);
  eq(vv.revenue_excludes_gst, true, 'valuation also says expected revenue excludes GST');
}

// ==============================================================================================
console.log('\n== TEST 4 · returns / cancellations ==');
{
  const db = fresh();
  const salesCols = (db.prepare("PRAGMA table_info(pharmacy_sales)").all() as any[]).map((c) => c.name);
  const hasStatus = salesCols.includes('status') || salesCols.includes('cancelled') || salesCols.includes('is_void');
  ok(!hasStatus, 'documented: pharmacy sales have no cancel / void / return status in this version');
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((t) => t.name);
  ok(!tables.some((t: string) => /return/i.test(t)), 'documented: there is no sales-return or purchase-return table');
  skip('NOT EXECUTED — returns cannot be tested because the app has no returns workflow. No hidden one was invented.');
  skip('If a return feature is added: a returned unit must go back to its ORIGINAL batch at its frozen cost, and revenue + COGS must reverse.');
}

// ==============================================================================================
console.log('\n== TEST 5 · analytics rankings, filters and time zones ==');
{
  const db = fresh();
  const s = supplier(db);
  const D = {
    ALPHA: drug(db, 'ALPHA'), BRAVO: drug(db, 'BRAVO'), CHARLIE: drug(db, 'CHARLIE'),
    DELTA: drug(db, 'DELTA'), ECHO: drug(db, 'ECHO'), FOXTROT: drug(db, 'FOXTROT'),
  };
  const stockIn = (d: number, qty: number, cost: number, mrp: number) =>
    buy(db, s, [{ drug_master_id: d, batch_no: `S${d}`, qty_received: qty, purchase_price: cost, mrp }]);
  stockIn(D.ALPHA, 200, 10, 20);
  stockIn(D.BRAVO, 100, 90, 100);
  stockIn(D.CHARLIE, 40, 5, 50);
  stockIn(D.DELTA, 100, 40, 50);
  stockIn(D.ECHO, 40, 8, 16);
  stockIn(D.FOXTROT, 1000, 15, 30);
  sell(db, [{ d: D.ALPHA, qty: 100, rate: 20 }]);
  sell(db, [{ d: D.BRAVO, qty: 20, rate: 100 }]);
  sell(db, [{ d: D.CHARLIE, qty: 5, rate: 50 }]);
  sell(db, [{ d: D.DELTA, qty: 50, rate: 50 }]);
  sell(db, [{ d: D.ALPHA, qty: 50, rate: 20 }, { d: D.CHARLIE, qty: 5, rate: 50 }]);
  sell(db, [{ d: D.FOXTROT, qty: 10, rate: 30 }]);

  const r = fin.profitReport(db, wide);
  const by = (n: string) => r.drugs.find((x) => x.name === n)!;
  ok(by('ALPHA').revenue === 3000 && by('ALPHA').profit === 1500 && by('ALPHA').margin_pct === 50 && by('ALPHA').sales === 2, 'ALPHA ₹3,000 / profit ₹1,500 / 50% / 2 bills');
  ok(by('BRAVO').revenue === 2000 && by('BRAVO').profit === 200 && by('BRAVO').margin_pct === 10, 'BRAVO ₹2,000 / profit ₹200 / 10%');
  ok(by('CHARLIE').revenue === 500 && by('CHARLIE').profit === 450 && by('CHARLIE').margin_pct === 90 && by('CHARLIE').sales === 2, 'CHARLIE ₹500 / profit ₹450 / 90% / 2 bills');
  ok(by('DELTA').revenue === 2500 && by('DELTA').profit === 500 && by('DELTA').margin_pct === 20, 'DELTA ₹2,500 / profit ₹500 / 20%');
  eq(by('ALPHA').gp_per_unit, 10, 'ALPHA gross profit per unit ₹10');
  eq(by('CHARLIE').gp_per_unit, 45, 'CHARLIE gross profit per unit ₹45');
  eq(by('ALPHA').markup_pct, 100, 'ALPHA markup 100%');
  eq(r.totals.revenue, 8300, 'total revenue ₹8,300');
  eq(r.totals.profit, 2800, 'total profit ₹2,800');
  near(r.totals.margin_pct, 33.73, 'overall margin 33.73%');
  const k = r.rankings;
  const nm = (xs: any[]) => xs.map((x) => x.name).join(',');
  eq(nm(k.best_by_units), 'ALPHA,DELTA,BRAVO,CHARLIE,FOXTROT', 'best sellers by quantity (ties by name)');
  eq(nm(k.best_by_revenue), 'ALPHA,DELTA,BRAVO,CHARLIE,FOXTROT', 'best sellers by revenue');
  eq(nm(k.best_by_sales), 'ALPHA,CHARLIE,BRAVO,DELTA,FOXTROT', 'best sellers by number of bills');
  eq(nm(k.highest_profit), 'ALPHA,DELTA,CHARLIE,BRAVO,FOXTROT', 'highest gross profit');
  eq(nm(k.highest_margin), 'CHARLIE,ALPHA,FOXTROT,DELTA,BRAVO', 'highest margin');
  eq(nm(k.lowest_margin), 'BRAVO,DELTA,ALPHA,FOXTROT,CHARLIE', 'lowest margin');
  eq(nm(k.high_revenue_low_profit), 'DELTA', 'high revenue, low profit: big seller whose margin is under the 33.73% average');
  eq(nm(k.low_profit_high_volume), 'DELTA', 'low profit, high volume');
  eq(nm(k.no_sales), 'ECHO', 'stocked but never sold');
  eq(nm(k.slow_movers), 'FOXTROT,BRAVO', 'slow movers: stock ≥ 4× what sold (BRAVO is exactly 80 = 4×20; ordered by money tied up)');
  eq(by('ECHO').units, 0, 'ECHO appears with zero sales');
  eq(by('ECHO').stock_units, 40, '…and its stock');
  // the same rankings come out of the pure function (so the screen can re-rank)
  eq(nm(rankProfit(r.drugs, 2).best_by_units), 'ALPHA,DELTA', 'top-N is honoured');

  // an uncosted sale (batch with no cost recorded) must not be passed off as free
  const u = drug(db, 'UNCOSTED');
  db.prepare("INSERT INTO drug_stock_batches (drug_master_id, batch_no, expiry, qty_received, qty_remaining, mrp) VALUES (?, 'NOCOST', '2030-01-01', 50, 50, 100)").run(u);
  sell(db, [{ d: u, qty: 5, rate: 100 }]);
  const r2 = fin.profitReport(db, wide);
  const ur = r2.drugs.find((x) => x.name === 'UNCOSTED')!;
  ok(ur.revenue === 500 && ur.uncosted_units === 5 && ur.cogs === 0 && ur.profit === 0 && ur.margin_pct === null, 'sale from a no-cost batch: revenue counted, but profit/margin left blank, 5 units flagged uncosted');
  eq(r2.totals.profit, 2800, 'the pharmacy profit total is not inflated by the uncosted sale');
  eq(r2.totals.uncosted_units, 5, '…and the report says how much is uncosted');
  const chk = fin.integrityChecks(db);
  ok(chk.some((c) => c.code === 'uncosted_sales' && c.count === 1), 'integrity check lists the uncosted sale');
  ok(chk.some((c) => c.code === 'uncosted_stock'), '…and the uncosted stock');
  ok(!chk.some((c) => c.severity === 'error'), '…and no data errors in a clean ledger');
}
{
  // date filters + time zones
  const db = fresh();
  const s = supplier(db);
  const d = drug(db, 'Dated');
  buy(db, s, [{ drug_master_id: d, batch_no: 'DT', qty_received: 500, purchase_price: 10, mrp: 30 }]);
  const mk = (utc: string) => { const sl = sell(db, [{ d, qty: 1, rate: 30 }]); backdate(db, sl.id, utc); return sl.id; };
  const localDay = (utc: string) => fin.localISO(new Date(utc.replace(' ', 'T') + 'Z'));

  // the sale at 20:00 UTC: 01:30 NEXT DAY in India, same day in London, previous afternoon in California
  const late = '2026-03-10 20:00:00';
  mk(late);
  const dayOf = localDay(late);
  eq(fin.profitReport(db, { from: dayOf, to: dayOf }).totals.units, 1, `a sale made at ${late} UTC is on ITS LOCAL day (${dayOf}) in this zone`);
  const otherDay = dayOf === '2026-03-10' ? '2026-03-11' : '2026-03-10';
  eq(fin.profitReport(db, { from: otherDay, to: otherDay }).totals.units, 0, `…and not on ${otherDay}`);

  // exact day edges, built from LOCAL clock times (so they hold in every zone)
  const edge = (y: number, m: number, dd: number, h: number, mi: number, sec: number) => utcStr(new Date(y, m, dd, h, mi, sec));
  mk(edge(2026, 0, 31, 23, 59, 59));   // last second of 31 Jan, local
  mk(edge(2026, 1, 1, 0, 0, 0));       // first second of 1 Feb, local
  mk(edge(2026, 1, 28, 23, 59, 59));
  mk(edge(2026, 2, 1, 0, 0, 1));
  eq(fin.profitReport(db, { from: '2026-01-31', to: '2026-01-31' }).totals.units, 1, '23:59:59 on 31 Jan belongs to 31 Jan');
  eq(fin.profitReport(db, { from: '2026-02-01', to: '2026-02-01' }).totals.units, 1, '00:00:00 on 1 Feb belongs to 1 Feb');
  eq(fin.profitReport(db, { from: '2026-02-01', to: '2026-02-28' }).totals.units, 2, '"previous month" (1–28 Feb) holds exactly the two February sales');
  eq(fin.profitReport(db, { from: '2026-03-01', to: '2026-03-31' }).totals.units, 2, '"current month" (March) holds the 00:00:01 sale on 1 Mar and the 10/11 Mar one');
  eq(fin.profitReport(db, { from: '2026-01-01', to: '2026-03-31' }).totals.units, 5, 'a custom Q1 range holds all five');
  eq(fin.profitReport(db, { from: '2026-02-28', to: '2026-02-01' }).totals.units, 2, 'reversed dates are treated as a range, not an empty set');
  const months = fin.profitReport(db, { from: '2026-01-01', to: '2026-03-31' }).by_month.map((m) => `${m.month}:${m.revenue}`).join(' ');
  eq(months, '2026-01:30 2026-02:60 2026-03:60', 'month buckets use the local month too (Jan ₹30, Feb ₹60, Mar ₹60)');
  throws(() => fin.profitReport(db, { from: 'yesterday', to: today }), /valid start and end date/, 'a bad date is refused with a plain message');
}

// ==============================================================================================
console.log('\n== TEST 6 · failure handling, retries, payments ==');
{
  const db = fresh();
  const s = supplier(db);
  const d = drug(db, 'Retry drug');
  const e = drug(db, 'Second drug');

  // a failure half way through a purchase leaves nothing behind
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON purchase_invoice_items WHEN NEW.batch_no='BOOM' BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END;");
  throws(() => buy(db, s, [{ drug_master_id: d, batch_no: 'OK1' }, { drug_master_id: e, batch_no: 'BOOM' }]), /disk full/, 'a database failure on line 2 surfaces as an error');
  eq(count(db, 'purchase_invoices'), 0, '…no invoice header was kept');
  eq(count(db, 'drug_stock_batches'), 0, '…line 1\'s stock was rolled back too');
  db.exec('DROP TRIGGER boom');
  const retry = buy(db, s, [{ drug_master_id: d, batch_no: 'OK1' }, { drug_master_id: e, batch_no: 'OK2' }], { invoice_number: 'RETRY-1', client_ref: 'r1' });
  ok(!retry.duplicate, 'the retry after the failure saves normally');
  eq(stockOf(db, d) + stockOf(db, e), 200, '…exactly once');

  // sale: shortage on the 2nd line rolls the whole sale back
  eq(stockOf(db, d), 100, 'drug stock 100');
  throws(() => sell(db, [{ d, qty: 10, rate: 100 }, { d: e, qty: 150, rate: 100 }]), /Insufficient stock for Second drug/, 'a shortage on line 2 is refused with the drug named');
  eq(stockOf(db, d), 100, '…line 1 stock untouched');
  eq(stockOf(db, e), 100, '…line 2 stock untouched');
  eq(count(db, 'pharmacy_sales'), 0, '…no sale row');
  eq(count(db, 'dispensing_register'), 0, '…no register rows');
  // double click / network retry
  const first = sell(db, [{ d, qty: 10, rate: 100 }], { client_ref: 'sale-1' });
  const again = sell(db, [{ d, qty: 10, rate: 100 }], { client_ref: 'sale-1' });
  ok(first.id === again.id, 'the same sale attempt sent twice is one sale');
  eq(stockOf(db, d), 90, '…stock was reduced once');
  eq(count(db, 'pharmacy_sales'), 1, '…one sale row');
  const other = sell(db, [{ d, qty: 10, rate: 100 }], { client_ref: 'sale-2' });
  ok(other.id !== first.id && stockOf(db, d) === 80, 'a genuinely new sale (new reference) still works');

  // payments: recording a bill ≠ paying it
  const bill = buy(db, s, [{ drug_master_id: d, batch_no: 'PAY1', qty_received: 100, purchase_price: 50 }], { invoice_number: 'PAY-1' });
  eq(fin.getPurchase(db, bill.id)!.payment_status, 'unpaid', 'new bill: unpaid');
  const p1 = fin.recordPayment(db, bill.id, { amount: 2000, mode: 'UPI', client_ref: 'pay-1' });
  let v = fin.getPurchase(db, bill.id)!;
  eq(v.payment_status, 'partial', 'part-paid: partial');
  eq(v.outstanding, 3000, '…₹3,000 outstanding');
  const p1b = fin.recordPayment(db, bill.id, { amount: 2000, mode: 'UPI', client_ref: 'pay-1' });
  ok(p1b.duplicate && p1b.payment_id === p1.payment_id, 'the same payment sent twice is recorded once');
  eq(fin.getPurchase(db, bill.id)!.outstanding, 3000, '…outstanding unchanged by the repeat');
  throws(() => fin.recordPayment(db, bill.id, { amount: 3000.01 }), /more than the ₹3000.00 still owed/, 'paying more than is owed is refused');
  throws(() => fin.recordPayment(db, bill.id, { amount: 0 }), /Enter the amount/, 'a zero payment is refused');
  fin.recordPayment(db, bill.id, { amount: 3000, mode: 'Cash', reference: 'rcpt 7' });
  v = fin.getPurchase(db, bill.id)!;
  ok(v.payment_status === 'paid' && v.outstanding === 0 && v.payments.length === 2, 'fully paid after the second payment; two payments on record');
  throws(() => fin.recordPayment(db, bill.id, { amount: 1 }), /still owed/, 'nothing more can be paid on a settled bill');
  const upfront = buy(db, s, [{ drug_master_id: d, batch_no: 'PAY2', qty_received: 10, purchase_price: 50 }], { invoice_number: 'PAY-2', amount_paid: 200, payment_mode: 'Cash' });
  const uv = fin.getPurchase(db, upfront.id)!;
  ok(uv.payment_status === 'partial' && uv.outstanding === 300 && uv.payments.length === 1, 'paid ₹200 of ₹500 when entering the bill → partial, ₹300 owed, payment recorded');

  // legacy "partly paid" bill whose amount was never recorded
  db.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, total, payment_status, amount_paid) VALUES ('OLD-1', ?, '2025-01-01', 1000, 'partial', NULL)").run(s);
  const oldId = (db.prepare("SELECT id FROM purchase_invoices WHERE invoice_number='OLD-1'").get() as any).id;
  eq(fin.getPurchase(db, oldId)!.outstanding, null, 'legacy part-paid bill: outstanding is UNKNOWN (null), not guessed');
  throws(() => fin.recordPayment(db, oldId, { amount: 100 }), /unknown/, 'paying it asks for the earlier amount first');
  fin.recordPayment(db, oldId, { amount: 100, opening_paid: 400 });
  v = fin.getPurchase(db, oldId)!;
  ok(v.outstanding === 500 && v.payment_status === 'partial' && v.payments.length === 2, 'with the earlier ₹400 entered: ₹400 + ₹100 paid, ₹500 owed');

  // integrity checks see a corrupted ledger
  db.prepare('UPDATE drug_stock_batches SET qty_remaining = -3 WHERE drug_master_id = ? AND batch_no = ?').run(d, 'PAY1');
  ok(fin.integrityChecks(db).some((c) => c.code === 'negative_stock' && c.severity === 'error'), 'negative stock is reported as an error');
}

// ==============================================================================================
console.log('\n== valuation · suppliers · price history ==');
{
  const db = fresh();
  const s1 = supplier(db, 'North Distributors'), s2 = supplier(db, 'South Agencies');
  const d = drug(db, 'Valued', 0, 100);
  const e = drug(db, 'Expiring', 0, 100);
  const x = drug(db, 'Gone', 0, 100);
  // selling price below MRP
  buy(db, s1, [{ drug_master_id: d, batch_no: 'V1', qty_received: 100, purchase_price: 50, mrp: 100, selling_price: 90 }], { invoice_number: 'N-1', invoice_date: '2026-01-10' });
  buy(db, s1, [{ drug_master_id: e, batch_no: 'E1', qty_received: 10, purchase_price: 20, mrp: 40, expiry: '2026-07-15' }], { invoice_number: 'N-2', invoice_date: '2026-02-10' });
  buy(db, s1, [{ drug_master_id: x, batch_no: 'X1', qty_received: 10, purchase_price: 30, mrp: 60, expiry: '2026-05-01' }], { invoice_number: 'N-3', invoice_date: '2026-02-12' });
  const v = fin.valuation(db, '2026-06-01');
  eq(v.sellable.units, 110, 'sellable = valued 100 + expiring 10 (expired 10 excluded)');
  eq(v.sellable.at_cost, 5200, 'at cost 100×50 + 10×20 = ₹5,200');
  eq(v.sellable.at_mrp, 10400, 'at MRP 100×100 + 10×40 = ₹10,400');
  eq(v.sellable.at_selling, 9400, 'at selling price 100×90 + 10×40 = ₹9,400 (a batch with no selling price uses MRP)');
  eq(v.sellable.expected_profit, 4200, 'expected profit ₹9,400 − ₹5,200 = ₹4,200');
  eq(v.expired.units, 10, 'expired stock shown separately: 10 units');
  eq(v.expired.at_cost, 300, '…₹300 at cost to write off');
  eq(v.near_expiry.units, 10, 'near expiry (≤90 days): the 10 expiring on 15 Jul (44 days)');
  eq(v.near_expiry_list[0].days, 44, '…44 days left');
  // re-buy at a higher price: replacement cost moves, stock cost does not
  buy(db, s2, [{ drug_master_id: d, batch_no: 'V2', qty_received: 10, purchase_price: 70, mrp: 100 }], { invoice_number: 'S-1', invoice_date: '2026-05-20' });
  const v2 = fin.valuation(db, '2026-06-01');
  eq(v2.sellable.at_cost, 5900, 'at cost now ₹5,200 + 10×70 = ₹5,900 (history preserved, not re-priced)');
  eq(v2.sellable.at_replacement_cost, 7900, 'replacement cost: all 110 units of Valued at the latest ₹70 (₹7,700) + 10 Expiring at ₹20 (₹200) = ₹7,900');
  ok(v2.sellable.at_replacement_cost > v2.sellable.at_cost, '…higher than what the stock actually cost (₹5,900) — the two are reported separately');

  // suppliers
  fin.recordPayment(db, 1, { amount: 2000, mode: 'UPI', paid_on: '2026-02-20' });
  const sr = fin.supplierReport(db, { from: '2026-01-01', to: '2026-06-30' });
  const north = sr.suppliers.find((q: any) => q.name === 'North Distributors')!;
  eq(north.invoices, 3, 'North: 3 bills');
  eq(north.billed, 5500, 'North billed 5,000 + 200 + 300');
  eq(north.paid, 2000, 'North paid ₹2,000');
  eq(north.outstanding, 3500, 'North outstanding ₹3,500');
  eq(sr.totals.owed_now, 3500 + 700, 'owed now across suppliers: North ₹3,500 + South ₹700');
  ok(sr.by_month.length >= 3 && sr.by_month.some((m: any) => m.month === '2026-01' && m.billed === 5000), 'monthly totals by supplier (Jan: North ₹5,000)');
  eq(sr.payments.length, 1, 'payment history lists the ₹2,000 payment');
  eq(sr.purchase_returns, null, 'purchase returns: not tracked by this version (reported as such)');
  const history = fin.drugPriceHistory(db, d);
  eq(history.length, 2, 'price history: two purchases of Valued');
  eq(history[1].rate_change_pct, 40, '…second purchase is +40% on the rate (₹50 → ₹70)');
  eq(history[1].supplier, 'South Agencies', '…from South Agencies');
  buy(db, s1, [{ drug_master_id: d, batch_no: 'V3', qty_received: 10, purchase_price: 55, mrp: 100 }], { invoice_number: 'N-4', invoice_date: '2026-05-25' });
  const sr2 = fin.supplierReport(db, { from: '2026-05-01', to: '2026-06-30' });
  const ch = sr2.price_changes.find((c: any) => c.drug === 'Valued' && c.supplier === 'North Distributors');
  ok(ch && ch.prev_rate === 50 && ch.rate === 55 && ch.change_pct === 10, 'supplier price change spotted: North raised Valued ₹50 → ₹55 (+10%)');
}

// ==============================================================================================
console.log('\n== upgrade: a v4-shaped database with real-looking data → v5 ==');
{
  const db = fresh();
  // 1. turn the fresh database back into what a v4 clinic has on disk
  const dropIdx = ['ux_purchase_client_ref', 'ux_sales_client_ref', 'ux_purchase_payment_ref', 'idx_register_batch', 'idx_register_sale_item', 'idx_psi_sale', 'idx_psi_drug'];
  for (const i of dropIdx) db.exec(`DROP INDEX IF EXISTS ${i}`);
  db.exec('DROP TABLE purchase_payments');
  const v5cols: Record<string, string[]> = {
    purchase_invoices: ['other_charges', 'round_off', 'amount_paid', 'client_ref', 'gst_in_cost'],
    purchase_invoice_items: ['disc_pct', 'discount_amount', 'taxable_value', 'gst_amount', 'selling_price', 'unit_cost'],
    drug_stock_batches: ['selling_price', 'unit_cost'],
    dispensing_register: ['unit_cost'],
    pharmacy_sale_items: ['discount_alloc'],
    pharmacy_sales: ['client_ref'],
  };
  for (const [t, cols] of Object.entries(v5cols)) for (const c of cols) db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  db.prepare("UPDATE schema_meta SET value='4' WHERE key='version'").run();
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  ok(!cols('drug_stock_batches').includes('unit_cost') && !cols('purchase_invoices').includes('amount_paid'), 'the test database really is v4-shaped before the upgrade');

  // 2. legacy rows exactly as the old code wrote them
  const sup = Number(db.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES ('Legacy Co', 'DL-L')").run().lastInsertRowid);
  const dA = drug(db, 'Legacy A'), dB = drug(db, 'Legacy B'), dC = drug(db, 'Legacy C');
  const inv = (no: string, status: string, total: number) =>
    Number(db.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, subtotal, total, payment_mode, payment_status) VALUES (?, ?, '2025-11-01', ?, ?, 'Cash', ?)").run(no, sup, total, total, status).lastInsertRowid);
  const iPaid = inv('L-PAID', 'paid', 5000), iPart = inv('L-PART', 'partial', 3000), iUnpaid = inv('L-UNPAID', 'unpaid', 800);
  const line = (invId: number, d: number, batch: string, qty: number, free: number, price: number) =>
    Number(db.prepare("INSERT INTO purchase_invoice_items (invoice_id, drug_master_id, batch_no, expiry, qty_received, free_qty, purchase_price, mrp, gst_rate, line_total) VALUES (?, ?, ?, '2030-01-01', ?, ?, ?, 100, 12, ?)").run(invId, d, batch, qty, free, price, qty * price).lastInsertRowid);
  const l1 = line(iPaid, dA, 'LA', 100, 10, 50);            // ₹5,000 for 110 units
  const l2 = line(iPart, dB, 'LB', 60, 0, 50);              // ₹3,000
  line(iUnpaid, dC, 'LC', 8, 0, 100);
  const batch = (d: number, bn: string, units: number, price: number | null, itemId: number | null) =>
    Number(db.prepare("INSERT INTO drug_stock_batches (drug_master_id, purchase_item_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, mrp) VALUES (?, ?, ?, '2030-01-01', ?, ?, ?, 100)").run(d, itemId, bn, units, units, price).lastInsertRowid);
  const bA = batch(dA, 'LA', 110, 50, l1), bB = batch(dB, 'LB', 60, 50, l2), bN = batch(dC, 'NOPRICE', 20, null, null);
  const mkSale = (no: string, discount: number, mode: string, items: [number, number, number][]) => {
    const sub = items.reduce((x, i) => x + i[1] * i[2], 0);
    const sid = Number(db.prepare("INSERT INTO pharmacy_sales (sale_number, subtotal, discount, total, payment_mode) VALUES (?, ?, ?, ?, ?)").run(no, sub, discount, sub - discount, mode).lastInsertRowid);
    for (const [bid, qty, rate] of items) {
      const drugId = (db.prepare('SELECT drug_master_id d FROM drug_stock_batches WHERE id=?').get(bid) as any).d;
      const itemId = Number(db.prepare("INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, batch_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, 'x', ?, ?, ?)").run(sid, drugId, bid, qty, rate, qty * rate).lastInsertRowid);
      db.prepare("INSERT INTO dispensing_register (sale_item_id, sale_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate) VALUES (?, ?, ?, ?, 'b', '2030-01-01', 'OTC', ?, ?)").run(itemId, sid, drugId, bid, qty, rate);
    }
    return sid;
  };
  const s1 = mkSale('L-S1', 300, 'Cash', [[bA, 10, 100], [bB, 20, 100]]);   // 1,000 + 2,000, discount ₹300 → 100 / 200
  const s2 = mkSale('L-S2', 0, 'IPD-bill', [[bN, 5, 100]]);
  const payRowsBefore = db.prepare("SELECT name FROM sqlite_master WHERE name='purchase_payments'").get();
  ok(!payRowsBefore, 'no payments table yet');

  // 3. the upgrade
  runMigrations(db);
  eq((db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as any).value, '5', 'schema version is now 5');
  ok(cols('drug_stock_batches').includes('unit_cost') && cols('purchase_invoices').includes('amount_paid') && cols('dispensing_register').includes('unit_cost'), 'new columns exist');
  eq(batchOf(db, dA, 'LA').unit_cost, 45.4545, 'batch cost backfilled: ₹5,000 for 110 units = ₹45.4545 (free units counted)');
  eq(batchOf(db, dB, 'LB').unit_cost, 50, 'batch without free units: ₹50');
  eq(batchOf(db, dC, 'NOPRICE').unit_cost, null, 'a batch with NO recorded cost stays unknown (not invented as ₹0)');
  const reg = db.prepare('SELECT unit_cost FROM dispensing_register ORDER BY id').all() as any[];
  eq(JSON.stringify(reg.map((x) => x.unit_cost)), JSON.stringify([45.4545, 50, null]), 'past dispenses take the batch cost they came from (unknown stays unknown)');
  const pl = db.prepare('SELECT taxable_value, gst_amount, unit_cost FROM purchase_invoice_items WHERE id=?').get(l1) as any;
  ok(pl.taxable_value === 5000 && pl.gst_amount === 600 && pl.unit_cost === 45.4545, 'old purchase line: taxable ₹5,000, GST ₹600, unit cost ₹45.4545');
  const al = db.prepare('SELECT discount_alloc FROM pharmacy_sale_items WHERE sale_id=? ORDER BY id').all(s1) as any[];
  eq(JSON.stringify(al.map((x) => x.discount_alloc)), JSON.stringify([100, 200]), 'old sale discount ₹300 shared 100 / 200 by value');
  const paidInv = db.prepare('SELECT amount_paid, payment_status FROM purchase_invoices WHERE id=?').get(iPaid) as any;
  ok(paidInv.amount_paid === 5000 && paidInv.payment_status === 'paid', 'old "paid" bill: amount paid = total');
  eq(count(db, 'purchase_payments'), 1, '…with one payment row (not duplicated)');
  eq((db.prepare('SELECT amount_paid FROM purchase_invoices WHERE id=?').get(iPart) as any).amount_paid, null, 'old "partial" bill: amount paid is UNKNOWN (null)');
  eq((db.prepare('SELECT amount_paid FROM purchase_invoices WHERE id=?').get(iUnpaid) as any).amount_paid, 0, 'old unpaid bill: ₹0 paid');
  const list = fin.listPurchases(db, {}) as any[];
  const byNo = (n: string) => list.find((x) => x.invoice_number === n);
  ok(byNo('L-PAID').outstanding === 0 && byNo('L-PART').outstanding === null && byNo('L-UNPAID').outstanding === 800, 'outstanding: 0 / unknown / ₹800');
  ok(fin.integrityChecks(db).some((c) => c.code === 'legacy_partial' && c.count === 1), 'integrity check lists the one bill whose payment is unknown');

  // 4. idempotent: a second start changes nothing
  const snap = JSON.stringify([db.prepare('SELECT * FROM drug_stock_batches ORDER BY id').all(), db.prepare('SELECT * FROM purchase_payments').all(), db.prepare('SELECT discount_alloc FROM pharmacy_sale_items').all()]);
  db.prepare("UPDATE schema_meta SET value='4' WHERE key='version'").run();   // even if the version marker were lost
  runMigrations(db);
  ok(JSON.stringify([db.prepare('SELECT * FROM drug_stock_batches ORDER BY id').all(), db.prepare('SELECT * FROM purchase_payments').all(), db.prepare('SELECT discount_alloc FROM pharmacy_sale_items').all()]) === snap, 'running the upgrade again changes nothing and adds no duplicate payments');

  // 5. the upgraded data reports sensibly, and the new code works on top of it
  const r = fin.profitReport(db, wide);
  const lega = r.drugs.find((x) => x.name === 'Legacy A')!;
  eq(lega.revenue, 900, 'old sale reported: Legacy A revenue ₹900 (₹1,000 less its ₹100 share of the discount)');
  near(lega.cogs, 454.55, 'Legacy A cost 10 × ₹45.4545 = ₹454.55', 0.011);
  ok(r.totals.uncosted_units === 5, 'the sale from the no-cost batch is flagged uncosted, not treated as free profit');
  eq(r.ward.units, 5, 'ward-billed (IPD) sale reported separately from counter sales');
  const newSale = sell(db, [{ d: dA, qty: 10, rate: 100 }]);
  eq((db.prepare('SELECT unit_cost FROM dispensing_register WHERE sale_id=?').get(newSale.id) as any).unit_cost, 45.4545, 'a sale made after the upgrade freezes the (backfilled) batch cost');
  void s2;
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
