import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { DonutChart, VBarChart } from './Charts';
import { Kpi, SectionTitle } from './Kpi';
import { fmtDate, formatINR } from '../../lib/utils';

/** Revenue, collections and dues by clinical module (moved from Analytics → Modules P&L to Accounts → Profit and loss: it is rupees). */
export function ModulesRevenue({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-modules', from, to],
    queryFn: () => window.electronAPI.analytics.modules(from, to),
  });
  if (isLoading || !data) return <div className="text-xs text-gray-500 dark:text-slate-400 p-4">Loading…</div>;
  const mods = data.modules || [];
  const t = data.totals || { revenue: 0, collected: 0, outstanding: 0, count: 0 };
  const MODULE_HEX: Record<string, string> = { ipd: '#3b82f6', pharmacy: '#10b981', lab: '#d946ef', radiology: '#0ea5e9', opd: '#8b5cf6', misc: '#f59e0b', other: '#64748b' };
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  return (
    <div className="space-y-5">
      <SectionTitle icon={<Layers className="w-4 h-4" />} title="Module-wise P&L" subtitle={`Revenue, collections and dues by clinical module · ${fmtDate(from)} — ${fmtDate(to)}`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total revenue" value={formatINR(t.revenue)} tone="blue" />
        <Kpi label="Collected" value={formatINR(t.collected)} sub={`${pct(t.collected, t.revenue)}% of billed`} tone="emerald" />
        <Kpi label="Outstanding" value={formatINR(t.outstanding)} tone="rose" />
        <Kpi label="Transactions" value={t.count} tone="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DonutChart
          title="Revenue share by module" subtitle="Where revenue comes from"
          rows={mods.map((m) => ({ label: m.label, value: m.revenue, color: MODULE_HEX[m.key] }))}
          formatValue={formatINR} maxSlices={8}
        />
        <VBarChart
          title="Revenue by module"
          rows={mods.map((m) => ({ label: m.label, value: m.revenue, color: MODULE_HEX[m.key] }))}
          formatValue={formatINR}
        />
      </div>

      <div className="card p-4 overflow-x-auto">
        <table className="w-full text-[12px] min-w-[520px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
              <th className="py-1.5">Module</th>
              <th className="py-1.5 text-right">Txns</th>
              <th className="py-1.5 text-right">Revenue</th>
              <th className="py-1.5 text-right">Collected</th>
              <th className="py-1.5 text-right">Outstanding</th>
              <th className="py-1.5 text-right">Collection %</th>
            </tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr key={m.key} className="border-b border-gray-50 dark:border-slate-800/50">
                <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODULE_HEX[m.key] || '#94a3b8' }} />{m.label}</span></td>
                <td className="py-1.5 text-right tabular-nums">{m.count}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{formatINR(m.revenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-emerald-600">{formatINR(m.collected)}</td>
                <td className="py-1.5 text-right tabular-nums text-red-600">{formatINR(m.outstanding)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{pct(m.collected, m.revenue)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 dark:border-slate-700 font-bold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right tabular-nums">{t.count}</td>
              <td className="py-1.5 text-right tabular-nums">{formatINR(t.revenue)}</td>
              <td className="py-1.5 text-right tabular-nums text-emerald-600">{formatINR(t.collected)}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">{formatINR(t.outstanding)}</td>
              <td className="py-1.5 text-right tabular-nums">{pct(t.collected, t.revenue)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
