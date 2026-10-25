/**
 * Pharmacy → Drug List → "Set GST %": the clinic decides the GST rate of its medicines — the software never moves a rate by itself.
 * Three ways: the medicines that are ticked, every medicine now at one rate (e.g. all at 12% → 5%), or the whole list. Only the rate changes;
 * bills already made keep the tax they were made with.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { DRUG_QUERY_KEYS } from './DrugEditModal';

const RATES = [0, 5, 12, 18, 28];

export function SetGstModal({ selectedIds, onClose, onDone }: { selectedIds: number[]; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['pharmacy-gst-summary'], queryFn: () => window.electronAPI.pharmacy.gstSummary() });
  const counts = new Map((data?.by_rate ?? []).map((r) => [r.rate, r.count]));
  const hasSel = selectedIds.length > 0;
  const [scope, setScope] = useState<'selected' | 'from' | 'all'>(hasSel ? 'selected' : 'from');
  const [from, setFrom] = useState<number>(12);
  const [to, setTo] = useState<number | ''>('');
  const [err, setErr] = useState('');

  const how = scope === 'selected' ? `${selectedIds.length} ticked medicine${selectedIds.length === 1 ? '' : 's'}`
    : scope === 'from' ? `all ${counts.get(from) ?? 0} medicine${(counts.get(from) ?? 0) === 1 ? '' : 's'} now at ${from}%` : `all ${data?.total ?? 0} medicines`;

  const go = useMutation({
    mutationFn: () => window.electronAPI.pharmacy.setDrugGst({ rate: to as number, ids: scope === 'selected' ? selectedIds : null, from_rate: scope === 'from' ? from : null }),
    onSuccess: (r) => {
      if (!r.ok) { setErr(r.error || 'Could not change the GST rate.'); return; }
      for (const k of [...DRUG_QUERY_KEYS, 'pharmacy-gst-summary']) qc.invalidateQueries({ queryKey: [k] });
      toast(`GST set to ${to}% on ${r.changed} medicine${r.changed === 1 ? '' : 's'}${r.unchanged ? ` (${r.unchanged} already had it)` : ''}`);
      onDone?.();
      onClose();
    },
    onError: (e: any) => setErr(e?.message || 'Could not change the GST rate.'),
  });

  return (
    <Modal open onClose={() => { if (!go.isPending) onClose(); }} title="Set GST % on medicines" size="md">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-600 dark:text-slate-300">
          You decide the GST rate of your medicines — the software never changes a rate on its own. Only the rate changes; bills already made keep the tax they were made with.
        </p>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {RATES.filter((r) => counts.has(r)).map((r) => <span key={r} className="rounded-full bg-gray-100 dark:bg-slate-700 px-2 py-0.5"><b>{counts.get(r)}</b> at {r}%</span>)}
        </div>
        <div className="space-y-2">
          {hasSel && (
            <label className="flex items-center gap-2"><input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> <span>The <b>{selectedIds.length}</b> medicine{selectedIds.length === 1 ? '' : 's'} I ticked</span></label>
          )}
          <label className="flex items-center gap-2 flex-wrap"><input type="radio" checked={scope === 'from'} onChange={() => setScope('from')} />
            <span>Every medicine that is now at</span>
            <select className="input w-auto py-1" value={from} onChange={(e) => { setFrom(Number(e.target.value)); setScope('from'); }}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
          </label>
          <label className="flex items-center gap-2"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> <span>The <b>whole</b> Drug List ({data?.total ?? '…'} medicines)</span></label>
        </div>
        <div className="flex items-center gap-2">
          <span>Change them to</span>
          <select className={`input w-auto py-1 ${to === '' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : ''}`} value={to} onChange={(e) => { setTo(e.target.value === '' ? '' : Number(e.target.value)); setErr(''); }}>
            {to === '' && <option value="">— choose —</option>}
            {RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
        {err && <div className="text-xs text-red-600" role="alert">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={go.isPending}>Cancel</button>
          <button className="btn-primary" disabled={go.isPending || to === '' || (scope === 'from' && from === to)} onClick={() => { setErr(''); go.mutate(); }}>
            {go.isPending ? 'Changing…' : `Set ${how} to ${to === '' ? '…' : to + '%'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
