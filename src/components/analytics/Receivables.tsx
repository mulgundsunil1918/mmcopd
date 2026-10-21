/**
 * Receivables — the money billed but not yet collected, across every bill and every patient: by department, by
 * patient (open one to see the bills and collect), and by how long it has been owed. Same rule as the patient portal
 * and the Accounts page (main/billing-portal.ts), so the three can never disagree.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BadgePercent, ClipboardList, Wallet } from 'lucide-react';
import { Kpi, SectionTitle } from './Kpi';
import { cn, fmtDate, fmtDateTime, formatINR } from '../../lib/utils';

const KIND_COLOUR: Record<string, string> = {
  ipd: '#3b82f6', lab: '#d946ef', radiology: '#0ea5e9', consultation: '#8b5cf6', service: '#f59e0b', pharmacy: '#10b981', pharmacy_manual: '#d97706',
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
        <Kpi label="Oldest unpaid bills" value={oldest ? oldest.label : '—'} sub={oldest ? `${formatINR(oldest.due)} owed for that long` : 'nothing is owed'} tone="gray" />
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
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-5">How long it has been owed</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 mb-3">
              Unpaid bills sorted by how old they are, counted from the day each was raised. The longer a bill waits, the harder it is to collect —
              so the lower rows are the ones to chase first.
            </div>
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

const KIND_LABEL: Record<string, string> = { lab: 'Lab', radiology: 'Radiology', visit: 'Visit' };

/**
 * Work done (or booked) that has no bill: lab orders and scans with priced tests, and recent visits with no consultation
 * bill — what the clinic could still charge for. Open a row to bill it from that patient's portal.
 */
export function UnbilledWorkSection() {
  const navigate = useNavigate();
  const { data: u, isLoading } = useQuery({
    queryKey: ['unbilled-work'],
    queryFn: () => window.electronAPI.analytics.unbilled({ days: 60, limit: 12 }),
    refetchInterval: 60_000,
  });
  if (isLoading || !u) return null;
  return (
    <section>
      <SectionTitle icon={<ClipboardList className="w-4 h-4 text-amber-600" />} title="Work with no bill"
        subtitle={`last ${u.days} days — could still be charged`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Could be billed" value={formatINR(u.total_value)} tone={u.total_value > 0 ? 'amber' : 'gray'} />
        <Kpi label="Lab orders" value={u.lab.orders} sub={formatINR(u.lab.value)} tone="violet" />
        <Kpi label="Scans" value={u.radiology.orders} sub={formatINR(u.radiology.value)} tone="blue" />
        <Kpi label="Visits" value={u.visits.count} sub={`${formatINR(u.visits.value)} at the doctor's fee`} tone="indigo" />
      </div>
      {u.items.length > 0 && (
        <div className="card p-4 mt-3 overflow-x-auto">
          <table className="w-full text-[12px] min-w-[520px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                <th className="py-1.5">Patient</th>
                <th className="py-1.5">What</th>
                <th className="py-1.5">When</th>
                <th className="py-1.5 text-right">Worth</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {u.items.map((it, i) => (
                <tr key={`${it.kind}-${i}`} className="border-b border-gray-50 dark:border-slate-800/50">
                  <td className="py-1.5">
                    <div className="font-medium text-gray-900 dark:text-slate-100">{it.name}</div>
                    <div className="text-[10px] text-gray-400">{it.uhid}</div>
                  </td>
                  <td className="py-1.5 text-gray-700 dark:text-slate-300">
                    <span className={cn('badge text-[9px] mr-1.5', it.kind === 'lab' ? 'bg-fuchsia-100 text-fuchsia-700' : it.kind === 'radiology' ? 'bg-sky-100 text-sky-700' : 'bg-blue-100 text-blue-700')}>{KIND_LABEL[it.kind]}</span>
                    {it.title}
                  </td>
                  <td className="py-1.5 text-gray-500 whitespace-nowrap">{it.date_is_local ? fmtDate(it.date) : fmtDateTime(it.date)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(it.amount)}</td>
                  <td className="py-1.5 text-right">
                    <button className="btn-secondary text-[11px] py-0.5 px-2" onClick={() => navigate(`/billing?patient=${it.patient_id}`)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Discounts given in the chosen period — on bills and pharmacy sales — with the largest, the reason and who gave them. */
export function DiscountsSection({ from, to }: { from: string; to: string }) {
  const { data: d, isLoading } = useQuery({
    queryKey: ['discounts-given', from, to],
    queryFn: () => window.electronAPI.analytics.discounts(from, to, 8),
  });
  if (isLoading || !d) return null;
  return (
    <section>
      <SectionTitle icon={<BadgePercent className="w-4 h-4 text-violet-600" />} title="Discounts given"
        subtitle={`${fmtDate(from)} — ${fmtDate(to)}`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total discounts" value={formatINR(d.total_value)} sub={d.pct_of_gross === null ? undefined : `${d.pct_of_gross}% of what was charged`} tone={d.total_value > 0 ? 'violet' : 'gray'} />
        <Kpi label="On bills" value={formatINR(d.bills.value)} sub={`${d.bills.count} bill${d.bills.count === 1 ? '' : 's'}`} tone="blue" />
        <Kpi label="On pharmacy sales" value={formatINR(d.pharmacy.value)} sub={`${d.pharmacy.count} sale${d.pharmacy.count === 1 ? '' : 's'}`} tone="emerald" />
      </div>
      {d.largest.length > 0 && (
        <div className="card p-4 mt-3 overflow-x-auto">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Largest discounts</div>
          <table className="w-full text-[12px] min-w-[520px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                <th className="py-1.5">Bill / sale</th>
                <th className="py-1.5">Patient</th>
                <th className="py-1.5">When</th>
                <th className="py-1.5">Reason</th>
                <th className="py-1.5">Given by</th>
                <th className="py-1.5 text-right">Off</th>
              </tr>
            </thead>
            <tbody>
              {d.largest.map((r) => (
                <tr key={`${r.kind}-${r.number}`} className="border-b border-gray-50 dark:border-slate-800/50">
                  <td className="py-1.5 font-mono text-[11px]">{r.number}{r.kind === 'pharmacy' && <span className="badge ml-1.5 text-[9px] bg-lime-100 text-lime-700">Pharmacy</span>}</td>
                  <td className="py-1.5">{r.patient}{r.uhid ? <span className="text-[10px] text-gray-400"> · {r.uhid}</span> : null}</td>
                  <td className="py-1.5 text-gray-500 whitespace-nowrap">{fmtDateTime(r.date)}</td>
                  <td className="py-1.5 text-gray-600 dark:text-slate-400">{r.reason || <span className="text-gray-300">not recorded</span>}</td>
                  <td className="py-1.5 text-gray-600 dark:text-slate-400">{r.by || <span className="text-gray-300">—</span>}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-violet-700 dark:text-violet-300">{formatINR(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

