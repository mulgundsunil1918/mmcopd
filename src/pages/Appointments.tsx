import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Calendar, Search, Clock4, Loader2, CheckCircle2, Printer } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { OpdSlipFor } from '../components/OpdSlipFor';
import { SendWhatsAppButton } from '../components/SendWhatsAppButton';
import { useToast } from '../hooks/useToast';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { cn, fmt12h, formatINR, generateTimeSlots, todayISO } from '../lib/utils';
import type { AppointmentStatus, AppointmentWithJoins, Doctor, Patient, PaymentMode } from '../types';

const STATUS_FLOW: Record<AppointmentStatus, AppointmentStatus> = {
  'Waiting': 'In Progress',
  'In Progress': 'Send to Billing',
  'Send to Billing': 'Done',
  'Done': 'Done',
  'Cancelled': 'Cancelled',
};

const DOCTOR_PALETTE = [
  { head: 'bg-emerald-500', ring: 'border-emerald-300 dark:border-emerald-800' },
  { head: 'bg-purple-500', ring: 'border-purple-300 dark:border-purple-800' },
  { head: 'bg-amber-500', ring: 'border-amber-300 dark:border-amber-800' },
  { head: 'bg-pink-500', ring: 'border-pink-300 dark:border-pink-800' },
  { head: 'bg-cyan-500', ring: 'border-cyan-300 dark:border-cyan-800' },
  { head: 'bg-indigo-500', ring: 'border-indigo-300 dark:border-indigo-800' },
];

export function Appointments() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const preselectedPatient = params.get('patient');
  const autoOpen = params.get('book') === '1';

  const [date, setDate] = useState<string>(todayISO());
  const [doctorFilter, setDoctorFilter] = useState<number | 'all'>('all');
  const [searchQ, setSearchQ] = useState('');
  const [bookOpen, setBookOpen] = useState(false);
  const [printAppt, setPrintAppt] = useState<AppointmentWithJoins | null>(null);
  const toast = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (autoOpen) {
      setBookOpen(true);
      navigate('/appointments', { replace: true });
    }
  }, [autoOpen, navigate]);

  useKeyboardShortcut({ ctrl: true, key: 'b' }, () => setBookOpen(true), []);

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const queueOn = appSettings?.queue_flow_enabled ?? false;

  const { data: appts = [], isLoading } = useQuery({
    queryKey: ['appointments', date, doctorFilter],
    queryFn: () =>
      window.electronAPI.appointments.list({
        date,
        doctor_id: doctorFilter === 'all' ? undefined : (doctorFilter as number),
      }),
    refetchInterval: 15_000,
  });

  const summary = useMemo(() => {
    const s = { total: appts.length, waiting: 0, inprogress: 0, done: 0 };
    for (const a of appts) {
      if (a.status === 'Waiting') s.waiting++;
      else if (a.status === 'In Progress') s.inprogress++;
      else if (a.status === 'Done') s.done++;
    }
    return s;
  }, [appts]);

  const apptsByDoctor = useMemo(() => {
    const map = new Map<number, AppointmentWithJoins[]>();
    for (const a of appts) {
      if (!map.has(a.doctor_id)) map.set(a.doctor_id, []);
      map.get(a.doctor_id)!.push(a);
    }
    return map;
  }, [appts]);

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: AppointmentStatus }) =>
      window.electronAPI.appointments.updateStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const visibleDoctors = doctorFilter === 'all' ? doctors : doctors.filter((d) => d.id === doctorFilter);
  const colorFor = (idx: number) => DOCTOR_PALETTE[idx % DOCTOR_PALETTE.length];

  return (
    <div className="p-6 space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Appointments</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Manage today's queue across all doctors.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          <select
            className="input w-auto"
            value={String(doctorFilter)}
            onChange={(e) => setDoctorFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All Doctors</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn-primary" onClick={() => setBookOpen(true)}>
            <Plus className="w-4 h-4" /> Book New
            <span className="ml-2 text-[10px] opacity-75 bg-white/20 rounded px-1.5 py-0.5">Ctrl+B</span>
          </button>
        </div>
      </div>

      {/* Ready-for-Print banner (always shown if there's any) */}
      {appts.filter((a) => a.status === 'Ready for Print').length > 0 && (
        <div className="rounded-xl border-2 border-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-cyan-700 dark:text-cyan-300" />
              <div>
                <div className="text-sm font-bold text-cyan-900 dark:text-cyan-100">
                  Ready for Print ({appts.filter((a) => a.status === 'Ready for Print').length})
                </div>
                <div className="text-[11px] text-cyan-800 dark:text-cyan-200">
                  Doctor has completed these consultations. Print the OPD slip and hand to the patient.
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
            {appts
              .filter((a) => a.status === 'Ready for Print')
              .map((a) => (
                <div
                  key={a.id}
                  className="bg-white dark:bg-slate-800 border border-cyan-300 dark:border-cyan-700 rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-gray-700 dark:text-slate-200">#{a.token_number}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{a.patient_name}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{a.doctor_name}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <SendWhatsAppButton appointment={a} variant="icon" />
                    <button className="btn-primary text-xs" onClick={() => setPrintAppt(a)}>
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                    <button
                      className="btn-ghost text-[11px]"
                      title="Mark Done (already printed)"
                      onClick={() => updateStatus.mutate({ id: a.id, status: 'Done' })}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {queueOn ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total today" value={summary.total} icon={<Calendar className="w-4 h-4" />} tone="indigo" />
          <SummaryCard label="Waiting" value={summary.waiting} icon={<Clock4 className="w-4 h-4" />} tone="blue" />
          <SummaryCard label="In Progress" value={summary.inprogress} icon={<Loader2 className="w-4 h-4" />} tone="emerald" />
          <SummaryCard label="Done" value={summary.done} icon={<CheckCircle2 className="w-4 h-4" />} tone="amber" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <SummaryCard label="Visits scheduled today" value={summary.total} icon={<Calendar className="w-4 h-4" />} tone="indigo" />
        </div>
      )}

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input pl-9"
          placeholder="Search patient name, token #, or doctor"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
      </div>

      {/* Vertical patient list */}
      <section className="card p-0 overflow-hidden">
        {(() => {
          const q = searchQ.trim().toLowerCase();
          const list = appts.filter((a) => {
            if (!q) return true;
            return (
              a.patient_name?.toLowerCase().includes(q) ||
              String(a.token_number).includes(q) ||
              a.doctor_name?.toLowerCase().includes(q)
            );
          });

          if (isLoading) {
            return <div className="p-6 text-xs text-gray-500 dark:text-slate-400">Loading…</div>;
          }
          if (list.length === 0) {
            return <EmptyState icon={Calendar} title={q ? 'No matches' : 'No appointments'} description={q ? `Nothing matches "${searchQ}"` : 'Book a new appointment to start the day.'} />;
          }

          return (
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {list.map((a, idx) => {
                const docColor = colorFor(doctors.findIndex((d) => d.id === a.doctor_id));
                return (
                  <li
                    key={a.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/40',
                      a.status === 'Cancelled' && 'opacity-60',
                      a.status === 'Ready for Print' && 'bg-cyan-50 dark:bg-cyan-900/20'
                    )}
                  >
                    {/* Token */}
                    <div className="text-sm font-bold text-gray-700 dark:text-slate-200 w-12 text-center">#{a.token_number}</div>

                    {/* Time */}
                    <div className="text-xs text-gray-500 dark:text-slate-400 w-20">{fmt12h(a.appointment_time)}</div>

                    {/* Patient + doctor */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{a.patient_name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                        <span className={cn('inline-block w-2 h-2 rounded-full align-middle mr-1.5', docColor.head)} />
                        {a.doctor_name} · {a.doctor_specialty}{a.doctor_room ? ` · Room ${a.doctor_room}` : ''}
                      </div>
                      {a.notes && <div className="text-[11px] text-gray-600 dark:text-slate-300 italic truncate">"{a.notes}"</div>}
                    </div>

                    {/* Status */}
                    {queueOn && <StatusBadge status={a.status} />}

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <SendWhatsAppButton appointment={a} variant="pill" />
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => setPrintAppt(a)}
                        title="Print OPD slip"
                      >
                        <Printer className="w-3.5 h-3.5" /> Slip
                      </button>
                      {queueOn && a.status !== 'Done' && a.status !== 'Cancelled' && (
                        <>
                          <button
                            className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline px-2"
                            onClick={() => updateStatus.mutate({ id: a.id, status: STATUS_FLOW[a.status] })}
                          >
                            Advance
                          </button>
                          <button
                            className="text-[11px] text-red-600 dark:text-red-400 hover:underline px-2"
                            onClick={() => updateStatus.mutate({ id: a.id, status: 'Cancelled' })}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        })()}
      </section>

      <BookAppointmentModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        doctors={doctors}
        defaultDate={date}
        preselectedPatientId={preselectedPatient ? Number(preselectedPatient) : undefined}
        onCreated={(created) => {
          qc.invalidateQueries({ queryKey: ['appointments'] });
          qc.invalidateQueries({ queryKey: ['stats'] });
          qc.invalidateQueries({ queryKey: ['bills'] });
          toast('Booked & payment recorded. Opening slip…');
          setBookOpen(false);
          setPrintAppt(created);
        }}
      />

      {printAppt && <OpdSlipFor appointment={printAppt} onClose={() => setPrintAppt(null)} />}
    </div>
  );
}

function FeeOption({ active, onClick, title, amount }: { active: boolean; onClick: () => void; title: string; amount: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border-2 px-3 py-2 text-left transition',
        active
          ? 'border-amber-500 bg-white dark:bg-amber-900/30 shadow-sm'
          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-amber-300'
      )}
    >
      <div className={cn('text-[10px] uppercase tracking-wider font-semibold', active ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400')}>{title}</div>
      <div className={cn('text-sm font-bold mt-0.5', active ? 'text-amber-800 dark:text-amber-200' : 'text-gray-900 dark:text-slate-100')}>{amount}</div>
    </button>
  );
}

function SummaryCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'indigo' | 'blue' | 'emerald' | 'amber' }) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-900/40',
    blue: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40',
    emerald: 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40',
    amber: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40',
  };
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', tones[tone])}>{icon}</div>
      <div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-xl font-bold text-gray-900 dark:text-slate-100">{value}</div>
      </div>
    </div>
  );
}

function BookAppointmentModal({
  open, onClose, doctors, defaultDate, preselectedPatientId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  doctors: Doctor[];
  defaultDate: string;
  preselectedPatientId?: number;
  onCreated: (appt: AppointmentWithJoins) => void;
}) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [apptDate, setApptDate] = useState(defaultDate);
  const [slot, setSlot] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [feeMode, setFeeMode] = useState<'regular' | 'special' | 'custom'>('regular');
  const [customFee, setCustomFee] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const toast = useToast();

  useEffect(() => { setApptDate(defaultDate); }, [defaultDate]);

  useEffect(() => {
    if (!open) return;
    setPatientQuery('');
    setSlot('');
    setNotes('');
    setFeeMode('regular');
    setCustomFee('');
    setPaymentMode('Cash');
    if (preselectedPatientId) {
      window.electronAPI.patients.get(preselectedPatientId).then((p) => { if (p) setPatient(p); });
    } else {
      setPatient(null);
    }
    if (!doctorId && doctors.length) setDoctorId(doctors[0].id);
  }, [open]);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const selectedDoctor = doctors.find((d) => d.id === doctorId);
  // Regular fee comes from the selected doctor's default_fee (falls back to clinic setting).
  const regularFee = selectedDoctor?.default_fee ?? settings?.consultation_fee ?? 250;
  const specialFee = settings?.special_price ?? 150;

  const fee =
    feeMode === 'special' ? specialFee
    : feeMode === 'custom' ? Math.max(0, parseFloat(customFee || '0') || 0)
    : regularFee;

  const { data: searchResults = [] } = useQuery({
    queryKey: ['patient-search-modal', patientQuery],
    queryFn: () => window.electronAPI.patients.search(patientQuery),
    enabled: open && !patient,
  });

  const { data: booked = [] } = useQuery({
    queryKey: ['booked', doctorId, apptDate],
    queryFn: () => window.electronAPI.appointments.bookedSlots(doctorId!, apptDate),
    enabled: !!doctorId,
  });

  const slots = generateTimeSlots(settings?.slot_duration ?? 30);
  const bookedSet = new Set(booked.map((b) => b.appointment_time));

  const submit = async () => {
    if (!patient) return toast('Select a patient', 'error');
    if (!doctorId) return toast('Select a doctor', 'error');

    const chosenTime = (() => {
      if (slot) return slot;
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    })();

    try {
      const appt = await window.electronAPI.appointments.create({
        patient_id: patient.id,
        doctor_id: doctorId,
        appointment_date: apptDate,
        appointment_time: chosenTime,
        notes: notes || null,
      });

      const feeLabel =
        feeMode === 'special' ? 'OPD Consultation (Special Price)'
        : feeMode === 'custom' ? 'OPD Consultation (Custom)'
        : 'OPD Consultation';
      await window.electronAPI.bills.create({
        appointment_id: appt.id,
        patient_id: patient.id,
        items: [{ description: feeLabel, qty: 1, rate: fee, amount: fee }],
        discount: 0,
        discount_type: 'flat',
        payment_mode: paymentMode,
      });

      onCreated(appt);
    } catch (e: any) {
      toast(e.message || 'Booking failed', 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Book Appointment" size="lg">
      <div className="space-y-5">
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
                  placeholder="Search by name, phone, or UHID"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                />
              </div>
              <ul className="max-h-52 overflow-auto mt-2 border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
                {searchResults.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    onClick={() => setPatient(p)}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    <div className="font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{p.uhid} · {p.phone}</div>
                  </li>
                ))}
                {searchResults.length === 0 && (
                  <li className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500 text-center">No matches</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Doctor */}
        <div>
          <label className="label">Doctor *</label>
          {doctors.length <= 6 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {doctors.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDoctorId(d.id)}
                  className={cn(
                    'text-left rounded-lg border-2 p-2.5 transition',
                    doctorId === d.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300'
                  )}
                >
                  <div className={cn('text-sm font-semibold', doctorId === d.id ? 'text-blue-800 dark:text-blue-200' : 'text-gray-900 dark:text-slate-100')}>
                    {d.name}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.specialty}</div>
                  {d.room_number && <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">Room {d.room_number}</div>}
                </button>
              ))}
            </div>
          ) : (
            <select
              className="input"
              value={doctorId ?? ''}
              onChange={(e) => setDoctorId(Number(e.target.value))}
            >
              <option value="">Select doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.specialty}{d.room_number ? ` (Room ${d.room_number})` : ''}
                </option>
              ))}
            </select>
          )}
          {selectedDoctor && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Room: {selectedDoctor.room_number || '—'} · Specialty: {selectedDoctor.specialty}
            </div>
          )}
        </div>

        {/* Date + Time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Time Slot (optional)</label>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
              <button
                type="button"
                onClick={() => setSlot('')}
                className={cn(
                  'text-xs px-2 py-1 rounded border',
                  !slot ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-indigo-400'
                )}
              >
                Walk-in (now)
              </button>
              {slots.map((s) => {
                const isBooked = bookedSet.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={isBooked}
                    onClick={() => setSlot(s)}
                    className={cn(
                      'text-xs px-2 py-1 rounded border',
                      isBooked && 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 line-through border-gray-200 dark:border-slate-700 cursor-not-allowed',
                      !isBooked && slot === s && 'bg-blue-600 text-white border-blue-600',
                      !isBooked && slot !== s && 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-blue-400'
                    )}
                  >
                    {fmt12h(s)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upfront payment */}
        <div className="card p-4 border-2 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Payment at Registration</div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300">Collected upfront by receptionist</div>
            </div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{formatINR(fee)}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FeeOption
              active={feeMode === 'regular'}
              onClick={() => setFeeMode('regular')}
              title="Regular"
              amount={formatINR(regularFee)}
            />
            <FeeOption
              active={feeMode === 'special'}
              onClick={() => setFeeMode('special')}
              title="Special"
              amount={formatINR(specialFee)}
            />
            <FeeOption
              active={feeMode === 'custom'}
              onClick={() => setFeeMode('custom')}
              title="Custom"
              amount="Enter ₹"
            />
          </div>

          {feeMode === 'custom' && (
            <div className="mt-3">
              <label className="label">Custom Amount (₹)</label>
              <input
                type="number"
                min={0}
                className="input"
                placeholder="e.g. 300"
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="mt-3">
            <div className="label mb-1.5">Payment Mode</div>
            <div className="flex gap-2">
              {(['Cash', 'Card', 'UPI'] as PaymentMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMode(m)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border',
                    paymentMode === m
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label">Chief Complaint / Reason for Visit</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Fever since 3 days, sore throat, body ache"
          />
          <div className="text-[10px] text-gray-500 mt-0.5">Shown to the doctor and on the OPD slip.</div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-success" onClick={submit}>
            <CheckCircle2 className="w-4 h-4" /> Confirm & Print Slip
          </button>
        </div>
      </div>
    </Modal>
  );
}
