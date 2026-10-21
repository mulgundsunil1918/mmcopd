/**
 * Take a payment against something that is owed: a bill, or a pharmacy sale that was made on credit.
 *
 * One dialog for every place that collects money later (the patient portal, Receivables, the Pharmacy sales list), so the
 * rules are the same everywhere: more than is owed is refused with the figure, and a repeated click is one payment.
 */
import { useRef, useState } from 'react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, formatINR, newRef, refFor } from '../../lib/utils';

/** What a payment is taken against: a bill, or a pharmacy sale that was made on credit. */
export type CollectTarget = { billId: number; saleId?: null } | { saleId: number; billId?: null };

export function CollectPaymentModal({ target, label, due, onClose, onDone }: {
  target: CollectTarget; label: string; due: number; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [amount, setAmount] = useState(String(due));
  const [mode, setMode] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const base = useRef(newRef());                       // one id per sitting of this dialog; see refFor
  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt > 0 && amt <= due + 0.001;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const ref = refFor(base.current, { target, amt, mode });
      const r = target.saleId
        ? await window.electronAPI.pharmacy.payCredit(target.saleId, { amount: amt, mode, client_ref: ref })
        : await window.electronAPI.billing.pay(target.billId!, amt, mode, user?.username, ref);
      if (r.ok) {
        toast(r.duplicate ? 'That payment was already recorded' : `${formatINR(amt)} received`);
        onDone();
      } else {
        toast(r.error || 'Could not record the payment', 'error');
      }
    } catch (e: any) {
      toast(e?.message || 'Could not record the payment', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Collect payment" size="sm">
      <div className="space-y-3">
        <div className="text-[13px] text-gray-700 dark:text-slate-300">
          {label} — <b>{formatINR(due)}</b> still due.
        </div>
        <div>
          <label className="label">Amount received (₹)</label>
          <div className="flex gap-2">
            <input className="input text-right" type="number" min={0} step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button type="button" className="btn-secondary text-xs whitespace-nowrap" onClick={() => setAmount(String(due))}>Full due</button>
          </div>
          {!valid && amount !== '' && (
            <div className="text-[11px] text-red-600 mt-1">
              {amt > due ? `That is more than the ${formatINR(due)} still due.` : 'Enter an amount above zero.'}
            </div>
          )}
        </div>
        <div>
          <label className="label">Paid by</label>
          <div className="flex gap-2">
            {['Cash', 'Card', 'UPI'].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn('px-3 py-1.5 text-xs rounded-md border',
                  mode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200')}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : 'Record payment'}</button>
        </div>
      </div>
    </Modal>
  );
}
