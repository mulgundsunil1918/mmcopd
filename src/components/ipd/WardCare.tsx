import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Stethoscope, ClipboardList, Droplets, UtensilsCrossed, Loader2, Plus } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, fmtDateTime } from '../../lib/utils';

type Section = 'vitals' | 'notes' | 'nursing' | 'io' | 'diet';

/**
 * The in-ward clinical record for one admission: vitals, doctor progress notes,
 * nursing notes, intake/output and diet orders. Each section reads from and
 * writes to its own IPC channel; a failed save surfaces the backend's message
 * verbatim rather than a generic error.
 */
export function WardCare({ admissionId }: { admissionId: number }) {
  const [section, setSection] = useState<Section>('vitals');

  const tabs: { id: Section; label: string; icon: any }[] = [
    { id: 'vitals', label: 'Vitals', icon: Activity },
    { id: 'notes', label: 'Doctor Notes', icon: Stethoscope },
    { id: 'nursing', label: 'Nursing', icon: ClipboardList },
    { id: 'io', label: 'Intake / Output', icon: Droplets },
    { id: 'diet', label: 'Diet', icon: UtensilsCrossed },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setSection(t.id)}
            className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition',
              section === t.id ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                : 'text-gray-600 dark:text-slate-400 hover:text-gray-900')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {section === 'vitals' && <VitalsSection admissionId={admissionId} />}
      {section === 'notes' && <NotesSection admissionId={admissionId} />}
      {section === 'nursing' && <NursingSection admissionId={admissionId} />}
      {section === 'io' && <IoSection admissionId={admissionId} />}
      {section === 'diet' && <DietSection admissionId={admissionId} />}
    </div>
  );
}

// ---- shared save wrapper ----
function useSectionSave(reloadKey: any[]) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.ok === false) { toast(r.error || 'Could not save', 'error'); return false; }
      toast(okMsg, 'success');
      await qc.invalidateQueries({ queryKey: reloadKey });
      return true;
    } catch (e: any) {
      toast(e?.message || 'Could not save', 'error');
      return false;
    } finally { setBusy(false); }
  };
  return { busy, run };
}

// ===================================================================
function VitalsSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const { busy, run } = useSectionSave(['ip-clinical', 'vitals', admissionId]);
  const [f, setF] = useState<any>({});
  const { data: rows = [] } = useQuery({
    queryKey: ['ip-clinical', 'vitals', admissionId],
    queryFn: () => window.electronAPI.ipd.vitalsList(admissionId),
  });

  const submit = async () => {
    const ok = await run(() => window.electronAPI.ipd.vitalsAdd(admissionId, { ...f, recorded_by: user?.username }), 'Vitals recorded');
    if (ok) setF({});
  };

  const Field = ({ k, label, unit }: { k: string; label: string; unit?: string }) => (
    <div>
      <label className="label">{label}{unit ? ` (${unit})` : ''}</label>
      <input className="input" type="number" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field k="temperature" label="Temp" unit="°F" />
          <Field k="pulse" label="Pulse" unit="/min" />
          <Field k="respiration" label="Resp" unit="/min" />
          <Field k="spo2" label="SpO₂" unit="%" />
          <Field k="bp_systolic" label="BP sys" />
          <Field k="bp_diastolic" label="BP dia" />
          <Field k="pain_score" label="Pain" unit="0-10" />
          <div className="flex items-end">
            <button className="btn-primary text-xs w-full" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Record
            </button>
          </div>
        </div>
      </div>
      <VitalsTable rows={rows} />
    </div>
  );
}

function VitalsTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <Empty label="No vitals recorded yet" />;
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b dark:border-slate-700">
            <th className="p-2">Time</th><th className="p-2">Temp</th><th className="p-2">Pulse</th>
            <th className="p-2">Resp</th><th className="p-2">BP</th><th className="p-2">SpO₂</th>
            <th className="p-2">Pain</th><th className="p-2">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="p-2 whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
              <td className="p-2">{r.temperature ?? '—'}</td>
              <td className="p-2">{r.pulse ?? '—'}</td>
              <td className="p-2">{r.respiration ?? '—'}</td>
              <td className="p-2">{r.bp_systolic ? `${r.bp_systolic}/${r.bp_diastolic}` : '—'}</td>
              <td className="p-2">{r.spo2 ?? '—'}</td>
              <td className="p-2">{r.pain_score ?? '—'}</td>
              <td className="p-2 text-gray-500">{r.recorded_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===================================================================
function NotesSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const { busy, run } = useSectionSave(['ip-clinical', 'notes', admissionId]);
  const [note, setNote] = useState('');
  const { data: rows = [] } = useQuery({
    queryKey: ['ip-clinical', 'notes', admissionId],
    queryFn: () => window.electronAPI.ipd.notesList(admissionId),
  });
  const submit = async () => {
    if (!note.trim()) return;
    const ok = await run(() => window.electronAPI.ipd.notesAdd(admissionId, { note, recorded_by: user?.username }), 'Note added');
    if (ok) setNote('');
  };
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <textarea className="input" rows={3} placeholder="Progress note — findings, plan, orders…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary text-xs mt-2" disabled={busy || !note.trim()} onClick={submit}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add note
        </button>
      </div>
      <NoteList rows={rows} field="note" />
    </div>
  );
}

function NursingSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const { busy, run } = useSectionSave(['ip-clinical', 'nursing', admissionId]);
  const [note, setNote] = useState('');
  const [shift, setShift] = useState('Morning');
  const { data: rows = [] } = useQuery({
    queryKey: ['ip-clinical', 'nursing', admissionId],
    queryFn: () => window.electronAPI.ipd.nursingList(admissionId),
  });
  const submit = async () => {
    if (!note.trim()) return;
    const ok = await run(() => window.electronAPI.ipd.nursingAdd(admissionId, { note, shift, recorded_by: user?.username }), 'Nursing note added');
    if (ok) setNote('');
  };
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex gap-2 mb-2">
          <select className="input w-40" value={shift} onChange={(e) => setShift(e.target.value)}>
            <option>Morning</option><option>Evening</option><option>Night</option>
          </select>
        </div>
        <textarea className="input" rows={3} placeholder="Nursing note…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary text-xs mt-2" disabled={busy || !note.trim()} onClick={submit}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add nursing note
        </button>
      </div>
      <NoteList rows={rows} field="note" showShift />
    </div>
  );
}

function NoteList({ rows, field, showShift }: { rows: any[]; field: string; showShift?: boolean }) {
  if (rows.length === 0) return <Empty label="Nothing recorded yet" />;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="card p-3">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
            <span>{fmtDateTime(r.noted_at)} {showShift && r.shift ? `· ${r.shift}` : ''}</span>
            <span>{r.recorded_by ?? ''}</span>
          </div>
          <div className="text-[13px] text-gray-900 dark:text-slate-100 whitespace-pre-wrap">{r[field]}</div>
        </div>
      ))}
    </div>
  );
}

// ===================================================================
function IoSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const { busy, run } = useSectionSave(['ip-clinical', 'io', admissionId]);
  const [kind, setKind] = useState<'intake' | 'output'>('intake');
  const [route, setRoute] = useState('Oral');
  const [vol, setVol] = useState('');
  const { data: rows = [] } = useQuery({
    queryKey: ['ip-clinical', 'io', admissionId],
    queryFn: () => window.electronAPI.ipd.ioList(admissionId),
  });
  const balance = rows.reduce((s: number, r: any) => s + (r.kind === 'intake' ? r.volume_ml : -r.volume_ml), 0);
  const submit = async () => {
    if (!vol) return;
    const ok = await run(() => window.electronAPI.ipd.ioAdd(admissionId, { kind, route, volume_ml: Number(vol), recorded_by: user?.username }), 'Recorded');
    if (ok) setVol('');
  };
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="intake">Intake</option><option value="output">Output</option>
          </select>
          <input className="input" placeholder="Route (Oral, IV, Urine…)" value={route} onChange={(e) => setRoute(e.target.value)} />
          <input className="input" type="number" placeholder="Volume (ml)" value={vol} onChange={(e) => setVol(e.target.value)} />
          <button className="btn-primary text-xs" disabled={busy || !vol} onClick={submit}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
          </button>
        </div>
      </div>
      <div className="card p-3 flex items-center justify-between">
        <span className="text-[12px] text-gray-500">Running balance (intake − output)</span>
        <span className={cn('text-lg font-bold tabular-nums', balance >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {balance >= 0 ? '+' : ''}{balance} ml
        </span>
      </div>
      {rows.length === 0 ? <Empty label="No intake/output recorded" /> : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
              <th className="p-2">Time</th><th className="p-2">Type</th><th className="p-2">Route</th><th className="p-2">Volume</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="p-2 whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                  <td className="p-2"><span className={cn('px-1.5 py-0.5 rounded text-[10px]', r.kind === 'intake' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{r.kind}</span></td>
                  <td className="p-2">{r.route ?? '—'}</td>
                  <td className="p-2 tabular-nums">{r.volume_ml} ml</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===================================================================
function DietSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const { busy, run } = useSectionSave(['ip-clinical', 'diet', admissionId]);
  const [diet, setDiet] = useState('');
  const [instr, setInstr] = useState('');
  const { data: rows = [] } = useQuery({
    queryKey: ['ip-clinical', 'diet', admissionId],
    queryFn: () => window.electronAPI.ipd.dietList(admissionId),
  });
  const submit = async () => {
    if (!diet.trim()) return;
    const ok = await run(() => window.electronAPI.ipd.dietAdd(admissionId, { diet_type: diet, instructions: instr, ordered_by: user?.username }), 'Diet order added');
    if (ok) { setDiet(''); setInstr(''); }
  };
  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-2">
        <input className="input" placeholder="Diet type (Normal, Diabetic, Soft, NBM…)" value={diet} onChange={(e) => setDiet(e.target.value)} />
        <input className="input" placeholder="Instructions (optional)" value={instr} onChange={(e) => setInstr(e.target.value)} />
        <button className="btn-primary text-xs" disabled={busy || !diet.trim()} onClick={submit}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add diet order
        </button>
      </div>
      {rows.length === 0 ? <Empty label="No diet orders" /> : (
        <div className="space-y-2">
          {rows.map((r: any) => (
            <div key={r.id} className="card p-3">
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{r.diet_type}</div>
              {r.instructions && <div className="text-[12px] text-gray-600 dark:text-slate-400">{r.instructions}</div>}
              <div className="text-[10px] text-gray-500 mt-1">{fmtDateTime(r.start_at)} · {r.ordered_by ?? ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-center text-[12px] text-gray-400 py-6">{label}</div>;
}
