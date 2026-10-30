/** Lab → Test Catalogue → Normal values: what a test is made of and what is normal for each part. The defaults come ready; the lab edits or resets them. */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { HelpTip } from '../HelpTip';
import { useToast } from '../../hooks/useToast';
import type { ParamRow } from '../../db/labParams';

type Row = Partial<ParamRow> & { _k: number };
const numText = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const toNum = (t: string): number | null => (t.trim() === '' || !Number.isFinite(Number(t)) ? null : Number(t));

export function NormalValuesEditor({ testId, testName, onClose }: { testId: number; testName: string; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]); const [hasDefault, setHasDefault] = useState(false); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const load = (params: ParamRow[]) => { setRows(params.map((p, i) => ({ ...p, _k: i }))); setDirty(false); };
  useEffect(() => { window.electronAPI.lab.getParams(testId).then((r) => { if (r.ok) { load(r.params); setHasDefault(r.has_default); } }); }, [testId]);
  const set = (k: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r._k === k ? { ...r, ...patch } : r))); setDirty(true); };
  const move = (i: number, d: number) => { setRows((rs) => { const a = [...rs]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }); setDirty(true); };
  const save = async () => {
    setBusy(true);
    const r = await window.electronAPI.lab.saveParams(testId, rows.map(({ _k, ...p }) => p));
    setBusy(false);
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast('Normal values saved'); load(r.params); qc.invalidateQueries({ queryKey: ['lab-tests'] }); qc.invalidateQueries({ queryKey: ['lab-sheet'] });
  };
  const reset = async () => {
    if (!window.confirm(`Bring back the standard normal values for “${testName}”?\n\nYour changes to this test’s parameters are replaced. Reports already made are not touched.`)) return;
    const r = await window.electronAPI.lab.resetParams(testId);
    if (!r.ok) { toast(r.error, 'error'); return; } toast('Standard normal values restored'); load(r.params);
  };
  const cell = 'input py-1 px-1.5 text-xs';
  return (
    <Modal open onClose={onClose} title={`Normal values — ${testName}`} size="xl">
      <div className="space-y-3">
        <div className="text-xs text-gray-600 dark:text-slate-400 flex items-center gap-1.5">
          Each line is one result the lab types (for a CBC: Hb, TLC, platelets …). Give the normal range, the same for everyone or one for men and one for women, or a normal word such as “Negative”.
          <HelpTip title="How the ranges work">A result outside the range is marked High or Low on the screen and on the printed report; a word that is not the normal word is marked Abnormal. Tick “Never flag” for things that are only described (colour, appearance). The standard values are typical adult ranges — change any of them to match your analyser or kit. A report that was already made keeps the range it was entered against.</HelpTip>
        </div>
        <div className="overflow-auto max-h-[55vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr className="text-left text-[10px] uppercase text-gray-500">
              <th className="py-1 w-[22%]">Parameter</th><th className="w-[8%]">Unit</th><th colSpan={2} className="text-center">Everyone</th><th colSpan={2} className="text-center">Men</th><th colSpan={2} className="text-center">Women</th><th>Normal word</th><th>Heading</th><th>Never flag</th><th></th></tr>
              <tr className="text-[10px] text-gray-400"><th></th><th></th><th>from</th><th>to</th><th>from</th><th>to</th><th>from</th><th>to</th><th colSpan={4}></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._k} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1"><input className={cell} value={r.name ?? ''} onChange={(e) => set(r._k, { name: e.target.value })} /></td>
                  <td><input className={cell} value={r.unit ?? ''} onChange={(e) => set(r._k, { unit: e.target.value })} /></td>
                  {(['low', 'high', 'm_low', 'm_high', 'f_low', 'f_high'] as const).map((k) => <td key={k}><input className={cell + ' w-14'} inputMode="decimal" value={numText(r[k])} onChange={(e) => set(r._k, { [k]: toNum(e.target.value) } as any)} /></td>)}
                  <td><input className={cell} value={r.ref_text ?? ''} placeholder="e.g. Negative" onChange={(e) => set(r._k, { ref_text: e.target.value })} /></td>
                  <td><input className={cell} value={r.grp ?? ''} placeholder="optional" onChange={(e) => set(r._k, { grp: e.target.value })} /></td>
                  <td className="text-center"><input type="checkbox" checked={!!r.no_flag} onChange={(e) => set(r._k, { no_flag: e.target.checked as any })} /></td>
                  <td className="whitespace-nowrap"><button className="p-1 text-gray-400 hover:text-gray-700" onClick={() => move(i, -1)} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button className="p-1 text-gray-400 hover:text-gray-700" onClick={() => move(i, 1)} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button className="p-1 text-gray-400 hover:text-red-600" onClick={() => { setRows((rs) => rs.filter((x) => x._k !== r._k)); setDirty(true); }} title="Remove"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-gray-500">No parameters yet — this test takes one result in one box. Add parameters to give it normal values.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => { setRows((rs) => [...rs, { _k: Date.now(), name: '' }]); setDirty(true); }}><Plus className="w-3.5 h-3.5" /> Add parameter</button>
            {hasDefault && <button className="btn-secondary text-xs" onClick={reset} title="Replace this test's parameters with the standard ones"><RotateCcw className="w-3.5 h-3.5" /> Reset to standard values</button>}
          </div>
          <div className="flex gap-2"><button className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary" disabled={!dirty || busy} onClick={save}><Save className="w-4 h-4" /> Save</button></div>
        </div>
      </div>
    </Modal>
  );
}
