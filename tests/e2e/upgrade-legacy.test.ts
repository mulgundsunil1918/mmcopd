// "A clinic updates from ANY earlier release and keeps everything it had."
//
// tests/e2e/legacy-fixtures/*.sql.gz are real database files as each past release left them — built by tools/make-legacy-fixture.mjs
// with THAT release's own code (taken from git history), each one on top of the previous release's file, then "used" for a while:
// patients, visits, bills (one paid, one part-paid), a lab order, an admitted patient, pharmacy stock bought and sold, settings and a login.
// This suite opens one fixture (LEGACY_FIXTURE, set by run.mjs) with the CURRENT code through the app's real startup path and checks:
//   - a safety copy of the old file is taken first, and it is a true copy;
//   - not one table, column or value the clinic had is lost or rewritten (every old row is compared cell by cell);
//   - the file is healthy afterwards (integrity, foreign keys) and the version is current — and opening it again changes nothing;
//   - the old data reads correctly through the real handlers (patients, visits, bills, lab, stock, settings);
//   - what was paid stays paid, what was owed stays owed;
//   - an updated clinic is NOT shown the first-run setup guide;
//   - and day-to-day work carries on from where the old data left off (new patient, visit, bill — numbering continues, nothing collides).
import './electron-stub';
import { userData } from './electron-stub';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../../src/db/schema';
import { ok, eq, near, section, finish, note } from './lib';

const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const dir = path.join(root, 'tests', 'e2e', 'legacy-fixtures');
const available = fs.readdirSync(dir).filter((f) => f.endsWith('.sql.gz')).map((f) => f.replace(/\.sql\.gz$/, ''));
const name = process.env.LEGACY_FIXTURE || 'v0.9.3';
if (!available.includes(name)) { console.error(`no fixture "${name}" in ${dir} (have: ${available.join(', ')})`); process.exit(2); }

/**
 * The few values a migration is DESIGNED to touch on an existing row, each with the exact rule it must obey ("table.column").
 * Everything not listed here must come through byte-for-byte identical.
 */
const COMPATIBLE_CHANGES: Record<string, (before: any, after: any, row: Record<string, any>) => boolean> = {
  // Numbering counters are raised to cover numbers already issued (never lowered) and stamped with the time.
  'counters.updated_at': () => true,
  'counters.next_value': (b, a) => Number(a) >= Number(b),
  // A bill paid at the desk in the early releases was stamped paid (paid_at) but its amount_paid was left at 0. The v6 repair sets it to
  // the bill's total so the bill stays "paid" instead of reading as owed (migrations.ts, "One-time repair of old counter bills").
  'bills.amount_paid': (b, a, row) => Number(b) === 0 && row.paid_at != null && Number(a) === Number(row.total),
  // New default OPD-slip templates are APPENDED; the clinic's own templates must stay exactly as they were.
  'settings.value': (b, a, row) => {
    if (row.key !== 'slip_templates') return false;
    try {
      const B = JSON.parse(b) as Array<{ id: number }>, A = JSON.parse(a) as Array<{ id: number }>;
      return B.every((t) => JSON.stringify(A.find((x) => x.id === t.id)) === JSON.stringify(t));
    } catch { return false; }
  },
};

type Snap = Record<string, { cols: string[]; rows: Map<number, Record<string, any>> }>;
function snapshot(d: Database.Database): Snap {
  const s: Snap = {};
  for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]) {
    const cols = (d.prepare(`PRAGMA table_info("${t.name}")`).all() as any[]).map((c) => c.name as string);
    const rows = new Map<number, Record<string, any>>();
    for (const r of d.prepare(`SELECT rowid AS __rid, * FROM "${t.name}"`).all() as any[]) rows.set(r.__rid, r);
    s[t.name] = { cols, rows };
  }
  return s;
}
const same = (a: any, b: any) => (Buffer.isBuffer(a) && Buffer.isBuffer(b) ? a.equals(b) : a === b);

// ---- 1. the old clinic's file, exactly as that release left it ----
const file = path.join(userData, 'caredesk.sqlite');
const label = name.replace(/[^0-9a-z]/gi, '').toLowerCase();
{
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.exec(zlib.gunzipSync(fs.readFileSync(path.join(dir, `${name}.sql.gz`))).toString('utf8'));
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
}
const old = new Database(file, { readonly: true });
const before = snapshot(old);
const versionBefore = Number((old.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any)?.v ?? 0);
const fkBefore = (old.prepare('PRAGMA foreign_key_check').all() as any[]).length;
old.close();

(async () => {
  const { boot, call, attempt, getDb, closeDb } = await import('./harness');
  section(`first start of the current version on a ${name} database (schema v${versionBefore})`);
  boot();                                                       // the real startup path: safety copy, then migrations
  const db = getDb();
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

  // ---- 2. a safety copy first, and a true one ----
  const snapRoot = path.join(userData, 'backups', 'pre-migration');
  const snaps = fs.existsSync(snapRoot) ? fs.readdirSync(snapRoot) : [];
  if (versionBefore < SCHEMA_VERSION) {
    eq(snaps.length, 1, 'one safety copy was taken before the upgrade');
    ok(new RegExp(`^v${versionBefore}-to-v${SCHEMA_VERSION}-`).test(snaps[0] || ''), `…named for the upgrade it protects (${snaps[0]})`);
    const s = new Database(path.join(snapRoot, snaps[0] || 'x', 'caredesk.sqlite'), { readonly: true });
    const copy = snapshot(s);
    s.close();
    const same_ = Object.keys(before).every((t) => copy[t] && copy[t].rows.size === before[t].rows.size);
    ok(same_, '…and it holds every table with the same number of rows as the old file (a true copy)');
  }

  // ---- 3. nothing the clinic had is lost or rewritten ----
  section('nothing from the old file is lost or changed');
  eq(Number(one("SELECT value v FROM schema_meta WHERE key='version'").v), SCHEMA_VERSION, `the file is now at the current schema (v${SCHEMA_VERSION})`);
  const after = snapshot(db);
  const lost: string[] = [];
  const changed: string[] = [];
  let rowsChecked = 0, cellsChecked = 0, tolerated = 0;
  for (const [t, b] of Object.entries(before)) {
    if (t === 'schema_meta') continue;                          // the version stamp itself is meant to change
    const a = after[t];
    if (!a) { lost.push(`table ${t} is gone`); continue; }
    if (a.rows.size < b.rows.size) lost.push(`${t}: ${b.rows.size} rows before, ${a.rows.size} now`);
    for (const c of b.cols) if (!a.cols.includes(c)) lost.push(`${t}.${c}: column removed`);
    for (const [rid, br] of b.rows) {
      const ar = a.rows.get(rid);
      rowsChecked++;
      if (!ar) { lost.push(`${t} row ${rid} is gone`); continue; }
      for (const c of b.cols) {
        if (c === '__rid' || !a.cols.includes(c)) continue;
        cellsChecked++;
        if (br[c] === null || same(br[c], ar[c])) continue;
        const rule = COMPATIBLE_CHANGES[`${t}.${c}`];
        if (rule && rule(br[c], ar[c], br)) { tolerated++; continue; }
        changed.push(`${t}#${rid}.${c}: ${JSON.stringify(br[c]).slice(0, 60)} → ${JSON.stringify(ar[c]).slice(0, 60)}`);
      }
    }
  }
  note(`${Object.keys(before).length} tables, ${rowsChecked} rows, ${cellsChecked} values compared${tolerated ? ` — ${tolerated} changed only in the permitted ways (counters raised, default slip templates appended, old desk-paid bills marked paid in full)` : ''}`);
  ok(lost.length === 0, `no table, column or row was lost${lost.length ? `: ${lost.slice(0, 8).join('; ')}` : ''}`);
  ok(changed.length === 0, `no existing value was rewritten${changed.length ? `: ${changed.slice(0, 8).join('; ')}` : ''}`);
  eq(one('PRAGMA integrity_check')['integrity_check'], 'ok', 'the database passes the integrity check');
  ok((q('PRAGMA foreign_key_check') as any[]).length <= fkBefore, 'no broken links between records were introduced');

  // ---- 4. the old data reads right through the real handlers ----
  section('the old data reads correctly in the new version');
  const st = await call('settings:get');
  eq(st.clinic_name, `Legacy Clinic ${label}`, "the clinic's own name and settings survived");
  const legacyPats = q("SELECT id, uhid, first_name, phone FROM patients WHERE last_name='Legacy' ORDER BY id");
  ok(legacyPats.length >= 2, `the old patients are there (${legacyPats.length})`);
  let found = 0;
  for (const p of legacyPats) if ((await call('patients:search', p.phone)).some((x: any) => x.id === p.id)) found++;
  eq(found, legacyPats.length, 'every old patient can be found by phone number');
  const docs = await call('doctors:list');
  ok(docs.some((x: any) => x.name === `Dr. Legacy ${label}`), 'the old doctors are listed');
  const legacyBills = q("SELECT id, bill_number, total, patient_id FROM bills WHERE bill_number LIKE 'LEG-%' AND bill_number NOT LIKE '%-IPD%' ORDER BY id");
  const listed = await call('bills:list', {});
  let billsOk = 0;
  for (const b of legacyBills) if (listed.some((x: any) => x.id === b.id && x.bill_number === b.bill_number)) billsOk++;
  eq(billsOk, legacyBills.length, `every old bill is in Billing History (${legacyBills.length})`);
  let readable = 0;
  for (const b of legacyBills) { const r = await attempt('bills:get', b.id); if (r.ok && r.value && Number((r.value as any).total) === Number(b.total)) readable++; }
  eq(readable, legacyBills.length, 'every old bill opens and shows the same total, so it can be printed again');
  const drug = one("SELECT id FROM drug_master WHERE name LIKE 'Legacy Drug %' ORDER BY id DESC");
  if (drug) {
    const batches = await call('pharmacy:listBatches', drug.id);
    ok(batches.length >= 1 && batches.every((x: any) => Number(x.qty_remaining) === 90), 'the old pharmacy stock is intact (90 left of 100)');
    ok((await call('pharmacy:listDrugs', { activeOnly: false })).some((x: any) => x.id === drug.id), 'the old drugs are in the Drug Master');
  } else note('this release had no pharmacy yet');

  // ---- 5. what was paid stays paid ----
  section('what was paid stays paid, what was owed stays owed');
  const paidPat = legacyPats[0];
  const portal = await call('billing:patientPortal', paidPat.id);
  near(portal.summary.outstanding, 0, 'the patient whose bill and medicine sale were paid in full still owes nothing');
  const rec = await call('analytics:receivables');
  ok(rec.total_due >= 0, `the clinic's "still owed" total reads normally (₹${rec.total_due})`);

  // ---- 6. an updated clinic is not shown the first-run guide ----
  const guide = await call('setup:status');
  ok(guide.show === false, 'the first-run setup guide is NOT shown to a clinic that already has data');

  // ---- 7. day-to-day work carries on from the old data ----
  section('work carries on from where the old data left off');
  const doc = docs.find((x: any) => x.name === `Dr. Legacy ${label}`) || docs[0];
  const oldUhids = new Set(q('SELECT uhid FROM patients').map((r) => r.uhid));
  const oldBillNos = new Set(q('SELECT bill_number FROM bills').map((r) => r.bill_number));
  const np = await call('patients:create', { first_name: 'Newly', last_name: 'Arrived', dob: '1990-01-01', gender: 'M', phone: '9777700001' });
  ok(!!np.uhid && !oldUhids.has(np.uhid), `a new patient gets a fresh UHID that collides with none of the old ones (${np.uhid})`);
  const today = new Date().toLocaleDateString('en-CA');
  const ap = await call('appointments:create', { patient_id: np.id, doctor_id: doc.id, appointment_date: today, appointment_time: '09:00' });
  ok(!!ap?.id, 'a new visit can be booked with an old doctor');
  const ap2 = await call('appointments:create', { patient_id: legacyPats[0].id, doctor_id: doc.id, appointment_date: today, appointment_time: '09:30' });
  const prior = q('SELECT visit_number FROM appointments WHERE patient_id=? AND id <> ? ORDER BY visit_number DESC', legacyPats[0].id, ap2.id);
  ok(prior.length >= 1 && Number(one('SELECT visit_number v FROM appointments WHERE id=?', ap2.id).v) === Number(prior[0].visit_number) + 1,
    "an old patient's next visit carries on their numbering (their old visits are counted)");
  const nb = await call('bills:create', { appointment_id: ap.id, patient_id: np.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  ok(!!nb?.bill_number && !oldBillNos.has(nb.bill_number), `a new bill gets a fresh number that collides with none of the old ones (${nb?.bill_number})`);
  eq(one('SELECT COUNT(*) c FROM bills').c, before.bills.rows.size + 1, 'the new bill is added to the old ones — nothing was replaced');

  // ---- 8. opening it again changes nothing ----
  section('closing and reopening the app is harmless');
  const countsNow = Object.fromEntries(Object.keys(before).map((t) => [t, one(`SELECT COUNT(*) c FROM "${t}"`).c]));
  closeDb();
  const db2 = getDb();
  const countsAgain = Object.fromEntries(Object.keys(before).map((t) => [t, (db2.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as any).c]));
  eq(JSON.stringify(countsAgain), JSON.stringify(countsNow), 'a second start finds the same data, and does not upgrade again');
  eq((fs.existsSync(snapRoot) ? fs.readdirSync(snapRoot) : []).length, versionBefore < SCHEMA_VERSION ? 1 : 0, '…and takes no second safety copy');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
