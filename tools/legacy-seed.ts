// Runs INSIDE an old release's source tree (tools/make-legacy-fixture.mjs copies it there and bundles it), so
// `./src/db/migrations` is THAT release's own migration code. It does what a clinic's PC did on updating to that
// release: take the file left by the previous release (if any), let this release's migrations bring it up to date,
// then use the app for a while (patients, visits, bills, lab, ward, pharmacy stock and sales, settings, a login).
// The finished file is written out as a gzip'd SQL script — the "legacy fixture" the current code must open.
//
//   electron-as-node seed.cjs <previous.sql.gz | -> <scratch.sqlite> <label> <out.sql.gz>
import Database from 'better-sqlite3';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { runMigrations } from './src/db/migrations';

const [, , prev, scratch, label, outSql] = process.argv;
for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);

const db = new Database(scratch);
db.pragma('journal_mode = WAL');
if (prev && prev !== '-') {
  db.pragma('foreign_keys = OFF');
  db.exec(zlib.gunzipSync(fs.readFileSync(prev)).toString('utf8'));
}
db.pragma('foreign_keys = ON');
runMigrations(db);                                   // this release's own upgrade path, exactly as its installer would run it

// ---- generic, version-agnostic inserts: only columns that exist in THIS release's table are written ----
type Row = Record<string, any>;
const log: string[] = [];
function ins(table: string, values: Row): number | null {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.length) { log.push(`  – ${table}: not in this release`); return null; }
  const have = new Set(cols.map((c) => c.name));
  const row: Row = {};
  for (const [k, v] of Object.entries(values)) if (have.has(k)) row[k] = v;
  for (const c of cols) {                            // a required column this seed did not think of: fill it neutrally
    if (c.notnull && c.dflt_value === null && !c.pk && !(c.name in row)) row[c.name] = /INT|REAL|NUM|BOOL|DOUBLE|FLOAT/i.test(c.type) ? 0 : '';
  }
  const k = Object.keys(row);
  try {
    const info = db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x]));
    return Number(info.lastInsertRowid);
  } catch (e: any) {
    log.push(`  ! ${table}: ${String(e.message).slice(0, 100)}`);
    return null;
  }
}
const one = (sql: string, ...p: any[]) => { try { return db.prepare(sql).get(...p) as any; } catch { return undefined; } };

const L = label.replace(/[^0-9a-z]/gi, '').toLowerCase();                  // "v0.9.2" → "v092"
const n = (i: number, w = 4) => String(i).padStart(w, '0');

// people: one doctor, two patients, a visit each, a bill each (one paid, one part-paid)
const doc = ins('doctors', { name: `Dr. Legacy ${L}`, specialty: 'General', default_fee: 300, qualifications: 'MBBS', registration_no: `REG-${L}`, is_active: 1 });
const pats = [1, 2].map((i) => ins('patients', {
  uhid: `LEG-${L}-${i}`, first_name: `Pat${L}x${i}`, last_name: 'Legacy', dob: `1984-03-0${i}`, gender: i === 1 ? 'F' : 'M',
  phone: `9${String(L.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0) % 1000).padStart(3, '0')}00000${i}`.slice(0, 10), age: 40 + i, place: 'Mulgund', address: 'Old Market Road', blood_group: 'B+',
}));
const appts = pats.map((p, i) => ins('appointments', {
  patient_id: p, doctor_id: doc, appointment_date: `2026-04-0${i + 1}`, appointment_time: `1${i}:30`, status: 'completed', fee: 300 + i * 100,
  chief_complaint: 'fever and cough', notes: `legacy visit ${L}`, token_number: i + 1,
}));
const bills = pats.map((p, i) => ins('bills', {
  bill_number: `LEG-${L}-B${i + 1}`, appointment_id: appts[i], patient_id: p, bill_type: 'opd', bill_kind: 'consultation',
  items_json: JSON.stringify([{ description: 'OPD Consultation', qty: 1, rate: 300 + i * 100, amount: 300 + i * 100 }]),
  subtotal: 300 + i * 100, discount: 0, total: 300 + i * 100, payment_mode: i === 0 ? 'Cash' : 'Pending', status: i === 0 ? 'paid' : 'part_paid',
  amount_paid: i === 0 ? 300 : 150, notes: `legacy bill ${L}`,
  paid_at: i === 0 ? '2026-04-01T10:00:00.000Z' : null,       // every release stamped a settled bill with paid_at; a pending one had none
}));
bills.forEach((b, i) => { if (b) ins('bill_payments', { bill_id: b, amount: i === 0 ? 300 : 150, payment_mode: 'Cash' }); });

// laboratory
const test = ins('lab_tests', { name: `Legacy CBC ${L}`, price: 250, category: 'pathology', unit: '', is_active: 1 });
const order = ins('lab_orders', { order_number: `LEG-${L}-LAB1`, patient_id: pats[0], doctor_id: doc, status: 'ordered', total: 250 });
if (order && test) ins('lab_order_items', { lab_order_id: order, lab_test_id: test, test_name: `Legacy CBC ${L}`, price: 250, result: '12.5', unit: 'g/dL' });

// ward: one admission with a running bill
const bed = one('SELECT id FROM ip_beds ORDER BY id LIMIT 1');
const adm = ins('ip_admissions', { admission_number: `LEG-${L}-IP1`, patient_id: pats[1], bed_id: bed?.id ?? null, status: 'admitted', admitting_doctor_id: doc, diagnosis: 'legacy stay' });
if (adm) {
  const ib = ins('bills', { bill_number: `LEG-${L}-IPD1`, patient_id: pats[1], bill_type: 'ipd', admission_id: adm, items_json: '[]', subtotal: 0, discount: 0, total: 0, payment_mode: 'Pending', status: 'open' });
  if (ib) { try { db.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(ib, adm); } catch { /* older shape */ } }
}

// pharmacy: a drug, a supplier, a purchase bill → stock → a counter sale
const drug = ins('drug_master', { name: `Legacy Drug ${L}`, schedule: 'OTC', gst_rate: 12, default_mrp: 100, form: 'Tablet', strength: '500mg', is_active: 1 });
const sup = ins('wholesalers', { name: `Legacy Supplier ${L}`, drug_license_no: `DL-${L}`, is_active: 1 });
const inv = ins('purchase_invoices', { invoice_number: `LEG-${L}-INV`, wholesaler_id: sup, invoice_date: '2026-04-05', subtotal: 5000, total: 5000, payment_status: 'paid', amount_paid: 5000 });
const pit = ins('purchase_invoice_items', { invoice_id: inv, drug_master_id: drug, batch_no: `PB-${L}`, expiry: '2030-01-01', qty_received: 100, free_qty: 0, purchase_price: 50, mrp: 100, gst_rate: 12, line_total: 5000, unit_cost: 50 });
const bat = ins('drug_stock_batches', { drug_master_id: drug, purchase_item_id: pit, batch_no: `PB-${L}`, expiry: '2030-01-01', qty_received: 100, qty_remaining: 90, purchase_price: 50, unit_cost: 50, mrp: 100, is_active: 1 });
const sale = ins('pharmacy_sales', { sale_number: `LEG-${L}-S1`, patient_id: pats[0], subtotal: 1000, discount: 0, total: 1000, payment_mode: 'Cash', sold_by: 'desk' });
const sitem = ins('pharmacy_sale_items', { sale_id: sale, drug_master_id: drug, batch_id: bat, drug_name: `Legacy Drug ${L}`, qty: 10, rate: 100, amount: 1000 });
if (sale && sitem) ins('dispensing_register', { sale_item_id: sitem, sale_id: sale, patient_id: pats[0], drug_master_id: drug, batch_id: bat, batch_no: `PB-${L}`, expiry: '2030-01-01', schedule: 'OTC', qty: 10, rate: 100, unit_cost: 50 });

// settings the clinic had customised, and a login someone created
for (const [k, v] of [['clinic_name', `Legacy Clinic ${L}`], ['clinic_phone', '9000011111'], [`legacy_marker_${L}`, 'kept']]) {
  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); } catch (e: any) { log.push(`  ! settings: ${String(e.message).slice(0, 80)}`); }
}
ins('users', { username: `legacy_${L}`, password_hash: `not-a-real-hash-${L}`, role: 'staff', full_name: `Legacy Staff ${L}`, is_active: 1 });

const violations = (db.prepare('PRAGMA foreign_key_check').all() as any[]).length;
console.log(`[${label}] schema v${one("SELECT value v FROM schema_meta WHERE key='version'")?.v ?? '?'} · foreign-key violations: ${violations}`);
for (const l of log) console.log(l);

// ---- write the finished file out as a SQL script (tables, then rows, then indexes/triggers/views) ----
const lit = (v: any): string => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL')
  : typeof v === 'bigint' ? v.toString()
  : Buffer.isBuffer(v) ? `X'${v.toString('hex')}'`
  : `'${String(v).replace(/'/g, "''")}'`;
const master = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as any[];
const out: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN;'];
for (const m of master.filter((x) => x.type === 'table')) out.push(`${m.sql};`);
for (const m of master.filter((x) => x.type === 'table')) {
  for (const r of db.prepare(`SELECT * FROM "${m.name}"`).iterate() as Iterable<Row>) {
    const cols = Object.keys(r);
    out.push(`INSERT INTO "${m.name}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((c) => lit(r[c])).join(',')});`);
  }
}
try { for (const r of db.prepare('SELECT name, seq FROM sqlite_sequence').all() as any[]) out.push(`DELETE FROM sqlite_sequence WHERE name=${lit(r.name)};`, `INSERT INTO sqlite_sequence (name, seq) VALUES (${lit(r.name)}, ${r.seq});`); } catch { /* no AUTOINCREMENT tables */ }
for (const m of master.filter((x) => x.type !== 'table')) out.push(`${m.sql};`);
out.push('COMMIT;');
fs.writeFileSync(outSql, zlib.gzipSync(Buffer.from(out.join('\n'), 'utf8'), { level: 9 }));
db.close();
console.log(`[${label}] wrote ${outSql} (${(fs.statSync(outSql).size / 1024).toFixed(0)} KB)`);
