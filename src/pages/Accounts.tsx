import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, CalendarDays, CalendarRange, TrendingUp, CreditCard, Banknote, Smartphone, Stethoscope, Pill, ShoppingCart, Clock, MapPin, Users as UsersIcon, Sun, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn, fmtDate, formatINR, todayISO } from '../lib/utils';
import { EmptyState } from '../components/EmptyState';
import { colorForDoctor } from '../lib/doctor-colors';
import type { Doctor } from '../types';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Accounts() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayISO());

  const { data, isLoading } = useQuery({
    queryKey: ['finance-summary', from, to],
    queryFn: () => window.electronAPI.finance.summary({ from, to }),
    refetchInterval: 30_000,
  });
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-all'],
    queryFn: () => window.electronAPI.doctors.list(false),
  });
  const doctorColorByName = new Map<string, string>();
  for (const d of doctors as Doctor[]) doctorColorByName.set(d.name, colorForDoctor(d));

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading finance summary…</div>;
  }

  const maxDay = Math.max(1, ...data.byDay.map((d: any) => d.total));
  const maxMonth = Math.max(1, ...data.byMonth.map((d: any) => d.total));
  const maxWeekday = Math.max(1, ...data.byWeekday.map((d: any) => d.total));
  const maxHour = Math.max(1, ...data.byHour.map((d: any) => d.total));

  const weekChange = delta(data.week.total, data.prevWeek.total);
  const monthChange = delta(data.month.total, data.prevMonth.total);
  const dayChange = delta(data.today.total, data.yesterday.total);

  const exportCsv = () => {
    const rows = [
      ['Section', 'Label', 'Bills', 'Total'],
      ['Today', '', data.today.count, data.today.total],
      ['Yesterday', '', data.yesterday.count, data.yesterday.total],
      ['This Week', '', data.week.count, data.week.total],
      ['Last Week', '', data.prevWeek.count, data.prevWeek.total],
      ['This Month', '', data.month.count, data.month.total],
      ['Last Month', '', data.prevMonth.count, data.prevMonth.total],
      ['All Time', '', data.allTime.count, data.allTime.total],
      ['', '', '', ''],
      ['By Day', 'Day', 'Bills', 'Total'],
      ...data.byDay.map((d: any) => ['', d.day, d.count, d.total]),
      ['', '', '', ''],
      ['By Doctor', 'Doctor', 'Bills', 'Total'],
      ...data.byDoctor.map((d: any) => ['', d.doctor, d.count, d.total]),
      ['', '', '', ''],
      ['By Payment Mode', 'Mode', 'Bills', 'Total'],
      ...data.byMode.map((m: any) => ['', m.payment_mode, m.count, m.total]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance_${from}_to_${to}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Accounts & Finance</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Deep revenue analytics — filter range, compare periods, drill down by doctor, day, place.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-gray-500">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-secondary" onClick={exportCsv}><Download className="w-4 h-4" /> CSV</button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Today"
          value={formatINR(data.today.total)}
          sub={`${data.today.count} bills`}
          change={dayChange}
          compareLabel="vs yesterday"
          icon={<Wallet className="w-5 h-5" />}
          tone="emerald"
        />
        <KpiCard
          label="This Week"
          value={formatINR(data.week.total)}
          sub={`${data.week.count} bills`}
          change={weekChange}
          compareLabel="vs last week"
          icon={<CalendarDays className="w-5 h-5" />}
          tone="blue"
        />
        <KpiCard
          label="This Month"
          value={formatINR(data.month.total)}
          sub={`${data.month.count} bills`}
          change={monthChange}
          compareLabel="vs last month"
          icon={<CalendarRange className="w-5 h-5" />}
          tone="purple"
        />
        <KpiCard
          label="All time"
          value={formatINR(data.allTime.total)}
          sub={`${data.allTime.count} bills · avg ${formatINR(data.allTime.avg)} · max ${formatINR(data.allTime.max)}`}
          icon={<TrendingUp className="w-5 h-5" />}
          tone="amber"
        />
      </div>

      {/* Range summary + revenue source split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Range · {fmtDate(data.range.from)} → {fmtDate(data.range.to)}
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="OPD Bills" value={formatINR(data.range.bills.total)} sub={`${data.range.bills.count}`} icon={<Stethoscope className="w-4 h-4" />} tone="blue" />
            <Tile label="Pharmacy" value={formatINR(data.range.pharma.total)} sub={`${data.range.pharma.count}`} icon={<Pill className="w-4 h-4" />} tone="lime" />
            <Tile
              label="Total Collected"
              value={formatINR(data.range.bills.total + data.range.pharma.total)}
              sub={`${data.range.bills.count + data.range.pharma.count} transactions`}
              icon={<ShoppingCart className="w-4 h-4" />}
              tone="emerald"
            />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Today by Payment Mode</h2>
          {data.today.byMode.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">No collections today yet.</div>
          ) : (
            <div className="space-y-2">
              {data.today.byMode.map((m: any) => (
                <ModeTile key={m.payment_mode} mode={m.payment_mode} total={m.total} count={m.count} inline />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Daily + Monthly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Day-wise (selected range)</h2>
          {data.byDay.length === 0 ? (
            <EmptyState title="No data in this range" />
          ) : (
            <ul className="space-y-1.5 max-h-[300px] overflow-auto">
              {data.byDay.map((d: any) => (
                <li key={d.day} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-slate-400 w-24">{fmtDate(d.day)}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${Math.max(2, (d.total / maxDay) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-slate-100 w-24 text-right">{formatINR(d.total)}</span>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{d.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Monthly (last 12)</h2>
          {data.byMonth.length === 0 ? <EmptyState title="No data" /> : (
            <ul className="space-y-1.5">
              {data.byMonth.map((m: any) => (
                <li key={m.month} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-slate-400 w-20">{m.month}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${Math.max(2, (m.total / maxMonth) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-slate-100 w-24 text-right">{formatINR(m.total)}</span>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{m.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Weekday + Hour */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Busiest Weekday (last 90 days)</h2>
          </div>
          {data.byWeekday.length === 0 ? <EmptyState title="No data" /> : (
            <ul className="space-y-1.5">
              {Array.from({ length: 7 }).map((_, wd) => {
                const row = data.byWeekday.find((r: any) => Number(r.wd) === wd);
                const total = row?.total || 0;
                const count = row?.count || 0;
                return (
                  <li key={wd} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 dark:text-slate-300 w-12 font-semibold">{WEEKDAY[wd]}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500" style={{ width: `${Math.max(2, (total / maxWeekday) * 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-slate-100 w-24 text-right">{formatINR(total)}</span>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{count}×</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Peak Hours (last 30 days)</h2>
          </div>
          {data.byHour.length === 0 ? <EmptyState title="No data" /> : (
            <div className="flex items-end gap-1 h-32">
              {Array.from({ length: 24 }).map((_, h) => {
                const row = data.byHour.find((r: any) => Number(r.hr) === h);
                const total = row?.total || 0;
                const height = Math.max(4, (total / maxHour) * 100);
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1" title={`${h}:00 · ${formatINR(total)}`}>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-amber-500 to-orange-500"
                      style={{ height: `${height}%`, minHeight: 2 }}
                    />
                    <span className="text-[9px] text-gray-400">{h}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-2">Hour of day (0–23). Tooltip shows revenue.</div>
        </section>
      </div>

      {/* Doctors + Modes + Places */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-purple-600" /> By Doctor (all-time)
          </h2>
          {data.byDoctor.length === 0 ? <div className="text-xs text-gray-500 dark:text-slate-400">No doctor-linked bills yet.</div> : (
            <ul className="space-y-2">
              {data.byDoctor.map((d: any) => {
                const color = doctorColorByName.get(d.doctor) || '#a855f7';
                return (
                  <li key={d.doctor} className="flex items-center gap-3" style={{ borderLeft: `4px solid ${color}`, paddingLeft: 10 }}>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                      style={{ backgroundColor: color }}
                    >
                      <Stethoscope className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 dark:text-slate-100 truncate inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        {d.doctor}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.specialty} · {d.count} bills</div>
                    </div>
                    <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{formatINR(d.total)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">By Payment Mode (all-time)</h2>
          {data.byMode.length === 0 ? <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div> : (
            <div className="space-y-2">
              {data.byMode.map((m: any) => (
                <ModeTile key={m.payment_mode} mode={m.payment_mode} total={m.total} count={m.count} inline />
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-rose-500" /> Revenue by Place (last 90d)
          </h2>
          {data.byPlace.length === 0 ? <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div> : (
            <ul className="space-y-1.5 max-h-[260px] overflow-auto">
              {data.byPlace.map((p: any) => (
                <li key={p.place} className="flex items-center justify-between">
                  <span className="text-sm text-gray-800 dark:text-slate-200 truncate">{p.place}</span>
                  <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">{formatINR(p.total)} <span className="opacity-60">· {p.bills}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Top Patients */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-emerald-600" /> Top 10 Patients by Revenue (all-time)
        </h2>
        {data.topPatients.length === 0 ? <div className="text-xs text-gray-500 dark:text-slate-400">No data.</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2">Rank</th>
                <th className="py-2">Patient</th>
                <th className="py-2">UHID</th>
                <th className="py-2">Place</th>
                <th className="py-2 text-right">Bills</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.topPatients.map((p: any, idx: number) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400">#{idx + 1}</td>
                  <td className="py-1.5 text-gray-900 dark:text-slate-100">{p.name}</td>
                  <td className="py-1.5 font-mono text-xs text-gray-500 dark:text-slate-400">{p.uhid}</td>
                  <td className="py-1.5 text-gray-600 dark:text-slate-300">{p.place || '—'}</td>
                  <td className="py-1.5 text-right">{p.bills}</td>
                  <td className="py-1.5 text-right font-semibold">{formatINR(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function delta(current: number, prev: number): { pct: number; abs: number; dir: 'up' | 'down' | 'flat' } {
  const abs = current - prev;
  if (prev === 0) return { pct: current > 0 ? 100 : 0, abs, dir: current > 0 ? 'up' : 'flat' };
  const pct = Math.round((abs / prev) * 1000) / 10;
  return { pct: Math.abs(pct), abs, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

function KpiCard({ label, value, sub, change, compareLabel, icon, tone }: { label: string; value: string; sub?: string; change?: { pct: number; dir: 'up' | 'down' | 'flat' }; compareLabel?: string; icon: React.ReactNode; tone: 'emerald' | 'blue' | 'purple' | 'amber' }) {
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
          <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</div>
          {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>}
          {change && compareLabel && (
            <div className={cn(
              'inline-flex items-center gap-1 text-[11px] font-semibold mt-1',
              change.dir === 'up' && 'text-emerald-700 dark:text-emerald-300',
              change.dir === 'down' && 'text-red-600 dark:text-red-300',
              change.dir === 'flat' && 'text-gray-500 dark:text-slate-400'
            )}>
              {change.dir === 'up' ? <ArrowUpRight className="w-3 h-3" /> : change.dir === 'down' ? <ArrowDownRight className="w-3 h-3" /> : null}
              {change.dir !== 'flat' ? `${change.pct}%` : 'flat'}
              <span className="opacity-70 font-normal">{compareLabel}</span>
            </div>
          )}
        </div>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br flex-shrink-0', tones[tone])}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: 'blue' | 'lime' | 'emerald' }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    lime: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', tones[tone])}>{icon}</div>
      <div className="text-xs text-gray-500 dark:text-slate-400">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-slate-100">{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub} bill{Number(sub) === 1 ? '' : 's'}</div>
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
  return null;
}
