import type Database from 'better-sqlite3';
import { AGE_RANGES, LAB_PANELS, type DefaultPanel, type ParamLine } from '../data/lab-parameters';
import { CHILD_GROUPS, DEFAULT_LIMITS, GROUP_NAMES, ageInDays, ageText as ageWords, flagFor, groupOf, hasNumbers, parseLimits, parseRangeSpec, pickRange, rangeText, sexOf, type AgeLimits, type AgeRange, type RangeSpec, type Sex } from '../lib/labRanges';

/**
 * Lab parameters and normal values: the tables, the defaults, and the result sheet of an order.
 *
 *   lab_test_params     what a test is made of (a CBC: Hb, RBC, TLC …) with unit and normal range — editable by the lab
 *   lab_param_ranges    the same parameter's normal range for a newborn / infant / child / adolescent (a group left out = the adult range); the group is picked from the date of birth
 *   lab_result_values   what was ENTERED for one test of one order, with the range it was entered against frozen beside it (so editing normal values later never
 *                       changes a report already made) and the H / L / A flag
 * Both tables only ever ADD to an existing database; a test the clinic already gave its own parameters is never overwritten.
 */
export function ensureLabParamsSchema(db: Database.Database) {
  // an earlier, never-released shape of the age table (ranges by a number of days) is replaced — no released build ever stored anything in it
  if ((db.prepare('PRAGMA table_info(lab_param_ranges)').all() as { name: string }[]).some((c) => c.name === 'age_from_days')) db.exec('DROP TABLE lab_param_ranges');
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
    CREATE TABLE IF NOT EXISTS lab_param_ranges (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      param_id      INTEGER NOT NULL REFERENCES lab_test_params(id) ON DELETE CASCADE,
      grp           TEXT NOT NULL,
      low           REAL, high REAL, m_low REAL, m_high REAL, f_low REAL, f_high REAL,
      ref_text      TEXT,
      no_flag       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lab_param_ranges_param ON lab_param_ranges(param_id);
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
      flag              TEXT NOT NULL DEFAULT '',
      by_age            INTEGER NOT NULL DEFAULT 0,
      by_sex            INTEGER NOT NULL DEFAULT 0,
      range_text        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lab_result_values_item ON lab_result_values(lab_order_item_id, sort_order);
  `);
  const cols = (db.prepare('PRAGMA table_info(lab_result_values)').all() as { name: string }[]).map((c) => c.name);
  for (const [col, ddl] of [['by_age', 'INTEGER NOT NULL DEFAULT 0'], ['by_sex', 'INTEGER NOT NULL DEFAULT 0'], ['range_text', 'TEXT']] as const)
    if (!cols.includes(col)) db.exec(`ALTER TABLE lab_result_values ADD COLUMN ${col} ${ddl}`);                                          // a database made before age groups existed
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const namesOf = (p: DefaultPanel) => [p.test, ...(p.aliases ?? [])].map(norm);

export interface ParamInput { name: string; unit?: string | null; low?: number | null; high?: number | null; m_low?: number | null; m_high?: number | null; f_low?: number | null; f_high?: number | null; ref_text?: string | null; grp?: string | null; no_flag?: boolean | number; ranges?: Partial<AgeRange>[] }
export interface ParamRow extends RangeSpec { id: number; lab_test_id: number; name: string; unit: string | null; grp: string | null; sort_order: number; ranges: AgeRange[] }

/** The child ranges of a default parameter (by its name): one row per group that has its own range; a group with only words (no numbers) is never flagged. */
export function childRanges(name: string): Partial<AgeRange>[] {
  const specs = AGE_RANGES[name]; if (!specs) return [];
  const out: Partial<AgeRange>[] = [];
  specs.forEach((t, i) => { if (!t) return; const sp = parseRangeSpec(t); out.push({ grp: CHILD_GROUPS[i], ...sp, no_flag: !hasNumbers(sp) }); });
  return out;
}
/** A default line → a parameter row (a leading "~" on the range means: show it, never flag it). */
export function lineToParam(l: ParamLine): ParamInput {
  const noFlag = l[2].startsWith('~'); const spec = parseRangeSpec(noFlag ? l[2].slice(1) : l[2]);
  return { name: l[0], unit: l[1] || null, ...spec, grp: l[3] ?? null, no_flag: noFlag, ranges: childRanges(l[0]) };
}

export function panelForTest(testName: string): DefaultPanel | undefined {
  const n = norm(testName); return LAB_PANELS.find((p) => namesOf(p).includes(n));
}

const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** Replace a test's parameters with these (in order). */
export function writeParams(db: Database.Database, testId: number, params: ParamInput[]) {
  const del = db.prepare('DELETE FROM lab_test_params WHERE lab_test_id = ?');
  const ins = db.prepare(`INSERT INTO lab_test_params (lab_test_id, name, unit, low, high, m_low, m_high, f_low, f_high, ref_text, grp, no_flag, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insR = db.prepare(`INSERT INTO lab_param_ranges (param_id, grp, low, high, m_low, m_high, f_low, f_high, ref_text, no_flag) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    del.run(testId);
    params.forEach((p, i) => {
      const pid = Number(ins.run(testId, String(p.name).trim(), p.unit?.toString().trim() || null, numOrNull(p.low), numOrNull(p.high), numOrNull(p.m_low), numOrNull(p.m_high),
        numOrNull(p.f_low), numOrNull(p.f_high), p.ref_text?.toString().trim() || null, p.grp?.toString().trim() || null, p.no_flag ? 1 : 0, i).lastInsertRowid);
      for (const r of p.ranges ?? []) if (CHILD_GROUPS.includes(r.grp as any)) insR.run(pid, r.grp, numOrNull(r.low), numOrNull(r.high), numOrNull(r.m_low), numOrNull(r.m_high), numOrNull(r.f_low), numOrNull(r.f_high), r.ref_text?.toString().trim() || null, r.no_flag ? 1 : 0);
    });
  })();
}
export function getParams(db: Database.Database, testId: number): ParamRow[] {
  const rows = db.prepare('SELECT * FROM lab_test_params WHERE lab_test_id = ? ORDER BY sort_order, id').all(testId) as any[];
  const rs = db.prepare('SELECT * FROM lab_param_ranges WHERE param_id IN (SELECT id FROM lab_test_params WHERE lab_test_id = ?) ORDER BY id').all(testId) as any[];
  const order = (g: string) => CHILD_GROUPS.indexOf(g as any);
  return rows.map((p) => ({ ...p, ranges: rs.filter((r) => r.param_id === p.id).sort((a, b) => order(a.grp) - order(b.grp)).map((r): AgeRange => ({ id: r.id, grp: r.grp, low: r.low, high: r.high, m_low: r.m_low, m_high: r.m_high, f_low: r.f_low, f_high: r.f_high, ref_text: r.ref_text, no_flag: !!r.no_flag })) }));
}
/** The age limits the lab chose (settings), or the standard ones. */
export function getAgeLimits(db: Database.Database): AgeLimits {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'lab_age_groups_json'").get() as { value: string } | undefined;
  return r ? parseLimits(r.value) : { ...DEFAULT_LIMITS };
}

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
export interface SheetRow { key: string; param_id: number | null; name: string; unit: string | null; range_text: string; grp: string | null; value: string; flag: string; saved: boolean; low: number | null; high: number | null; ref_text: string | null; no_flag: boolean; by_age: boolean; by_sex: boolean }
/**
 * `ref_for`: whose normal ranges these are ("Child · 4 years · Male") — worked out from the date of birth and sex, never chosen by hand. `ref_dep`: at least one range really
 * depends on the age group or the sex (so the printed report says so). `no_age`: the test has children's ranges but the patient has no usable date of birth, so the adult ranges are shown.
 */
export interface SheetItem { item_id: number; test_name: string; sample_type: string | null; has_params: boolean; rows: SheetRow[]; ref_for: string; ref_dep: boolean; no_age: boolean }
const spec = (r: any): Partial<RangeSpec> => ({ low: r.low, high: r.high, m_low: r.m_low ?? null, m_high: r.m_high ?? null, f_low: r.f_low ?? null, f_high: r.f_high ?? null, ref_text: r.ref_text, no_flag: !!r.no_flag });

export interface Who { sex: Sex; ageDays: number | null }
/** Sex, and age in days ON THE DAY OF THE TEST (the order date), of the patient the order is for. */
function orderWho(db: Database.Database, orderId: number): Who {
  const o = db.prepare('SELECT p.gender, p.dob, o.ordered_at FROM lab_orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = ?').get(orderId) as { gender: string | null; dob: string | null; ordered_at: string | null } | undefined;
  return o ? { sex: sexOf(o.gender), ageDays: ageInDays(o.dob, o.ordered_at) } : { sex: null, ageDays: null };
}
const sexWord = (s: Sex) => (s === 'M' ? 'Male' : s === 'F' ? 'Female' : '');

/** The boxes of a test that has not been saved yet: each parameter with the normal range for THIS patient (age group first, then sex, else the adult range). Pure — the demo uses it too. */
export function sheetRowsFor(params: ParamRow[], who: Who, limits: AgeLimits = DEFAULT_LIMITS): Pick<SheetItem, 'rows' | 'ref_for' | 'ref_dep' | 'no_age'> {
  const rows: SheetRow[] = params.map((p) => {
    const r = pickRange(p, who.ageDays, who.sex, limits);
    return { key: `p${p.id}`, param_id: p.id, name: p.name, unit: p.unit, range_text: r.text, grp: p.grp, value: '', flag: '', saved: false, low: r.low, high: r.high, ref_text: r.ref_text, no_flag: r.no_flag, by_age: r.by_age, by_sex: r.by_sex };
  });
  return { rows, ...refFor(who, limits, rows.some((x) => x.by_age || x.by_sex), params.some((p) => p.ranges?.length > 0)) };
}
/** The line that says whose ranges these are, and whether it matters (`ref_dep`) / whether the date of birth is missing from a test that has children's ranges (`no_age`). */
export function refFor(who: Who, limits: AgeLimits, depends: boolean, hasGroups: boolean): { ref_for: string; ref_dep: boolean; no_age: boolean } {
  const g = groupOf(who.ageDays, limits);
  return { ref_for: [g ? GROUP_NAMES[g] : '', who.ageDays !== null ? ageWords(who.ageDays) : '', sexWord(who.sex)].filter(Boolean).join(' · '), ref_dep: depends, no_age: hasGroups && who.ageDays === null };
}

export function resultSheet(db: Database.Database, orderId: number, onlyItem?: number): SheetItem[] {
  const who = orderWho(db, orderId); const limits = getAgeLimits(db);
  const items = db.prepare(`SELECT i.id, i.lab_test_id, i.test_name, t.sample_type FROM lab_order_items i LEFT JOIN lab_tests t ON t.id = i.lab_test_id
      WHERE i.lab_order_id = ? ${onlyItem ? 'AND i.id = ' + Number(onlyItem) : ''} ORDER BY i.id`).all(orderId) as { id: number; lab_test_id: number | null; test_name: string; sample_type: string | null }[];
  return items.map((it) => {
    const stored = db.prepare('SELECT * FROM lab_result_values WHERE lab_order_item_id = ? ORDER BY sort_order, id').all(it.id) as any[];
    if (stored.length) {
      const rows: SheetRow[] = stored.map((r) => ({
        key: `v${r.id}`, param_id: r.param_id, name: r.name, unit: r.unit, range_text: r.range_text ?? rangeText(spec(r), null), grp: r.grp, value: r.value ?? '', flag: r.flag, saved: true, low: r.low, high: r.high, ref_text: r.ref_text, no_flag: !!r.no_flag, by_age: !!r.by_age, by_sex: !!r.by_sex }));
      return { item_id: it.id, test_name: it.test_name, sample_type: it.sample_type, has_params: true, rows, ...refFor(who, limits, rows.some((x) => x.by_age || x.by_sex), false) };
    }
    const params = it.lab_test_id ? getParams(db, it.lab_test_id) : [];
    return { item_id: it.id, test_name: it.test_name, sample_type: it.sample_type, has_params: params.length > 0, ...sheetRowsFor(params, who, limits) };
  });
}

/** Save the values typed for one test of an order: the range each was entered against is frozen, the flags are worked out, the test's summary line is written. */
export function saveResultValues(db: Database.Database, orderId: number, itemId: number, values: { key: string; value: string }[]): { ok: true; item: SheetItem } | { ok: false; error: string } {
  const it = db.prepare('SELECT id, lab_test_id, test_name FROM lab_order_items WHERE id = ? AND lab_order_id = ?').get(itemId, orderId) as { id: number; lab_test_id: number | null; test_name: string } | undefined;
  if (!it) return { ok: false, error: 'That test is not part of this order.' };
  if (values.some((v) => String(v.value ?? '').length > 200)) return { ok: false, error: 'A result is too long — keep each value short.' };
  const who = orderWho(db, orderId); const limits = getAgeLimits(db);
  db.transaction(() => {
    if (!(db.prepare('SELECT 1 FROM lab_result_values WHERE lab_order_item_id = ? LIMIT 1').get(itemId)) && it.lab_test_id) {
      const ins = db.prepare(`INSERT INTO lab_result_values (lab_order_item_id, param_id, name, unit, low, high, ref_text, grp, no_flag, sort_order, by_age, by_sex, range_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      getParams(db, it.lab_test_id).forEach((p, i) => { const r = pickRange(p, who.ageDays, who.sex, limits); ins.run(itemId, p.id, p.name, p.unit, r.low, r.high, r.ref_text, p.grp, r.no_flag ? 1 : 0, i, r.by_age ? 1 : 0, r.by_sex ? 1 : 0, r.text); });
    }
    const rows = db.prepare('SELECT * FROM lab_result_values WHERE lab_order_item_id = ?').all(itemId) as any[];
    const upd = db.prepare('UPDATE lab_result_values SET value = ?, flag = ? WHERE id = ?');
    for (const v of values) {
      const row = v.key.startsWith('v') ? rows.find((r) => `v${r.id}` === v.key) : rows.find((r) => `p${r.param_id}` === v.key);
      if (!row) continue;
      const val = String(v.value ?? '').trim();
      upd.run(val || null, flagFor(val, spec(row), null), row.id);
    }
    refreshSummary(db, itemId);
  })();
  return { ok: true, item: resultSheet(db, orderId, itemId)[0] };
}
/** The test's one-line summary and its abnormal mark, worked out from the values saved for it. */
function refreshSummary(db: Database.Database, itemId: number) {
  const now = db.prepare('SELECT name, value, flag FROM lab_result_values WHERE lab_order_item_id = ? ORDER BY sort_order, id').all(itemId) as { name: string; value: string | null; flag: string }[];
  const filled = now.filter((r) => r.value);
  const flagged = filled.filter((r) => r.flag);
  const summary = filled.length === 0 ? null : (flagged.length ? flagged.map((r) => `${r.name} ${r.value} (${r.flag})`).join('; ') : 'All values within the normal range').slice(0, 400);
  db.prepare('UPDATE lab_order_items SET result = ?, is_abnormal = ? WHERE id = ?').run(summary, flagged.length ? 1 : 0, itemId);
}

/** The pure part of "re-apply": a saved row re-worked against its parameter's CURRENT definition for this patient (the typed value stays; the range and the mark are redone). */
export function reapplyRow(row: { value: string | null }, p: ParamRow, who: Who, limits: AgeLimits) {
  const r = pickRange(p, who.ageDays, who.sex, limits);
  return { low: r.low, high: r.high, ref_text: r.ref_text, no_flag: r.no_flag, by_age: r.by_age, by_sex: r.by_sex, range_text: r.text, flag: flagFor(String(row.value ?? ''), { low: r.low, high: r.high, ref_text: r.ref_text, no_flag: r.no_flag }, null) };
}
/**
 * Re-apply the normal ranges of a test that already has saved values — after a date of birth or a gender was corrected, or the lab edited its normal values. The typed values stay;
 * each range is worked out again from the patient's CURRENT date of birth and sex and the parameter's CURRENT normal values, and the High / Low marks are redone. A value whose
 * parameter has since been removed from the test keeps the range it was entered with.
 */
export function recalcRanges(db: Database.Database, orderId: number, itemId: number): { ok: true; changed: number; reflagged: number; kept: number; item: SheetItem } | { ok: false; error: string } {
  const it = db.prepare('SELECT id, lab_test_id FROM lab_order_items WHERE id = ? AND lab_order_id = ?').get(itemId, orderId) as { id: number; lab_test_id: number | null } | undefined;
  if (!it) return { ok: false, error: 'That test is not part of this order.' };
  const stored = db.prepare('SELECT * FROM lab_result_values WHERE lab_order_item_id = ? ORDER BY sort_order, id').all(itemId) as any[];
  if (!stored.length) return { ok: false, error: 'Nothing has been saved for this test yet — its normal ranges are worked out fresh until the first save.' };
  const who = orderWho(db, orderId); const limits = getAgeLimits(db);
  const params = it.lab_test_id ? getParams(db, it.lab_test_id) : [];
  let changed = 0; let reflagged = 0; let kept = 0;
  db.transaction(() => {
    const upd = db.prepare('UPDATE lab_result_values SET param_id = ?, low = ?, high = ?, ref_text = ?, no_flag = ?, by_age = ?, by_sex = ?, range_text = ?, flag = ? WHERE id = ?');
    for (const row of stored) {
      const p = params.find((x) => x.id === row.param_id) ?? params.find((x) => norm(x.name) === norm(row.name));
      if (!p) { kept++; continue; }
      const n = reapplyRow(row, p, who, limits);
      if (n.range_text !== (row.range_text ?? rangeText(spec(row), null))) changed++;
      if (n.flag !== row.flag) reflagged++;
      upd.run(p.id, n.low, n.high, n.ref_text, n.no_flag ? 1 : 0, n.by_age ? 1 : 0, n.by_sex ? 1 : 0, n.range_text, n.flag, row.id);
    }
    refreshSummary(db, itemId);
  })();
  return { ok: true, changed, reflagged, kept, item: resultSheet(db, orderId, itemId)[0] };
}

// ── everything a printed (or PDF) report needs ──────────────────────────────────────────────────────────────────────────────────
export interface ReportData {
  order: { id: number; order_number: string; ordered_at: string; collected_at: string | null; reported_at: string | null; status: string; doctor_name: string | null; notes: string | null };
  patient: { name: string; uhid: string; age: string; sex: string; phone: string | null };
  items: SheetItem[];
}
/** "4 y 3 m" · "7 m" · "12 d" — the patient's age on the day of the test, as a lab report prints it. */
function ageShort(dob: string | null, on: string | null): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob ?? '')); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(on ?? '')); if (!a || !b) return '';
  let y = Number(b[1]) - Number(a[1]); let m = Number(b[2]) - Number(a[2]); let d = Number(b[3]) - Number(a[3]);
  if (d < 0) { m -= 1; d += 30; } if (m < 0) { y -= 1; m += 12; }
  if (y < 0) return '';
  return y > 0 ? `${y} y${m > 0 && y < 5 ? ` ${m} m` : ''}` : m > 0 ? `${m} m` : `${d} d`;
}
export function reportData(db: Database.Database, orderId: number): ReportData | null {
  const o = db.prepare(`SELECT o.id, o.order_number, o.ordered_at, o.collected_at, o.reported_at, o.status, o.notes, d.name AS doctor_name,
        p.first_name, p.last_name, p.uhid, p.gender, p.dob, p.phone FROM lab_orders o JOIN patients p ON p.id = o.patient_id LEFT JOIN doctors d ON d.id = o.doctor_id WHERE o.id = ?`).get(orderId) as any;
  if (!o) return null;
  return {
    order: { id: o.id, order_number: o.order_number, ordered_at: o.ordered_at, collected_at: o.collected_at, reported_at: o.reported_at, status: o.status, doctor_name: o.doctor_name, notes: o.notes },
    patient: { name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim(), uhid: o.uhid, age: ageShort(o.dob, o.ordered_at), sex: sexOf(o.gender) === 'M' ? 'Male' : sexOf(o.gender) === 'F' ? 'Female' : '', phone: o.phone },
    items: resultSheet(db, orderId),
  };
}
