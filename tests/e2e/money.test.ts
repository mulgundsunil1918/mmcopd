// Money across modules, through the real handlers: lab and radiology bills, pharmacy purchase + sale,
// bill payments (partial, full, repeated), reports that must equal the records beneath them, and the
// failure cases (submit twice, bad input, no permission). Synthetic data only.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, note, section, finish, finding } from './lib';
import { localISO } from '../../src/lib/localDate';

boot();
const db = () => getDb();
const q = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const today = localISO();
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  // ---------------------------------------------------------------- set-up
  const doc = await call('doctors:create', { name: 'Dr. Money', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Mohan', last_name: 'Lal', dob: '1980-05-05', gender: 'M', phone: '9222222222' });
  const appt = await call('appointments:create', { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:00' });
  const opd = await call('bills:create', { appointment_id: appt.id, patient_id: pat.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  ok(opd.total === 300, 'OPD bill ₹300 raised');

  // ---------------------------------------------------------------- lab
  section('laboratory order → bill → payments');
  const cbc = await call('lab:upsertTest', { name: 'CBC', price: 300, category: 'haematology', sample_type: 'Blood' });
  const lft = await call('lab:upsertTest', { name: 'LFT', price: 500, category: 'biochemistry', sample_type: 'Blood' });
  const lab = await call('lab:createOrder', { appointment_id: appt.id, patient_id: pat.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }, { lab_test_id: lft.id, test_name: 'LFT' }] });
  const labBill = one('SELECT * FROM bills WHERE lab_order_id=?', lab.id);
  ok(!!labBill, 'ordering lab tests raises a lab bill');
  eq(labBill.total, 800, 'lab bill = ₹300 + ₹500');
  eq(labBill.status, 'unpaid', 'lab bill starts unpaid (collected later at reception)');
  eq(labBill.patient_id, pat.id, 'lab bill belongs to the same patient');
  const lp = await call('bill:previewById', labBill.id);
  ok(lp.ok && lp.items.length === 2, 'the lab bill previews with both tests as lines');
  near(lp.totals.total, 800, 'preview total ₹800 (matches the bill)');
  const part = await call('bill:pay', labBill.id, 300, 'UPI');
  ok(part.ok, 'part payment ₹300 accepted');
  let lb = one('SELECT * FROM bills WHERE id=?', labBill.id);
  eq(lb.status, 'part_paid', 'status → part_paid');
  eq(lb.amount_paid, 300, 'amount paid ₹300');
  const rest = await call('bill:pay', labBill.id, 500, 'Cash');
  ok(rest.ok, 'final ₹500 accepted');
  lb = one('SELECT * FROM bills WHERE id=?', labBill.id);
  eq(lb.status, 'paid', 'status → paid');
  eq(lb.amount_paid, 800, 'amount paid ₹800');
  eq(q('SELECT COUNT(*) c FROM bill_payments WHERE bill_id=?', labBill.id)[0].c, 2, 'two payment rows on record');
  eq(r2(q('SELECT SUM(amount) s FROM bill_payments WHERE bill_id=?', labBill.id)[0].s), 800, '…adding to ₹800');
  const over = await call('bill:pay', labBill.id, 100, 'Cash');
  ok(over.ok === false, `paying a bill that is already settled is refused (got: ${JSON.stringify(over)})`);
  const zero = await call('bill:pay', labBill.id, 0, 'Cash');
  ok(zero.ok === false, 'a zero payment is refused');
  const neg = await call('bill:pay', labBill.id, -50, 'Cash');
  ok(neg.ok === false, 'a negative payment is refused');
  const ghost = await call('bill:pay', 999999, 10, 'Cash');
  ok(ghost.ok === false, 'paying a bill that does not exist is refused cleanly');
  const addAfter = await call('lab:addOrderItems', lab.id, [{ test_name: 'Extra (unpriced)' }]);
  ok(addAfter.ok && addAfter.billChanged === false, 'adding a test after the bill is settled leaves the settled bill alone, and says so');
  eq(one('SELECT total FROM bills WHERE id=?', labBill.id).total, 800, '…settled bill total unchanged');
  const rep = await call('lab:updateResults', lab.id, [{ id: q('SELECT id FROM lab_order_items WHERE lab_order_id=?', lab.id)[0].id, result: '13.5', is_abnormal: 0 }]);
  ok(rep.length >= 2, 'a lab result can be entered');

  // ---------------------------------------------------------------- radiology
  section('radiology order → bill');
  const xr = (await call('radiology:upsertTest', { name: 'Chest X-ray PA', modality: 'xray', price: 400 })).test;
  const ro = await call('radiology:createOrder', { patient_id: pat.id, appointment_id: appt.id, doctor_id: doc.id, items: [{ test_id: xr.id }] });
  ok(ro.ok, `radiology order created (${ro.ok ? ro.order.order_number : ro.error})`);
  const rbill = one('SELECT * FROM bills WHERE radiology_order_id=?', ro.order.id);
  ok(!!rbill, 'it raises its own radiology bill');
  eq(rbill.total, 400, 'radiology bill ₹400');
  eq(rbill.patient_id, pat.id, '…for the same patient');
  eq(one('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', rbill.id).c, 1, '…with a real line row');
  await call('bill:pay', rbill.id, 400, 'Cash');
  eq(one('SELECT status FROM bills WHERE id=?', rbill.id).status, 'paid', 'radiology bill can be paid at the ordinary billing desk');

  // ---------------------------------------------------------------- pharmacy
  section('pharmacy: purchase → stock → prescription sale');
  const sup = await call('wholesalers:upsert', { name: 'E2E Distributors', drug_license_no: 'DL-E2E-1', gstin: null });
  const drug = await call('pharmacy:upsertDrug', { name: 'Paracetamol 500mg', default_mrp: 2, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 20 });
  const pur = await call('purchase:create', {
    client_ref: 'e2e-pur-1', invoice_number: 'E2E-001', wholesaler_id: sup.id, invoice_date: today, gst_in_cost: false,
    items: [{ drug_master_id: drug.id, batch_no: 'PB1', expiry: '2030-01-31', qty_received: 100, free_qty: 10, purchase_price: 1, mrp: 2, gst_rate: 0 }],
  });
  ok(pur.ok, `purchase bill saved (${pur.ok ? pur.invoice.total : pur.error})`);
  eq(pur.invoice.total, 100, 'purchase bill ₹100 (100 × ₹1; the 10 free units cost nothing extra)');
  const stockNow = () => one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', drug.id).s;
  eq(stockNow(), 110, 'stock = 100 paid + 10 free');
  const dup = await call('purchase:create', { client_ref: 'e2e-pur-1', invoice_number: 'E2E-001', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: drug.id, batch_no: 'PB1', expiry: '2030-01-31', qty_received: 100, purchase_price: 1, mrp: 2 }] });
  ok(dup.ok && dup.duplicate === true, 'the same purchase sent again is recognised as a repeat');
  eq(stockNow(), 110, '…and added no stock');
  const listed = await call('pharmacy:listDrugs', { q: 'Paracetamol' });
  eq(listed.find((d: any) => d.id === drug.id)?.stock_qty, 110, 'the drug list shows the same stock');
  eq((await call('stock:register', {})).filter((b: any) => b.drug_master_id === drug.id).reduce((s: number, b: any) => s + b.qty_remaining, 0), 110, 'the stock register agrees');
  const sale = await call('pharmacy:sell', { appointment_id: appt.id, patient_id: pat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 10, rate: 2 }], discount: 0, payment_mode: 'Cash', client_ref: 'e2e-sale-1' });
  eq(sale.total, 20, 'sale ₹20');
  eq(stockNow(), 100, 'stock after the sale = 100');
  const detail = await call('pharmacy:saleDetail', sale.id);
  eq(detail.patient_name, 'Mohan Lal', 'the sale shows the same patient');
  eq(detail.patient_uhid, pat.uhid, '…and UHID');
  ok(String(detail.items[0].batches || '').includes('PB1'), '…with the batch it came from (for the receipt)');
  const again = await call('pharmacy:sell', { appointment_id: appt.id, patient_id: pat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 10, rate: 2 }], discount: 0, payment_mode: 'Cash', client_ref: 'e2e-sale-1' });
  eq(again.id, sale.id, 'the same sale sent twice (refresh / retry) is one sale');
  eq(stockNow(), 100, '…stock reduced once');
  const reg = await call('dispensing:register', { from: today, to: today });
  ok(reg.some((r: any) => r.sale_id === sale.id && r.patient_name === 'Mohan Lal'), 'the dispensing register lists it against the patient');
  const tooMany = await attempt('pharmacy:sell', { patient_id: pat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 1000, rate: 2 }], discount: 0, payment_mode: 'Cash' });
  ok(!tooMany.ok && /Insufficient stock/.test((tooMany as any).error), 'selling more than is in stock is refused');
  eq(stockNow(), 100, '…and stock is unchanged');
  const ppay = await call('purchase:addPayment', pur.invoice.id, { amount: 60, mode: 'UPI' });
  ok(ppay.ok && ppay.invoice.outstanding === 40, 'part-paying the supplier leaves ₹40 outstanding');
  const popay = await call('purchase:addPayment', pur.invoice.id, { amount: 60 });
  ok(popay.ok === false, 'paying the supplier more than is owed is refused');

  // central billing: does a pharmacy sale appear in Billing?
  const inBilling = (await call('bills:list', { q: 'Mohan' })).filter((b: any) => /pharm/i.test(String(b.bill_type)) || /pharm/i.test(String(b.bill_kind)));
  if (inBilling.length === 0) finding('Counter/prescription pharmacy sales are NOT listed on the Billing screen: they live in Pharmacy → Sales (own receipt) and are added into Accounts / Analytics totals separately. Not changed — it is how the module was designed.');

  // ---------------------------------------------------------------- deleting records must not leak stock
  section('erasing a visit or a patient puts dispensed stock back');
  const dpat = await call('patients:create', { first_name: 'Del', last_name: 'Ete', dob: '1990-01-01', gender: 'M', phone: '9777777777' });
  const dap = await call('appointments:create', { patient_id: dpat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '15:00' });
  const dsale = await call('pharmacy:sell', { appointment_id: dap.id, patient_id: dpat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 7, rate: 2 }], discount: 0, payment_mode: 'Cash' });
  ok(!!dsale.id, 'a test sale of 7 units');
  eq(stockNow(), 93, 'stock 100 → 93');
  const delAppt = await call('admin:deleteAppointment', dap.id);
  ok(delAppt.ok, 'the visit is deleted');
  eq(stockNow(), 100, 'its 7 units are back on the shelf (they used to vanish for good)');
  const dap2 = await call('appointments:create', { patient_id: dpat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '15:30' });
  await call('pharmacy:sell', { appointment_id: dap2.id, patient_id: dpat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 4, rate: 2 }], discount: 0, payment_mode: 'Cash' });
  await call('pharmacy:sell', { patient_id: dpat.id, items: [{ drug_master_id: drug.id, drug_name: 'Paracetamol 500mg', qty: 3, rate: 2 }], discount: 0, payment_mode: 'Cash' });
  eq(stockNow(), 93, 'two more sales (4 + 3) → 93');
  const delPat = await call('admin:deletePatient', dpat.id);
  ok(delPat.ok, 'the patient is deleted');
  eq(stockNow(), 100, 'all 7 units are back after the patient is erased');
  eq(one('SELECT COUNT(*) c FROM dispensing_register WHERE patient_id=?', dpat.id).c, 0, '…and no register rows remain for them');

  // ---------------------------------------------------------------- repeated submission
  section('submitting the same thing twice');
  const mk = () => call('bills:create', { appointment_id: appt.id, patient_id: pat.id, items: [{ description: 'Dressing', qty: 1, rate: 150, amount: 150 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  const b1 = await mk(); const b2 = await mk();
  eq(b1.id, b2.id, 'the same OPD charge sent twice in a row (double-click / retry) is ONE bill');
  const dupLab = await call('lab:createOrder', { appointment_id: appt.id, patient_id: pat.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  const dupLab2 = await call('lab:createOrder', { appointment_id: appt.id, patient_id: pat.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  eq(dupLab.id, dupLab2.id, 'the same lab request sent twice in a row is ONE order (and one bill)');
  eq(q("SELECT COUNT(*) c FROM bills WHERE lab_order_id IN (?,?)", dupLab.id, dupLab2.id)[0].c, 1, '…one lab bill');

  // ---------------------------------------------------------------- reconciliation
  section('reports equal the records beneath them');
  const sumAll = r2(one("SELECT COALESCE(SUM(total),0) t FROM bills WHERE status IS NULL OR status <> 'cancelled'").t);
  const fin = await call('finance:summary', {});
  near(fin.allTime.total, sumAll, 'Finance all-time total equals the sum of bills');
  const mods = await call('analytics:modules', today, today);
  const modSum = mods.modules.reduce((s: number, m: any) => s + m.revenue, 0);
  const todayBills = r2(one("SELECT COALESCE(SUM(total),0) t FROM bills WHERE date(created_at,'localtime')=?", today).t);
  const todayPharm = r2(one("SELECT COALESCE(SUM(total),0) t FROM pharmacy_sales WHERE payment_mode <> 'IPD-bill' AND date(created_at,'localtime')=?", today).t);
  near(modSum, todayBills + todayPharm, "Modules P&L total = today's bills + today's pharmacy sales");
  near(mods.modules.find((m: any) => m.key === 'lab')?.revenue ?? 0, r2(one("SELECT COALESCE(SUM(total),0) t FROM bills WHERE bill_type='lab' AND date(created_at,'localtime')=?", today).t), 'Modules → Laboratory = lab bills');
  near(mods.modules.find((m: any) => m.key === 'radiology')?.revenue ?? 0, 400, 'Modules → Radiology = the ₹400 scan');
  near(mods.modules.find((m: any) => m.key === 'pharmacy')?.revenue ?? 0, todayPharm, 'Modules → Pharmacy = pharmacy sales');
  const ph = await call('analytics:pharmacyOverview', { from: today, to: today });
  near(ph.totalRevenue, todayPharm, 'Pharmacy overview revenue = pharmacy sales');
  const prof = (await call('analytics:pharmacyProfit', { from: today, to: today })).report;
  near(prof.totals.revenue, todayPharm, 'Pharmacy profit revenue = pharmacy sales');
  near(prof.totals.cogs, 9.09, 'cost of the 10 units sold = 10 × ₹0.9091 (₹100 bought 110 units, 10 of them free)');
  near(prof.totals.profit, 10.91, 'profit ₹10.91 on ₹20 revenue');
  near(prof.totals.margin_pct, 54.55, 'margin 54.55% (profit ÷ revenue)');
  near(prof.totals.markup_pct, 120, 'markup 120% (profit ÷ cost)', 0.1);
  const val = await call('analytics:pharmacyValuation');
  const own = q('SELECT SUM(qty_remaining) u, SUM(qty_remaining * unit_cost) c FROM drug_stock_batches WHERE drug_master_id=?', drug.id)[0];
  eq(own.u, 100, 'the batch holds 100 units');
  near(own.c, 100 * (100 / 110), 'stock at cost = 100 units × true unit cost ₹0.9091 (the 10 free units are spread over all 110)', 0.01);
  ok(val.sellable.units >= 100 && val.sellable.at_cost >= own.c, 'the stock value report includes it (alongside the starter catalogue stock a new install ships with)');
  const checks = await call('analytics:pharmacyChecks');
  ok(!checks.some((c: any) => c.severity === 'error'), 'pharmacy data checks: no errors');

  // ---------------------------------------------------------------- a cancelled bill is not revenue
  section('a cancelled (void) bill is left out of every revenue figure');
  const cxr = await call('radiology:createOrder', { patient_id: pat.id, appointment_id: appt.id, doctor_id: doc.id, items: [{ test_id: (await call('radiology:upsertTest', { name: 'Void Scan', modality: 'xray', price: 700 })).test.id }] });
  ok(cxr.ok, 'a ₹700 scan is ordered (bill raised, unpaid)');
  const cb = one('SELECT * FROM bills WHERE radiology_order_id=?', cxr.order.id);
  const finBefore = await call('finance:summary', {});
  const ovBefore = await call('analytics:overview');
  const drBefore = (await call('reports:run', { kind: 'daily_collection', from: today, to: today }))[0];
  const cancel = await call('radiology:cancelOrder', cxr.order.id, 'patient left');
  ok(cancel.ok, 'the order is cancelled');
  eq(one('SELECT status FROM bills WHERE id=?', cb.id).status, 'cancelled', 'its unpaid bill is cancelled with it');
  const finAfter = await call('finance:summary', {});
  const ovAfter = await call('analytics:overview');
  const drAfter = (await call('reports:run', { kind: 'daily_collection', from: today, to: today }))[0];
  near(finBefore.today.total - finAfter.today.total, 700, "Finance → today's total drops by the cancelled ₹700");
  eq(finBefore.today.count - finAfter.today.count, 1, '…and its bill count by 1');
  near(finBefore.allTime.total - finAfter.allTime.total, 700, 'Finance → all-time total drops by ₹700');
  near(ovBefore.todayRevenue - ovAfter.todayRevenue, 700, "Analytics overview → today's revenue drops by ₹700");
  near(ovBefore.monthRevenue - ovAfter.monthRevenue, 700, '…and the month\'s');
  near(drBefore.revenue - drAfter.revenue, 700, 'Daily Collection report drops by ₹700');
  const sumLive = r2(one("SELECT COALESCE(SUM(total),0) t FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND date(created_at,'localtime') = ?", today).t);
  near(finAfter.today.total, sumLive, "Finance → today equals the sum of today's live bills");

  // ---------------------------------------------------------------- GST on a discounted pharmacy sale
  section('pharmacy sale with GST and a bill discount: the receipt must add up');
  await call('settings:save', { gst_enabled: true, gst_registration_type: 'regular' });
  const taxed = await call('pharmacy:upsertDrug', { name: 'Taxed Tonic', default_mrp: 112, gst_rate: 12, schedule: 'OTC' });
  const exempt = await call('pharmacy:upsertDrug', { name: 'Exempt Strip', default_mrp: 100, gst_rate: 0, schedule: 'OTC' });
  const gp = await call('purchase:create', { invoice_number: 'GST-1', wholesaler_id: sup.id, invoice_date: today, gst_in_cost: false, items: [
    { drug_master_id: taxed.id, batch_no: 'GT1', expiry: '2030-01-01', qty_received: 50, purchase_price: 60, mrp: 112, gst_rate: 12 },
    { drug_master_id: exempt.id, batch_no: 'GE1', expiry: '2030-01-01', qty_received: 50, purchase_price: 60, mrp: 100, gst_rate: 0 } ] });
  ok(gp.ok, 'GST test stock bought');
  const gs = await call('pharmacy:sell', { items: [
    { drug_master_id: taxed.id, drug_name: 'Taxed Tonic', qty: 10, rate: 112 },     // ₹1,120 incl. 12% GST
    { drug_master_id: exempt.id, drug_name: 'Exempt Strip', qty: 5, rate: 100 } ], // ₹500 exempt
    discount: 162, payment_mode: 'Cash' });                                          // 10% of ₹1,620
  eq(gs.total, 1458, 'customer pays ₹1,620 − ₹162 = ₹1,458');
  const parts = r2(Number(gs.taxable_total) + Number(gs.exempt_total) + Number(gs.cgst_total) + Number(gs.sgst_total));
  near(parts, gs.total, 'taxable + exempt + CGST + SGST on the receipt = what the customer paid (tax is on the DISCOUNTED value)');
  near(Number(gs.cgst_total) + Number(gs.sgst_total), r2((1120 - 112) - (1120 - 112) / 1.12), 'GST charged = tax inside the discounted ₹1,008 of the taxed line = ₹108');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
