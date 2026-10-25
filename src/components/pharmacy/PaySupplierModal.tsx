/**
 * Pay this supplier — ONE payment that settles their unpaid bills oldest-first (Wholesalers tab). The split shown here is the same one the main
 * process makes; it never pays more than a bill still owes. Tick fewer bills to pay only those. A bill marked "part-paid" before payments were
 * tracked has no recorded amount, so it cannot be settled from here (its own screen under Purchases asks what was already paid).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR, newRef, refFor, todayISO } from '../../lib/utils';
import { fromPaise, toPaise } from '../../lib/pharmacyMath';
import { Field } from './shared';

const toP = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? toPaise(n) : 0; };

export function PaySupplierModal({ supplier, onClose }: { supplier: { id: number; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [base] = useState(newRef);                       // one id per attempt: sending the same payment twice records it once
  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['purchases', 'unpaid-of', supplier.id],
    queryFn: () => window.electronAPI.purchases.list({ wholesaler_id: supplier.id, status: 'outstanding' }),
  });

  // Oldest first — the order the money is applied in.
  const known = useMemo(() => bills
    .filter((b) => b.outstanding != null && b.outstanding > 0.004)
    .sort((a, b) => (a.invoice_date < b.invoice_date ? -1 : a.invoice_date > b.invoice_date ? 1 : a.id - b.id)), [bills]);
  const unknown = bills.filter((b) => b.outstanding == null);
  const [off, setOff] = useState<Set<number>>(new Set());     // bills the person un-ticked
  const chosen = known.filter((b) => !off.has(b.id));
  const owedP = chosen.reduce((s, b) => s + toP(b.outstanding), 0);
  const allOwedP = known.reduce((s, b) => s + toP(b.outstanding), 0);

  const [typed, setTyped] = useState<string | null>(null);   // null = pay everything that is ticked
  const amountP = typed === null ? owedP : toP(typed);
  const [mode, setMode] = useState('Cash');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const split = useMemo(() => {
    let left = Math.max(0, amountP);
    return chosen.map((b) => {
      const owe = toP(b.outstanding);
      const pay = Math.min(owe, left);
      left -= pay;
      return { b, owe, pay };
    });
  }, [chosen, amountP]);

  const problem = chosen.length === 0 ? 'Tick at least one bill.'
    : !(amountP > 0) ? 'Enter the amount to pay.'
    : amountP > owedP ? `That is more than the ${formatINR(fromPaise(owedP))} owed on the ticked bills.`
    : '';

  const pay = useMutation({
    mutationFn: () => {
      const payload = {
        wholesaler_id: supplier.id, amount: fromPaise(amountP), invoice_ids: off.size ? chosen.map((b) => b.id) : undefined,
        mode, paid_on: paidOn, reference: reference.trim() || null, notes: notes.trim() || null,
      };
      return window.electronAPI.purchases.paySupplier({ ...payload, client_ref: refFor(base, payload) });
    },
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error); toast(r.error, 'error'); return; }
      for (const k of ['purchases', 'wholesalers-summary', 'supplier-report', 'purchase', 'supplier-statement', 'supplier-accounts']) qc.invalidateQueries({ queryKey: [k] });
      toast(r.duplicate ? 'That payment was already recorded.' : `Paid ${formatINR(r.paid)} to ${r.supplier} across ${r.allocations.length} bill${r.allocations.length === 1 ? '' : 's'}`);
      onClose();
    },
    onError: (e: any) => { setError(e?.message || 'Could not record the payment.'); toast(e?.message || 'Could not record the payment.', 'error'); },
  });

  return (
    <Modal open onClose={onClose} title={`Pay ${supplier.name}`} size="lg">
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-xs text-gray-500">Loading their bills…</div>
        ) : known.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 text-sm text-emerald-800 dark:text-emerald-200">
            Nothing is owed to {supplier.name} on bills whose payments are recorded.
            {unknown.length > 0 && <> {unknown.length} bill{unknown.length === 1 ? ' was' : 's were'} marked part-paid before payments were tracked — open {unknown.length === 1 ? 'it' : 'them'} under <b>Purchases</b> and enter what was paid.</>}
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 dark:text-slate-200">
              You owe <b className="text-red-700 dark:text-red-400">{formatINR(fromPaise(allOwedP))}</b> on {known.length} unpaid bill{known.length === 1 ? '' : 's'}. The payment is applied to the <b>oldest bill first</b>.
            </div>

            <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-800/60 sticky top-0">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      <th className="py-2 pl-3 w-8"></th>
                      <th className="py-2">Bill</th>
                      <th className="py-2">Date</th>
                      <th className="py-2 text-right">Still owed</th>
                      <th className="py-2 pr-3 text-right">Pays now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {known.map((b) => {
                      const on = !off.has(b.id);
                      const row = split.find((x) => x.b.id === b.id);
                      return (
                        <tr key={b.id} className={cn('border-t border-gray-100 dark:border-slate-800', !on && 'opacity-50')}>
                          <td className="py-1.5 pl-3">
                            <input type="checkbox" checked={on} aria-label={`Include ${b.invoice_number}`}
                              onChange={() => { setOff((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; }); setTyped(null); }} />
                          </td>
                          <td className="py-1.5 font-mono">{b.invoice_number}</td>
                          <td className="py-1.5 text-gray-500 dark:text-slate-400">{fmtDate(b.invoice_date)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatINR(b.outstanding as number)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {on && row && row.pay > 0
                              ? <><span className="font-semibold">{formatINR(fromPaise(row.pay))}</span>{row.pay === row.owe && <span className="ml-1 text-[10px] text-emerald-700 dark:text-emerald-300">clears</span>}</>
                              : <span className="text-gray-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {unknown.length > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                {unknown.length} more bill{unknown.length === 1 ? '' : 's'} (marked part-paid before payments were tracked) cannot be paid from here — open {unknown.length === 1 ? 'it' : 'them'} under <b>Purchases</b> and enter what was already paid.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Amount to pay (₹)">
                <input type="number" min={0} step="0.01" className="input text-right" autoFocus
                  value={typed ?? (owedP / 100).toFixed(2)} onChange={(e) => setTyped(e.target.value)} onFocus={(e) => e.target.select()} />
              </Field>
              <Field label="Paid by">
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option>Cash</option><option>Cheque</option><option>Bank</option><option>UPI</option>
                </select>
              </Field>
              <Field label="Date paid"><input type="date" className="input" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Reference"><input className="input" placeholder="cheque no. / UTR" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              <div className="col-span-2 md:col-span-4"><Field label="Note (optional)"><input className="input" maxLength={120} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
            </div>
          </>
        )}

        {(problem && known.length > 0) && <div className="text-[12px] text-red-600 dark:text-red-400" role="alert">{problem}</div>}
        {error && <div className="text-[12px] text-red-600 dark:text-red-400" role="alert">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>{known.length === 0 ? 'Close' : 'Cancel'}</button>
          {known.length > 0 && (
            <button className="btn-primary" disabled={!!problem || pay.isPending} onClick={() => { setError(''); pay.mutate(); }}>
              {pay.isPending ? 'Recording…' : `Pay ${formatINR(fromPaise(Math.max(0, amountP)))}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
