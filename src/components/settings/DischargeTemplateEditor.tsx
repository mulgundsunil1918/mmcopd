import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

/**
 * Department / doctor-wise discharge-summary templates. A template prefills the
 * discharge form's fields (diagnosis, treatment, advice, …) so a summary is one
 * click. Templates can be general, tied to a department, or tied to a doctor.
 */
const FIELDS: { key: string; label: string; rows?: number }[] = [
  { key: 'discharge_diagnosis', label: 'Discharge diagnosis' },
  { key: 'condition_at_discharge', label: 'Condition at discharge' },
  { key: 'treatment_given', label: 'Treatment given', rows: 3 },
  { key: 'investigation_findings', label: 'Investigation findings', rows: 2 },
  { key: 'operative_notes', label: 'Operative notes', rows: 2 },
  { key: 'followup_plan', label: 'Follow-up plan / advice', rows: 2 },
  { key: 'discharge_summary', label: 'Free-text summary', rows: 3 },
];

const DEPARTMENTS = ['General Medicine', 'Pediatrics', 'OBG', 'Surgery', 'Orthopedics', 'Cardiology', 'ENT', 'Other'];

export function DischargeTemplateEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: templates = [] } = useQuery({ queryKey: ['discharge-templates', 'all'], queryFn: () => window.electronAPI.ipd.dischargeTemplatesList() });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const startNew = () => setEditing({ name: '', department: '', doctor_id: '', content: {} });

  const save = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.dischargeTemplateSave({
        id: editing.id,
        name: editing.name,
        department: editing.department || null,
        doctor_id: editing.doctor_id ? Number(editing.doctor_id) : null,
        content: editing.content || {},
      });
      if (r.ok) { toast(editing.id ? 'Template updated' : 'Template added', 'success'); setEditing(null); qc.invalidateQueries({ queryKey: ['discharge-templates'] }); }
      else toast(r.error || 'Could not save', 'error');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number, name: string) => {
    const r = await window.electronAPI.ipd.dischargeTemplateDelete(id);
    if (r.ok) { toast(`“${name}” removed`, 'success'); qc.invalidateQueries({ queryKey: ['discharge-templates'] }); }
    else toast(r.error || 'Could not delete', 'error');
  };

  const openEdit = (t: any) => {
    let content = {}; try { content = JSON.parse(t.content_json || '{}'); } catch { content = {}; }
    setEditing({ ...t, doctor_id: t.doctor_id ?? '', department: t.department ?? '', content });
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Discharge Summary Templates</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Save ready-made discharge summaries per department or doctor. On discharge, one click fills the form —
            the doctor edits and prints. Blank fields are filled; anything already typed is kept.
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
          <div className="space-y-2">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <textarea className="input" rows={f.rows || 1} value={editing.content?.[f.key] || ''}
                  onChange={(e) => setEditing({ ...editing, content: { ...editing.content, [f.key]: e.target.value } })} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-xs" disabled={busy || !editing.name?.trim()} onClick={save}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save template
            </button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {templates.length === 0 && !editing && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-700 p-6 text-center">
            <FileText className="w-7 h-7 mx-auto text-gray-400 mb-2" />
            <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No templates yet</div>
            <div className="text-[11px] text-gray-500 mt-1">Create one per common discharge — e.g. “Gastroenteritis”, “Normal Delivery”, “Post-op”.</div>
          </div>
        )}
        {templates.map((t: any) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border-2 border-gray-200 dark:border-slate-700 p-3">
            <FileText className="w-4 h-4 text-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{t.name}</div>
              <div className="text-[11px] text-gray-500">
                {t.department || 'Any department'}{t.doctor_name ? ` · ${t.doctor_name}` : ' · any doctor'}
              </div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></button>
            <button className="btn-ghost text-xs text-red-600" onClick={() => remove(t.id, t.name)}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
