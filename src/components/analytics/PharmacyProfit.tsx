import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, PackageCheck, ShieldCheck, TrendingUp, Truck } from 'lucide-react';
import { cn, fmtDate, formatINR } from '../../lib/utils';
import { Kpi, SectionTitle } from './Kpi';
import type { DrugProfitRow } from '../../lib/pharmacyReports';

/**
 * Pharmacy money, kept honest.
 *
 *   Profit      what was ACTUALLY earned on units already sold: revenue − what those units cost
 *               (the cost frozen on each sale). Revenue is after discounts and without GST.
 *   Stock value what is on the shelf now — a snapshot, not profit you have made. Shown at four prices
 *               (what you paid, MRP, your selling price, what it would cost to buy again) so none is
 *               mistaken for another.
 *   Margin      profit ÷ revenue.     Markup   profit ÷ cost.
 *               ₹50 cost sold at ₹100 → ₹50 profit, 50% margin, 100% markup.
 */

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 0 ? `−${formatINR(-v)}` : formatINR(v));
const toneForMargin = (m: number | null) => (m === null ? 'gray' : m < 10 ? 'red' : m < 20 ? 'amber' : 'emerald');

function Loading({ children = 'Loading…' }: { children?: string }) {
  return <div className="text-xs text-gray-500 dark:text-slate-400 p-3">{children}</div>;
}

/** A compact ranked list: name on the left, the figure that earned its place on the right. */
function RankCard({ title, hint, rows, empty }: { title: string; hint?: string; rows: { name: string; value: string; sub?: string; bad?: boolean }[]; empty?: string }) {
  return (
    <div className="card p-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</div>
      {hint && <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-1.5">{hint}</div>}
      {rows.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400 italic py-2">{empty ?? 'Nothing to show for this period.'}</div>
      ) : (
        <ol className="text-xs space-y-1">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-baseline gap-2 border-b border-gray-100 dark:border-slate-800 pb-1">
              <span className="w-4 text-right text-[10px] text-gray-400">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-slate-100" title={r.name}>{r.name}</span>
              {r.sub && <span className="text-[10px] text-gray-500 dark:text-slate-400">{r.sub}</span>}
              <span className={cn('font-semibold tabular-nums', r.bad ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-slate-100')}>{r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type SortKey = 'name' | 'units' | 'sales' | 'avg_price' | 'avg_cost' | 'gp_per_unit' | 'margin_pct' | 'profit' | 'revenue' | 'markup_pct' | 'stock_units';
const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: 'name', label: 'Medicine' },
  { key: 'units', label: 'Units sold' },
  { key: 'sales', label: 'Bills', hint: 'Number of different bills it appeared on' },
  { key: 'avg_price', label: 'Avg price', hint: 'Revenue ÷ units — what you really got per unit (after discounts, without GST)' },
  { key: 'avg_cost', label: 'Avg cost', hint: 'What those units cost you, per unit' },
  { key: 'gp_per_unit', label: 'A · Profit / unit' },
  { key: 'margin_pct', label: 'B · Margin %', hint: 'Profit ÷ revenue' },
  { key: 'profit', label: 'C · Total profit' },
  { key: 'revenue', label: 'D · Revenue' },
  { key: 'markup_pct', label: 'E · Markup %', hint: 'Profit ÷ cost' },
  { key: 'stock_units', label: 'In stock' },
];

/* ======================================================================================
   PROFIT — realised, for a date range
   ====================================================================================== */
export function PharmacyProfitSection({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-profit', from, to],
    queryFn: () => window.electronAPI.analytics.pharmacyProfit({ from, to }),
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'profit', dir: -1 });
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const report = data && data.ok ? data.report : null;
  const rows = useMemo(() => {
    if (!report) return [];
    const needle = q.trim().toLowerCase();
    const list = report.drugs.filter((d) => (d.units > 0 || d.stock_units > 0) && (!needle || d.name.toLowerCase().includes(needle)));
    const val = (d: DrugProfitRow) => (sort.key === 'name' ? d.name.toLowerCase() : (d[sort.key] as number | null));
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;            // blanks always last
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [report, q, sort]);

  if (isLoading) return <Loading />;
  if (!data) return null;
  if (!data.ok) return <div className="card p-3 text-xs text-red-700 dark:text-red-400">{data.error}</div>;
  const r = data.report;
  const t = r.totals;
  const k = r.rankings;
  const shown = showAll ? rows : rows.slice(0, 25);
  const rank = (xs: DrugProfitRow[], f: (d: DrugProfitRow) => string, sub?: (d: DrugProfitRow) => string, bad?: (d: DrugProfitRow) => boolean) =>
    xs.map((d) => ({ name: d.name, value: f(d), sub: sub?.(d), bad: bad?.(d) }));

  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }));

  return (
    <section className="space-y-3">
      <SectionTitle icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} title="Pharmacy profit" subtitle={`${fmtDate(r.from)} — ${fmtDate(r.to)} · medicines already sold`} />
      <div className="text-[11px] text-gray-600 dark:text-slate-300 -mt-1">
        <b>Revenue</b> is what customers actually paid, after discounts{r.revenue_excludes_gst ? ', without the GST you owe onward' : ''}.{' '}
        <b>Profit</b> = revenue − what those units cost (cost is fixed on the day of sale, so a later price change never rewrites it).{' '}
        <b>Margin</b> = profit ÷ revenue. <b>Markup</b> = profit ÷ cost. Before rent, salaries and other running costs.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Revenue" value={money(t.revenue)} sub={`${t.units.toLocaleString('en-IN')} units · ${t.sales} bills`} tone="blue" />
        <Kpi label="Cost of goods sold" value={money(t.cogs)} sub="what the units cost you" tone="indigo" />
        <Kpi label="Gross profit" value={money(t.profit)} sub="revenue − cost" tone="emerald" />
        <Kpi label="Gross margin" value={pct(t.margin_pct)} sub="profit ÷ revenue" tone={toneForMargin(t.margin_pct) as any} />
        <Kpi label="Markup" value={pct(t.markup_pct)} sub="profit ÷ cost" tone="violet" />
        <Kpi label="Discounts given" value={money(t.discount)} sub={t.gross_amount > 0 ? `${((t.discount / t.gross_amount) * 100).toFixed(1)}% of billed value` : undefined} tone="amber" />
      </div>

      {t.uncosted_units > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>{t.uncosted_units.toLocaleString('en-IN')} unit(s) worth {formatINR(t.uncosted_revenue)}</b> were sold from stock with no purchase price on record, so they are
            <b> left out of profit and margin</b> (counting them as free would overstate profit). Add the purchase price to those batches in
            Pharmacy → Drugs in my clinic to include them in future.
          </div>
        </div>
      )}

      {(r.ward.units > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="card p-3">
            <div className="font-semibold">Counter &amp; prescriptions</div>
            <div className="text-gray-600 dark:text-slate-300">Revenue {money(r.counter.revenue)} · profit {money(r.counter.profit)} · margin {pct(r.counter.margin_pct)}</div>
          </div>
          <div className="card p-3">
            <div className="font-semibold">Ward-dispensed <span className="font-normal text-gray-500">(billed on the IPD bill)</span></div>
            <div className="text-gray-600 dark:text-slate-300">Revenue {money(r.ward.revenue)} · profit {money(r.ward.profit)} · margin {pct(r.ward.margin_pct)}</div>
          </div>
        </div>
      )}

      {/* Per-medicine table — reports A–E */}
      <div className="card p-3">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Profit by medicine <span className="text-[11px] font-normal text-gray-500">· click a column to sort</span></div>
          <input className="input w-56 py-1 text-xs" placeholder="Search medicine…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 italic py-4 text-center">No sales in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={cn('py-1.5 px-1.5 cursor-pointer select-none whitespace-nowrap', c.key === 'name' ? 'text-left' : 'text-right')} title={c.hint} onClick={() => setSortKey(c.key)}>
                      {c.label}
                      {sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="inline w-3 h-3 ml-0.5" /> : <ArrowDown className="inline w-3 h-3 ml-0.5" />)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.key} className="border-b border-gray-100 dark:border-slate-800 tabular-nums">
                    <td className="py-1.5 px-1.5 text-gray-900 dark:text-slate-100">{d.name}{d.uncosted_units > 0 && <span className="ml-1 text-[9px] text-amber-700 dark:text-amber-300" title="Some units sold have no cost on record">⚠ {d.uncosted_units} uncosted</span>}</td>
                    <td className="py-1.5 px-1.5 text-right">{d.units || '—'}</td>
                    <td className="py-1.5 px-1.5 text-right">{d.sales || '—'}</td>
                    <td className="py-1.5 px-1.5 text-right">{money(d.avg_price)}</td>
                    <td className="py-1.5 px-1.5 text-right">{money(d.avg_cost)}</td>
                    <td className="py-1.5 px-1.5 text-right">{money(d.gp_per_unit)}</td>
                    <td className={cn('py-1.5 px-1.5 text-right font-semibold', d.margin_pct !== null && d.margin_pct < 10 ? 'text-red-700 dark:text-red-400' : '')}>{pct(d.margin_pct)}</td>
                    <td className="py-1.5 px-1.5 text-right font-semibold">{money(d.units ? d.profit : null)}</td>
                    <td className="py-1.5 px-1.5 text-right">{money(d.units ? d.revenue : null)}</td>
                    <td className="py-1.5 px-1.5 text-right">{pct(d.markup_pct)}</td>
                    <td className="py-1.5 px-1.5 text-right text-gray-600 dark:text-slate-300">{d.stock_units || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 25 && (
          <div className="text-center mt-2"><button className="btn-ghost text-xs" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show top 25' : `Show all ${rows.length}`}</button></div>
        )}
      </div>

      {/* Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <RankCard title="Best sellers — by quantity" rows={rank(k.best_by_units, (d) => `${d.units} units`)} />
        <RankCard title="Best sellers — by revenue" rows={rank(k.best_by_revenue, (d) => formatINR(d.revenue))} />
        <RankCard title="Best sellers — by bills" hint="how many different bills it was on" rows={rank(k.best_by_sales, (d) => `${d.sales} bills`)} />
        <RankCard title="Highest gross profit" rows={rank(k.highest_profit, (d) => formatINR(d.profit), (d) => `${pct(d.margin_pct)}`)} />
        <RankCard title="Highest margin" hint="profit ÷ revenue" rows={rank(k.highest_margin, (d) => pct(d.margin_pct), (d) => formatINR(d.profit))} />
        <RankCard title="Lowest margin" hint="F · watch for anything near or below zero" rows={rank(k.lowest_margin, (d) => pct(d.margin_pct), (d) => formatINR(d.profit), (d) => (d.margin_pct ?? 0) < 10)} />
        <RankCard title="High revenue, low profit" hint={`big sellers earning less than the ${pct(k.overall_margin_pct)} average margin`} rows={rank(k.high_revenue_low_profit, (d) => formatINR(d.revenue), (d) => pct(d.margin_pct), () => true)} empty="No big seller is below the average margin." />
        <RankCard title="Low profit, high volume" hint="G · lots of units, thin margin" rows={rank(k.low_profit_high_volume, (d) => `${d.units} units`, (d) => pct(d.margin_pct), () => true)} empty="No high-volume medicine is below the average margin." />
        <RankCard title="In stock, no sales" hint="H · money sitting on the shelf" rows={rank(k.no_sales, (d) => `${d.stock_units} units`, (d) => (d.stock_cost ? formatINR(d.stock_cost) : ''))} empty="Everything in stock sold at least once." />
        <RankCard title="Slow movers" hint="H · stock is at least 4× what sold in this period" rows={rank(k.slow_movers, (d) => `${d.stock_units} in stock`, (d) => `sold ${d.units}`)} empty="No slow movers." />
      </div>

      {r.by_month.length > 0 && (
        <div className="card p-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">By month</div>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 text-right">
                <th className="py-1.5 text-left">Month</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {r.by_month.map((m) => (
                <tr key={m.month} className="border-b border-gray-100 dark:border-slate-800 text-right">
                  <td className="py-1.5 text-left">{m.month}</td><td>{money(m.revenue)}</td><td>{money(m.cogs)}</td>
                  <td className="font-semibold">{money(m.profit)}</td><td>{pct(m.margin_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ======================================================================================
   STOCK VALUE — a snapshot of the shelf, at four different prices
   ====================================================================================== */
export function PharmacyValuationSection() {
  const { data: v, isLoading } = useQuery({ queryKey: ['pharmacy-valuation'], queryFn: () => window.electronAPI.analytics.pharmacyValuation() });
  if (isLoading || !v) return <Loading />;
  const s = v.sellable;
  return (
    <section className="space-y-3">
      <SectionTitle icon={<PackageCheck className="w-4 h-4 text-teal-600" />} title="Stock on the shelf" subtitle="a snapshot of today — not profit already made" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="At cost" value={money(s.at_cost)} sub={`what you paid · ${s.units.toLocaleString('en-IN')} units · ${s.skus} medicines`} tone="indigo" />
        <Kpi label="At MRP" value={money(s.at_mrp)} sub="the printed price, if sold in full" tone="blue" />
        <Kpi label="At your selling price" value={money(s.at_selling)} sub="what you intend to charge" tone="violet" />
        <Kpi label="Expected gross profit" value={money(s.expected_profit)} sub={`${pct(s.expected_margin_pct)} margin if all sells at your price${v.revenue_excludes_gst ? ', GST removed' : ''}`} tone="emerald" />
        <Kpi label="Cost to buy again" value={money(s.at_replacement_cost)} sub="the same units at the latest purchase cost" tone="gray" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="card p-3 border-red-200 dark:border-red-900">
          <div className="font-semibold text-red-700 dark:text-red-400">Expired — write-off</div>
          <div className="text-lg font-bold">{money(v.expired.at_cost)}</div>
          <div className="text-gray-500 dark:text-slate-400">{v.expired.units} units · {v.expired.batches} batch(es), at cost</div>
        </div>
        <div className="card p-3 border-amber-200 dark:border-amber-900">
          <div className="font-semibold text-amber-700 dark:text-amber-300">Expiring within {v.near_expiry.days} days</div>
          <div className="text-lg font-bold">{money(v.near_expiry.at_cost)}</div>
          <div className="text-gray-500 dark:text-slate-400">{v.near_expiry.units} units · {v.near_expiry.batches} batch(es), at cost</div>
        </div>
        <div className="card p-3">
          <div className="font-semibold">Cost not recorded</div>
          <div className="text-lg font-bold">{v.unknown_cost.batches} batch(es)</div>
          <div className="text-gray-500 dark:text-slate-400">{v.unknown_cost.units} units — left out of the cost and profit figures above</div>
        </div>
      </div>
      {(v.near_expiry_list.length > 0 || v.expired_list.length > 0) && (
        <div className="card p-3">
          <div className="text-sm font-semibold mb-1">Expired and expiring batches</div>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-1.5">Medicine</th><th>Batch</th><th>Expiry</th><th className="text-right">Days</th><th className="text-right">Qty</th><th className="text-right">At cost</th>
              </tr>
            </thead>
            <tbody>
              {[...v.expired_list, ...v.near_expiry_list].map((b, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-1.5">{b.drug}</td><td className="font-mono text-[11px]">{b.batch_no}</td><td>{fmtDate(b.expiry)}</td>
                  <td className={cn('text-right font-semibold', b.days < 0 ? 'text-red-700 dark:text-red-400' : b.days <= 30 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>{b.days < 0 ? `expired ${-b.days}d ago` : b.days}</td>
                  <td className="text-right">{b.qty}</td><td className="text-right">{money(b.at_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="text-[11px] text-gray-600 dark:text-slate-300 card p-3">
        <summary className="cursor-pointer font-semibold">How to read these numbers</summary>
        <dl className="mt-2 space-y-1">
          <div><dt className="inline font-semibold">Purchase cost</dt> — <dd className="inline">what a unit cost when you bought it: the supplier's rate, less discounts, plus freight, shared over free units too{' '}(and GST, only if you cannot claim it back). It is recorded per batch and never changes after a sale.</dd></div>
          <div><dt className="inline font-semibold">MRP</dt> — <dd className="inline">the maximum price printed on the pack. A legal ceiling, not your price.</dd></div>
          <div><dt className="inline font-semibold">Selling price</dt> — <dd className="inline">what you choose to charge (never above MRP). Blank means MRP.</dd></div>
          <div><dt className="inline font-semibold">Revenue</dt> — <dd className="inline">what customers actually paid on real bills, after discounts{v.revenue_excludes_gst ? ' and without GST' : ''}.</dd></div>
          <div><dt className="inline font-semibold">Expected profit</dt> — <dd className="inline">what the stock on the shelf would earn <i>if</i> it all sold at your selling price. It has not happened yet.</dd></div>
          <div><dt className="inline font-semibold">Cost to buy again</dt> — <dd className="inline">what the same units would cost at your latest purchase price. Different from what you paid.</dd></div>
        </dl>
      </details>
    </section>
  );
}

/* ======================================================================================
   SUPPLIERS — what was bought, what is owed, what changed
   ====================================================================================== */
export function SupplierSection({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-report', from, to],
    queryFn: () => window.electronAPI.analytics.supplierReport({ from, to }),
  });
  if (isLoading) return <Loading />;
  if (!data) return null;
  if (!data.ok) return <div className="card p-3 text-xs text-red-700 dark:text-red-400">{data.error}</div>;
  const r = data.report;
  return (
    <section className="space-y-3">
      <SectionTitle icon={<Truck className="w-4 h-4 text-orange-600" />} title="Suppliers" subtitle={`${fmtDate(r.from)} — ${fmtDate(r.to)}`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Bought" value={money(r.totals.billed)} sub={`${r.totals.invoices} bills in range`} tone="blue" />
        <Kpi label="Discounts received" value={money(r.totals.discounts)} tone="emerald" />
        <Kpi label="Paid (these bills)" value={money(r.totals.paid)} tone="indigo" />
        <Kpi label="Owed to suppliers today" value={money(r.totals.owed_now)} sub="all unpaid bills, any date" tone={r.totals.owed_now > 0 ? 'red' : 'gray'} />
      </div>
      <div className="card p-3 overflow-x-auto">
        <div className="text-sm font-semibold mb-1">By supplier</div>
        {r.suppliers.length === 0 ? <div className="text-xs italic text-gray-500 py-2">No purchase bills in this range.</div> : (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 text-right">
                <th className="py-1.5 text-left">Supplier</th><th>Bills</th><th>Bought</th><th>Discounts</th><th>Paid</th><th>Still to pay</th>
              </tr>
            </thead>
            <tbody>
              {r.suppliers.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 dark:border-slate-800 text-right">
                  <td className="py-1.5 text-left">{s.name}</td><td>{s.invoices}</td><td>{money(s.billed)}</td><td>{money(s.discounts)}</td><td>{money(s.paid)}</td>
                  <td className={cn('font-semibold', s.outstanding > 0 ? 'text-red-700 dark:text-red-400' : '')}>
                    {money(s.outstanding)}{s.unknown_paid > 0 && <span className="text-[9px] text-amber-700 dark:text-amber-300 ml-1" title="Bills marked part-paid before payments were tracked">+{s.unknown_paid} unknown</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-3">
          <div className="text-sm font-semibold mb-1">Purchases by month</div>
          {r.by_month.length === 0 ? <div className="text-xs italic text-gray-500 py-2">Nothing in this range.</div> : (
            <table className="w-full text-xs tabular-nums">
              <tbody>
                {r.by_month.map((m, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5">{m.month}</td><td>{m.supplier}</td><td className="text-right">{m.invoices} bill{m.invoices === 1 ? '' : 's'}</td><td className="text-right font-semibold">{money(m.billed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-3">
          <div className="text-sm font-semibold mb-1">Payments made</div>
          {r.payments.length === 0 ? <div className="text-xs italic text-gray-500 py-2">No payments to suppliers recorded in this range.</div> : (
            <table className="w-full text-xs tabular-nums">
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5">{fmtDate(p.paid_on)}</td><td>{p.supplier} <span className="text-gray-500">· {p.invoice_number}</span></td>
                    <td className="text-gray-500">{p.payment_mode || ''}</td><td className="text-right font-semibold">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card p-3">
        <div className="text-sm font-semibold mb-1">Price changes <span className="text-[11px] font-normal text-gray-500">· same supplier, same medicine, rate different from the previous purchase</span></div>
        {r.price_changes.length === 0 ? <div className="text-xs italic text-gray-500 py-2">No rate changes in this range.</div> : (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 text-right">
                <th className="py-1.5 text-left">Medicine</th><th className="text-left">Supplier</th><th>Before</th><th>Now</th><th>Change</th><th className="text-left pl-3">Bill</th>
              </tr>
            </thead>
            <tbody>
              {r.price_changes.map((c, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800 text-right">
                  <td className="py-1.5 text-left">{c.drug}</td><td className="text-left">{c.supplier}</td><td>{money(c.prev_rate)}</td><td>{money(c.rate)}</td>
                  <td className={cn('font-semibold', c.change_pct > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>{c.change_pct > 0 ? '+' : ''}{c.change_pct.toFixed(1)}%</td>
                  <td className="text-left pl-3 text-gray-500">{c.invoice_number} · {fmtDate(c.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="text-[10px] text-gray-500 dark:text-slate-400">Purchase returns are not tracked in this version, so they are not part of these figures.</div>
    </section>
  );
}

/* ======================================================================================
   DATA CHECKS
   ====================================================================================== */
export function PharmacyChecksSection() {
  const { data, isLoading } = useQuery({ queryKey: ['pharmacy-checks'], queryFn: () => window.electronAPI.analytics.pharmacyChecks() });
  if (isLoading || !data) return <Loading />;
  return (
    <section>
      <SectionTitle icon={<ShieldCheck className="w-4 h-4 text-gray-600" />} title="Pharmacy data checks" subtitle="read-only — nothing is changed" />
      {data.length === 0 ? (
        <div className="card p-3 text-xs text-emerald-700 dark:text-emerald-400">✓ No problems found in the pharmacy records.</div>
      ) : (
        <div className="card p-3 space-y-1.5">
          {data.map((f) => (
            <div key={f.code} className="flex items-start gap-2 text-xs">
              <span className={cn('badge flex-shrink-0', f.severity === 'error' ? 'bg-red-100 text-red-700' : f.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700')}>{f.severity}</span>
              <span><b>{f.count}</b> — {f.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

