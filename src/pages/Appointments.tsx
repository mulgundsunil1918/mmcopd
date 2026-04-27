import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Calendar, Search, Clock4, Loader2, CheckCircle2, Printer, ArrowDownNarrowWide, ArrowUpNarrowWide } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { OpdSlipFor } from '../components/OpdSlipFor';
import { SendWhatsAppButton } from '../components/SendWhatsAppButton';
import { colorForDoctor } from '../lib/doctor-colors';
import { useToast } from '../hooks/useToast';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { cn, fmt12h, formatINR, generateTimeSlots, todayISO } from '../lib/utils';
import type { AppointmentStatus, AppointmentWithJoins, Doctor, Patient, PaymentMode } from '../types';

const STATUS_FLOW: Record<AppointmentStatus, AppointmentStatus> = {
  'Waiting': 'In Progress',
  'In Progress': 'Send to Billing',
  'Send to Billing': 'Done',
  'Ready for Print': 'Done',
  'Done': 'Done',
  'Cancelled': 'Cancelled',
};


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
  const [sortOrder, setSortOrder] = useState<'oldest_first' | 'newest_first' | null>(null);
  const toast = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (autoOpen) {
      setBookOpen(true);
      navigate('/appointments', { replace: true });
    }
  }, [autoOpen, navigate]);

  // Local Ctrl+B kept as a safety net; the canonical global handler in App.tsx
  // navigates here first, then fires 'caredesk:bookAppointment' which we catch.
  useKeyboardShortcut({ ctrl: true, key: 'b' }, () => setBookOpen(true), []);
  useEffect(() => {
    const open = () => setBookOpen(true);
    window.addEventListener('caredesk:bookAppointment', open);
    return () => window.removeEventListener('caredesk:bookAppointment', open);
  }, []);

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const queueOn = appSettings?.queue_flow_enabled ?? false;

  // First time settings load — adopt the admin's default. After that, the user's
  // local toggle wins for this session.
  useEffect(() => {
    if (sortOrder == null && appSettings?.appointments_default_sort) {
      setSortOrder(appSettings.appointments_default_sort);
    }
  }, [appSettings?.appointments_default_sort, sortOrder]);
  const effectiveSort: 'oldest_first' | 'newest_first' =
    sortOrder ?? (appSettings?.appointments_default_sort as any) ?? 'oldest_first';

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

      {/* Search + sort toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-9"
            placeholder="Search patient name, token #, or doctor"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-slate-700 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setSortOrder('oldest_first')}
            className={cn(
              'px-3 py-2 inline-flex items-center gap-1.5 transition',
              effectiveSort === 'oldest_first'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700'
            )}
            title="Earliest token first (#1, #2, #3 …)"
          >
            <ArrowUpNarrowWide className="w-3.5 h-3.5" /> Oldest first
          </button>
          <button
            type="button"
            onClick={() => setSortOrder('newest_first')}
            className={cn(
              'px-3 py-2 inline-flex items-center gap-1.5 transition border-l border-gray-300 dark:border-slate-700',
              effectiveSort === 'newest_first'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700'
            )}
            title="Latest booking first (newest at top)"
          >
            <ArrowDownNarrowWide className="w-3.5 h-3.5" /> Newest first
          </button>
        </div>
      </div>

      {/* Vertical patient list */}
      <section className="card p-0 overflow-hidden">
        {(() => {
          const q = searchQ.trim().toLowerCase();
          const filtered = appts.filter((a) => {
            if (!q) return true;
            return (
              a.patient_name?.toLowerCase().includes(q) ||
              String(a.token_number).includes(q) ||
              a.doctor_name?.toLowerCase().includes(q)
            );
          });
          const list = [...filtered].sort((a, b) => {
            // Token number is monotonically issued per day, so it's a reliable proxy
            // for booking order. id is the tiebreaker (multiple bookings same minute).
            const at = a.token_number * 100000 + a.id;
            const bt = b.token_number * 100000 + b.id;
            return effectiveSort === 'newest_first' ? bt - at : at - bt;
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
                const doc = doctors.find((d) => d.id === a.doctor_id);
                const docColor = colorForDoctor(doc);
                return (
                  <li
                    key={a.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/40',
                      a.status === 'Cancelled' && 'opacity-60',
                      a.status === 'Ready for Print' && 'bg-cyan-50 dark:bg-cyan-900/20'
                    )}
                    style={{ borderLeft: `4px solid ${docColor}` }}
                  >
                    {/* Token */}
                    <div className="text-sm font-bold text-gray-700 dark:text-slate-200 w-12 text-center">#{a.token_number}</div>

                    {/* Time */}
                    <div className="text-xs text-gray-500 dark:text-slate-400 w-20">{fmt12h(a.appointment_time)}</div>

                    {/* Patient + doctor */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{a.patient_name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                        <span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ backgroundColor: docColor }} />
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
  const [feeMode, setFeeMode] = useState<'regular' | 'special' | 'custom' | 'free_followup' | 'relaxed_followup'>('regular');
  const [customFee, setCustomFee] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [includeRegFee, setIncludeRegFee] = useState<boolean>(false);
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
    setIncludeRegFee(false);
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

  // Free follow-up eligibility for the selected (patient, doctor, appointment date) tuple.
  // Date is part of the key so changing the booking date re-checks the window.
  const { data: followup } = useQuery({
    queryKey: ['followup-eligibility', patient?.id, doctorId, apptDate],
    queryFn: () => window.electronAPI.followup.checkEligibility(patient!.id, doctorId!, apptDate),
    enabled: !!(patient && doctorId && settings?.followup_enabled),
  });

  // Auto-select the FREE FOLLOWUP fee mode when eligible. Receptionist can still
  // override by clicking another fee tile. We only auto-snap once per eligibility flip.
  useEffect(() => {
    if (followup?.eligible) setFeeMode('free_followup');
    else if (feeMode === 'free_followup') setFeeMode('regular');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followup?.eligible]);

  // Auto-include registration fee for unpaid patients per clinic default.
  useEffect(() => {
    if (!patient || !settings?.registration_fee_enabled) { setIncludeRegFee(false); return; }
    if (patient.registration_fee_paid) { setIncludeRegFee(false); return; }
    setIncludeRegFee(settings.registration_fee_default_timing !== 'at_registration');
    // 'at_registration' means we expected it at registration → don't double-charge if missed; receptionist can opt in
    // 'at_first_appointment' or 'ask' → default ON
  }, [patient?.id, settings?.registration_fee_enabled, settings?.registration_fee_default_timing]);

  const consultationFee =
    feeMode === 'free_followup' ? 0
    : feeMode === 'relaxed_followup' ? 0
    : feeMode === 'special' ? specialFee
    : feeMode === 'custom' ? Math.max(0, parseFloat(customFee || '0') || 0)
    : regularFee;
  const regFeeAmount = includeRegFee ? (settings?.registration_fee_amount ?? 0) : 0;
  const fee = consultationFee + regFeeAmount;

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
        feeMode === 'free_followup' ? 'OPD Consultation (Free Follow-up)'
        : feeMode === 'relaxed_followup' ? 'OPD Consultation (Courtesy Follow-up)'
        : feeMode === 'special' ? 'OPD Consultation (Special Price)'
        : feeMode === 'custom' ? 'OPD Consultation (Custom)'
        : 'OPD Consultation';

      const items = [
        { description: feeLabel, qty: 1, rate: consultationFee, amount: consultationFee },
      ];
      if (includeRegFee && regFeeAmount > 0) {
        items.push({ description: 'Patient Registration Fee', qty: 1, rate: regFeeAmount, amount: regFeeAmount });
      }
      await window.electronAPI.bills.create({
        appointment_id: appt.id,
        patient_id: patient.id,
        items,
        discount: 0,
        discount_type: 'flat',
        payment_mode: paymentMode,
        is_free_followup: feeMode === 'free_followup' ? 1 : 0,
        is_relaxed_followup: feeMode === 'relaxed_followup' ? 1 : 0,
        followup_parent_appt_id: (feeMode === 'free_followup' || feeMode === 'relaxed_followup') ? (followup?.parent_appt_id ?? null) : null,
        marks_registration_fee_paid: includeRegFee ? 1 : 0,
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
                  <div className={cn('text-sm font-semibold flex items-center gap-1.5', doctorId === d.id ? 'text-blue-800 dark:text-blue-200' : 'text-gray-900 dark:text-slate-100')}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorForDoctor(d) }} />
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
            <label className="label">
              Time {selectedDoctor?.available_from && selectedDoctor?.available_to
                ? <span className="text-[10px] font-normal text-blue-600 dark:text-blue-300">· {selectedDoctor.name} works {fmt12h(selectedDoctor.available_from)} – {fmt12h(selectedDoctor.available_to)}</span>
                : null}
            </label>
            {/* Custom time input — any minute, not restricted to slot boundaries */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input
                type="time"
                className="input w-auto"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
              />
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline px-2"
                onClick={() => setSlot('')}
              >
                Walk-in (now)
              </button>
              {slot && bookedSet.has(slot) && (
                <span className="text-[11px] text-red-700 dark:text-red-300 font-semibold">
                  ⚠ Already booked — pick another time
                </span>
              )}
              {slot && selectedDoctor?.available_from && selectedDoctor?.available_to &&
                (slot < selectedDoctor.available_from || slot > selectedDoctor.available_to) && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                  ⚠ Outside {selectedDoctor.name}'s hours
                </span>
              )}
            </div>
            {/* Quick-pick presets — same {slot_duration}-minute boundaries as before */}
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-1">Quick-pick presets:</div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
              {slots.map((s) => {
                const isBooked = bookedSet.has(s);
                const outsideHours = !!(selectedDoctor?.available_from && selectedDoctor?.available_to &&
                  (s < selectedDoctor.available_from || s > selectedDoctor.available_to));
                const disabled = isBooked || outsideHours;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSlot(s)}
                    title={isBooked ? 'Already booked' : outsideHours ? `Outside doctor's hours (${selectedDoctor?.available_from}–${selectedDoctor?.available_to})` : undefined}
                    className={cn(
                      'text-xs px-2 py-1 rounded border',
                      disabled && 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 line-through border-gray-200 dark:border-slate-700 cursor-not-allowed',
                      !disabled && slot === s && 'bg-blue-600 text-white border-blue-600',
                      !disabled && slot !== s && 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-blue-400'
                    )}
                  >
                    {fmt12h(s)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Follow-up eligibility banner — shown above fee tiles when applicable */}
        {patient && doctorId && followup?.eligible && (
          <div className="rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                ✓ Free follow-up — fee waived automatically
              </div>
              <div className="text-[12px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                Last paid visit on {followup.parent_appt_date} · {followup.free_remaining} of {followup.total_free} free visit(s) remaining · valid till {followup.valid_till}
              </div>
            </div>
          </div>
        )}
        {patient && doctorId && !followup?.eligible && followup?.relaxed_eligible && (
          <div className="rounded-lg border-2 border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-3 flex items-center justify-between gap-3">
            <div className="text-sm flex-1">
              <div className="font-semibold text-orange-900 dark:text-orange-200">
                ⚠️ Outside free-follow-up window — fee normally required
              </div>
              <div className="text-[12px] text-orange-700 dark:text-orange-300 mt-0.5">
                Booking date <b>{apptDate}</b> is past the strict cutoff <b>{followup.valid_till}</b> (last paid visit {followup.parent_appt_date}).
                Inside grace period — you may waive the fee as a courtesy.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeeMode(feeMode === 'relaxed_followup' ? 'regular' : 'relaxed_followup')}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md border-2 font-semibold whitespace-nowrap',
                feeMode === 'relaxed_followup'
                  ? 'bg-orange-600 text-white border-orange-700'
                  : 'bg-white dark:bg-slate-800 border-orange-400 text-orange-800 dark:text-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900/30'
              )}
            >
              {feeMode === 'relaxed_followup' ? '✓ Courtesy granted (₹0)' : '🤝 Grant courtesy free visit'}
            </button>
          </div>
        )}

        {/* Registration fee toggle — only when patient hasn't paid yet AND policy enabled */}
        {patient && settings?.registration_fee_enabled && !patient.registration_fee_paid && (
          <div className="rounded-lg border-2 border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-900/15 p-3 flex items-center gap-3">
            <input
              type="checkbox"
              id="appt-include-regfee"
              checked={includeRegFee}
              onChange={(e) => setIncludeRegFee(e.target.checked)}
              className="w-4 h-4 accent-amber-600"
            />
            <label htmlFor="appt-include-regfee" className="flex-1 cursor-pointer">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Include ₹{settings.registration_fee_amount} registration fee in this bill
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                Patient hasn't paid registration fee yet. {includeRegFee ? 'Will be added as a separate line item.' : 'Skip — collect later.'}
              </div>
            </label>
            <div className="text-base font-bold text-amber-700 dark:text-amber-300 whitespace-nowrap">
              {includeRegFee ? `+ ₹${settings.registration_fee_amount}` : '—'}
            </div>
          </div>
        )}

        {/* Upfront payment */}
        <div className="card p-4 border-2 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Payment at Registration</div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                Consultation {formatINR(consultationFee)}
                {includeRegFee && ` + Registration ${formatINR(regFeeAmount)}`}
              </div>
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
