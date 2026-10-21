/**
 * Cancel a wrongly raised bill. Asks for the reason (recorded with who did it) and, when money was received, says it will be
 * refunded — the refund is written as a matching negative payment so the till reads true on both days.
 */
import { useState } from 'react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { formatINR } from '../../lib/utils';

export function CancelBillModal({ billId, label, received, onClose, onDone }: {
  billId: number; label: string; received: number; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.billing.cancel(billId, reason.trim(), received > 0 ? mode : null);
      if (r.ok) { toast(r.refunded > 0 ? `${r.bill_number} cancelled — ${formatINR(r.refunded)} to give back` : `${r.bill_number} cancelled`); onDone(); }
      else toast(r.error, 'error');
    } catch (e: any) { toast(e?.message || 'Could not cancel the bill', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Cancel this bill" size="sm">
      <div className="space-y-3">
        <div className="text-[13px] text-gray-700 dark:text-slate-300">
          {label}. A cancelled bill is not counted as income and takes no more payments. It stays on record, marked cancelled.
        </div>
        {received > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
            <b>{formatINR(received)}</b> was received on this bill. Cancelling it records a refund of that amount — give it back to the patient.
            <div className="flex gap-2 mt-2">
              {['Cash', 'Card', 'UPI'].map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`px-3 py-1 text-xs rounded-md border ${mode === m ? 'bg-amber-600 text-white border-amber-600' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200'}`}>
                  Refunded by {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="label">Why is it being cancelled?</label>
          <input className="input" autoFocus maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. billed to the wrong patient" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Keep the bill</button>
          <button className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? 'Cancelling…' : 'Cancel the bill'}</button>
        </div>
      </div>
    </Modal>
  );
}
