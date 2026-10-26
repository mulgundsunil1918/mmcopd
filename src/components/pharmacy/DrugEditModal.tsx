/**
 * Add or edit a drug in the Drug List. One form, opened from the Drug List tab and from "Drugs in my clinic" (Edit on a row),
 * so a drug's facts — name, schedule, GST, MRP, the low-stock level — are edited in exactly one way.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { Field } from './shared';
import type { DrugMaster, DrugSchedule } from '../../types';
import { SameMedicineNote } from './SameMedicineNote';

export const SCHEDULES: { value: DrugSchedule; label: string }[] = [
  { value: 'OTC', label: 'OTC (over the counter)' },
  { value: 'H', label: 'H (Rx required)' },
  { value: 'H1', label: 'H1 (Rx + register entry)' },
  { value: 'G', label: 'G (caution: hospital use)' },
  { value: 'X', label: 'X (narcotic — locked storage)' },
];

/** Every list that shows drugs or their stock refreshes after a drug is saved. */
export const DRUG_QUERY_KEYS = ['pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-alerts', 'pharmacy-clinic-stock'];

export function DrugEditModal({ drug, onClose, brandOf }: { drug: Partial<DrugMaster>; onClose: () => void; /** The medicine this new drug is another brand of (when added with "Brand"). */ brandOf?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<DrugMaster>>(drug);
  // GST is the clinic's decision: a NEW medicine starts with the clinic's own default if it set one, else the form asks (nothing is assumed).
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  useEffect(() => {
    if (!drug.id && drug.gst_rate === undefined && settings && settings.default_drug_gst_rate !== null && settings.default_drug_gst_rate !== undefined) {
      setEditing((e) => (e.gst_rate === undefined ? { ...e, gst_rate: settings.default_drug_gst_rate as number } : e));
    }
  }, [settings]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (d: Partial<DrugMaster>) => window.electronAPI.pharmacy.upsertDrug(d),
    onSuccess: () => {
      for (const k of DRUG_QUERY_KEYS) qc.invalidateQueries({ queryKey: [k] });
      toast('Saved');
      onClose();
    },
    onError: (e: any) => {
      const m = String(e?.message || e);
      toast(/UNIQUE/i.test(m) ? `"${editing.name}" is already in the Drug List.` : m, 'error');
    },
  });

  return (
    <Modal open onClose={onClose} title={editing.id ? 'Edit Drug' : brandOf ? 'Add another brand' : 'Add Drug to the Drug List'} size="lg">
      <div className="space-y-3">
        {brandOf && !editing.id && (
          <div className="text-[12px] rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100 px-2.5 py-1.5">
            Another brand of <b>{brandOf}</b>. The ingredient, strength, form, schedule and GST are copied so it sits with the same medicine — type this brand&rsquo;s own name and MRP.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *"><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Generic Name"><input className="input" value={editing.generic_name || ''} onChange={(e) => setEditing({ ...editing, generic_name: e.target.value })} /></Field>
          <Field label="Manufacturer"><input className="input" placeholder="e.g. GSK / Cipla" value={editing.manufacturer || ''} onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })} /></Field>
          <Field label="Schedule">
            <select className="input" value={editing.schedule || 'OTC'} onChange={(e) => setEditing({ ...editing, schedule: e.target.value as DrugSchedule })}>
              {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Form"><input className="input" placeholder="Tab / Syrup / Inj" value={editing.form || ''} onChange={(e) => setEditing({ ...editing, form: e.target.value })} /></Field>
          <Field label="Strength"><input className="input" placeholder="500mg / 10mg" value={editing.strength || ''} onChange={(e) => setEditing({ ...editing, strength: e.target.value })} /></Field>
          <Field label="Pack Size"><input type="number" className="input" placeholder="10 (tabs/strip)" value={editing.pack_size ?? ''} onChange={(e) => setEditing({ ...editing, pack_size: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Default MRP (₹)"><input type="number" className="input" value={editing.default_mrp ?? 0} onChange={(e) => setEditing({ ...editing, default_mrp: Number(e.target.value) })} /></Field>
          <Field label="HSN Code"><input className="input" placeholder="30049099" value={editing.hsn_code || ''} onChange={(e) => setEditing({ ...editing, hsn_code: e.target.value })} /></Field>
          <Field label="GST Rate (%) *">
            <select className={`input ${editing.gst_rate === undefined ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : ''}`} value={editing.gst_rate ?? ''}
              onChange={(e) => setEditing({ ...editing, gst_rate: e.target.value === '' ? undefined : Number(e.target.value) })}>
              {editing.gst_rate === undefined && <option value="">— choose the GST % —</option>}
              {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
            {editing.gst_rate === undefined && <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">You decide the GST % — nothing is assumed. (Pharmacy → Settings → Billing can set a starting rate.)</div>}
          </Field>
          <Field label="Barcode (EAN/UPC)"><input className="input" placeholder="optional" value={editing.barcode || ''} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} /></Field>
          <Field label="Low-stock Threshold"><input type="number" className="input" value={editing.low_stock_threshold ?? 10} onChange={(e) => setEditing({ ...editing, low_stock_threshold: Number(e.target.value) })} /></Field>
        </div>
        <SameMedicineNote id={editing.id} generic={editing.generic_name} strength={editing.strength} form={editing.form} />
        <Field label="Notes">
          <textarea className="input" rows={2} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm pt-1">
          <input type="checkbox" checked={editing.is_active === 1} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
          <span>Active (shows up in dispense + alerts)</span>
        </label>
        <div className="flex justify-end gap-2 pt-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name || editing.gst_rate === undefined}>
            {save.isPending ? 'Saving…' : 'Save Drug'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
