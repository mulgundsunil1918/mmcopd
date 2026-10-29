/** Day book: for each day, the cash the clinic opened with, what came in and went out by how it was paid, and the cash it closed with. */
import { useQuery } from '@tanstack/react-query';
import { HelpTip } from '../../components/HelpTip';
import { SettingsLink } from '../../components/Feature';
import { dayLabel, inr, MUTED, usePeriod } from './shared';

const sumOther = (m: Record<string, number>) => Object.entries(m).filter(([k]) => k !== 'Cash').reduce((a, [, v]) => a + v, 0);

export function DayBookTab() {
  const { range, ui } = usePeriod('7d');
  const { data } = useQuery({ queryKey: ['acct-daybook', range.from, range.to], queryFn: () => window.electronAPI.accounts.dayBook(range.from, range.to) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{ui}
        <span className="inline-flex items-center gap-2"><HelpTip title="Day book" align="right">One line for each day. Cash is counted in the drawer: it opens with the cash the day before closed with. UPI, card and bank money is shown as received and paid — it is not matched against your bank statement.</HelpTip>
          <SettingsLink tab="accounts" group="Vouchers, cash and who may raise them" label="Set cash in hand" /></span>
      </div>
      {data && !data.opening_cash_set && <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs px-3 py-2">Cash in hand has not been set, so the first day opens at ₹0. Set it once in Settings → Accounts &amp; Analytics.</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-slate-700">
            <th className="p-3">Day</th><th className="text-right">Opening cash</th><th className="text-right">Cash in</th><th className="text-right">UPI / card / bank in</th>
            <th className="text-right">Cash out</th><th className="text-right">UPI / bank out</th><th className="text-right">Closing cash</th></tr></thead>
          <tbody>
            {(data?.days ?? []).map((d) => (
              <tr key={d.day} className="border-b border-gray-100 dark:border-slate-800">
                <td className="p-3 whitespace-nowrap">{dayLabel(d.day)}</td>
                <td className="text-right tabular-nums text-gray-600 dark:text-slate-400">{inr(d.opening_cash)}</td>
                <td className="text-right tabular-nums text-emerald-700">{inr(d.in_by_mode.Cash ?? 0)}</td>
                <td className="text-right tabular-nums">{inr(sumOther(d.in_by_mode))}</td>
                <td className="text-right tabular-nums text-rose-700">{inr(d.out_by_mode.Cash ?? 0)}</td>
                <td className="text-right tabular-nums">{inr(sumOther(d.out_by_mode))}</td>
                <td className="text-right tabular-nums font-semibold pr-3">{inr(d.closing_cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={MUTED}>Cash closing = opening + cash in − cash out. Refunds are already taken off the money in.</div>
    </div>
  );
}
