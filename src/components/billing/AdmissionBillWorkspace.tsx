/**
 * The biller's workspace for one admission's bill.
 *
 * Clicking an admission in Billing used to open the clinical IPD record — vitals,
 * medications, nursing notes — with the bill as a read-only sidebar. That is the
 * right screen for a ward nurse and the wrong one for the person at the counter:
 * a biller could see the amount but could not change a single thing about it.
 * Every real counter task — correcting a charge, adding one the ward forgot,
 * giving a discount, taking part payment, printing the invoice — meant leaving
 * the app or asking someone else.
 *
 * This is that missing screen. It edits the SAME bill the ward and the discharge
 * flow use, so there is still exactly one bill per admission no matter which door
 * you came through.
 *
 * What it deliberately does NOT do: rewrite a settled bill. Once money has been
 * received, or the bill is cancelled or frozen at discharge, editing is closed off
 * and the reason is stated on screen — a paid invoice that silently changes is an
 * accounting problem, not a convenience.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, Plus, Trash2, Printer, IndianRupee, Loader2, Percent, Wallet, Lock, AlertTriangle,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, formatINR, fmtDateTime } from '../../lib/utils';
import { BillPrint } from './BillPrint';

type Line = { id: number; description: string; qty: number; rate: number; amount: number; source?: string; head_name?: string };

export function AdmissionBillWorkspace({ admissionId, onClose }: { admissionId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['bill-preview', admissionId],
    queryFn: () => window.electronAPI.billing.previewAdmission(admissionId),
  });
  const { data: heads = [] } = useQuery({
    queryKey: ['charge-heads', 'ipd'],
    queryFn: () => window.electronAPI.chargeHeads.list('ipd'),
  });

  const bill = data?.bill;
  const items: Line[] = data?.items || [];
  const totals = data?.totals || { subtotal: 0, discountValue: 0, total: 0 };
  const advance = data?.advanceAvailable ?? 0;
  const paid = data?.amountPaid ?? 0;
  const balance = data?.balanceDue ?? 0;

  // A settled bill is a record, not a draft.
  const lockedReason =
    bill?.status === 'cancelled' ? 'This bill was cancelled.'
    : bill?.cancelled_at ? 'This bill was cancelled.'
    : bill?.finalized_at ? 'This bill was frozen when the patient was discharged.'
    : bill?.status === 'paid' ? 'This bill has been settled in full.'
    : null;
  // NOTE: a part payment must NOT lock the bill. An IPD family often pays in
  // instalments during the stay, and the ward keeps adding charges after each
  // one. Locking on `paid > 0` meant the first ₹5,000 froze the bill and every
  // later medicine, test and bed-day had to go on a second bill.
  
  const locked = !!lockedReason;

  const after = (r: any, okMsg: string) => {
    if (r && r.ok === false) { toast(r.error || 'That did not work', 'error'); return false; }
    qc.invalidateQueries({ queryKey: ['bill-preview', admissionId] });
    qc.invalidateQueries({ queryKey: ['bill-admissions'] });
    refetch();
    toast(okMsg, 'success');
    return true;
  };

  // ---- new line ----
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');
  const [headId, setHeadId] = useState<string>('');

  const addLine = async () => {
    if (!desc.trim()) return toast('Type what the charge is for', 'error');
    const q = Number(qty) || 1;
    const r = Number(rate) || 0;
    setBusy('add');
    try {
      const res = await window.electronAPI.billing.addItem(bill.id, {
        description: desc.trim(), qty: q, rate: r, amount: q * r,
        charge_head_id: headId ? Number(headId) : null, source: 'manual',
      }, user?.username);
      if (after(res, `Added “${desc.trim()}” — ${formatINR(q * r)}`)) {
        setDesc(''); setQty('1'); setRate(''); setHeadId('');
      }
    } catch (e: any) { toast(e?.message || 'Could not add the line', 'error'); }
    finally { setBusy(null); }
  };

  const removeLine = async (l: Line) => {
    if (!window.confirm(`Remove “${l.description}” (${formatINR(l.amount)}) from this bill?`)) return;
    setBusy(`rm${l.id}`);
    try { after(await window.electronAPI.billing.removeItem(l.id), `Removed “${l.description}”`); }
    catch (e: any) { toast(e?.message || 'Could not remove the line', 'error'); }
    finally { setBusy(null); }
  };

  // ---- discount ----
  const [discVal, setDiscVal] = useState('');
  const [discType, setDiscType] = useState<'flat' | 'percent'>('flat');
  const [discReason, setDiscReason] = useState('');

  const applyDiscount = async () => {
    const amt = Number(discVal) || 0;
    setBusy('disc');
    try {
      const res = await window.electronAPI.billing.setDiscount(
        bill.id, amt, discType, String(user?.role || 'receptionist'), discReason.trim() || undefined, user?.username
      );
      if (after(res, amt > 0 ? `Discount applied — ${discType === 'percent' ? `${amt}%` : formatINR(amt)}` : 'Discount cleared')) {
        setDiscReason('');
      }
    } catch (e: any) { toast(e?.message || 'Could not apply the discount', 'error'); }
    finally { setBusy(null); }
  };

  // ---- refund (when the advance exceeds the bill) ----
  const { data: advList } = useQuery({
    queryKey: ['advances', admissionId],
    queryFn: () => window.electronAPI.billing.advancesList(admissionId),
  });
  const refundable = ((advList as any)?.rows || []).filter((r: any) => Number(r.refundable) > 0.5);

  const doRefund = async (adv: any) => {
    const amt = Number(adv.refundable) || 0;
    if (amt <= 0) return;
    if (!window.confirm(`Refund ${formatINR(amt)} from this advance receipt?\n\nThis records the money going back to the patient.`)) return;
    setBusy(`ref${adv.id}`);
    try {
      after(
        await window.electronAPI.billing.refundAdvance(adv.id, amt, 'Advance exceeded the final bill', user?.username),
        `Refunded ${formatINR(amt)}`,
      );
      qc.invalidateQueries({ queryKey: ['advances', admissionId] });
    } catch (e: any) { toast(e?.message || 'Could not record the refund', 'error'); }
    finally { setBusy(null); }
  };

  // ---- payment ----
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('Cash');

  const takePayment = async () => {
    const amt = Number(payAmt) || 0;
    if (amt <= 0) return toast('Enter how much is being paid', 'error');
    setBusy('pay');
    try {
      const res = await window.electronAPI.billing.pay(bill.id, amt, payMode, user?.username);
      if (after(res, `Received ${formatINR(amt)} by ${payMode}`)) setPayAmt('');
    } catch (e: any) { toast(e?.message || 'Could not record the payment', 'error'); }
    finally { setBusy(null); }
  };

  if (printing && bill?.id) return <BillPrint billId={bill.id} onClose={() => setPrinting(false)} />;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl my-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-slate-700">
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900 dark:text-slate-100 truncate">
              {data?.patient_name || bill?.patient_name || 'Admission bill'}
            </div>
            <div className="text-[11.5px] text-gray-500 dark:text-slate-400">
              {bill?.bill_number ? <span className="font-mono">{bill.bill_number}</span> : 'Bill not raised yet'}
              {bill?.created_at ? ` · opened ${fmtDateTime(bill.created_at)}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn-secondary text-xs" onClick={() => setPrinting(true)} disabled={!bill?.id}>
              <Printer className="w-3.5 h-3.5" /> Print bill
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {locked && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
              <b>This bill can no longer be edited.</b> {lockedReason} You can still print it. To correct something,
              raise a separate bill for the difference rather than changing a settled record.
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="p-8 text-center text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading the bill…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
            {/* ---------- LINES ---------- */}
            <div className="lg:col-span-2 space-y-3">
              <div className="text-[11px] uppercase tracking-wide font-bold text-gray-500 dark:text-slate-400">Charges</div>
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-slate-800/60">
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3 text-right w-16">Qty</th>
                      <th className="py-2 px-3 text-right w-24">Rate</th>
                      <th className="py-2 px-3 text-right w-28">Amount</th>
                      <th className="py-2 px-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-xs text-gray-500">
                        Nothing on this bill yet. Add the first charge below.
                      </td></tr>
                    )}
                    {items.map((l) => (
                      <tr key={l.id} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="py-2 px-3">
                          <div className="text-gray-900 dark:text-slate-100">{l.description}</div>
                          {(l.head_name || l.source) && (
                            <div className="text-[10px] text-gray-400">
                              {l.head_name || ''}{l.head_name && l.source ? ' · ' : ''}
                              {l.source && l.source !== 'manual' ? `auto — ${l.source}` : l.source === 'manual' ? 'added here' : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.qty}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{formatINR(l.rate)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatINR(l.amount)}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => removeLine(l)}
                            disabled={locked || busy === `rm${l.id}`}
                            title={locked ? lockedReason! : `Remove ${l.description}`}
                            className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400">
                            {busy === `rm${l.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add a charge */}
              {!locked && (
                <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 p-3">
                  <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 mb-2">Add a charge</div>
                  <div className="grid grid-cols-12 gap-2">
                    <input className="input col-span-12 sm:col-span-5" placeholder="What is this charge for?"
                      value={desc} onChange={(e) => setDesc(e.target.value)} />
                    <select className="input col-span-6 sm:col-span-3" value={headId}
                      onChange={(e) => {
                        setHeadId(e.target.value);
                        const h = heads.find((x: any) => String(x.id) === e.target.value);
                        if (h) { if (!desc.trim()) setDesc(h.name); if (h.default_rate) setRate(String(h.default_rate)); }
                      }}>
                      <option value="">Category…</option>
                      {heads.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                    <input className="input col-span-3 sm:col-span-1 text-right" inputMode="numeric" placeholder="Qty"
                      value={qty} onChange={(e) => setQty(e.target.value)} />
                    <input className="input col-span-3 sm:col-span-2 text-right" inputMode="decimal" placeholder="Rate"
                      value={rate} onChange={(e) => setRate(e.target.value)} />
                    <button className="btn-primary col-span-12 sm:col-span-1 justify-center" onClick={addLine} disabled={busy === 'add'}>
                      {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                  {(Number(qty) || 0) > 0 && (Number(rate) || 0) > 0 && (
                    <div className="text-[11px] text-gray-500 mt-1.5">
                      Adds <b>{formatINR((Number(qty) || 0) * (Number(rate) || 0))}</b> to the bill.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ---------- MONEY ---------- */}
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3">
                <Row label="Subtotal" value={formatINR(totals.subtotal)} />
                {/* The engine calls it discountValue; reading `discount` silently
                    rendered nothing, so an applied discount never showed here. */}
                {totals.discountValue > 0 && <Row label="Discount" value={`− ${formatINR(totals.discountValue)}`} tone="text-amber-600" />}
                <div className="border-t border-gray-200 dark:border-slate-700 my-1.5" />
                <Row label="Total" value={formatINR(totals.total)} bold />
                {advance > 0 && <Row label="Advance held" value={formatINR(advance)} tone="text-blue-600" />}
                <Row label="Received" value={formatINR(paid)} tone="text-emerald-600" />
                <div className="border-t border-gray-200 dark:border-slate-700 my-1.5" />
                {balance < -0.5 ? (
                  <Row label="Refund due to patient" value={formatINR(Math.abs(balance))} bold tone="text-blue-600" />
                ) : (
                  <Row label="Balance due" value={formatINR(Math.max(0, balance))} bold
                    tone={balance > 0.5 ? 'text-red-600' : 'text-emerald-600'} />
                )}
              </div>

              {/* Discount */}
              {!locked && (
                <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 space-y-2">
                  <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5" /> Discount
                  </div>
                  <div className="flex gap-2">
                    <input className="input flex-1 text-right" inputMode="decimal" placeholder="0"
                      value={discVal} onChange={(e) => setDiscVal(e.target.value)} />
                    <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600">
                      {(['flat', 'percent'] as const).map((t) => (
                        <button key={t} onClick={() => setDiscType(t)}
                          className={cn('px-2.5 text-[11px] font-semibold',
                            discType === t ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300')}>
                          {t === 'flat' ? '₹' : '%'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input className="input" placeholder="Reason (may be required)"
                    value={discReason} onChange={(e) => setDiscReason(e.target.value)} />
                  <button className="btn-secondary text-xs w-full justify-center" onClick={applyDiscount} disabled={busy === 'disc'}>
                    {busy === 'disc' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Apply discount
                  </button>
                  <p className="text-[10.5px] text-gray-400 leading-relaxed">
                    Your role has a maximum discount set in Settings → Billing. Going over it is refused with the limit named.
                  </p>
                </div>
              )}

              {/* Payment */}
              {!locked && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 p-3 space-y-2">
                  <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5" /> Take payment
                  </div>
                  <div className="flex gap-2">
                    <input className="input flex-1 text-right" inputMode="decimal" placeholder={String(Math.max(0, Math.round(balance)))}
                      value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                    <select className="input w-24" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                      <option>Cash</option><option>Card</option><option>UPI</option><option>Bank</option>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="btn-ghost text-[11px] flex-1" onClick={() => setPayAmt(String(Math.max(0, Math.round(balance))))}>
                      Full balance
                    </button>
                    <button className="btn-success text-xs flex-1 justify-center" onClick={takePayment} disabled={busy === 'pay'}>
                      {busy === 'pay' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <IndianRupee className="w-3.5 h-3.5" />} Receive
                    </button>
                  </div>
                  <p className="text-[10.5px] text-emerald-800/70 dark:text-emerald-200/70">
                    Part payments are fine — the balance updates and the patient can pay the rest later.
                  </p>
                </div>
              )}

              {balance > 0.5 && !locked && (
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-900/20 p-2.5 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-red-800 dark:text-red-200">
                    <b>{formatINR(balance)}</b> still outstanding on this admission.
                  </span>
                </div>
              )}

              {balance < -0.5 && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-900/20 p-2.5 flex items-start gap-2">
                  <Wallet className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-blue-900 dark:text-blue-100 leading-relaxed">
                    The advance is <b>{formatINR(Math.abs(balance))}</b> more than the bill —
                    this much is <b>owed back to the patient</b>.
                  </span>
                </div>
              )}

              {/* The refund itself. advances:refund existed all along but nothing
                  could reach it, so the app announced a refund and offered no way
                  to make one. */}
              {refundable.length > 0 && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 p-3 space-y-2">
                  <div className="text-[11px] font-bold text-blue-800 dark:text-blue-200">Refund an advance</div>
                  {refundable.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="text-gray-600 dark:text-slate-300">
                        {fmtDateTime(r.created_at)}{r.mode ? ` · ${r.mode}` : ''}
                        <span className="text-gray-400"> · {formatINR(r.amount)} received</span>
                      </span>
                      <button className="btn-secondary text-[11px] py-1 px-2 shrink-0"
                        disabled={busy === `ref${r.id}`} onClick={() => doRefund(r)}>
                        {busy === `ref${r.id}` ? '…' : `Refund ${formatINR(r.refundable)}`}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={cn('text-[12px]', bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400')}>{label}</span>
      <span className={cn('tabular-nums text-[12.5px]', bold ? 'font-bold' : '', tone || 'text-gray-900 dark:text-slate-100')}>{value}</span>
    </div>
  );
}
