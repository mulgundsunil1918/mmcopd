import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import {
  BarChart3, Wallet, MapPin, FileText, Users as UsersIcon, Pill,
  TrendingUp, AlertTriangle, Calendar, Activity, RefreshCw,
  Download, Database, FolderOpen, HardDriveDownload, Syringe,
} from 'lucide-react';
import { cn, fmt12h, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { colorForDoctor } from '../lib/doctor-colors';
import type { Doctor } from '../types';

type Tab = 'overview' | 'finance' | 'demographics' | 'origin' | 'pharmacy' | 'services' | 'operations';

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
        <TabBtn active={tab === 'services'} onClick={() => setTab('services')} icon={<Syringe className="w-3.5 h-3.5" />}>Services</TabBtn>
        <TabBtn active={tab === 'operations'} onClick={() => setTab('operations')} icon={<FileText className="w-3.5 h-3.5" />}>Operational Reports</TabBtn>
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'finance' && <FinanceTab from={from} to={to} />}
      {tab === 'demographics' && <DemographicsTab />}
      {tab === 'origin' && <OriginTab from={from} to={to} />}
      {tab === 'pharmacy' && <PharmacyTab from={from} to={to} />}
      {tab === 'services' && <ServicesTab from={from} to={to} />}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Kpi
            label="Free follow-ups granted"
            value={ov.freeFollowupsThisMonth ?? 0}
            sub={`+${ov.relaxedFollowupsThisMonth ?? 0} courtesy grants`}
            tone="emerald"
          />
          <Kpi
            label="Registration fees collected"
            value={formatINR(ov.registrationFeesThisMonth ?? 0)}
            sub={`${ov.registrationFeeCountThisMonth ?? 0} new patients paid`}
            tone="amber"
          />
          <Kpi
            label="Services revenue"
            value={formatINR(ov.servicesRevenueThisMonth ?? 0)}
            sub={`${ov.servicesCountThisMonth ?? 0} services rendered · see Services tab`}
            tone="rose"
          />
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
   FINANCE — finance.summary + weekday×hour heatmap + doctor color bars
   ============================================================ */
function FinanceTab({ from, to }: { from: string; to: string }) {
  const { data: f, isLoading } = useQuery({
    queryKey: ['finance', from, to],
    queryFn: () => window.electronAPI.finance.summary({ from, to }),
  });
  const { data: heatmap = [] } = useQuery({
    queryKey: ['analytics-weekday-hour'],
    queryFn: () => window.electronAPI.analytics.weekdayHourHeatmap(),
  });
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-all-active'],
    queryFn: () => window.electronAPI.doctors.list(false),
  });

  if (isLoading || !f) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;

  // Build name → color map so we can color-code the byDoctor bars to match
  // the doctor color tags shown elsewhere in the app.
  const doctorColorByName = new Map<string, string>();
  for (const d of doctors as Doctor[]) {
    doctorColorByName.set(d.name, colorForDoctor(d));
  }

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

      {/* Weekday × Hour heatmap */}
      <section>
        <SectionTitle icon={<Calendar className="w-4 h-4 text-indigo-600" />} title="Busiest day × hour" subtitle="Last 90 days of appointments. Cell intensity scales with visit count." />
        <WeekdayHourHeatmap rows={heatmap} />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard title="Revenue by day" rows={(f.byDay || []).map((r: any) => ({ label: r.day, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Revenue by month" rows={(f.byMonth || []).map((r: any) => ({ label: r.month, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Busiest weekday (last 90 days)" rows={(f.byWeekday || []).map((r: any) => ({ label: r.weekday, value: r.total }))} formatValue={formatINR} />
        <BarListCard title="Peak hours" rows={(f.byHour || []).map((r: any) => ({ label: `${r.hour}:00`, value: r.total }))} formatValue={formatINR} />
        <BarListCard
          title="By doctor (all-time) — colored by tag"
          rows={(f.byDoctor || []).map((r: any) => ({
            label: r.doctor,
            value: r.total,
            color: doctorColorByName.get(r.doctor),
          }))}
          formatValue={formatINR}
        />
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

function WeekdayHourHeatmap({ rows }: { rows: { weekday: number; hour: number; visits: number }[] }) {
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Pivot sparse rows into a 7×24 grid.
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  for (const r of rows) {
    if (r.weekday >= 0 && r.weekday < 7 && r.hour >= 0 && r.hour < 24) {
      grid[r.weekday][r.hour] = r.visits;
      if (r.visits > max) max = r.visits;
    }
  }
  // Compress to 8 AM–10 PM (the realistic clinic window) to keep the grid wide-readable.
  const HOURS_FROM = 8;
  const HOURS_TO = 22;
  const colWidth = `calc((100% - 40px) / ${HOURS_TO - HOURS_FROM + 1})`;

  if (max === 0) {
    return <div className="card p-4 text-xs text-gray-500 dark:text-slate-400 italic">No appointment data in the last 90 days.</div>;
  }

  return (
    <div className="card p-4 overflow-x-auto">
      <table className="text-[10px] w-full" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-right pr-2 font-semibold text-gray-500 dark:text-slate-400" style={{ width: 40 }}>—</th>
            {Array.from({ length: HOURS_TO - HOURS_FROM + 1 }).map((_, i) => {
              const h = HOURS_FROM + i;
              return (
                <th key={h} className="text-center font-semibold text-gray-500 dark:text-slate-400" style={{ width: colWidth }}>
                  {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'a' : 'p'}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Mon → Sun ordering (clinic-friendly) */}
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
            <tr key={wd}>
              <td className="text-right pr-2 font-semibold text-gray-700 dark:text-slate-200">{DAY_LABELS[wd]}</td>
              {Array.from({ length: HOURS_TO - HOURS_FROM + 1 }).map((_, i) => {
                const h = HOURS_FROM + i;
                const v = grid[wd][h];
                const intensity = v / max;
                return (
                  <td
                    key={h}
                    className="text-center font-semibold rounded"
                    style={{
                      backgroundColor: v === 0 ? 'rgba(99,102,241,0.05)' : `rgba(99, 102, 241, ${0.15 + intensity * 0.75})`,
                      color: intensity > 0.55 ? '#ffffff' : v === 0 ? '#9ca3af' : '#1e3a8a',
                      padding: '6px 0',
                      minHeight: 22,
                    }}
                    title={`${DAY_LABELS[wd]} ${h}:00 → ${v} visit${v === 1 ? '' : 's'}`}
                  >
                    {v || '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-2">
        Numbers = visit count. Darker cells = busier slots. Hover for details. Hours shown: {HOURS_FROM}am–{HOURS_TO - 12}pm.
      </div>
    </div>
  );
}

/* ============================================================
   PATIENTS — demographics + retention (repeat-visit rate + cohort)
   ============================================================ */
function DemographicsTab() {
  const { data: d, isLoading: lD } = useQuery({
    queryKey: ['analytics-demographics'],
    queryFn: () => window.electronAPI.analytics.demographics(),
  });
  const { data: ret, isLoading: lR } = useQuery({
    queryKey: ['analytics-retention'],
    queryFn: () => window.electronAPI.analytics.retention(),
  });
  const { data: cohort, isLoading: lC } = useQuery({
    queryKey: ['analytics-cohort'],
    queryFn: () => window.electronAPI.analytics.cohort(),
  });

  if (lD || lR || lC || !d || !ret || !cohort) {
    return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* === Demographics === */}
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

      {/* === Revenue by demographics === */}
      <section className="pt-3 border-t border-gray-200 dark:border-slate-700">
        <SectionTitle icon={<Wallet className="w-4 h-4 text-emerald-600" />} title="Revenue by demographics" subtitle="Where the money comes from — bills only (Pharmacy revenue is in the Pharmacy tab)" />
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarListCard
          title="Revenue by gender"
          rows={d.revenueByGender.map((r) => ({ label: `${r.label} · ${r.bills} bills`, value: r.revenue }))}
          formatValue={formatINR}
        />
        <BarListCard
          title="Revenue by age group"
          rows={d.revenueByAge.map((r) => ({ label: `${r.label} · ${r.bills} bills`, value: r.revenue }))}
          formatValue={formatINR}
        />
        <BarListCard
          title="Top 20 professions by revenue"
          rows={d.revenueByProfession.map((r) => ({ label: `${r.label} · ${r.bills} bills`, value: r.revenue }))}
          formatValue={formatINR}
          full
        />
      </div>

      {/* === Retention — repeat-visit rate === */}
      <section className="pt-3 border-t border-gray-200 dark:border-slate-700">
        <SectionTitle icon={<RefreshCw className="w-4 h-4 text-emerald-600" />} title="Retention — Repeat-visit rate" subtitle="What % of new patients came back within 30 / 60 / 90 days of their first visit" />
      </section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <RetentionCard label="Within 30 days" data={ret.window30} tone="emerald" />
        <RetentionCard label="Within 60 days" data={ret.window60} tone="blue" />
        <RetentionCard label="Within 90 days" data={ret.window90} tone="indigo" />
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 italic">
        Only patients whose first visit was at least N days ago count toward the N-day rate. New patients
        who haven't had time to return are excluded from the denominator.
      </div>

      {/* === Cohort heatmap === */}
      <section className="pt-3 border-t border-gray-200 dark:border-slate-700">
        <SectionTitle
          icon={<Activity className="w-4 h-4 text-violet-600" />}
          title="Patient retention cohort"
          subtitle="Each row is a 'class' of patients (their first-visit month). Each cell shows what % of that class came back N months later."
        />
      </section>
      <CohortHeatmap cohorts={cohort.cohorts} />
    </div>
  );
}

function RetentionCard({ label, data, tone }: {
  label: string;
  data: { eligible: number; returned: number; rate: number };
  tone: 'emerald' | 'blue' | 'indigo';
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  };
  const fillTones: Record<string, string> = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    indigo: 'bg-indigo-500',
  };
  return (
    <div className="card p-4">
      <div className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold', tones[tone])}>
        {label}
      </div>
      <div className="text-3xl font-extrabold text-gray-900 dark:text-slate-100 mt-2">
        {data.eligible === 0 ? '—' : `${data.rate}%`}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
        {data.returned.toLocaleString('en-IN')} returned out of {data.eligible.toLocaleString('en-IN')} eligible
      </div>
      {data.eligible > 0 && (
        <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-2 overflow-hidden">
          <div className={cn('h-full rounded', fillTones[tone])} style={{ width: `${Math.min(100, data.rate)}%` }} />
        </div>
      )}
    </div>
  );
}

function BasketSizeTable({ rows }: { rows: { month: string; sales: number; avg_revenue: number; total_revenue: number; avg_units: number }[] }) {
  if (rows.length === 0) return <div className="card p-6 text-xs text-gray-500 italic text-center">No pharmacy sales in the last 12 months.</div>;
  const maxAvg = Math.max(1, ...rows.map((r) => r.avg_revenue));
  const maxUnits = Math.max(1, ...rows.map((r) => r.avg_units));
  return (
    <div className="card p-4 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2 px-2">Month</th>
            <th className="py-2 px-2 text-right">Sales</th>
            <th className="py-2 px-2 text-right">Total revenue</th>
            <th className="py-2 px-2 text-right">Avg ₹ / sale</th>
            <th className="py-2 px-2 text-right">Avg units / sale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-1.5 px-2 font-mono text-gray-900 dark:text-slate-100">{r.month}</td>
              <td className="py-1.5 px-2 text-right">{r.sales.toLocaleString('en-IN')}</td>
              <td className="py-1.5 px-2 text-right font-semibold">{formatINR(r.total_revenue)}</td>
              <td className="py-1.5 px-2 text-right">
                <div className="font-semibold">{formatINR(r.avg_revenue)}</div>
                <div className="h-1 bg-gray-100 dark:bg-slate-800 rounded mt-0.5 overflow-hidden">
                  <div className="h-full rounded bg-emerald-500" style={{ width: `${(r.avg_revenue / maxAvg) * 100}%` }} />
                </div>
              </td>
              <td className="py-1.5 px-2 text-right">
                <div className="font-semibold">{r.avg_units.toFixed(1)}</div>
                <div className="h-1 bg-gray-100 dark:bg-slate-800 rounded mt-0.5 overflow-hidden">
                  <div className="h-full rounded bg-indigo-500" style={{ width: `${(r.avg_units / maxUnits) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CohortHeatmap({ cohorts }: { cohorts: { cohort_month: string; size: number; retention: number[] }[] }) {
  if (cohorts.length === 0) {
    return <div className="card p-6 text-xs text-gray-500 dark:text-slate-400 italic text-center">Not enough data yet.</div>;
  }
  const maxOffset = Math.max(...cohorts.map((c) => c.retention.length));
  return (
    <div className="card p-4 overflow-x-auto">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-gray-500 dark:text-slate-400 px-2 py-1.5 sticky left-0 bg-white dark:bg-slate-900">Cohort (first visit)</th>
            <th className="text-right font-semibold text-gray-500 dark:text-slate-400 px-2 py-1.5">Size</th>
            {Array.from({ length: maxOffset }).map((_, i) => (
              <th key={i} className="text-center font-semibold text-gray-500 dark:text-slate-400 px-2 py-1.5 w-14">
                M+{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort_month}>
              <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-slate-100 sticky left-0 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700">
                {c.cohort_month}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold text-gray-700 dark:text-slate-200">{c.size}</td>
              {Array.from({ length: maxOffset }).map((_, i) => {
                const v = c.retention[i] || 0;
                const pct = c.size === 0 ? 0 : Math.round((v / c.size) * 100);
                const intensity = c.size === 0 ? 0 : v / c.size;
                return (
                  <td
                    key={i}
                    className="text-center px-1 py-1.5 font-semibold border border-white dark:border-slate-900"
                    style={{
                      backgroundColor: intensity === 0 ? 'transparent' : `rgba(99, 102, 241, ${0.1 + intensity * 0.7})`,
                      color: intensity > 0.55 ? '#ffffff' : undefined,
                    }}
                    title={`${v} of ${c.size} returned (${pct}%)`}
                  >
                    {v === 0 ? '·' : `${pct}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-2">
        Cell colors: darker = higher retention. Hover for raw count. M+0 is the cohort month itself (always 100% by definition);
        M+1 = next calendar month; M+2 = two months later; and so on.
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
  const { data: basket = [] } = useQuery({
    queryKey: ['analytics-pharmacy-basket'],
    queryFn: () => window.electronAPI.analytics.pharmacyBasket(),
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

      {/* Average basket size — units & ₹ per sale, monthly trend */}
      <section>
        <SectionTitle
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
          title="Average basket size"
          subtitle="Per-sale units and rupees, by month (last 12)"
        />
        <BasketSizeTable rows={basket} />
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
                    <td className="py-1.5">{(() => { try { return fmtDate(b.expiry); } catch { return b.expiry; } })()}</td>
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
   OPERATIONAL REPORTS + BACKUPS — fully merges the standalone Reports page.
   Pre-built reports with CSV export, plus the backup list with manual-backup
   button. Same data sources, just consolidated under Analytics.
   ============================================================ */
const OPS_REPORTS: { kind: string; title: string; desc: string }[] = [
  { kind: 'daily_collection', title: 'Daily Collection', desc: 'Revenue per day split by Cash/Card/UPI' },
  { kind: 'doctor_performance', title: 'Doctor Performance', desc: 'Visits, unique patients, revenue per doctor' },
  { kind: 'top_diagnoses', title: 'Top Diagnoses', desc: 'Most frequent impressions entered by doctors' },
  { kind: 'top_drugs', title: 'Top Drugs Sold', desc: 'Pharmacy bestsellers by revenue' },
  { kind: 'new_patients', title: 'New Patients', desc: 'First-time registrations per day' },
];

function OperationsTab({ from, to }: { from: string; to: string }) {
  const [kind, setKind] = useState(OPS_REPORTS[0].kind);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ops-report', kind, from, to],
    queryFn: () => window.electronAPI.reports.run({ kind, from, to }),
  });
  const headers = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const head = headers.join(',');
    const lines = [head, ...rows.map((r: any) => headers.map((c) => `"${String((r as any)[c] ?? '').replaceAll('"', '""')}"`).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-gray-500 dark:text-slate-400">
          Pre-built reports + CSV export (open in Excel / Google Sheets).
        </div>
        <button className="btn-primary text-xs" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Card-style report selector — copies the Reports.tsx UX */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {OPS_REPORTS.map((r) => (
          <button
            key={r.kind}
            onClick={() => setKind(r.kind)}
            className={cn(
              'text-left rounded-lg p-3 border-2 transition',
              kind === r.kind
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300'
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-slate-100">
              <BarChart3 className={cn('w-3.5 h-3.5', kind === r.kind ? 'text-blue-600' : 'text-gray-500')} />
              {r.title}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{r.desc}</div>
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
                  {headers.map((h) => (
                    <td key={h} className="py-1.5 px-2 text-gray-700 dark:text-slate-200">
                      {renderOpsCell(h, r[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BackupsBlock />
    </div>
  );
}

function renderOpsCell(col: string, val: any) {
  if (val == null) return '—';
  if (col === 'day' && typeof val === 'string' && val.length >= 10) return fmtDate(val);
  if (typeof val === 'number' && (col.includes('revenue') || col.includes('cash') || col === 'card' || col === 'upi')) return formatINR(val);
  return String(val);
}

function BackupsBlock() {
  const toast = useToast();
  const { data: backups = [] } = useQuery({
    queryKey: ['backup-list'],
    queryFn: () => window.electronAPI.backup.list(),
    refetchInterval: 30_000,
  });
  const now = useMutation({
    mutationFn: () => window.electronAPI.backup.now(),
    onSuccess: (r: any) => toast(`Backup created — ${r.totalBundles ?? r.totalBackups ?? '?'} total`),
    onError: (e: any) => toast(e.message || 'Backup failed', 'error'),
  });
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Backups</h2>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={() => window.electronAPI.backup.open()}>
            <FolderOpen className="w-4 h-4" /> Open Folder
          </button>
          <button className="btn-primary text-xs" onClick={() => now.mutate()} disabled={now.isPending}>
            <HardDriveDownload className="w-4 h-4" /> {now.isPending ? 'Backing up…' : 'Backup Now'}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
        Auto-backup runs on schedule (configurable in Settings → Backup, Restore & Updates). Each backup writes a
        SQLite snapshot + a single Excel file with all tables as sheets.
      </p>
      {backups.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400">No backups yet. Click "Backup Now" to create the first one.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">File</th>
              <th className="py-2">Created</th>
              <th className="py-2 text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {backups.slice(0, 10).map((b) => (
              <tr key={b.name} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1.5 font-mono text-xs">{b.name}</td>
                <td className="py-1.5 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(b.mtime)}</td>
                <td className="py-1.5 text-right text-xs">{Math.round(b.size / 1024)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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

function Kpi({ label, value, sub, tone = 'blue' }: { label: string; value: string | number; sub?: string; tone?: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'indigo' | 'gray' | 'rose' }) {
  const tones: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40',
    emerald: 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40',
    amber: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40',
    red: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
    violet: 'text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-900/40',
    indigo: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-900/40',
    gray: 'text-gray-600 bg-gray-100 dark:text-slate-300 dark:bg-slate-800',
    rose: 'text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-900/40',
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
  rows: { label: string; value: number; color?: string }[];
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
                  <span className="text-gray-700 dark:text-slate-200 truncate pr-2 inline-flex items-center gap-1.5" title={r.label}>
                    {r.color && <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />}
                    {r.label}
                  </span>
                  <span className="text-gray-900 dark:text-slate-100 font-semibold tabular-nums">
                    {formatValue ? formatValue(r.value) : r.value.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                  <div
                    className={r.color ? 'h-full rounded' : 'h-full rounded bg-gradient-to-r from-blue-500 to-indigo-500'}
                    style={{ width: `${pct}%`, backgroundColor: r.color }}
                  />
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

/** Full Services analytics tab — date-range aware; KPIs + daily trend chart +
 *  top services + per-doctor revenue. Driven by misc:summary + misc:trend. */
function ServicesTab({ from, to }: { from: string; to: string }) {
  const { data: summary } = useQuery({
    queryKey: ['analytics-services-summary', from, to],
    queryFn: () => window.electronAPI.misc.summary({ from, to }),
    refetchOnMount: 'always',
  });
  const { data: trend = [] } = useQuery({
    queryKey: ['analytics-services-trend', from, to],
    queryFn: () => window.electronAPI.misc.trend({ from, to }),
    refetchOnMount: 'always',
  });

  if (!summary) return <div className="text-xs text-gray-500">Loading…</div>;

  // Empty state.
  if (summary.count === 0) {
    return (
      <div className="card p-10 text-center">
        <Syringe className="w-8 h-8 text-pink-300 mx-auto mb-3" />
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">No services rendered in this date range</div>
        <div className="text-[12px] text-gray-500 dark:text-slate-400 mt-1">
          Visit the <b>Services</b> tab in the sidebar to record procedures, vaccinations, dressings, etc.
        </div>
      </div>
    );
  }

  const avgPerService = summary.count > 0 ? summary.revenue / summary.count : 0;
  const uniqueServices = summary.topServices.length;
  const trendMax = Math.max(1, ...trend.map((t: any) => t.revenue));
  const topMax = Math.max(1, ...summary.topServices.map((s: any) => s.revenue));
  const docMax = Math.max(1, ...summary.byDoctor.map((d: any) => d.revenue));

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <section>
        <SectionTitle icon={<Syringe className="w-4 h-4 text-pink-600" />} title="Services Overview" subtitle={`${from} to ${to}`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Total revenue" value={formatINR(summary.revenue)} tone="rose" />
          <Kpi label="Services rendered" value={summary.count} tone="rose" />
          <Kpi label="Avg per service" value={formatINR(Math.round(avgPerService))} tone="indigo" />
          <Kpi label="Unique service types" value={uniqueServices} sub="distinct line items" tone="violet" />
        </div>
      </section>

      {/* Daily trend column chart */}
      {trend.length > 0 && (
        <section>
          <SectionTitle icon={<TrendingUp className="w-4 h-4 text-pink-600" />} title="Daily revenue trend" subtitle="Each bar is one day where services were rendered" />
          <div className="card p-4">
            <div className="flex items-end gap-1 h-44 overflow-x-auto">
              {trend.map((t: any) => {
                const h = Math.max(4, (t.revenue / trendMax) * 100);
                return (
                  <div key={t.day} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: 28 }}>
                    <div
                      className="w-full bg-pink-500 dark:bg-pink-400 rounded-t hover:bg-pink-600 transition"
                      style={{ height: `${h}%` }}
                      title={`${(() => { try { return fmtDate(t.day); } catch { return t.day; } })()} · ${formatINR(t.revenue)} · ${t.count} services`}
                    />
                    <div className="text-[9px] text-gray-500 dark:text-slate-400 -rotate-45 origin-top-left whitespace-nowrap mt-1">
                      {(() => { try { return fmtDate(t.day, 'd MMM'); } catch { return t.day.slice(5); } })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section>
        <SectionTitle icon={<BarChart3 className="w-4 h-4 text-pink-600" />} title="Breakdown" subtitle="Top services & per-doctor performance" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top services */}
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-3">Top services by revenue</div>
            <ul className="space-y-2">
              {summary.topServices.map((s: any) => (
                <li key={s.service}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-gray-900 dark:text-slate-100 truncate">{s.service || '—'}</span>
                    <span className="text-gray-600 dark:text-slate-300 ml-2 whitespace-nowrap">
                      <span className="font-semibold">{formatINR(s.revenue)}</span>
                      <span className="text-[11px] text-gray-500 ml-2">× {s.count}</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full bg-pink-500"
                      style={{ width: `${Math.max(2, (s.revenue / topMax) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Per-doctor */}
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-3">Services revenue by doctor</div>
            <ul className="space-y-2">
              {summary.byDoctor.map((d: any, i: number) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5 truncate">
                      {d.doctor_color && (
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: d.doctor_color }} />
                      )}
                      {d.doctor_name || <em className="text-gray-400 not-italic">No doctor</em>}
                    </span>
                    <span className="text-gray-600 dark:text-slate-300 ml-2 whitespace-nowrap">
                      <span className="font-semibold">{formatINR(d.revenue)}</span>
                      <span className="text-[11px] text-gray-500 ml-2">× {d.count}</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(2, (d.revenue / docMax) * 100)}%`,
                        backgroundColor: d.doctor_color || '#94a3b8',
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
