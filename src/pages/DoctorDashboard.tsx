import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stethoscope, Clock4, CheckCircle2, PlayCircle, Receipt, User, Phone, Cake, ArrowLeft } from 'lucide-react';
import { age, ageString, cn, fmt12h, fmtDate, todayISO, waitMinutes } from '../lib/utils';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { ConsultationPanel } from '../components/ConsultationPanel';
import type { AppointmentStatus, AppointmentWithJoins } from '../types';
import { useToast } from '../hooks/useToast';

export function DoctorDashboard() {
  const { id } = useParams();
  const doctorId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<AppointmentWithJoins | null>(null);

  const { data: doctor } = useQuery({
    queryKey: ['doctors', doctorId],
    queryFn: () => window.electronAPI.doctors.get(doctorId),
    enabled: !!doctorId,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const queueOn = settings?.queue_flow_enabled ?? false;

  const { data: appts = [] } = useQuery({
    queryKey: ['appointments', todayISO(), doctorId],
    queryFn: () => window.electronAPI.appointments.list({ date: todayISO(), doctor_id: doctorId }),
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => {
    const total = appts.length;
    const done = appts.filter((a) => a.status === 'Done').length;
    const remaining = total - done;
    return { total, done, remaining };
  }, [appts]);

  const activeId = useMemo(
    () => appts.find((a) => a.status === 'In Progress')?.id ?? null,
    [appts]
  );

  const { data: history = [] } = useQuery({
    queryKey: ['patients', 'recent-for-doctor', selected?.patient_id, doctorId],
    queryFn: async () => {
      if (!selected) return [];
      const all = await window.electronAPI.patients.recentAppointments(selected.patient_id, 10);
      return all.filter((a: any) => a.doctor_id === doctorId && a.id !== selected.id).slice(0, 3);
    },
    enabled: !!selected,
  });

  const update = useMutation({
    mutationFn: ({ id, status }: { id: number; status: AppointmentStatus }) =>
      window.electronAPI.appointments.updateStatus(id, status),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (selected) setSelected({ ...selected, status: v.status });
    },
  });

  if (!doctor) {
    return <div className="p-6 text-xs text-gray-500">Loading…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/doctor-select')}
            className="btn-secondary"
            title="Back to Doctors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">{doctor.name}</h1>
            {doctor.qualifications && (
              <div className="text-[11px] text-blue-600 dark:text-blue-300 font-medium">{doctor.qualifications}</div>
            )}
            <div className="text-xs text-gray-500 dark:text-slate-400">{doctor.specialty}{doctor.room_number ? ` · Room ${doctor.room_number}` : ''}</div>
            <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{fmtDate(todayISO())}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <Stat label="Total" value={stats.total} tone="gray" />
          <Stat label="Remaining" value={stats.remaining} tone="blue" />
          <Stat label="Done" value={stats.done} tone="green" />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Queue */}
        <section className="w-[40%] border-r border-gray-200 bg-white overflow-auto">
          <div className="px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Today's Queue
          </div>
          {appts.length === 0 ? (
            <EmptyState title="No appointments today" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {appts.map((a) => {
                const wait = waitMinutes(a.appointment_time, a.appointment_date);
                return (
                  <li
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={cn(
                      'px-5 py-3 cursor-pointer transition',
                      selected?.id === a.id
                        ? 'bg-blue-100 dark:bg-blue-900/50'
                        : 'hover:bg-gray-100 dark:hover:bg-slate-700',
                      activeId === a.id && 'border-l-4 border-green-500'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-700 dark:text-slate-200">#{a.token_number}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-slate-50">{a.patient_name}</span>
                      </div>
                      {queueOn && <StatusBadge status={a.status} />}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-600 dark:text-slate-300 mt-1">
                      <span>{ageString(a.patient_dob)} · {a.patient_gender}</span>
                      <span>·</span>
                      <span>{fmt12h(a.appointment_time)}</span>
                      {queueOn && a.status === 'Waiting' && wait > 0 && (
                        <span className="text-amber-700 dark:text-amber-300">waited {wait}m</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Detail */}
        <section className="flex-1 bg-gray-50 overflow-auto p-6">
          {!selected ? (
            <EmptyState icon={User} title="Select a patient" description="Click a patient from the queue." />
          ) : (
            <div className="max-w-2xl space-y-4">
              <div className="card p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Token #{selected.token_number} · {selected.appointment_time}</div>
                    <h2 className="text-xl font-bold text-gray-900 mt-1">{selected.patient_name}</h2>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-600 mt-2">
                      <span className="flex items-center gap-1"><Cake className="w-3 h-3" /> {age(selected.patient_dob)} yrs · {selected.patient_gender}</span>
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {selected.patient_phone}</span>
                      {selected.patient_blood_group && <span className="badge bg-red-50 text-red-700">{selected.patient_blood_group}</span>}
                    </div>
                    {selected.notes && (
                      <div className="mt-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <span className="text-xs text-gray-500">Notes:</span> {selected.notes}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                {queueOn && (
                  <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-gray-100 dark:border-slate-700">
                    <button
                      className="btn bg-green-600 text-white hover:bg-green-700 focus:ring-green-500"
                      disabled={selected.status === 'In Progress'}
                      onClick={() => update.mutate({ id: selected.id, status: 'In Progress' })}
                    >
                      <PlayCircle className="w-4 h-4" /> Mark In Progress
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={selected.status === 'Done'}
                      onClick={() => update.mutate({ id: selected.id, status: 'Done' })}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Done
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        update.mutate({ id: selected.id, status: 'Send to Billing' });
                        toast('Sent to billing');
                        navigate('/billing');
                      }}
                    >
                      <Receipt className="w-4 h-4" /> Send to Billing
                    </button>
                  </div>
                )}
              </div>

              <ConsultationPanel appointment={selected} doctor={doctor} />

              <div className="card p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Past visits with {doctor.name.split(' ')[0]} (last 3)</h3>
                {history.length === 0 ? (
                  <div className="text-xs text-gray-500">No prior visits.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {history.map((h: any) => (
                      <li key={h.id} className="py-2">
                        <div className="text-sm text-gray-900">{fmtDate(h.appointment_date)} · {h.appointment_time}</div>
                        {h.notes && <div className="text-xs text-gray-500 mt-0.5">{h.notes}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'blue' | 'green' }) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
  };
  return (
    <div className={cn('rounded-lg px-4 py-2', tones[tone])}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
