/**
 * Lab → Test Catalogue → Normal values: what a test is made of and what is normal for each part — for an adult, and for a newborn, an infant, a child and an adolescent
 * (boys / girls separately where they differ). The defaults come ready; the lab edits or resets them. The app picks the age group and the sex from the patient's date of
 * birth and gender when results are entered — nobody has to choose.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Baby, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { HelpTip } from '../HelpTip';
import { useToast } from '../../hooks/useToast';
import { CHILD_GROUPS, DEFAULT_LIMITS, GROUP_NAMES, groupSpans, hasNumbers, rangeText, type AgeGroup, type AgeLimits, type ChildGroup } from '../../lib/labRanges';
import type { ParamRow } from '../../db/labParams';

// Numbers are kept as the TEXT the person typed (so "1." and "0.0" can be typed) and turned into numbers by the server, which refuses anything that is not a number.
type NumKey = 'low' | 'high' | 'm_low' | 'm_high' | 'f_low' | 'f_high';
const NUM_KEYS: NumKey[] = ['low', 'high', 'm_low', 'm_high', 'f_low', 'f_high'];
type Cells = Record<NumKey, string> & { ref_text: string };
interface Row { _k: number; name: string; unit: string; grp: string; no_flag: boolean; adult: Cells; kids: Partial<Record<ChildGroup, Cells>> }

const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const emptyCells = (): Cells => ({ low: '', high: '', m_low: '', m_high: '', f_low: '', f_high: '', ref_text: '' });
const cellsOf = (r: any): Cells => ({ low: t(r.low), high: t(r.high), m_low: t(r.m_low), m_high: t(r.m_high), f_low: t(r.f_low), f_high: t(r.f_high), ref_text: t(r.ref_text) });
const toRow = (p: ParamRow, i: number): Row => ({ _k: i, name: p.name, unit: t(p.unit), grp: t(p.grp), no_flag: !!p.no_flag, adult: cellsOf(p), kids: Object.fromEntries((p.ranges ?? []).map((g) => [g.grp, cellsOf(g)])) });
const asNumbers = (c: Cells) => ({ low: c.low.trim() === '' ? null : Number(c.low), high: c.high.trim() === '' ? null : Number(c.high), m_low: c.m_low.trim() === '' ? null : Number(c.m_low), m_high: c.m_high.trim() === '' ? null : Number(c.m_high),
  f_low: c.f_low.trim() === '' ? null : Number(c.f_low), f_high: c.f_high.trim() === '' ? null : Number(c.f_high), ref_text: c.ref_text || null });
const payload = (r: Row) => ({ name: r.name, unit: r.unit, grp: r.grp, no_flag: r.no_flag, ...r.adult,
  ranges: CHILD_GROUPS.filter((g) => r.kids[g]).map((g) => ({ grp: g, ...r.kids[g] })) });
const kidsFilled = (r: Row) => CHILD_GROUPS.filter((g) => { const c = r.kids[g]; return c && (hasNumbers(asNumbers(c)) || c.ref_text.trim()); });

const COLS: [NumKey, string][] = [['low', 'from'], ['high', 'to'], ['m_low', 'from'], ['m_high', 'to'], ['f_low', 'from'], ['f_high', 'to']];
const input = 'input py-1 px-1.5 text-xs';

function RangeGrid({ row, spans, onAdult, onKid }: { row: Row; spans: Record<AgeGroup, string>; onAdult: (p: Partial<Cells>) => void; onKid: (g: ChildGroup, p: Partial<Cells>) => void }) {
  const groups: AgeGroup[] = [...CHILD_GROUPS, 'adult'];
  return (
    <table className="w-full table-fixed text-xs">
      <colgroup><col style={{ width: '10.5rem' }} />{COLS.map(([k], i) => <col key={k + i} style={{ width: '4.6rem' }} />)}<col /></colgroup>
      <thead>
        <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          <th rowSpan={2} className="text-left align-bottom pb-1">Age group</th>
          <th colSpan={2} className="text-center pb-0.5">Everyone</th><th colSpan={2} className="text-center pb-0.5">Boys / men</th><th colSpan={2} className="text-center pb-0.5">Girls / women</th>
          <th rowSpan={2} className="text-left align-bottom pb-1 pl-3">Words, not numbers</th>
        </tr>
        <tr className="text-[10px] font-normal text-gray-400">{COLS.map(([k, l], i) => <th key={k + i} className="pb-1 font-normal">{l}</th>)}</tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const adult = g === 'adult'; const c = adult ? row.adult : row.kids[g as ChildGroup] ?? emptyCells();
          const put = (p: Partial<Cells>) => (adult ? onAdult(p) : onKid(g as ChildGroup, p));
          const inherits = !adult && !NUM_KEYS.some((k) => c[k].trim()) && !c.ref_text.trim();                // a blank row uses the adult range — shown in grey; a row with its own range shows none
          return (
            <tr key={g} className={`${adult ? 'border-t-2 border-gray-300 dark:border-slate-600' : 'border-t border-gray-100 dark:border-slate-800'}`} data-group={g}>
              <td className="py-1.5 pr-2 align-middle"><div className="text-sm font-semibold text-gray-800 dark:text-slate-100">{GROUP_NAMES[g]}</div><div className="text-[10px] text-gray-500 dark:text-slate-400">{spans[g]}</div></td>
              {COLS.map(([k, l], i) => (
                <td key={k + i} className="px-0.5 align-middle">
                  <input className={`${input} w-full text-center`} inputMode="decimal" value={c[k]} placeholder={inherits ? row.adult[k] : ''} aria-label={`${GROUP_NAMES[g]} ${k.startsWith('m_') ? 'boys / men' : k.startsWith('f_') ? 'girls / women' : 'everyone'} ${l}`} onChange={(e) => put({ [k]: e.target.value })} />
                </td>
              ))}
              <td className="pl-3 align-middle"><input className={`${input} w-full`} value={c.ref_text} placeholder={adult ? 'e.g. Negative' : ''} aria-label={`${GROUP_NAMES[g]} words`} onChange={(e) => put({ ref_text: e.target.value })} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function NormalValuesEditor({ testId, testName, onClose }: { testId: number; testName: string; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]); const [sel, setSel] = useState<number | null>(null);
  const [hasDefault, setHasDefault] = useState(false); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [limits, setLimits] = useState<AgeLimits>(DEFAULT_LIMITS); const [draft, setDraft] = useState<Record<keyof AgeLimits, string> | null>(null);
  const spans = groupSpans(limits);

  const load = (params: ParamRow[], keepIndex?: number) => {
    const rs = params.map(toRow); setRows(rs);
    setSel(rs.length ? rs[Math.min(Math.max(keepIndex ?? 0, 0), rs.length - 1)]._k : null); setDirty(false);
  };
  useEffect(() => {
    window.electronAPI.lab.getParams(testId).then((r) => { if (r.ok) { load(r.params); setHasDefault(r.has_default); } });
    window.electronAPI.lab.getAgeGroups().then((r) => { if (r.ok) setLimits(r.limits); });
  }, [testId]);

  const idx = rows.findIndex((r) => r._k === sel); const cur = idx >= 0 ? rows[idx] : null;
  const edit = (patch: Partial<Row>) => { if (!cur) return; setRows((rs) => rs.map((r) => (r._k === cur._k ? { ...r, ...patch } : r))); setDirty(true); };
  const move = (d: number) => { setRows((rs) => { const a = [...rs]; const j = idx + d; if (idx < 0 || j < 0 || j >= a.length) return a; [a[idx], a[j]] = [a[j], a[idx]]; return a; }); setDirty(true); };
  const remove = () => { if (!cur) return; const next = rows[idx + 1] ?? rows[idx - 1]; setRows((rs) => rs.filter((r) => r._k !== cur._k)); setSel(next ? next._k : null); setDirty(true); };
  const add = () => { const k = Date.now(); setRows((rs) => [...rs, { _k: k, name: '', unit: '', grp: '', no_flag: false, adult: emptyCells(), kids: {} }]); setSel(k); setDirty(true); };

  const save = async () => {
    setBusy(true);
    const r = await window.electronAPI.lab.saveParams(testId, rows.map(payload) as any);
    setBusy(false);
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast('Normal values saved'); load(r.params, idx); qc.invalidateQueries({ queryKey: ['lab-tests'] }); qc.invalidateQueries({ queryKey: ['lab-sheet'] });
  };
  const reset = async () => {
    if (!window.confirm(`Bring back the standard normal values for “${testName}”?\n\nYour changes to this test’s parameters and age groups are replaced. Reports already made are not touched.`)) return;
    const r = await window.electronAPI.lab.resetParams(testId);
    if (!r.ok) { toast(r.error, 'error'); return; } toast('Standard normal values restored'); load(r.params, idx);
  };
  const saveLimits = async () => {
    if (!draft) return;
    const r = await window.electronAPI.lab.saveAgeGroups({ newborn_days: Number(draft.newborn_days), infant_months: Number(draft.infant_months), child_years: Number(draft.child_years), adolescent_years: Number(draft.adolescent_years) });
    if (!r.ok) { toast(r.error, 'error'); return; }
    setLimits(r.limits); setDraft(null); toast('Age limits saved — they apply to every test'); qc.invalidateQueries({ queryKey: ['lab-sheet'] });
  };
  const summary = (r: Row) => rangeText(asNumbers(r.adult) as any, null);
  const lim = (label: string, k: keyof AgeLimits, unit: string) => (
    <label className="flex items-center gap-1.5">{label} <input className={`${input} w-14 text-center`} inputMode="numeric" value={draft![k]} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} /> {unit}</label>
  );

  return (
    <Modal open onClose={onClose} title={`Normal values — ${testName}`} size="2xl">
      <div className="space-y-3">
        <div className="text-xs text-gray-600 dark:text-slate-400 flex items-start gap-1.5">
          <span>Each line on the left is one result the lab types (for a CBC: Hb, TLC, platelets …). For each, give the normal range for an adult and — where it differs — for a newborn, infant, child and adolescent, boys and girls apart. The app picks the right row by itself from the patient’s date of birth and sex.</span>
          <HelpTip title="How the ranges work">A result outside its range is marked High or Low on the screen and on the printed report; a word that is not the normal word is marked Abnormal. Tick “Never flag” for things that are only described (colour, appearance). A row left blank uses the adult range (shown in grey). The standard values are typical ranges — change any of them to match your analyser or kit. A report that was already made keeps the range it was entered against.</HelpTip>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-gray-700 dark:text-slate-200">Age groups</span>
            {(['newborn', 'infant', 'child', 'adolescent', 'adult'] as AgeGroup[]).map((g) => <span key={g}><b className="text-gray-800 dark:text-slate-100">{GROUP_NAMES[g]}</b> <span className="text-gray-500 dark:text-slate-400">{spans[g]}</span></span>)}
            <button type="button" className="ml-auto text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setDraft(draft ? null : { newborn_days: String(limits.newborn_days), infant_months: String(limits.infant_months), child_years: String(limits.child_years), adolescent_years: String(limits.adolescent_years) })}>{draft ? 'Cancel' : 'Change the age limits'}</button>
          </div>
          {draft && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-slate-700 flex flex-wrap items-center gap-x-4 gap-y-2">
              {lim('Newborn: under', 'newborn_days', 'days')}{lim('Infant: under', 'infant_months', 'months')}{lim('Child: under', 'child_years', 'years')}{lim('Adolescent: under', 'adolescent_years', 'years')}
              <button type="button" className="btn-primary text-xs py-1" onClick={saveLimits}>Save limits</button>
              <span className="text-gray-500 dark:text-slate-400">The same for every test. Reports already made are not changed.</span>
            </div>
          )}
        </div>

        <div className="flex gap-4 h-[54vh] min-h-[22rem]">
          <div className="w-64 shrink-0 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700">
            {rows.map((r) => {
              const active = r._k === sel; const kids = kidsFilled(r).length;
              return (
                <button key={r._k} type="button" aria-current={active} onClick={() => setSel(r._k)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-slate-800 last:border-b-0 ${active ? 'bg-blue-50 dark:bg-slate-700/60' : 'hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium truncate ${r.name ? 'text-gray-800 dark:text-slate-100' : 'text-gray-400 italic'}`}>{r.name || 'New parameter'}</span>
                    {kids > 0 && <Baby className="w-3.5 h-3.5 shrink-0 text-indigo-500" aria-label="Has ranges for children" />}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">{[summary(r), r.unit].filter(Boolean).join('  ·  ') || 'no range yet'}</div>
                </button>
              );
            })}
            {rows.length === 0 && <div className="p-4 text-xs text-gray-500">No parameters yet — this test takes one result in one box. Add parameters to give it normal values.</div>}
          </div>

          <div className="flex-1 min-w-0 overflow-auto" key={cur?._k ?? 'none'}>
            {cur ? (
              <div className="space-y-4 pr-1">
                <div className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-5"><label className="label">Parameter</label><input className="input py-1.5" value={cur.name} autoFocus={cur.name === ''} onChange={(e) => edit({ name: e.target.value })} /></div>
                  <div className="col-span-2"><label className="label">Unit</label><input className="input py-1.5" value={cur.unit} onChange={(e) => edit({ unit: e.target.value })} /></div>
                  <div className="col-span-3"><label className="label">Heading</label><input className="input py-1.5" value={cur.grp} placeholder="optional" onChange={(e) => edit({ grp: e.target.value })} /></div>
                  <label className="col-span-2 flex items-center gap-1.5 text-xs pb-2 cursor-pointer"><input type="checkbox" checked={cur.no_flag} onChange={(e) => edit({ no_flag: e.target.checked })} /> Never flag</label>
                </div>
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Normal range, by age group and sex</span>
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">A blank row uses the adult range (grey). Use “Words” where there is no number.</span>
                  </div>
                  <RangeGrid row={cur} spans={spans} onAdult={(p) => edit({ adult: { ...cur.adult, ...p } })} onKid={(g, p) => edit({ kids: { ...cur.kids, [g]: { ...(cur.kids[g] ?? emptyCells()), ...p } } })} />
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-slate-800">
                  <button type="button" className="btn-secondary text-xs" disabled={idx === 0} onClick={() => move(-1)}><ArrowUp className="w-3.5 h-3.5" /> Move up</button>
                  <button type="button" className="btn-secondary text-xs" disabled={idx === rows.length - 1} onClick={() => move(1)}><ArrowDown className="w-3.5 h-3.5" /> Move down</button>
                  <button type="button" className="btn-secondary text-xs text-red-600 ml-auto" onClick={remove}><Trash2 className="w-3.5 h-3.5" /> Remove this parameter</button>
                </div>
              </div>
            ) : <div className="h-full flex items-center justify-center text-sm text-gray-400">Choose a parameter on the left, or add one.</div>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={add}><Plus className="w-3.5 h-3.5" /> Add parameter</button>
            {hasDefault && <button className="btn-secondary text-xs" onClick={reset} title="Replace this test's parameters with the standard ones"><RotateCcw className="w-3.5 h-3.5" /> Reset to standard values</button>}
          </div>
          <div className="flex gap-2"><button className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary" disabled={!dirty || busy} onClick={save}><Save className="w-4 h-4" /> Save</button></div>
        </div>
      </div>
    </Modal>
  );
}
