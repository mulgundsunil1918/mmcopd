// "Install the new version over the old one": a clinic's existing database (schema v4, with patients, bills,
// stock and sales already in it) is opened by the NEW code through the app's real startup path (getDb()).
// Checks that nothing is lost or rewritten, that a safety copy of the old file is taken first, that the
// upgrade happens once, and that the app then works on the old data. Synthetic data, temp folder.
import './electron-stub';
import { userData } from './electron-stub';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ok, eq, section, finish, note } from './lib';

const file = path.join(userData, 'caredesk.sqlite');

// ---- 1. build the "old clinic": current schema, then step it back to the v4 shape and add real-looking rows ----
{
  const d = new Database(file);
  d.pragma('journal_mode = WAL'); d.pragma('foreign_keys = ON');
  runMigrations(d);
  for (const i of ['ux_purchase_client_ref', 'ux_sales_client_ref', 'ux_purchase_payment_ref', 'ux_bill_payment_ref', 'idx_register_batch', 'idx_register_sale_item', 'idx_psi_sale', 'idx_psi_drug',
    'idx_pharmacy_sales_patient', 'idx_pharmacy_sales_created', 'idx_bills_appointment', 'idx_lab_orders_appointment', 'idx_bill_payments_received']) d.exec(`DROP INDEX IF EXISTS ${i}`);
  d.exec('DROP TABLE purchase_payments');
  const v5: Record<string, string[]> = {
    purchase_invoices: ['other_charges', 'round_off', 'amount_paid', 'client_ref', 'gst_in_cost'],
    purchase_invoice_items: ['disc_pct', 'discount_amount', 'taxable_value', 'gst_amount', 'selling_price', 'unit_cost'],
    drug_stock_batches: ['selling_price', 'unit_cost'], dispensing_register: ['unit_cost'],
    pharmacy_sale_items: ['discount_alloc'], pharmacy_sales: ['client_ref', 'customer_name'], bill_payments: ['client_ref'],
  };
  for (const [t, cols] of Object.entries(v5)) for (const c of cols) d.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  d.prepare("UPDATE schema_meta SET value='4' WHERE key='version'").run();

  const doc = Number(d.prepare("INSERT INTO doctors (name, specialty, default_fee) VALUES ('Dr. Old','GP',300)").run().lastInsertRowid);
  const pids = [1, 2, 3].map((i) => Number(d.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone) VALUES (?, ?, 'Legacy', '1980-01-01', 'M', ?)").run(`PT-OLD-${i}`, `Pat${i}`, `90000000${i}`).lastInsertRowid));
  pids.forEach((pid, i) => {
    const ap = Number(d.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status) VALUES (?, ?, '2026-10-01', ?, ?, 'Done')").run(pid, doc, `10:0${i}`, i + 1).lastInsertRowid);
    d.prepare("INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, total, payment_mode, status, amount_paid) VALUES (?, ?, ?, ?, 300, 0, 300, 'Cash', 'paid', 300)").run(`OLD-${i}`, ap, pid, JSON.stringify([{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }]));
  });
  const sup = Number(d.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES ('Old Supplier','DL-OLD')").run().lastInsertRowid);
  const drug = Number(d.prepare("INSERT INTO drug_master (name, schedule, gst_rate, default_mrp) VALUES ('Old Drug','OTC',12,100)").run().lastInsertRowid);
  const inv = Number(d.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, subtotal, total, payment_status) VALUES ('OLD-INV', ?, '2026-09-01', 5000, 5000, 'partial')").run(sup).lastInsertRowid);
  const li = Number(d.prepare("INSERT INTO purchase_invoice_items (invoice_id, drug_master_id, batch_no, expiry, qty_received, free_qty, purchase_price, mrp, gst_rate, line_total) VALUES (?, ?, 'OB1', '2030-01-01', 100, 10, 50, 100, 12, 5000)").run(inv, drug).lastInsertRowid);
  const bt = Number(d.prepare("INSERT INTO drug_stock_batches (drug_master_id, purchase_item_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, mrp) VALUES (?, ?, 'OB1', '2030-01-01', 110, 100, 50, 100)").run(drug, li).lastInsertRowid);
  const sale = Number(d.prepare("INSERT INTO pharmacy_sales (sale_number, subtotal, discount, total, payment_mode) VALUES ('OLD-S1', 1000, 100, 900, 'Cash')").run().lastInsertRowid);
  const si = Number(d.prepare("INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, batch_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, 'Old Drug', 10, 100, 1000)").run(sale, drug, bt).lastInsertRowid);
  d.prepare("INSERT INTO dispensing_register (sale_item_id, sale_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate) VALUES (?, ?, ?, ?, 'OB1', '2030-01-01', 'OTC', 10, 100)").run(si, sale, drug, bt);
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
}
const before = (() => {
  const d = new Database(file, { readonly: true });
  const c = (t: string) => (d.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  const r = { patients: c('patients'), appointments: c('appointments'), bills: c('bills'), pharmacy_sales: c('pharmacy_sales'), purchase_invoices: c('purchase_invoices'), batches: c('drug_stock_batches'), register: c('dispensing_register'), drugs: c('drug_master') };
  const bytes = fs.statSync(file).size;
  d.close();
  return { ...r, bytes };
})();

(async () => {
  // ---- 2. the new app starts on that database (the real getDb(): snapshot → migrate → seed-if-empty) ----
  const { boot, call, getDb, closeDb } = await import('./harness');
  section('first start of the new version on the old database');
  boot();
  const db = getDb();
  const c = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  const snapRoot = path.join(userData, 'backups', 'pre-migration');
  const snaps = fs.existsSync(snapRoot) ? fs.readdirSync(snapRoot) : [];
  eq(snaps.length, 1, 'one safety snapshot was taken before the upgrade');
  ok(/^v4-to-v7-/.test(snaps[0] || ''), `…named for the upgrade it protects (${snaps[0]})`);
  const snapDb = path.join(snapRoot, snaps[0] || 'x', 'caredesk.sqlite');
  ok(fs.existsSync(snapDb), '…containing a copy of the old database file');
  ok(fs.existsSync(path.join(snapRoot, snaps[0] || 'x', 'README.txt')), '…with a README saying how to roll back');
  {
    const s = new Database(snapDb, { readonly: true });
    eq((s.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '4', 'the snapshot is still the OLD (v4) database, untouched');
    eq((s.prepare('SELECT COUNT(*) c FROM patients').get() as any).c, before.patients, 'the snapshot holds all the old patients');
    s.close();
  }
  eq((db.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '7', 'the live database is now v7');
  ok((db.prepare('PRAGMA table_info(pharmacy_sales)').all() as any[]).some((x) => x.name === 'customer_name'), '…with the guest-name column added to pharmacy sales');
  const psCols = (db.prepare('PRAGMA table_info(pharmacy_sales)').all() as any[]).map((x) => x.name);
  ok(psCols.includes('amount_paid') && psCols.includes('on_credit'), '…and the credit columns (amount paid, on credit)');
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pharmacy_sale_payments'").get(), '…and the table that holds payments taken later on credit sales');
  eq((db.prepare('SELECT COUNT(*) c FROM pharmacy_sales WHERE amount_paid IS NOT NULL OR on_credit <> 0').get() as any).c, 0, '…no old sale was turned into a credit sale by the upgrade (every old sale stays paid in full)');
  eq((db.prepare("SELECT COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)), 0) d FROM pharmacy_sales").get() as any).d, 0, '…so an upgraded clinic owes nothing on credit');
  for (const [k, t] of [['patients', 'patients'], ['appointments', 'appointments'], ['bills', 'bills'], ['pharmacy_sales', 'pharmacy_sales'], ['purchase_invoices', 'purchase_invoices'], ['batches', 'drug_stock_batches'], ['register', 'dispensing_register']] as const) {
    eq(c(t), (before as any)[k], `no ${k} rows lost or added by the upgrade`);
  }
  ok(c('drug_master') >= before.drugs, 'the drug list is intact (the starter catalogue is added only to an EMPTY drug list, never to an existing one)');
  eq(db.prepare("SELECT total FROM bills WHERE bill_number='OLD-1'").get() && (db.prepare("SELECT total FROM bills WHERE bill_number='OLD-1'").get() as any).total, 300, 'an old bill keeps its amount');
  eq((db.prepare("SELECT COUNT(*) c FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.bill_number='OLD-1'").get() as any).c, 1, '…and its line (created from the old items_json)');
  note(`old database was ${before.bytes} bytes; nothing was deleted`);
  const guide = await call('setup:status');
  ok(guide.show === false && guide.existing_clinic === true, 'the first-run setup guide is NOT shown to an upgraded clinic that already has data');

  section('the new version works on the old data');
  const patients = await call('patients:search', 'Legacy');
  eq(patients.length, 3, 'the old patients are searchable');
  const old = (await call('purchase:list', {})).find((p: any) => p.invoice_number === 'OLD-INV');
  ok(old && old.outstanding === null, 'an old part-paid supplier bill shows its outstanding as UNKNOWN (never guessed)');
  const p1 = await call('purchase:addPayment', old.id, { amount: 100, opening_paid: 4000 });
  ok(p1.ok && p1.invoice.outstanding === 900, 'entering what was paid before, then a new payment, gives the right balance (₹5,000 − 4,000 − 100)');
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const sale = await call('pharmacy:sell', { patient_id: patients[0].id, items: [{ drug_master_id: (db.prepare("SELECT id FROM drug_master WHERE name='Old Drug'").get() as any).id, drug_name: 'Old Drug', qty: 5, rate: 100 }], discount: 0, payment_mode: 'Cash' });
  ok(sale.id > 0, 'a new pharmacy sale on the old stock works');
  const prof = (await call('analytics:pharmacyProfit', { from: '2026-01-01', to: today })).report;
  const od = prof.drugs.find((x: any) => x.name === 'Old Drug');
  eq(od.revenue, 500 + 900, 'profit report counts the old sale (₹900 after its discount) plus the new one (₹500)');
  ok(od.cogs > 0 && od.margin_pct !== null, '…with a cost for both');
  eq(prof.totals.uncosted_units, 0, 'nothing is left "uncosted"');

  section('starting again does not upgrade again');
  closeDb();
  const again = getDb();
  eq(fs.readdirSync(snapRoot).length, 1, 'no second snapshot on the next start');
  eq((again.prepare('SELECT COUNT(*) c FROM purchase_payments').get() as any).c, 2, 'no duplicate payment rows from the backfill (the one entered above + its opening amount)');
  eq((again.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any).v, '7', 'still v7');
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
