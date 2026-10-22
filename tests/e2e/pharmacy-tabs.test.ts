// The Pharmacy tabs that read the shelf and the supplier ledger:
//   "Drugs in my clinic" (pharmacy:clinicStock) — which drugs the clinic actually holds, and what each shelf looks like;
//   the Wholesalers list (wholesalers:summary)  — how much was bought from each supplier and what is owed TODAY.
// Real handlers on a temporary database. The rules are the ones the rest of the pharmacy already uses, so these checks also
// pin the new views to the old ones (listDrugs' stock, the alert boxes' 90-day window, the Purchases tab's "to pay", Analytics' "owed now").
import './electron-stub';
import { ok, eq, near, section, finish } from './lib';

(async () => {
  const { boot, call, getDb } = await import('./harness');
  boot();
  const db = getDb();
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const today = day(0);
  const mk = (name: string, extra: Record<string, any> = {}) =>
    call('pharmacy:upsertDrug', { name, schedule: 'OTC', default_mrp: 20, gst_rate: 12, low_stock_threshold: 10, ...extra });
  const batch = (drug: number, no: string, qty: number, expiry: string, extra: Record<string, any> = {}) =>
    call('pharmacy:upsertBatch', { drug_master_id: drug, batch_no: no, expiry, qty_received: qty, qty_remaining: qty, purchase_price: 4, mrp: 9, ...extra });

  const sup1 = await call('wholesalers:upsert', { name: 'Tabs Supplier One', drug_license_no: 'DL-T1' });
  const sup2 = await call('wholesalers:upsert', { name: 'Tabs Supplier Two', drug_license_no: 'DL-T2' });

  // ============================================================================================================
  section('1 · which drugs are "in my clinic"');
  const A = await mk('Tab Alpha 500');                           // bought on a bill, two batches
  const B = await mk('Tab Bravo 10');                            // had stock, now at zero
  const C = await mk('Tab Charlie 5');                           // only in the Drug List
  const D = await mk('Tab Delta 250');                           // retired, but a few units are left (expired)
  const E = await mk('Tab Echo 1', { is_active: 0 });            // retired, nothing left
  const F = await mk('Tab Foxtrot 20');                          // hand-typed stock, a handful
  const G = await mk('Tab Golf 40');                             // its only batch was switched off
  const H = await mk('Tab Hotel 60');                            // bought once; the batch row is gone

  const pur = await call('purchase:create', {
    client_ref: 'tabs-1', invoice_number: 'T-1', wholesaler_id: sup1.id, invoice_date: today,
    items: [
      { drug_master_id: A.id, batch_no: 'A-LATE', expiry: day(400), qty_received: 40, purchase_price: 10, mrp: 25 },
      { drug_master_id: A.id, batch_no: 'A-SOON', expiry: day(30), qty_received: 5, purchase_price: 8, mrp: 20, selling_price: 20 },
    ],
  });
  ok(pur.ok, `a purchase bill is saved (${pur.ok ? '' : pur.error})`);
  await batch(B.id, 'B-1', 5, day(200));
  db.prepare('UPDATE drug_stock_batches SET qty_remaining=0 WHERE drug_master_id=?').run(B.id);
  await batch(D.id, 'D-1', 7, day(-10));
  await call('pharmacy:upsertDrug', { ...D, is_active: 0 });
  await batch(E.id, 'E-1', 3, day(100));
  db.prepare('UPDATE drug_stock_batches SET qty_remaining=0 WHERE drug_master_id=?').run(E.id);
  await batch(F.id, 'F-1', 6, day(300));
  await batch(G.id, 'G-1', 50, day(300));
  db.prepare('UPDATE drug_stock_batches SET is_active=0 WHERE drug_master_id=?').run(G.id);
  const purH = await call('purchase:create', { client_ref: 'tabs-h', invoice_number: 'T-H', wholesaler_id: sup1.id, invoice_date: today, items: [{ drug_master_id: H.id, batch_no: 'H-1', expiry: day(300), qty_received: 10, purchase_price: 5, mrp: 12 }] });
  ok(purH.ok, 'a second purchase bill is saved');
  db.prepare('DELETE FROM drug_stock_batches WHERE drug_master_id=?').run(H.id);

  const rows: any[] = await call('pharmacy:clinicStock');
  const by = (d: { id: number }) => rows.find((r) => r.id === d.id);

  ok(!!by(A), 'a drug bought on a purchase bill is in the clinic');
  ok(!by(C), 'a drug that only exists in the Drug List is NOT');
  eq(by(A).stock_qty, 45, 'Alpha: 40 + 5 units in stock');
  eq(by(A).batch_count, 2, '…in two batches');
  eq(by(A).next_expiry, day(30), '…the next expiry is the earliest batch that still has units');
  ok(by(A).expiring_soon && !by(A).expired, '…it is expiring soon (30 days), not expired');
  ok(!by(A).low_stock && !by(A).out_of_stock, '…and not low or out');
  const exp = one('SELECT SUM(qty_remaining * COALESCE(unit_cost, purchase_price)) / SUM(qty_remaining) AS c FROM drug_stock_batches WHERE drug_master_id=?', A.id).c;
  near(by(A).avg_cost, exp, 'cost per unit is the weighted average of the units on the shelf', 0.0001);
  eq(by(A).price_min, 20, 'selling price from…');
  eq(by(A).price_max, 25, '…to');
  ok(!by(A).cost_unverified, 'stock that came on a purchase bill has a recorded cost');

  ok(!!by(B) && by(B).out_of_stock && !by(B).low_stock, 'a drug that is now at zero is "Out of stock" — and not also "Low"');
  eq(by(B).next_expiry, null, '…with no next expiry (nothing on the shelf)');
  ok(!!by(D) && Number(by(D).is_active) === 0, 'a retired drug that still has stock stays visible (stock is never hidden)');
  ok(by(D).expired && !by(D).out_of_stock && !by(D).low_stock, '…flagged expired, but never "reorder" — it is retired');
  ok(by(D).cost_unverified, '…and hand-typed stock reads "cost not recorded"');
  ok(!by(E), 'a retired drug with nothing left is not listed');
  ok(!!by(F) && by(F).low_stock && !by(F).out_of_stock, '6 units against a low-stock level of 10 is "Low"');
  ok(by(F).cost_unverified, '…hand-typed, so "cost not recorded"');
  ok(!!by(G) && by(G).stock_qty === 0 && by(G).batch_count === 0 && by(G).out_of_stock, 'a switched-off batch is not counted as stock');
  ok(!!by(H) && by(H).out_of_stock && by(H).batch_count === 0, 'a drug that was bought stays in the clinic even when its batch row is gone');

  // the same stock figure everywhere
  const listed: any[] = await call('pharmacy:listDrugs', { activeOnly: false });
  let same = 0;
  for (const d of [A, B, D, F, G]) if (listed.find((x) => x.id === d.id)?.stock_qty === by(d).stock_qty) same++;
  eq(same, 5, 'the stock figure is the same as the Drug List / Dispense screens use');

  // the 90-day window and the day boundaries
  const X = await mk('Tab X-ray 1'); const Y = await mk('Tab Yankee 2'); const Z = await mk('Tab Zulu 3'); const W = await mk('Tab Whiskey 4');
  await batch(X.id, 'X-1', 1, day(-1));      // yesterday → expired
  await batch(Y.id, 'Y-1', 1, day(91));      // 91 days → not yet "soon"
  await batch(Z.id, 'Z-1', 1, today);        // today → still usable, but soon
  await batch(W.id, 'W-1', 1, day(90));      // 90 days → inside the window
  const r2: any[] = await call('pharmacy:clinicStock');
  const b2 = (d: { id: number }) => r2.find((r) => r.id === d.id);
  ok(b2(X).expired && !b2(X).expiring_soon, 'expired yesterday → Expired (and not "soon")');
  ok(!b2(Y).expired && !b2(Y).expiring_soon, '91 days away → neither');
  ok(!b2(Z).expired && b2(Z).expiring_soon, 'expires today → Expiring soon, not Expired');
  ok(!b2(W).expired && b2(W).expiring_soon, '90 days away → Expiring soon');
  const alerts = await call('pharmacy:alerts');
  const inAlerts = new Set(alerts.expiringSoon.map((b: any) => b.drug_master_id));
  const flagged = [A, X, Z, W].every((d) => (b2(d).expired || b2(d).expiring_soon) && inAlerts.has(d.id));
  ok(flagged && !inAlerts.has(Y.id), 'the drugs flagged here are the ones the old expiry alert named — same 90-day window');

  // ============================================================================================================
  section('2 · what is owed to each supplier');
  const mkBill = (no: string, supplier: number, drug: number, qty: number, price: number, date: string, extra: Record<string, any> = {}) =>
    call('purchase:create', { client_ref: `tabs-${no}`, invoice_number: no, wholesaler_id: supplier, invoice_date: date, items: [{ drug_master_id: drug, batch_no: `${no}-B`, expiry: day(500), qty_received: qty, purchase_price: price, mrp: price * 2 }], ...extra });
  const s1 = await mkBill('S-1', sup1.id, A.id, 10, 100, day(-20));                   // unpaid
  const s2 = await mkBill('S-2', sup1.id, A.id, 10, 50, day(-15), { amount_paid: 200, payment_mode: 'Cash' });   // part paid
  const s3 = await mkBill('S-3', sup1.id, A.id, 4, 25, day(-10));
  ok(s1.ok && s2.ok && s3.ok, 'three more bills are saved');
  const pay3 = await call('purchase:addPayment', s3.invoice.id, { amount: s3.invoice.total, mode: 'Cash' });
  ok(pay3.ok, 'one of them is paid in full');
  const s4 = await mkBill('S-4', sup1.id, A.id, 2, 40, day(-5));
  db.prepare("UPDATE purchase_invoices SET amount_paid=NULL, payment_status='partial' WHERE id=?").run(s4.invoice.id);   // a legacy "part-paid" bill whose payments were never recorded

  const money = (n: number) => Math.round(n * 100) / 100;
  const totals = (await call('purchase:list', { wholesaler_id: sup1.id })) as any[];
  const t = (no: string) => totals.find((x) => x.invoice_number === no);
  const sum: any[] = await call('wholesalers:summary');
  const w1 = sum.find((x) => x.wholesaler_id === sup1.id);
  const w2 = sum.find((x) => x.wholesaler_id === sup2.id);
  eq(w1.bills, 6, 'supplier one has six bills (T-1, T-H, S-1 … S-4)');
  near(w1.total_bought, money(totals.reduce((s, x) => s + x.total, 0)), 'the amount bought is the sum of its bills');
  const expectOwed = money(t('T-1').total + t('T-H').total + t('S-1').total + (t('S-2').total - 200));
  near(w1.owed, expectOwed, 'owed = the unpaid bills + the unpaid part of the part-paid one (the fully paid bill adds nothing)');
  eq(w1.unknown_bills, 1, 'the bill whose payments were never recorded is counted apart — never guessed');
  eq(w1.open_bills, 5, 'five bills are not fully paid (four known + the unknown one)');
  eq(w1.last_bill_date, today, 'the last bill date is the newest invoice date');
  ok(!!w2, 'a supplier with no bills still has a row…');
  eq(JSON.stringify([w2?.bills, w2?.total_bought, w2?.owed, w2?.unknown_bills, w2?.open_bills, w2?.last_bill_date]), JSON.stringify([0, 0, 0, 0, 0, null]), '…all zero, and no last bill date');

  // one rule everywhere
  const known = totals.filter((x) => x.outstanding != null && x.outstanding > 0.004);
  near(w1.owed, money(known.reduce((s, x) => s + x.outstanding, 0)), "the Purchases tab's \"to pay\" for this supplier equals it");
  eq(w1.unknown_bills, totals.filter((x) => x.outstanding == null).length, "…and so does its count of bills with unknown payment");
  const rep = (await call('analytics:supplierReport', { from: '2000-01-01', to: '2100-12-31' })).report;
  const on = rep.owed_now.find((x: any) => x.id === sup1.id);
  near(on.outstanding, w1.owed, 'Analytics → Pharmacy "owed now" says the same');
  eq(on.unknown_paid, w1.unknown_bills, '…with the same unknown count');
  eq(on.open_invoices, w1.open_bills, '…and the same number of open bills');

  // it follows a payment
  const before = w1.owed;
  const pay = await call('purchase:addPayment', s1.invoice.id, { amount: 150, mode: 'UPI' });
  ok(pay.ok, 'a payment of ₹150 is recorded on the unpaid bill');
  const after = (await call('wholesalers:summary')).find((x: any) => x.wholesaler_id === sup1.id);
  near(after.owed, money(before - 150), 'the supplier now shows ₹150 less owed');
  eq(after.bills, w1.bills, '…and the same number of bills');

  // ============================================================================================================
  section('3 · the price a sale starts from — and so a medicine charged to a ward — is the batch\'s SELLING price');
  const P = await mk('Tab Price 7', { default_mrp: 100 });
  const pp = await call('purchase:create', {
    client_ref: 'tabs-price', invoice_number: 'T-PRICE', wholesaler_id: sup1.id, invoice_date: today,
    items: [
      { drug_master_id: P.id, batch_no: 'P-EARLY', expiry: day(120), qty_received: 5, purchase_price: 60, mrp: 100, selling_price: 90 },
      { drug_master_id: P.id, batch_no: 'P-LATE', expiry: day(400), qty_received: 5, purchase_price: 60, mrp: 100 },
    ],
  });
  ok(pp.ok, 'two batches: the earlier one sells at ₹90 (MRP ₹100), the later one at its MRP');
  const offered = async () => (await call('pharmacy:listDrugs', { activeOnly: true })).find((d: any) => d.id === P.id);
  eq((await offered()).next_selling_price, 90, "the rate a counter sale or a ward charge starts from is the next batch's selling price (₹90), not the MRP");
  eq((await offered()).next_mrp, 100, '…while the printed MRP stays ₹100');
  const sold = await call('pharmacy:sell', { client_ref: 'tabs-price-sale', items: [{ drug_master_id: P.id, drug_name: P.name, qty: 5, rate: 90 }], payment_mode: 'Cash' });
  eq(sold.total, 450, 'the earlier batch is sold out at ₹90 each');
  eq((await offered()).next_selling_price, 100, 'once it is gone, the next batch (no selling price set) offers its MRP, ₹100');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
