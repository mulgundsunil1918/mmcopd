import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Stethoscope, Plus, Pencil, Wallet, ListChecks, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { ProviderSettings } from '../components/ProviderSettings';
import { AdminGate } from '../components/AdminGate';
import { useToast } from '../hooks/useToast';
import { INDIAN_STATES } from '../lib/india';
import type { AppMode, Doctor, Settings } from '../types';

export function SettingsPage() {
  return (
    <AdminGate title="Settings — Administrator area">
      <div className="p-6 space-y-5 max-w-5xl">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Clinic branding, fees, queue flow, and doctor management.</p>
        </div>
        <ClinicInfo />
        <AppModeSelector />
        <DefaultLocation />
        <FeesAndFlow />
        <DoctorsManagement />
        <ProviderSettings />
      </div>
    </AdminGate>
  );
}

const MODES: { value: AppMode; title: string; blurb: string; includes: string[] }[] = [
  {
    value: 'reception',
    title: 'Reception Only',
    blurb: 'Front-desk flow: registration, appointments, billing, reports.',
    includes: ['Reception', 'Appointments', 'Billing', 'Accounts', 'Patient Log / Origin'],
  },
  {
    value: 'reception_doctor',
    title: 'Reception + Doctor',
    blurb: 'Adds the doctor consultation workflow — vitals, history, Rx, OPD slip.',
    includes: ['Everything in Reception', 'Doctor dashboards', 'Consultation + OPD slip'],
  },
  {
    value: 'reception_doctor_lab',
    title: 'Reception + Doctor + Lab',
    blurb: 'Adds the laboratory module: test catalog, orders, sample collection, result entry.',
    includes: ['Everything above', 'Lab test catalog', 'Lab orders + results'],
  },
  {
    value: 'reception_doctor_lab_ip',
    title: 'Full HMS (adds IPD)',
    blurb: 'Full hospital — in-patient admissions, ward/bed management, discharge summary.',
    includes: ['Everything above', 'In-Patient (IPD) admissions', 'Ward + bed tracking', 'Discharge summary'],
  },
];

function AppModeSelector() {
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
    onSuccess: async (_data, patch) => {
      await qc.refetchQueries({ queryKey: ['settings'] });
      const newMode = (patch as any).app_mode as AppMode | undefined;
      const title = newMode ? MODES.find((m) => m.value === newMode)?.title || newMode : 'settings';
      toast(`Switched to: ${title}`);
    },
  });

  if (!settings) return null;
  // Defensive default — if the persisted setting is missing/unknown, assume reception_doctor.
  const current: AppMode = (MODES.find((m) => m.value === settings.app_mode)?.value) || 'reception_doctor';
  const currentTitle = MODES.find((m) => m.value === current)!.title;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">Application Mode</h2>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        Pick which modules your clinic uses. Navigation adapts instantly — nothing gets deleted, just hidden.
      </p>
      <div className="text-xs mb-4 px-3 py-2 rounded-lg bg-blue-100 border border-blue-300 text-blue-900 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-100">
        Currently active mode: <span className="font-bold">{currentTitle}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODES.map((m) => {
          const active = current === m.value;
          const pending = save.isPending && (save.variables as any)?.app_mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              disabled={save.isPending}
              onClick={() => {
                if (current === m.value) return;
                save.mutate({ app_mode: m.value });
              }}
              className={cn(
                'relative text-left rounded-xl p-4 transition overflow-hidden',
                active
                  ? 'border-4 border-blue-600 bg-blue-100 dark:bg-blue-900/50 dark:border-blue-400'
                  : 'border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400'
              )}
              style={active ? { boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.3)' } : undefined}
            >
              {active && (
                <>
                  <div
                    className="absolute top-0 left-0 right-0"
                    style={{ height: 4, background: 'linear-gradient(90deg, #2563eb, #6366f1)' }}
                  />
                  <div
                    className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider text-white"
                    style={{ backgroundColor: '#2563eb' }}
                  >
                    <Check className="w-3 h-3" /> Selected
                  </div>
                </>
              )}
              {pending && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-xs font-semibold">
                  Switching…
                </div>
              )}
              <div
                className={cn(
                  'text-sm font-bold pr-24',
                  active
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-gray-900 dark:text-slate-100'
                )}
              >
                {m.title}
              </div>
              <div
                className={cn(
                  'text-[11px] mt-1',
                  active
                    ? 'text-blue-800 dark:text-blue-200'
                    : 'text-gray-600 dark:text-slate-300'
                )}
              >
                {m.blurb}
              </div>
              <ul
                className={cn(
                  'text-[11px] mt-2 list-disc pl-4 space-y-0.5',
                  active
                    ? 'text-blue-800 dark:text-blue-200'
                    : 'text-gray-500 dark:text-slate-400'
                )}
              >
                {m.includes.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DefaultLocation() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['default_state', 'default_district', 'known_villages']);

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Default Location & Known Villages</h2>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        These pre-fill on every new patient so the receptionist only types the village. Known villages appear as autocomplete suggestions.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Default State</label>
          <select className="input" value={draft.default_state ?? ''} onChange={(e) => set('default_state', e.target.value)}>
            <option value="">—</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <TxtField label="Default District" value={draft.default_district ?? ''} onChange={(v) => set('default_district', v)} />
        <div className="col-span-2">
          <TxtField label="Known Villages / Places (comma-separated)" value={draft.known_villages ?? ''} onChange={(v) => set('known_villages', v)} />
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
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['clinic_name', 'clinic_tagline', 'clinic_phone', 'clinic_email', 'clinic_address', 'clinic_registration_no'], {
    extraInvalidateKeys: [['clinic-name'], ['clinic-name-title']],
  });

  const logoSave = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => { const prev = qc.getQueryData<Settings>(['settings']); if (prev) qc.setQueryData(['settings'], { ...prev, ...patch }); return { prev }; },
    onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev); toast('Save failed', 'error'); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Logo saved'); },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Clinic Info</h2>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">These appear on the OPD slip letterhead and invoices.</p>

      <div className="flex gap-6">
        <ImageUpload
          label="Clinic Logo"
          value={settings.clinic_logo}
          onChange={(v) => logoSave.mutate({ clinic_logo: v || '' })}
          aspect="square"
          placeholder="Click or drop"
          hint="⚠ Upload a high-quality logo (JPG / PNG). Max 5 MB. Logo saves immediately on upload."
        />
        <div className="flex-1 grid grid-cols-2 gap-4">
          <TxtField label="Clinic Name *" value={draft.clinic_name ?? ''} onChange={(v) => set('clinic_name', v)} />
          <TxtField label="Tagline" value={draft.clinic_tagline ?? ''} onChange={(v) => set('clinic_tagline', v)} />
          <TxtField label="Phone" value={draft.clinic_phone ?? ''} onChange={(v) => set('clinic_phone', v)} />
          <TxtField label="Email" value={draft.clinic_email ?? ''} onChange={(v) => set('clinic_email', v)} />
          <div className="col-span-2">
            <TxtField label="Address" value={draft.clinic_address ?? ''} onChange={(v) => set('clinic_address', v)} />
          </div>
          <TxtField label="Registration No." value={draft.clinic_registration_no ?? ''} onChange={(v) => set('clinic_registration_no', v)} />
        </div>
      </div>
    </section>
  );
}

function FeesAndFlow() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['consultation_fee', 'special_price', 'slot_duration', 'queue_flow_enabled']);

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Fees & Queue Flow</h2>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Regular Consultation Fee (₹)</label>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={draft.consultation_fee == null ? '' : String(draft.consultation_fee)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              set('consultation_fee', v === '' ? 0 : Number(v));
            }}
          />
        </div>
        <div>
          <label className="label">Special Price (₹)</label>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={draft.special_price == null ? '' : String(draft.special_price)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              set('special_price', v === '' ? 0 : Number(v));
            }}
          />
        </div>
        <div>
          <label className="label">Slot Duration</label>
          <select className="input" value={draft.slot_duration ?? 30} onChange={(e) => set('slot_duration', Number(e.target.value))}>
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
          onClick={() => set('queue_flow_enabled', !draft.queue_flow_enabled)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.queue_flow_enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={!!draft.queue_flow_enabled}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              draft.queue_flow_enabled ? 'left-[26px]' : 'left-0.5'
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
              <div className="col-span-2">
                <Field label="Qualifications / Degrees (shown on OPD slip)">
                  <input
                    className="input"
                    placeholder="e.g. MBBS, MD (Medicine), DNB Cardiology"
                    value={editing.qualifications || ''}
                    onChange={(e) => setEditing({ ...editing, qualifications: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Medical Registration No.">
                <input
                  className="input"
                  placeholder="e.g. KMC-12345"
                  value={editing.registration_no || ''}
                  onChange={(e) => setEditing({ ...editing, registration_no: e.target.value })}
                />
              </Field>
              <Field label="Default Consultation Fee (₹)">
                <input type="number" className="input" value={editing.default_fee || 0} onChange={(e) => setEditing({ ...editing, default_fee: Number(e.target.value) })} />
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

function TxtField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty && !saving) {
    return <span className="text-[11px] text-gray-400 dark:text-slate-500 italic">All changes saved</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">Unsaved changes</span>
      <button type="button" className="btn-secondary text-xs" onClick={onReset} disabled={saving}>Reset</button>
      <button type="button" className="btn-primary text-xs" onClick={onSave} disabled={saving}>
        <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

function useSectionDraft<K extends keyof Settings>(
  settings: Settings | undefined,
  keys: K[],
  opts: { extraInvalidateKeys?: any[][] } = {}
) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = (): Partial<Pick<Settings, K>> => {
    if (!settings) return {};
    const out: any = {};
    for (const k of keys) out[k] = settings[k];
    return out;
  };
  const [draft, setDraft] = useState<Partial<Pick<Settings, K>>>(initial);
  // Sync draft when settings load / change externally (but don't clobber local edits)
  useEffect(() => {
    if (!settings) return;
    setDraft((cur) => {
      // If draft is already dirty on a key, keep the local version.
      const next: any = { ...cur };
      for (const k of keys) if (next[k] === undefined) next[k] = settings[k];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.clinic_name, settings?.clinic_address, settings?.clinic_phone, settings?.clinic_email, settings?.clinic_tagline, settings?.clinic_registration_no, settings?.default_state, settings?.default_district, settings?.known_villages, settings?.consultation_fee, settings?.special_price, settings?.slot_duration, settings?.queue_flow_enabled]);

  const dirty = !!settings && keys.some((k) => draft[k] !== settings[k]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['settings'] });
      for (const key of opts.extraInvalidateKeys || []) qc.invalidateQueries({ queryKey: key });
      toast('Saved');
    },
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  return {
    draft,
    set: <Kk extends K>(k: Kk, v: Settings[Kk]) => setDraft((d) => ({ ...d, [k]: v })),
    reset: () => setDraft(initial()),
    dirty,
    saving: mutation.isPending,
    save: () => {
      if (!settings) return;
      const patch: any = {};
      for (const k of keys) if (draft[k] !== settings[k]) patch[k] = draft[k];
      if (Object.keys(patch).length === 0) return;
      mutation.mutate(patch);
    },
  };
}
