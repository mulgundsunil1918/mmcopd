// The Excel backup must list EVERY table (owner, 2026-10-29: "everything done should have a backup accordingly"). The .sqlite backup already carries
// every table because it copies the whole file; the Excel copy is a hand-written list of sheets, so a table added tomorrow would silently be left out.
// This guard fails the build until a new table gets its sheet — or is added to NOT_IN_EXCEL below with the reason.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call, getDb, userData } from './harness';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');

/** Tables deliberately NOT given an Excel sheet, and why. A table is only ever added here on purpose. */
const NOT_IN_EXCEL: Record<string, string> = {
  schema_meta: 'internal: the database version number',
  sqlite_sequence: 'internal to SQLite (auto-number bookkeeping)',
  counters: 'internal running numbers (re-derived from the data on every start)',
};

(async () => {
  const src = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.ts'), 'utf8');
  const a = src.indexOf('function exportAllToXlsx'); const b = src.indexOf('Old CSV function kept');
  const block = src.slice(a, b > a ? b : undefined);
  const curated = new Set([...block.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
  const curatedSet = new Set([...(/const CURATED = new Set\(\[([^\]]*)\]/.exec(block)?.[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));
  const skip = new Set([...(/const SKIP = new Set\(\[([^\]]*)\]/.exec(block)?.[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));
  const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);

  section('1 · the Excel backup can never silently leave a table out');
  ok(/listUserTables\(db\)/.test(block) && curatedSet.size > 20, 'the completeness net is in place (any table without its own sheet is dumped raw)');
  const loose = [...skip].filter((t) => !(t in NOT_IN_EXCEL) && !['settings', 'users'].includes(t));
  eq(loose.length, 0, `nothing is skipped unless it is on the “left out on purpose” list${loose.length ? ' — SKIPPED: ' + loose.join(', ') : ''}`);
  const uncovered = tables.filter((t) => !curated.has(t.toLowerCase()) && !curatedSet.has(t) && skip.has(t) && !(t in NOT_IN_EXCEL));
  eq(uncovered.length, 0, `every table is either on a sheet or dumped by the net${uncovered.length ? ' — NOT COVERED: ' + uncovered.join(', ') : ''}`);
  const stale = Object.keys(NOT_IN_EXCEL).filter((t) => !tables.includes(t));
  eq(stale.length, 0, `the “left out on purpose” list has no stale entries${stale.length ? ': ' + stale.join(', ') : ''}`);

  section('2 · the Accounts tables have their own sheets (and are not dumped twice)');
  for (const t of ['acct_vouchers', 'acct_voucher_days', 'acct_staff', 'acct_attendance', 'acct_categories', 'lab_test_params', 'lab_param_ranges', 'lab_result_values']) ok(tables.includes(t) && curated.has(t) && curatedSet.has(t), `${t} has a sheet of its own`);

  section('3 · a real backup’s workbook contains them');
  const dir = path.join(userData, '_sheet-check'); fs.mkdirSync(dir, { recursive: true });
  const bk = await call('backup:nowTo', dir);
  ok(bk.ok === true, `a backup is made (${bk.ok ? '' : bk.error})`);
  const manifest = JSON.parse(fs.readFileSync(path.join(bk.bundleDir, 'manifest.json'), 'utf8'));
  const names: string[] = manifest.sheets || [];
  for (const n of ['Vouchers', 'Voucher Days Settled', 'Accounts Staff', 'Staff Attendance', 'Expense Heads', 'Lab Test Parameters', 'Lab Age Ranges', 'Lab Result Values']) ok(names.includes(n), `the workbook has the “${n}” sheet`);
  eq(names.filter((n) => /^tbl acct_/.test(n)).length, 0, '…and the Accounts tables are not dumped a second time');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
