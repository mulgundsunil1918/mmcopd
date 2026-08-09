import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Eye, Save, Printer, X, BedDouble } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDate } from '../lib/utils';
import { DischargeSummaryPrint } from '../components/ipd/DischargeSummaryPrint';

/**
 * Dedicated Discharge Summary builder. Pick an admission, start from a saved
 * template (or blank), then build the summary with your OWN named sections plus
 * the structured diagnosis / condition / follow-up fields. Preview and print on
 * the clinic letterhead — the same header/footer as the OPD slip and bill — or
 * save it back onto the admission to finish later.
 */
type Section = { label: string; body: string };

const SUGGESTED = ['Diagnosis', 'Course in Hospital', 'Investigations', 'Treatment Given', 'Procedures', 'Condition at Discharge', 'Advice / Follow-up', 'Medications on Discharge'];

export function DischargeSummary() {
  const toast = useToast();
  const { user } = useAuth();
  const [selected, setSelected] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'admitted' | 'discharged' | 'all'>('admitted');

  // Form state
  const [diagnosis, setDiagnosis] = useState('');
  const [condition, setCondition] = useState('');
  const [followup, setFollowup] = useState('');
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [sections, setSections] = useState<Section[]>([{ label: '', body: '' }]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const { data: admissions = [], isLoading } = useQuery({
    queryKey: ['ds-admissions', statusFilter],
    queryFn: () => window.electronAPI.ip.list(statusFilter === 'all' ? {} : { status: statusFilter }),
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const { data: templates = [] } = useQuery({ queryKey: ['discharge-templates', 'all'], queryFn: () => window.electronAPI.ipd.dischargeTemplatesList() });

  const filtered = admissions.filter((a: any) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (a.patient_name || '').toLowerCase().includes(s) || (a.patient_uhid || '').toLowerCase().includes(s) || (a.admission_number || '').toLowerCase().includes(s);
  });

  const loadAdmission = (a: any) => {
    setSelected(a);
    // Re-open a saved summary if one exists.
    let saved: any = null;
    try { saved = a.discharge_summary_json ? JSON.parse(a.discharge_summary_json) : null; } catch { saved = null; }
    setDiagnosis(saved?.diagnosis || a.discharge_diagnosis || '');
    setCondition(saved?.condition || '');
    setFollowup(saved?.followup || '');
    setDoctorId(saved?.doctor_id || a.admission_doctor_id || '');
    setSections(saved?.sections?.length ? saved.sections : [{ label: '', body: '' }]);
  };

  const applyTemplate = (t: any) => {
    let content: any = {};
    try { content = JSON.parse(t.content_json || '{}'); } catch { content = {}; }
    const secs: Section[] = Array.isArray(content.sections)
      ? content.sections.map((s: any) => ({ label: String(s.label ?? ''), body: String(s.body ?? '') }))
      : Object.entries(content).map(([k, v]) => ({ label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), body: v == null ? '' : String(v) }));
    setSections(secs.length ? secs : [{ label: '', body: '' }]);
    toast(`Loaded template “${t.name}”`, 'success');
  };

  // section helpers
  const addSection = (label = '') => setSections((s) => [...s, { label, body: '' }]);
  const updateSection = (i: number, patch: Partial<Section>) => setSections((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeSection = (i: number) => setSections((s) => s.filter((_, idx) => idx !== i));
  const moveSection = (i: number, dir: -1 | 1) => setSections((s) => { const j = i + dir; if (j < 0 || j >= s.length) return s; const c = s.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; });

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.saveDischargeSummary(selected.id, {
        diagnosis, condition, followup, doctor_id: doctorId ? Number(doctorId) : null,
        sections: sections.filter((s) => s.label.trim() || s.body.trim()),
      });
      if (r.ok) toast('Discharge summary saved', 'success');
      else toast(r.error || 'Could not save', 'error');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const doc = selected ? {
    patient: { name: selected.patient_name, uhid: selected.patient_uhid, dob: selected.patient_dob, gender: selected.patient_gender, phone: selected.patient_phone },
    admission: { number: selected.admission_number, ward: selected.ward, bed: selected.bed_number, admittedAt: selected.admitted_at, dischargedAt: selected.discharged_at || new Date().toISOString() },
    outcome: selected.outcome,
    diagnosis, condition, followup,
    sections: sections.filter((s) => s.body.trim()),
    doctorName: doctors.find((d: any) => String(d.id) === String(doctorId))?.name || selected.doctor_name || null,
  } : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-sky-500" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Discharge Summary</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left — pick admission */}
        <div className="card p-4 space-y-3 lg:col-span-1 h-fit">
          <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 text-[11px] font-semibold">
            {(['admitted', 'discharged', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={cn('flex-1 px-2 py-1 rounded-md capitalize', statusFilter === s ? 'bg-white dark:bg-slate-900 text-sky-700 shadow-sm' : 'text-gray-500')}>{s}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9" placeholder="Find patient / admission" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
            {isLoading ? <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
              : filtered.length === 0 ? <div className="text-[12px] text-gray-400 text-center py-6">No {statusFilter === 'all' ? '' : statusFilter} admissions.</div>
              : filtered.map((a: any) => (
                <button key={a.id} onClick={() => loadAdmission(a)}
                  className={cn('w-full text-left rounded-lg border p-2.5 transition', selected?.id === a.id ? 'border-sky-400 bg-sky-50/60 dark:bg-sky-900/20' : 'border-gray-200 dark:border-slate-700 hover:border-sky-300')}>
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{a.patient_name}</div>
                  <div className="text-[11px] text-gray-500">{a.admission_number} · {a.ward || '—'}{a.bed_number ? `/${a.bed_number}` : ''} · {fmtDate(a.admitted_at)}</div>
                </button>
              ))}
          </div>
        </div>

        {/* Right — builder */}
        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div className="card p-10 text-center text-gray-400">
              <BedDouble className="w-8 h-8 mx-auto mb-2" />
              <div className="text-[13px] font-semibold text-gray-600 dark:text-slate-300">Pick an admission to build its discharge summary</div>
            </div>
          ) : (
            <>
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-bold text-gray-900 dark:text-slate-100">{selected.patient_name}</div>
                    <div className="text-[11px] text-gray-500">{selected.admission_number} · {selected.patient_uhid}</div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => setSelected(null)}>Change</button>
                </div>

                {templates.length > 0 && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300 mb-1.5">Start from a template</div>
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((t: any) => (
                        <button key={t.id} className="rounded-full border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium hover:border-blue-500" onClick={() => applyTemplate(t)}>
                          {t.name}{t.department ? <span className="text-gray-400"> · {t.department}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className="label">Discharge diagnosis</label><input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></div>
                  <div><label className="label">Condition at discharge</label><input className="input" value={condition} onChange={(e) => setCondition(e.target.value)} /></div>
                  <div>
                    <label className="label">Discharging doctor</label>
                    <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">— select —</option>
                      {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div><label className="label">Follow-up plan</label><input className="input" value={followup} onChange={(e) => setFollowup(e.target.value)} /></div>
                </div>
              </div>

              {/* Sections */}
              <div className="card p-4 space-y-2">
                <div className="label">Summary sections — your own headings, in order</div>
                {sections.map((s, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-700 p-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <input className="input !py-1 flex-1 font-semibold text-[12px]" placeholder="Section name (e.g. Course in Hospital)" value={s.label} onChange={(e) => updateSection(i, { label: e.target.value })} />
                      <button className="btn-ghost !px-1.5 !py-1" disabled={i === 0} onClick={() => moveSection(i, -1)}><ChevronUp className="w-3.5 h-3.5" /></button>
                      <button className="btn-ghost !px-1.5 !py-1" disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)}><ChevronDown className="w-3.5 h-3.5" /></button>
                      <button className="btn-ghost !px-1.5 !py-1 text-red-600" onClick={() => removeSection(i)}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <textarea className="input !py-1 text-[12px]" rows={3} placeholder="Text for this section…" value={s.body} onChange={(e) => updateSection(i, { body: e.target.value })} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button className="btn-secondary text-xs" onClick={() => addSection()}><Plus className="w-3.5 h-3.5" /> Add section</button>
                  <span className="text-[10px] text-gray-400 ml-1">quick-add:</span>
                  {SUGGESTED.filter((n) => !sections.some((s) => s.label.toLowerCase() === n.toLowerCase())).map((n) => (
                    <button key={n} onClick={() => addSection(n)} className="inline-flex items-center gap-1 rounded-full border border-gray-300 dark:border-slate-600 px-2 py-0.5 text-[10px] text-gray-600 dark:text-slate-300 hover:border-blue-400"><Plus className="w-2.5 h-2.5" /> {n}</button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>
                <button className="btn-secondary" onClick={() => setPreview(true)}><Eye className="w-4 h-4" /> Preview</button>
                <button className="btn-secondary" onClick={() => setPreview(true)}><Printer className="w-4 h-4" /> Print</button>
              </div>
            </>
          )}
        </div>
      </div>

      {preview && doc && <DischargeSummaryPrint doc={doc} onClose={() => setPreview(false)} />}
    </div>
  );
}
