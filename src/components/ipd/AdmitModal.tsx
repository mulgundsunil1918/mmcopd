import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, ShieldAlert } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';

/**
 * Admit a patient into a specific bed. Opened from the ward map with the chosen
 * free bed already known, so the flow is: find the patient, pick the doctor,
 * optional advance and MLC, admit.
 */
export function AdmitModal({
  bed, onClose, onAdmitted,
}: {
  bed: any;                       // the free bed chosen on the map
  onClose: () => void;
  onAdmitted: (admissionId: number) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<any | null>(null);
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [admissionType, setAdmissionType] = useState('planned');
  const [diagnosis, setDiagnosis] = useState('');
  const [attendantName, setAttendantName] = useState('');
  const [attendantPhone, setAttendantPhone] = useState('');
  const [advance, setAdvance] = useState('');
  const [advanceMode, setAdvanceMode] = useState('Cash');
  const [isMlc, setIsMlc] = useState(false);
  const [mlc, setMlc] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: results = [] } = useQuery({
    queryKey: ['patient-search-admit', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: q.trim().length >= 2 && !patient,
  });

  const submit = async () => {
    if (!patient) { toast('Choose a patient first', 'error'); return; }
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.admit({
        patient_id: patient.id,
        bed_id: bed.id,
        admission_doctor_id: doctorId === '' ? null : Number(doctorId),
        admission_type: admissionType,
        provisional_diagnosis: diagnosis || null,
        attendant_name: attendantName || null,
        attendant_phone: attendantPhone || null,
        advance_amount: advance ? Number(advance) : 0,
        advance_mode: advanceMode,
        is_mlc: isMlc,
        mlc: isMlc ? mlc : undefined,
        performed_by: user?.username ?? null,
      });
      if (r.ok) {
        toast(`Admitted — ${r.admission_number}`, 'success');
        onAdmitted(r.id);
      } else {
        toast(r.error, 'error');   // backend messages are already user-facing
      }
    } catch (e: any) {
      toast(e?.message || 'Admission failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Admit to ${bed.ward_name} / ${bed.bed_number}`} size="xl">
      <div className="space-y-4">
        {/* Patient */}
        {!patient ? (
          <div>
            <label className="label">Find patient *</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input className="input pl-9" autoFocus placeholder="Name, phone or UHID"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {q.trim().length >= 2 && (
              <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700">
                {results.length === 0 ? (
                  <div className="p-3 text-[12px] text-gray-500">No match. Register the patient in Reception first.</div>
                ) : results.map((p: any) => (
                  <button key={p.id} onClick={() => setPatient(p)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b last:border-0 border-gray-100 dark:border-slate-800">
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                    <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 p-3">
            <div>
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-[11px] text-gray-500">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => { setPatient(null); setQ(''); }}>Change</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Under doctor</label>
            <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">— select —</option>
              {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Admission type</label>
            <select className="input" value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
              <option value="planned">Planned</option>
              <option value="emergency">Emergency</option>
              <option value="referral">Referral</option>
              <option value="daycare">Day care</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Provisional diagnosis</label>
          <input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Reason for admission" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Attendant name</label>
            <input className="input" value={attendantName} onChange={(e) => setAttendantName(e.target.value)} />
          </div>
          <div>
            <label className="label">Attendant phone</label>
            <input className="input" value={attendantPhone} onChange={(e) => setAttendantPhone(e.target.value)} />
          </div>
        </div>

        {/* Advance */}
        {settings?.ipd_advance_enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Advance deposit (₹)</label>
              <input className="input" type="number" min={0} value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Paid by</label>
              <select className="input" value={advanceMode} onChange={(e) => setAdvanceMode(e.target.value)}>
                <option>Cash</option><option>UPI</option><option>Card</option>
              </select>
            </div>
          </div>
        )}

        {/* MLC */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isMlc} onChange={(e) => setIsMlc(e.target.checked)} />
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <span className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">This is a medico-legal case (MLC)</span>
        </label>
        {isMlc && (
          <div className="pl-6 grid grid-cols-1 md:grid-cols-2 gap-3 border-l-2 border-amber-200 dark:border-amber-900">
            <div>
              <label className="label">Police station</label>
              <input className="input" value={mlc.police_station || ''} onChange={(e) => setMlc({ ...mlc, police_station: e.target.value })} />
            </div>
            <div>
              <label className="label">Brought by</label>
              <input className="input" value={mlc.brought_by || ''} onChange={(e) => setMlc({ ...mlc, brought_by: e.target.value })} />
            </div>
            <div>
              <label className="label">Incident type</label>
              <input className="input" value={mlc.incident_type || ''} onChange={(e) => setMlc({ ...mlc, incident_type: e.target.value })} placeholder="RTA, assault, poisoning…" />
            </div>
            <div>
              <label className="label">Incident place</label>
              <input className="input" value={mlc.incident_place || ''} onChange={(e) => setMlc({ ...mlc, incident_place: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Injury / incident description</label>
              <textarea className="input" rows={2} value={mlc.injury_description || ''} onChange={(e) => setMlc({ ...mlc, injury_description: e.target.value })} />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button className="btn-primary" disabled={busy || !patient} onClick={submit}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Admit patient
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
