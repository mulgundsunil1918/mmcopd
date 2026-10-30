import type Database from 'better-sqlite3';
import { LAB_PANELS, type DefaultPanel, type ParamLine } from '../data/lab-parameters';
import { flagFor, parseRangeSpec, rangeText, sexOf, type RangeSpec } from '../lib/labRanges';

/**
 * Lab parameters and normal values: the tables, the defaults, and the result sheet of an order.
 *
 *   lab_test_params     what a test is made of (a CBC: Hb, RBC, TLC …) with unit and normal range — editable by the lab
 *   lab_result_values   what was ENTERED for one test of one order, with the range it was entered against frozen beside it (so editing normal values later never
 *                       changes a report already made) and the H / L / A flag
 * Both tables only ever ADD to an existing database; a test the clinic already gave its own parameters is never overwritten.
 */
export function ensureLabParamsSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_test_params (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_test_id INTEGER NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      unit        TEXT,
      low         REAL, high REAL, m_low REAL, m_high REAL, f_low REAL, f_high REAL,
      ref_text    TEXT,
      grp         TEXT,
      no_flag     INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lab_test_params_test ON lab_test_params(lab_test_id, sort_order);
    CREATE TABLE IF NOT EXISTS lab_result_values (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_order_item_id INTEGER NOT NULL REFERENCES lab_order_items(id) ON DELETE CASCADE,
      param_id          INTEGER,
      name              TEXT NOT NULL,
      unit              TEXT,
      low               REAL, high REAL,
      ref_text          TEXT,
      grp               TEXT,
      no_flag           INTEGER NOT NULL DEFAULT 0,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      value             TEXT,
      flag              TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_lab_result_values_item ON lab_result_values(lab_order_item_id, sort_order);
  `);
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const namesOf = (p: DefaultPanel) => [p.test, ...(p.aliases ?? [])].map(norm);

export interface ParamInput { name: string; unit?: string | null; low?: number | null; high?: number | null; m_low?: number | null; m_high?: number | null; f_low?: number | null; f_high?: number | null; ref_text?: string | null; grp?: string | null; no_flag?: boolean | number }
export interface ParamRow extends RangeSpec { id: number; lab_test_id: number; name: string; unit: string | null; grp: string | null; sort_order: number }

/** A default line → a parameter row (a leading "~" on the range means: show it, never flag it). */
export function lineToParam(l: ParamLine): ParamInput {
  const noFlag = l[2].startsWith('~'); const spec = parseRangeSpec(noFlag ? l[2].slice(1) : l[2]);
  return { name: l[0], unit: l[1] || null, ...spec, grp: l[3] ?? null, no_flag: noFlag };
}

export function panelForTest(testName: string): DefaultPanel | undefined {
  const n = norm(testName); return LAB_PANELS.find((p) => namesOf(p).includes(n));
}

const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** Replace a test's parameters with these (in order). */
export function writeParams(db: Database.Database, testId: number, params: ParamInput[]) {
  const del = db.prepare('DELETE FROM lab_test_params WHERE lab_test_id = ?');
  const ins = db.prepare(`INSERT INTO lab_test_params (lab_test_id, name, unit, low, high, m_low, m_high, f_low, f_high, ref_text, grp, no_flag, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    del.run(testId);
    params.forEach((p, i) => ins.run(testId, String(p.name).trim(), p.unit?.toString().trim() || null, numOrNull(p.low), numOrNull(p.high), numOrNull(p.m_low), numOrNull(p.m_high),
      numOrNull(p.f_low), numOrNull(p.f_high), p.ref_text?.toString().trim() || null, p.grp?.toString().trim() || null, p.no_flag ? 1 : 0, i));
  })();
}
export const getParams = (db: Database.Database, testId: number) =>
  db.prepare('SELECT * FROM lab_test_params WHERE lab_test_id = ? ORDER BY sort_order, id').all(testId) as ParamRow[];

/**
 * Give every common test its parameters and normal values. A test that is not in the catalogue yet is added (price 0 — the clinic sets its own); a test that
 * already has parameters is left alone. Runs once per defaults version; "Reset to defaults" in the editor brings a test back to these at any time.
 */
export function seedLabParameterDefaults(db: Database.Database) {
  const FLAG = 'lab_params_seed_v1';
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(FLAG)) return;
  const tests = db.prepare('SELECT id, name FROM lab_tests').all() as { id: number; name: string }[];
  const findTest = (p: DefaultPanel) => tests.find((t) => namesOf(p).includes(norm(t.name)))?.id;
  const insTest = db.prepare("INSERT INTO lab_tests (name, price, sample_type, category, is_active) VALUES (?, 0, ?, ?, 1)");
  db.transaction(() => {
    for (const p of LAB_PANELS) {
      let id = findTest(p);
      if (!id) { id = Number(insTest.run(p.test, p.sample ?? null, p.category).lastInsertRowid); tests.push({ id, name: p.test }); }
      if (!(db.prepare('SELECT 1 FROM lab_test_params WHERE lab_test_id = ? LIMIT 1').get(id))) writeParams(db, id, p.params.map(lineToParam));
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").run(FLAG);
  })();
}

// ── the result sheet of an order ────────────────────────────────────────────────────────────────────────────────────────────────
export interface SheetRow { key: string; param_id: number | null; name: string; unit: string | null; range_text: string; grp: string | null; value: string; flag: string; saved: boolean; low: number | null; high: number | null; ref_text: string | null; no_flag: boolean }
export interface SheetItem { item_id: number; test_name: string; sample_type: string | null; has_params: boolean; rows: SheetRow[] }
const spec = (r: any): Partial<RangeSpec> => ({ low: r.low, high: r.high, m_low: r.m_low ?? null, m_high: r.m_high ?? null, f_low: r.f_low ?? null, f_high: r.f_high ?? null, ref_text: r.ref_text, no_flag: !!r.no_flag });

function orderSex(db: Database.Database, orderId: number) {
  const o = db.prepare('SELECT p.gender FROM lab_orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = ?').get(orderId) as { gender: string | null } | undefined;
  return o ? sexOf(o.gender) : null;
}

export function resultSheet(db: Database.Database, orderId: number, onlyItem?: number): SheetItem[] {
  const sex = orderSex(db, orderId);
  const items = db.prepare(`SELECT i.id, i.lab_test_id, i.test_name, t.sample_type FROM lab_order_items i LEFT JOIN lab_tests t ON t.id = i.lab_test_id
      WHERE i.lab_order_id = ? ${onlyItem ? 'AND i.id = ' + Number(onlyItem) : ''} ORDER BY i.id`).all(orderId) as { id: number; lab_test_id: number | null; test_name: string; sample_type: string | null }[];
  return items.map((it) => {
    const stored = db.prepare('SELECT * FROM lab_result_values WHERE lab_order_item_id = ? ORDER BY sort_order, id').all(it.id) as any[];
    if (stored.length) {
      return { item_id: it.id, test_name: it.test_name, sample_type: it.sample_type, has_params: true, rows: stored.map((r) => ({
        key: `v${r.id}`, param_id: r.param_id, name: r.name, unit: r.unit, range_text: rangeText(spec(r), null), grp: r.grp, value: r.value ?? '', flag: r.flag, saved: true, low: r.low, high: r.high, ref_text: r.ref_text, no_flag: !!r.no_flag })) };
    }
    const params = it.lab_test_id ? getParams(db, it.lab_test_id) : [];
    return { item_id: it.id, test_name: it.test_name, sample_type: it.sample_type, has_params: params.length > 0, rows: params.map((p) => ({
      key: `p${p.id}`, param_id: p.id, name: p.name, unit: p.unit, range_text: rangeText(p, sex), grp: p.grp, value: '', flag: '', saved: false, ...rangeBounds(p, sex), ref_text: p.ref_text, no_flag: !!p.no_flag })) };
  });
}

/** Save the values typed for one test of an order: the range each was entered against is frozen, the flags are worked out, the test's summary line is written. */
export function saveResultValues(db: Database.Database, orderId: number, itemId: number, values: { key: string; value: string }[]): { ok: true; item: SheetItem } | { ok: false; error: string } {
  const it = db.prepare('SELECT id, lab_test_id, test_name FROM lab_order_items WHERE id = ? AND lab_order_id = ?').get(itemId, orderId) as { id: number; lab_test_id: number | null; test_name: string } | undefined;
  if (!it) return { ok: false, error: 'That test is not part of this order.' };
  if (values.some((v) => String(v.value ?? '').length > 200)) return { ok: false, error: 'A result is too long — keep each value short.' };
  const sex = orderSex(db, orderId);
  db.transaction(() => {
    if (!(db.prepare('SELECT 1 FROM lab_result_values WHERE lab_order_item_id = ? LIMIT 1').get(itemId)) && it.lab_test_id) {
      const ins = db.prepare(`INSERT INTO lab_result_values (lab_order_item_id, param_id, name, unit, low, high, ref_text, grp, no_flag, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      getParams(db, it.lab_test_id).forEach((p, i) => { const b = rangeBounds(p, sex); ins.run(itemId, p.id, p.name, p.unit, b.low, b.high, p.ref_text, p.grp, p.no_flag ? 1 : 0, i); });
    }
    const rows = db.prepare('SELECT * FROM lab_result_values WHERE lab_order_item_id = ?').all(itemId) as any[];
    const upd = db.prepare('UPDATE lab_result_values SET value = ?, flag = ? WHERE id = ?');
    for (const v of values) {
      const row = v.key.startsWith('v') ? rows.find((r) => `v${r.id}` === v.key) : rows.find((r) => `p${r.param_id}` === v.key);
      if (!row) continue;
      const val = String(v.value ?? '').trim();
      upd.run(val || null, flagFor(val, spec(row), null), row.id);
    }
    const now = db.prepare('SELECT name, value, flag FROM lab_result_values WHERE lab_order_item_id = ? ORDER BY sort_order, id').all(itemId) as { name: string; value: string | null; flag: string }[];
    const filled = now.filter((r) => r.value);
    const flagged = filled.filter((r) => r.flag);
    const summary = filled.length === 0 ? null : (flagged.length ? flagged.map((r) => `${r.name} ${r.value} (${r.flag})`).join('; ') : 'All values within the normal range').slice(0, 400);
    db.prepare('UPDATE lab_order_items SET result = ?, is_abnormal = ? WHERE id = ?').run(summary, flagged.length ? 1 : 0, itemId);
  })();
  return { ok: true, item: resultSheet(db, orderId, itemId)[0] };
}
function rangeBounds(p: ParamRow, sex: ReturnType<typeof sexOf>) {
  // the sex-resolved low / high are what gets frozen; the printed range is derived from them
  const m = sex === 'M' && (p.m_low !== null || p.m_high !== null); const f = sex === 'F' && (p.f_low !== null || p.f_high !== null);
  return m ? { low: p.m_low, high: p.m_high } : f ? { low: p.f_low, high: p.f_high } : { low: p.low, high: p.high };
}

// ── everything a printed (or PDF) report needs ──────────────────────────────────────────────────────────────────────────────────
export interface ReportData {
  order: { id: number; order_number: string; ordered_at: string; collected_at: string | null; reported_at: string | null; status: string; doctor_name: string | null; notes: string | null };
  patient: { name: string; uhid: string; age: string; sex: string; phone: string | null };
  items: SheetItem[];
}
function ageText(dob: string | null): string {
  if (!dob) return '';
  const d = new Date(dob + 'T00:00:00'); if (Number.isNaN(d.getTime())) return '';
  const now = new Date(); let y = now.getFullYear() - d.getFullYear(); let m = now.getMonth() - d.getMonth(); if (now.getDate() < d.getDate()) m -= 1; if (m < 0) { y -= 1; m += 12; }
  return y > 0 ? `${y} y${m > 0 && y < 5 ? ` ${m} m` : ''}` : `${m} m`;
}
export function reportData(db: Database.Database, orderId: number): ReportData | null {
  const o = db.prepare(`SELECT o.id, o.order_number, o.ordered_at, o.collected_at, o.reported_at, o.status, o.notes, d.name AS doctor_name,
        p.first_name, p.last_name, p.uhid, p.gender, p.dob, p.phone FROM lab_orders o JOIN patients p ON p.id = o.patient_id LEFT JOIN doctors d ON d.id = o.doctor_id WHERE o.id = ?`).get(orderId) as any;
  if (!o) return null;
  return {
    order: { id: o.id, order_number: o.order_number, ordered_at: o.ordered_at, collected_at: o.collected_at, reported_at: o.reported_at, status: o.status, doctor_name: o.doctor_name, notes: o.notes },
    patient: { name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim(), uhid: o.uhid, age: ageText(o.dob), sex: sexOf(o.gender) === 'M' ? 'Male' : sexOf(o.gender) === 'F' ? 'Female' : '', phone: o.phone },
    items: resultSheet(db, orderId),
  };
}
