// Billing portal, counter-sale billing rules, receivables, "Cost not recorded", and the backup of all of it —
// through the app's REAL IPC handlers on a temporary database. Synthetic data only.
//
// The questions this answers (in the owner's words): a pharmacy sale made under a patient's name shows in that
// patient's billing; a walk-in sale is listed separately; everything is accountable (counted exactly once); picking a
// patient in Billing shows what has been billed AND what can be billed; the analytics agree with each other; the
// backup holds all of it.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish, note } from './lib';
import { localISO } from '../../src/lib/localDate';

boot();
const db = () => getDb();
const q = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const today = localISO();
const r2 = (n: number) => Math.round(n * 100) / 100;
const WIDE: [string, string] = ['2000-01-01', '2100-01-01'];

/** An independent oracle for "still owed on this bill", written from the rules — not by calling the app's own function. */
function oracleDue(b: any): number {
  if (b.status === 'cancelled' || b.cancelled_at) return 0;
  const total = Number(b.total), paid = Number(b.amount_paid);
  const inPatient = b.admission_id != null || b.bill_type === 'ipd';
  if (!inPatient) return Math.max(0, r2(total - paid));
  if (b.finalized_at) return Math.max(0, r2(total - paid - Number(b.advance_adjusted)));
  const spare = Number(one('SELECT COALESCE(SUM(amount - adjusted_amount - refunded_amount),0) s FROM advances WHERE admission_id=?', b.admission_id).s);
  return Math.max(0, r2(total - paid - Math.min(Math.max(spare, 0), Math.max(0, total - paid))));
}
const oracleOutstanding = () => r2(q("SELECT * FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL").reduce((s, b) => s + oracleDue(b), 0));

(async () => {
  // ------------------------------------------------------------------------------------------------ set-up
  const doc = await call('doctors:create', { name: 'Dr. Portal', specialty: 'GP', default_fee: 300 });
  const asha = await call('patients:create', { first_name: 'Asha', last_name: 'Portal', dob: '1982-02-02', gender: 'F', phone: '9300000001' });
  const chitra = await call('patients:create', { first_name: 'Chitra', last_name: 'Ward', dob: '1970-03-03', gender: 'F', phone: '9300000003' });
  const dev = await call('patients:create', { first_name: 'Dev', last_name: 'Plain', dob: '1990-04-04', gender: 'M', phone: '9300000004' });
  const nobody = await call('patients:create', { first_name: 'Nobody', last_name: 'Yet', dob: '1995-05-05', gender: 'M', phone: '9300000005' });

  const sup = await call('wholesalers:upsert', { name: 'Portal Supplies', drug_license_no: 'DL-PORTAL' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Portal Tab 10mg', default_mrp: 10, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 5 });
  const pur = await call('purchase:create', {
    client_ref: 'portal-pur-1', invoice_number: 'PORTAL-001', wholesaler_id: sup.id, invoice_date: today,
    items: [{ drug_master_id: drug.id, batch_no: 'PT1', expiry: '2031-01-31', qty_received: 200, free_qty: 0, purchase_price: 6, mrp: 10, gst_rate: 0 }],
  });
  ok(pur.ok, `stock bought on a supplier bill (${pur.ok ? '200 × ₹6' : pur.error})`);
  const pay1 = await call('purchase:addPayment', pur.invoice.id, { amount: 500, payment_mode: 'Bank', paid_on: today, client_ref: 'portal-pp-1' });
  ok(pay1.ok, 'a supplier payment of ₹500 is recorded (it must reach the backup too)');
  const line = (qty: number, rate = 10) => ({ drug_master_id: drug.id, drug_name: 'Portal Tab 10mg', qty, rate });

  // ------------------------------------------------------------------------------------------------ 1. counter sales
  section('1 · counter sales: under a patient vs walk-in guest');
  const billsBefore = one('SELECT COUNT(*) c FROM bills').c;
  const sNamed = await call('pharmacy:sell', { patient_id: asha.id, items: [line(5)], payment_mode: 'UPI', client_ref: 'ps-1' });          // ₹50
  const g1 = await call('pharmacy:sell', { patient_id: null, customer_name: '  Ramesh the guest  ', items: [line(3)], payment_mode: 'Cash', client_ref: 'ps-2' }); // ₹30
  const g2 = await call('pharmacy:sell', { items: [line(2)], payment_mode: 'Cash', client_ref: 'ps-3' });                                   // ₹20, no name
  const g3 = await call('pharmacy:sell', { customer_name: 'X'.repeat(100), items: [line(1)], payment_mode: 'Card', client_ref: 'ps-4' });  // ₹10, long name
  const sNamed2 = await call('pharmacy:sell', { patient_id: asha.id, customer_name: 'Should be ignored', items: [line(1)], payment_mode: 'Cash', client_ref: 'ps-5' }); // ₹10
  eq(sNamed.total, 50, 'a sale under Asha: ₹50');
  eq(g1.customer_name, 'Ramesh the guest', 'a walk-in sale keeps the typed name (trimmed)');
  eq(g2.customer_name, null, 'a walk-in sale with no name keeps none (nothing invented)');
  eq(String(g3.customer_name).length, 80, 'a very long guest name is cut to 80 characters');
  eq(sNamed2.customer_name, null, 'a guest name typed on a sale UNDER a patient is not kept (the patient is the customer)');
  eq(one('SELECT COUNT(*) c FROM bills').c, billsBefore, 'pharmacy sales never create rows in bills — they cannot be counted twice');
  const dupSale = await call('pharmacy:sell', { patient_id: asha.id, items: [line(5)], payment_mode: 'UPI', client_ref: 'ps-1' });
  eq(dupSale.id, sNamed.id, 'the same sale sent twice (double-click) is recorded once');

  const all = await call('pharmacy:counterSales', {});
  const named = await call('pharmacy:counterSales', { scope: 'patient' });
  const guests = await call('pharmacy:counterSales', { scope: 'guest' });
  eq(all.totals.count, 5, 'counter sales: 5 in all');
  near(all.totals.total, 120, '…₹120 in total');
  near(named.totals.total, 60, 'under patients: ₹60');
  eq(named.totals.count, 2, '…2 sales');
  near(guests.totals.total, 60, 'walk-ins: ₹60');
  eq(guests.totals.count, 3, '…3 sales');
  near(named.totals.total + guests.totals.total, all.totals.total, 'patients + walk-ins = the whole');
  near(all.totals.by_mode.reduce((s: number, m: any) => s + m.total, 0), all.totals.total, 'the by-payment-mode split adds up to the total');
  eq((await call('pharmacy:counterSales', { scope: 'guest', q: 'Ramesh' })).rows.length, 1, 'search finds a guest by the name typed');
  eq((await call('pharmacy:counterSales', { q: 'Portal' })).rows.length, 2, 'search finds a patient\'s sales by name');
  eq((await call('pharmacy:counterSales', { from: today, to: today })).totals.count, 5, 'today\'s filter holds all five');
  eq((await call('pharmacy:counterSales', { from: '2000-01-01', to: '2000-01-02' })).totals.count, 0, '…and a past range holds none');
  eq((await call('pharmacy:saleDetail', g1.id)).customer_name, 'Ramesh the guest', 'the receipt data carries the guest name');

  section('1b · every screen counts those sales once');
  const fin = await call('finance:summary', { from: today, to: today });
  near(fin.range.pharma.total, 120, 'Accounts → Pharmacy this range: ₹120');
  near(fin.range.pharmaSplit.patient.total, 60, '…of which under patients ₹60');
  near(fin.range.pharmaSplit.guest.total, 60, '…and walk-in ₹60');
  near(fin.range.pharmaSplit.patient.total + fin.range.pharmaSplit.guest.total, fin.range.pharma.total, '…the split adds up to the whole');
  const mods = await call('analytics:modules', ...WIDE);
  near(mods.modules.find((m: any) => m.key === 'pharmacy').revenue, 120, 'Modules P&L → Pharmacy ₹120');
  const ph = await call('analytics:pharmacyOverview', { from: today, to: today });
  near(ph.totalRevenue, 120, 'Pharmacy analytics → revenue ₹120');
  eq(ph.totalSales, 5, '…5 sales');
  const mixP = ph.customerMix.find((m: any) => m.kind === 'patient'), mixG = ph.customerMix.find((m: any) => m.kind === 'guest');
  ok(!!mixP && !!mixG, 'the customer mix has both a patients row and a walk-in row');
  near(mixP?.revenue, 60, 'customer mix: patients ₹60');
  eq(mixP?.count, 2, '…2 sales under patients');
  near(mixG?.revenue, 60, '…walk-in ₹60');
  eq(mixG?.count, 3, '…3 walk-in sales');
  eq(ph.topPatients[0]?.patient_id, asha.id, 'the top pharmacy patient is Asha');
  near(ph.topPatients[0]?.revenue, 60, '…₹60');
  near(ph.paymentMix.reduce((s: number, m: any) => s + m.revenue, 0), 120, 'payment mix adds up to ₹120');
  const ov = await call('analytics:overview');
  near(ov.pharmacyMonthRevenue, 120, 'Analytics overview → pharmacy this month ₹120');
  near(ov.pharmacyMonthPatientRevenue + ov.pharmacyMonthGuestRevenue, ov.pharmacyMonthRevenue, '…patients + walk-in = the whole');
  const dc = (await call('reports:run', { kind: 'daily_collection', from: today, to: today }))[0];
  near(dc.pharmacy, 120, 'Daily Collection report → pharmacy ₹120');
  eq(dc.pharmacy_sales, 5, '…5 sales');
  const profit = (await call('analytics:pharmacyProfit', { from: today, to: today })).report;
  near(profit.totals.revenue, 120, 'Pharmacy profit report → revenue ₹120');
  near(profit.totals.cogs, 72, '…cost 12 units × ₹6 = ₹72');
  near(profit.totals.profit, 48, '…profit ₹48');

  // ------------------------------------------------------------------------------------------------ 2. the portal
  section('2 · the portal for a patient with bills of every kind');
  const appt1 = await call('appointments:create', { patient_id: asha.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:00' });
  const appt2 = await call('appointments:create', { patient_id: asha.id, doctor_id: doc.id, appointment_date: today, appointment_time: '11:00' });
  const consult = await call('bills:create', { appointment_id: appt1.id, patient_id: asha.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  const cbc = await call('lab:upsertTest', { name: 'CBC', price: 300, category: 'haematology', sample_type: 'Blood' });
  const lft = await call('lab:upsertTest', { name: 'LFT', price: 500, category: 'biochemistry', sample_type: 'Blood' });
  const free = await call('lab:upsertTest', { name: 'Unpriced Test', price: 0, category: 'haematology', sample_type: 'Blood' });
  const lab1 = await call('lab:createOrder', { appointment_id: appt1.id, patient_id: asha.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }, { lab_test_id: lft.id, test_name: 'LFT' }] });
  const xr = (await call('radiology:upsertTest', { name: 'Portal X-ray', modality: 'xray', price: 700 })).test;
  const rad1 = await call('radiology:createOrder', { patient_id: asha.id, appointment_id: appt1.id, doctor_id: doc.id, items: [{ test_id: xr.id }] });
  const labBill = one('SELECT * FROM bills WHERE lab_order_id=?', lab1.id);
  const radBill = one('SELECT * FROM bills WHERE radiology_order_id=?', rad1.order.id);
  eq(labBill.total, 800, 'lab bill ₹800 raised (unpaid)');
  eq(radBill.total, 700, 'radiology bill ₹700 raised (unpaid)');
  ok((await call('bill:pay', labBill.id, 300, 'UPI')).ok, '₹300 part-paid on the lab bill');

  let pa = await call('billing:patientPortal', asha.id);
  eq(pa.patient.name, 'Asha Portal', 'the portal opens for the right patient');
  eq(pa.history.length, 5, 'everything is listed: consultation, lab, radiology and 2 pharmacy sales');
  near(pa.summary.billed, 300 + 800 + 700 + 60, 'billed = ₹300 + ₹800 + ₹700 + ₹60 pharmacy = ₹1,860');
  near(pa.summary.received, 300 + 300 + 0 + 60, 'received = ₹660 (consultation, ₹300 of the lab bill, the pharmacy sales)');
  near(pa.summary.outstanding, 500 + 700, 'still to collect = ₹500 (lab) + ₹700 (radiology) = ₹1,200');
  near(pa.summary.billed - pa.summary.received, pa.summary.outstanding, 'billed − received = still to collect');
  eq(pa.summary.pharmacy_sales, 2, '2 pharmacy sales counted');
  eq(pa.summary.bills, 3, '3 bills counted');
  const lines = Object.fromEntries(pa.history.map((h: any) => [h.number, h]));
  eq(lines[labBill.bill_number].status, 'part_paid', 'the lab bill reads part-paid');
  near(lines[labBill.bill_number].due, 500, '…₹500 due');
  eq(lines[radBill.bill_number].status, 'unpaid', 'the radiology bill reads unpaid');
  eq(lines[consult.bill_number].status, 'paid', 'the consultation reads paid');
  ok(pa.history.filter((h: any) => h.counter_sale).length === 2 && pa.history.filter((h: any) => h.counter_sale).every((h: any) => h.kind === 'pharmacy' && h.status === 'paid' && h.due === 0), 'both pharmacy sales are marked as counter sales, paid');
  ok(pa.history.every((h: any, i: number, a: any[]) => i === 0 || a[i - 1].date >= h.date), 'the list is newest first');
  eq(pa.todo.filter((t: any) => t.kind === 'bill_due').length, 2, 'two bills are waiting to be collected');
  const visit = pa.todo.find((t: any) => t.kind === 'consultation_unbilled');
  ok(visit && visit.appointment_id === appt2.id && visit.amount === 300, "the second visit is offered as billable, at the doctor's fee (₹300)");
  ok(!pa.todo.some((t: any) => t.appointment_id === appt1.id && t.kind === 'consultation_unbilled'), '…and the first visit (already billed) is not');
  eq(pa.summary.to_bill_count, 1, 'one thing can be billed');

  section('2b · collecting, and what changes');
  const over = await call('bill:pay', radBill.id, 701, 'Cash');
  ok(over.ok === false && /more than/.test(over.error), 'collecting more than is due is refused in words');
  ok((await call('bill:pay', radBill.id, 700, 'Cash', 'desk', 'portal-pay-rad')).ok, 'the radiology bill is collected in full');
  const dupPay = await call('bill:pay', radBill.id, 700, 'Cash', 'desk', 'portal-pay-rad');
  ok(dupPay.ok && dupPay.duplicate, 'the same collection sent twice is recognised, not taken twice');
  pa = await call('billing:patientPortal', asha.id);
  near(pa.summary.outstanding, 500, 'still to collect drops to ₹500');
  ok((await call('bill:pay', labBill.id, 500, 'Cash')).ok, 'the rest of the lab bill is collected');
  pa = await call('billing:patientPortal', asha.id);
  near(pa.summary.outstanding, 0, 'nothing left to collect');
  near(pa.summary.received, pa.summary.billed, 'received = billed');
  ok(!pa.todo.some((t: any) => t.kind === 'bill_due'), '…and nothing is listed as due');
  const rb = await call('bills:create', { appointment_id: appt2.id, patient_id: asha.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'UPI' });
  ok(rb.total === 300, 'the second visit is billed');
  pa = await call('billing:patientPortal', asha.id);
  eq(pa.todo.filter((t: any) => t.kind === 'consultation_unbilled').length, 0, 'it leaves the can-be-billed list');

  section('2c · a prescription not yet dispensed');
  await call('rx:saveAll', appt2.id, [{ drug_name: 'Portal Tab 10mg', drug_master_id: drug.id, dosage: '1', frequency: 'BD', duration: '5 days' }]);
  eq(one('SELECT COUNT(*) c FROM prescription_items WHERE appointment_id=?', appt2.id).c, 1, 'a prescription is written for the second visit');
  pa = await call('billing:patientPortal', asha.id);
  ok(pa.todo.some((t: any) => t.kind === 'rx_pending' && t.appointment_id === appt2.id), 'the portal says it has not been dispensed');
  const rxSale = await call('pharmacy:sell', { patient_id: asha.id, appointment_id: appt2.id, items: [line(2)], payment_mode: 'Cash', client_ref: 'ps-rx' });
  pa = await call('billing:patientPortal', asha.id);
  ok(!pa.todo.some((t: any) => t.kind === 'rx_pending'), 'once dispensed it is no longer pending');
  near(pa.summary.pharmacy_sales, 3, '…and the sale appears under Asha (3 pharmacy sales now)');
  const none = await call('billing:patientPortal', nobody.id);
  ok(none.history.length === 0 && none.todo.length === 0 && none.summary.billed === 0, 'a patient with no activity has an empty, honest portal');
  ok((await attempt('billing:patientPortal', 999999)).ok === false, 'a patient that does not exist gives a clear error, not a crash');
  ok((await attempt('billing:patientPortal', 'abc')).ok === false, 'a nonsense id is refused');

  // ------------------------------------------------------------------------------------------------ 3. orders with no bill
  section('3 · a lab or scan order that has no bill can be billed from the portal');
  await call('settings:save', { lab_auto_bill: false, radiology_auto_bill: false });
  const lab2 = await call('lab:createOrder', { appointment_id: appt2.id, patient_id: asha.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  eq(one('SELECT COUNT(*) c FROM bills WHERE lab_order_id=?', lab2.id).c, 0, 'with lab auto-billing off, the order has no bill');
  pa = await call('billing:patientPortal', asha.id);
  const lt = pa.todo.find((t: any) => t.kind === 'lab_unbilled' && t.order_id === lab2.id);
  ok(lt && lt.amount === 300, 'the portal offers it, priced from the tests (₹300)');
  const b1 = await call('billing:createOrderBill', 'lab', lab2.id);
  ok(b1.ok && b1.total === 300, `billing it raises a ₹300 bill (${b1.ok ? b1.bill_number : b1.error})`);
  eq(one('SELECT lab_order_id FROM bills WHERE id=?', b1.bill_id).lab_order_id, lab2.id, '…linked to the order');
  eq(one('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', b1.bill_id).c, 1, '…with its line');
  const b1again = await call('billing:createOrderBill', 'lab', lab2.id);
  ok(b1again.ok === false && /already billed/.test(b1again.error), 'billing the same order twice is refused');
  pa = await call('billing:patientPortal', asha.id);
  ok(!pa.todo.some((t: any) => t.kind === 'lab_unbilled' && t.order_id === lab2.id), 'it leaves the can-be-billed list');
  near(pa.summary.outstanding, 300, 'the new bill is now owed (₹300)');

  // A lab bill raised by hand in Quick Bill is not linked to an order: billing the order too would charge it twice.
  const manual = await call('bill:createStandalone', { patient_id: asha.id, bill_type: 'lab', items: [{ description: 'LFT (hand-entered)', qty: 1, rate: 500 }], payment_mode: 'Cash', paid_now: true });
  ok(manual.ok, 'a lab bill is raised by hand in Quick Bill (₹500, paid)');
  const lab3 = await call('lab:createOrder', { patient_id: asha.id, doctor_id: doc.id, items: [{ lab_test_id: lft.id, test_name: 'LFT' }] });
  const w = await call('billing:createOrderBill', 'lab', lab3.id);
  ok(w.ok === false && w.needs_confirm === true && /already a lab bill/.test(w.error), 'billing an order when a hand-made lab bill exists asks first, naming that bill');
  eq(one('SELECT COUNT(*) c FROM bills WHERE lab_order_id=?', lab3.id).c, 0, '…and raised nothing yet');
  const forced = await call('billing:createOrderBill', 'lab', lab3.id, { force: true });
  ok(forced.ok && forced.total === 500, 'confirmed, it is billed (₹500)');

  const lab4 = await call('lab:createOrder', { patient_id: asha.id, doctor_id: doc.id, items: [{ lab_test_id: free.id, test_name: 'Unpriced Test' }] });
  pa = await call('billing:patientPortal', asha.id);
  ok(!pa.todo.some((t: any) => t.order_id === lab4.id), 'an order whose tests have no price is not offered (nothing to charge)');
  const np = await call('billing:createOrderBill', 'lab', lab4.id);
  ok(np.ok === false && /price/.test(np.error), 'billing it says why it cannot');

  const rad2 = await call('radiology:createOrder', { patient_id: asha.id, appointment_id: appt2.id, doctor_id: doc.id, items: [{ test_id: xr.id }] });
  eq(one('SELECT COUNT(*) c FROM bills WHERE radiology_order_id=?', rad2.order.id).c, 0, 'with radiology auto-billing off, a scan order has no bill');
  pa = await call('billing:patientPortal', asha.id);
  ok(pa.todo.some((t: any) => t.kind === 'radiology_unbilled' && t.order_id === rad2.order.id && t.amount === 700), 'the portal offers it (₹700)');
  const rb2 = await call('billing:createOrderBill', 'radiology', rad2.order.id);
  ok(rb2.ok && rb2.total === 700, 'billing it raises the ₹700 radiology bill');
  const rad3 = await call('radiology:createOrder', { patient_id: asha.id, doctor_id: doc.id, items: [{ test_id: xr.id }] });
  ok((await call('radiology:cancelOrder', rad3.order.id, 'patient left')).ok, 'another scan order is cancelled');
  pa = await call('billing:patientPortal', asha.id);
  ok(!pa.todo.some((t: any) => t.order_id === rad3.order.id), 'a cancelled order is never offered for billing');
  ok((await call('billing:createOrderBill', 'radiology', rad3.order.id)).ok === false, '…and cannot be billed');
  ok((await call('billing:createOrderBill', 'dental' as any, 1)).ok === false, 'an unknown kind of order is refused');
  await call('settings:save', { lab_auto_bill: true, radiology_auto_bill: true });
  // settle those for the later identities
  ok((await call('bill:pay', b1.bill_id, 300, 'Cash')).ok && (await call('bill:pay', rb2.bill_id, 700, 'Cash')).ok, 'both are then collected');
  ok((await call('bill:pay', forced.bill_id, 500, 'Cash')).ok, '…and the confirmed one');
  near((await call('billing:patientPortal', asha.id)).summary.outstanding, 0, 'Asha owes nothing again');

  // ------------------------------------------------------------------------------------------------ 4. in-patients
  section('4 · an admitted patient: the advance counts, the credit is shown');
  await call('settings:save', { ipd_advance_enabled: true });
  const ward = await call('wards:save', { name: 'General', ward_type: 'general', per_day_rate: 1000, nursing_per_day: 200 });
  const bedA = await call('beds:save', { ward_id: ward.id, bed_number: 'P-1' });
  const bedB = await call('beds:save', { ward_id: ward.id, bed_number: 'P-2' });
  const admC = await call('ip:admitV2', { patient_id: chitra.id, bed_id: bedA.id, admission_doctor_id: doc.id, advance_amount: 5000, advance_mode: 'Cash', performed_by: 'tester' });
  const admD = await call('ip:admitV2', { patient_id: dev.id, bed_id: bedB.id, admission_doctor_id: doc.id, advance_amount: 500, advance_mode: 'UPI', performed_by: 'tester' });
  ok(admC.ok && admD.ok, 'two patients admitted: Chitra with ₹5,000 advance, Dev with ₹500');
  await call('bill:previewAdmission', admC.id); await call('bill:previewAdmission', admD.id);
  let pc = await call('billing:patientPortal', chitra.id);
  eq(pc.history.length, 1, 'Chitra has one line: her in-patient bill');
  near(pc.history[0].total, 1200, 'bed ₹1,000 + nursing ₹200 so far');
  near(pc.history[0].advance, 1200, 'her advance covers it (₹1,200 of the ₹5,000 is used)');
  near(pc.history[0].due, 0, 'nothing is due');
  ok(pc.history[0].running, 'flagged as still admitted (the bill is still growing)');
  near(pc.summary.credit_held, 3800, 'advance held for her = ₹5,000 − ₹1,200 used = ₹3,800');
  near(pc.summary.outstanding, 0, 'she owes nothing');
  let pd = await call('billing:patientPortal', dev.id);
  near(pd.history[0].advance, 500, "Dev's ₹500 advance is used in full");
  near(pd.history[0].due, 700, 'he still owes ₹1,200 − ₹500 = ₹700');
  near(pd.summary.credit_held, 0, 'no spare credit');
  ok(pd.todo.some((t: any) => t.kind === 'ipd_running' && t.admission_id === admD.id && t.due === 700), 'his running bill is in the to-collect list, pointing at the admission');

  const ord = await call('ip:medOrderAdd', admC.id, { drug_master_id: drug.id, drug_name: 'Portal Tab 10mg', dose: '1', route: 'PO', frequency: 'BD', ordered_by_doctor_id: doc.id });
  const give = await call('ip:medAdminGive', ord.id, { status: 'given', qty: 2, administered_by: 'nurse1' });
  ok(give.ok && give.billed, 'two tablets given on the ward (billed to the in-patient bill)');
  eq(q("SELECT id FROM pharmacy_sales WHERE payment_mode='IPD-bill'").length, 1, 'the ward dispense is a pharmacy sale marked "IPD-bill"');
  const allAfterWard = await call('pharmacy:counterSales', {});
  near(allAfterWard.totals.total, 140, 'it is NOT a counter sale: counter sales are the original five (₹120) plus the ₹20 prescription sale');
  pc = await call('billing:patientPortal', chitra.id);
  ok(!pc.history.some((h: any) => h.counter_sale), "it is not listed again beside Chitra's in-patient bill");
  near(pc.history[0].total, 1220, 'it IS on her bill: ₹1,200 + 2 × ₹10');
  const mods2 = await call('analytics:modules', ...WIDE);
  near(mods2.modules.find((m: any) => m.key === 'pharmacy').revenue, 140, 'Modules P&L → Pharmacy does not include the ward dispense');
  const ov2 = await call('analytics:overview');
  near(ov2.pharmacyMonthRevenue, 140, 'the overview does not either (it used to count it twice)');
  const basket = await call('analytics:pharmacyBasket');
  eq(basket.reduce((s: number, b: any) => s + b.sales, 0), 6, 'the basket analysis counts the six counter sales, not the ward dispense');
  const sales = await call('pharmacy:listSales', {});
  ok(sales.some((s: any) => s.payment_mode === 'IPD-bill'), 'the pharmacy sales ledger still lists the ward dispense (the stock went out)');

  section('4b · discharge: the advance used is recorded, the rest can be refunded');
  const rq = await call('ip:requestDischarge', admC.id, { outcome: 'discharged' }, 'dr');
  ok(rq.ok, 'discharge requested for Chitra');
  const ap = await call('ip:approveDischarge', admC.id, { by: 'mgr' });
  ok(ap.ok, 'discharge approved (her advance covers the bill)');
  pc = await call('billing:patientPortal', chitra.id);
  near(pc.history[0].advance, 1220, 'the advance recorded as used = the whole bill (₹1,220)');
  ok(!pc.history[0].running, 'no longer running');
  near(pc.history[0].due, 0, 'nothing due');
  near(pc.summary.credit_held, 3780, 'advance still held = ₹5,000 − ₹1,220 = ₹3,780');
  const advRows = await call('advances:list', admC.id);
  const rf = await call('advances:refund', advRows.rows[0].id, 3780, 'balance returned at discharge', 'mgr');
  ok(rf.ok, '₹3,780 refunded');
  pc = await call('billing:patientPortal', chitra.id);
  near(pc.summary.credit_held, 0, 'no advance held after the refund');
  near(pc.history[0].due, 0, '…and the bill still reads settled');

  const rq2 = await call('ip:requestDischarge', admD.id, { outcome: 'discharged' }, 'dr');
  ok(rq2.ok, 'discharge requested for Dev (who still owes)');
  const ap2 = await call('ip:approveDischarge', admD.id, { by: 'mgr', override_reason: 'will pay later (test)' });
  ok(ap2.ok, 'approved with a written reason');
  pd = await call('billing:patientPortal', dev.id);
  near(pd.history[0].advance, 500, 'his recorded advance use: ₹500');
  near(pd.history[0].due, 700, 'he still owes ₹700 after discharge');
  ok(pd.todo.some((t: any) => t.kind === 'bill_due' && t.due === 700), 'it is now an ordinary bill to collect');

  // ------------------------------------------------------------------------------------------------ 5. walk-in bills
  section('5 · a bill raised for a name with no patient record');
  const wilma = await call('bill:createStandalone', { patient_id: null, patient_name: 'Walk-in Wilma', bill_type: 'custom', items: [{ description: 'Dressing', qty: 1, rate: 200 }], payment_mode: 'Cash', paid_now: false });
  ok(wilma.ok, 'an unpaid ₹200 bill is raised for a typed name');
  const found = await call('bills:list', { q: 'Wilma' });
  ok(found.length === 1 && found[0].patient_name === 'Walk-in Wilma', 'Billing History can find it by that name (it used to be invisible there)');
  const recW = await call('analytics:receivables', { limit: 200 });
  ok(recW.by_patient.some((p: any) => p.name === 'Walk-in Wilma' && p.due === 200 && p.patient_id === null), 'she appears in "who owes" by name');
  ok((await call('bill:pay', wilma.id, 200, 'Cash')).ok, 'her bill is collected');
  ok(!(await call('analytics:receivables', { limit: 200 })).by_patient.some((p: any) => p.name === 'Walk-in Wilma'), '…and she drops off the list');

  // ------------------------------------------------------------------------------------------------ 6. the numbers agree
  section('6 · every screen agrees on what is owed');
  // leave one old part-paid and one old unpaid bill so the aging bands have something
  const old1 = await call('bill:createStandalone', { patient_id: nobody.id, bill_type: 'custom', items: [{ description: 'Old procedure', qty: 1, rate: 1000 }], payment_mode: 'Cash', paid_now: false });
  db().prepare("UPDATE bills SET created_at=datetime('now','-40 days') WHERE id=?").run(old1.id);
  ok((await call('bill:pay', old1.id, 250, 'Cash')).ok, 'an old ₹1,000 bill (40 days) is part-paid, ₹250');
  const truth = oracleOutstanding();
  note(`independent oracle says ₹${truth} is owed`);
  const rec = await call('analytics:receivables', { limit: 200 });
  near(rec.total_due, truth, 'receivables total = the independent oracle');
  near(rec.total_due, 750 + 700, '…= ₹750 (old bill) + ₹700 (Dev)');
  near(rec.by_kind.reduce((s: number, k: any) => s + k.due, 0), rec.total_due, 'the by-department split adds up');
  near(rec.by_patient.reduce((s: number, p: any) => s + p.due, 0), rec.total_due, 'the by-patient split adds up');
  near(rec.aging.reduce((s: number, a: any) => s + a.due, 0), rec.total_due, 'the aging bands add up');
  eq(rec.aging.find((a: any) => a.label === '31–90 days').bills, 1, 'the 40-day bill sits in the 31–90 day band');
  const abx = await call('analytics:billing', ...WIDE);
  near(abx.outstanding, rec.total_due, 'IPD & billing analytics → outstanding is the same');
  const ov3 = await call('analytics:overview');
  near(ov3.outstandingTotal, rec.total_due, 'Analytics overview → still to collect is the same');
  const mods3 = await call('analytics:modules', ...WIDE);
  near(mods3.totals.outstanding, rec.total_due, 'Modules P&L → outstanding is the same', 2);
  const pdv = await call('billing:patientPortal', dev.id), pnb = await call('billing:patientPortal', nobody.id);
  near(pdv.summary.outstanding + pnb.summary.outstanding, rec.total_due, "the two patients' portals add up to the same total");
  let portalsTotal = 0;
  for (const p of [asha, chitra, dev, nobody]) portalsTotal += (await call('billing:patientPortal', p.id)).summary.outstanding;
  near(portalsTotal, rec.total_due, 'all four portals together = the clinic total');
  near(mods3.modules.reduce((s: number, m: any) => s + m.revenue, 0), mods3.totals.revenue, 'module revenues add up to the total revenue');
  const billsAll = r2(one("SELECT COALESCE(SUM(total),0) s FROM bills WHERE COALESCE(status,'')<>'cancelled'").s);
  const counterAll = r2(one("SELECT COALESCE(SUM(total),0) s FROM pharmacy_sales WHERE COALESCE(payment_mode,'')<>'IPD-bill'").s);
  near(mods3.totals.revenue, billsAll + counterAll, 'Modules P&L revenue = every bill + every counter pharmacy sale (nothing falls between the rows)', 3);
  const fin3 = await call('finance:summary', {});
  near(fin3.allTime.total, billsAll, 'Accounts → all-time billed = every bill');
  ok(mods3.modules.some((m: any) => m.key === 'other'), 'the hand-made Quick Bills (custom) have a row of their own instead of vanishing');

  section('6b · money received');
  const col = await call('analytics:billing', today, today);
  const paymentsToday = r2(one("SELECT COALESCE(SUM(amount),0) s FROM bill_payments WHERE date(received_at,'localtime')=?", today).s);
  const atBilling = r2(q("SELECT b.amount_paid - COALESCE((SELECT SUM(amount) FROM bill_payments WHERE bill_id=b.id),0) rem FROM bills b WHERE COALESCE(b.status,'')<>'cancelled' AND b.cancelled_at IS NULL AND date(b.created_at,'localtime')=?", today).reduce((s, r) => s + (r.rem > 0.004 ? r.rem : 0), 0));
  const counterToday = r2(one("SELECT COALESCE(SUM(total),0) s FROM pharmacy_sales WHERE COALESCE(payment_mode,'')<>'IPD-bill' AND date(created_at,'localtime')=?", today).s);
  near(col.totalCollected, r2(paymentsToday + atBilling + counterToday), 'collected today = payments taken + bills paid when raised + pharmacy counter sales');
  near(col.collectedBySource.bill_payments, paymentsToday, '…the payments-taken part');
  near(col.collectedBySource.paid_at_billing, atBilling, '…the paid-when-raised part');
  near(col.collectedBySource.pharmacy_counter, counterToday, '…the pharmacy part');
  near(col.collections.reduce((s: number, c: any) => s + c.total, 0), col.totalCollected, 'the by-payment-mode list adds up to it');
  const fin2 = await call('finance:summary', {});
  near(fin2.today.byMode.reduce((s: number, m: any) => s + m.total, 0), col.totalCollected, 'Accounts → collected today by mode is the same total');
  const dc2 = (await call('reports:run', { kind: 'daily_collection', from: today, to: today }))[0];
  near(dc2.received, col.totalCollected, 'Daily Collection → received is the same total');
  near(dc2.revenue, r2(one("SELECT COALESCE(SUM(total),0) s FROM bills WHERE COALESCE(status,'')<>'cancelled' AND date(created_at,'localtime')=?", today).s), 'Daily Collection → revenue = bills made today');
  ok(fin2.today.delta === null || typeof fin2.today.delta === 'number', "today carries a change-on-yesterday figure (or none when yesterday was empty)");
  const wide = await call('analytics:billing', ...WIDE);
  const allRows = r2(one('SELECT COALESCE(SUM(amount),0) s FROM bill_payments').s);
  const allAtBilling = r2(q("SELECT b.amount_paid - COALESCE((SELECT SUM(amount) FROM bill_payments WHERE bill_id=b.id),0) rem FROM bills b WHERE COALESCE(b.status,'')<>'cancelled' AND b.cancelled_at IS NULL").reduce((s, r) => s + (r.rem > 0.004 ? r.rem : 0), 0));
  const allCounter = r2(one("SELECT COALESCE(SUM(total),0) s FROM pharmacy_sales WHERE COALESCE(payment_mode,'')<>'IPD-bill'").s);
  near(wide.totalCollected, r2(allRows + allAtBilling + allCounter), 'over all time, collected = every payment + every paid-when-raised bill + every counter sale');
  ok(wide.bySection.some((s: any) => s.category === 'pharmacy_counter'), 'revenue by section includes the pharmacy counter');

  // ------------------------------------------------------------------------------------------------ 7. Cost not recorded
  section('7 · "Cost not recorded"');
  const hand = await call('pharmacy:upsertDrug', { name: 'Hand-typed Drug', default_mrp: 20, gst_rate: 0, schedule: 'OTC' });
  const man = await call('pharmacy:upsertBatch', { drug_master_id: hand.id, batch_no: 'MAN1', expiry: '2031-01-01', qty_received: 50, qty_remaining: 50, purchase_price: 12, mrp: 20 });
  const sMan = await call('pharmacy:sell', { patient_id: asha.id, items: [{ drug_master_id: hand.id, drug_name: 'Hand-typed Drug', qty: 5, rate: 20 }], payment_mode: 'Cash', client_ref: 'cost-1' });
  eq(one('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', sMan.id).unit_cost, 12, 'a sale from a hand-typed batch freezes its typed cost (₹12)');
  const sPur = await call('pharmacy:sell', { patient_id: asha.id, items: [line(2)], payment_mode: 'Cash', client_ref: 'cost-2' });
  eq(one('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', sPur.id).unit_cost, 6, 'a sale from a purchase-bill batch freezes the real cost (₹6)');
  const sumBefore = await call('pharmacy:costSummary');
  ok(sumBefore.batches >= 1 && sumBefore.units_in_stock >= 45 && sumBefore.value_in_stock >= 45 * 12, `the summary counts the hand-typed stock (${sumBefore.batches} batches, ${sumBefore.units_in_stock} units)`);
  ok(sumBefore.past_sale_units >= 5, '…and the units already sold from it');
  const manId = one('SELECT id FROM drug_stock_batches WHERE batch_no=?', 'MAN1').id;
  const purBatch = () => one("SELECT purchase_price, unit_cost FROM drug_stock_batches WHERE batch_no='PT1'");
  const c1 = await call('pharmacy:clearManualCost', {});
  ok(c1.ok && c1.batches >= 1 && c1.register_rows === 0, `clearing (without past sales) changed ${c1.ok ? c1.batches : '?'} batches and no past sale`);
  const mb = one('SELECT purchase_price, unit_cost, qty_remaining FROM drug_stock_batches WHERE id=?', manId);
  ok(mb.purchase_price === null && mb.unit_cost === null, 'the hand-typed batch now has no cost');
  eq(mb.qty_remaining, 45, '…and its stock is untouched');
  eq(purBatch().unit_cost, 6, 'the purchase-bill batch keeps its real cost');
  eq(one('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', sMan.id).unit_cost, 12, 'the earlier sale keeps the cost it was made at');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches WHERE purchase_item_id IS NOT NULL AND unit_cost IS NULL').c, 0, 'no purchase-bill batch lost its cost');
  eq((await call('pharmacy:costSummary')).batches, 0, 'the summary now shows nothing left to clear');
  const sMan2 = await call('pharmacy:sell', { patient_id: asha.id, items: [{ drug_master_id: hand.id, drug_name: 'Hand-typed Drug', qty: 3, rate: 20 }], payment_mode: 'Cash', client_ref: 'cost-3' });
  eq(one('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', sMan2.id).unit_cost, null, 'a new sale from that batch records NO cost (never a guess)');
  const pr = (await call('analytics:pharmacyProfit', { from: today, to: today })).report;
  ok(pr.totals.uncosted_units >= 3, 'the profit report counts those units as "cost not recorded", outside profit');
  ok((await call('analytics:pharmacyChecks')).some((f: any) => f.code === 'uncosted_sales'), 'the data checks list the sales with no cost');
  const audit = q("SELECT * FROM audit_log WHERE action='pharmacy.cost_cleared'");
  eq(audit.length, 1, 'the clearing is in the audit log');
  ok(JSON.parse(audit[0].details).previous.some((p: any) => p.batch_no === 'MAN1' && p.purchase_price === 12), '…with the old figures, so it can be put back by hand');

  // include past sales
  await call('pharmacy:upsertBatch', { drug_master_id: hand.id, batch_no: 'MAN2', expiry: '2031-01-01', qty_received: 20, qty_remaining: 20, purchase_price: 15, mrp: 20 });
  // sell enough that FEFO reaches MAN2 is unnecessary: set cost on MAN1 again and clear WITH past sales
  db().prepare("UPDATE drug_stock_batches SET purchase_price=12, unit_cost=12 WHERE batch_no IN ('MAN1','MAN2')").run();
  db().prepare("UPDATE dispensing_register SET unit_cost=12 WHERE batch_id=?").run(manId);
  const c2 = await call('pharmacy:clearManualCost', { include_past_sales: true });
  ok(c2.ok && c2.register_rows >= 2, `clearing WITH past sales also cleared ${c2.ok ? c2.register_rows : '?'} past sale lines`);
  eq(one('SELECT COUNT(*) c FROM dispensing_register WHERE batch_id=? AND unit_cost IS NOT NULL', manId).c, 0, 'past sales from the hand-typed batch no longer carry a cost');
  eq(one('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', sPur.id).unit_cost, 6, '…while past sales from the purchase batch keep theirs (₹6)');

  // ------------------------------------------------------------------------------------------------ 8. backup
  section('8 · the backup holds all of it');
  const counts = (t: string) => one(`SELECT COUNT(*) c FROM "${t}"`).c;
  const bk = await call('backup:now');
  ok(!!bk.bundleDir && fs.existsSync(bk.bundleDir), 'a backup bundle is written');
  ok(bk.verified === true && bk.integrityOk === true && (bk.mismatches || []).length === 0, `…verified against the live database (${bk.totalRows} rows, 0 mismatches)`);
  const manifest = JSON.parse(fs.readFileSync(path.join(bk.bundleDir, 'manifest.json'), 'utf8'));
  eq(manifest.verification.integrity_check, 'ok', 'the copy passes SQLite\'s own integrity check');
  eq(manifest.verification.row_counts_match, true, 'every table has the same row count as the live database');
  eq(manifest.verification.mismatches.length, 0, '…with no mismatches');
  const bad = Object.entries(manifest.sheet_row_counts).filter(([, n]) => n === -1).map(([s]) => s);
  eq(bad.length, 0, `no Excel sheet failed to build${bad.length ? ': ' + bad.join(', ') : ''}`);
  for (const sheet of ['Pharmacy Sales', 'Pharmacy Sale Items', 'Drug Stock Batches', 'Purchase Invoices', 'Purchase Invoice Items', 'Supplier Payments', 'Dispensing Register', 'Bills', 'Bill Items', 'Bill Payments', 'Advances', 'Outstanding Dues']) {
    ok(manifest.sheets.includes(sheet), `the workbook has a "${sheet}" sheet`);
  }
  const rc = (label: string) => manifest.verification.receipt.find((r: any) => r.label === label);
  eq(rc('Pharmacy sales')?.count, counts('pharmacy_sales'), 'the receipt counts pharmacy sales correctly');
  eq(rc('Supplier purchase bills')?.count, counts('purchase_invoices'), '…purchase bills');
  eq(rc('Supplier payments')?.count, counts('purchase_payments'), '…supplier payments');
  eq(rc('Stock batches')?.count, counts('drug_stock_batches'), '…stock batches');
  eq(rc('Dispensing register entries')?.count, counts('dispensing_register'), '…dispensing register entries');
  eq(rc('Advance deposits')?.count, counts('advances'), '…advance deposits');
  eq(rc('Bills')?.count, counts('bills'), '…bills');

  const xlsxFile = manifest.xlsx_path as string;
  ok(fs.existsSync(xlsxFile), 'the Excel workbook exists');
  const wb = XLSX.readFile(xlsxFile);
  const rows = (name: string) => XLSX.utils.sheet_to_json<any>(wb.Sheets[name]);
  const headers = (name: string): string[] => (XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 })[0] ?? []).map(String);
  const ps = rows('Pharmacy Sales');
  eq(ps.length, counts('pharmacy_sales'), 'Pharmacy Sales has one row per sale');
  ok(['customer_type', 'guest_name', 'sold_by', 'cgst_total'].every((k) => headers('Pharmacy Sales').includes(k)), '…with customer type, guest name, who sold it and the GST split');
  ok(ps.some((r) => r.guest_name === 'Ramesh the guest' && r.customer_type === 'Walk-in guest'), '…the walk-in guest sale is there, by name');
  ok(ps.some((r) => r.customer_type === 'Registered patient' && r.patient_name === 'Asha Portal'), '…a sale under a patient is there, by name');
  ok(ps.some((r) => r.customer_type === 'Ward (on the IPD bill)'), '…and the ward dispense is labelled as such');
  const bl = rows('Bills');
  eq(bl.length, counts('bills'), 'Bills has one row per bill');
  ok(['status', 'bill_type', 'amount_paid', 'advance_adjusted', 'admission_id', 'lab_order_id', 'radiology_order_id', 'cancelled_at'].every((k) => headers('Bills').includes(k)), '…with status, type, amount paid, advance used, order links and cancellation');
  const sb = rows('Drug Stock Batches');
  eq(sb.length, counts('drug_stock_batches'), 'Drug Stock Batches has every batch');
  ok(['unit_cost', 'selling_price', 'cost_source', 'manufacture_date'].every((k) => headers('Drug Stock Batches').includes(k)), '…with unit cost, selling price and where the cost came from');
  ok(sb.some((r) => r.batch_no === 'MAN1' && r.cost_source === 'typed in by hand') && sb.some((r) => r.batch_no === 'PT1' && r.cost_source === 'from a purchase bill'), '…telling hand-typed batches from purchase-bill ones');
  const spp = rows('Supplier Payments');
  eq(spp.length, counts('purchase_payments'), 'Supplier Payments has every payment');
  ok(spp.some((r) => r.amount === 500 && r.wholesaler_name === 'Portal Supplies'), '…including the ₹500 paid to Portal Supplies');
  const pi = rows('Purchase Invoices');
  ok(['amount_paid', 'balance_due', 'gst_in_cost', 'other_charges', 'round_off'].every((k) => headers('Purchase Invoices').includes(k)), 'Purchase Invoices carries amount paid, balance due, freight and rounding');
  ok(['disc_pct', 'discount_amount', 'unit_cost', 'selling_price'].every((k) => headers('Purchase Invoice Items').includes(k)), 'Purchase Invoice Items carries discount, true unit cost and selling price');
  const piRow = pi.find((r) => r.invoice_number === 'PORTAL-001');
  near(piRow?.balance_due, 1200 - 500, 'the Portal supplier bill shows ₹700 still owed (₹1,200 − ₹500 paid)');
  const dues = rows('Outstanding Dues');
  near(dues.reduce((s, r) => s + (Number(r.still_due) || 0), 0), (await call('analytics:receivables')).total_due, 'the "Outstanding Dues" sheet adds up to the clinic\'s total owed');
  const dr = rows('Dispensing Register');
  ok(headers('Dispensing Register').includes('unit_cost'), 'the Dispensing Register sheet carries the cost frozen on each sale');
  const snapshot = {
    sales: counts('pharmacy_sales'), bills: counts('bills'), batches: counts('drug_stock_batches'), pay: counts('purchase_payments'),
    ashaOut: (await call('billing:patientPortal', asha.id)).summary.outstanding, devOut: (await call('billing:patientPortal', dev.id)).summary.outstanding,
    guestTotal: (await call('pharmacy:counterSales', { scope: 'guest' })).totals.total, namedTotal: (await call('pharmacy:counterSales', { scope: 'patient' })).totals.total,
  };

  section('8b · restoring it brings everything back');
  // change things AFTER the backup, then restore
  await call('pharmacy:sell', { customer_name: 'Added after the backup', items: [line(1)], payment_mode: 'Cash', client_ref: 'post-1' });
  const devBillId = one("SELECT id FROM bills WHERE bill_type='ipd' AND patient_id=?", dev.id).id;
  ok((await call('bill:pay', devBillId, 100, 'Cash')).ok, 'a payment is taken after the backup');
  const pv = await call('backup:previewRestore', bk.bundleDir);
  ok(pv.ok, 'the restore preview reads the bundle');
  const rs = await call('backup:restore', bk.bundleDir, 'REPLACE ALL DATA');
  ok(rs.ok, `restored (${rs.ok ? 'ok' : rs.error})`);
  eq(counts('pharmacy_sales'), snapshot.sales, 'pharmacy sales are back to the backed-up count (the later sale is gone)');
  eq(counts('bills'), snapshot.bills, 'bills are back');
  eq(counts('drug_stock_batches'), snapshot.batches, 'batches are back');
  eq(counts('purchase_payments'), snapshot.pay, 'supplier payments are back');
  eq(one("SELECT customer_name FROM pharmacy_sales WHERE sale_number=?", g1.sale_number).customer_name, 'Ramesh the guest', "the walk-in guest's name came back");
  near((await call('billing:patientPortal', asha.id)).summary.outstanding, snapshot.ashaOut, "Asha's portal reads the same after the restore");
  near((await call('billing:patientPortal', dev.id)).summary.outstanding, snapshot.devOut, "Dev's portal reads the same (the later payment is undone)");
  near((await call('pharmacy:counterSales', { scope: 'guest' })).totals.total, snapshot.guestTotal, 'walk-in total is the same');
  near((await call('pharmacy:counterSales', { scope: 'patient' })).totals.total, snapshot.namedTotal, 'under-patient total is the same');
  near((await call('analytics:receivables')).total_due, oracleOutstanding(), 'receivables still equal the oracle after the restore');

  // ------------------------------------------------------------------------------------------------ 9. permissions
  section('9 · who may do what');
  await call('settings:save', { require_login: true, lab_auto_bill: false });
  await call('auth:login', 'admin', 'admin123');
  const mk = async (username: string, role: string) => (await call('auth:createUser', { username, password: 'pass1234', role, display_name: username })).id;
  await mk('rita_r', 'receptionist'); await mk('phil_p', 'pharmacist'); await mk('nina_n', 'nurse');
  const roleOrder1 = await call('lab:createOrder', { patient_id: nobody.id, doctor_id: doc.id, items: [{ lab_test_id: lft.id, test_name: 'LFT' }] });
  const roleOrder2 = await call('lab:createOrder', { patient_id: nobody.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  await call('auth:logout');
  await call('auth:login', 'nina_n', 'pass1234');
  ok((await attempt('billing:createOrderBill', 'lab', roleOrder1.id)).ok === false, 'a nurse cannot bill an order');
  ok((await attempt('pharmacy:clearManualCost', {})).ok === false, 'a nurse cannot clear stock costs');
  await call('auth:logout'); await call('auth:login', 'rita_r', 'pass1234');
  ok((await attempt('pharmacy:clearManualCost', {})).ok === false, 'a receptionist cannot clear stock costs');
  const rBill = await attempt('billing:createOrderBill', 'lab', roleOrder1.id);
  ok(rBill.ok && (rBill.value as any).ok, 'a receptionist can bill an order');
  ok((await attempt('billing:patientPortal', asha.id)).ok, "a receptionist can open a patient's portal");
  await call('auth:logout'); await call('auth:login', 'phil_p', 'pass1234');
  ok((await attempt('pharmacy:clearManualCost', {})).ok, 'a pharmacist can clear stock costs');
  ok((await attempt('billing:createOrderBill', 'lab', roleOrder2.id)).ok === false, 'a pharmacist cannot bill a lab order (that is a desk job)');
  await call('auth:logout');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
