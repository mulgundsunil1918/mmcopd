// "Install 0.9.0 over 0.8.0": a clinic running the previous release (schema v5) has real activity in it — OPD bills,
// a part-paid lab bill, an admitted patient with an advance, pharmacy stock bought on a supplier bill, a sale under a
// patient's name and a walk-in sale. The NEW code opens that file through the app's real startup path (getDb()).
// Checks: a safety copy is taken first, nothing is lost or rewritten, the new billing portal / receivables / counter-sales
// views read the OLD data correctly, and the numbers agree between screens. Synthetic data, temp folder.
import './electron-stub';
import { userData } from './electron-stub';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ok, eq, near, section, finish, note } from './lib';

const file = path.join(userData, 'caredesk.sqlite');
const ids: Record<string, number> = {};

// ---- 1. build the "0.8.0 clinic": current schema stepped back to the v5 shape, with real-looking activity ----
{
  const d = new Database(file);
  d.pragma('journal_mode = WAL'); d.pragma('foreign_keys = ON');
  runMigrations(d);
  for (const i of ['idx_pharmacy_sales_patient', 'idx_pharmacy_sales_created', 'idx_bills_appointment', 'idx_lab_orders_appointment', 'idx_bill_payments_received']) d.exec(`DROP INDEX IF EXISTS ${i}`);
  d.exec('ALTER TABLE pharmacy_sales DROP COLUMN customer_name');
  d.prepare("UPDATE schema_meta SET value='5' WHERE key='version'").run();

  const doc = Number(d.prepare("INSERT INTO doctors (name, specialty, default_fee) VALUES ('Dr. Prev','GP',300)").run().lastInsertRowid);
  const pat = (i: number, first: string) => Number(d.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone) VALUES (?, ?, 'Eighty', '1980-01-01', 'M', ?)").run(`PT-V5-${i}`, first, `9100000${i}`).lastInsertRowid);
  ids.opd = pat(1, 'Opdy'); ids.lab = pat(2, 'Laby'); ids.ipd = pat(3, 'Ipdy'); ids.rx = pat(4, 'Rxy'); ids.oldipd = pat(5, 'Oldipd');

  // OPD: paid at the counter (amount_paid = total, no payment row) — the common case
  const ap = Number(d.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status) VALUES (?, ?, date('now','localtime','-1 day'), '10:00', 1, 'Done')").run(ids.opd, doc).lastInsertRowid);
  d.prepare("INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, total, payment_mode, paid_at, status, amount_paid) VALUES ('V5-OPD-1', ?, ?, '[]', 300, 0, 300, 'UPI', datetime('now','-1 day'), 'paid', 300)").run(ap, ids.opd);
  // an OLD counter bill (before release 0.5.7): paid at the desk — paid_at is set — but amount_paid was never written
  d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, paid_at, status, amount_paid, created_at) VALUES ('V5-LEGACY-1', ?, '[]', 400, 0, 400, 'Cash', datetime('now','-90 day'), 'paid', 0, datetime('now','-90 day'))").run(ids.opd);
  // a visit that was never billed
  ids.unbilledAppt = Number(d.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status) VALUES (?, ?, date('now','localtime'), '11:00', 2, 'Send to Billing')").run(ids.opd, doc).lastInsertRowid);

  // Lab: ₹600 bill, ₹200 taken in an instalment (so a payment row and paid_at both exist), ₹400 still due
  const lb = Number(d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, bill_kind, amount_paid, paid_at) VALUES ('V5-LAB-1', ?, '[]', 600, 0, 600, 'Pending', 'part_paid', 'lab', 'lab', 200, datetime('now','-2 day'))").run(ids.lab).lastInsertRowid);
  d.prepare("INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at) VALUES (?, 200, 'Cash', datetime('now','-2 day'))").run(lb);
  ids.labBill = lb;

  // IPD: running bill ₹5,000, advance ₹3,000 on deposit → ₹2,000 still due
  const adm = Number(d.prepare("INSERT INTO ip_admissions (admission_number, patient_id, status) VALUES ('IP-V5-1', ?, 'admitted')").run(ids.ipd).lastInsertRowid);
  const ib = Number(d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, admission_id) VALUES ('V5-IPD-1', ?, '[]', 5000, 0, 5000, 'Pending', 'open', 'ipd', ?)").run(ids.ipd, adm).lastInsertRowid);
  d.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(ib, adm);
  d.prepare("INSERT INTO advances (patient_id, admission_id, receipt_no, amount, payment_mode) VALUES (?, ?, 'ADV-V5-1', 3000, 'Cash')").run(ids.ipd, adm);

  // An OLD discharged stay (before the advance use was recorded at discharge): bill ₹10,000, ₹2,000 paid in cash, ₹8,000 deposit
  // that covered the rest but was never marked as used. It must read as settled — not as ₹8,000 still owed.
  const oadm = Number(d.prepare("INSERT INTO ip_admissions (admission_number, patient_id, status, discharged_at) VALUES ('IP-V5-OLD', ?, 'discharged', datetime('now','-30 day'))").run(ids.oldipd).lastInsertRowid);
  const ob = Number(d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, admission_id, amount_paid, paid_at, finalized_at, advance_adjusted, created_at) VALUES ('V5-IPD-OLD', ?, '[]', 10000, 0, 10000, 'Cash', 'paid', 'ipd', ?, 2000, datetime('now','-30 day'), datetime('now','-30 day'), 0, datetime('now','-31 day'))").run(ids.oldipd, oadm).lastInsertRowid);
  d.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(ob, oadm);
  d.prepare("INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at) VALUES (?, 2000, 'Cash', datetime('now','-30 day'))").run(ob);
  d.prepare("INSERT INTO advances (patient_id, admission_id, receipt_no, amount, payment_mode, received_at) VALUES (?, ?, 'ADV-V5-OLD', 8000, 'Cash', datetime('now','-31 day'))").run(ids.oldipd, oadm);

  // Pharmacy: supplier bill → batch → a sale under a patient's name (₹900 after ₹100 off) and a walk-in sale (₹300)
  const sup = Number(d.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES ('Prev Supplier','DL-V5')").run().lastInsertRowid);
  const drug = Number(d.prepare("INSERT INTO drug_master (name, schedule, gst_rate, default_mrp) VALUES ('Prev Drug','OTC',12,100)").run().lastInsertRowid);
  const inv = Number(d.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, subtotal, total, payment_status, amount_paid) VALUES ('V5-INV', ?, '2026-09-01', 5000, 5000, 'partial', 2000)").run(sup).lastInsertRowid);
  d.prepare("INSERT INTO purchase_payments (invoice_id, amount, payment_mode, paid_on) VALUES (?, 2000, 'Bank', '2026-09-02')").run(inv);
  const li = Number(d.prepare("INSERT INTO purchase_invoice_items (invoice_id, drug_master_id, batch_no, expiry, qty_received, free_qty, purchase_price, mrp, gst_rate, line_total, unit_cost) VALUES (?, ?, 'PB1', '2030-01-01', 100, 0, 50, 100, 12, 5000, 50)").run(inv, drug).lastInsertRowid);
  const bt = Number(d.prepare("INSERT INTO drug_stock_batches (drug_master_id, purchase_item_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, unit_cost, mrp) VALUES (?, ?, 'PB1', '2030-01-01', 100, 80, 50, 50, 100)").run(drug, li).lastInsertRowid);
  const sale = (n: string, patient: number | null, qty: number, rate: number, disc: number) => {
    const sid = Number(d.prepare("INSERT INTO pharmacy_sales (sale_number, patient_id, subtotal, discount, total, payment_mode, sold_by) VALUES (?, ?, ?, ?, ?, 'Cash', 'desk')").run(n, patient, qty * rate, disc, qty * rate - disc).lastInsertRowid);
    const si = Number(d.prepare("INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, batch_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, 'Prev Drug', ?, ?, ?)").run(sid, drug, bt, qty, rate, qty * rate).lastInsertRowid);
    d.prepare("INSERT INTO dispensing_register (sale_item_id, sale_id, patient_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate, unit_cost) VALUES (?, ?, ?, ?, ?, 'PB1', '2030-01-01', 'OTC', ?, ?, 50)").run(si, sid, patient, drug, bt, qty, rate);
    return sid;
  };
  ids.saleNamed = sale('V5-S1', ids.rx, 10, 100, 100);       // ₹900
  ids.saleGuest = sale('V5-S2', null, 3, 100, 0);            // ₹300
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
}
const before = (() => {
  const d = new Database(file, { readonly: true });
  const c = (t: string) => (d.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  const r = { patients: c('patients'), appointments: c('appointments'), bills: c('bills'), bill_payments: c('bill_payments'), advances: c('advances'), pharmacy_sales: c('pharmacy_sales'), purchase_invoices: c('purchase_invoices'), purchase_payments: c('purchase_payments'), drug_stock_batches: c('drug_stock_batches'), dispensing_register: c('dispensing_register') };
  d.close();
  return r;
})();

(async () => {
  const { boot, call, getDb, closeDb } = await import('./harness');
  section('first start of 0.9.0 on a 0.8.0 database');
  boot();
  const db = getDb();
  const c = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  const snapRoot = path.join(userData, 'backups', 'pre-migration');
  const snaps = fs.existsSync(snapRoot) ? fs.readdirSync(snapRoot) : [];
  eq(snaps.length, 1, 'one safety snapshot was taken before the upgrade');
  ok(/^v5-to-v6-/.test(snaps[0] || ''), `…named for the upgrade it protects (${snaps[0]})`);
  {
    const s = new Database(path.join(snapRoot, snaps[0] || 'x', 'caredesk.sqlite'), { readonly: true });
    eq((s.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '5', 'the snapshot is still the 0.8.0 (v5) database, untouched');
    ok(!(s.prepare('PRAGMA table_info(pharmacy_sales)').all() as any[]).some((x) => x.name === 'customer_name'), '…without the new column (it is a true copy of the old file)');
    s.close();
  }
  eq((db.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '6', 'the live database is now v6');
  ok((db.prepare('PRAGMA table_info(pharmacy_sales)').all() as any[]).some((x) => x.name === 'customer_name'), '…with the guest-name column on pharmacy sales');
  for (const t of Object.keys(before)) eq(c(t), (before as any)[t], `no ${t} rows lost or added by the upgrade`);
  eq((db.prepare("SELECT COUNT(*) c FROM pharmacy_sales WHERE customer_name IS NOT NULL").get() as any).c, 0, 'old sales have no guest name (nothing is invented)');
  eq((db.prepare("SELECT total FROM pharmacy_sales WHERE sale_number='V5-S1'").get() as any).total, 900, 'an old pharmacy sale keeps its amount');

  section('the billing portal reads the 0.8.0 data');
  const opd = await call('billing:patientPortal', ids.opd);
  eq(opd.history.length, 2, 'the OPD patient has two bills');
  near(opd.summary.outstanding, 0, 'nothing is owed on a bill paid at the counter');
  eq((db.prepare("SELECT amount_paid a FROM bills WHERE bill_number='V5-LEGACY-1'").get() as any).a, 400, 'an OLD counter bill whose amount paid was never recorded is repaired to its total (it must not read as unpaid)');
  eq((db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='legacy_bills_amount_paid_repaired'").get() as any).c, 1, '…and the repair is written to the audit log');
  eq((db.prepare("SELECT amount_paid a FROM bills WHERE bill_number='V5-LAB-1'").get() as any).a, 200, 'a part-paid bill is left exactly as it was (₹200 paid)');
  ok(opd.todo.some((t: any) => t.kind === 'consultation_unbilled' && t.appointment_id === ids.unbilledAppt), "…and today's unbilled visit is offered as something that can be billed");
  const lab = await call('billing:patientPortal', ids.lab);
  near(lab.summary.billed, 600, 'lab patient: ₹600 billed');
  near(lab.summary.received, 200, '…₹200 received (the instalment)');
  near(lab.summary.outstanding, 400, '…₹400 still due — a part-paid bill is NOT dropped from what is owed');
  eq(lab.history[0].status, 'part_paid', '…and shown as part-paid');
  const ipd = await call('billing:patientPortal', ids.ipd);
  near(ipd.summary.billed, 5000, 'admitted patient: running bill ₹5,000');
  near(ipd.history[0].advance, 3000, '…the ₹3,000 advance counts towards it');
  near(ipd.summary.outstanding, 2000, '…so ₹2,000 is still due');
  near(ipd.summary.credit_held, 0, '…and none of the advance is spare (it is all being used)');
  ok(ipd.history[0].running, '…flagged as still running');
  const oi = await call('billing:patientPortal', ids.oldipd);
  near(oi.history[0].total, 10000, 'an old discharged stay: bill ₹10,000');
  near(oi.history[0].advance, 8000, '…the ₹8,000 deposit still counts as having paid it (even though old versions never marked it used)');
  near(oi.history[0].due, 0, '…so it is NOT owed');
  near(oi.summary.credit_held, 0, '…and no spare deposit is shown');
  const rx = await call('billing:patientPortal', ids.rx);
  eq(rx.history.length, 1, 'the patient who bought medicines at the counter sees that sale in Billing');
  ok(rx.history[0].counter_sale && rx.history[0].kind === 'pharmacy' && rx.history[0].total === 900 && rx.history[0].status === 'paid', '…₹900, paid, marked as a counter sale');

  section('every screen agrees on what is owed');
  const rec = await call('analytics:receivables');
  near(rec.total_due, 2400, 'receivables: ₹400 (lab) + ₹2,000 (IPD) = ₹2,400');
  eq(rec.bills_due, 2, '…across two bills');
  const ab = await call('analytics:billing', '2000-01-01', '2100-01-01');
  near(ab.outstanding, 2400, 'the IPD & billing analytics shows the same outstanding');
  const ov = await call('analytics:overview');
  near(ov.outstandingTotal, 2400, 'the Analytics overview shows the same');
  const mods = await call('analytics:modules', '2000-01-01', '2100-01-01');
  near(mods.totals.outstanding, 2400, 'the module P&L shows the same');

  section('named and walk-in pharmacy sales');
  const all = await call('pharmacy:counterSales', {});
  near(all.totals.total, 1200, 'counter sales in total: ₹900 + ₹300');
  const named = await call('pharmacy:counterSales', { scope: 'patient' });
  const guest = await call('pharmacy:counterSales', { scope: 'guest' });
  near(named.totals.total, 900, 'under a patient: ₹900');
  near(guest.totals.total, 300, 'walk-ins: ₹300');
  near(named.totals.total + guest.totals.total, all.totals.total, '…and the two add up to the whole');

  section('the new version works on the old stock');
  const drugId = (db.prepare("SELECT id FROM drug_master WHERE name='Prev Drug'").get() as any).id;
  const s1 = await call('pharmacy:sell', { patient_id: null, customer_name: '  Meena  ', items: [{ drug_master_id: drugId, drug_name: 'Prev Drug', qty: 2, rate: 100 }], payment_mode: 'UPI' });
  eq(s1.customer_name, 'Meena', 'a walk-in sale keeps the typed (trimmed) guest name');
  const s2 = await call('pharmacy:sell', { patient_id: ids.rx, customer_name: 'Ignored', items: [{ drug_master_id: drugId, drug_name: 'Prev Drug', qty: 1, rate: 100 }] });
  eq(s2.customer_name, null, 'a sale under a patient never carries a guest name');
  const rx2 = await call('billing:patientPortal', ids.rx);
  eq(rx2.history.length, 2, 'the new sale under the patient appears in that patient\'s Billing');
  const guest2 = await call('pharmacy:counterSales', { scope: 'guest' });
  eq(guest2.rows.length, 2, 'and the walk-in appears in the separate walk-in list');
  ok(guest2.rows.some((r: any) => r.customer_name === 'Meena'), '…with its name');

  section('starting again does not upgrade again');
  closeDb();
  const again = getDb();
  eq(fs.readdirSync(snapRoot).length, 1, 'no second snapshot on the next start');
  eq((again.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '6', 'still v6');
  note(`opening counts: ${JSON.stringify(before)}`);
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
