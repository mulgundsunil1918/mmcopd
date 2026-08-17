/**
 * Move an admitted patient to a different bed — or a different ward.
 *
 * The backend has supported this since IPD was built (`ip:transfer`, with a
 * `bed_transfers` audit trail), and Settings even asks how to bill a mid-day
 * ward change. But no screen ever called it, so the clinic could configure the
 * billing rule for something it had no way to do. A patient stepping up from a
 * general bed to ICU — routine, and exactly when the daily rate changes — could
 * only be handled by discharging and re-admitting them, which breaks the running
 * bill and the admission number.
 *
 * Rates are shown against every destination because the move changes what the
 * patient pays per day, and the person doing it should see that before, not
 * discover it on the final bill.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Loader2, BedDouble } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, formatINR } from '../../lib/utils';

export function TransferBedModal({ admission, onClose, onDone }: {
  admission: any; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<any | null>(null);
  const [reason, setReason] = useState('');

  const { data: beds = [], isLoading } = useQuery({
    queryKey: ['beds-map'],
    queryFn: () => window.electronAPI.beds.map(),
  });

  // Only beds that can actually receive a patient: free, active, not this one.
  const available = (beds as any[]).filter(
    (b) => b.status === 'free' && b.id !== admission.bed_id && b.is_active !== 0
  );
  const byWard = available.reduce((acc: Record<string, any[]>, b) => {
    (acc[b.ward_name] ||= []).push(b);
    return acc;
  }, {});

  const currentRate = Number(admission.per_day_rate ?? 0);
  const newRate = Number(target?.per_day_rate ?? 0);
  const rateChanges = !!target && newRate !== currentRate;

  const submit = async () => {
    if (!target) return toast('Pick the bed to move this patient to', 'error');
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.transfer(
        admission.id, target.id, reason.trim() || undefined, user?.username
      );
      if (r.ok) {
        toast(`Moved to ${target.ward_name} / ${target.bed_number}`, 'success');
        qc.invalidateQueries({ queryKey: ['beds-map'] });
        qc.invalidateQueries({ queryKey: ['ip-admissions'] });
        qc.invalidateQueries({ queryKey: ['bill-preview', admission.id] });
        qc.invalidateQueries({ queryKey: ['bill-admissions'] });
        onDone();
      } else {
        toast(r.error || 'Could not move the patient', 'error');   // backend message verbatim
      }
    } catch (e: any) {
      toast(e?.message || 'Could not move the patient', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Move ${admission.patient_name} to another bed`} size="lg">
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 dark:bg-slate-800/60 p-2.5 text-[12px] text-gray-600 dark:text-slate-300 flex items-center gap-2 flex-wrap">
          <BedDouble className="w-4 h-4 text-gray-400" />
          <span>Currently in <b>{admission.ward || '—'} / {admission.bed_number || '—'}</b></span>
          {currentRate > 0 && <span className="text-gray-400">· {formatINR(currentRate)}/day</span>}
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading beds…</div>
        ) : available.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-700 p-6 text-center text-[12px] text-gray-500">
            No free beds anywhere. Free up or unblock a bed first — a patient can only move into a bed marked <b>free</b>.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {Object.entries(byWard).map(([wardName, list]) => (
              <div key={wardName}>
                <div className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-slate-400 mb-1.5">
                  {wardName}
                  {Number((list as any[])[0]?.per_day_rate) > 0 && (
                    <span className="font-normal normal-case text-gray-400"> · {formatINR((list as any[])[0].per_day_rate)}/day</span>
                  )}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(list as any[]).map((b) => (
                    <button key={b.id} type="button" onClick={() => setTarget(b)}
                      className={cn('rounded-lg border-2 py-2 text-[12px] font-bold transition',
                        target?.id === b.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
                          : 'border-gray-200 dark:border-slate-700 hover:border-blue-400 text-gray-800 dark:text-slate-200')}>
                      {b.bed_number}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {rateChanges && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[11.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
            <b>The daily rate changes: {formatINR(currentRate)} → {formatINR(newRate)}.</b> How today itself is charged
            follows your setting in <span className="font-mono">Settings → Billing &amp; IPD → &ldquo;If a patient moves ward mid-day&rdquo;</span>.
            From tomorrow the new ward&rsquo;s rate applies.
          </div>
        )}

        <div>
          <label className="label">Reason (optional, kept in the record)</label>
          <input className="input" placeholder="e.g. Shifted to ICU — needs monitoring"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!target || busy} onClick={submit}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            {target ? `Move to ${target.ward_name} / ${target.bed_number}` : 'Move patient'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
