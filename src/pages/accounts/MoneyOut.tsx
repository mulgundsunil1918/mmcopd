/** Money out: every voucher raised, plus the supplier payments and patient refunds the app already knows about (each tagged with where it came from). */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Ban } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { VoucherDialog, type VoucherPreset } from '../../components/accounts/VoucherDialog';
import { VoucherPrint } from '../../components/accounts/VoucherPrint';
import { HelpTip } from '../../components/HelpTip';
import { useToast } from '../../hooks/useToast';
import { VOUCHER_TYPES } from '../../lib/accountsRules';
import { fmtDate } from '../../lib/utils';
import { getMoneyPw, inr, MUTED, Tile, usePeriod, usePermissions } from './shared';
import type { VoucherRow } from '../../main/accounts';

const SOURCE: Record<string, string> = { voucher: 'Voucher', supplier: 'Supplier payment', refund: 'Patient refund' };

export function MoneyOutTab({ initialNew }: { initialNew?: boolean }) {
  const qc = useQueryClient(); const toast = useToast();
  const { range, ui } = usePeriod('month');
  const { data: perm } = usePermissions();
  const { data } = useQuery({ queryKey: ['acct-money-out', range.from, range.to], queryFn: () => window.electronAPI.accounts.moneyOut(range.from, range.to, getMoneyPw()) });
  const [dlg, setDlg] = useState<VoucherPreset | null>(initialNew ? {} : null);
  const [print, setPrint] = useState<VoucherRow | null>(null);
  const [cancel, setCancel] = useState<{ id: number; no: string } | null>(null);
  const [reason, setReason] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  const open = async (id: number) => { const v = await window.electronAPI.accounts.voucher(id, getMoneyPw()); if (v) setPrint(v); };
  const doCancel = async () => {
    if (!cancel) return; setErr('');
    const r = await window.electronAPI.accounts.cancelVoucher(cancel.id, reason, pw || undefined);
    if (!r.ok) { setErr(r.error); return; }
    toast(`${cancel.no} cancelled`); setCancel(null); setReason(''); setPw('');
    for (const k of ['acct-money-out', 'acct-doctor-days', 'acct-referrer-days', 'acct-daybook', 'acct-pnl', 'acct-staff', 'acct-overview']) qc.invalidateQueries({ queryKey: [k] });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{ui}
        <div className="flex items-center gap-2">
          <select className="input w-auto" value="" onChange={(e) => e.target.value && setDlg({ type: e.target.value })} aria-label="New voucher">
            <option value="">New voucher…</option>{VOUCHER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <button className="btn-primary" onClick={() => setDlg({ type: 'clinic_maintenance' })}><Plus className="w-4 h-4" /> Voucher</button>
          <HelpTip title="Money out" align="right">Every payment the clinic made. Vouchers are raised here; supplier payments (Pharmacy) and patient refunds (Billing) are listed automatically and say where they came from. A voucher cannot be edited after it is saved — cancel it with a reason and raise it again.</HelpTip>
        </div>
      </div>
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Money out" value={inr(data.total)} tone="red" sub={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
          <Tile label="Vouchers" value={inr(data.vouchers)} sub="what the clinic paid by voucher" />
          <Tile label="Supplier payments" value={inr(data.suppliers)} sub="medicine purchases paid" />
          <Tile label="Patient refunds" value={inr(data.refunds)} sub="already taken off Money in" />
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-slate-700">
            <th className="p-3">Date</th><th>No.</th><th>Paid to</th><th>For</th><th>Paid by</th><th className="text-right">Amount</th><th>From</th><th></th></tr></thead>
          <tbody>
            {(data?.lines ?? []).map((l, i) => (
              <tr key={i} className={`border-b border-gray-100 dark:border-slate-800 ${l.status === 'cancelled' ? 'opacity-50 line-through' : ''}`}>
                <td className="p-3 whitespace-nowrap">{fmtDate(l.date)}</td><td className="font-mono text-xs">{l.ref}</td><td>{l.who}{l.uhid && <span className={MUTED}> · {l.uhid}</span>}</td><td className="text-gray-600 dark:text-slate-400">{l.what}</td><td>{l.mode}</td>
                <td className="text-right tabular-nums font-medium">{inr(l.amount)}</td>
                <td><span className="badge bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300">{SOURCE[l.source]}</span>{l.status === 'cancelled' && <span className="badge ml-1 bg-rose-50 text-rose-700 no-underline">Cancelled</span>}</td>
                <td className="text-right whitespace-nowrap pr-3">
                  {l.voucher_id && <button className="text-blue-600 hover:underline mr-3" onClick={() => open(l.voucher_id!)} title="View and print"><Printer className="w-4 h-4 inline" /></button>}
                  {l.voucher_id && l.status !== 'cancelled' && <button className="text-rose-600 hover:underline" onClick={() => setCancel({ id: l.voucher_id!, no: l.ref })} title="Cancel this voucher"><Ban className="w-4 h-4 inline" /></button>}
                </td>
              </tr>
            ))}
            {data && data.lines.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">Nothing paid out in these days.</td></tr>}
          </tbody>
        </table>
      </div>
      <VoucherDialog open={!!dlg} onClose={() => setDlg(null)} preset={dlg || {}} onDone={(v) => setPrint(v)} />
      {print && <VoucherPrint voucher={print} onClose={() => setPrint(null)} />}
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel?.no ?? ''}`}>
        <div className="space-y-3">
          <div className={MUTED}>The voucher stays in the list marked cancelled, and any days it paid for go back to “to pay”. To correct it, raise a new voucher.</div>
          <input className="input" placeholder="Why is it being cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          {perm && !perm.can_cancel && <input type="password" className="input" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />}
          {err && <div className="text-sm text-rose-700">{err}</div>}
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setCancel(null)}>Keep it</button><button className="btn-danger" disabled={reason.trim().length < 3} onClick={doCancel}>Cancel voucher</button></div>
        </div>
      </Modal>
    </div>
  );
}
