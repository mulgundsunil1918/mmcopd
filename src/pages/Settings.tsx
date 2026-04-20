import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Stethoscope, Plus, Pencil, Wallet, ListChecks } from 'lucide-react';
import { cn } from '../lib/utils';
import { Modal } from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { ProviderSettings } from '../components/ProviderSettings';
import { useToast } from '../hooks/useToast';
import { INDIAN_STATES } from '../lib/india';
import type { Doctor, Settings } from '../types';

export function SettingsPage() {
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Settings</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">Clinic branding, fees, queue flow, and doctor management.</p>
      </div>
      <ClinicInfo />
      <DefaultLocation />
      <FeesAndFlow />
      <DoctorsManagement />
      <ProviderSettings />
    </div>
  );
}

function DefaultLocation() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Settings>(['settings']);
      if (prev) qc.setQueryData(['settings'], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev); toast('Save failed', 'error'); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Saved'); },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">Default Location & Known Villages</h2>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        These pre-fill on every new patient so the receptionist only types the village. Known villages appear as autocomplete suggestions.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Default State</label>
          <select
            className="input"
            value={settings.default_state}
            onChange={(e) => save.mutate({ default_state: e.target.value })}
          >
            <option value="">—</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <LazyInput label="Default District" value={settings.default_district} onSave={(v) => save.mutate({ default_district: v })} />
        <div className="col-span-2">
          <LazyInput
            label="Known Villages / Places (comma-separated)"
            value={settings.known_villages}
            onSave={(v) => save.mutate({ known_villages: v })}
          />
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
            e.g. <i>Mulgund, Gadag, Lakshmeshwar, Naregal, Shirahatti</i> — these show as autocomplete in the Reception Place field.
          </div>
        </div>
      </div>
    </section>
  );
}

function ClinicInfo() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Settings>(['settings']);
      if (prev) qc.setQueryData(['settings'], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
      toast('Save failed', 'error');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['clinic-name'] });
      qc.invalidateQueries({ queryKey: ['clinic-name-title'] });
      toast('Saved');
    },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-4 h-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Clinic Info</h2>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">These appear on the OPD slip letterhead and invoices.</p>

      <div className="flex gap-6">
        <ImageUpload
          label="Clinic Logo"
          value={settings.clinic_logo}
          onChange={(v) => save.mutate({ clinic_logo: v || '' })}
          aspect="square"
          placeholder="Click or drop"
          hint="⚠ Upload a high-quality logo (JPG / PNG). Max 5 MB. Square images look best; they appear on the OPD slip, invoice, and sidebar."
        />
        <div className="flex-1 grid grid-cols-2 gap-4">
          <LazyInput label="Clinic Name *" value={settings.clinic_name} onSave={(v) => save.mutate({ clinic_name: v })} />
          <LazyInput label="Tagline" value={settings.clinic_tagline} onSave={(v) => save.mutate({ clinic_tagline: v })} />
          <LazyInput label="Phone" value={settings.clinic_phone} onSave={(v) => save.mutate({ clinic_phone: v })} />
          <LazyInput label="Email" value={settings.clinic_email} onSave={(v) => save.mutate({ clinic_email: v })} />
          <div className="col-span-2">
            <LazyInput label="Address" value={settings.clinic_address} onSave={(v) => save.mutate({ clinic_address: v })} />
          </div>
          <LazyInput label="Registration No." value={settings.clinic_registration_no} onSave={(v) => save.mutate({ clinic_registration_no: v })} />
        </div>
      </div>
    </section>
  );
}

function FeesAndFlow() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => {
      // optimistic: apply immediately so the toggle feels instant
      const prev = qc.getQueryData<Settings>(['settings']);
      if (prev) qc.setQueryData(['settings'], { ...prev, ...patch });
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
      toast('Save failed', 'error');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Saved'); },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wallet className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Fees & Queue Flow</h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <LazyInput
          label="Regular Consultation Fee (₹)"
          value={String(settings.consultation_fee)}
          onSave={(v) => save.mutate({ consultation_fee: Number(v) as any })}
        />
        <LazyInput
          label="Special Price (₹)"
          value={String(settings.special_price)}
          onSave={(v) => save.mutate({ special_price: Number(v) as any })}
        />
        <div>
          <label className="label">Slot Duration</label>
          <select
            className="input"
            value={settings.slot_duration}
            onChange={(e) => save.mutate({ slot_duration: Number(e.target.value) as any })}
          >
            <option value={15}>15 min</option>
            <option value={20}>20 min</option>
            <option value={30}>30 min</option>
          </select>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-4">
        <div className="flex items-start gap-3">
          <ListChecks className="w-4 h-4 text-indigo-600 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Queue Flow (Waiting / In Progress / Done)</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
              When off, every appointment is marked Done on booking — status counters and doctor-side queue buttons hide. Turn on if you want to track the live queue during the day.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => save.mutate({ queue_flow_enabled: !settings.queue_flow_enabled })}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            settings.queue_flow_enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={settings.queue_flow_enabled}
          title={settings.queue_flow_enabled ? 'Queue flow ON — click to disable' : 'Queue flow OFF — click to enable'}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              settings.queue_flow_enabled ? 'left-[26px]' : 'left-0.5'
            )}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>
    </section>
  );
}

function DoctorsManagement() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Doctor> | null>(null);

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-all'],
    queryFn: () => window.electronAPI.doctors.list(false),
  });

  const saveMut = useMutation({
    mutationFn: (d: Partial<Doctor>) =>
      d.id ? window.electronAPI.doctors.update(d.id, d) : window.electronAPI.doctors.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] });
      qc.invalidateQueries({ queryKey: ['doctors-all'] });
      toast('Doctor saved');
      setEditing(null);
    },
  });

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-purple-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Doctors</h2>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, default_fee: 500 })}>
          <Plus className="w-4 h-4" /> Add Doctor
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 dark:border-slate-700 text-xs uppercase text-gray-500 dark:text-slate-400">
            <th className="py-2">Name</th>
            <th className="py-2">Specialty</th>
            <th className="py-2">Room</th>
            <th className="py-2 text-right">Fee</th>
            <th className="py-2">Signature</th>
            <th className="py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d) => (
            <tr key={d.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-2 font-medium text-gray-900 dark:text-slate-100">{d.name}</td>
              <td className="py-2 text-gray-600 dark:text-slate-300">{d.specialty}</td>
              <td className="py-2 text-gray-600 dark:text-slate-300">{d.room_number || '—'}</td>
              <td className="py-2 text-right">₹{d.default_fee}</td>
              <td className="py-2">
                {d.signature ? (
                  <img src={d.signature} className="h-6 object-contain" alt="signature" />
                ) : (
                  <span className="text-[11px] text-gray-400">—</span>
                )}
              </td>
              <td className="py-2">
                <span className={d.is_active ? 'badge bg-green-100 text-green-700' : 'badge bg-gray-200 text-gray-600'}>
                  {d.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="py-2 text-right">
                <button className="btn-ghost text-xs" onClick={() => setEditing(d)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Doctor' : 'Add Doctor'} size="lg">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name *">
                <input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Specialty *">
                <input className="input" value={editing.specialty || ''} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </Field>
              <Field label="Room Number">
                <input className="input" value={editing.room_number || ''} onChange={(e) => setEditing({ ...editing, room_number: e.target.value })} />
              </Field>
              <Field label="Default Fee (₹)">
                <input type="number" className="input" value={editing.default_fee || 0} onChange={(e) => setEditing({ ...editing, default_fee: Number(e.target.value) })} />
              </Field>
            </div>

            <ImageUpload
              label="Doctor's Signature (shown on OPD slip)"
              value={editing.signature}
              onChange={(v) => setEditing({ ...editing, signature: v })}
              aspect="wide"
              placeholder="Upload JPG / PNG signature"
              hint="⚠ Upload a high-quality signature (JPG / PNG). Max 5 MB. Prefer a transparent PNG or white background for best print clarity."
            />

            <label className="flex items-center gap-2 text-sm pt-2">
              <input
                type="checkbox"
                checked={editing.is_active === 1}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })}
              />
              <span>Active</span>
            </label>
            <div className="flex justify-end gap-2 pt-4">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending}>
                {saveMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function LazyInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
    </div>
  );
}
