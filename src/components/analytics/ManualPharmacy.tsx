/**
 * Hand-typed pharmacy bills — a bill typed by hand in Billing → Quick Bill → Pharmacy.
 *
 * Nothing leaves the shelf for these, so there is no stock, cost or profit behind them. They have their own analysis here
 * and are never counted in the Pharmacy figures that come from real stock (revenue, profit, top drugs, valuation).
 */
import { useQuery } from '@tanstack/react-query';
import { FileText, Info } from 'lucide-react';
import { Kpi, SectionTitle } from './Kpi';
import { cn, fmtDate, fmtDateTime, formatINR } from '../../lib/utils';

export function ManualPharmacySection({ from, to }: { from: string; to: string }) {
  const { data: m, isLoading } = useQuery({
    queryKey: ['analytics-manual-pharmacy', from, to],
    queryFn: () => window.electronAPI.analytics.manualPharmacy(from, to),
  });
  if (isLoading || !m) return <div className="text-xs text-gray-500 dark:text-slate-400 p-2">Loading hand-typed pharmacy bills…</div>;

  const maxDay = Math.max(1, ...m.by_day.map((d) => d.total));
  const maxMode = Math.max(1, ...m.by_mode.map((d) => d.total));

  return (
    <section>
      <SectionTitle icon={<FileText className="w-4 h-4 text-amber-600" />} title="Hand-typed pharmacy bills"
        subtitle={`${fmtDate(from)} — ${fmtDate(to)} · kept apart from the stock figures above`} />
      <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 text-[11px] text-amber-900 dark:text-amber-200">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div>
          Bills typed by hand in <b>Billing → Quick Bill → Pharmacy</b>. No medicine was taken out of stock for them, so there is no cost and no
          profit — and they are <b>not</b> counted in the Pharmacy revenue, profit, stock or top-drug figures. Their money still shows in
          Accounts and Receivables like any other bill.
        </div>
      </div>

      {m.bills === 0 && m.owed_now === 0 ? (
        <div className="card p-4 text-[13px] text-gray-500 dark:text-slate-400">No hand-typed pharmacy bills in this period.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Bills" value={m.bills} sub={m.discount > 0 ? `${formatINR(m.discount)} discount given` : undefined} tone="amber" />
            <Kpi label="Billed" value={formatINR(m.billed)} tone="blue" />
            <Kpi label="Received" value={formatINR(m.collected)} tone="emerald" />
            <Kpi label="Still unpaid" value={formatINR(m.still_owed)} tone={m.still_owed > 0 ? 'rose' : 'gray'}
              sub={m.owed_now > 0 ? `${formatINR(m.owed_now)} unpaid on all hand-typed bills, any date` : undefined} />
          </div>

          {m.bills > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-3">
              <div className="card p-4">
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Paid by</div>
                <ul className="space-y-2">
                  {m.by_mode.map((x) => (
                    <li key={x.mode} className="text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-slate-200">{x.mode} <span className="text-gray-400">({x.count})</span></span>
                        <span className="font-semibold tabular-nums">{formatINR(x.total)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                        <div className="h-full rounded bg-amber-400" style={{ width: `${(x.total / maxMode) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                {m.by_customer.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800 text-[11px] text-gray-600 dark:text-slate-400 space-y-0.5">
                    {m.by_customer.map((c) => (
                      <div key={c.kind} className="flex justify-between">
                        <span>{c.kind === 'patient' ? 'Registered patients' : 'Walk-ins (name typed)'} · {c.count}</span>
                        <span className="tabular-nums">{formatINR(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-4">
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Day by day</div>
                <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                  {m.by_day.map((d) => (
                    <li key={d.day} className="text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-slate-200">{fmtDate(d.day)} <span className="text-gray-400">({d.bills})</span></span>
                        <span className="font-semibold tabular-nums">{formatINR(d.total)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded mt-1 overflow-hidden">
                        <div className="h-full rounded bg-amber-400" style={{ width: `${(d.total / maxDay) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card p-4 overflow-x-auto">
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Largest bills</div>
                <table className="w-full text-[12px] min-w-[300px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                      <th className="py-1.5">Bill</th>
                      <th className="py-1.5 text-right">Total</th>
                      <th className="py-1.5 text-right">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.largest.map((b) => (
                      <tr key={b.bill_number} className="border-b border-gray-50 dark:border-slate-800/50">
                        <td className="py-1.5">
                          <div className="font-mono text-[11px] text-gray-900 dark:text-slate-100">{b.bill_number}</div>
                          <div className="text-[10px] text-gray-500">{b.name} · {fmtDateTime(b.created_at)}</div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(b.total)}</td>
                        <td className={cn('py-1.5 text-right tabular-nums', b.due > 0 ? 'text-red-600 font-semibold' : 'text-gray-400')}>{b.due > 0 ? formatINR(b.due) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
