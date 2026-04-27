import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Syringe, Receipt, Stethoscope, IndianRupee, Plus, Settings as SettingsIcon } from 'lucide-react';
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

      {/* Form */}
      <section className="card p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <Plus className="w-4 h-4 text-pink-600" /> Record a new charge
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Patient */}
          <div>
            <label className="label">Patient *</label>
            {patient ? (
              <div className="flex items-center justify-between card p-3">
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
                  <ul className="max-h-40 overflow-auto mt-2 border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
                    {searchResults.slice(0, 8).map((p) => (
                      <li key={p.id} onClick={() => setPatient(p)} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700">
                        <div className="font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                        <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Doctor */}
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

        {/* Service category chips */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label !mb-0">Service Category</label>
            <button
              type="button"
              onClick={() => navigate('/settings#misc-services')}
              className="text-[11px] inline-flex items-center gap-1 text-pink-600 hover:text-pink-700 dark:text-pink-400 dark:hover:text-pink-300 font-medium"
              title="Customize the service list in Settings"
            >
              <SettingsIcon className="w-3 h-3" /> Add / Edit Services
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setServiceCategory(s)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md border-2 font-medium',
                  serviceCategory === s
                    ? 'bg-pink-600 text-white border-pink-700'
                    : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-pink-400'
                )}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => navigate('/settings#misc-services')}
              className="px-3 py-1.5 text-xs rounded-md border-2 border-dashed border-gray-400 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-pink-400 hover:text-pink-600 inline-flex items-center gap-1"
              title="Add a new service in Settings"
            >
              <Plus className="w-3 h-3" /> Add service
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Description (printed on bill)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "Tetanus injection (TT)" or "BP-Apparatus check + counselling"'
            />
            <div className="text-[10px] text-gray-500 mt-1">Defaults to the category — override for specifics.</div>
          </div>
          <div>
            <label className="label flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Amount (₹)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
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
                  'px-3 py-1.5 text-xs rounded-md border-2 font-medium',
                  paymentMode === m
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Comment / Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "Booster dose 2/3, given on right deltoid"'
          />
        </div>

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
