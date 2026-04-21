import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, subDays } from 'date-fns';
import { Users, CalendarDays, CalendarRange, Clock4, TrendingUp, Search, Download, Repeat, Sparkles, Stethoscope, Printer } from 'lucide-react';
import { cn, ageString, fmt12h, fmtDate, formatINR, todayISO } from '../lib/utils';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { OpdSlipFor } from '../components/OpdSlipFor';
import type { AppointmentWithJoins } from '../types';

type Range = 'day' | 'week' | 'month' | 'custom';

export function PatientLog() {
  const [range, setRange] = useState<Range>('day');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [doctorId, setDoctorId] = useState<'all' | number>('all');
  const [groupByDay, setGroupByDay] = useState(true);
  const [printAppt, setPrintAppt] = useState<AppointmentWithJoins | null>(null);

  const [from, to] = useMemo(() => {
    const now = new Date();
    if (range === 'day') return [todayISO(), todayISO()];
    if (range === 'week') return [format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')];
    if (range === 'month') return [format(startOfMonth(now), 'yyyy-MM-dd'), format(endOfMonth(now), 'yyyy-MM-dd')];
    return [customFrom, customTo];
  }, [range, customFrom, customTo]);

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  const hasApi = !!window.electronAPI?.patients?.log;
  const { data, isLoading, error } = useQuery({
    queryKey: ['patient-log', from, to, q, doctorId],
    queryFn: () => window.electronAPI.patients.log({ from, to, q: q || undefined, doctor_id: doctorId === 'all' ? undefined : doctorId }),
    enabled: hasApi,
  });

  if (!hasApi) {
    return (
      <div className="p-6 max-w-lg">
        <div className="card p-5 border-amber-300">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">API not loaded</h2>
          <p className="text-xs text-gray-600 dark:text-slate-300 mt-2">
            Close the app fully and re-run <code className="px-1 rounded bg-gray-100 dark:bg-slate-700">npm start</code> to load the new IPC.
          </p>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const intel = data?.intel;
  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!map.has(r.appointment_date)) map.set(r.appointment_date, [] as any);
      map.get(r.appointment_date)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  const exportCsv = () => {
    const headers = ['Date','Time','Token','UHID','Patient','Age','Sex','Phone','Doctor','Specialty','Complaint','Status','Fee','PaymentMode','BillNo'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const vals = [
        r.appointment_date, r.appointment_time, r.token_number, r.patient_uhid,
        (r.patient_name || '').replaceAll(',', ' '),
        ageString(r.patient_dob).replaceAll(',', ' '),
        r.patient_gender,
        r.patient_phone,
        (r.doctor_name || '').replaceAll(',', ' '),
        (r.doctor_specialty || '').replaceAll(',', ' '),
        (r.notes || '').replaceAll(',', ' ').replaceAll('\n', ' '),
        r.status,
        r.bill_total ?? '',
        r.bill_payment_mode ?? '',
        r.bill_number ?? '',
      ];
      lines.push(vals.map((v) => `"${String(v ?? '')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient-log_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Patient Log</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Day / Week / Month history of everyone seen, with details & insights.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
            <RangeBtn active={range === 'day'} onClick={() => setRange('day')}>Today</RangeBtn>
            <RangeBtn active={range === 'week'} onClick={() => setRange('week')}>This Week</RangeBtn>
            <RangeBtn active={range === 'month'} onClick={() => setRange('month')}>This Month</RangeBtn>
            <RangeBtn active={range === 'custom'} onClick={() => setRange('custom')}>Custom</RangeBtn>
          </div>
          {range === 'custom' && (
            <>
              <input type="date" className="input w-auto" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="text-xs text-gray-500">to</span>
              <input type="date" className="input w-auto" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
          <button className="btn-secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search patient name / UHID / phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={String(doctorId)} onChange={(e) => setDoctorId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All Doctors</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300">
          <input type="checkbox" checked={groupByDay} onChange={(e) => setGroupByDay(e.target.checked)} /> Group by day
        </label>
        <span className="ml-auto text-[11px] text-gray-500 dark:text-slate-400">
          {fmtDate(from)} — {fmtDate(to)}
        </span>
      </div>

      {/* Intel cards */}
      {intel && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <IntelCard label="Total visits" value={intel.totalVisits} icon={<Users className="w-4 h-4" />} tone="indigo" />
          <IntelCard label="Unique patients" value={intel.uniquePatients} icon={<Sparkles className="w-4 h-4" />} tone="emerald" />
          <IntelCard label="Repeat visits" value={intel.repeatVisits} icon={<Repeat className="w-4 h-4" />} tone="amber" />
          <IntelCard label="Revenue" value={formatINR(intel.revenue)} icon={<TrendingUp className="w-4 h-4" />} tone="pink" />
          <IntelCard label="Avg / day" value={intel.avgPerDay} icon={<CalendarDays className="w-4 h-4" />} tone="blue" />
          <IntelCard
            label="Peak day"
            value={intel.peakDay ? `${intel.peakDay.count}` : '—'}
            sub={intel.peakDay ? fmtDate(intel.peakDay.date) : undefined}
            icon={<CalendarRange className="w-4 h-4" />}
            tone="purple"
          />
        </div>
      )}

      {/* Breakdown: doctors + status */}
      {intel && (intel.byDoctor.length > 0 || intel.byStatus.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="card p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-purple-500" /> By Doctor
            </h3>
            <ul className="space-y-2">
              {intel.byDoctor.map((d) => (
                <li key={d.doctor} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-slate-100 truncate">{d.doctor}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.specialty}</div>
                  </div>
                  <div className="w-32 bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                      style={{ width: `${Math.max(4, (d.count / Math.max(1, intel.totalVisits)) * 100)}%` }}
                    />
                  </div>
                  <div className="w-8 text-right text-sm font-semibold text-gray-900 dark:text-slate-100">{d.count}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Clock4 className="w-4 h-4 text-blue-500" /> By Status
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {intel.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between p-2 rounded-lg border border-gray-200 dark:border-slate-700">
                  <StatusBadge status={s.status as any} />
                  <span className="text-sm font-bold text-gray-900 dark:text-slate-100">{s.count}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* List */}
      <section className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-xs text-gray-500 dark:text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No visits found" description="Try a different date range or clear filters." />
        ) : groupByDay ? (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {grouped.map(([date, list]) => (
              <div key={date}>
                <div className="px-5 py-2 bg-gray-50 dark:bg-slate-900 flex items-center justify-between sticky top-0">
                  <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{fmtDate(date)}</span>
                  <span className="text-[11px] text-gray-500 dark:text-slate-400">{list.length} visit{list.length === 1 ? '' : 's'}</span>
                </div>
                <LogTable rows={list} onPrint={setPrintAppt} />
              </div>
            ))}
          </div>
        ) : (
          <LogTable rows={rows} onPrint={setPrintAppt} />
        )}
      </section>

      {printAppt && <OpdSlipFor appointment={printAppt} onClose={() => setPrintAppt(null)} />}
    </div>
  );
}

function LogTable({
  rows,
  onPrint,
}: {
  rows: (AppointmentWithJoins & { bill_total: number | null; bill_payment_mode: string | null; bill_number: string | null })[];
  onPrint: (a: AppointmentWithJoins) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="px-4 py-2">Token</th>
            <th className="px-4 py-2">Visit ID</th>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Patient</th>
            <th className="px-4 py-2">Age / Sex</th>
            <th className="px-4 py-2">Phone</th>
            <th className="px-4 py-2">Doctor</th>
            <th className="px-4 py-2">Complaint</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Fee</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40">
              <td className="px-4 py-2 font-semibold text-gray-700 dark:text-slate-200">#{r.token_number}</td>
              <td className="px-4 py-2 font-mono text-[11px] tracking-wider text-indigo-600 dark:text-indigo-400">{r.consultation_token || '—'}</td>
              <td className="px-4 py-2 text-gray-600 dark:text-slate-300">{fmt12h(r.appointment_time)}</td>
              <td className="px-4 py-2">
                <div className="font-medium text-gray-900 dark:text-slate-100">{r.patient_name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{r.patient_uhid}</div>
              </td>
              <td className="px-4 py-2 text-gray-700 dark:text-slate-200 whitespace-nowrap">{ageString(r.patient_dob)} · {r.patient_gender}</td>
              <td className="px-4 py-2 text-gray-600 dark:text-slate-300">{r.patient_phone}</td>
              <td className="px-4 py-2">
                <div className="text-gray-900 dark:text-slate-100">{r.doctor_name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{r.doctor_specialty}</div>
              </td>
              <td className="px-4 py-2 text-gray-700 dark:text-slate-200 max-w-[250px] truncate" title={r.notes || ''}>
                {r.notes || <span className="text-gray-400">—</span>}
              </td>
              <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-4 py-2 text-right">
                {r.bill_total != null ? (
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-slate-100">{formatINR(r.bill_total)}</div>
                    <div className="text-[10px] text-gray-500 dark:text-slate-400">{r.bill_payment_mode}</div>
                  </div>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <button className="btn-ghost text-xs" onClick={() => onPrint(r)} title="Print OPD slip">
                  <Printer className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-md text-xs font-medium transition',
        active ? 'bg-white dark:bg-slate-800 shadow-sm text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100'
      )}
    >
      {children}
    </button>
  );
}

function IntelCard({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; tone: 'indigo' | 'emerald' | 'amber' | 'pink' | 'blue' | 'purple' }) {
  const tones: Record<string, string> = {
    indigo: 'from-indigo-500 to-blue-500',
    emerald: 'from-emerald-500 to-teal-500',
    amber: 'from-amber-500 to-orange-500',
    pink: 'from-pink-500 to-rose-500',
    blue: 'from-blue-500 to-cyan-500',
    purple: 'from-purple-500 to-fuchsia-500',
  };
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
          <div className="text-lg font-bold text-gray-900 dark:text-slate-100 mt-0.5 truncate">{value}</div>
          {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate">{sub}</div>}
        </div>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white bg-gradient-to-br flex-shrink-0', tones[tone])}>
          {icon}
        </div>
      </div>
    </div>
  );
}
