import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { AdminPasswordModal } from '../AdminPasswordModal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR, newRef, refFor, todayISO } from '../../lib/utils';
import { BillPictureLink } from './billImport/BillPictureLink';

/**
 * One purchase bill: what was bought and what each unit really cost, the totals, the payments made
 * to the supplier, and a form to record the next payment.
 *
 * "Recorded", "stocked" and "paid" are three different facts. The bill and its stock are saved
 * together; payment is recorded here, as many payments as it takes, and the amount still owed is
 * always total − payments. A bill marked "partly paid" before payments were tracked has no recorded
 * amount — it shows as unknown and asks for the earlier payment before accepting a new one.
 */
export function PurchaseDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: inv, isLoading } = useQuery({ queryKey: ['purchase', id], queryFn: () => window.electronAPI.purchases.get(id) });
  const { adminUnlocked } = useAuth();
  const [erasing, setErasing] = useState(false);          // administrator: delete this whole purchase bill

  const [base] = useState(newRef);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');

  const pay = useMutation({
    mutationFn: () => {
      const body = {
        amount: Number(amount), mode: mode || null, paid_on: paidOn, reference: reference.trim() || null,
        ...(inv && inv.amount_paid == null && inv.payments.length === 0 ? { opening_paid: Number(opening || 0) } : {}),
      };
      // The same payment sent twice is recorded once; an edited one is a different payment.
      return window.electronAPI.purchases.addPayment(id, { ...body, client_ref: refFor(base, body) });
    },
    onSuccess: (res) => {
      if (!res.ok) { setError(res.error); toast(res.error, 'error'); return; }
      for (const k of ['purchases', 'supplier-report', 'wholesalers-summary', 'supplier-statement', 'supplier-accounts']) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ['purchase', id] });
      setAmount(''); setReference(''); setOpening(''); setError('');
      toast(res.duplicate ? 'That payment was already recorded.' : 'Payment recorded');
    },
    onError: (e: any) => { setError(e?.message || 'Could not record the payment'); },
  });

  if (isLoading || !inv) {
    return <Modal open onClose={onClose} title="Purchase bill" size="lg"><div className="text-xs text-gray-500 p-4">Loading…</div></Modal>;
  }

  const unknown = inv.amount_paid == null && inv.payments.length === 0;
  const due = inv.outstanding ?? null;                 // null when the amount paid is unknown
  const settled = due !== null && due <= 0.004;
  const gstLabel = Number(inv.igst) > 0 ? 'IGST' : 'CGST + SGST';
  const gstAmount = Number(inv.igst) > 0 ? inv.igst : inv.cgst + inv.sgst;

  return (
    <Modal open onClose={onClose} title={`Purchase bill · ${inv.invoice_number}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div><div className="label">Wholesaler</div><div className="font-medium">{inv.wholesaler_name}</div><div className="text-[10px] font-mono text-gray-500">{inv.wholesaler_license_no}</div></div>
          <div><div className="label">Invoice date</div><div>{fmtDate(inv.invoice_date)}</div></div>
          <div><div className="label">Received</div><div>{inv.received_date ? fmtDate(inv.received_date) : '—'}</div></div>
          <div>
            <div className="label">Payment</div>
            <span className={cn('badge',
              inv.payment_status === 'paid' ? 'bg-green-100 text-green-700' : inv.payment_status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
              {inv.payment_status}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2">Drug</th>
                <th className="py-2">Batch</th>
                <th className="py-2">Expiry</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Free</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Disc</th>
                <th className="py-2 text-right">Cost / unit</th>
                <th className="py-2 text-right">MRP</th>
                <th className="py-2 text-right">Sell</th>
                <th className="py-2 text-right">Line ₹</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-1.5">{it.drug_name}</td>
                  <td className="py-1.5 font-mono">{it.batch_no}</td>
                  <td className="py-1.5">{fmtDate(it.expiry)}</td>
                  <td className="py-1.5 text-right">{it.qty_received}</td>
                  <td className="py-1.5 text-right">{it.free_qty || '—'}</td>
                  <td className="py-1.5 text-right">{formatINR(it.purchase_price)}</td>
                  <td className="py-1.5 text-right">{Number(it.discount_amount) > 0 ? formatINR(it.discount_amount ?? 0) : '—'}</td>
                  <td className="py-1.5 text-right font-semibold">{it.unit_cost != null ? formatINR(it.unit_cost) : '—'}</td>
                  <td className="py-1.5 text-right">{formatINR(it.mrp)}</td>
                  <td className="py-1.5 text-right">{it.selling_price != null ? formatINR(it.selling_price) : <span className="text-gray-400">= MRP</span>}</td>
                  <td className="py-1.5 text-right font-semibold">{formatINR(it.taxable_value ?? it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-3 bg-gray-50 dark:bg-slate-900 text-xs space-y-0.5">
            <div className="flex justify-between"><span>Goods (at supplier rates)</span><span>{formatINR(inv.subtotal)}</span></div>
            {inv.discount > 0 && <div className="flex justify-between text-emerald-700 dark:text-emerald-300"><span>Discounts</span><span>− {formatINR(inv.discount)}</span></div>}
            <div className="flex justify-between"><span>{gstLabel}</span><span>{formatINR(gstAmount)}</span></div>
            {Number(inv.other_charges) > 0 && <div className="flex justify-between"><span>Freight / other charges</span><span>{formatINR(inv.other_charges ?? 0)}</span></div>}
            {Number(inv.round_off) !== 0 && <div className="flex justify-between"><span>Round-off</span><span>{formatINR(inv.round_off ?? 0)}</span></div>}
            <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-gray-300 dark:border-slate-700 mt-1"><span>Total</span><span>{formatINR(inv.total)}</span></div>
            <div className="flex justify-between pt-1"><span>Paid so far</span><span>{inv.amount_paid == null ? <span className="text-amber-700 dark:text-amber-300">unknown</span> : formatINR(inv.amount_paid)}</span></div>
            <div className="flex justify-between font-semibold">
              <span>Still to pay</span>
              <span className={cn(due === null ? 'text-amber-700 dark:text-amber-300' : settled ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
                {due === null ? 'unknown' : settled ? 'Nothing' : formatINR(due)}
              </span>
            </div>
            <div className="pt-1 text-[10px] text-gray-500 dark:text-slate-400">
              {inv.gst_in_cost ? 'GST on this bill is part of the stock cost (not claimed back).' : 'GST on this bill is claimed back, so it is not part of the stock cost.'}
            </div>
          </div>

          <div>
            <div className="label">Payments to the supplier</div>
            {inv.payments.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 italic py-1">{unknown ? 'None recorded — this bill was marked part-paid before payments were tracked.' : 'No payment recorded yet.'}</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-1">{fmtDate(p.paid_on)}</td>
                      <td className="py-1">{p.payment_mode || '—'}{p.reference ? <span className="text-gray-500"> · {p.reference}</span> : null}</td>
                      <td className="py-1 text-right font-semibold">{formatINR(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {!settled && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-sm font-semibold">Record a payment</div>
            {unknown && (
              <div className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>This bill was marked “partly paid” before payments were tracked, so how much was paid earlier is unknown. Enter it below (use 0 if nothing was paid), then the new payment.</div>
              </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {unknown && (
                <div><label className="label">Already paid before (₹)</label><input type="number" min={0} step="0.01" className="input text-right" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
              )}
              <div><label className="label">Amount (₹)</label>
                <input type="number" min={0} step="0.01" className="input text-right" value={amount} placeholder={due !== null ? String(due) : ''} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div><label className="label">Mode</label>
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option>Cash</option><option>Cheque</option><option>Bank</option><option>UPI</option>
                </select>
              </div>
              <div><label className="label">Paid on</label><input type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
              <div><label className="label">Reference</label><input className="input" placeholder="cheque / UTR (optional)" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
            {error && <div className="text-xs text-red-700 dark:text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              {due !== null && due > 0 && (
                <button className="btn-secondary text-xs" onClick={() => setAmount(String(due))}>Fill the full ₹{due.toFixed(2)}</button>
              )}
              <button
                className="btn-primary"
                disabled={pay.isPending || !(Number(amount) > 0) || (unknown && opening === '')}
                onClick={() => { setError(''); pay.mutate(); }}
              >
                {pay.isPending ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          </div>
        )}

        {inv.notes && <div className="text-xs text-gray-600 dark:text-slate-300"><span className="label">Notes</span> {inv.notes}</div>}
        {inv.scan_path && <div><BillPictureLink path={inv.scan_path} /></div>}
        <div className="flex items-center justify-between gap-2">
          <div>
            {adminUnlocked && (
              <button className="btn-ghost text-xs text-red-600 hover:text-red-700" onClick={() => setErasing(true)} title="Delete this whole purchase bill (admin password)">
                <Trash2 className="w-3.5 h-3.5" /> Delete this purchase bill
              </button>
            )}
          </div>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {erasing && (
        <AdminPasswordModal
          title="Delete this purchase bill?" confirmLabel="Delete this purchase bill" onClose={() => setErasing(false)}
          onConfirm={async (pw) => {
            const r = await window.electronAPI.admin.deletePurchase(id, pw);
            if (r.ok) {
              for (const k of ['purchases', 'purchase', 'pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-alerts', 'pharmacy-clinic-stock', 'wholesalers-summary', 'pharmacy-batches', 'supplier-report', 'pharmacy-valuation', 'drug-price-history', 'supplier-statement', 'supplier-accounts']) qc.invalidateQueries({ queryKey: [k] });
              toast(`Purchase bill ${r.purchase?.invoice_number ?? inv.invoice_number} deleted`);
              onClose();
            }
            return r;
          }}
        >
          <div>
            Permanently delete purchase bill <span className="font-bold">{inv.invoice_number}</span> from <span className="font-bold">{inv.wholesaler_name}</span> ({fmtDate(inv.invoice_date)}, {formatINR(inv.total)})?
          </div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            This takes the {inv.items.reduce((a, x) => a + Number(x.qty_received) + Number(x.free_qty || 0), 0)} unit{inv.items.reduce((a, x) => a + Number(x.qty_received) + Number(x.free_qty || 0), 0) === 1 ? '' : 's'} it brought in
            off the shelf — units already sold stay sold (those sales are not touched) — and removes its {inv.items.length} line{inv.items.length === 1 ? '' : 's'}
            {inv.payments.length > 0 ? <> and its {inv.payments.length} payment record{inv.payments.length === 1 ? '' : 's'} ({formatINR(inv.payments.reduce((a, x) => a + Number(x.amount), 0))} paid to the supplier leaves the books with it)</> : null}.
            What you owe {inv.wholesaler_name} drops by what is no longer billed. A copy of the bill is kept in the audit log. Cannot be undone.
          </div>
        </AdminPasswordModal>
      )}
    </Modal>
  );
}
