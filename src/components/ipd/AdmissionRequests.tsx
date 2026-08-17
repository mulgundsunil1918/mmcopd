import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Loader2, Check, X, Clock, AlertTriangle } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, fmtDateTime } from '../../lib/utils';
import { promptDialog } from '../../lib/promptDialog';

/**
 * Doctor raises an admission request; reception approves it and picks the bed.
 * Admission authority stays with reception — the request just initiates.
 */

const URGENCY: Record<string, { label: string; cls: string }> = {
  emergency: { label: 'Emergency', cls: 'bg-red-100 text-red-700' },
  urgent: { label: 'Urgent', cls: 'bg-amber-100 text-amber-700' },
  routine: { label: 'Routine', cls: 'bg-gray-100 text-gray-600' },
};

/** Button + modal a doctor uses to request admission for a patient. */
export function RequestAdmissionButton({ patient, doctorId, className }: { patient: any; doctorId?: number | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border-2 transition',
          'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-500',
          'dark:border-amber-700 dark:bg-amber-900/25 dark:text-amber-200 dark:hover:bg-amber-900/40',
          className,
        )}
        onClick={() => setOpen(true)}
        title="Ask reception to admit this patient — they assign the ward and bed"
      >
        <BedDouble className="w-3.5 h-3.5" /> Request Admission
      </button>
      {open && <RequestModal patient={patient} doctorId={doctorId} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestModal({ patient, doctorId, onClose }: { patient: any; doctorId?: number | null; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [diagnosis, setDiagnosis] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [wardId, setWardId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: wards = [] } = useQuery({ queryKey: ['wards'], queryFn: () => window.electronAPI.wards.list() });

  const submit = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.requestAdmission({
        patient_id: patient.id, doctor_id: doctorId ?? null, requested_by: user?.username ?? null,
        provisional_diagnosis: diagnosis || null, urgency, suggested_ward_id: wardId || null, notes: notes || null,
      });
      if (r.ok) { toast('Admission request sent to reception', 'success'); onClose(); }
      else toast(r.error || 'Could not send the request', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Request admission — ${patient.first_name} ${patient.last_name}`} size="md">
      <div className="space-y-3">
        <div>
          <label className="label">Provisional diagnosis</label>
          <input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Acute gastroenteritis with dehydration" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Urgency</label>
            <select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
            </select>
          </div>
          <div>
            <label className="label">Suggested ward (optional)</label>
            <select className="input" value={wardId} onChange={(e) => setWardId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— any —</option>
              {wards.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes for reception (optional)</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BedDouble className="w-4 h-4" />} Send request</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/** Reception-facing panel: pending requests with Approve / Reject. */
export function AdmissionRequestsPanel({ onApprove }: { onApprove: (req: any) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['admission-requests'],
    queryFn: () => window.electronAPI.ipd.admissionRequests('pending'),
    refetchInterval: 15_000,
  });

  const reject = async (id: number) => {
    const reason = (await promptDialog('Reason for rejecting this admission request?', { multiline: true, confirmLabel: 'Reject' })) ?? '';
    const r = await window.electronAPI.ipd.rejectAdmissionRequest(id, reason, user?.username);
    if (r.ok) { toast('Request rejected', 'info'); qc.invalidateQueries({ queryKey: ['admission-requests'] }); }
    else toast(r.error || 'Could not reject', 'error');
  };

  if (isLoading) return <div className="card p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>;

  if (requests.length === 0) {
    return (
      <div className="card p-6 text-center">
        <Clock className="w-7 h-7 mx-auto text-gray-400 mb-2" />
        <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No pending admission requests</div>
        <div className="text-[11px] text-gray-500 mt-1">When a doctor requests an admission from OPD, it appears here for you to approve.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map((r: any) => (
        <div key={r.id} className="card p-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-gray-900 dark:text-slate-100">{r.patient_name}</span>
              <span className="text-[11px] text-gray-500">{r.patient_uhid}</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', URGENCY[r.urgency]?.cls)}>
                {r.urgency === 'emergency' && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}{URGENCY[r.urgency]?.label}
              </span>
            </div>
            <div className="text-[12px] text-gray-600 dark:text-slate-400 mt-0.5">
              {r.provisional_diagnosis || 'No diagnosis noted'}
              {r.suggested_ward_name && <> · suggests <b>{r.suggested_ward_name}</b></>}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {r.doctor_name ? `Dr. ${r.doctor_name}` : (r.requested_by || 'Doctor')} · {fmtDateTime(r.requested_at)}
              {r.notes && ` · ${r.notes}`}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button className="btn-primary text-xs" onClick={() => onApprove(r)}><Check className="w-3.5 h-3.5" /> Approve &amp; admit</button>
            <button className="btn-ghost text-xs text-red-600" onClick={() => reject(r.id)}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
