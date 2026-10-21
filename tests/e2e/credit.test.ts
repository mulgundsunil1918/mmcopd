// Medicines on credit, medicines charged to an in-patient's bill, and the separate analysis of hand-typed pharmacy
// bills — through the app's REAL IPC handlers on a temporary database. Synthetic data only.
//
// The questions this answers (in the owner's words): "medicines on credit in OPD and IPD is a thing to add in settings";
// "hand typed pharmacy bills can exist, but should have a different analytics of its own and not mix up with the actual
// pharmacy stock". And the standing rule: every screen must agree about who owes what.
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, near, section, finish } from './lib';
import { localISO } from '../../src/lib/localDate';

boot();
const db = () => getDb();
const q = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const today = localISO();
const r2 = (n: number) => Math.round(n * 100) / 100;
const WIDE: [string, string] = ['2000-01-01', '2100-01-01'];
const stock = (drugId: number) => Number(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', drugId).s);

/** What a bill still owes, worked out from the rules and not by calling the app's own function. (No deposits are taken in
 *  this suite, so an in-patient bill owes exactly total − paid, like any other.) */
const billDue = (b: any) => (b.status === 'cancelled' || b.cancelled_at)
  ? 0 : Math.max(0, r2(Number(b.total) - Number(b.amount_paid)));
const saleDue = (s: any) => s.payment_mode === 'IPD-bill' ? 0 : Math.max(0, r2(Number(s.total) - Number(s.amount_paid ?? s.total)));

(async () => {
  // ------------------------------------------------------------------------------------------------ set-up
  await call('settings:save', { bill_round_off: false, gst_enabled: false, ipd_auto_accrue_bed: false, ipd_auto_accrue_nursing: false, ipd_auto_accrue_doctor_visit: false });
  const doc = await call('doctors:create', { name: 'Dr. Credit', specialty: 'GP', default_fee: 300 });
  const asha = await call('patients:create', { first_name: 'Asha', last_name: 'Credit', dob: '1982-02-02', gender: 'F', phone: '9400000001' });
  const bela = await call('patients:create', { first_name: 'Bela', last_name: 'Ward', dob: '1970-03-03', gender: 'F', phone: '9400000002' });
  const carl = await call('patients:create', { first_name: 'Carl', last_name: 'Leaving', dob: '1965-04-04', gender: 'M', phone: '9400000003' });
  const dina = await call('patients:create', { first_name: 'Dina', last_name: 'Gone', dob: '1960-05-05', gender: 'F', phone: '9400000004' });
  const ward = await call('wards:save', { name: 'General', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bed = (n: string) => call('beds:save', { ward_id: ward.id, bed_number: n });
  const [b1, b2, b3] = [await bed('C-1'), await bed('C-2'), await bed('C-3')];
  const admBela = await call('ip:admitV2', { patient_id: bela.id, bed_id: b1.id, admission_doctor_id: doc.id, performed_by: 'tester' });
  const admCarl = await call('ip:admitV2', { patient_id: carl.id, bed_id: b2.id, admission_doctor_id: doc.id, performed_by: 'tester' });
  const admDina = await call('ip:admitV2', { patient_id: dina.id, bed_id: b3.id, admission_doctor_id: doc.id, performed_by: 'tester' });
  ok(admBela.ok && admCarl.ok && admDina.ok, 'three in-patients are admitted');

  const sup = await call('wholesalers:upsert', { name: 'Credit Supplies', drug_license_no: 'DL-CREDIT' });
  const tab = await call('pharmacy:upsertDrug', { name: 'Credit Tab 10mg', default_mrp: 10, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 5 });
  const syr = await call('pharmacy:upsertDrug', { name: 'Taxed Syrup', default_mrp: 112, gst_rate: 12, schedule: 'OTC', low_stock_threshold: 5 });
  const pur = await call('purchase:create', {
    client_ref: 'credit-pur-1', invoice_number: 'CREDIT-001', wholesaler_id: sup.id, invoice_date: today,
    items: [
      { drug_master_id: tab.id, batch_no: 'CT1', expiry: '2031-01-31', qty_received: 500, free_qty: 0, purchase_price: 6, mrp: 10, gst_rate: 0 },
      { drug_master_id: syr.id, batch_no: 'SY1', expiry: '2031-01-31', qty_received: 100, free_qty: 0, purchase_price: 70, mrp: 112, gst_rate: 12 },
    ],
  });
  ok(pur.ok, `stock bought (${pur.ok ? 'tablets and syrup' : pur.error})`);
  const tabLine = (qty: number, rate = 10) => ({ drug_master_id: tab.id, drug_name: 'Credit Tab 10mg', qty, rate });
  const syrLine = (qty: number) => ({ drug_master_id: syr.id, drug_name: 'Taxed Syrup', qty, rate: 112 });

  // ------------------------------------------------------------------------------------------------ 1. off by default
  section('1 · both switches are OFF until the clinic turns them on');
  const st0 = await call('settings:get');
  eq(st0.pharmacy_credit_enabled, false, 'medicines on credit: off by default');
  eq(st0.pharmacy_ipd_charge_enabled, false, 'charging medicines to an in-patient bill: off by default');
  const salesBefore = one('SELECT COUNT(*) c FROM pharmacy_sales').c;
  const stock0 = stock(tab.id);
  const off1 = await attempt('pharmacy:sell', { patient_id: asha.id, items: [tabLine(10)], credit: true, paid_now: 30, payment_mode: 'Cash', client_ref: 'off-1' });
  ok(!off1.ok && /switched off/i.test((off1 as any).error) && /Settings/.test((off1 as any).error), `a credit sale is refused, saying where to switch it on (${off1.ok ? 'SOLD' : (off1 as any).error})`);
  const off2 = await attempt('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(2)], client_ref: 'off-2' });
  ok(!off2.ok && /switched off/i.test((off2 as any).error), `charging an in-patient bill is refused too (${off2.ok ? 'SOLD' : (off2 as any).error})`);
  eq(one('SELECT COUNT(*) c FROM pharmacy_sales').c, salesBefore, 'nothing was sold by either refusal');
  eq(stock(tab.id), stock0, '…and no stock moved');
  const plain = await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(1)], payment_mode: 'Cash', client_ref: 'plain-1' });
  eq(plain.on_credit, 0, 'an ordinary sale is not on credit');
  near(plain.amount_paid, 10, '…and is received in full');
  const spoof = await attempt('pharmacy:sell', { patient_id: asha.id, items: [tabLine(1)], payment_mode: 'IPD-bill', client_ref: 'spoof-1' });
  ok(!spoof.ok && /IPD-bill/.test((spoof as any).error), `"IPD-bill" cannot be sent as a payment mode to hide a sale from the counter totals (${spoof.ok ? 'ACCEPTED' : (spoof as any).error})`);
  eq(one("SELECT COUNT(*) c FROM pharmacy_sales WHERE client_ref='spoof-1'").c, 0, '…and no sale was made');

  // ------------------------------------------------------------------------------------------------ 2. credit sale
  section('2 · medicines on credit');
  await call('settings:save', { pharmacy_credit_enabled: true });
  const c1 = await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(10)], credit: true, paid_now: 30, payment_mode: 'Cash', client_ref: 'cr-1' });   // ₹100, ₹30 now
  eq(c1.on_credit, 1, 'a sale with part paid is on credit');
  near(c1.total, 100, '…₹100');
  near(c1.amount_paid, 30, '…₹30 received at the counter');
  eq(c1.payment_mode, 'Cash', '…the part paid now keeps its mode');
  const c2 = await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(5)], credit: true, payment_mode: 'Cash', client_ref: 'cr-2' });                   // ₹50, nothing now
  near(c2.amount_paid, 0, 'a sale with nothing paid now: ₹0 received');
  eq(c2.payment_mode, 'Credit', '…and its mode reads "Credit"');
  const c3 = await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(2)], credit: true, paid_now: 20, payment_mode: 'UPI', client_ref: 'cr-3' });        // ₹20 all paid
  eq(c3.on_credit, 0, 'paying everything now is an ordinary sale, not a credit one');
  const g = await attempt('pharmacy:sell', { customer_name: 'Guest', items: [tabLine(1)], credit: true, paid_now: 0, client_ref: 'cr-guest' });
  ok(!g.ok && /registered patient/i.test((g as any).error), `a walk-in guest cannot take credit — it must be clear who owes (${g.ok ? 'SOLD' : (g as any).error})`);
  const tooMuch = await attempt('pharmacy:sell', { patient_id: asha.id, items: [tabLine(1)], credit: true, paid_now: 500, client_ref: 'cr-over' });
  ok(!tooMuch.ok && /more than the bill/i.test((tooMuch as any).error), `paying more than the bill now is refused (${tooMuch.ok ? 'SOLD' : (tooMuch as any).error})`);
  const neg = await attempt('pharmacy:sell', { patient_id: asha.id, items: [tabLine(1)], credit: true, paid_now: -5, client_ref: 'cr-neg' });
  ok(!neg.ok && /negative/i.test((neg as any).error), 'a negative amount paid now is refused');
  const ghost = await attempt('pharmacy:sell', { patient_id: 987654, items: [tabLine(1)], credit: true, paid_now: 0, client_ref: 'cr-ghost' });
  ok(!ghost.ok && /not found/i.test((ghost as any).error), 'credit for a patient that does not exist is refused');
  eq((await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(10)], credit: true, paid_now: 30, payment_mode: 'Cash', client_ref: 'cr-1' })).id, c1.id, 'the same credit sale sent twice (double-click) is one sale');
  eq(one("SELECT COUNT(*) c FROM pharmacy_sales WHERE client_ref IN ('cr-guest','cr-over','cr-neg','cr-ghost')").c, 0, 'none of the refused sales left a trace');
  eq(stock(tab.id), stock0 - 1 - 10 - 5 - 2, 'stock moved only for the sales that happened (the credit ones too)');

  section('2b · what is owed shows everywhere, once');
  const owedSales = [c1, c2].reduce((s, x) => s + saleDue(one('SELECT * FROM pharmacy_sales WHERE id=?', x.id)), 0);
  near(owedSales, 120, 'by hand: ₹70 + ₹50 = ₹120 owed on credit');
  const cs = await call('pharmacy:counterSales', { scope: 'credit' });
  eq(cs.rows.length, 2, 'the credit list holds the two sales that still owe');
  near(cs.totals.credit_due, 120, '…₹120 owed');
  eq(cs.totals.credit_count, 2, '…across 2 sales');
  ok(cs.rows.every((x: any) => x.patient_id === asha.id && x.due > 0), '…each under Asha, each with a balance');
  const pa = await call('billing:patientPortal', asha.id);
  const credLines = pa.history.filter((h: any) => h.source === 'pharmacy_sale' && h.due > 0);
  eq(credLines.length, 2, "Asha's portal lists both credit sales as unpaid");
  ok(credLines.every((h: any) => h.sale_id && h.bill_id === null), '…as sales (not bills), each carrying its sale id for collection');
  near(credLines.find((h: any) => h.sale_id === c1.id)?.paid, 30, '…the first shows ₹30 received');
  eq(credLines.find((h: any) => h.sale_id === c1.id)?.status, 'part_paid', '…and reads "part-paid"');
  eq(credLines.find((h: any) => h.sale_id === c2.id)?.status, 'unpaid', '…the second reads "unpaid"');
  const todo = pa.todo.filter((t: any) => t.kind === 'bill_due' && t.sale_id);
  eq(todo.length, 2, 'the portal "to collect" list offers both, ready to collect');
  near(pa.summary.outstanding, 120, "…and Asha's total still to collect is ₹120");

  let rec = await call('analytics:receivables');
  const billsOwed = r2(q('SELECT * FROM bills').reduce((s, b) => s + billDue(b), 0));
  near(rec.total_due, billsOwed + 120, 'Receivables total = bills owed + ₹120 on credit (worked out independently)');
  near(rec.by_kind.find((k: any) => k.kind === 'pharmacy')?.due, 120, '…and the Pharmacy department row shows ₹120');
  const ov = await call('analytics:overview');
  near(ov.outstandingTotal, rec.total_due, 'the overview "outstanding" equals Receivables');
  near(ov.pharmacyCreditDue, 120, '…and shows the ₹120 credit separately');
  const fin = await call('finance:summary', { from: today, to: today });
  near(fin.range.pharmaCredit.still_owed, 120, 'Accounts shows ₹120 of pharmacy credit still owed in the range');
  near((await call('analytics:billing', today, today)).outstanding, rec.total_due, 'the Accounts "still to collect" figure equals Receivables');

  section('2c · money received counts the day it is received');
  let col = await call('analytics:billing', today, today);
  const phCounter = (col.collectedBySource ?? {}).pharmacy_counter;
  // received at the counter today: plain ₹10 + c1 ₹30 + c2 ₹0 + c3 ₹20 = ₹60 (the credit part is NOT collected yet)
  near(phCounter, 60, 'collected at the counter today: ₹10 + ₹30 + ₹0 + ₹20 = ₹60 — the unpaid ₹120 is not counted as collected');
  eq((col.collectedBySource ?? {}).pharmacy_credit_payments, 0, '…and no credit payment has been taken yet');

  const pay1 = await call('pharmacy:payCredit', c1.id, { amount: 20, mode: 'UPI', client_ref: 'pc-1' });
  ok(pay1.ok && pay1.due === 50, `₹20 taken on the first sale: ₹50 left (${pay1.ok ? '' : pay1.error})`);
  const pay1b = await call('pharmacy:payCredit', c1.id, { amount: 20, mode: 'UPI', client_ref: 'pc-1' });
  ok(pay1b.ok && pay1b.duplicate === true, 'the same payment sent twice is recorded once');
  eq(one('SELECT COUNT(*) c FROM pharmacy_sale_payments WHERE sale_id=?', c1.id).c, 1, '…one payment row');
  const over = await call('pharmacy:payCredit', c1.id, { amount: 500 });
  ok(over.ok === false && /₹50\.00/.test(over.error), `paying more than is owed is refused, naming the figure (${over.ok ? 'ACCEPTED' : over.error})`);
  ok((await call('pharmacy:payCredit', c1.id, { amount: 0 })).ok === false, 'a zero payment is refused');
  ok((await call('pharmacy:payCredit', c1.id, { amount: -5 })).ok === false, 'a negative payment is refused');
  ok((await call('pharmacy:payCredit', 99999, { amount: 5 })).ok === false, 'a payment against a sale that does not exist is refused');
  ok((await call('pharmacy:payCredit', plain.id, { amount: 5 })).ok === false, 'a payment against an ordinary (already paid) sale is refused');
  const settle1 = await call('pharmacy:payCredit', c1.id, { amount: 50, mode: 'Cash', client_ref: 'pc-2' });
  ok(settle1.ok && settle1.due === 0, 'the rest of the first sale is paid: ₹0 left');
  ok((await call('pharmacy:payCredit', c1.id, { amount: 1 })).ok === false, 'a settled sale takes no more money');
  const part2 = await call('pharmacy:payCredit', c2.id, { amount: 25, mode: 'Cash', client_ref: 'pc-3' });
  ok(part2.ok && part2.due === 25, '₹25 taken on the second sale: ₹25 left');

  col = await call('analytics:billing', today, today);
  near(col.collectedBySource.pharmacy_credit_payments, 95, 'collected later against credit today: ₹20 + ₹50 + ₹25 = ₹95');
  near(col.collectedBySource.pharmacy_counter, 60, '…and the counter figure is unchanged at ₹60');
  near(col.totalCollected - (col.collectedBySource.bill_payments + col.collectedBySource.paid_at_billing + col.collectedBySource.pharmacy_counter + col.collectedBySource.pharmacy_credit_payments), 0, '…the parts add up to the total collected');
  const dc = (await call('reports:run', { kind: 'daily_collection', from: today, to: today }))[0];
  near(dc.pharmacy, 180, 'Daily Collection → pharmacy SOLD today = ₹180 (the four counter sales)');
  near(dc.received, 155, '…and money RECEIVED today = ₹60 at the counter + ₹95 later on credit = ₹155 (the unpaid ₹25 is not in the till)');
  const modes = await call('analytics:billing', today, today);
  near(modes.collections.reduce((s: number, m: any) => s + m.total, 0), modes.totalCollected, 'the by-payment-mode split adds up to the total collected');

  rec = await call('analytics:receivables');
  near(rec.total_due, billsOwed + 25, 'after the payments only ₹25 is still owed on credit — Receivables follows');
  const pa2 = await call('billing:patientPortal', asha.id);
  near(pa2.summary.outstanding, 25, "Asha's portal agrees: ₹25 to collect");
  eq(pa2.history.find((h: any) => h.sale_id === c1.id)?.status, 'paid', 'the settled sale reads "paid"');
  const det = await call('pharmacy:saleDetail', c1.id);
  near(det.amount_received, 100, 'the receipt data: ₹100 received in all');
  near(det.due, 0, '…₹0 due');
  eq(det.payments.length, 2, '…with its two later payments listed');
  ok(det.payments.every((p: any) => p.received_by === null || typeof p.received_by === 'string'), '…each recording who took it');
  ok(q('SELECT * FROM audit_log WHERE action LIKE ?', 'pharmacy.credit%').length >= 3, 'the audit log records credit sales and credit payments');

  const pc = await call('analytics:pharmacyChecks');
  ok(Array.isArray(pc) && !pc.some((c: any) => /^credit_/.test(c.code)), `the pharmacy health checks find nothing wrong with credit (${JSON.stringify(pc.filter((c: any) => /^credit_/.test(c.code)))})`);
  ok(!pc.some((c: any) => c.code === 'negative_stock'), '…and no negative stock');
  const ph = await call('analytics:pharmacyOverview', { from: today, to: today });
  near(ph.paymentMix.reduce((s: number, m: any) => s + m.revenue, 0), ph.totalRevenue, 'the Paid-by split (including "On credit") adds up to pharmacy revenue');
  eq(ph.creditSummary.sold_count, 2, 'Analytics counts 2 sales made on credit');
  near(ph.creditSummary.credit_value, 120, '…₹120 of them left unpaid at the counter');
  near(ph.creditSummary.owed_now, 25, '…₹25 owed now');

  // ------------------------------------------------------------------------------------------------ 3. IPD charge
  section('3 · medicines charged to an in-patient bill');
  await call('settings:save', { pharmacy_ipd_charge_enabled: true });
  const pa_b = await call('pharmacy:patientAdmission', bela.id);
  eq(pa_b?.admission_id, admBela.id, "the counter can see Bela's current stay");
  eq(await call('pharmacy:patientAdmission', asha.id), null, '…and that Asha has none');
  const billBela = async () => (await call('bill:previewAdmission', admBela.id));
  const beforeBill = await billBela();
  const stockBefore = stock(tab.id);
  const ward1 = await call('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(4)], client_ref: 'ipd-1' });   // ₹40
  eq(ward1.payment_mode, 'IPD-bill', 'the sale is marked as charged on the in-patient bill');
  near(ward1.total, 40, '…₹40');
  near(ward1.amount_paid, 0, '…nothing taken at the counter');
  eq(stock(tab.id), stockBefore - 4, '…stock went out');
  const afterBill = await billBela();
  near(afterBill.totals.total - beforeBill.totals.total, 40, "Bela's in-patient bill grew by exactly ₹40");
  const lines = q("SELECT * FROM bill_items WHERE source='pharmacy_ipd' AND source_ref_id=?", ward1.id);
  eq(lines.length, 1, '…as one line');
  near(lines[0]?.amount, 40, '…of ₹40');
  eq(lines[0]?.is_taxable, 0, '…with no tax added on top of the MRP');
  const head = one("SELECT id FROM charge_heads WHERE category='pharmacy' LIMIT 1");
  eq(lines[0]?.charge_head_id, head?.id, '…under the Pharmacy charge head (so department figures see it)');
  ok(!(await call('pharmacy:counterSales', {})).rows.some((x: any) => x.id === ward1.id), 'it is not in the counter-sales list');
  ok(!(await call('billing:patientPortal', bela.id)).history.some((h: any) => h.sale_id === ward1.id), "…nor listed separately in Bela's portal (it is part of the in-patient bill)");
  eq((await call('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(4)], client_ref: 'ipd-1' })).id, ward1.id, 'the same charge sent twice is one sale…');
  eq(q("SELECT * FROM bill_items WHERE source='pharmacy_ipd' AND source_ref_id=?", ward1.id).length, 1, '…and one bill line');
  const reg = q('SELECT * FROM dispensing_register WHERE sale_id=?', ward1.id);
  ok(reg.length >= 1 && reg.every((r: any) => r.unit_cost === 6), '…the dispensing register froze the cost (₹6)');

  // the GST rule: the MRP already contains the tax
  await call('settings:save', { gst_enabled: true, gst_registration_type: 'regular' });
  const preTax = await billBela();
  const ward2 = await call('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [syrLine(1)], client_ref: 'ipd-2' });  // ₹112, 12% GST inside
  const postTax = await billBela();
  near(postTax.totals.total - preTax.totals.total, 112, 'a 12% GST medicine at MRP ₹112 adds ₹112 to the bill — not ₹125.44');
  const sline = one("SELECT * FROM bill_items WHERE source='pharmacy_ipd' AND source_ref_id=?", ward2.id);
  near(sline.cgst + sline.sgst, 12, '…the ₹12 of GST inside the MRP is shown on the line (CGST + SGST), not added on top');
  eq(sline.tax_inclusive, 1, '…the line is marked as a tax-inclusive price');
  await call('settings:save', { gst_enabled: false });

  // not counted twice anywhere
  const fin2 = await call('finance:summary', { from: today, to: today });
  near(fin2.range.pharma.total, 100 + 50 + 20 + 10, 'Accounts → pharmacy counter total is the 4 counter sales only (₹180)');
  const ph2 = await call('analytics:pharmacyOverview', { from: today, to: today });
  near(ph2.totalRevenue, 180, 'Pharmacy analytics → revenue ₹180 (the in-patient charges are on the IPD bill)');
  const mods = await call('analytics:modules', ...WIDE);
  near(mods.modules.find((m: any) => m.key === 'pharmacy').revenue, 180, 'Modules P&L → Pharmacy ₹180');
  const cats = await call('analytics:billing', today, today);
  ok(cats.bySection.some((s: any) => s.category === 'pharmacy' && s.total >= 152), 'IPD & billing → the Pharmacy section picks up the ₹152 charged to the bill');

  section('3b · refusals leave everything exactly as it was');
  const snap = () => ({ sales: one('SELECT COUNT(*) c FROM pharmacy_sales').c, items: one('SELECT COUNT(*) c FROM bill_items').c, tab: stock(tab.id), syr: stock(syr.id), reg: one('SELECT COUNT(*) c FROM dispensing_register').c });
  const s0 = snap();
  const wrongPatient = await attempt('pharmacy:sell', { patient_id: asha.id, ipd_admission_id: admBela.id, items: [tabLine(1)], client_ref: 'ipd-x1' });
  ok(!wrongPatient.ok && /different patient/i.test((wrongPatient as any).error), `an admission that is not this patient's is refused (${wrongPatient.ok ? 'SOLD' : (wrongPatient as any).error})`);
  const noAdm = await attempt('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: 987654, items: [tabLine(1)], client_ref: 'ipd-x2' });
  ok(!noAdm.ok && /not found/i.test((noAdm as any).error), 'an admission that does not exist is refused');
  const disc = await attempt('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(2)], discount: 5, client_ref: 'ipd-x3' });
  ok(!disc.ok && /discount/i.test((disc as any).error), `a discount on an in-patient charge is refused — it is given on the bill (${disc.ok ? 'SOLD' : (disc as any).error})`);
  const both = await attempt('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(2)], credit: true, paid_now: 0, client_ref: 'ipd-x4' });
  ok(!both.ok, 'credit and an in-patient charge together are refused');
  const short = await attempt('pharmacy:sell', { patient_id: bela.id, ipd_admission_id: admBela.id, items: [tabLine(2), tabLine(100000)], client_ref: 'ipd-x5' });
  ok(!short.ok && /insufficient stock/i.test((short as any).error), `a shortage on the second line refuses the whole sale (${short.ok ? 'SOLD' : (short as any).error})`);
  eq(JSON.stringify(snap()), JSON.stringify(s0), '…none of those refusals sold anything, took any stock, or touched the bill');

  // discharge requested → no more charges onto the bill under review
  const req = await call('ip:requestDischarge', admCarl.id, { outcome: 'discharged', discharge_diagnosis: 'Recovered' }, 'tester');
  ok(req.ok, 'a discharge is requested for Carl');
  const dr = await attempt('pharmacy:sell', { patient_id: carl.id, ipd_admission_id: admCarl.id, items: [tabLine(1)], client_ref: 'ipd-x6' });
  ok(!dr.ok && /discharge has been requested/i.test((dr as any).error), `once a discharge is requested, no more is added to the final bill (${dr.ok ? 'SOLD' : (dr as any).error})`);
  const takeNow = await call('pharmacy:sell', { patient_id: carl.id, items: [tabLine(1)], payment_mode: 'Cash', client_ref: 'ipd-x7' });
  eq(takeNow.on_credit, 0, '…but his take-home medicines can still be paid for at the counter');
  // a discharged patient
  const dis = await call('ip:requestDischarge', admDina.id, { outcome: 'discharged' }, 'tester');
  const appr = await call('ip:approveDischarge', admDina.id, { by: 'tester', override_reason: 'test' });
  ok(dis.ok && appr.ok, 'Dina is discharged');
  const gone = await attempt('pharmacy:sell', { patient_id: dina.id, ipd_admission_id: admDina.id, items: [tabLine(1)], client_ref: 'ipd-x8' });
  ok(!gone.ok && /no longer admitted/i.test((gone as any).error), `a discharged patient's closed bill takes no more charges (${gone.ok ? 'SOLD' : (gone as any).error})`);
  eq((await call('pharmacy:patientAdmission', dina.id)), null, '…and the counter no longer offers it');

  // ------------------------------------------------------------------------------------------------ 4. hand-typed
  section('4 · hand-typed pharmacy bills are analysed on their own');
  const mBill1 = await call('bill:createStandalone', { patient_id: asha.id, bill_type: 'pharmacy', items: [{ description: 'Cough syrup (typed)', qty: 2, rate: 150 }, { description: 'Bandage (typed)', qty: 1, rate: 100 }], payment_mode: 'Cash', paid_now: true });   // ₹400 paid
  const mBill2 = await call('bill:createStandalone', { patient_name: 'Ravi Walkin', bill_type: 'pharmacy', items: [{ description: 'Painkiller strip (typed)', qty: 5, rate: 50 }], payment_mode: 'UPI', paid_now: false });                                        // ₹250 unpaid
  const mBill3 = await call('bill:createStandalone', { patient_id: asha.id, bill_type: 'pharmacy', items: [{ description: 'Cancelled thing', qty: 1, rate: 999 }], payment_mode: 'Cash', paid_now: true });
  ok(mBill1.ok && mBill2.ok && mBill3.ok, 'three hand-typed pharmacy bills are raised');
  db().prepare("UPDATE bills SET status='cancelled', cancelled_at=datetime('now') WHERE id=?").run(mBill3.id);
  const mp = await call('analytics:manualPharmacy', today, today);
  eq(mp.bills, 2, 'the analysis counts the 2 live hand-typed bills (the cancelled one is out)');
  near(mp.billed, 650, '…billed ₹650');
  near(mp.collected, 400, '…₹400 received');
  near(mp.still_owed, 250, '…₹250 still unpaid');
  near(mp.owed_now, 250, '…the same ₹250 owed in all');
  eq(mp.by_customer.find((c: any) => c.kind === 'patient')?.count, 1, '…one for a registered patient');
  eq(mp.by_customer.find((c: any) => c.kind === 'walk-in')?.count, 1, '…one for a walk-in');
  eq(mp.largest[0]?.name, 'Asha Credit', '…the largest bill is Asha\'s');
  eq(mp.largest.find((b: any) => b.due > 0)?.name, 'Ravi Walkin', '…and the unpaid one carries the name typed for the walk-in');
  near(mp.by_mode.reduce((s: number, m: any) => s + m.total, 0), mp.billed, '…the by-payment-mode split adds up');
  near(mp.by_day.reduce((s: number, d: any) => s + d.total, 0), mp.billed, '…and so does the day-by-day list');
  eq((await call('analytics:manualPharmacy', '2000-01-01', '2000-01-02')).bills, 0, 'a past range holds none');

  // Pharmacy so far: the four counter sales (₹180) and Carl's ₹10 take-home medicines = ₹190, 5 sales — no hand-typed bill in it.
  const ph3 = await call('analytics:pharmacyOverview', { from: today, to: today });
  near(ph3.totalRevenue, 190, 'the stock-based Pharmacy revenue holds only real sales (₹190) — the ₹650 of hand-typed bills is not in it');
  eq(ph3.totalSales, 5, '…and neither is its sale count');
  const prof = (await call('analytics:pharmacyProfit', { from: today, to: today })).report;
  near(prof.counter.revenue, 190, '…the profit report\'s counter channel is the same ₹190');
  near(prof.ward.revenue, 140, '…and the medicines charged to in-patients are its ward channel (real stock, real cost): ₹40 + ₹100 (the ₹112 syrup less its ₹12 GST — the profit report counts revenue without GST)');
  const mods2 = await call('analytics:modules', ...WIDE);
  near(mods2.modules.find((m: any) => m.key === 'pharmacy').revenue, 190, 'Modules P&L → Pharmacy ₹190');
  near(mods2.modules.find((m: any) => m.key === 'pharmacy_manual').revenue, 650, '…and "Pharmacy — hand-typed bills" has its own row: ₹650');
  const modTotal = mods2.modules.reduce((s: number, m: any) => s + m.revenue, 0);
  near(modTotal, mods2.totals.revenue, '…the rows still add up to the total');
  const pa3 = await call('billing:patientPortal', asha.id);
  eq(pa3.history.find((h: any) => h.number === mBill1.bill_number)?.kind, 'pharmacy_manual', "in Asha's portal the hand-typed bill carries its own kind");
  ok(pa3.history.some((h: any) => h.source === 'pharmacy_sale' && h.kind === 'pharmacy'), '…distinct from the stock-based pharmacy sales beside it');
  const rec2 = await call('analytics:receivables');
  near(rec2.by_kind.find((k: any) => k.kind === 'pharmacy_manual')?.due, 250, 'Receivables lists the unpaid ₹250 under hand-typed pharmacy');
  near(rec2.by_kind.find((k: any) => k.kind === 'pharmacy')?.due, 25, '…and the ₹25 credit under stock-based pharmacy');
  near(rec2.total_due, r2(q('SELECT * FROM bills').reduce((s, b) => s + billDue(b), 0)) + r2(q('SELECT * FROM pharmacy_sales').reduce((s, x) => s + saleDue(x), 0)), 'the Receivables total still equals an independent count of bills + credit sales');

  // ------------------------------------------------------------------------------------------------ 5. licence + roles
  section('5 · an expired licence, and who may collect');
  setReadOnlyMode(true);
  const roPay = await attempt('pharmacy:payCredit', c2.id, { amount: 5 });
  ok(!roPay.ok && /read-only/i.test((roPay as any).error), 'taking a credit payment is blocked when the licence has expired');
  ok((await attempt('pharmacy:patientAdmission', bela.id)).ok, '…looking up a stay still works');
  ok((await attempt('analytics:manualPharmacy', today, today)).ok, '…and so does the hand-typed analysis');
  setReadOnlyMode(false);

  // ------------------------------------------------------------------------------------------------ 6. backup
  section('6 · the backup holds credit sales and every payment');
  const counts = (t: string) => one(`SELECT COUNT(*) c FROM "${t}"`).c;
  const bk = await call('backup:now');
  ok(!!bk.bundleDir && fs.existsSync(bk.bundleDir), 'a backup bundle is written');
  ok(bk.verified === true && bk.integrityOk === true && (bk.mismatches || []).length === 0, `…verified against the live database (${bk.totalRows} rows, 0 mismatches)`);
  const manifest = JSON.parse(fs.readFileSync(`${bk.bundleDir}/manifest.json`, 'utf8'));
  ok(manifest.sheets.includes('Pharmacy Credit Payments'), 'the workbook has a "Pharmacy Credit Payments" sheet');
  eq(manifest.verification.receipt.find((r: any) => r.label === 'Pharmacy credit payments')?.count, counts('pharmacy_sale_payments'), '…and the receipt counts the payments correctly');
  const wb = XLSX.readFile(manifest.xlsx_path as string);
  const rows = (n: string) => XLSX.utils.sheet_to_json<any>(wb.Sheets[n]);
  const heads = (n: string): string[] => (XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1 })[0] ?? []).map(String);
  const ps = rows('Pharmacy Sales');
  ok(['amount_received', 'balance_due', 'on_credit'].every((k) => heads('Pharmacy Sales').includes(k)), 'Pharmacy Sales carries amount received, balance due and on-credit');
  const psRow = ps.find((r) => r.sale_number === c2.sale_number);
  near(psRow?.balance_due, 25, '…the second credit sale shows ₹25 still due');
  eq(psRow?.on_credit, 'Yes', '…marked as credit');
  const wardRow = ps.find((r) => r.sale_number === ward1.sale_number);
  eq(wardRow?.customer_type, 'Ward (on the IPD bill)', '…an in-patient charge is labelled as such');
  const pcp = rows('Pharmacy Credit Payments');
  eq(pcp.length, counts('pharmacy_sale_payments'), 'Pharmacy Credit Payments has every payment');
  near(pcp.reduce((s, r) => s + Number(r.amount), 0), 95, '…adding up to the ₹95 taken');
  ok(pcp.every((r) => r.sale_number && r.payment_mode), '…each with its sale and payment mode');
  const dues = rows('Outstanding Dues');
  near(dues.reduce((s, r) => s + (Number(r.still_due) || 0), 0), (await call('analytics:receivables')).total_due, 'the "Outstanding Dues" sheet adds up to the clinic\'s total owed');
  ok(dues.some((r) => r.source === 'Pharmacy sale on credit' && r.bill_number === c2.sale_number), '…and lists the credit sale that is still owed');
  const snapshot = {
    sales: counts('pharmacy_sales'), pay: counts('pharmacy_sale_payments'), owed: (await call('analytics:receivables')).total_due,
    c2due: saleDue(one('SELECT * FROM pharmacy_sales WHERE id=?', c2.id)),
  };

  section('6b · restoring brings the balances back');
  ok((await call('pharmacy:payCredit', c2.id, { amount: 25, client_ref: 'pc-after' })).ok, 'the last ₹25 is paid after the backup');
  await call('pharmacy:sell', { patient_id: asha.id, items: [tabLine(1)], credit: true, paid_now: 0, client_ref: 'cr-after' });
  const pv = await call('backup:previewRestore', bk.bundleDir);
  ok(pv.ok, 'the restore preview reads the bundle');
  const rs = await call('backup:restore', bk.bundleDir, 'REPLACE ALL DATA');
  ok(rs.ok, `restored (${rs.ok ? 'ok' : rs.error})`);
  eq(counts('pharmacy_sales'), snapshot.sales, 'sales are back to the backed-up count (the later credit sale is gone)');
  eq(counts('pharmacy_sale_payments'), snapshot.pay, 'credit payments are back (the later one is undone)');
  near(saleDue(one('SELECT * FROM pharmacy_sales WHERE id=?', c2.id)), snapshot.c2due, 'the second sale owes ₹25 again, as it did at the backup');
  near((await call('analytics:receivables')).total_due, snapshot.owed, 'Receivables reads the same after the restore');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
