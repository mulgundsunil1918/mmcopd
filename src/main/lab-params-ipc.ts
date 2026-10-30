/**
 * Lab IPC for normal values and structured results:
 *   lab:getParams / saveParams / resetParams — what a test is made of and its normal values (editable; "reset" brings back the defaults)
 *   lab:resultSheet / saveResultValues       — the values typed for an order, with H / L / A flags worked out against the range each was entered with
 * (The old one-box-per-test result stays for tests that have no parameters.)
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { requireRole, actor } from './ipc';
import { requireModule } from './licensing/enforce';
import { logAudit } from './auth';
import { getAgeLimits, getParams, lineToParam, panelForTest, recalcRanges, reportData, resultSheet, saveResultValues, writeParams, type ParamInput } from '../db/labParams';
import { CHILD_GROUPS, GROUP_NAMES, hasNumbers, limitProblem, type AgeRange, type ChildGroup } from '../lib/labRanges';

const LAB_ROLES: any[] = ['lab_tech', 'doctor', 'manager', 'receptionist'];

/**
 * The children's ranges of one parameter: at most one per group, numbers that are numbers and not backwards (for everyone, boys, girls). A group with nothing in it is dropped
 * (= the adult range applies); a group with only words is never flagged; a group with numbers keeps no words (the numbers are what is printed and flagged).
 */
function cleanRanges(name: string, list: unknown): { ok: true; ranges: Partial<AgeRange>[] } | { ok: false; error: string } {
  if (list === undefined || list === null) return { ok: true, ranges: [] };
  if (!Array.isArray(list)) return { ok: false, error: `“${name}”: the children’s ranges are not valid.` };
  const isNum = (v: any) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)); const n = (v: any) => (isNum(v) ? Number(v) : null);
  const seen = new Set<string>(); const out: Partial<AgeRange>[] = [];
  for (const r of list as any[]) {
    const g = String(r?.grp ?? '') as ChildGroup;
    if (!CHILD_GROUPS.includes(g)) return { ok: false, error: `“${name}”: an age group is not recognised.` };
    if (seen.has(g)) return { ok: false, error: `“${name}”: ${GROUP_NAMES[g]} is listed twice.` };
    seen.add(g);
    const at = `“${name}” (${GROUP_NAMES[g]})`;
    for (const k of ['low', 'high', 'm_low', 'm_high', 'f_low', 'f_high'] as const) if (r[k] !== null && r[k] !== undefined && r[k] !== '' && !isNum(r[k])) return { ok: false, error: `${at}: the normal values must be numbers.` };
    const back = (a: any, b: any) => isNum(a) && isNum(b) && Number(a) > Number(b);
    if (back(r.low, r.high) || back(r.m_low, r.m_high) || back(r.f_low, r.f_high)) return { ok: false, error: `${at}: the lower normal value is above the upper one.` };
    const text = String(r.ref_text ?? '').trim(); if (text.length > 100) return { ok: false, error: `${at} has a text that is too long.` };
    const row = { low: n(r.low), high: n(r.high), m_low: n(r.m_low), m_high: n(r.m_high), f_low: n(r.f_low), f_high: n(r.f_high) };
    const numbers = hasNumbers(row); if (!numbers && !text) continue;
    out.push({ grp: g, ...row, ref_text: numbers ? null : text, no_flag: !numbers });
  }
  return { ok: true, ranges: out };
}

function cleanParams(list: unknown): { ok: true; params: ParamInput[] } | { ok: false; error: string } {
  if (!Array.isArray(list)) return { ok: false, error: 'Nothing to save.' };
  if (list.length > 80) return { ok: false, error: 'A test can have at most 80 parameters.' };
  const out: ParamInput[] = [];
  for (const p of list as any[]) {
    const name = String(p?.name ?? '').trim();
    if (!name) return { ok: false, error: 'Every parameter needs a name.' };
    if (name.length > 100 || String(p?.unit ?? '').length > 40 || String(p?.ref_text ?? '').length > 100 || String(p?.grp ?? '').length > 60) return { ok: false, error: `“${name.slice(0, 30)}” has a text that is too long.` };
    const nums = ['low', 'high', 'm_low', 'm_high', 'f_low', 'f_high'] as const;
    for (const k of nums) if (p[k] !== null && p[k] !== undefined && p[k] !== '' && !Number.isFinite(Number(p[k]))) return { ok: false, error: `“${name}”: the normal values must be numbers.` };
    const pair = (a: any, b: any) => a !== null && a !== undefined && a !== '' && b !== null && b !== undefined && b !== '' && Number(a) > Number(b);
    if (pair(p.low, p.high) || pair(p.m_low, p.m_high) || pair(p.f_low, p.f_high)) return { ok: false, error: `“${name}”: the lower normal value is above the upper one.` };
    const ranges = cleanRanges(name, p.ranges); if (!ranges.ok) return ranges;
    out.push({ name, unit: p.unit ?? null, low: p.low, high: p.high, m_low: p.m_low, m_high: p.m_high, f_low: p.f_low, f_high: p.f_high, ref_text: p.ref_text ?? null, grp: p.grp ?? null, no_flag: !!p.no_flag, ranges: ranges.ranges });
  }
  return { ok: true, params: out };
}

export function registerLabParamsIpc() {
  ipcMain.handle('lab:getParams', (_e, testId: number) => {
    const db = getDb(); const t = db.prepare('SELECT id, name FROM lab_tests WHERE id = ?').get(Number(testId)) as { id: number; name: string } | undefined;
    if (!t) return { ok: false as const, error: 'That test was not found.' };
    return { ok: true as const, test: t, params: getParams(db, t.id), has_default: !!panelForTest(t.name) };
  });

  ipcMain.handle('lab:saveParams', (_e, testId: number, list: unknown) => {
    requireModule('lab', 'Laboratory'); requireRole(LAB_ROLES, 'change normal values');
    const db = getDb(); const t = db.prepare('SELECT id, name FROM lab_tests WHERE id = ?').get(Number(testId)) as { id: number; name: string } | undefined;
    if (!t) return { ok: false as const, error: 'That test was not found.' };
    const c = cleanParams(list); if (!c.ok) return c;
    writeParams(db, t.id, c.params);
    try { logAudit(db, actor(), 'lab_params_saved', 'lab_tests', t.id, `${t.name} · ${c.params.length} parameters`); } catch { /* the audit must never block work */ }
    return { ok: true as const, params: getParams(db, t.id) };
  });

  ipcMain.handle('lab:resetParams', (_e, testId: number) => {
    requireModule('lab', 'Laboratory'); requireRole(LAB_ROLES, 'reset normal values');
    const db = getDb(); const t = db.prepare('SELECT id, name FROM lab_tests WHERE id = ?').get(Number(testId)) as { id: number; name: string } | undefined;
    if (!t) return { ok: false as const, error: 'That test was not found.' };
    const panel = panelForTest(t.name);
    if (!panel) return { ok: false as const, error: `There are no standard normal values for “${t.name}” — add them yourself.` };
    writeParams(db, t.id, panel.params.map(lineToParam));
    try { logAudit(db, actor(), 'lab_params_reset', 'lab_tests', t.id, t.name); } catch { /* ignore */ }
    return { ok: true as const, params: getParams(db, t.id) };
  });

  ipcMain.handle('lab:getAgeGroups', () => ({ ok: true as const, limits: getAgeLimits(getDb()) }));
  ipcMain.handle('lab:saveAgeGroups', (_e, limits: unknown) => {
    requireModule('lab', 'Laboratory'); requireRole(LAB_ROLES, 'change the age limits');
    const l: any = limits ?? {}; const problem = limitProblem(l); if (problem) return { ok: false as const, error: problem };
    const clean = { newborn_days: Number(l.newborn_days), infant_months: Number(l.infant_months), child_years: Number(l.child_years), adolescent_years: Number(l.adolescent_years) };
    const db = getDb(); db.prepare("INSERT INTO settings (key, value) VALUES ('lab_age_groups_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(clean));
    try { logAudit(db, actor(), 'lab_age_limits_saved', 'settings', 0, JSON.stringify(clean)); } catch { /* the audit must never block work */ }
    return { ok: true as const, limits: getAgeLimits(db) };
  });

  ipcMain.handle('lab:reportData', (_e, orderId: number) => reportData(getDb(), Number(orderId)));
  ipcMain.handle('lab:resultSheet', (_e, orderId: number) => resultSheet(getDb(), Number(orderId)));

  ipcMain.handle('lab:recalcRanges', (_e, orderId: number, itemId: number) => {
    requireModule('lab', 'Laboratory'); requireRole(['lab_tech', 'doctor', 'ward_incharge', 'manager', 'receptionist'], 're-apply normal ranges');
    const db = getDb(); const r = recalcRanges(db, Number(orderId), Number(itemId));
    if (r.ok) { try { logAudit(db, actor(), 'lab_ranges_reapplied', 'lab_order_items', Number(itemId), `${r.changed} ranges and ${r.reflagged} marks changed, ${r.kept} kept`); } catch { /* the audit must never block work */ } }
    return r;
  });

  ipcMain.handle('lab:saveResultValues', (_e, orderId: number, itemId: number, values: { key: string; value: string }[]) => {
    requireModule('lab', 'Laboratory'); requireRole(['lab_tech', 'doctor', 'ward_incharge', 'manager', 'receptionist'], 'enter lab results');
    if (!Array.isArray(values)) return { ok: false as const, error: 'Nothing to save.' };
    return saveResultValues(getDb(), Number(orderId), Number(itemId), values);
  });
}
