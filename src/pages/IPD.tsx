import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, UserPlus, Search, LogOut, User, Plus, Trash2, Eye, LayoutGrid } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDate, fmtDateTime } from '../lib/utils';
import type { DischargeMedication } from '../types';
import { WardMap } from '../components/ipd/WardMap';
import { AdmitModal as WardAdmitModal } from '../components/ipd/AdmitModal';
import { AdmissionDetail } from '../components/ipd/AdmissionDetail';
import { AdmissionRequestsPanel } from '../components/ipd/AdmissionRequests';

type Tab = 'wardmap' | 'requests' | 'admitted' | 'discharged' | 'all';

export function IPD() {
  const [tab, setTab] = useState<Tab>('wardmap');
  const [admitOpen, setAdmitOpen] = useState(false);
  const [admitBed, setAdmitBed] = useState<any | null>(null);   // bed chosen on the ward map
  const [dischargeTarget, setDischargeTarget] = useState<any | null>(null);
  const [viewTarget, setViewTarget] = useState<any | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);   // ward-care + bill hub
  // When approving a doctor's admission request, carry the patient/diagnosis
  // into the ward-map bed pick so reception just chooses the bed.
  const [approving, setApproving] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: pendingReqs = [] } = useQuery({
    queryKey: ['admission-requests'],
    queryFn: () => window.electronAPI.ipd.admissionRequests('pending'),
    refetchInterval: 20_000,
    enabled: settings?.ipd_admission_requests_enabled !== false,
  });

  const { data: admissions = [] } = useQuery({
    queryKey: ['ip-admissions', tab],
    queryFn: () => window.electronAPI.ip.list({ status: tab === 'all' ? undefined : tab }),
    refetchInterval: 30_000,
  });

  const discharge = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof window.electronAPI.ip.discharge>[1] }) =>
      window.electronAPI.ip.discharge(id, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ip-admissions'] }); toast('Patient discharged'); setDischargeTarget(null); },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">In-Patient (IPD)</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Admissions, ward & bed management, discharge summaries.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
            <TabBtn active={tab === 'wardmap'} onClick={() => setTab('wardmap')}>Ward Map</TabBtn>
            {settings?.ipd_admission_requests_enabled !== false && (
              <TabBtn active={tab === 'requests'} onClick={() => setTab('requests')}>
                Requests{pendingReqs.length > 0 ? <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">{pendingReqs.length}</span> : null}
              </TabBtn>
            )}
            <TabBtn active={tab === 'admitted'} onClick={() => setTab('admitted')}>Admitted</TabBtn>
            <TabBtn active={tab === 'discharged'} onClick={() => setTab('discharged')}>Discharged</TabBtn>
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>All</TabBtn>
          </div>
          {tab !== 'wardmap' && (
            <button className="btn-primary" onClick={() => setAdmitOpen(true)}>
              <UserPlus className="w-4 h-4" /> Admit Patient
            </button>
          )}
        </div>
      </div>

      {tab === 'requests' ? (
        <>
          {approving && (
            <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 mb-3 text-[12px] text-blue-900 dark:text-blue-200">
              Approving <b>{approving.patient_name}</b> — go to <b>Ward Map</b> and click a free bed to complete the admission.
              <button className="btn-ghost text-xs ml-2" onClick={() => setApproving(null)}>Cancel</button>
            </div>
          )}
          <AdmissionRequestsPanel onApprove={(req) => { setApproving(req); setTab('wardmap'); toast('Now pick a free bed on the ward map', 'info'); }} />
        </>
      ) : tab === 'wardmap' ? (
        <WardMap
          onAdmit={(bed) => setAdmitBed(bed)}
          onOpenAdmission={(id) => setDetailId(id)}
        />
      ) : (
      <div className="card p-4">
        {admissions.length === 0 ? (
          <EmptyState icon={BedDouble} title="No admissions" description="Click “Admit Patient” to add an in-patient." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2">Admission #</th>
                <th className="py-2">Patient</th>
                <th className="py-2">Doctor</th>
                <th className="py-2">Ward / Bed</th>
                <th className="py-2">Admitted</th>
                <th className="py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admissions.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs text-gray-700 dark:text-slate-200">{a.admission_number}</td>
                  <td className="py-2">
                    <div className="font-medium text-gray-900 dark:text-slate-100">{a.patient_name}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{a.patient_uhid} · {a.patient_phone}</div>
                  </td>
                  <td className="py-2 text-gray-600 dark:text-slate-300">{a.doctor_name || '—'}</td>
                  <td className="py-2 text-gray-700 dark:text-slate-200">
                    {a.ward || '—'} / {a.bed_number || '—'}
                  </td>
                  <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(a.admitted_at)}</td>
                  <td className="py-2">
                    <span className={cn(
                      'badge',
                      a.status === 'admitted' && 'bg-emerald-100 text-emerald-700',
                      a.status === 'discharged' && 'bg-gray-200 text-gray-700',
                      a.status === 'cancelled' && 'bg-red-100 text-red-700'
                    )}>{a.status}</span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex gap-1.5 justify-end">
                      {a.status === 'admitted' && (
                        <button className="btn-primary text-xs" onClick={() => setDetailId(a.id)}>
                          <Eye className="w-3.5 h-3.5" /> Open
                        </button>
                      )}
                      {a.status === 'discharged' && (
                        <button className="btn-ghost text-xs" onClick={() => setViewTarget(a)}>
                          <Eye className="w-3.5 h-3.5" /> Summary
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* Admission from the ward map — a specific free bed was chosen. */}
      {admitBed && (
        <WardAdmitModal
          bed={admitBed}
          presetPatient={approving ? { id: approving.patient_id, first_name: approving.patient_name?.split(' ')[0], last_name: approving.patient_name?.split(' ').slice(1).join(' '), uhid: approving.patient_uhid, phone: approving.patient_phone, gender: approving.patient_gender, dob: approving.patient_dob } : null}
          presetDiagnosis={approving?.provisional_diagnosis ?? null}
          admissionRequestId={approving?.id ?? null}
          onClose={() => setAdmitBed(null)}
          onAdmitted={() => {
            qc.invalidateQueries({ queryKey: ['beds-map'] });
            qc.invalidateQueries({ queryKey: ['ip-admissions'] });
            qc.invalidateQueries({ queryKey: ['wards'] });
            qc.invalidateQueries({ queryKey: ['admission-requests'] });
            setAdmitBed(null);
            setApproving(null);
          }}
        />
      )}

      {/* Ward-care + running-bill hub for one admitted patient */}
      {detailId !== null && (
        <AdmissionDetail admissionId={detailId} onClose={() => { setDetailId(null); qc.invalidateQueries({ queryKey: ['ip-admissions'] }); qc.invalidateQueries({ queryKey: ['beds-map'] }); }} />
      )}

      <AdmitModal open={admitOpen} onClose={() => setAdmitOpen(false)} onAdmitted={() => { qc.invalidateQueries({ queryKey: ['ip-admissions'] }); toast('Patient admitted'); setAdmitOpen(false); }} />

      <Modal open={!!dischargeTarget} onClose={() => setDischargeTarget(null)} title="Discharge Summary" size="xl">
        {dischargeTarget && (
          <DischargeForm
            admission={dischargeTarget}
            onSubmit={(payload) => discharge.mutate({ id: dischargeTarget.id, payload })}
            pending={discharge.isPending}
          />
        )}
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="Discharge Summary — View" size="xl">
        {viewTarget && <DischargeSummaryView admission={viewTarget} />}
      </Modal>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('px-3 py-1.5 rounded-md text-xs font-medium', active ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300')}>
      {children}
    </button>
  );
}

function AdmitModal({ open, onClose, onAdmitted }: { open: boolean; onClose: () => void; onAdmitted: () => void }) {
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<any | null>(null);
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [bed, setBed] = useState('');
  const [ward, setWard] = useState('General');
  const [notes, setNotes] = useState('');

  const { data: searchResults = [] } = useQuery({
    queryKey: ['patient-search-admit', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: open && !patient,
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const admit = useMutation({
    mutationFn: () => window.electronAPI.ip.admit({
      patient_id: patient.id,
      admission_doctor_id: doctorId === '' ? undefined : Number(doctorId),
      bed_number: bed || undefined,
      ward: ward || undefined,
      admission_notes: notes || undefined,
    }),
    onSuccess: onAdmitted,
  });

  return (
    <Modal open={open} onClose={onClose} title="Admit Patient" size="lg">
      <div className="space-y-4">
        {patient ? (
          <div className="flex items-center justify-between card p-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => setPatient(null)}>Change</button>
          </div>
        ) : (
          <div>
            <label className="label">Patient *</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className="input pl-9" placeholder="Search name / UHID / phone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="mt-2 max-h-52 overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
              {searchResults.slice(0, 10).map((p: any) => (
                <li key={p.id} onClick={() => setPatient(p)} className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700">
                  <div className="text-sm text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{p.uhid} · {p.phone}</div>
                </li>
              ))}
              {searchResults.length === 0 && (
                <li className="text-center text-xs text-gray-400 py-4">No matches</li>
              )}
            </ul>
          </div>
        )}

        <div>
          <label className="label">Admitting Doctor</label>
          <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.specialty}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Ward</label><input className="input" value={ward} onChange={(e) => setWard(e.target.value)} /></div>
          <div><label className="label">Bed Number</label><input className="input" value={bed} onChange={(e) => setBed(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">Admission Notes</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for admission, diagnosis…" />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => admit.mutate()} disabled={!patient || admit.isPending}>
            {admit.isPending ? 'Admitting…' : 'Confirm Admission'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const BLANK_MED: DischargeMedication = { drug_name: '', dosage: '', frequency: '', duration: '', instructions: '' };
const CONDITION_OPTIONS = ['Stable', 'Improved', 'Fair', 'Critical', 'Discharged against advice', 'Referred'];

function DischargeForm({ admission, onSubmit, pending }: {
  admission: any;
  onSubmit: (payload: Parameters<typeof window.electronAPI.ip.discharge>[1]) => void;
  pending: boolean;
}) {
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const [diagnosis, setDiagnosis] = useState(admission.discharge_diagnosis ?? '');
  const [condition, setCondition] = useState(admission.condition_at_discharge ?? '');
  const [treatment, setTreatment] = useState(admission.treatment_given ?? '');
  const [investigations, setInvestigations] = useState(admission.investigation_findings ?? '');
  const [operativeNotes, setOperativeNotes] = useState(admission.operative_notes ?? '');
  const [followupPlan, setFollowupPlan] = useState(admission.followup_plan ?? '');
  const [dischargeDoctorId, setDischargeDoctorId] = useState<number | ''>(admission.discharge_doctor_id ?? admission.admission_doctor_id ?? '');
  const [meds, setMeds] = useState<DischargeMedication[]>(() => {
    try { return JSON.parse(admission.discharge_medications_json ?? '[]') || []; } catch { return []; }
  });

  const updateMed = (i: number, patch: Partial<DischargeMedication>) =>
    setMeds(meds.map((m, idx) => idx === i ? { ...m, ...patch } : m));

  const handleSubmit = () => {
    onSubmit({
      discharge_diagnosis: diagnosis,
      condition_at_discharge: condition,
      treatment_given: treatment,
      investigation_findings: investigations,
      operative_notes: operativeNotes,
      discharge_medications_json: JSON.stringify(meds.filter((m) => m.drug_name.trim())),
      followup_plan: followupPlan,
      discharge_doctor_id: dischargeDoctorId === '' ? undefined : Number(dischargeDoctorId),
      discharge_summary: [
        diagnosis && `Diagnosis: ${diagnosis}`,
        condition && `Condition at discharge: ${condition}`,
        treatment && `Treatment: ${treatment}`,
        investigations && `Investigations: ${investigations}`,
        operativeNotes && `Operative notes: ${operativeNotes}`,
        followupPlan && `Follow-up: ${followupPlan}`,
      ].filter(Boolean).join('\n'),
    });
  };

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Patient header */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 flex items-start gap-3">
        <User className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{admission.patient_name}</div>
          <div className="text-xs text-gray-500 dark:text-slate-400">
            {admission.admission_number} · Admitted {fmtDateTime(admission.admitted_at)}
            {admission.ward && ` · ${admission.ward}`}{admission.bed_number && ` / Bed ${admission.bed_number}`}
          </div>
        </div>
      </div>

      {/* Section 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Final Diagnosis *</label>
          <textarea className="input" rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Acute Appendicitis, Type 2 Diabetes…" />
        </div>
        <div>
          <label className="label">Condition at Discharge</label>
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">— select —</option>
            {CONDITION_OPTIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Treatment Given</label>
        <textarea className="input" rows={3} value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="Medications given, procedures performed, IV fluids, transfusions…" />
      </div>

      <div>
        <label className="label">Investigation Findings</label>
        <textarea className="input" rows={3} value={investigations} onChange={(e) => setInvestigations(e.target.value)} placeholder="Lab results, imaging findings, ECG, biopsy…" />
      </div>

      <div>
        <label className="label">Operative / Procedure Notes <span className="text-gray-400 font-normal">(surgical cases)</span></label>
        <textarea className="input" rows={2} value={operativeNotes} onChange={(e) => setOperativeNotes(e.target.value)} placeholder="Procedure performed, surgeon, anaesthesia, findings, complications…" />
      </div>

      {/* Discharge Medications */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label !mb-0">Discharge Medications</label>
          <button className="btn-secondary text-xs" onClick={() => setMeds([...meds, { ...BLANK_MED }])}>
            <Plus className="w-3.5 h-3.5" /> Add drug
          </button>
        </div>
        {meds.length === 0 && <p className="text-xs text-gray-400 italic">No medications added.</p>}
        <div className="space-y-2">
          {meds.map((m, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-start">
              <input className="input !py-1 !text-xs col-span-2" placeholder="Drug name" value={m.drug_name} onChange={(e) => updateMed(i, { drug_name: e.target.value })} />
              <input className="input !py-1 !text-xs" placeholder="Dosage" value={m.dosage} onChange={(e) => updateMed(i, { dosage: e.target.value })} />
              <input className="input !py-1 !text-xs" placeholder="Frequency" value={m.frequency} onChange={(e) => updateMed(i, { frequency: e.target.value })} />
              <input className="input !py-1 !text-xs" placeholder="Duration" value={m.duration} onChange={(e) => updateMed(i, { duration: e.target.value })} />
              <button onClick={() => setMeds(meds.filter((_, idx) => idx !== i))} className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 self-center">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Follow-up + Doctor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Follow-up Plan</label>
          <textarea className="input" rows={2} value={followupPlan} onChange={(e) => setFollowupPlan(e.target.value)} placeholder="Review after 1 week, wound dressing, suture removal…" />
        </div>
        <div>
          <label className="label">Discharging Doctor</label>
          <select className="input" value={dischargeDoctorId} onChange={(e) => setDischargeDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">— select —</option>
            {(doctors as any[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-slate-700 pt-3 sticky bottom-0 bg-white dark:bg-slate-800 -mx-1 px-1 pb-1">
        <button className="btn-primary" disabled={pending || !diagnosis.trim()} onClick={handleSubmit}>
          {pending ? 'Discharging…' : 'Confirm Discharge'}
        </button>
      </div>
    </div>
  );
}

function DischargeSummaryView({ admission }: { admission: any }) {
  const meds: DischargeMedication[] = (() => {
    try { return JSON.parse(admission.discharge_medications_json ?? '[]') || []; } catch { return []; }
  })();
  const row = (label: string, value: string | null | undefined) => value ? (
    <div key={label}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mt-3 mb-1">{label}</div>
      <div className="text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap">{value}</div>
    </div>
  ) : null;

  return (
    <div className="space-y-1 max-h-[80vh] overflow-y-auto pr-1">
      <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 p-3">
        <div className="font-semibold text-gray-900 dark:text-slate-100 text-sm">{admission.patient_name}</div>
        <div className="text-xs text-gray-500 dark:text-slate-400">
          {admission.admission_number} · Admitted {fmtDateTime(admission.admitted_at)}
          {admission.discharged_at ? ` → Discharged ${fmtDateTime(admission.discharged_at)}` : ''}
        </div>
      </div>
      {row('Final Diagnosis', admission.discharge_diagnosis)}
      {row('Condition at Discharge', admission.condition_at_discharge)}
      {row('Treatment Given', admission.treatment_given)}
      {row('Investigation Findings', admission.investigation_findings)}
      {row('Operative Notes', admission.operative_notes)}
      {meds.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mt-3 mb-1">Discharge Medications</div>
          <table className="w-full text-xs border-collapse">
            <thead><tr className="text-left text-[10px] text-gray-500 border-b border-gray-200 dark:border-slate-700">
              <th className="pb-1 pr-2">Drug</th><th className="pb-1 pr-2">Dose</th><th className="pb-1 pr-2">Freq</th><th className="pb-1 pr-2">Duration</th>
            </tr></thead>
            <tbody>
              {meds.map((m, i) => <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1 pr-2 font-medium">{m.drug_name}</td>
                <td className="py-1 pr-2">{m.dosage}</td>
                <td className="py-1 pr-2">{m.frequency}</td>
                <td className="py-1 pr-2">{m.duration}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      {row('Follow-up Plan', admission.followup_plan)}
    </div>
  );
}
