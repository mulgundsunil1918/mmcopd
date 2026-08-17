/**
 * Final-bill review + discharge approval (step 2 of the discharge flow).
 *
 * Shown on an admission whose discharge has been REQUESTED by the doctor. The
 * patient is still admitted and the bed is still occupied — nothing is final
 * until someone approves here. If money is still outstanding, approving requires
 * a written reason, which is stored on the admission and audit-logged.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Loader2, Undo2, IndianRupee } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { formatINR } from '../../lib/utils';

export function DischargeApproval({ admission, onDone }: { admission: any; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [override, setOverride] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: preview } = useQuery({
    queryKey: ['bill-preview', admission.id],
    queryFn: () => window.electronAPI.billing.previewAdmission(admission.id),
    refetchInterval: 15_000,
  });

  const total = Number(preview?.bill?.total ?? 0);
  const advance = Number(preview?.advanceAvailable ?? 0);
  const paid = Number(preview?.amountPaid ?? 0);
  const balance = Number(preview?.balanceDue ?? 0);
  const owes = balance > 0.5;

  const approve = async () => {
    if (owes && !override.trim()) { setShowOverride(true); toast('Collect the balance, or give a reason to discharge anyway', 'error'); return; }
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.approveDischarge(admission.id, {
        by: user?.display_name || user?.username || 'staff',
        override_reason: override.trim() || undefined,
      });
      if (r.ok) {
        toast(r.overridden ? 'Discharged with balance outstanding (logged)' : 'Discharged — bill settled', 'success');
        qc.invalidateQueries();
        onDone();
      } else if ((r as any).needsOverride) {
        setShowOverride(true);
        toast(r.error || 'A balance is still due', 'error');
      } else {
        toast(r.error || 'Could not approve', 'error');
      }
    } catch (e: any) { toast(e?.message || 'Could not approve', 'error'); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (!window.confirm('Cancel the discharge request? The patient stays admitted and charges keep accruing.')) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.cancelDischargeRequest(admission.id, user?.display_name || undefined);
      if (r.ok) { toast('Discharge request cancelled', 'info'); qc.invalidateQueries(); onDone(); }
      else toast(r.error || 'Failed', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 p-4">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <div className="text-[13px] font-bold text-amber-900 dark:text-amber-100">Discharge requested — final bill review</div>
      </div>
      <p className="text-[11.5px] text-amber-800/90 dark:text-amber-200/90 mb-3">
        The doctor has completed the summary. Check the bill below (you can still add or edit items),
        then approve to discharge the patient and free the bed.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {[
          { l: 'Bill total', v: total, c: 'text-gray-900 dark:text-slate-100' },
          { l: 'Advance', v: advance, c: 'text-blue-700 dark:text-blue-300' },
          { l: 'Paid', v: paid, c: 'text-emerald-700 dark:text-emerald-300' },
          { l: 'Balance due', v: balance, c: owes ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300' },
        ].map((k) => (
          <div key={k.l} className="rounded-lg bg-white/70 dark:bg-slate-900/50 px-2.5 py-1.5">
            <div className="text-[9.5px] uppercase tracking-wider text-gray-500 dark:text-slate-400">{k.l}</div>
            <div className={`text-[13px] font-bold tabular-nums ${k.c}`}>{formatINR(k.v)}</div>
          </div>
        ))}
      </div>

      {owes && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2.5 mb-3">
          <div className="text-[12px] font-semibold text-red-800 dark:text-red-200 inline-flex items-center gap-1.5">
            <IndianRupee className="w-3.5 h-3.5" /> {formatINR(balance)} still outstanding
          </div>
          <div className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">
            Collect the payment on the bill (Record payment), or approve anyway with a reason below.
          </div>
          {showOverride && (
            <input
              className="input mt-2 text-[12px]"
              placeholder="Reason for discharging with a balance (required)"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            />
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary text-xs" disabled={busy} onClick={approve}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {owes ? 'Approve & discharge anyway' : 'Approve & discharge'}
        </button>
        <button className="btn-ghost text-xs" disabled={busy} onClick={cancelRequest}>
          <Undo2 className="w-3.5 h-3.5" /> Cancel request
        </button>
      </div>
    </div>
  );
}
