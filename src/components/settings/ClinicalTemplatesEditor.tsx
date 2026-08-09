import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Plus, Pencil, Trash2, Loader2, X, User, Users } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';
import type { ClinicalQuickTemplate } from '../../types';

/**
 * Manage the consultation Quick-Fill templates. A template appends ready text into
 * the History / Examination / Impression / Advice fields with one tap during a
 * consultation. Each template is either shared with everyone or owned by one
 * doctor — a doctor's own templates show only to them (plus the shared ones).
 *
 * Storage matches the existing engine: the whole list is one JSON array in
 * settings (clinicalTemplates.save replaces it), so we edit locally and save all.
 */
const FIELD_DEFS: { key: string; label: string; rows: number; placeholder: string }[] = [
  { key: 'history', label: 'History / Complaints', rows: 3, placeholder: 'Presenting complaints, duration, relevant history…' },
  { key: 'examination', label: 'Examination', rows: 3, placeholder: 'Vitals, systemic examination findings…' },
  { key: 'impression', label: 'Impression / Diagnosis', rows: 2, placeholder: 'Provisional or final diagnosis…' },
  { key: 'advice', label: 'Advice / Plan', rows: 3, placeholder: 'Investigations, lifestyle advice, referrals…' },
];

function newId(): string {
  return 'ct_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function ClinicalTemplatesEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState<ClinicalQuickTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ['clinical-templates'],
    queryFn: () => window.electronAPI.clinicalTemplates.list(),
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const doctorName = (id?: number | null) => doctors.find((d: any) => d.id === id)?.name;

  const persist = async (next: ClinicalQuickTemplate[]) => {
    setBusy(true);
    try {
      await window.electronAPI.clinicalTemplates.save(next);
      qc.invalidateQueries({ queryKey: ['clinical-templates'] });
    } catch (e: any) {
      toast(e?.message || 'Could not save templates', 'error');
    } finally { setBusy(false); }
  };

  const startNew = () => setEditing({ id: newId(), name: '', category: '', fields: {}, doctor_id: null });

  const saveOne = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast('Give the template a name', 'error'); return; }
    if (!editing.category.trim()) { toast('Give it a category (specialty or “My Templates”)', 'error'); return; }
    const hasContent = FIELD_DEFS.some((f) => (editing.fields[f.key] || '').trim());
    if (!hasContent) { toast('Fill at least one field (History / Examination / …)', 'error'); return; }

    const cleaned: ClinicalQuickTemplate = {
      ...editing,
      name: editing.name.trim(),
      category: editing.category.trim(),
      fields: Object.fromEntries(Object.entries(editing.fields).filter(([, v]) => (v || '').trim())),
      doctor_id: editing.doctor_id ?? null,
    };
    const exists = templates.some((t: ClinicalQuickTemplate) => t.id === cleaned.id);
    const next = exists
      ? templates.map((t: ClinicalQuickTemplate) => (t.id === cleaned.id ? cleaned : t))
      : [...templates, cleaned];
    await persist(next);
    toast(exists ? 'Template updated' : 'Template added', 'success');
    setEditing(null);
  };

  const remove = async (id: string, name: string) => {
    await persist(templates.filter((t: ClinicalQuickTemplate) => t.id !== id));
    toast(`“${name}” removed`, 'success');
  };

  // Group for display: "Shared with everyone" first, then one group per doctor.
  const shared = templates.filter((t: ClinicalQuickTemplate) => !t.doctor_id);
  const owned = templates.filter((t: ClinicalQuickTemplate) => !!t.doctor_id);
  const byDoctor = new Map<number, ClinicalQuickTemplate[]>();
  for (const t of owned) {
    const arr = byDoctor.get(t.doctor_id!) || [];
    arr.push(t); byDoctor.set(t.doctor_id!, arr);
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Consultation Quick-Fill Templates</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            One-tap text for the History / Examination / Impression / Advice fields during a consultation. Make a
            template shared for the whole clinic, or save it under a doctor’s name so only that doctor sees it.
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={startNew}><Plus className="w-3.5 h-3.5" /> New template</button>
      </div>

      {editing && (
        <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold text-amber-900 dark:text-amber-200">{templates.some((t: ClinicalQuickTemplate) => t.id === editing.id) ? 'Edit template' : 'New template'}</div>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}><X className="w-3.5 h-3.5" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Template name *</label>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Type 2 Diabetes review" />
            </div>
            <div>
              <label className="label">Category *</label>
              <input className="input" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="e.g. Endocrinology / My Templates" list="ct-categories" />
              <datalist id="ct-categories">
                {[...new Set(templates.map((t: ClinicalQuickTemplate) => t.category))].map((c) => <option key={c as string} value={c as string} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Saved under</label>
              <select className="input" value={editing.doctor_id ?? ''} onChange={(e) => setEditing({ ...editing, doctor_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Everyone (shared)</option>
                {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}{user?.doctor_id === d.id ? ' (me)' : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELD_DEFS.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <textarea className="input" rows={f.rows} placeholder={f.placeholder}
                  value={editing.fields[f.key] || ''}
                  onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, [f.key]: e.target.value } })} />
              </div>
            ))}
          </div>

          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="label">Follow-up in (days)</label>
              <input className="input" type="text" inputMode="numeric" value={editing.follow_up_days ?? ''}
                placeholder="e.g. 30 — optional"
                onChange={(e) => { const n = e.target.value.replace(/[^0-9]/g, ''); setEditing({ ...editing, follow_up_days: n ? Number(n) : undefined }); }} />
            </div>
            <button className="btn-primary text-xs" disabled={busy} onClick={saveOne}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save template
            </button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {templates.length === 0 && !editing ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-700 p-6 text-center">
          <Sparkles className="w-7 h-7 mx-auto text-amber-400 mb-2" />
          <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No quick-fill templates yet</div>
          <div className="text-[11px] text-gray-500 mt-1">Create one per common presentation — the doctor taps it during a consultation to fill the notes.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {shared.length > 0 && (
            <TemplateGroup title="Shared with everyone" icon={<Users className="w-3.5 h-3.5" />} items={shared} onEdit={setEditing} onRemove={remove} />
          )}
          {[...byDoctor.entries()].map(([docId, items]) => (
            <TemplateGroup key={docId} title={doctorName(docId) ? `Dr. ${doctorName(docId)}` : `Doctor #${docId}`} icon={<User className="w-3.5 h-3.5" />} items={items} onEdit={setEditing} onRemove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateGroup({ title, icon, items, onEdit, onRemove }: {
  title: string; icon: React.ReactNode; items: ClinicalQuickTemplate[];
  onEdit: (t: ClinicalQuickTemplate) => void; onRemove: (id: string, name: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1.5">{icon} {title}</div>
      <div className="space-y-1.5">
        {items.map((t) => (
          <div key={t.id} className={cn('flex items-center gap-3 rounded-lg border border-gray-200 dark:border-slate-700 p-2.5')}>
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{t.name}</div>
              <div className="text-[11px] text-gray-500">{t.category}{t.follow_up_days ? ` · follow-up ${t.follow_up_days}d` : ''}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => onEdit(t)}><Pencil className="w-3.5 h-3.5" /></button>
            <button className="btn-ghost text-xs text-red-600" onClick={() => onRemove(t.id, t.name)}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
