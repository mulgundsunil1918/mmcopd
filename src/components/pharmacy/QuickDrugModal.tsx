/**
 * Add a drug to the Drug List without leaving the screen that needs it (the purchase bill). Only what is needed to stock and sell
 * it — name, form, strength, schedule, GST, MRP — everything else can be filled in later in Pharmacy → Drug List.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import type { DrugMaster, DrugSchedule } from '../../types';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Drops', 'Injection', 'Ointment', 'Cream', 'Gel', 'Inhaler', 'Powder', 'Sachet', 'Other'];
const SCHEDULES: { value: DrugSchedule; label: string }[] = [
  { value: 'OTC', label: 'OTC (over the counter)' }, { value: 'H', label: 'H (prescription needed)' }, { value: 'H1', label: 'H1 (prescription + register)' },
  { value: 'G', label: 'G (caution)' }, { value: 'X', label: 'X (narcotic)' },
];

export function QuickDrugModal({ initialName = '', onClose, onCreated }: {
  initialName?: string; onClose: () => void; onCreated: (d: DrugMaster) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: initialName, generic: '', form: 'Tablet', strength: '', schedule: 'OTC' as DrugSchedule, hsn: '', gst: 12, mrp: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const name = f.name.trim().replace(/\s+/g, ' ');

  const save = async () => {
    if (!name) { setErr('Type the drug\'s name.'); return; }
    setBusy(true); setErr(null);
    try {
      const d = await window.electronAPI.pharmacy.upsertDrug({
        name, generic_name: f.generic.trim() || null, form: f.form || null, strength: f.strength.trim() || null,
        schedule: f.schedule, hsn_code: f.hsn.trim() || null, gst_rate: Number(f.gst) || 0, default_mrp: Number(f.mrp) || 0,
      } as any);
      await Promise.all(['pharmacy-drugs-active', 'pharmacy-drugs'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(`${name} added to the Drug List`, 'success');
      onCreated(d);
    } catch (e: any) {
      const m = String(e?.message || e);
      setErr(/UNIQUE/i.test(m) ? `"${name}" is already in the Drug List — pick it from the list.` : m);
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add this drug to the Drug List" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="label">Drug name *</label>
            <input className="input" autoFocus value={f.name} maxLength={120} placeholder="e.g. Diclofenac 75mg Injection" onChange={(e) => set('name', e.target.value)} />
          </div>
          <div><label className="label">Generic name</label><input className="input" value={f.generic} maxLength={120} onChange={(e) => set('generic', e.target.value)} /></div>
          <div><label className="label">Strength</label><input className="input" value={f.strength} maxLength={40} placeholder="75mg" onChange={(e) => set('strength', e.target.value)} /></div>
          <div>
            <label className="label">Form</label>
            <select className="input" value={f.form} onChange={(e) => set('form', e.target.value)}>{FORMS.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
          <div>
            <label className="label">Schedule</label>
            <select className="input" value={f.schedule} onChange={(e) => set('schedule', e.target.value)}>
              {SCHEDULES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">GST %</label>
            <select className="input" value={f.gst} onChange={(e) => set('gst', Number(e.target.value))}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}</option>)}</select>
          </div>
          <div><label className="label">HSN code</label><input className="input" value={f.hsn} maxLength={12} onChange={(e) => set('hsn', e.target.value)} /></div>
          <div><label className="label">MRP per unit (₹)</label><input className="input" type="number" min={0} step="0.01" value={f.mrp} onChange={(e) => set('mrp', e.target.value)} /></div>
        </div>
        {err && <div className="text-[12px] text-red-600" role="alert">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name} onClick={save}>{busy ? 'Saving…' : 'Add to Drug List'}</button>
        </div>
      </div>
    </Modal>
  );
}
