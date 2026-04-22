import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowRight, Clock4, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { todayISO } from '../lib/utils';

export function DoctorSelect() {
  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  const { data: todayAppts = [] } = useQuery({
    queryKey: ['appointments', todayISO()],
    queryFn: () => window.electronAPI.appointments.list({ date: todayISO() }),
    refetchInterval: 20_000,
  });

  const statsByDoctor = useMemo(() => {
    const map = new Map<number, { pending: number; done: number; total: number }>();
    for (const a of todayAppts) {
      const prev = map.get(a.doctor_id) || { pending: 0, done: 0, total: 0 };
      prev.total += 1;
      if (a.status === 'Done' || a.status === 'Cancelled') prev.done += 1;
      else prev.pending += 1;
      map.set(a.doctor_id, prev);
    }
    return map;
  }, [todayAppts]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Doctors</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Click a doctor to open their dashboard. Pending count shows today's remaining queue.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> Pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> Done
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
      ) : doctors.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No doctors yet" description="Add doctors from the Settings page." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {doctors.map((d) => {
            const s = statsByDoctor.get(d.id) || { pending: 0, done: 0, total: 0 };
            return (
              <Link
                key={d.id}
                to={`/doctor/${d.id}`}
                className="card p-5 hover:border-blue-400 hover:shadow-md transition group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center">
                    <Stethoscope className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-slate-100">{d.name}</div>
                    {d.qualifications && (
                      <div className="text-[11px] text-blue-600 dark:text-blue-300 font-medium truncate">{d.qualifications}</div>
                    )}
                    <div className="text-xs text-gray-500 dark:text-slate-400">{d.specialty}</div>
                    {d.room_number && <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">Room {d.room_number}</div>}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 mt-1" />
                </div>

                {/* Stats footer */}
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between gap-3">
                  {s.total === 0 ? (
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">No appointments today</div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        s.pending > 0
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                          : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        <Clock4 className="w-3 h-3" />
                        {s.pending} pending
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        {s.done} done
                      </span>
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">
                    Total: <span className="font-semibold text-gray-800 dark:text-slate-200">{s.total}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
