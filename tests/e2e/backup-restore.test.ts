// "Whenever the user restores from the backup file, everything restores as it is — and nothing fails on the way." (the owner, 2026-10-26)
//
// This suite proves it with the real handlers and a clinic that has USED the program — sample patients and visits, a supplier bill with 41 lines imported
// from ChatGPT's Excel (new medicines AND consumables, a "No expiry" bed sheet, two lines set aside to finish later, the bill's picture), the pharmacy's own GST and
// GSTIN, a patient's document — and then loses everything and restores. What it proves:
//   1. every table of the database is in the backup, and the backup says so itself (integrity check + row counts match, table by table);
//   2. EVERY entry of the app's data folder is accounted for in src/main/backup-guard.ts (DATA_LAYOUT): either a backup carries it, or the reason it does not is written
//      next to it — and so is every name the source code writes there. A new feature that writes a new file FAILS THIS TEST until somebody decides;
//   3. after a total loss and a restore, every table holds exactly what it held (cell for cell) and every file in documents/ is back, byte for byte;
//   4. the restored clinic works: its bill picture can be read, its consumable is still a consumable, its waiting list still waits;
//   5. restoring a backup made by an OLDER release (the legacy fixtures) works with this version — nothing lost, the file healthy, the version current;
//   6. a file that is not a backup, a damaged one, one from a NEWER CureDesk, a wrong confirmation — all refused in plain words, and nothing changed;
//   7. a backup whose database cannot be opened by this version puts the clinic's own data back exactly as it was.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { boot, call, attempt, getDb, closeDb, userData } from './harness';
import { addAsNew, patchLine, type Draft } from '../../src/lib/billImport';
import { SCHEMA_VERSION } from '../../src/db/schema';
import { DATA_LAYOUT, isKnownDataEntry } from '../../src/main/backup-guard';
import { ok, eq, section, finish, note } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const b64 = (u: Uint8Array | Buffer) => Buffer.from(u).toString('base64');
const q = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => getDb().prepare(sql).get(...p) as any;

/** Every table's rows as plain text, in a stable order: what "exactly as it was" is compared on. */
function dumpAll(d: Database.Database): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]) {
    out[t.name] = (d.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all() as any[]).map((r) => {
      if (t.name === 'counters') r = { ...r, updated_at: '' };            // opening the program re-stamps the numbering counters with the time (their numbers never change): not data
      return JSON.stringify(r);
    });
  }
  return out;
}
/** A folder as { relative path → sha256 }. */
function tree(dir: string, base = dir, acc: Record<string, string> = {}): Record<string, string> {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tree(p, base, acc);
    else acc[path.relative(base, p).replace(/\\/g, '/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return acc;
}
const docsDir = () => path.join(userData, 'documents');
/** Which tables differ, and the first row that does — so a failure says WHERE. */
function diffOf(a: Record<string, string[]>, b: Record<string, string[]>, skip: string[] = []): string[] {
  const out: string[] = [];
  for (const t of Object.keys(a)) {
    if (skip.includes(t) || JSON.stringify(a[t]) === JSON.stringify(b[t])) continue;
    const i = a[t].findIndex((r, k) => r !== (b[t] ?? [])[k]);
    out.push(`${t} (${a[t].length}→${(b[t] ?? []).length}${i >= 0 ? `; first different row: ${a[t][i]?.slice(0, 90)} ⇒ ${(b[t] ?? [])[i]?.slice(0, 90)}` : ''})`);
  }
  return out;
}

/**
 * Put one row into every table that is still empty, so EVERY table of the schema — including one a future feature adds — is exercised by the round trip below.
 * A CHECK (col IN ('a','b')) on a column is honoured by choosing its first allowed word. A table this cannot fill is reported by name: give it an example row here.
 */
function fillEmptyTables(d: Database.Database): { filled: string[]; failed: string[] } {
  const filled: string[] = [], failed: string[] = [];
  d.pragma('foreign_keys = OFF');
  for (const t of d.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[]) {
    if ((d.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get() as any).c > 0) continue;
    const allowed: Record<string, string> = {};
    for (const m of (t.sql || '').matchAll(/"?(\w+)"?\s+(?:TEXT|VARCHAR)?[^,()]*?CHECK\s*\(\s*"?\w+"?\s+IN\s*\(\s*'([^']*)'/gi)) allowed[m[1]] = m[2];
    for (const m of (t.sql || '').matchAll(/CHECK\s*\(\s*"?(\w+)"?\s+IN\s*\(\s*'([^']*)'/gi)) allowed[m[1]] = allowed[m[1]] ?? m[2];
    const cols = d.prepare(`PRAGMA table_info("${t.name}")`).all() as any[];
    const names: string[] = [], vals: any[] = [];
    for (const c of cols) {
      if (c.pk === 1 && /INT/i.test(c.type)) continue;                       // the row number
      if (c.dflt_value !== null && !(c.name in allowed)) continue;           // the table fills it itself
      if (!c.notnull && !(c.name in allowed)) continue;
      names.push(`"${c.name}"`);
      vals.push(c.name in allowed ? allowed[c.name] : /INT/i.test(c.type) ? 1 : /REAL|NUM|FLOA|DOUB/i.test(c.type) ? 1.5 : /DATE|TIME/i.test(c.name) ? '2026-01-01' : 'example');
    }
    try {
      d.prepare(names.length ? `INSERT INTO "${t.name}" (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})` : `INSERT INTO "${t.name}" DEFAULT VALUES`).run(...vals);
      filled.push(t.name);
    } catch (e: any) { failed.push(`${t.name} (${String(e?.message).slice(0, 70)})`); }
  }
  d.pragma('foreign_keys = ON');
  return { filled, failed };
}
const countsNow = () => Object.fromEntries(Object.entries(dumpAll(getDb())).map(([t, r]) => [t, r.length]));

/** A bundle folder holding an old release's database (a legacy fixture), as a backup would. */
function bundleFromFixture(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `curedesk-old-${name.replace(/[^0-9a-z]/gi, '')}-`));
  const d = new Database(path.join(dir, 'caredesk.sqlite'));
  d.pragma('journal_mode = WAL');
  d.exec(zlib.gunzipSync(fs.readFileSync(path.join(root, 'tests', 'e2e', 'legacy-fixtures', `${name}.sql.gz`))).toString('utf8'));
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
  return dir;
}
const preRestoreDirs = () => {
  const base = path.join(userData, '_documents', 'CureDesk Backups', 'sqlite');
  if (!fs.existsSync(base)) return 0;
  let n = 0;
  for (const day of fs.readdirSync(base)) for (const f of fs.readdirSync(path.join(base, day))) if (f.startsWith('pre-restore-')) n++;
  return n;
};

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const FUTURE = (() => { const d = new Date(); d.setDate(d.getDate() + 900); return d.toLocaleDateString('en-CA'); })();
  const backupsTo = path.join(userData, '_my-backups');

  // ============================================================================================================
  section('1 · a clinic that has used the program');
  const sample = await call('admin:loadSampleData');
  ok(sample.ok === true, `sample patients, visits, bills and stock are in (${sample.ok ? '' : sample.error})`);
  await call('settings:save', { pharmacy_gst_enabled: true, pharmacy_gstin: '29AAFPH9004G1ZT', pharmacy_legal_name: 'Backup Test Pharmacy', pharmacy_drug_license_no: 'KA-GDG-20B-83' });

  // a real supplier bill: 41 lines, medicines AND consumables, a "No expiry" bed sheet, two lines set aside, the bill's picture
  const parsed = await call('purchaseImport:parse', b64(fs.readFileSync(path.join(root, 'tests', 'e2e', 'fixtures', 'chatgpt-real-samarth.xlsx'))));
  ok(parsed.ok === true, 'the Samarth bill is read');
  let d = parsed.draft as Draft;
  for (const l of d.lines) {
    d = addAsNew(d, l.id, { ...l.suggested_new });
    const cur = d.lines.find((x) => x.id === l.id)!;
    if (cur.expiry && cur.expiry < today) d = patchLine(d, l.id, { expiry: FUTURE, expiry_problem: '' });
  }
  d = patchLine(d, d.lines.find((l) => /KIT KATH IV 20G/.test(l.printed_name))!.id, { qty: 15, printed_amount: 165 });
  d = patchLine(d, d.lines.find((l) => /CANNULA FIXATOR/.test(l.printed_name))!.id, { free_qty: 10 });
  d = patchLine(d, 1, { aside: true });
  d = patchLine(d, 2, { aside: true });
  const pic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000)]);
  const imp = await call('purchaseImport:create', { draft: d, confirm: 'IMPORT', client_ref: 'backup-test-1', photo: { name: 'samarth-page1.jpg', base64: b64(pic) } });
  ok(imp.ok === true, `the bill is imported with two lines set aside (${imp.ok ? '' : imp.error})`);
  eq(imp.aside, 2, 'two lines wait in the waiting list');
  const invoice = one('SELECT id, scan_path FROM purchase_invoices ORDER BY id DESC LIMIT 1');
  ok(!!invoice.scan_path && fs.existsSync(path.join(docsDir(), 'purchase-scans', path.basename(invoice.scan_path))), 'the bill\'s picture is saved in documents/purchase-scans');
  const pid = one('SELECT id FROM patients ORDER BY id LIMIT 1').id;
  const doc = await call('emr:addDocument', { patient_id: pid, file_name: 'xray report.pdf', file_type: 'application/pdf', data_base64: b64(Buffer.from('%PDF-1.4 test report ' + 'x'.repeat(500))), note: 'chest' });
  ok(!!doc, 'a patient document is saved in documents/<patient id>');
  const bed = one("SELECT d.id, d.item_type, b.batch_no, b.expiry FROM drug_master d JOIN drug_stock_batches b ON b.drug_master_id=d.id WHERE d.name LIKE 'BED SHEET%'");
  eq(`${bed.item_type}/${bed.batch_no}/${bed.expiry}`, 'consumable/NO BATCH/2099-12-31', 'the consumable with no batch and no expiry is on the shelf');
  const usedTables = Object.entries(countsNow()).filter(([, n]) => n > 0).length;
  // every other table gets an example row too, so the round trip below covers the WHOLE schema — and a table somebody adds next year
  const fill = fillEmptyTables(getDb());
  eq(fill.failed.length, 0, `an example row is put into every table the scenario did not reach (${fill.filled.length} tables)${fill.failed.length ? ` — CANNOT FILL: ${fill.failed.join('; ')} (add an example row for it in this test)` : ''}`);
  // an app restart, as happens between a clinic's working days: what the program repairs or tops up when it opens is done BEFORE the backup is compared
  closeDb(); getDb();
  const tables = Object.keys(countsNow());
  eq(Object.values(countsNow()).filter((n) => n === 0).length, 0, `now ALL ${tables.length} tables hold data (${usedTables} from real use, ${fill.filled.length} from an example row)`);

  // ============================================================================================================
  section('2 · the backup carries every table, and says so');
  const live = dumpAll(getDb());
  const liveFiles = tree(docsDir());
  const bk = await call('backup:nowTo', backupsTo);
  ok(bk.ok === true, `a backup is made (${bk.ok ? '' : bk.error})`);
  ok(bk.verified === true && bk.integrityOk === true && bk.mismatches.length === 0, 'it checks itself: integrity ok, every table\'s row count equals the live database\'s');
  eq(bk.totalRows, Object.values(live).reduce((s, r) => s + r.length, 0), `…and the rows it holds are ALL the rows (${bk.totalRows} in ${tables.length} tables)`);
  const manifest = JSON.parse(fs.readFileSync(path.join(bk.bundleDir, 'manifest.json'), 'utf8'));
  eq(manifest.verification.row_counts_match, true, 'the manifest records that the row counts match');
  const inBundle = new Database(path.join(bk.bundleDir, 'caredesk.sqlite'), { readonly: true });
  const bundleDump = dumpAll(inBundle);
  inBundle.close();
  eq(JSON.stringify(Object.keys(bundleDump)), JSON.stringify(Object.keys(live)), 'the backup holds exactly the live table list — not one table missing, none extra');
  const diffTables = Object.keys(live).filter((t) => JSON.stringify(live[t]) !== JSON.stringify(bundleDump[t]));
  eq(diffTables.length, 0, `…and every table holds the same rows as the live database${diffTables.length ? ` (different: ${diffTables.join(', ')})` : ''}`);
  eq(JSON.stringify(tree(path.join(bk.bundleDir, 'documents'))), JSON.stringify(liveFiles), 'the documents folder is copied whole: every patient document and bill picture, byte for byte');
  ok(Object.keys(liveFiles).some((f) => f.startsWith('purchase-scans/')) && Object.keys(liveFiles).some((f) => /^\d+\//.test(f)), '…including the bill picture and the patient document');
  ok(fs.existsSync(bk.xlsxFile), 'and an Excel copy (one sheet per table) is made beside it for a clinic that cannot open the program');

  // ============================================================================================================
  section('3 · every file the app keeps is accounted for (a new feature cannot forget the backup)');
  const entries = fs.readdirSync(userData).filter((n) => !n.startsWith('_'));
  const unknown = entries.filter((n) => !isKnownDataEntry(n));
  eq(unknown.length, 0, `every entry of the data folder is listed in backup-guard.ts or is the engine's own${unknown.length ? ` — NOT LISTED: ${unknown.join(', ')} (decide: does a backup carry it?)` : ''}`);
  ok(DATA_LAYOUT.every((e) => e.backed_up || (e.why_not && e.why_not.length > 10)), 'a file that is NOT backed up has its reason written next to it');
  ok(DATA_LAYOUT.filter((e) => e.backed_up).every((e) => fs.existsSync(path.join(bk.bundleDir, e.path === 'caredesk.sqlite' ? 'caredesk.sqlite' : e.path))), 'a file listed as backed up really is in the backup');
  // names the source code writes into the data folder
  const srcFiles: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p); } };
  walk(path.join(root, 'src'));
  const written = new Map<string, string>();
  const re = /path\.join\(\s*(?:app\.getPath\('userData'\)|userData)\s*,\s*(['"`])([^'"`\\]+)\1/g;
  for (const f of srcFiles) {
    if (/backup-guard\.ts$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) if (!written.has(m[2])) written.set(m[2], path.relative(root, f));
  }
  const unlisted = [...written.entries()].filter(([name]) => !isKnownDataEntry(name));
  eq(unlisted.length, 0, `every name the source code writes into the data folder is listed (${[...written.keys()].join(', ')})${unlisted.length ? ` — NOT LISTED: ${unlisted.map(([n, f]) => `${n} (in ${f})`).join(', ')}` : ''}`);

  // ============================================================================================================
  section('4 · a total loss, then a restore: everything is back as it was');
  const wasWaiting = q("SELECT id, invoice_number, line_count FROM purchase_import_waiting WHERE status='waiting'");
  eq(wasWaiting.length, 1, 'before: one bill waits in the waiting list');
  closeDb();
  for (const f of ['caredesk.sqlite', 'caredesk.sqlite-wal', 'caredesk.sqlite-shm']) fs.rmSync(path.join(userData, f), { force: true });
  fs.rmSync(docsDir(), { recursive: true, force: true });
  eq(one('SELECT COUNT(*) c FROM patients').c, 0, 'the disaster: a brand-new empty database, no documents');
  const preview = await call('backup:previewRestore', bk.bundleDir);
  ok(preview.ok === true && preview.backup.totalRows === bk.totalRows && preview.current.totalRows < preview.backup.totalRows, `the preview tells the truth: the backup holds ${preview.backup?.totalRows} rows, the clinic now has ${preview.current?.totalRows}`);
  const wrong = await call('backup:restore', bk.bundleDir, 'yes please');
  ok(wrong.ok === false && /Confirmation phrase/.test(wrong.error), 'without the confirmation phrase nothing is replaced');
  const rs = await call('backup:restore', bk.bundleDir, 'REPLACE ALL DATA');
  ok(rs.ok === true, `restored (${rs.ok ? '' : rs.error})`);
  const after = dumpAll(getDb());
  const changed = diffOf(live, after, ['audit_log']);
  eq(changed.length, 0, `every table holds exactly what it held before the loss${changed.length ? ` — DIFFERENT: ${changed.join(' | ')}` : ` (${Object.keys(live).length - 1} tables compared cell by cell)`}`);
  const auditNow = after.audit_log, auditBefore = live.audit_log;
  ok(JSON.stringify(auditNow.slice(0, auditBefore.length)) === JSON.stringify(auditBefore) && auditNow.length === auditBefore.length + 1 && /restore_completed/.test(auditNow[auditNow.length - 1]), 'the audit trail is intact and gains one line: restore_completed');
  eq(JSON.stringify(tree(docsDir())), JSON.stringify(liveFiles), 'every document and bill picture is back, byte for byte');
  ok(!fs.existsSync(path.join(userData, 'documents.restoring')) && !fs.existsSync(path.join(userData, 'documents.before-restore')) && !fs.existsSync(path.join(userData, 'caredesk.sqlite.restoring')), 'no half-finished restore files are left behind');

  section('5 · and the restored clinic works');
  const pic2 = await call('purchaseImport:photo', one('SELECT scan_path p FROM purchase_invoices ORDER BY id DESC LIMIT 1').p);
  ok(!!pic2 && Buffer.from(pic2.base64, 'base64').equals(pic), 'the bill\'s picture opens, byte for byte');
  eq((await call('purchaseImport:waiting')).length, 1, 'the bill that waits is still waiting');
  const lst = (await call('pharmacy:listDrugs', { q: 'BED SHEET', activeOnly: true })) as any[];
  eq(`${lst[0]?.item_type}/${lst[0]?.stock_qty}`, 'consumable/6', 'the bed sheet is still a consumable with its six on the shelf');
  const st = await call('settings:get');
  eq(`${st.pharmacy_gst_enabled}/${st.pharmacy_gstin}`, 'true/29AAFPH9004G1ZT', 'the pharmacy\'s own GST switch and GSTIN are back');
  eq((await call('emr:documents', pid)).length, 1, 'the patient\'s document is back');
  eq(one('PRAGMA integrity_check').integrity_check, 'ok', 'the database is healthy');
  eq(q('PRAGMA foreign_key_check').length, 0, '…and no record points at something missing');

  // ============================================================================================================
  section('6 · a backup made by an OLDER release is restored by this one');
  const fixtures = fs.readdirSync(path.join(root, 'tests', 'e2e', 'legacy-fixtures')).filter((f) => f.endsWith('.sql.gz')).map((f) => f.replace(/\.sql\.gz$/, ''));
  ok(fixtures.length >= 15, `${fixtures.length} earlier releases' databases are tried, every one (${fixtures.join(', ')})`);
  for (const fx of fixtures) {
    const dir = bundleFromFixture(fx);
    const old = new Database(path.join(dir, 'caredesk.sqlite'), { readonly: true });
    const oldCounts = Object.fromEntries(Object.entries(dumpAll(old)).map(([t, r]) => [t, r.length]));
    const oldVersion = Number((old.prepare("SELECT value v FROM schema_meta WHERE key='version'").get() as any)?.v ?? 0);
    old.close();
    const pv = await call('backup:previewRestore', dir);
    ok(pv.ok === true, `${fx} (database v${oldVersion}): the preview opens it (${pv.ok ? '' : pv.error})`);
    const r = await call('backup:restore', dir, 'REPLACE ALL DATA');
    ok(r.ok === true, `${fx}: restored (${r.ok ? '' : r.error})`);
    const nowCounts = countsNow();
    const lost = Object.entries(oldCounts).filter(([t, n]) => (nowCounts[t] ?? -1) < n).map(([t, n]) => `${t} ${n}→${nowCounts[t]}`);
    eq(lost.length, 0, `${fx}: no row the old clinic had is lost${lost.length ? ` (${lost.join(', ')})` : ''}`);
    eq(`${one('PRAGMA integrity_check').integrity_check}/${q('PRAGMA foreign_key_check').length}/${one("SELECT value v FROM schema_meta WHERE key='version'").v}`, `ok/0/${SCHEMA_VERSION}`, `${fx}: healthy, and brought up to the current version`);
    ok((q('PRAGMA table_info(drug_master)') as any[]).some((c) => c.name === 'item_type'), `${fx}: the new drug type column is there`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ============================================================================================================
  section('7 · what is refused, in plain words, with nothing changed');
  // back to a known good state: restore the full backup again
  const back = await call('backup:restore', bk.bundleDir, 'REPLACE ALL DATA');
  ok(back.ok === true, 'the full backup is restored again to carry on from a known state');
  const base = JSON.stringify(dumpAll(getDb()));
  const baseObj: Record<string, string[]> = JSON.parse(base);
  const copies = preRestoreDirs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'curedesk-bad-'));
  const refuse = async (label: string, file: string, re: RegExp) => {
    const pv = await call('backup:previewRestore', file);
    const r = await call('backup:restore', file, 'REPLACE ALL DATA');
    ok(pv.ok === false && re.test(pv.error), `${label}: the preview says so (${String(pv.error).slice(0, 90)})`);
    ok(r.ok === false && re.test(r.error), `${label}: the restore refuses`);
    const nowD = dumpAll(getDb());
    ok(JSON.stringify(nowD) === base, `${label}: nothing in the clinic's data changed${JSON.stringify(nowD) === base ? '' : ' — DIFFERENT: ' + diffOf(baseObj, nowD).join(' | ')}`);
    eq(preRestoreDirs(), copies, `${label}: nothing was started (no safety copy made, nothing to undo)`);
  };
  const notDb = path.join(tmp, 'not-a-db.sqlite'); fs.writeFileSync(notDb, 'this is a text file, somebody renamed it');
  await refuse('a text file called .sqlite', notDb, /cannot be opened|damaged|not a database/i);
  const half = path.join(tmp, 'half.sqlite'); const whole = fs.readFileSync(path.join(bk.bundleDir, 'caredesk.sqlite')); fs.writeFileSync(half, whole.subarray(0, Math.floor(whole.length / 2)));
  await refuse('a backup cut in half', half, /cannot be opened|damaged|not a database|malformed/i);
  const other = path.join(tmp, 'other.sqlite'); { const o = new Database(other); o.exec('CREATE TABLE recipes (id INTEGER); INSERT INTO recipes VALUES (1);'); o.close(); }
  await refuse('another program\'s database', other, /not a CureDesk backup/i);
  const newer = path.join(tmp, 'newer.sqlite'); fs.copyFileSync(path.join(bk.bundleDir, 'caredesk.sqlite'), newer);
  { const n = new Database(newer); n.prepare("UPDATE schema_meta SET value=? WHERE key='version'").run(String(SCHEMA_VERSION + 5)); n.close(); }
  await refuse('a backup from a NEWER CureDesk', newer, /NEWER CureDesk/);
  const missing = await call('backup:restore', path.join(tmp, 'nothing-here'), 'REPLACE ALL DATA');
  ok(missing.ok === false, 'a path that does not exist is refused');

  // ============================================================================================================
  section('8 · a backup this version cannot open puts the clinic\'s own data back');
  // a database that passes every look-inside check but cannot be brought up to date: "doctors" is a view, so no column can be added to it
  const broken = path.join(tmp, 'broken-bundle'); fs.mkdirSync(broken);
  fs.copyFileSync(path.join(bk.bundleDir, 'caredesk.sqlite'), path.join(broken, 'caredesk.sqlite'));
  { const x = new Database(path.join(broken, 'caredesk.sqlite')); x.pragma('foreign_keys = OFF'); x.exec("DROP TABLE doctors; CREATE VIEW doctors AS SELECT 1 AS id, 'x' AS name;"); x.close(); }
  const pvBroken = await call('backup:previewRestore', broken);
  ok(pvBroken.ok === true, 'the broken file looks fine from the outside (it is sound and it is CureDesk\'s)');
  const rb = await call('backup:restore', broken, 'REPLACE ALL DATA');
  ok(rb.ok === false && /put back exactly as it was/.test(rb.error), `the restore says it could not, and that the clinic's data was put back (${String(rb.error).slice(0, 120)})`);
  const baseNow = dumpAll(getDb());
  ok(JSON.stringify(baseNow) === base, `the clinic's data is EXACTLY as it was before the attempt, every table${JSON.stringify(baseNow) === base ? '' : ' — DIFFERENT: ' + diffOf(JSON.parse(base), baseNow).join(' | ')}`);
  eq(JSON.stringify(tree(docsDir())), JSON.stringify(liveFiles), '…and so are its documents');
  eq(one('PRAGMA integrity_check').integrity_check, 'ok', '…and the program carries on working');
  ok(!fs.existsSync(path.join(userData, 'documents.restoring')) && !fs.existsSync(path.join(userData, 'documents.before-restore')), 'no half-finished restore files are left behind');
  const again = await attempt('pharmacy:listDrugs', { activeOnly: true });
  ok(again.ok, '…the pharmacy list still loads');
  fs.rmSync(tmp, { recursive: true, force: true });

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
