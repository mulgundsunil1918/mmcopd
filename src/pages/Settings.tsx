import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Stethoscope, Plus, Pencil } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useToast } from '../hooks/useToast';
import type { Doctor, Settings } from '../types';

export function SettingsPage() {
  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Settings</h1>
        <p className="text-xs text-gray-500">Clinic info, doctors, and appointment preferences.</p>
      </div>
      <ClinicInfo />
      <DoctorsManagement />
      <AppointmentPrefs />
    </div>
  );
}

function ClinicInfo() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
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
      <div className="grid grid-cols-2 gap-4">
        <LazyInput label="Clinic Name *" value={settings.clinic_name} onSave={(v) => save.mutate({ clinic_name: v })} />
        <LazyInput label="Tagline" value={settings.clinic_tagline} onSave={(v) => save.mutate({ clinic_tagline: v })} />
        <LazyInput label="Phone" value={settings.clinic_phone} onSave={(v) => save.mutate({ clinic_phone: v })} />
        <LazyInput label="Email" value={settings.clinic_email} onSave={(v) => save.mutate({ clinic_email: v })} />
        <div className="col-span-2">
          <LazyInput label="Address" value={settings.clinic_address} onSave={(v) => save.mutate({ clinic_address: v })} />
        </div>
        <LazyInput label="Registration No." value={settings.clinic_registration_no} onSave={(v) => save.mutate({ clinic_registration_no: v })} />
      </div>
    </section>
  );
}

function AppointmentPrefs() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Saved'); },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Appointment Preferences</h2>
      </div>
      <div className="flex items-center gap-4">
        <label className="label mb-0">Slot Duration</label>
        <select
          className="input w-auto"
          value={settings.slot_duration}
          onChange={(e) => save.mutate({ slot_duration: Number(e.target.value) as any })}
        >
          <option value={15}>15 min</option>
          <option value={20}>20 min</option>
          <option value={30}>30 min</option>
        </select>
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
          <Stethoscope className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900">Doctors</h2>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, default_fee: 500 })}>
          <Plus className="w-4 h-4" /> Add Doctor
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
            <th className="py-2">Name</th>
            <th className="py-2">Specialty</th>
            <th className="py-2">Room</th>
            <th className="py-2 text-right">Fee</th>
            <th className="py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d) => (
            <tr key={d.id} className="border-b border-gray-100">
              <td className="py-2 font-medium">{d.name}</td>
              <td className="py-2 text-gray-600">{d.specialty}</td>
              <td className="py-2 text-gray-600">{d.room_number || '—'}</td>
              <td className="py-2 text-right">₹{d.default_fee}</td>
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

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Doctor' : 'Add Doctor'}>
        {editing && (
          <div className="space-y-3">
            <Field label="Name *">
              <input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Specialty *">
              <input className="input" value={editing.specialty || ''} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
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
            <label className="flex items-center gap-2 text-sm">
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
