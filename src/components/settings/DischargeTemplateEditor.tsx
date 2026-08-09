import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Pencil, Trash2, Loader2, X, ChevronUp, ChevronDown, AlertCircle, GripVertical, Eye } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { DischargeSummaryPrint } from '../ipd/DischargeSummaryPrint';

/**
 * Discharge-summary templates — fully build-your-own. A template is just an
 * ordered list of sections YOU name (e.g. "Diagnosis", "Course in hospital",
 * "Advice"), each with default text. Nothing is fixed. On discharge, one click
 * loads these sections into the summary for the doctor to edit and print.
 * Templates can be general, or scoped to a department / doctor.
 *
 * Stored as content_json = { sections: [{ label, body }] }. Older templates were
 * saved as flat { key: value } — we convert those to sections when opened so
 * nothing is lost.
 */

const DEPARTMENTS = ['General Medicine', 'Pediatrics', 'OBG', 'Surgery', 'Orthopedics', 'Cardiology', 'ENT', 'Other'];

// Optional starter section names — one tap to add, fully editable/removable after.
const SUGGESTED = ['Diagnosis', 'Course in Hospital', 'Investigations', 'Treatment Given', 'Condition at Discharge', 'Advice / Follow-up', 'Medications'];

type Section = { label: string; body: string };

/** Old flat {key:value} content → sections, prettifying the key into a label. */
function contentToSections(content: any): Section[] {
  if (!content || typeof content !== 'object') return [];
  if (Array.isArray(content.sections)) {
    return content.sections
      .filter((s: any) => s && typeof s === 'object')
      .map((s: any) => ({ label: String(s.label ?? ''), body: String(s.body ?? '') }));
  }
  // legacy flat map
  return Object.entries(content).map(([k, v]) => ({
    label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    body: v == null ? '' : String(v),
  }));
}

export function DischargeTemplateEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);

  const { data: templates = [], isError, error, isLoading } = useQuery({
    queryKey: ['discharge-templates', 'all'],
    queryFn: () => window.electronAPI.ipd.dischargeTemplatesList(),
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const startNew = () => setEditing({ name: '', department: '', doctor_id: '', sections: [{ label: '', body: '' }] });

  const openEdit = (t: any) => {
    let content: any = {};
    try { content = JSON.parse(t.content_json || '{}'); } catch { content = {}; }
    const sections = contentToSections(content);
    setEditing({ ...t, doctor_id: t.doctor_id ?? '', department: t.department ?? '', sections: sections.length ? sections : [{ label: '', body: '' }] });
  };

  const save = async () => {
    const sections: Section[] = (editing.sections || [])
      .map((s: Section) => ({ label: (s.label || '').trim(), body: s.body || '' }))
      .filter((s: Section) => s.label || s.body.trim());
    if (!editing.name?.trim()) { toast('Give the template a name', 'error'); return; }
    if (sections.length === 0) { toast('Add at least one section', 'error'); return; }
    if (sections.some((s) => !s.label)) { toast('Every section needs a name', 'error'); return; }
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.dischargeTemplateSave({
        id: editing.id,
        name: editing.name.trim(),
        department: editing.department || null,
        doctor_id: editing.doctor_id ? Number(editing.doctor_id) : null,
        content: { sections },
      });
      if (r.ok) {
        toast(editing.id ? 'Template updated' : 'Template added', 'success');
        setEditing(null);
        qc.invalidateQueries({ queryKey: ['discharge-templates'] });
      } else toast(r.error || 'Could not save', 'error');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number, name: string) => {
    const r = await window.electronAPI.ipd.dischargeTemplateDelete(id);
    if (r.ok) { toast(`“${name}” removed`, 'success'); qc.invalidateQueries({ queryKey: ['discharge-templates'] }); }
    else toast(r.error || 'Could not delete', 'error');
  };

  // ---- section editing helpers (operate on editing.sections) ----
  const setSections = (fn: (s: Section[]) => Section[]) => setEditing((e: any) => ({ ...e, sections: fn(e.sections || []) }));
  const addSection = (label = '') => setSections((s) => [...s, { label, body: '' }]);
  const updateSection = (i: number, patch: Partial<Section>) => setSections((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeSection = (i: number) => setSections((s) => s.filter((_, idx) => idx !== i));
  const moveSection = (i: number, dir: -1 | 1) => setSections((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const copy = s.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Discharge Summary Templates</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Build your own summary — add the sections you want and name them yourself. On discharge, one click loads
            them; the doctor edits and prints. Scope a template to a department or doctor, or leave it for everyone.
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={startNew}><Plus className="w-3.5 h-3.5" /> New template</button>
      </div>

      {editing && (
        <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold text-blue-900 dark:text-blue-200">{editing.id ? 'Edit template' : 'New template'}</div>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}><X className="w-3.5 h-3.5" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Template name *</label>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Normal Delivery" />
            </div>
            <div>
              <label className="label">Department</label>
              <select className="input" value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })}>
                <option value="">Any department</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Doctor</label>
              <select className="input" value={editing.doctor_id} onChange={(e) => setEditing({ ...editing, doctor_id: e.target.value })}>
                <option value="">Any doctor</option>
                {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          {/* Section builder */}
          <div>
            <label className="label">Sections — your own headings, in order</label>
            <div className="space-y-2">
              {(editing.sections || []).map((s: Section, i: number) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <input className="input !py-1 flex-1 font-semibold text-[12px]" placeholder="Section name (e.g. Diagnosis)"
                      value={s.label} onChange={(e) => updateSection(i, { label: e.target.value })} />
                    <div className="flex items-center gap-0.5">
                      <button type="button" className="btn-ghost !px-1.5 !py-1" title="Move up" disabled={i === 0} onClick={() => moveSection(i, -1)}><ChevronUp className="w-3.5 h-3.5" /></button>
                      <button type="button" className="btn-ghost !px-1.5 !py-1" title="Move down" disabled={i === (editing.sections.length - 1)} onClick={() => moveSection(i, 1)}><ChevronDown className="w-3.5 h-3.5" /></button>
                      <button type="button" className="btn-ghost !px-1.5 !py-1 text-red-600" title="Remove section" onClick={() => removeSection(i)}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <textarea className="input !py-1 text-[12px]" rows={2} placeholder="Default text for this section (optional — the doctor can edit it at discharge)"
                    value={s.body} onChange={(e) => updateSection(i, { body: e.target.value })} />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => addSection()}><Plus className="w-3.5 h-3.5" /> Add section</button>
              <span className="text-[10px] text-gray-400 ml-1">or quick-add:</span>
              {SUGGESTED.filter((name) => !(editing.sections || []).some((s: Section) => s.label.toLowerCase() === name.toLowerCase())).map((name) => (
                <button key={name} type="button" onClick={() => addSection(name)}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 dark:border-slate-600 px-2 py-0.5 text-[10px] text-gray-600 dark:text-slate-300 hover:border-blue-400">
                  <Plus className="w-2.5 h-2.5" /> {name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button className="btn-primary text-xs" disabled={busy} onClick={save}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save template
            </button>
            <button className="btn-secondary text-xs" onClick={() => setPreview(editing)}><Eye className="w-3.5 h-3.5" /> Preview</button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {preview && (
        <DischargeSummaryPrint
          doc={{
            isPreview: true,
            patient: { name: 'Sample Patient', uhid: 'UH00000', dob: '2019-03-14', gender: 'M', phone: '9XXXXXXXXX' },
            admission: { number: 'IP/PREVIEW', ward: preview.department || 'General Ward', bed: 'G-01', admittedAt: new Date(Date.now() - 3 * 86400000).toISOString(), dischargedAt: new Date().toISOString() },
            outcome: 'discharged',
            sections: (preview.sections || [])
              .map((s: Section) => ({ label: (s.label || '').trim(), body: (s.body || '').trim() || `(${(s.label || 'section').trim()} text appears here at discharge)` }))
              .filter((s: Section) => s.label),
            doctorName: (doctors.find((d: any) => String(d.id) === String(preview.doctor_id))?.name) || null,
          }}
          onClose={() => setPreview(null)}
        />
      )}

      {/* List / states */}
      {isError ? (
        <div className="rounded-lg border-2 border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10 p-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-[13px] font-semibold"><AlertCircle className="w-4 h-4" /> Couldn’t load templates</div>
          <div className="text-[12px] text-red-600 dark:text-red-400 mt-1">{(error as any)?.message || String(error)}</div>
          <div className="text-[11px] text-gray-500 mt-1">If you just updated the app, fully close and reopen it — the templates engine loads at startup.</div>
        </div>
      ) : isLoading ? (
        <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
      ) : (
        <div className="space-y-2">
          {templates.length === 0 && !editing && (
            <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-700 p-6 text-center">
              <FileText className="w-7 h-7 mx-auto text-gray-400 mb-2" />
              <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No templates yet</div>
              <div className="text-[11px] text-gray-500 mt-1">Create one per common discharge — e.g. “Gastroenteritis”, “Normal Delivery”, “Post-op”.</div>
            </div>
          )}
          {templates.map((t: any) => {
            let count = 0;
            try { count = contentToSections(JSON.parse(t.content_json || '{}')).length; } catch { count = 0; }
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border-2 border-gray-200 dark:border-slate-700 p-3">
                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{t.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {t.department || 'Any department'}{t.doctor_name ? ` · ${t.doctor_name}` : ' · any doctor'} · {count} section{count === 1 ? '' : 's'}
                  </div>
                </div>
                <button className="btn-ghost text-xs" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></button>
                <button className="btn-ghost text-xs text-red-600" onClick={() => remove(t.id, t.name)}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
