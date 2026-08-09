import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Plus, Trash2, Loader2, Pencil, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

/** Ward types offered in the picker, with the rate hint each usually carries. */
const WARD_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'general',       label: 'General',        hint: 'Shared ward, lowest daily rate' },
  { value: 'semi_private',  label: 'Semi-private',   hint: 'Two to four beds per room' },
  { value: 'private',       label: 'Private',        hint: 'Single room' },
  { value: 'icu',           label: 'ICU',            hint: 'Intensive care, highest daily rate' },
  { value: 'nicu',          label: 'NICU',           hint: 'Neonatal intensive care' },
  { value: 'maternity',     label: 'Maternity',      hint: 'Labour and post-natal' },
  { value: 'daycare',       label: 'Day care',       hint: 'Short stay, discharged same day' },
];

const WARD_COLOURS = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#d97706', '#059669', '#dc2626', '#475569'];

export function WardsBedsEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [addingBedTo, setAddingBedTo] = useState<number | null>(null);
  const [bedNumbers, setBedNumbers] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: wards = [], refetch } = useQuery({
    queryKey: ['wards'],
    queryFn: () => window.electronAPI.wards.list(true),
  });

  const reload = async () => {
    await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['beds-map'] })]);
  };

  const saveWard = async (w: any) => {
    setBusy(true);
    try {
      const r = await window.electronAPI.wards.save(w);
      if (r.ok) { toast(w.id ? 'Ward updated' : 'Ward added', 'success'); setEditing(null); await reload(); }
      else toast(r.error, 'error');   // backend messages are already user-facing
    } catch (e: any) {
      toast(e?.message || 'Could not save the ward', 'error');
    } finally { setBusy(false); }
  };

  const removeWard = async (id: number, name: string) => {
    setBusy(true);
    try {
      const r = await window.electronAPI.wards.remove(id);
      if (r.ok) { toast(`"${name}" removed`, 'success'); await reload(); }
      else toast(r.error || 'Could not remove the ward', 'error');
    } finally { setBusy(false); }
  };

  /** Accepts "G-01, G-02" or a range like "G-1..G-6" so a ward can be filled in one go. */
  const addBeds = async (wardId: number) => {
    const raw = bedNumbers.trim();
    if (!raw) { toast('Type at least one bed number', 'error'); return; }
    const range = /^(.*?)(\d+)\.\.(?:.*?)(\d+)$/.exec(raw);
    let list: string[];
    if (range) {
      const [, prefix, fromS, toS] = range;
      const from = parseInt(fromS, 10), to = parseInt(toS, 10);
      if (to < from || to - from > 200) { toast('That range looks wrong — keep it under 200 beds', 'error'); return; }
      const width = fromS.length;
      list = Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(width, '0')}`);
    } else {
      list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }

    setBusy(true);
    const failures: string[] = [];
    for (const bed_number of list) {
      const r = await window.electronAPI.beds.save({ ward_id: wardId, bed_number });
      if (!r.ok) failures.push(`${bed_number}: ${r.error}`);
    }
    setBusy(false);
    setBedNumbers('');
    setAddingBedTo(null);
    await reload();
    if (failures.length === 0) toast(`${list.length} bed(s) added`, 'success');
    else toast(`${list.length - failures.length} added. ${failures.length} skipped — ${failures[0]}`, 'error');
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Wards &amp; Beds</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Set up the wards in your hospital and the beds in each. The daily rates here are charged automatically
            to every admitted patient, once per day, until they are discharged.
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={() => setEditing({ ward_type: 'general', per_day_rate: 0, nursing_per_day: 0, colour: WARD_COLOURS[0] })}>
          <Plus className="w-3.5 h-3.5" /> Add ward
        </button>
      </div>

      {wards.length === 0 && !editing && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-700 p-6 text-center">
          <BedDouble className="w-7 h-7 mx-auto text-gray-400 mb-2" />
          <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No wards yet</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
            Add your first ward — for example "General Ward" at ₹1,500 a day — then add its beds.
            Patients cannot be admitted until at least one bed exists.
          </div>
        </div>
      )}

      {editing && (
        <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold text-blue-900 dark:text-blue-200">
              {editing.id ? `Edit "${editing.name}"` : 'New ward'}
            </div>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}><X className="w-3.5 h-3.5" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Ward name *</label>
              <input className="input" value={editing.name || ''} placeholder="e.g. General Ward"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={editing.ward_type}
                onChange={(e) => setEditing({ ...editing, ward_type: e.target.value })}>
                {WARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="text-[10px] text-gray-500 mt-1">
                {WARD_TYPES.find((t) => t.value === editing.ward_type)?.hint}
              </div>
            </div>
            <div>
              <label className="label">Bed charge per day (₹)</label>
              <input className="input" type="number" min={0} value={editing.per_day_rate ?? 0}
                onChange={(e) => setEditing({ ...editing, per_day_rate: Number(e.target.value) })} />
              <div className="text-[10px] text-gray-500 mt-1">
                Added to the patient's bill once every day they occupy a bed here. Set 0 if you don't charge for beds.
              </div>
            </div>
            <div>
              <label className="label">Nursing charge per day (₹)</label>
              <input className="input" type="number" min={0} value={editing.nursing_per_day ?? 0}
                onChange={(e) => setEditing({ ...editing, nursing_per_day: Number(e.target.value) })} />
              <div className="text-[10px] text-gray-500 mt-1">
                Charged separately from the bed. Leave 0 if nursing is included in your bed rate.
              </div>
            </div>
          </div>

          <div>
            <label className="label">Colour on the ward map</label>
            <div className="flex gap-2 flex-wrap mt-1">
              {WARD_COLOURS.map((c) => (
                <button key={c} type="button" onClick={() => setEditing({ ...editing, colour: c })}
                  className={cn('w-7 h-7 rounded-md border-2 transition',
                    editing.colour === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent')}
                  style={{ background: c }} aria-label={`Colour ${c}`} />
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary text-xs" disabled={busy} onClick={() => saveWard(editing)}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save ward
            </button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {wards.map((w: any) => (
          <div key={w.id} className={cn('rounded-lg border-2 p-3',
            w.is_active ? 'border-gray-200 dark:border-slate-700' : 'border-gray-200 dark:border-slate-800 opacity-50')}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: w.colour || '#94a3b8' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                  {w.name}
                  {!w.is_active && <span className="ml-2 text-[10px] font-normal text-gray-500">(removed)</span>}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  {WARD_TYPES.find((t) => t.value === w.ward_type)?.label || w.ward_type}
                  {' · '}₹{w.per_day_rate}/day bed
                  {w.nursing_per_day > 0 && ` + ₹${w.nursing_per_day}/day nursing`}
                  {' · '}<b>{w.occupied_count}</b> of <b>{w.bed_count}</b> beds occupied
                </div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setAddingBedTo(addingBedTo === w.id ? null : w.id)}>
                <Plus className="w-3.5 h-3.5" /> Beds
              </button>
              <button className="btn-ghost text-xs" onClick={() => setEditing(w)}><Pencil className="w-3.5 h-3.5" /></button>
              {w.is_active && (
                <button className="btn-ghost text-xs text-red-600" disabled={busy} onClick={() => removeWard(w.id, w.name)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {addingBedTo === w.id && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">
                <label className="label">Bed numbers</label>
                <div className="flex gap-2">
                  <input className="input flex-1" value={bedNumbers} placeholder="G-01, G-02, G-03   or a range like  G-01..G-10"
                    onChange={(e) => setBedNumbers(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addBeds(w.id); }} />
                  <button className="btn-primary text-xs" disabled={busy} onClick={() => addBeds(w.id)}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
                  </button>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                  Type a comma-separated list, or a range such as <code>G-01..G-10</code> to create ten beds at once.
                  Bed numbers must be unique within a ward.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
