import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Wallet, MapPin, FileText, Users as UsersIcon, Pill,
  TrendingUp, AlertTriangle, Calendar, Activity, ShieldCheck,
} from 'lucide-react';
import { cn, fmtDate, formatINR, todayISO } from '../lib/utils';

type Tab = 'overview' | 'finance' | 'demographics' | 'origin' | 'pharmacy' | 'operations';

/**
 * Unified Analytics page — consolidates the metrics that previously lived in
 * Accounts (finance), Patient Origin (geography), Reports (operational), plus
 * two new sections: Demographics (gender/age/blood/profession) and Pharmacy
 * Overview (dispensing register + sales mix + low-stock + expiring batches).
 *
 * The original pages (Accounts, Patient Origin, Reports, Patient Log) stay
 * intact in the sidebar — Analytics is a new, additional consolidated view.
 */
export function Analytics() {
  const [tab, setTab] = useState<Tab>('overview');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" /> Analytics
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            One place for finance, demographics, geography, pharmacy, and operational reports.
            The original pages stay in the sidebar — this is the consolidated view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-gray-500">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-ghost text-xs" onClick={() => { setFrom(todayISO()); setTo(todayISO()); }}>Today</button>
          <button className="btn-ghost text-xs" onClick={() => { setFrom(daysAgo(7)); setTo(todayISO()); }}>7d</button>
          <button className="btn-ghost text-xs" onClick={() => { setFrom(daysAgo(30)); setTo(todayISO()); }}>30d</button>
          <button className="btn-ghost text-xs" onClick={() => { setFrom(daysAgo(90)); setTo(todayISO()); }}>90d</button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg flex-wrap">
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Activity className="w-3.5 h-3.5" />}>Overview</TabBtn>
        <TabBtn active={tab === 'finance'} onClick={() => setTab('finance')} icon={<Wallet className="w-3.5 h-3.5" />}>Finance</TabBtn>
        <TabBtn active={tab === 'demographics'} onClick={() => setTab('demographics')} icon={<UsersIcon className="w-3.5 h-3.5" />}>Demographics</TabBtn>
        <TabBtn active={tab === 'origin'} onClick={() => setTab('origin')} icon={<MapPin className="w-3.5 h-3.5" />}>Patient Origin</TabBtn>
        <TabBtn active={tab === 'pharmacy'} onClick={() => setTab('pharmacy')} icon={<Pill className="w-3.5 h-3.5" />}>Pharmacy</TabBtn>
        <TabBtn active={tab === 'operations'} onClick={() => setTab('operations')} icon={<FileText className="w-3.5 h-3.5" />}>Operational Reports</TabBtn>
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'finance' && <FinanceTab from={from} to={to} />}
      {tab === 'demographics' && <DemographicsTab />}
      {tab === 'origin' && <OriginTab from={from} to={to} />}
      {tab === 'pharmacy' && <PharmacyTab from={from} to={to} />}
      {tab === 'operations' && <OperationsTab from={from} to={to} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
        active ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300'
      )}
    >
      {icon} {children}
    </button>
  );
}

/* ============================================================
   OVERVIEW — top-level snapshot, alerts, today + month at a glance
   ============================================================ */
function OverviewTab() {
  const { data: ov, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => window.electronAPI.analytics.overview(),
    refetchInterval: 60_000,
  });

  if (isLoading || !ov) {
    return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Today */}
      <section>
        <SectionTitle icon={<Calendar className="w-4 h-4" />} title="Today" subtitle={fmtDate(new Date().toISOString().slice(0, 10))} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Visits today" value={ov.todayVisits} sub={`${ov.todayDone} done`} tone="blue" />
          <Kpi label="Revenue today" value={formatINR(ov.todayRevenue)} tone="emerald" />
          <Kpi label="Active doctors" value={ov.activeDoctors} tone="violet" />
          <Kpi label="Pending Rx" value={ov.pendingRx} sub="across last 7 days" tone={ov.pendingRx > 0 ? 'amber' : 'gray'} />
        </div>
      </section>

      {/* This month */}
      <section>
        <SectionTitle icon={<TrendingUp className="w-4 h-4" />} title="This Month" subtitle={fmtDate(new Date().toISOString().slice(0, 8) + '01') + ' onwards'} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="OPD revenue" value={formatINR(ov.monthRevenue)} tone="emerald" />
          <Kpi label="Pharmacy revenue" value={formatINR(ov.pharmacyMonthRevenue)} tone="emerald" />
          <Kpi label="New patients" value={ov.patientsThisMonth} tone="blue" />
          <Kpi label="Total patients" value={ov.totalPatients.toLocaleString('en-IN')} sub="all-time" tone="indigo" />
        </div>
      </section>

      {/* Alerts */}
      <section>
        <SectionTitle icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} title="Alerts" subtitle="Things that need attention" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <AlertTile
            label="Low stock drugs"
            value={ov.lowStockDrugs}
            href="/pharmacy"
            tone={ov.lowStockDrugs > 0 ? 'amber' : 'gray'}
          />
          <AlertTile
            label="Expiring within 90 days"
            value={ov.expiringSoonBatches}
            href="/pharmacy"
            tone={ov.expiringSoonBatches > 0 ? 'amber' : 'gray'}
          />
          <AlertTile
            label="EXPIRED batches still in stock"
            value={ov.expiredBatches}
            href="/pharmacy"
            tone={ov.expiredBatches > 0 ? 'red' : 'gray'}
          />
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   FINANCE — reuses finance.summary (same source as Accounts page)
   ============================================================ */
function FinanceTab({ from, to }: { from: string; to: string }) {
  const { data: f, isLoading } = useQuery({
    queryKey: ['finance', from, to],
    queryFn: () => window.electronAPI.finance.summary({ from, to }),
  });

  if (isLoading || !f) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle icon={<Wallet className="w-4 h-4" />} title="Revenue snapshot" subtitle="OPD bills + Pharmacy" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Today" value={formatINR(f.today?.total ?? 0)} sub={f.today?.delta != null ? `${f.today.delta > 0 ? '+' : ''}${Math.round(f.today.delta * 100)}% vs yesterday` : undefined} tone="emerald" />
          <Kpi label="This week" value={formatINR(f.week?.total ?? 0)} tone="emerald" />
          <Kpi label="This month" value={formatINR(f.month?.total ?? 0)} tone="emerald" />
          <Kpi label="All-time" value={formatINR(f.allTime?.total ?? 0)} tone="indigo" />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard title="Revenue by day" rows={(f.byDay || []).map((r: any) => ({ label: r.day, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Revenue by month" rows={(f.byMonth || []).map((r: any) => ({ label: r.month, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Busiest weekday (last 90 days)" rows={(f.byWeekday || []).map((r: any) => ({ label: r.weekday, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Peak hours" rows={(f.byHour || []).map((r: any) => ({ label: `${r.hour}:00`, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="By doctor (all-time)" rows={(f.byDoctor || []).map((r: any) => ({ label: r.doctor, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="By payment mode" rows={(f.byMode || []).map((r: any) => ({ label: r.mode || '(none)', value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Revenue by place (90 days)" rows={(f.byPlace || []).map((r: any) => ({ label: r.place || '(unknown)', value: r.total }))} formatValue={formatINR} />
        <BarListCard
          title="Top 10 patients by revenue"
          rows={(f.topPatients || []).map((r: any) => ({ label: `${r.name} · ${r.uhid}`, value: r.total }))}
          formatValue={formatINR}
        />
      </div>
    </div>
  );
}

/* ============================================================
   DEMOGRAPHICS — gender, age groups, blood groups, professions, growth
   ============================================================ */
function DemographicsTab() {
  const { data: d, isLoading } = useQuery({
    queryKey: ['analytics-demographics'],
    queryFn: () => window.electronAPI.analytics.demographics(),
  });

  if (isLoading || !d) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle icon={<UsersIcon className="w-4 h-4" />} title="Patient demographics" subtitle={`${d.total.toLocaleString('en-IN')} patients in the database`} />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard title="By gender" rows={d.byGender.map((r) => ({ label: r.gender, value: r.c }))} />
        <BarListCard title="By age group" rows={d.byAgeGroup.map((r) => ({ label: r.label, value: r.c }))} />
        <BarListCard title="By blood group" rows={d.byBloodGroup.map((r) => ({ label: r.label, value: r.c }))} />
        <BarListCard title="Top 20 professions" rows={d.byProfession.map((r) => ({ label: r.label, value: r.c }))} />
        <BarListCard
          title="New patients per month (last 12)"
          rows={d.newPatientsByMonth.map((r) => ({ label: r.month, value: r.c }))}
          full
        />
      </div>
    </div>
  );
}

/* ============================================================
   PATIENT ORIGIN — reuses origin.summary
   ============================================================ */
function OriginTab({ from, to }: { from: string; to: string }) {
  const { data: o, isLoading } = useQuery({
    queryKey: ['origin', from, to],
    queryFn: () => window.electronAPI.origin.summary({ from, to }),
  });

  if (isLoading || !o) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle icon={<MapPin className="w-4 h-4" />} title="Where patients come from" subtitle={`${fmtDate(from)} — ${fmtDate(to)}`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Total visits" value={o.totalVisits ?? 0} tone="blue" />
          <Kpi label="Unique patients" value={o.uniquePatients ?? 0} tone="blue" />
          <Kpi label="Distinct places" value={(o.byPlace || []).length} tone="indigo" />
          <Kpi label="Missing place" value={`${(o as any).missingPlacePct ?? o.missingPlace ?? 0}%`} sub="of records" tone={((o as any).missingPlacePct ?? o.missingPlace ?? 0) > 20 ? 'amber' : 'gray'} />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard
          title="By village / place"
          rows={(o.byPlace || []).map((r: any) => ({ label: r.name || r.place || '(unknown)', value: r.visits ?? r.c ?? 0 }))}
        />
        <BarListCard
          title="By district"
          rows={(o.byDistrict || []).map((r: any) => ({ label: r.name || r.district || '(unknown)', value: r.visits ?? r.c ?? 0 }))}
        />
        <BarListCard
          title="By state"
          rows={(o.byState || []).map((r: any) => ({ label: r.name || r.state || '(unknown)', value: r.visits ?? r.c ?? 0 }))}
          full
        />
      </div>
    </div>
  );
}

/* ============================================================
   PHARMACY — top drugs, sales mix, schedule mix, low-stock + expiring
   ============================================================ */
function PharmacyTab({ from, to }: { from: string; to: string }) {
  const { data: p, isLoading } = useQuery({
    queryKey: ['analytics-pharmacy', from, to],
    queryFn: () => window.electronAPI.analytics.pharmacyOverview({ from, to }),
  });

  if (isLoading || !p) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle icon={<Pill className="w-4 h-4" />} title="Pharmacy overview" subtitle={`${fmtDate(from)} — ${fmtDate(to)}`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Sales (count)" value={p.totalSales} tone="blue" />
          <Kpi label="Revenue" value={formatINR(p.totalRevenue)} tone="emerald" />
          <Kpi label="Items dispensed" value={p.totalDispensed} tone="indigo" />
          <Kpi label="Schedule H/H1 entries" value={p.scheduleHCount} sub="legal register" tone="violet" />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard
          title="Top 20 drugs by revenue"
          rows={p.topDrugs.map((d) => ({ label: `${d.name} · ${d.units} units · ${d.sales} sales`, value: d.revenue }))}
          formatValue={formatINR}
        />
        <BarListCard
          title="Sales mix — Counter vs Rx"
          rows={p.salesMix.map((m) => ({ label: `${m.kind} (${m.count} sales)`, value: m.revenue }))}
          formatValue={formatINR}
        />
        <BarListCard
          title="Schedule breakdown (legal register)"
          rows={p.scheduleMix.map((s) => ({ label: `Schedule ${s.schedule} · ${s.units} units`, value: s.count }))}
        />
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Low stock</div>
            <span className="text-[11px] text-gray-500">{p.lowStock.length} drug{p.lowStock.length === 1 ? '' : 's'}</span>
          </div>
          {p.lowStock.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400 italic py-2">All drugs above threshold ✓</div>
          ) : (
            <ul className="text-xs space-y-1 max-h-72 overflow-auto">
              {p.lowStock.map((s, i) => (
                <li key={i} className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-1">
                  <span className="text-gray-900 dark:text-slate-100">{s.name}</span>
                  <span className="text-amber-700 dark:text-amber-300 font-semibold">
                    {s.stock} / threshold {s.low_stock_threshold}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Expiring within 90 days</div>
            <span className="text-[11px] text-gray-500">{p.expiringSoon.length} batch{p.expiringSoon.length === 1 ? '' : 'es'}</span>
          </div>
          {p.expiringSoon.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400 italic py-2">No batches expiring soon ✓</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-1.5">Drug</th>
                  <th className="py-1.5">Batch</th>
                  <th className="py-1.5">Expiry</th>
                  <th className="py-1.5 text-right">Qty</th>
                  <th className="py-1.5 text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {p.expiringSoon.map((b, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5 text-gray-900 dark:text-slate-100">{b.drug_name}</td>
                    <td className="py-1.5 font-mono text-[11px]">{b.batch_no}</td>
                    <td className="py-1.5">{b.expiry}</td>
                    <td className="py-1.5 text-right font-semibold">{b.qty_remaining}</td>
                    <td className={cn('py-1.5 text-right font-semibold', b.days <= 30 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>
                      {b.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   OPERATIONAL REPORTS — reuses reports.run (same as Reports page)
   ============================================================ */
function OperationsTab({ from, to }: { from: string; to: string }) {
  const REPORTS = [
    { kind: 'daily_collection', label: 'Daily Collection' },
    { kind: 'doctor_performance', label: 'Doctor Performance' },
    { kind: 'top_diagnoses', label: 'Top Diagnoses' },
    { kind: 'top_drugs', label: 'Top Drugs Sold' },
    { kind: 'new_patients', label: 'New Patients' },
  ];
  const [kind, setKind] = useState(REPORTS[0].kind);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ops-report', kind, from, to],
    queryFn: () => window.electronAPI.reports.run({ kind, from, to }),
  });

  const headers = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
        {REPORTS.map((r) => (
          <button
            key={r.kind}
            onClick={() => setKind(r.kind)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium',
              kind === r.kind ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="card p-4 overflow-x-auto">
        {isLoading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 py-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 py-4 text-center">No data in this range.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                {headers.map((h) => <th key={h} className="py-2 px-2">{h.replace(/_/g, ' ')}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                  {headers.map((h) => <td key={h} className="py-1.5 px-2 text-gray-700 dark:text-slate-200">{String((r as any)[h] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SHARED PRESENTATION HELPERS
   ============================================================ */
function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</div>
      {subtitle && <div className="text-[11px] text-gray-500 dark:text-slate-400">· {subtitle}</div>}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'blue' }: { label: string; value: string | number; sub?: string; tone?: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'indigo' | 'gray' }) {
  const tones: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40',
    emerald: 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40',
    amber: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40',
    red: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
    violet: 'text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-900/40',
    indigo: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-900/40',
    gray: 'text-gray-600 bg-gray-100 dark:text-slate-300 dark:bg-slate-800',
  };
  return (
    <div className="card p-3">
      <div className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold', tones[tone])}>{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1.5">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function AlertTile({ label, value, href, tone }: { label: string; value: number; href: string; tone: 'red' | 'amber' | 'gray' }) {
  const tones: Record<string, string> = {
    red: 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800',
    amber: 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800',
    gray: 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/50',
  };
  return (
    <a
      href={`#${href}`}
      className={cn('block rounded-lg border p-3 hover:shadow-sm transition', tones[tone])}
    >
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 dark:text-slate-300">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{value}</div>
      {value > 0 && <div className="text-[10px] text-blue-700 dark:text-blue-300 mt-1">→ Click to open Pharmacy</div>}
    </a>
  );
}

/**
 * Horizontal bar list — every row is a label + numeric value rendered as
 * a fill-bar where the longest row spans 100%. No chart library needed.
 */
function BarListCard({ title, rows, formatValue, full }: {
  title: string;
  rows: { label: string; value: number }[];
  formatValue?: (v: number) => string;
  full?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={cn('card p-4', full && 'lg:col-span-2')}>
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400 italic py-3">No data.</div>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-auto pr-1">
          {rows.map((r, i) => {
            const pct = (r.value / max) * 100;
            return (
              <li key={i} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700 dark:text-slate-200 truncate pr-2" title={r.label}>{r.label}</span>
                  <span className="text-gray-900 dark:text-slate-100 font-semibold tabular-nums">
                    {formatValue ? formatValue(r.value) : r.value.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                  <div className="h-full rounded bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
