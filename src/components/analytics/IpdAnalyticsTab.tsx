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

      {/* Revenue by section + deposits & insurance */}
      {billing?.ok && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Section-wise revenue */}
          <div className="card p-4">
            <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-3">Revenue by section</div>
            {(billing.bySection || []).length === 0 ? (
              <div className="text-[12px] text-gray-400 text-center py-4">No billed items in this period.</div>
            ) : (() => {
              const maxV = Math.max(...billing.bySection.map((s: any) => s.total), 1);
              return (
                <div className="space-y-2">
                  {billing.bySection.map((s: any) => (
                    <div key={s.category}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="capitalize text-gray-700 dark:text-slate-300">{String(s.category).replace('_', ' ')}</span>
                        <span className="tabular-nums text-gray-600 dark:text-slate-400 font-medium">{inr(s.total)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round((s.total / maxV) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Deposits + insurance */}
          <div className="card p-4">
            <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-3">Deposits &amp; insurance</div>
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Advance deposits held</span>
                <span className="tabular-nums font-bold text-indigo-600">{inr(billing.advances?.held || 0)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-gray-400">
                <span>collected {inr(billing.advances?.collected || 0)} · adjusted {inr(billing.advances?.adjusted || 0)} · refunded {inr(billing.advances?.refunded || 0)}</span>
              </div>
              {(billing.tpa?.claimed || 0) > 0 ? (
                <>
                  <div className="flex justify-between pt-2 mt-1 border-t dark:border-slate-700">
                    <span className="text-gray-600 dark:text-slate-400">TPA claimed</span>
                    <span className="tabular-nums font-medium">{inr(billing.tpa.claimed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-slate-400">Settled by insurers</span>
                    <span className="tabular-nums font-medium text-emerald-600">{inr(billing.tpa.settled)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-slate-400">Awaiting settlement</span>
                    <span className="tabular-nums font-bold text-amber-600">{inr(billing.tpa.inPipeline)}</span>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-gray-400 pt-2 mt-1 border-t dark:border-slate-700">No insurance / TPA claims in the system yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ward-wise finance — the money each ward brought in */}
      <WardFinanceCard rows={ipd.byWard} />

      {/* Doctor + ward clinical breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownTable title="By doctor" rows={ipd.byDoctor} cols={[
          { key: 'doctor', label: 'Doctor' },
          { key: 'admissions', label: 'Admissions', align: 'right' },
          { key: 'alos', label: 'Avg stay', align: 'right', fmt: (v: number) => v ? `${Math.round(v * 10) / 10}d` : '—' },
        ]} />
        <BreakdownTable title="Ward occupancy &amp; stay" rows={ipd.byWard} cols={[
          { key: 'ward', label: 'Ward' },
          { key: 'active', label: 'In beds', align: 'right' },
          { key: 'alos', label: 'Avg stay', align: 'right', fmt: (v: number) => v ? `${v}d` : '—' },
        ]} />
      </div>
    </div>
  );
}

/** Ward-wise finance: revenue, collections, dues and advances by ward, with a total row. */
function WardFinanceCard({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card p-4">
        <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 mb-2">Ward-wise finance</div>
        <div className="text-[12px] text-gray-400 text-center py-4">No admissions in this period.</div>
      </div>
    );
  }
  const tot = rows.reduce((a: any, r: any) => ({
    admissions: a.admissions + (r.admissions || 0),
    active: a.active + (r.active || 0),
    revenue: a.revenue + (r.revenue || 0),
    collected: a.collected + (r.collected || 0),
    outstanding: a.outstanding + (r.outstanding || 0),
    advance: a.advance + (r.advance || 0),
  }), { admissions: 0, active: 0, revenue: 0, collected: 0, outstanding: 0, advance: 0 });

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="w-4 h-4 text-blue-600" />
        <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100">Ward-wise finance</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[560px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
              <th className="py-1.5">Ward</th>
              <th className="py-1.5 text-right">Adm</th>
              <th className="py-1.5 text-right">In beds</th>
              <th className="py-1.5 text-right">Revenue</th>
              <th className="py-1.5 text-right">Collected</th>
              <th className="py-1.5 text-right">Outstanding</th>
              <th className="py-1.5 text-right">Advances</th>
              <th className="py-1.5 text-right">₹/adm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.colour || '#94a3b8' }} />
                    {r.ward}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{r.admissions}</td>
                <td className="py-1.5 text-right tabular-nums">{r.active}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{inr(r.revenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-emerald-600">{inr(r.collected)}</td>
                <td className="py-1.5 text-right tabular-nums text-red-600">{inr(r.outstanding)}</td>
                <td className="py-1.5 text-right tabular-nums text-indigo-600">{inr(r.advance)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{inr(r.revPerAdm)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 dark:border-slate-700 font-bold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right tabular-nums">{tot.admissions}</td>
              <td className="py-1.5 text-right tabular-nums">{tot.active}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(tot.revenue)}</td>
              <td className="py-1.5 text-right tabular-nums text-emerald-600">{inr(tot.collected)}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">{inr(tot.outstanding)}</td>
              <td className="py-1.5 text-right tabular-nums text-indigo-600">{inr(tot.advance)}</td>
              <td className="py-1.5 text-right"></td>
            </tr>
          </tfoot>
        </table>
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
