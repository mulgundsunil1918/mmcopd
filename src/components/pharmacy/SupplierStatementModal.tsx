/**
 * A supplier's whole account on one screen — Wholesalers → Statement. Everything the clinic needs to know about a supplier without any paper:
 * what is owed NOW, the bills still pending (oldest first, with how old), the latest bills, and a passbook of every bill (credit) and payment
 * (debit) with a running balance. Prints. The figures come from lib/supplierStatement.ts (the same code for the app and the website demo).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Wallet } from 'lucide-react';
import { Modal } from '../Modal';
import { HelpTip } from '../HelpTip';
import { cn, fmtDate, formatINR } from '../../lib/utils';
import type { BillState, StatementBill } from '../../lib/supplierStatement';
import { PurchaseDetailModal } from './PurchaseDetailModal';
import { SupplierStatementPrint } from './SupplierStatementPrint';

export const BILL_STATE: Record<BillState, { label: string; tone: string }> = {
  unpaid: { label: 'Unpaid', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' },
  part: { label: 'Part-paid', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  paid: { label: 'Paid', tone: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200' },
  unknown: { label: 'Payment unknown', tone: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
};

const TH = 'py-1.5 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold';

function BillsTable({ bills, onOpen, showAge }: { bills: StatementBill[]; onOpen: (id: number) => void; showAge?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 dark:border-slate-700">
            <th className={TH}>Bill</th>
            <th className={TH}>Date</th>
            {showAge && <th className={cn(TH, 'text-right')}>Age</th>}
            <th className={cn(TH, 'text-right')}>Amount</th>
            <th className={cn(TH, 'text-right')}>Paid</th>
            <th className={cn(TH, 'text-right')}>Balance</th>
            <th className={cn(TH, 'pl-3')}>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.invoice_id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-1.5 font-medium text-gray-900 dark:text-slate-100">
                {b.invoice_number}
                {b.part_of && <span className="ml-1.5 text-[10px] text-gray-500 dark:text-slate-400">(later part of {b.part_of})</span>}
              </td>
              <td className="py-1.5 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(b.invoice_date)}</td>
              {showAge && <td className="py-1.5 text-right text-xs tabular-nums whitespace-nowrap">{b.days_old === 0 ? 'today' : `${b.days_old} day${b.days_old === 1 ? '' : 's'}`}</td>}
              <td className="py-1.5 text-right tabular-nums">{formatINR(b.total)}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600 dark:text-slate-300">{b.state === 'unknown' ? '—' : formatINR(b.paid)}</td>
              <td className={cn('py-1.5 text-right tabular-nums font-semibold', b.outstanding > 0.004 ? 'text-red-700 dark:text-red-400' : 'text-gray-400')}>
                {b.state === 'unknown' ? '?' : b.outstanding > 0.004 ? formatINR(b.outstanding) : '—'}
              </td>
              <td className="py-1.5 pl-3"><span className={cn('badge', BILL_STATE[b.state].tone)}>{BILL_STATE[b.state].label}</span></td>
              <td className="py-1.5 text-right"><button className="btn-ghost text-xs" onClick={() => onOpen(b.invoice_id)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupplierStatementModal({ supplier, onClose, onPay }: { supplier: { id: number; name: string }; onClose: () => void; onPay: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openBill, setOpenBill] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const { data: st, isLoading } = useQuery({
    queryKey: ['supplier-statement', supplier.id, from, to],
    queryFn: () => window.electronAPI.wholesalers.statement(supplier.id, { from: from || null, to: to || null }),
  });

  if (isLoading || !st) {
    return <Modal open onClose={onClose} title={`Statement · ${supplier.name}`} size="2xl"><div className="text-xs text-gray-500 p-4">Loading…</div></Modal>;
  }
  const t = st.totals;
  const owing = t.owed > 0.004;

  return (
    <>
      <Modal open onClose={onClose} title={`Statement · ${st.supplier.name}`} size="2xl">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed">
            <div>Drug licence <span className="font-mono">{st.supplier.drug_license_no}</span>{st.supplier.gstin && <> · GSTIN <span className="font-mono">{st.supplier.gstin}</span></>}{st.supplier.phone && <> · {st.supplier.phone}</>}</div>
            <div className="text-gray-500 dark:text-slate-400">Account as of {fmtDate(st.as_of)}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setPrinting(true)}><Printer className="w-3.5 h-3.5" /> Print / Save as PDF</button>
            <button className="btn-primary text-xs" disabled={!owing} onClick={onPay}
              title={owing ? `Pay ${st.supplier.name}: one payment settles the unpaid bills, oldest first` : 'Nothing is owed on bills with recorded payments'}>
              <Wallet className="w-3.5 h-3.5" /> Pay supplier
            </button>
          </div>
        </div>

        {/* The four numbers that matter */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className={cn('rounded-xl border p-3', owing ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20' : 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1">You owe now
              <HelpTip title="You owe now"><p>What is still unpaid to this supplier: every bill (credit) minus every payment you made (debit).</p><p>Bills marked “part-paid” before CureDesk tracked payments are listed separately and are not in this figure, because how much was paid is unknown.</p></HelpTip>
            </div>
            <div className={cn('text-2xl font-extrabold tabular-nums', owing ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300')}>{formatINR(t.owed)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{owing ? 'to pay' : 'nothing pending'}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">Total billed</div>
            <div className="text-xl font-bold tabular-nums">{formatINR(t.billed)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{t.bills} bill{t.bills === 1 ? '' : 's'}{t.last_bill_date ? ` · last ${fmtDate(t.last_bill_date)}` : ''}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">Total paid</div>
            <div className="text-xl font-bold tabular-nums">{formatINR(t.paid)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{t.last_payment_date ? `last payment ${fmtDate(t.last_payment_date)}` : 'no payment yet'}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">Pending bills</div>
            <div className="text-xl font-bold tabular-nums">{t.open_bills}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{t.oldest_pending_days != null ? `oldest is ${t.oldest_pending_days} day${t.oldest_pending_days === 1 ? '' : 's'} old` : 'all settled'}</div>
          </div>
        </div>

        {owing && (
          <div className="mb-4 flex items-center gap-x-5 gap-y-1 flex-wrap text-xs text-gray-600 dark:text-slate-300">
            <span className="font-semibold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1">Owed by age
              <HelpTip title="Owed by age"><p>What you owe, split by how old the supplier’s bill is (days since the bill date). The four amounts add up to “You owe now”.</p></HelpTip>
            </span>
            <span>0–30 days <b className="tabular-nums">{formatINR(st.ageing.d0_30)}</b></span>
            <span>31–60 <b className="tabular-nums">{formatINR(st.ageing.d31_60)}</b></span>
            <span>61–90 <b className="tabular-nums">{formatINR(st.ageing.d61_90)}</b></span>
            <span className={cn(st.ageing.d90_plus > 0.004 && 'text-red-700 dark:text-red-400')}>over 90 <b className="tabular-nums">{formatINR(st.ageing.d90_plus)}</b></span>
          </div>
        )}

        {st.unknown.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-[12px] text-amber-900 dark:text-amber-100">
            <b>{st.unknown.length} bill{st.unknown.length === 1 ? '' : 's'} ({formatINR(st.unknown.reduce((n, b) => n + b.total, 0))}) {st.unknown.length === 1 ? 'was' : 'were'} marked “part-paid” before payments were tracked</b>, so how much was paid is not known and
            {' '}{st.unknown.length === 1 ? 'it is' : 'they are'} left out of the figures above: {st.unknown.map((b) => b.invoice_number).join(', ')}. Open {st.unknown.length === 1 ? 'it' : 'each'} and enter what was already paid.
            <div className="mt-2"><button className="btn-ghost text-xs border border-amber-400" onClick={() => setOpenBill(st.unknown[0].invoice_id)}>Open {st.unknown[0].invoice_number}</button></div>
          </div>
        )}

        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-2 mb-1 flex items-center gap-1.5">Pending bills — oldest first
          <HelpTip title="Pending bills"><p>The bills you still owe money on, the oldest at the top — the ones to clear first. “Age” counts the days since the supplier’s bill date.</p></HelpTip>
        </h3>
        {st.pending.length === 0
          ? <div className="text-xs text-gray-500 dark:text-slate-400 py-2">No pending bills.</div>
          : <BillsTable bills={st.pending} onOpen={setOpenBill} showAge />}

        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-5 mb-1">Latest bills</h3>
        {st.latest.length === 0
          ? <div className="text-xs text-gray-500 dark:text-slate-400 py-2">No bills from this supplier yet.</div>
          : <BillsTable bills={st.latest} onOpen={setOpenBill} />}

        {/* The passbook */}
        <div className="flex items-end justify-between gap-3 flex-wrap mt-5 mb-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Passbook — every bill and payment
            <HelpTip title="Credit, debit and balance">
              <p><b>Credit</b> is a bill — what you owe the supplier. <b>Debit</b> is a payment — what you paid.</p>
              <p><b>Balance</b> is credit minus debit so far: what you owed after that line. The last balance is what you owe now.</p>
            </HelpTip>
          </h3>
          <div className="flex items-end gap-2 text-xs">
            <label className="flex flex-col"><span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">From</span><input type="date" className="input py-1" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex flex-col"><span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">To</span><input type="date" className="input py-1" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
            {(from || to) && <button className="btn-ghost text-xs" onClick={() => { setFrom(''); setTo(''); }}>All dates</button>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                <th className={TH}>Date</th>
                <th className={TH}>Particulars</th>
                <th className={cn(TH, 'text-right')}>Credit (bill)</th>
                <th className={cn(TH, 'text-right')}>Debit (paid)</th>
                <th className={cn(TH, 'text-right')}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.from && (
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40">
                  <td className="py-1.5 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(st.from)}</td>
                  <td className="py-1.5 text-xs italic text-gray-600 dark:text-slate-300">Brought forward</td>
                  <td></td><td></td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(st.brought_forward)}</td>
                </tr>
              )}
              {st.rows.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-gray-500 dark:text-slate-400">No bills or payments in this period.</td></tr>
              )}
              {st.rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-1.5 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="py-1.5 text-gray-900 dark:text-slate-100">
                    <button type="button" className="text-left hover:underline" onClick={() => setOpenBill(r.invoice_id)}>{r.particulars}</button>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.credit > 0 ? formatINR(r.credit) : ''}</td>
                  <td className="py-1.5 text-right tabular-nums text-green-700 dark:text-green-400">{r.debit > 0 ? formatINR(r.debit) : ''}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-slate-600 font-bold">
                <td className="py-2" colSpan={2}>Total{st.from || st.to ? ' for this period' : ''}</td>
                <td className="py-2 text-right tabular-nums">{formatINR(st.period.credit)}</td>
                <td className="py-2 text-right tabular-nums text-green-700 dark:text-green-400">{formatINR(st.period.debit)}</td>
                <td className="py-2 text-right tabular-nums">{formatINR(st.period.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
          Credit = a bill (what you owe). Debit = a payment (what you paid). Balance = credit − debit. Bills dated the same day as a payment come first.
        </p>
      </Modal>
      {openBill !== null && <PurchaseDetailModal id={openBill} onClose={() => setOpenBill(null)} />}
      {printing && <SupplierStatementPrint statement={st} onClose={() => setPrinting(false)} />}
    </>
  );
}
