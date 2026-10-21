// "Install 0.9.1 over 0.9.0": a clinic running the previous release (schema v6) has real activity in it — a part-paid
// lab bill, an admitted patient, pharmacy stock bought on a supplier bill, a sale under a patient's name, a walk-in sale
// and a medicine given on a ward. The NEW code opens that file through the app's real startup path (getDb()).
// Checks: a safety copy is taken first, nothing is lost or rewritten, every old sale stays "paid in full" (no old sale
// becomes a debt), the clinic owes nothing on credit, and then the new features work ON the old data: the switches are
// off until the clinic turns them on; once on, a credit sale, a later payment and an in-patient charge all behave, and
// every screen agrees. Synthetic data, temp folder.
import './electron-stub';
import { userData } from './electron-stub';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ok, eq, near, section, finish } from './lib';

const file = path.join(userData, 'caredesk.sqlite');
const ids: Record<string, number> = {};

// ---- 1. build the "0.9.0 clinic": current schema stepped back to the v6 shape, with real-looking activity ----
{
  const d = new Database(file);
  d.pragma('journal_mode = WAL'); d.pragma('foreign_keys = ON');
  runMigrations(d);
  // v7 (medicines on credit) added an index, two columns and a payments table; 0.9.0 had none of them
  d.exec('DROP INDEX IF EXISTS idx_pharmacy_sales_credit; DROP TABLE IF EXISTS pharmacy_sale_payments;');
  d.exec('ALTER TABLE pharmacy_sales DROP COLUMN amount_paid; ALTER TABLE pharmacy_sales DROP COLUMN on_credit;');
  d.prepare("UPDATE schema_meta SET value='6' WHERE key='version'").run();

  const doc = Number(d.prepare("INSERT INTO doctors (name, specialty, default_fee) VALUES ('Dr. Prev','GP',300)").run().lastInsertRowid);
  const pat = (i: number, first: string) => Number(d.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone) VALUES (?, ?, 'Ninety', '1980-01-01', 'M', ?)").run(`PT-V6-${i}`, first, `9200000${i}`).lastInsertRowid);
  ids.rx = pat(1, 'Rxy'); ids.lab = pat(2, 'Laby'); ids.ipd = pat(3, 'Ipdy'); ids.late = pat(4, 'Latey');

  // Lab: ₹600 bill, ₹200 taken, ₹400 still due
  const lb = Number(d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, bill_kind, amount_paid, paid_at) VALUES ('V6-LAB-1', ?, '[]', 600, 0, 600, 'Pending', 'part_paid', 'lab', 'lab', 200, datetime('now','-2 day'))").run(ids.lab).lastInsertRowid);
  d.prepare("INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at) VALUES (?, 200, 'Cash', datetime('now','-2 day'))").run(lb);
  // a hand-typed pharmacy bill, unpaid ₹250 (a 0.9.0 clinic had these in "Other")
  d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, bill_kind, amount_paid, notes) VALUES ('V6-MAN-1', NULL, '[]', 250, 0, 250, 'Pending', 'open', 'pharmacy', 'custom', 0, 'Name: Old Walkin')").run();

  // an admitted patient with a running bill (₹1,000) and a ward-dispensed medicine already on it
  const adm = Number(d.prepare("INSERT INTO ip_admissions (admission_number, patient_id, status) VALUES ('IP-V6-1', ?, 'admitted')").run(ids.ipd).lastInsertRowid);
  const ib = Number(d.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, discount, total, payment_mode, status, bill_type, admission_id) VALUES ('V6-IPD-1', ?, '[]', 1000, 0, 1000, 'Pending', 'open', 'ipd', ?)").run(ids.ipd, adm).lastInsertRowid);
  d.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(ib, adm);
  // an in-patient bill's total is the sum of its lines: bed ₹800 + the ward medicine ₹200
  d.prepare("INSERT INTO bill_items (bill_id, description, qty, rate, amount, source) VALUES (?, 'Bed charge', 1, 800, 800, 'bed')").run(ib);
  d.prepare("INSERT INTO bill_items (bill_id, description, qty, rate, amount, source) VALUES (?, 'Prev Drug x 2', 2, 100, 200, 'ipd_medication')").run(ib);
  ids.adm = adm;

  const sup = Number(d.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES ('Prev Supplier','DL-V6')").run().lastInsertRowid);
  const drug = Number(d.prepare("INSERT INTO drug_master (name, schedule, gst_rate, default_mrp) VALUES ('Prev Drug','OTC',0,100)").run().lastInsertRowid);
  ids.drug = drug;
  const inv = Number(d.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, subtotal, total, payment_status, amount_paid) VALUES ('V6-INV', ?, '2026-09-01', 5000, 5000, 'paid', 5000)").run(sup).lastInsertRowid);
  const li = Number(d.prepare("INSERT INTO purchase_invoice_items (invoice_id, drug_master_id, batch_no, expiry, qty_received, free_qty, purchase_price, mrp, gst_rate, line_total, unit_cost) VALUES (?, ?, 'PB1', '2030-01-01', 100, 0, 50, 100, 0, 5000, 50)").run(inv, drug).lastInsertRowid);
  const bt = Number(d.prepare("INSERT INTO drug_stock_batches (drug_master_id, purchase_item_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, unit_cost, mrp) VALUES (?, ?, 'PB1', '2030-01-01', 100, 80, 50, 50, 100)").run(drug, li).lastInsertRowid);
  const sale = (n: string, patient: number | null, qty: number, mode: string) => {
    const sid = Number(d.prepare("INSERT INTO pharmacy_sales (sale_number, patient_id, subtotal, discount, total, payment_mode, sold_by) VALUES (?, ?, ?, 0, ?, ?, 'desk')").run(n, patient, qty * 100, qty * 100, mode).lastInsertRowid);
    const si = Number(d.prepare("INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, batch_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, 'Prev Drug', ?, 100, ?)").run(sid, drug, bt, qty, qty * 100).lastInsertRowid);
    d.prepare("INSERT INTO dispensing_register (sale_item_id, sale_id, patient_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate, unit_cost) VALUES (?, ?, ?, ?, ?, 'PB1', '2030-01-01', 'OTC', ?, 100, 50)").run(si, sid, patient, drug, bt, qty);
    return sid;
  };
  ids.saleNamed = sale('V6-S1', ids.rx, 10, 'Cash');        // ₹1,000
  ids.saleGuest = sale('V6-S2', null, 3, 'UPI');            // ₹300
  ids.saleWard = sale('V6-S3', ids.ipd, 2, 'IPD-bill');     // ₹200, on the in-patient bill
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
}
const before = (() => {
  const d = new Database(file, { readonly: true });
  const c = (t: string) => (d.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  const r = { patients: c('patients'), bills: c('bills'), bill_payments: c('bill_payments'), pharmacy_sales: c('pharmacy_sales'), pharmacy_sale_items: c('pharmacy_sale_items'), drug_stock_batches: c('drug_stock_batches'), dispensing_register: c('dispensing_register'), ip_admissions: c('ip_admissions') };
  const sums = d.prepare('SELECT SUM(total) t, SUM(subtotal) s FROM pharmacy_sales').get() as any;
  d.close();
  return { ...r, saleTotals: sums.t as number };
})();

(async () => {
  const { boot, call, attempt, getDb, closeDb } = await import('./harness');
  section('first start of 0.9.1 on a 0.9.0 database');
  boot();
  const db = getDb();
  const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  const c = (t: string) => one(`SELECT COUNT(*) c FROM ${t}`).c;
  const snapRoot = path.join(userData, 'backups', 'pre-migration');
  const snaps = fs.existsSync(snapRoot) ? fs.readdirSync(snapRoot) : [];
  eq(snaps.length, 1, 'one safety snapshot was taken before the upgrade');
  ok(/^v6-to-v8-/.test(snaps[0] || ''), `…named for the upgrade it protects (${snaps[0]})`);
  {
    const s = new Database(path.join(snapRoot, snaps[0] || 'x', 'caredesk.sqlite'), { readonly: true });
    eq((s.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '6', 'the snapshot is still the 0.9.0 (v6) database, untouched');
    ok(!(s.prepare('PRAGMA table_info(pharmacy_sales)').all() as any[]).some((x) => x.name === 'on_credit'), '…without the new credit columns (a true copy of the old file)');
    s.close();
  }
  eq(one("SELECT value v FROM schema_meta WHERE key='version'").v, '8', 'the live database is now v8');
  const cols = (q('PRAGMA table_info(pharmacy_sales)') as any[]).map((x) => x.name);
  ok(cols.includes('amount_paid') && cols.includes('on_credit'), '…with the credit columns on pharmacy sales');
  ok(!!one("SELECT 1 FROM sqlite_master WHERE name='pharmacy_sale_payments'"), '…and the table for payments taken later');
  for (const t of Object.keys(before).filter((k) => k !== 'saleTotals')) eq(c(t), (before as any)[t], `no ${t} rows lost or added by the upgrade`);
  near(one('SELECT SUM(total) t FROM pharmacy_sales').t, before.saleTotals, 'the old sales keep exactly the same amounts');
  eq(one('SELECT COUNT(*) c FROM pharmacy_sales WHERE amount_paid IS NOT NULL OR on_credit <> 0').c, 0, 'no old sale was turned into a credit sale — every one stays paid in full');
  eq(one('SELECT COUNT(*) c FROM pharmacy_sale_payments').c, 0, '…and there are no credit payments');
  const st = await call('settings:get');
  eq(st.pharmacy_credit_enabled, false, 'medicines on credit is OFF for an upgraded clinic until they choose it');
  eq(st.pharmacy_ipd_charge_enabled, false, 'charging an in-patient bill is OFF too');
  const guide = await call('setup:status');
  ok(guide.show === false && guide.existing_clinic === true, 'the first-run setup guide is NOT shown to an upgraded clinic that already has data');

  section('the old data reads the same in the new version');
  const owedBills = 400 + 250 + 1000;           // lab ₹400, hand-typed ₹250, in-patient bill ₹1,000 (no deposit)
  let rec = await call('analytics:receivables');
  near(rec.total_due, owedBills, `the clinic owes ₹${owedBills} on bills, exactly as before — and nothing on credit`);
  near(rec.by_kind.find((k: any) => k.kind === 'pharmacy_manual')?.due, 250, 'the old hand-typed pharmacy bill is recognised as such (₹250 unpaid)');
  const sold = await call('pharmacy:counterSales', {});
  eq(sold.totals.count, 2, 'counter sales: the two old counter sales (the ward one is on the in-patient bill)');
  near(sold.totals.total, 1300, '…₹1,300');
  eq(sold.totals.credit_count, 0, '…none on credit');
  near(sold.totals.credit_due, 0, '…and nothing owed on them');
  const rxPortal = await call('billing:patientPortal', ids.rx);
  near(rxPortal.summary.outstanding, 0, "the patient who bought medicines has nothing to pay (their old sale was paid in full)");
  eq((await call('pharmacy:saleDetail', ids.saleNamed)).due, 0, 'the old sale\'s receipt data says ₹0 due');
  const mp = await call('analytics:manualPharmacy', '2000-01-01', '2100-01-01');
  eq(mp.bills, 1, 'the hand-typed analysis finds the old hand-typed bill');
  near(mp.owed_now, 250, '…₹250 unpaid');
  const checks = await call('analytics:pharmacyChecks');
  ok(!checks.some((x: any) => /^credit_/.test(x.code)), 'the pharmacy health checks are clean after the upgrade');

  section('the new features work on the old data');
  const attemptEarly = await attempt('pharmacy:sell', { patient_id: ids.rx, items: [{ drug_master_id: ids.drug, drug_name: 'Prev Drug', qty: 1, rate: 100 }], credit: true, paid_now: 0, client_ref: 'late-0' });
  ok(!attemptEarly.ok && /switched off/i.test((attemptEarly as any).error), 'credit is refused while the switch is off');
  await call('settings:save', { pharmacy_credit_enabled: true, pharmacy_ipd_charge_enabled: true });
  const cs = await call('pharmacy:sell', { patient_id: ids.rx, items: [{ drug_master_id: ids.drug, drug_name: 'Prev Drug', qty: 4, rate: 100 }], credit: true, paid_now: 150, payment_mode: 'Cash', client_ref: 'late-1' });
  eq(cs.on_credit, 1, 'once switched on, a credit sale works on the old stock');
  near(cs.total - cs.amount_paid, 250, '…₹400 − ₹150 = ₹250 owed');
  const reg = q('SELECT unit_cost FROM dispensing_register WHERE sale_id=?', cs.id);
  ok(reg.length === 1 && reg[0].unit_cost === 50, '…and the old batch\'s cost (₹50) is frozen on it, as for any sale');
  const pay = await call('pharmacy:payCredit', cs.id, { amount: 100, mode: 'UPI', client_ref: 'late-p1' });
  ok(pay.ok && pay.due === 150, 'a later payment of ₹100 leaves ₹150');
  rec = await call('analytics:receivables');
  near(rec.total_due, owedBills + 150, 'Receivables = the old ₹1,650 + the ₹150 credit still owed');
  near((await call('billing:patientPortal', ids.rx)).summary.outstanding, 150, "the patient's portal agrees: ₹150");
  const ward = await call('pharmacy:sell', { patient_id: ids.ipd, ipd_admission_id: ids.adm, items: [{ drug_master_id: ids.drug, drug_name: 'Prev Drug', qty: 1, rate: 100 }], client_ref: 'late-2' });
  eq(ward.payment_mode, 'IPD-bill', 'a medicine can be charged to the old running in-patient bill');
  near((await call('bill:previewAdmission', ids.adm)).totals.total, 1100, '…which grew from ₹1,000 to ₹1,100');
  near((await call('analytics:receivables')).total_due, owedBills + 150 + 100, '…and Receivables follows (+₹100)');

  section('starting again does not upgrade again');
  closeDb();
  const again = getDb();
  eq(fs.readdirSync(snapRoot).length, 1, 'no second snapshot on the next start');
  eq((again.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '8', 'still v8');
  eq((again.prepare('SELECT COUNT(*) c FROM pharmacy_sale_payments').get() as any).c, 1, 'the one credit payment is still there, once');
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
