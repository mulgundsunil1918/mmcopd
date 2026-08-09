import { useQuery } from '@tanstack/react-query';
import { Loader2, BedDouble, TrendingUp, Clock, Activity, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * IPD + billing analytics. IPD previously had none. Covers occupancy, volume,
 * average length of stay, the outcome mix (with mortality and LAMA rates as
 * quality indicators), doctor and ward breakdowns, and collections.
 */
const OUTCOME_COLOUR: Record<string, string> = {
  discharged: '#059669', lama: '#d97706', dama: '#ea580c',
  death: '#475569', referred: '#2563eb', absconded: '#6b7280', in_progress: '#94a3b8',
};

function inr(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN');
}

export function IpdAnalyticsTab({ from, to }: { from: string; to: string }) {
  const { data: ipd, isLoading, error } = useQuery({
    queryKey: ['analytics-ipd', from, to],
    queryFn: () => window.electronAPI.billing.ipdAnalytics(from, to),
  });
  const { data: billing } = useQuery({
    queryKey: ['analytics-billing', from, to],
    queryFn: () => window.electronAPI.billing.billingAnalytics(from, to),
  });

  if (isLoading) return <div className="card p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>;

  if (error || (ipd && ipd.ok === false)) {
    return (
      <div className="card p-4 border-2 border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2 text-red-700 text-[13px] font-semibold"><AlertCircle className="w-4 h-4" /> Could not load IPD analytics</div>
        <div className="text-[12px] text-red-600 mt-1">{(ipd as any)?.error || (error as any)?.message}</div>
      </div>
    );
  }
  if (!ipd) return null;

  const totalClosed = (ipd.outcomes || []).filter((o: any) => o.outcome !== 'in_progress').reduce((s: number, o: any) => s + o.count, 0);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={BedDouble} label="Occupancy" value={`${ipd.occupancyPct}%`} sub={`${ipd.occupiedBeds}/${ipd.totalBeds} beds`} colour="text-blue-600" />
        <Kpi icon={TrendingUp} label="Admissions" value={ipd.admissions} sub={`${ipd.discharges} discharged`} colour="text-emerald-600" />
        <Kpi icon={Clock} label="Avg stay" value={`${ipd.alosDays}d`} sub="length of stay" colour="text-violet-600" />
        <Kpi icon={Activity} label="IPD revenue" value={inr(ipd.ipdRevenue)} sub="this period" colour="text-amber-600" />
      </div>

      {/* Quality indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-3">Outcome mix</div>
          {(ipd.outcomes || []).length === 0 ? (
            <div className="text-[12px] text-gray-400 text-center py-4">No admissions closed in this period.</div>
          ) : (
            <div className="space-y-2">
              {ipd.outcomes.map((o: any) => {
                const pct = totalClosed ? Math.round((o.count / totalClosed) * 100) : 0;
                return (
                  <div key={o.outcome}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="capitalize text-gray-700 dark:text-slate-300">{o.outcome.replace('_', ' ')}</span>
                      <span className="tabular-nums text-gray-500">{o.count}{o.outcome !== 'in_progress' ? ` · ${pct}%` : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${o.outcome === 'in_progress' ? 100 : pct}%`, background: OUTCOME_COLOUR[o.outcome] || '#94a3b8' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t dark:border-slate-700">
            <div>
              <div className="text-lg font-bold text-slate-700 dark:text-slate-200 tabular-nums">{ipd.mortalityRate}%</div>
              <div className="text-[10px] text-gray-500 uppercase">Mortality rate</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600 tabular-nums">{ipd.lamaRate}%</div>
              <div className="text-[10px] text-gray-500 uppercase">LAMA / DAMA rate</div>
            </div>
          </div>
        </div>

        {/* Collections */}
        <div className="card p-4">
          <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-3">Collections &amp; dues</div>
          {billing?.ok ? (
            <div className="space-y-2 text-[12px]">
              {(billing.collections || []).map((c: any) => (
                <div key={c.payment_mode} className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">{c.payment_mode} <span className="text-gray-400">({c.count})</span></span>
                  <span className="tabular-nums font-medium">{inr(c.total)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t dark:border-slate-700 font-bold">
                <span>Total collected</span><span className="tabular-nums">{inr(billing.totalCollected)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Outstanding</span><span className="tabular-nums font-bold">{inr(billing.outstanding)}</span>
              </div>
              {billing.gst?.total > 0 && (
                <div className="flex justify-between pt-2 border-t dark:border-slate-700 text-gray-500">
                  <span>GST payable (CGST + SGST)</span><span className="tabular-nums">{inr(billing.gst.total)}</span>
                </div>
              )}
            </div>
          ) : <div className="text-[12px] text-gray-400 text-center py-4">No billing data.</div>}
        </div>
      </div>

      {/* Doctor + ward breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownTable title="By doctor" rows={ipd.byDoctor} cols={[
          { key: 'doctor', label: 'Doctor' },
          { key: 'admissions', label: 'Admissions', align: 'right' },
          { key: 'alos', label: 'Avg stay', align: 'right', fmt: (v: number) => v ? `${Math.round(v * 10) / 10}d` : '—' },
        ]} />
        <BreakdownTable title="By ward" rows={ipd.byWard} cols={[
          { key: 'ward', label: 'Ward' },
          { key: 'admissions', label: 'Admissions', align: 'right' },
        ]} />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, colour }: any) {
  return (
    <div className="card p-4">
      <Icon className={cn('w-4 h-4 mb-2', colour)} />
      <div className="text-xl font-extrabold text-gray-900 dark:text-slate-100 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-[10px] text-gray-400">{sub}</div>
    </div>
  );
}

function BreakdownTable({ title, rows, cols }: { title: string; rows: any[]; cols: any[] }) {
  return (
    <div className="card p-4">
      <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-2">{title}</div>
      {(!rows || rows.length === 0) ? (
        <div className="text-[12px] text-gray-400 text-center py-4">No data.</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
              {cols.map((c) => <th key={c.key} className={cn('py-1.5', c.align === 'right' && 'text-right')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                {cols.map((c) => (
                  <td key={c.key} className={cn('py-1.5', c.align === 'right' && 'text-right tabular-nums')}>
                    {c.fmt ? c.fmt(r[c.key]) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
