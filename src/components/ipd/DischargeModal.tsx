import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, LogOut, HeartPulse, AlertTriangle, Ambulance, Skull, UserX, Printer } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { BillPreview } from '../billing/BillPreview';
import { DischargeSummaryPrint } from './DischargeSummaryPrint';
import { cn } from '../../lib/utils';

/**
 * Discharge with an outcome. Each outcome asks only for what it needs:
 *   - LAMA / DAMA require a reason (patient leaving against advice)
 *   - death requires date/time and captures cause
 *   - referred requires the destination
 * Colour-coded so the outcome reads at a glance in lists and analytics.
 */
const OUTCOMES: { id: string; label: string; icon: any; colour: string; blurb: string }[] = [
  { id: 'discharged', label: 'Discharged', icon: HeartPulse, colour: 'emerald', blurb: 'Normal discharge, treatment complete' },
  { id: 'lama',       label: 'LAMA',       icon: AlertTriangle, colour: 'amber', blurb: 'Left Against Medical Advice' },
  { id: 'dama',       label: 'DAMA',       icon: AlertTriangle, colour: 'orange', blurb: 'Discharged Against Medical Advice' },
  { id: 'referred',   label: 'Referred',   icon: Ambulance, colour: 'blue', blurb: 'Referred to another facility' },
  { id: 'death',      label: 'Death',      icon: Skull, colour: 'slate', blurb: 'Patient expired' },
  { id: 'absconded',  label: 'Absconded',  icon: UserX, colour: 'gray', blurb: 'Patient left without notice' },
];

export function DischargeModal({ admission, onClose, onDischarged }: {
  admission: any; onClose: () => void; onDischarged: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [outcome, setOutcome] = useState('discharged');
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  // Saved discharge-summary templates, filtered to this admission's doctor.
  const { data: templates = [] } = useQuery({
    queryKey: ['discharge-templates', admission.admission_doctor_id],
    queryFn: () => window.electronAPI.ipd.dischargeTemplatesList(
      admission.admission_doctor_id ? { doctor_id: admission.admission_doctor_id } : {}
    ),
  });

  /**
   * Load a template. New templates carry their own named sections (content.sections);
   * we drop those into the editable summary. Legacy flat templates still fill the
   * matching structured fields, so old data keeps working.
   */
  const applyTemplate = (tpl: any) => {
    let content: any = {};
    try { content = JSON.parse(tpl.content_json || '{}'); } catch { content = {}; }
    if (Array.isArray(content.sections)) {
      const sections = content.sections
        .filter((s: any) => s && typeof s === 'object')
        .map((s: any) => ({ label: String(s.label ?? ''), body: String(s.body ?? '') }));
      setF((prev: any) => ({ ...prev, _sections: sections }));
    } else {
      setF((prev: any) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(content)) {
          if (v && (next[k] === undefined || next[k] === '' || next[k] === null)) next[k] = v;
        }
        return next;
      });
    }
    toast(`Applied template “${tpl.name}”`, 'success');
  };

  const setSectionBody = (i: number, body: string) =>
    setF((prev: any) => ({ ...prev, _sections: (prev._sections || []).map((s: any, idx: number) => (idx === i ? { ...s, body } : s)) }));

  /** Compose the named sections into the printable free-text summary. */
  const composeSummary = (): string | null => {
    const secs = (f._sections || []).filter((s: any) => (s.body || '').trim());
    if (secs.length === 0) return f.discharge_summary || null;
    return secs.map((s: any) => `${s.label}:\n${(s.body || '').trim()}`).join('\n\n');
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.discharge(admission.id, {
        outcome,
        outcome_notes: f.outcome_notes || null,
        death_at: outcome === 'death' ? f.death_at : null,
        death_cause: outcome === 'death' ? f.death_cause : null,
        referred_to: outcome === 'referred' ? f.referred_to : null,
        risk_explained_by: (outcome === 'lama' || outcome === 'dama') ? f.risk_explained_by : null,
        discharge_diagnosis: f.discharge_diagnosis || null,
        condition_at_discharge: f.condition_at_discharge || null,
        treatment_given: f.treatment_given || null,
        followup_plan: f.followup_plan || null,
        discharge_doctor_id: f.discharge_doctor_id ? Number(f.discharge_doctor_id) : null,
        discharge_summary: composeSummary(),
      });
      if (r.ok) { toast(`Recorded — ${outcome}`, 'success'); onDischarged(); }
      else toast(r.error || 'Discharge failed', 'error');   // backend message verbatim
    } catch (e: any) {
      toast(e?.message || 'Discharge failed', 'error');
    } finally { setBusy(false); }
  };

  const sel = OUTCOMES.find((o) => o.id === outcome)!;

  return (
    <Modal open onClose={onClose} title={`Discharge — ${admission.patient_name} (${admission.admission_number})`} size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* Template quick-fill */}
          {templates.length > 0 && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-2.5">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300 mb-1.5">Start from a template</div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t: any) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium hover:border-blue-500">
                    {t.name}{t.department ? <span className="text-gray-400"> · {t.department}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Outcome picker */}
          <div>
            <label className="label">Outcome *</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {OUTCOMES.map((o) => (
                <button key={o.id} type="button" onClick={() => setOutcome(o.id)}
                  className={cn('rounded-lg border-2 p-2.5 text-left transition flex items-start gap-2',
                    outcome === o.id ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:border-blue-400')}>
                  <o.icon className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="block text-[12px] font-bold text-gray-900 dark:text-slate-100">{o.label}</span>
                    <span className="block text-[10px] text-gray-500">{o.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Outcome-specific required fields */}
          {(outcome === 'lama' || outcome === 'dama') && (
            <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-3 space-y-2">
              <div>
                <label className="label">Reason for leaving *</label>
                <textarea className="input" rows={2} value={f.outcome_notes || ''} onChange={(e) => setF({ ...f, outcome_notes: e.target.value })} />
              </div>
              <div>
                <label className="label">Risk explained by</label>
                <input className="input" placeholder="Doctor / staff name" value={f.risk_explained_by || ''} onChange={(e) => setF({ ...f, risk_explained_by: e.target.value })} />
              </div>
            </div>
          )}
          {outcome === 'death' && (
            <div className="rounded-lg border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
              <div>
                <label className="label">Date &amp; time of death *</label>
                <input className="input" type="datetime-local" value={f.death_at || ''} onChange={(e) => setF({ ...f, death_at: e.target.value })} />
              </div>
              <div>
                <label className="label">Cause of death</label>
                <input className="input" value={f.death_cause || ''} onChange={(e) => setF({ ...f, death_cause: e.target.value })} />
              </div>
            </div>
          )}
          {outcome === 'referred' && (
            <div>
              <label className="label">Referred to *</label>
              <input className="input" placeholder="Hospital / facility name" value={f.referred_to || ''} onChange={(e) => setF({ ...f, referred_to: e.target.value })} />
            </div>
          )}

          {/* Common discharge summary fields */}
          <div>
            <label className="label">Discharge diagnosis</label>
            <input className="input" value={f.discharge_diagnosis || ''} onChange={(e) => setF({ ...f, discharge_diagnosis: e.target.value })} />
          </div>
          <div>
            <label className="label">Condition at discharge</label>
            <input className="input" value={f.condition_at_discharge || ''} onChange={(e) => setF({ ...f, condition_at_discharge: e.target.value })} />
          </div>
          <div>
            <label className="label">Discharging doctor</label>
            <select className="input" value={f.discharge_doctor_id || ''} onChange={(e) => setF({ ...f, discharge_doctor_id: e.target.value })}>
              <option value="">— select —</option>
              {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Follow-up plan</label>
            <textarea className="input" rows={2} value={f.followup_plan || ''} onChange={(e) => setF({ ...f, followup_plan: e.target.value })} />
          </div>

          {/* Template sections — the doctor's own headings, loaded from a template */}
          {Array.isArray(f._sections) && f._sections.length > 0 && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300">Summary sections</div>
              {f._sections.map((s: any, i: number) => (
                <div key={i}>
                  <label className="label">{s.label || `Section ${i + 1}`}</label>
                  <textarea className="input" rows={2} value={s.body || ''} onChange={(e) => setSectionBody(i, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button className={cn('btn-primary', sel.id === 'death' && 'bg-slate-700')} disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Confirm {sel.label}
            </button>
            <button className="btn-secondary" onClick={() => setShowPrint(true)}><Printer className="w-4 h-4" /> Preview / Print summary</button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>

        {/* Final bill on the right */}
        <div>
          <div className="text-[11px] text-gray-500 mb-2">Final bill — settle before or after discharge.</div>
          <BillPreview admissionId={admission.id} />
        </div>
      </div>

      {showPrint && (
        <DischargeSummaryPrint
          doc={{
            patient: {
              name: admission.patient_name, uhid: admission.patient_uhid,
              dob: admission.patient_dob, gender: admission.patient_gender,
              phone: admission.patient_phone, address: admission.patient_address,
            },
            admission: {
              number: admission.admission_number, ward: admission.ward_name || admission.ward, bed: admission.bed_number,
              admittedAt: admission.admitted_at, dischargedAt: new Date().toISOString(),
            },
            outcome,
            diagnosis: f.discharge_diagnosis, condition: f.condition_at_discharge, followup: f.followup_plan,
            sections: f._sections || [],
            doctorName: doctors.find((d: any) => String(d.id) === String(f.discharge_doctor_id))?.name || admission.doctor_name || null,
          }}
          onClose={() => setShowPrint(false)}
        />
      )}
    </Modal>
  );
}
