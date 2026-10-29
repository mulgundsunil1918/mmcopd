/** Accounts overview: the month at a glance — money in, money out, profit, cash in hand, what doctors are owed, advances open — and the latest vouchers. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { VoucherDialog, type VoucherPreset } from '../../components/accounts/VoucherDialog';
import { VoucherPrint } from '../../components/accounts/VoucherPrint';
import { SeeMore } from '../../components/Feature';
import { VOUCHER_TYPES } from '../../lib/accountsRules';
import { fmtDate, todayISO } from '../../lib/utils';
import { inr, MUTED, Tile, usePeriod } from './shared';
import type { VoucherRow } from '../../main/accounts';

export function OverviewTab() {
  const navigate = useNavigate();
  const { range, ui } = usePeriod('month');
  const { data: pl } = useQuery({ queryKey: ['acct-pnl', range.from, range.to], queryFn: () => window.electronAPI.accounts.profitLoss(range.from, range.to) });
  const { data: out } = useQuery({ queryKey: ['acct-money-out', range.from, range.to], queryFn: () => window.electronAPI.accounts.moneyOut(range.from, range.to) });
  const { data: book } = useQuery({ queryKey: ['acct-daybook', todayISO(), todayISO()], queryFn: () => window.electronAPI.accounts.dayBook(todayISO(), todayISO()) });
  const { data: docs } = useQuery({ queryKey: ['acct-doctor-days', 'overview', range.from, range.to], queryFn: () => window.electronAPI.accounts.doctorDays({ from: range.from, to: range.to }) });
  const { data: staff = [] } = useQuery({ queryKey: ['acct-staff'], queryFn: () => window.electronAPI.accounts.staff() });
  const { data: recent = [] } = useQuery({ queryKey: ['acct-vouchers-recent'], queryFn: () => window.electronAPI.accounts.vouchers({ status: 'active' }) });
  const [dlg, setDlg] = useState<VoucherPreset | null>(null);
  const [print, setPrint] = useState<VoucherRow | null>(null);
  const owed = docs?.money ? docs.doctors.reduce((a, d) => a + d.balance, 0) : null;
  const advances = staff.reduce((a, s) => a + s.advance_open, 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">{ui}
        <div className="flex gap-2 flex-wrap">{VOUCHER_TYPES.slice(0, 4).map((t) => <button key={t.id} className="btn-secondary" onClick={() => setDlg({ type: t.id })}><Plus className="w-3.5 h-3.5" /> {t.label}</button>)}</div></div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Money in" value={inr(pl?.revenue)} tone="green" sub="collected" />
        <Tile label="Money out" value={inr(out?.total)} tone="red" sub="vouchers + suppliers" />
        <Tile label={pl && pl.profit < 0 ? 'Loss' : 'Profit'} value={inr(pl?.profit)} tone={pl && pl.profit < 0 ? 'red' : 'blue'} sub="after all costs" />
        <Tile label="Cash in hand" value={inr(book?.days[0]?.closing_cash)} sub="now (day book)" />
        <Tile label="Doctors to be paid" value={owed === null ? 'hidden' : inr(owed)} tone="amber" sub={owed === null ? 'needs permission' : 'earned, not yet paid'} />
        <Tile label="Advances to recover" value={inr(advances)} tone="amber" sub="from staff salaries" />
      </div>
      <div className="flex items-center gap-4"><SeeMore to="/analytics?tab=doctors" label="What each doctor earned and how to pay them" /><SeeMore to="/accounts?tab=pnl" label="Profit and loss in detail" /></div>
      <div className="card">
        <div className="p-3 border-b border-gray-200 dark:border-slate-700 text-sm font-semibold">Latest vouchers</div>
        {recent.slice(0, 8).map((v) => (
          <button key={v.id} className="w-full text-left px-3 py-2 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-800" onClick={async () => { const r = await window.electronAPI.accounts.voucher(v.id); if (r) setPrint(r); }}>
            <span className="font-mono text-xs w-20">{v.voucher_no}</span><span className="flex-1">{v.payee_name} <span className={MUTED}>· {v.description || v.category || ''}</span></span>
            <span className={MUTED}>{fmtDate(v.voucher_date)}</span><span className="tabular-nums font-medium w-24 text-right">{inr(v.net_amount)}</span></button>
        ))}
        {recent.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No vouchers yet. Raise one when the clinic pays for something.</div>}
        <div className="p-2 text-right"><button className="text-xs text-blue-600 hover:underline" onClick={() => navigate('/accounts?tab=out')}>All money out →</button></div>
      </div>
      <VoucherDialog open={!!dlg} onClose={() => setDlg(null)} preset={dlg || {}} onDone={(v) => setPrint(v)} />
      {print && <VoucherPrint voucher={print} onClose={() => setPrint(null)} />}
    </div>
  );
}
