import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Syringe, Receipt, Stethoscope, IndianRupee, Plus, Settings as SettingsIcon, Users as UsersIcon } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { cn, formatINR, fmtDateTime } from '../lib/utils';
import type { Doctor, Patient, PaymentMode } from '../types';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI'];

/** Always include "Other" so the receptionist can fall back to a free-typed description. */
function parseServices(csv: string | undefined): string[] {
  const list = (csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.includes('Other')) list.push('Other');
  return list;
}

export function Miscellaneous() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [serviceCategory, setServiceCategory] = useState<string>('Procedure');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [notes, setNotes] = useState<string>('');

  // Always refetch settings on mount so newly-added services from the Settings
  // page show up immediately when the user navigates back, regardless of the
  // 5-second default staleTime.
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
    refetchOnMount: 'always',
  });
  const services = parseServices(settings?.misc_services);

  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ['doctors-active'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ['misc-patient-search', patientQuery],
    queryFn: () => window.electronAPI.patients.search(patientQuery),
    enabled: !patient,
  });

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const { data: list = [] } = useQuery({
    queryKey: ['misc-list'],
    queryFn: () => window.electronAPI.misc.list({ from: monthStart, to: today }),
  });
  const { data: summary } = useQuery({
    queryKey: ['misc-summary'],
    queryFn: () => window.electronAPI.misc.summary({ from: monthStart, to: today }),
  });

  const create = useMutation({
    mutationFn: () =>
      window.electronAPI.misc.create({
        patient_id: patient!.id,
        doctor_id: doctorId,
        description: (description.trim() || serviceCategory).trim(),
        amount: Math.max(0, parseFloat(amount || '0') || 0),
        payment_mode: paymentMode,
        notes: notes.trim() || null,
      }),
    onSuccess: (bill: any) => {
      toast(`Charge recorded — ${formatINR(bill.total)}`);
      qc.invalidateQueries({ queryKey: ['misc-list'] });
      qc.invalidateQueries({ queryKey: ['misc-summary'] });
      qc.invalidateQueries({ queryKey: ['analytics-overview'] });
      // Keep doctor + service for fast repeat entry; clear the rest.
      setPatient(null); setPatientQuery(''); setDescription(''); setAmount(''); setNotes('');
    },
    onError: (e: any) => toast(e?.message || 'Failed to record charge', 'error'),
  });

  const submit = () => {
    if (!patient) return toast('Select a patient', 'error');
    const amt = parseFloat(amount || '0');
    if (!(amt >= 0)) return toast('Enter a valid amount', 'error');
    if (!description.trim() && serviceCategory === 'Other') return toast('Enter a description for "Other"', 'error');
    create.mutate();
  };

  // Default the description to the picked category, but leave free-typed values alone.
  useEffect(() => {
    if (!description.trim() || services.includes(description.trim())) {
      setDescription(serviceCategory === 'Other' ? '' : serviceCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCategory]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Syringe className="w-5 h-5 text-pink-600" />
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Services</h1>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
          Procedures, vaccinations, nebulizations, dressings, injections — anything not handled by an appointment bill. Reflects in patient log, doctor revenue, and analytics.
        </p>
      </header>

      {/* Summary tiles */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">This month</div>
            <div className="text-2xl font-extrabold text-gray-900 dark:text-slate-100 mt-1">{summary.count}</div>
            <div className="text-[11px] text-gray-500">services rendered</div>
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">Revenue</div>
            <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">{formatINR(summary.revenue)}</div>
            <div className="text-[11px] text-gray-500">{monthStart} to {today}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">Top service</div>
            <div className="text-base font-bold text-gray-900 dark:text-slate-100 mt-1 truncate">
              {summary.topServices[0]?.service || '—'}
            </div>
            <div className="text-[11px] text-gray-500">
              {summary.topServices[0] ? `${summary.topServices[0].count} × · ${formatINR(summary.topServices[0].revenue)}` : 'no charges yet'}
            </div>
          </div>
        </div>
      )}

      {/* Form — color-coded sections so each step is visually distinct */}
      <section className="card p-5 space-y-5">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-slate-700">
          <Plus className="w-4 h-4 text-pink-600" /> Record a new charge
        </div>

        {/* SECTION 1 — Who: blue tone */}
        <FormSection
          step={1}
          tone="blue"
          icon={<UsersIcon className="w-4 h-4" />}
          title="Who"
          subtitle="Pick the patient and (optionally) the attending doctor"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Patient *</label>
              {patient ? (
                <div className="flex items-center justify-between rounded-lg p-3 border-2 border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{patient.uhid} · {patient.phone}</div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => setPatient(null)}>Change</button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      className="input pl-9"
                      placeholder="Name, phone, or UHID"
                      value={patientQuery}
                      onChange={(e) => setPatientQuery(e.target.value)}
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <ul className="max-h-40 overflow-auto mt-2 border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-slate-900">
                      {searchResults.slice(0, 8).map((p) => (
                        <li key={p.id} onClick={() => setPatient(p)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20">
                          <div className="font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                          <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> Performed by (optional)</label>
              <select
                className="input"
                value={doctorId ?? ''}
                onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— No specific doctor —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                ))}
              </select>
              <div className="text-[10px] text-gray-500 mt-1">Used for doctor-wise revenue reports.</div>
            </div>
          </div>
        </FormSection>

        {/* SECTION 2 — Service: pink tone (matches the page accent) */}
        <FormSection
          step={2}
          tone="pink"
          icon={<Syringe className="w-4 h-4" />}
          title="Service"
          subtitle="Pick a category and tweak the description if needed"
          rightAction={
            <button
              type="button"
              onClick={() => navigate('/settings#misc-services')}
              className="text-[11px] inline-flex items-center gap-1 text-pink-700 hover:text-pink-800 dark:text-pink-300 dark:hover:text-pink-200 font-semibold"
              title="Customize the service list in Settings"
            >
              <SettingsIcon className="w-3 h-3" /> Add / Edit Services
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setServiceCategory(s)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md border-2 font-medium transition',
                  serviceCategory === s
                    ? 'bg-pink-600 text-white border-pink-700 shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-pink-200 dark:border-pink-900 text-pink-800 dark:text-pink-300 hover:border-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30'
                )}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => navigate('/settings#misc-services')}
              className="px-3 py-1.5 text-xs rounded-md border-2 border-dashed border-pink-400 dark:border-pink-700 text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 inline-flex items-center gap-1"
              title="Add a new service in Settings"
            >
              <Plus className="w-3 h-3" /> Add service
            </button>
          </div>
          <div className="mt-3">
            <label className="label">Description (printed on bill)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "Tetanus injection (TT)" or "BP-Apparatus check + counselling"'
            />
            <div className="text-[10px] text-gray-500 mt-1">Defaults to the category — override for specifics.</div>
          </div>
        </FormSection>

        {/* SECTION 3 — Payment: amber tone (₹) */}
        <FormSection
          step={3}
          tone="amber"
          icon={<IndianRupee className="w-4 h-4" />}
          title="Payment"
          subtitle="Amount + how the patient is paying"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Amount (₹)</label>
              <input
                type="number"
                min={0}
                className="input text-lg font-bold"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="label">Payment Mode</label>
              <div className="flex gap-2">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMode(m)}
                    className={cn(
                      'flex-1 px-3 py-2 text-sm rounded-md border-2 font-semibold transition',
                      paymentMode === m
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                        : 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FormSection>

        {/* SECTION 4 — Notes: violet tone */}
        <FormSection
          step={4}
          tone="violet"
          icon={<Receipt className="w-4 h-4" />}
          title="Notes"
          subtitle="Optional comment that's saved with the bill"
        >
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "Booster dose 2/3, given on right deltoid"'
          />
        </FormSection>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
          <button className="btn-primary" onClick={submit} disabled={create.isPending}>
            <Receipt className="w-4 h-4" /> {create.isPending ? 'Recording…' : 'Record Charge'}
          </button>
        </div>
      </section>

      {/* Recent list */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Recent services</div>
          <div className="text-[11px] text-gray-500">{list.length} this month</div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 px-3">When</th>
                <th className="py-2 px-3">Patient</th>
                <th className="py-2 px-3">Service</th>
                <th className="py-2 px-3">Doctor</th>
                <th className="py-2 px-3">Mode</th>
                <th className="py-2 px-3 text-right">Amount</th>
                <th className="py-2 px-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-xs text-gray-500">No services rendered this month.</td></tr>
              ) : list.map((b: any) => {
                const items = (() => { try { return JSON.parse(b.items_json || '[]'); } catch { return []; } })();
                const desc = items[0]?.description || '—';
                return (
                  <tr key={b.id} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="py-2 px-3 text-[12px] text-gray-600 dark:text-slate-300 whitespace-nowrap">{fmtDateTime(b.created_at)}</td>
                    <td className="py-2 px-3 text-[12px] text-gray-900 dark:text-slate-100">
                      <div className="font-medium">{b.patient_name}</div>
                      <div className="text-[10px] text-gray-500">{b.patient_uhid}</div>
                    </td>
                    <td className="py-2 px-3 text-[12px] text-gray-900 dark:text-slate-100">{desc}</td>
                    <td className="py-2 px-3 text-[12px] text-gray-600 dark:text-slate-300">{b.doctor_name || <span className="italic text-gray-400">—</span>}</td>
                    <td className="py-2 px-3 text-[12px]">{b.payment_mode}</td>
                    <td className="py-2 px-3 text-[12px] text-right font-semibold">{formatINR(b.total)}</td>
                    <td className="py-2 px-3 text-[11px] text-gray-500 max-w-xs truncate">{b.notes || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Color-coded numbered section panel — gives the form clear visual structure. */
function FormSection({
  step, tone, icon, title, subtitle, rightAction, children,
}: {
  step: number;
  tone: 'blue' | 'pink' | 'amber' | 'violet' | 'emerald';
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones: Record<string, { panel: string; badge: string; title: string }> = {
    blue: {
      panel: 'border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10',
      badge: 'bg-blue-600 text-white',
      title: 'text-blue-900 dark:text-blue-200',
    },
    pink: {
      panel: 'border-pink-300 dark:border-pink-800 bg-pink-50/40 dark:bg-pink-900/10',
      badge: 'bg-pink-600 text-white',
      title: 'text-pink-900 dark:text-pink-200',
    },
    amber: {
      panel: 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10',
      badge: 'bg-amber-600 text-white',
      title: 'text-amber-900 dark:text-amber-200',
    },
    violet: {
      panel: 'border-violet-300 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/10',
      badge: 'bg-violet-600 text-white',
      title: 'text-violet-900 dark:text-violet-200',
    },
    emerald: {
      panel: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10',
      badge: 'bg-emerald-600 text-white',
      title: 'text-emerald-900 dark:text-emerald-200',
    },
  };
  const t = tones[tone];
  return (
    <div className={cn('rounded-lg border-2 p-4', t.panel)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold flex-shrink-0', t.badge)}>
            {step}
          </span>
          <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded', t.title)}>
            {icon}
          </span>
          <div>
            <div className={cn('text-sm font-bold', t.title)}>{title}</div>
            {subtitle && <div className="text-[11px] text-gray-600 dark:text-slate-400">{subtitle}</div>}
          </div>
        </div>
        {rightAction}
      </div>
      {children}
    </div>
  );
}
