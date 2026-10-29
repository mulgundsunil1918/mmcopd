/** Profit and loss: what came in, less what it cost — medicines, expenses, salaries, doctors’ and referrers’ pay — then the revenue-by-module and pharmacy money views that moved here. */
import { useQuery } from '@tanstack/react-query';
import { Feature } from '../../components/Feature';
import { HelpTip } from '../../components/HelpTip';
import { ModulesRevenue } from '../../components/analytics/ModulesRevenue';
import { PharmacyProfitSection, PharmacyValuationSection, SupplierSection } from '../../components/analytics/PharmacyProfit';
import { inr, MUTED, usePeriod } from './shared';

export function ProfitLossTab() {
  const { range, ui } = usePeriod('month');
  const { data: pl } = useQuery({ queryKey: ['acct-pnl', range.from, range.to], queryFn: () => window.electronAPI.accounts.profitLoss(range.from, range.to) });
  /** A cost reads "− ₹21,800.00" (never "₹-21,800.00"); the bold rows (money in, profit) carry a rule above them except the very first. */
  const money = (v: number) => (v < 0 ? `− ${inr(-v)}` : inr(v));
  const row = (label: string, v: number, opts: { sub?: boolean; bold?: boolean; tone?: string; rule?: boolean } = {}) => (
    <tr className={opts.bold ? `${opts.rule === false ? '' : 'border-t-2 border-gray-300 dark:border-slate-600'} font-bold` : 'border-b border-gray-100 dark:border-slate-800'}>
      <td className={`py-2 ${opts.sub ? 'pl-6 text-gray-600 dark:text-slate-400' : ''}`}>{label}</td>
      <td className={`py-2 text-right tabular-nums ${opts.tone || ''}`}>{money(v)}</td></tr>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">{ui}
        <HelpTip title="Profit and loss" align="right">Money collected, less the cost of the medicines sold, the expenses and salaries paid by voucher, and what doctors and referrers were paid. Cancelled vouchers are left out. A salary counts in full (an advance recovered from it is not a second cost).</HelpTip></div>
      <Feature id="accounts.pnl.profit">
        {pl && (
          <div className="card p-5 max-w-3xl">
            <table className="w-full text-sm"><tbody>
              {row('Money in (collected)', pl.revenue, { bold: true, rule: false, tone: 'text-emerald-700' })}
              {row('Medicines sold — what they cost', -pl.pharmacy_cost)}
              {row('Expenses (clinic maintenance and others)', -pl.expenses)}
              {pl.expenses_by_head.map((h) => row(h.head, -h.amount, { sub: true }))}
              {row('Staff salaries', -pl.salaries)}
              {row('Doctors’ pay', -pl.doctor_payments)}
              {row('Referral payments', -pl.referral_payments)}
              {row(pl.profit >= 0 ? 'Profit' : 'Loss', pl.profit, { bold: true, tone: pl.profit >= 0 ? 'text-emerald-700' : 'text-rose-700' })}
            </tbody></table>
            {pl.pharmacy_cost_missing && <div className={MUTED + ' mt-3'}>Some medicines sold have no recorded cost, so the cost above is only what is known. Record purchase prices to complete it.</div>}
          </div>
        )}
      </Feature>
      <Feature id="accounts.pnl.modules"><ModulesRevenue from={range.from} to={range.to} /></Feature>
      <Feature id="accounts.pnl.pharmacy">
        <div className="space-y-5">
          <PharmacyProfitSection from={range.from} to={range.to} />
          <PharmacyValuationSection />
          <SupplierSection from={range.from} to={range.to} />
        </div>
      </Feature>
    </div>
  );
}
