import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { MapPin, Users, AlertCircle, Globe, Map } from 'lucide-react';
import { cn, fmtDate, todayISO } from '../lib/utils';
import { EmptyState } from '../components/EmptyState';

type Range = 'day' | 'week' | 'month' | 'custom';

export function PatientOrigin() {
  const [range, setRange] = useState<Range>('month');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());

  const [from, to] = useMemo(() => {
    const now = new Date();
    if (range === 'day') return [todayISO(), todayISO()];
    if (range === 'week') return [format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')];
    if (range === 'month') return [format(startOfMonth(now), 'yyyy-MM-dd'), format(endOfMonth(now), 'yyyy-MM-dd')];
    return [customFrom, customTo];
  }, [range, customFrom, customTo]);

  const hasApi = !!window.electronAPI?.origin;
  const { data, isLoading } = useQuery({
    queryKey: ['origin-summary', from, to],
    queryFn: () => window.electronAPI.origin.summary({ from, to }),
    enabled: hasApi,
  });

  if (!hasApi) {
    return (
      <div className="p-6 max-w-lg">
        <div className="card p-5 border-amber-300">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">API not loaded</h2>
          <p className="text-xs text-gray-600 dark:text-slate-300 mt-2">
            Close the app fully and re-run <code className="px-1 rounded bg-gray-100 dark:bg-slate-700">npm start</code> — the new IPC loads only on full restart.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Patient Origin</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Where your patients are coming from — by village, district, state.</p>
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
          <span className="text-[11px] text-gray-500 dark:text-slate-400">{fmtDate(from)} — {fmtDate(to)}</span>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Visits" value={data.totalVisits} icon={<Users className="w-4 h-4" />} tone="indigo" />
            <StatCard label="Unique Patients" value={data.uniquePatients} icon={<Users className="w-4 h-4" />} tone="emerald" />
            <StatCard label="Distinct Places" value={data.byPlace.filter((p) => p.name !== 'Unknown').length} icon={<MapPin className="w-4 h-4" />} tone="purple" />
            <StatCard
              label="Missing Place"
              value={data.missingPlace}
              icon={<AlertCircle className="w-4 h-4" />}
              tone="amber"
              sub={data.missingPlace > 0 ? `${Math.round((data.missingPlace / Math.max(1, data.totalVisits)) * 100)}% of visits` : 'Great — all filled'}
            />
          </div>

          {/* Top Places */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">By Place / Village</h2>
            </div>
            {data.byPlace.length === 0 ? (
              <EmptyState icon={MapPin} title="No data" description="Add place info to patient records." />
            ) : (
              <BarList list={data.byPlace} tone="emerald" />
            )}
          </section>

          {/* District + State side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Map className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">By District</h2>
              </div>
              {data.byDistrict.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div>
              ) : (
                <BarList list={data.byDistrict} tone="blue" />
              )}
            </section>

            <section className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">By State</h2>
              </div>
              {data.byState.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div>
              ) : (
                <BarList list={data.byState} tone="purple" />
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function BarList({ list, tone }: { list: { name: string; visits: number; patients: number }[]; tone: 'emerald' | 'blue' | 'purple' }) {
  const max = Math.max(1, ...list.map((l) => l.visits));
  const bars: Record<string, string> = {
    emerald: 'from-emerald-500 to-teal-500',
    blue: 'from-blue-500 to-indigo-500',
    purple: 'from-purple-500 to-pink-500',
  };
  return (
    <ul className="space-y-1.5 max-h-[480px] overflow-auto">
      {list.map((r) => (
        <li key={r.name} className="flex items-center gap-3">
          <span className="w-40 text-sm text-gray-900 dark:text-slate-100 truncate" title={r.name}>{r.name}</span>
          <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
            <div className={cn('h-full bg-gradient-to-r', bars[tone])} style={{ width: `${Math.max(3, (r.visits / max) * 100)}%` }} />
          </div>
          <span className="w-16 text-right text-sm font-semibold text-gray-900 dark:text-slate-100">{r.visits}</span>
          <span className="w-20 text-right text-[11px] text-gray-500 dark:text-slate-400">{r.patients} patient{r.patients === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
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

function StatCard({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; tone: 'indigo' | 'emerald' | 'purple' | 'amber' }) {
  const tones: Record<string, string> = {
    indigo: 'from-indigo-500 to-blue-500',
    emerald: 'from-emerald-500 to-teal-500',
    purple: 'from-purple-500 to-fuchsia-500',
    amber: 'from-amber-500 to-orange-500',
  };
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
          <div className="text-lg font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</div>
          {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400">{sub}</div>}
        </div>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white bg-gradient-to-br', tones[tone])}>{icon}</div>
      </div>
    </div>
  );
}
