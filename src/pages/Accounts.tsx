import { useQuery } from '@tanstack/react-query';
import { Wallet, CalendarDays, CalendarRange, TrendingUp, CreditCard, Banknote, Smartphone, Stethoscope } from 'lucide-react';
import { cn, fmtDate, formatINR } from '../lib/utils';
import { EmptyState } from '../components/EmptyState';

export function Accounts() {
  const hasApi = !!window.electronAPI?.finance;
  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: () => window.electronAPI.finance.summary(),
    refetchInterval: 30_000,
    enabled: hasApi,
    retry: 1,
  });

  if (!hasApi) {
    return (
      <div className="p-6 max-w-lg">
        <div className="card p-5 border-amber-300">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Finance API not loaded</h2>
          <p className="text-xs text-gray-600 dark:text-slate-300 mt-2">
            The preload bundle was added after the app started. Fully close the Electron window and run <code className="px-1 rounded bg-gray-100 dark:bg-slate-700">npm start</code> again to pick up the new IPC.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-lg">
        <div className="card p-5 border-red-300">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">Failed to load finance</h2>
          <p className="text-xs text-gray-600 dark:text-slate-300 mt-2">{(error as any)?.message || String(error)}</p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading finance summary…</div>;
  }

  const maxDay = Math.max(1, ...data.byDay.map((d) => d.total));
  const maxMonth = Math.max(1, ...data.byMonth.map((d) => d.total));

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Accounts & Finance</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">Collections across day, week, month — broken down by mode and doctor.</p>
      </div>

      {/* Top summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Today" value={formatINR(data.today.total)} sub={`${data.today.count} bill${data.today.count === 1 ? '' : 's'}`} icon={<Wallet className="w-5 h-5" />} tone="emerald" />
        <StatCard label="This Week" value={formatINR(data.week.total)} sub={`${data.week.count} bill${data.week.count === 1 ? '' : 's'}`} icon={<CalendarDays className="w-5 h-5" />} tone="blue" />
        <StatCard label="This Month" value={formatINR(data.month.total)} sub={`${data.month.count} bill${data.month.count === 1 ? '' : 's'}`} icon={<CalendarRange className="w-5 h-5" />} tone="purple" />
        <StatCard label="All time" value={formatINR(data.allTime.total)} sub={`${data.allTime.count} bill${data.allTime.count === 1 ? '' : 's'}`} icon={<TrendingUp className="w-5 h-5" />} tone="amber" />
      </div>

      {/* Today by mode */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Today by Payment Mode</h2>
        {data.today.byMode.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">No collections today yet.</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {data.today.byMode.map((m) => (
              <ModeTile key={m.payment_mode} mode={m.payment_mode} total={m.total} count={m.count} />
            ))}
          </div>
        )}
      </section>

      {/* Two columns: daily + monthly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Last 30 Days (day-wise)</h2>
          {data.byDay.length === 0 ? (
            <EmptyState title="No data" description="Bills will appear here as you register/bill patients." />
          ) : (
            <ul className="space-y-1.5">
              {data.byDay.map((d) => (
                <li key={d.day} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-slate-400 w-24">{fmtDate(d.day)}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-500"
                      style={{ width: `${Math.max(2, (d.total / maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-slate-100 w-24 text-right">{formatINR(d.total)}</span>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{d.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Monthly (last 12 months)</h2>
          {data.byMonth.length === 0 ? (
            <EmptyState title="No data" />
          ) : (
            <ul className="space-y-1.5">
              {data.byMonth.map((m) => (
                <li key={m.month} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-slate-400 w-20">{m.month}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                      style={{ width: `${Math.max(2, (m.total / maxMonth) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-slate-100 w-24 text-right">{formatINR(m.total)}</span>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{m.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Weekly + payment-mode + doctor breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Weekly (last 8)</h2>
          {data.byWeek.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-1.5">Week</th>
                  <th className="py-1.5 text-right">Bills</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.byWeek.map((w) => (
                  <tr key={w.week} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5 text-gray-700 dark:text-slate-200">{w.week}</td>
                    <td className="py-1.5 text-right text-gray-600 dark:text-slate-300">{w.count}</td>
                    <td className="py-1.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatINR(w.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">By Payment Mode (all-time)</h2>
          {data.byMode.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div>
          ) : (
            <div className="space-y-2">
              {data.byMode.map((m) => (
                <ModeTile key={m.payment_mode} mode={m.payment_mode} total={m.total} count={m.count} inline />
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">By Doctor (all-time)</h2>
          {data.byDoctor.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">No doctor-linked bills yet.</div>
          ) : (
            <ul className="space-y-2">
              {data.byDoctor.map((d) => (
                <li key={d.doctor} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center">
                    <Stethoscope className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-slate-100 truncate">{d.doctor}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.specialty} · {d.count} bills</div>
                  </div>
                  <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{formatINR(d.total)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: 'emerald' | 'blue' | 'purple' | 'amber' }) {
  const tones: Record<string, string> = {
    emerald: 'from-emerald-500 to-teal-500',
    blue: 'from-blue-500 to-indigo-500',
    purple: 'from-purple-500 to-pink-500',
    amber: 'from-amber-500 to-orange-500',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>
        </div>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br', tones[tone])}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function ModeTile({ mode, total, count, inline = false }: { mode: string; total: number; count: number; inline?: boolean }) {
  const icon = mode === 'Cash' ? <Banknote className="w-4 h-4" /> : mode === 'UPI' ? <Smartphone className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />;
  const tone =
    mode === 'Cash' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    : mode === 'UPI' ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300';

  if (inline) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 dark:border-slate-700">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', tone)}>{icon}</div>
        <div className="flex-1">
          <div className="text-sm text-gray-900 dark:text-slate-100">{mode}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">{count} bills</div>
        </div>
        <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{formatINR(total)}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', tone)}>{icon}</div>
      <div className="text-xs text-gray-500 dark:text-slate-400">{mode}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-slate-100">{formatINR(total)}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">{count} bill{count === 1 ? '' : 's'}</div>
    </div>
  );
}
