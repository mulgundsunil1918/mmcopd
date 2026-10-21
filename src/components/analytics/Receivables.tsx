/**
 * Receivables — the money billed but not yet collected, across every bill and every patient: by department, by
 * patient (open one to see the bills and collect), and by how long it has been owed. Same rule as the patient portal
 * and the Accounts page (main/billing-portal.ts), so the three can never disagree.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { Kpi, SectionTitle } from './Kpi';
import { cn, formatINR } from '../../lib/utils';

const KIND_COLOUR: Record<string, string> = {
  ipd: '#3b82f6', lab: '#d946ef', radiology: '#0ea5e9', consultation: '#8b5cf6', service: '#f59e0b', pharmacy: '#10b981',
};

export function ReceivablesSection() {
  const navigate = useNavigate();
  const { data: r, isLoading } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => window.electronAPI.analytics.receivables({ limit: 15 }),
    refetchInterval: 60_000,
  });
  if (isLoading || !r) return <div className="text-xs text-gray-500 dark:text-slate-400 p-2">Loading receivables…</div>;

  const oldest = r.aging.filter((a) => a.bills > 0).slice(-1)[0];
  const maxAge = Math.max(1, ...r.aging.map((a) => a.due));
  const maxKind = Math.max(1, ...r.by_kind.map((k) => k.due));

  return (
    <section>
      <SectionTitle icon={<Wallet className="w-4 h-4 text-rose-600" />} title="Still to collect"
        subtitle="every bill not fully paid, all-time (an in-patient's advance counts as paid)" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Outstanding" value={formatINR(r.total_due)} tone={r.total_due > 0 ? 'rose' : 'gray'} />
        <Kpi label="Bills unpaid" value={r.bills_due} tone="amber" />
        <Kpi label="Patients owing" value={r.patients_due} tone="indigo" />
        <Kpi label="Longest wait" value={oldest ? oldest.label : '—'} sub={oldest ? `${formatINR(oldest.due)} in that band` : 'nothing is owed'} tone="gray" />
      </div>

      {r.total_due > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-3">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">By department</div>
            <ul className="space-y-2">
              {r.by_kind.map((k) => (
                <li key={k.kind} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLOUR[k.kind] || '#94a3b8' }} />
                      {k.label} <span className="text-gray-400">({k.bills})</span>
                    </span>
                    <span className="font-semibold tabular-nums text-red-600">{formatINR(k.due)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${(k.due / maxKind) * 100}%`, backgroundColor: KIND_COLOUR[k.kind] || '#94a3b8' }} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-5 mb-3">How long it has been owed</div>
            <ul className="space-y-2">
              {r.aging.map((a) => (
                <li key={a.label} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-700 dark:text-slate-200">{a.label} <span className="text-gray-400">({a.bills})</span></span>
                    <span className={cn('font-semibold tabular-nums', a.due > 0 ? 'text-red-600' : 'text-gray-400')}>{formatINR(a.due)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                    <div className="h-full rounded bg-rose-400" style={{ width: `${(a.due / maxAge) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-4 lg:col-span-2 overflow-x-auto">
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Who owes the most</div>
            <table className="w-full text-[12px] min-w-[460px]">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                  <th className="py-1.5">Patient</th>
                  <th className="py-1.5 text-right">Bills</th>
                  <th className="py-1.5 text-right">Waiting</th>
                  <th className="py-1.5 text-right">Owes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {r.by_patient.map((p, i) => (
                  <tr key={`${p.patient_id ?? p.name}-${i}`} className="border-b border-gray-50 dark:border-slate-800/50">
                    <td className="py-1.5">
                      <div className="font-medium text-gray-900 dark:text-slate-100">{p.name}</div>
                      <div className="text-[10px] text-gray-400">{p.uhid || 'walk-in'}</div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.bills}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-500">{p.oldest_days === 0 ? 'today' : `${p.oldest_days}d`}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold text-red-600">{formatINR(p.due)}</td>
                    <td className="py-1.5 text-right">
                      {p.patient_id && (
                        <button className="btn-secondary text-[11px] py-0.5 px-2" onClick={() => navigate(`/billing?patient=${p.patient_id}`)}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
