import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Phone, Cake, Pencil, Calendar as CalendarIcon, IdCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Patient, PatientInput } from '../types';
import { ageString, ageStringFull, dobFromAge, fmtDate, cn } from '../lib/utils';
import { INDIAN_STATES } from '../lib/india';
import { TOP_PROFESSIONS } from '../lib/professions';
import { ALL_NEARBY_PLACES, KARNATAKA_DISTRICTS } from '../lib/places';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { MedicalRecord } from '../components/MedicalRecord';
import { useToast } from '../hooks/useToast';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';

const patientSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().optional().or(z.literal('')),
  dob: z.string().optional().or(z.literal('')),
  gender: z.enum(['M', 'F', 'Other']),
  phone: z.string().min(7, 'Enter valid phone'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  blood_group: z.string().optional().or(z.literal('')),
  place: z.string().optional().or(z.literal('')),
  district: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  profession: z.string().optional().or(z.literal('')),
});

type FormData = z.infer<typeof patientSchema>;

function ageFromDob(dob: string): { y: number; m: number; d: number } {
  try {
    const [Y, M, D] = dob.split('-').map((v) => parseInt(v, 10));
    const birth = new Date(Y, M - 1, D);
    const now = new Date();
    let y = now.getFullYear() - birth.getFullYear();
    let m = now.getMonth() - birth.getMonth();
    let d = now.getDate() - birth.getDate();
    if (d < 0) { m -= 1; d += 30; }
    if (m < 0) { y -= 1; m += 12; }
    return { y: Math.max(0, y), m: Math.max(0, m), d: Math.max(0, d) };
  } catch {
    return { y: 0, m: 0, d: 0 };
  }
}

type Mode = 'idle' | 'new' | 'view' | 'edit';

export function Reception() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['patients', 'search', query],
    queryFn: () => window.electronAPI.patients.search(query),
  });

  const { data: selected } = useQuery({
    queryKey: ['patients', 'get', selectedId],
    queryFn: () => window.electronAPI.patients.get(selectedId!),
    enabled: selectedId != null,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ['patients', 'recent', selectedId],
    queryFn: () => window.electronAPI.patients.recentAppointments(selectedId!, 1000),
    enabled: selectedId != null,
  });

  useKeyboardShortcut({ ctrl: true, key: 'n' }, () => {
    setSelectedId(null);
    setMode('new');
  }, []);

  const onSelect = (p: Patient) => {
    setSelectedId(p.id);
    setMode('view');
  };

  const onNewPatient = () => {
    setSelectedId(null);
    setMode('new');
  };

  const onSaved = (p: Patient) => {
    qc.invalidateQueries({ queryKey: ['patients'] });
    setSelectedId(p.id);
    setMode('view');
  };

  const onBookAppointment = (patientId: number) => {
    navigate(`/appointments?patient=${patientId}&book=1`);
  };

  return (
    <div className="h-full flex">
      {/* LEFT: search */}
      <section className="w-[380px] border-r border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900 mb-3">Reception</h1>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-9"
              placeholder="Search by name, phone, or UHID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn-primary w-full mt-3" onClick={onNewPatient}>
            <UserPlus className="w-4 h-4" /> New Patient
            <span className="ml-auto text-[10px] opacity-75 bg-white/20 rounded px-1.5 py-0.5">Ctrl+N</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && <div className="p-6 text-center text-xs text-gray-500">Loading…</div>}
          {!isLoading && results.length === 0 && (
            <EmptyState
              title="No patients found"
              description={query ? 'Try a different search term.' : 'Register your first patient to get started.'}
            />
          )}
          <ul>
            {results.map((p) => (
              <li
                key={p.id}
                onClick={() => onSelect(p)}
                className={cn(
                  'px-4 py-3 border-b border-gray-100 dark:border-slate-700 cursor-pointer transition',
                  selectedId === p.id
                    ? 'bg-blue-100 dark:bg-blue-900/50'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">
                    {p.first_name} {p.last_name}
                  </div>
                  <span className="text-[10px] text-gray-600 dark:text-slate-300">{ageString(p.dob)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  <span className="flex items-center gap-1"><IdCard className="w-3 h-3" />{p.uhid}</span>
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {p.last_visit ? `Last visit: ${fmtDate(p.last_visit)}` : 'No visits yet'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* RIGHT: detail / form */}
      <section className="flex-1 overflow-auto p-6 bg-gray-50">
        {mode === 'idle' && (
          <EmptyState
            title="Select a patient or register a new one"
            description="Search on the left or click New Patient to begin."
          />
        )}
        {mode === 'new' && (
          <PatientForm
            key="new"
            onSaved={(p) => { toast('Patient registered'); onSaved(p); }}
            onCancel={() => setMode('idle')}
            onBookAppointment={onBookAppointment}
          />
        )}
        {mode === 'edit' && selected && (
          <PatientForm
            key={'edit-' + selected.id}
            initial={selected}
            onSaved={(p) => { toast('Patient updated'); onSaved(p); }}
            onCancel={() => setMode('view')}
            onBookAppointment={onBookAppointment}
          />
        )}
        {mode === 'view' && selected && (
          <PatientCard
            patient={selected}
            recent={recent}
            onEdit={() => setMode('edit')}
            onBookAppointment={() => onBookAppointment(selected.id)}
          />
        )}
      </section>
    </div>
  );
}

function PatientForm({
  initial,
  onSaved,
  onCancel,
  onBookAppointment,
}: {
  initial?: Patient;
  onSaved: (p: Patient) => void;
  onCancel: () => void;
  onBookAppointment: (id: number) => void;
}) {
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: known } = useQuery({
    queryKey: ['known-places'],
    queryFn: () => window.electronAPI.patients.knownPlaces(),
  });

  const {
    register, handleSubmit, setValue, watch, formState: { errors, isSubmitting },
  } = useForm<FormData>({
    defaultValues: initial
      ? {
          first_name: initial.first_name,
          last_name: initial.last_name,
          dob: initial.dob,
          gender: initial.gender,
          phone: initial.phone,
          email: initial.email || '',
          address: initial.address || '',
          blood_group: initial.blood_group || '',
          place: initial.place || '',
          district: initial.district || '',
          state: initial.state || '',
          profession: initial.profession || '',
        }
      : {
          gender: 'M' as const,
          dob: '',
          place: '',
          district: settings?.default_district || '',
          state: settings?.default_state || '',
          profession: '',
        },
  });

  const currentDob = watch('dob');
  const [ageY, setAgeY] = useState<string>(() => initial?.dob ? String(ageFromDob(initial.dob).y) : '');
  const [ageM, setAgeM] = useState<string>(() => initial?.dob ? String(ageFromDob(initial.dob).m) : '');
  const [ageD, setAgeD] = useState<string>(() => initial?.dob ? String(ageFromDob(initial.dob).d) : '');

  // When user changes DOB, recompute age components
  useEffect(() => {
    if (currentDob) {
      const a = ageFromDob(currentDob);
      setAgeY(String(a.y));
      setAgeM(String(a.m));
      setAgeD(String(a.d));
    }
  }, [currentDob]);

  const updateAge = (patch: { y?: string; m?: string; d?: string }) => {
    const y = patch.y !== undefined ? patch.y : ageY;
    const m = patch.m !== undefined ? patch.m : ageM;
    const d = patch.d !== undefined ? patch.d : ageD;
    if (patch.y !== undefined) setAgeY(patch.y);
    if (patch.m !== undefined) setAgeM(patch.m);
    if (patch.d !== undefined) setAgeD(patch.d);
    const yy = parseInt(y || '0', 10);
    const mm = parseInt(m || '0', 10);
    const dd = parseInt(d || '0', 10);
    if (yy || mm || dd) {
      setValue('dob', dobFromAge(yy, mm, dd), { shouldValidate: false });
    }
  };

  const totalDays = (parseInt(ageY || '0', 10) * 365) + (parseInt(ageM || '0', 10) * 30) + parseInt(ageD || '0', 10);
  const agePreview = currentDob ? ageStringFull(currentDob) : '';

  const create = useMutation({
    mutationFn: (data: PatientInput) => window.electronAPI.patients.create(data),
  });
  const update = useMutation({
    mutationFn: (data: PatientInput) => window.electronAPI.patients.update(initial!.id, data),
  });

  const onSubmit = handleSubmit(async (raw) => {
    // Age is mandatory (via DOB — either directly provided or derived from Y/M/D)
    if (!raw.dob && totalDays <= 0) {
      toast('Age is required', 'error');
      return;
    }
    const finalDob = raw.dob || dobFromAge(
      parseInt(ageY || '0', 10),
      parseInt(ageM || '0', 10),
      parseInt(ageD || '0', 10)
    );
    const payload = { ...raw, dob: finalDob } as PatientInput;
    const parsed = patientSchema.safeParse(payload);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message || 'Please fix form errors';
      const field = parsed.error.errors[0]?.path?.[0];
      toast(field ? `${String(field).replace('_', ' ')}: ${msg}` : msg, 'error');
      return;
    }
    try {
      const saved = initial
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      onSaved(saved);
    } catch (e: any) {
      toast(e.message || 'Save failed', 'error');
    }
  });

  return (
    <form onSubmit={onSubmit} className="max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          {initial ? 'Edit Patient' : 'Register New Patient'}
        </h2>
        <p className="text-xs text-gray-500 mb-6">Fields marked * are required. UHID is generated automatically.</p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="First Name *" error={errors.first_name?.message}>
            <input className="input" {...register('first_name')} />
          </Field>
          <Field label="Last Name (optional)" error={errors.last_name?.message}>
            <input className="input" {...register('last_name')} />
          </Field>

          <Field label="Age *">
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number" min={0} className="input text-center"
                  placeholder="Years"
                  value={ageY}
                  onChange={(e) => updateAge({ y: e.target.value })}
                />
                <div className="text-[10px] text-gray-500 mt-0.5 text-center">Years</div>
              </div>
              <div className="flex-1">
                <input
                  type="number" min={0} max={11} className="input text-center"
                  placeholder="Months"
                  value={ageM}
                  onChange={(e) => updateAge({ m: e.target.value })}
                />
                <div className="text-[10px] text-gray-500 mt-0.5 text-center">Months</div>
              </div>
              <div className="flex-1">
                <input
                  type="number" min={0} max={30} className="input text-center"
                  placeholder="Days"
                  value={ageD}
                  onChange={(e) => updateAge({ d: e.target.value })}
                />
                <div className="text-[10px] text-gray-500 mt-0.5 text-center">Days</div>
              </div>
            </div>
            {agePreview && (
              <div className="text-[11px] text-blue-600 dark:text-blue-400 mt-1">= {agePreview}</div>
            )}
          </Field>

          <Field label="Date of Birth (optional)" error={errors.dob?.message}>
            <input type="date" className="input" {...register('dob')} />
            <div className="text-[10px] text-gray-500 mt-0.5">If entered, age auto-updates.</div>
          </Field>

          <Field label="Gender *" error={errors.gender?.message}>
            <select className="input" {...register('gender')}>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Phone *" error={errors.phone?.message}>
            <PhoneField
              register={register}
              setValue={setValue}
              watch={watch}
            />
          </Field>
          <Field label="Email (optional)" error={errors.email?.message}>
            <input className="input" type="email" {...register('email')} />
          </Field>
          <Field label="Blood Group (optional)" error={errors.blood_group?.message}>
            <select className="input" {...register('blood_group')}>
              <option value="">—</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Address (optional)" error={errors.address?.message}>
            <input className="input" {...register('address')} />
          </Field>
          <Field label="Profession (optional)" error={errors.profession?.message}>
            <input
              className="input"
              list="professions-list"
              placeholder="e.g. Farmer, Teacher, Driver"
              {...register('profession')}
            />
            <datalist id="professions-list">
              {TOP_PROFESSIONS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </Field>
        </div>

        <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Origin / Native Place</h3>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">Used for patient origin stats</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Village / Town / Place">
              <input
                className="input"
                list="known-places-list"
                {...register('place')}
                placeholder={(settings?.known_villages || '').split(',')[0]?.trim() || 'e.g. Mulgund'}
              />
              <datalist id="known-places-list">
                {[
                  // Admin-curated extras from Settings → Known Villages (custom additions only)
                  ...(settings?.known_villages || '').split(',').map((v) => v.trim()).filter(Boolean),
                  // Built-in curated list (Gadag + Haveri + Koppal + Dharwad villages)
                  ...ALL_NEARBY_PLACES,
                ].filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field label="District">
              <input
                className="input"
                list="known-districts-list"
                {...register('district')}
                placeholder="e.g. Gadag"
              />
              <datalist id="known-districts-list">
                {[settings?.default_district, ...KARNATAKA_DISTRICTS]
                  .filter(Boolean)
                  .filter((v, i, arr) => arr.findIndex((x) => x?.toLowerCase() === v?.toLowerCase()) === i)
                  .map((v) => <option key={v} value={v!} />)}
              </datalist>
            </Field>
            <Field label="State">
              <select className="input" {...register('state')}>
                <option value="">—</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : initial ? 'Update Patient' : 'Register Patient'}
          </button>
          {initial && (
            <button
              type="button"
              className="btn-primary bg-green-600 hover:bg-green-700 focus:ring-green-500"
              onClick={() => onBookAppointment(initial.id)}
            >
              <CalendarIcon className="w-4 h-4" /> Book Appointment
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function PhoneField({ register, setValue, watch }: { register: any; setValue: any; watch: any }) {
  const phone = watch('phone') || '';
  const noPhone = phone === '0000000000';
  return (
    <div>
      <input
        className="input"
        placeholder="10-digit number"
        disabled={noPhone}
        {...register('phone')}
      />
      <label className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={noPhone}
          onChange={(e) => {
            if (e.target.checked) setValue('phone', '0000000000', { shouldValidate: true });
            else setValue('phone', '', { shouldValidate: true });
          }}
        />
        <span>Patient has no contact number (use default 0000000000)</span>
      </label>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
    </div>
  );
}

function PatientCard({
  patient,
  recent,
  onEdit,
  onBookAppointment,
}: {
  patient: Patient;
  recent: any[];
  onEdit: () => void;
  onBookAppointment: () => void;
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1"><IdCard className="w-3 h-3" />{patient.uhid}</div>
            <h2 className="text-2xl font-bold text-gray-900 mt-1">{patient.first_name} {patient.last_name}</h2>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1"><Cake className="w-3.5 h-3.5" /> {fmtDate(patient.dob)} · {ageStringFull(patient.dob)} · {patient.gender}</span>
              <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {patient.phone}</span>
              {patient.blood_group && <span className="badge bg-red-50 text-red-700">{patient.blood_group}</span>}
            </div>
            {patient.email && <div className="text-xs text-gray-500 mt-1">{patient.email}</div>}
            {patient.address && <div className="text-xs text-gray-500 mt-1">{patient.address}</div>}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onEdit}><Pencil className="w-4 h-4" /> Edit</button>
            <button className="btn-primary" onClick={onBookAppointment}><CalendarIcon className="w-4 h-4" /> Book Appointment</button>
          </div>
        </div>
      </div>

      <MedicalRecord patientId={patient.id} />

      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">All Appointments</h3>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">{recent.length} total</span>
        </div>
        {recent.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 py-4">No appointments yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700 max-h-[500px] overflow-auto">
            {recent.map((r: any) => (
              <li key={r.id} className="py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{r.doctor_name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {fmtDate(r.appointment_date)} · {r.appointment_time} · {r.doctor_specialty}
                  </div>
                  {r.notes && (
                    <div className="text-xs text-gray-600 dark:text-slate-300 mt-1 italic truncate">“{r.notes}”</div>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
