/** Demo version of the lab normal-values API (website demo and screenshots): the same shapes the real main process returns, kept in memory. */
import { DEFAULT_LIMITS, ageInDays, ageText, flagFor, hasNumbers, limitProblem, sexOf, type AgeLimits, type ChildGroup } from '../lib/labRanges';
import { lineToParam, panelForTest, reapplyRow, refFor, sheetRowsFor, type ParamRow, type Who } from '../db/labParams';

const r = <T,>(v: T): Promise<T> => Promise.resolve(v);
const full = (testId: number, p: any, i: number) => ({ id: testId * 1000 + i, lab_test_id: testId, name: p.name, unit: p.unit ?? null, low: p.low ?? null, high: p.high ?? null, m_low: p.m_low ?? null, m_high: p.m_high ?? null,
  f_low: p.f_low ?? null, f_high: p.f_high ?? null, ref_text: p.ref_text ?? null, grp: p.grp ?? null, no_flag: p.no_flag ? 1 : 0, sort_order: i,
  ranges: (p.ranges ?? []).map((g: any, k: number) => ({ id: testId * 100000 + i * 100 + k, grp: g.grp as ChildGroup, low: g.low ?? null, high: g.high ?? null, m_low: g.m_low ?? null, m_high: g.m_high ?? null, f_low: g.f_low ?? null, f_high: g.f_high ?? null,
    ref_text: g.ref_text ?? null, no_flag: !!g.no_flag })).filter((g: any) => hasNumbers(g) || g.ref_text) });

export function makeLabParamsMock(ctx: { tests: () => any[]; items: (orderId: number) => any[]; order: (orderId: number) => any | undefined }) {
  const custom = new Map<number, any[]>(); const values = new Map<number, any[]>(); let limits: AgeLimits = { ...DEFAULT_LIMITS };
  const test = (id: number) => ctx.tests().find((t) => t.id === id);
  const paramsOf = (id: number): any[] => custom.get(id) ?? (panelForTest(test(id)?.name ?? '')?.params.map(lineToParam).map((p, i) => full(id, p, i)) ?? []);
  const whoOf = (orderId: number): Who => { const o = ctx.order(orderId); return o ? { sex: sexOf(o.patient_gender), ageDays: ageInDays(o.patient_dob, o.ordered_at) } : { sex: null, ageDays: null }; };
  const sheetItem = (it: any) => {
    const stored = values.get(it.id); const who = whoOf(it.lab_order_id);
    const base = { item_id: it.id, test_name: it.test_name, sample_type: test(it.lab_test_id)?.sample_type ?? null };
    if (stored) return { ...base, has_params: true, rows: stored, ...refFor(who, limits, stored.some((x: any) => x.by_age || x.by_sex), false) };
    const built = sheetRowsFor(paramsOf(it.lab_test_id) as ParamRow[], who, limits);
    return { ...base, has_params: built.rows.length > 0, ...built };
  };
  return {
    paramCount: (it: any) => paramsOf(it.lab_test_id).length, valueCount: (it: any) => values.get(it.id)?.length ?? 0,
    getParams: (id: number) => { const t = test(id); return r(t ? { ok: true as const, test: { id, name: t.name }, params: paramsOf(id) as any, has_default: !!panelForTest(t.name) } : { ok: false as const, error: 'That test was not found.' }); },
    saveParams: (id: number, list: any[]) => {
      if (list.some((p) => !String(p.name || '').trim())) return r({ ok: false as const, error: 'Every parameter needs a name.' });
      custom.set(id, list.map((p, i) => full(id, p, i))); return r({ ok: true as const, params: custom.get(id) as any });
    },
    recalcRanges: (orderId: number, itemId: number) => {
      const it = ctx.items(orderId).find((x) => x.id === itemId); if (!it) return r({ ok: false as const, error: 'That test is not part of this order.' });
      const stored = values.get(itemId); if (!stored) return r({ ok: false as const, error: 'Nothing has been saved for this test yet — its normal ranges are worked out fresh until the first save.' });
      const who = whoOf(orderId); const ps = paramsOf(it.lab_test_id) as ParamRow[]; let changed = 0; let reflagged = 0; let kept = 0;
      values.set(itemId, stored.map((row: any) => {
        const p = ps.find((x) => x.name === row.name); if (!p) { kept++; return row; }
        const n = reapplyRow(row, p, who, limits); if (n.range_text !== row.range_text) changed++; if (n.flag !== row.flag) reflagged++; return { ...row, ...n };
      }));
      return r({ ok: true as const, changed, reflagged, kept, item: sheetItem(it) as any });
    },
    getAgeGroups: () => r({ ok: true as const, limits }),
    saveAgeGroups: (l: AgeLimits) => { const problem = limitProblem(l); if (problem) return r({ ok: false as const, error: problem }); limits = { ...l }; return r({ ok: true as const, limits }); },
    resetParams: (id: number) => { const t = test(id); const pn = panelForTest(t?.name ?? ''); if (!pn) return r({ ok: false as const, error: `There are no standard normal values for “${t?.name}” — add them yourself.` }); custom.delete(id); return r({ ok: true as const, params: paramsOf(id) as any }); },
    resultSheet: (orderId: number) => r(ctx.items(orderId).map(sheetItem) as any),
    saveResultValues: (orderId: number, itemId: number, vals: { key: string; value: string }[]) => {
      const it = ctx.items(orderId).find((x) => x.id === itemId); if (!it) return r({ ok: false as const, error: 'That test is not part of this order.' });
      const rows = (values.get(itemId) ?? sheetItem(it).rows).map((x: any) => ({ ...x, saved: true }));
      for (const v of vals) { const row = rows.find((x: any) => x.key === v.key); if (row) { row.value = v.value.trim(); row.flag = flagFor(row.value, row, null); } }
      values.set(itemId, rows); return r({ ok: true as const, item: sheetItem(it) as any });
    },
    reportData: (orderId: number) => {
      const o = ctx.order(orderId); if (!o) return r(null);
      return r({ order: { id: orderId, order_number: o.order_number, ordered_at: o.ordered_at, collected_at: null, reported_at: o.reported_at ?? null, status: o.status, doctor_name: o.doctor_name ?? null, notes: null },
        patient: { name: o.patient_name, uhid: o.patient_uhid, age: ageText(ageInDays(o.patient_dob, o.ordered_at)) || '—', sex: sexOf(o.patient_gender) === 'M' ? 'Male' : 'Female', phone: null }, items: ctx.items(orderId).map(sheetItem) as any });
    },
  };
}
