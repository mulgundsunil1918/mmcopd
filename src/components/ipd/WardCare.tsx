import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Stethoscope, ClipboardList, Droplets, UtensilsCrossed, Loader2, Plus, Pill, Users, Check, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, fmtDateTime } from '../../lib/utils';
import { promptDialog } from '../../lib/promptDialog';

type Section = 'vitals' | 'meds' | 'notes' | 'nursing' | 'io' | 'diet' | 'xconsult';

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
    { id: 'meds', label: 'Medications', icon: Pill },
    { id: 'notes', label: 'Doctor Notes', icon: Stethoscope },
    { id: 'nursing', label: 'Nursing', icon: ClipboardList },
    { id: 'io', label: 'Intake / Output', icon: Droplets },
    { id: 'diet', label: 'Diet', icon: UtensilsCrossed },
    { id: 'xconsult', label: 'Consults', icon: Users },
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
      {section === 'meds' && <MedsSection admissionId={admissionId} />}
      {section === 'notes' && <NotesSection admissionId={admissionId} />}
      {section === 'nursing' && <NursingSection admissionId={admissionId} />}
      {section === 'io' && <IoSection admissionId={admissionId} />}
      {section === 'diet' && <DietSection admissionId={admissionId} />}
      {section === 'xconsult' && <XConsultSection admissionId={admissionId} />}
    </div>
  );
}

// ===================================================================
// Medication Administration Record (MAR)
function MedsSection({ admissionId }: { admissionId: number }) {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [drug, setDrug] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('IV');
  const [freq, setFreq] = useState('');
  const [drugMasterId, setDrugMasterId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: orders = [] } = useQuery({ queryKey: ['ip-meds', admissionId], queryFn: () => window.electronAPI.ipd.medOrders(admissionId) });
  const { data: drugMatches = [] } = useQuery({
    queryKey: ['drug-search-mar', drug],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ q: drug, activeOnly: true }),
    enabled: drug.trim().length >= 2 && drugMasterId === null,
  });

  const addOrder = async () => {
    if (!drug.trim()) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.ipd.medOrderAdd(admissionId, { drug_name: drug, drug_master_id: drugMasterId, dose, route, frequency: freq });
      if (r.ok) { toast('Medication ordered', 'success'); setDrug(''); setDose(''); setFreq(''); setDrugMasterId(null); qc.invalidateQueries({ queryKey: ['ip-meds', admissionId] }); }
      else toast(r.error || 'Could not add', 'error');
    } catch (e: any) { toast(e?.message || 'Could not add', 'error'); }
    finally { setBusy(false); }
  };

  const give = async (order: any) => {
    const qtyStr = await promptDialog(`Quantity of "${order.drug_name}" given?\n(0 = record without touching pharmacy stock)`, { type: 'number', defaultValue: order.drug_master_id ? '1' : '0', confirmLabel: 'Give' });
    if (qtyStr === null) return;
    const r = await window.electronAPI.ipd.medAdminGive(order.id, { status: 'given', qty: Number(qtyStr) || 0, administered_by: user?.username });
    if (r.ok) { toast(r.billed ? 'Given — stock reduced and billed' : 'Recorded as given', 'success'); qc.invalidateQueries({ queryKey: ['ip-meds', admissionId] }); qc.invalidateQueries({ queryKey: ['bill-preview', admissionId] }); }
    else toast(r.error || 'Could not record', 'error');   // e.g. insufficient stock message
  };

  const stop = async (order: any) => {
    const r = await window.electronAPI.ipd.medOrderStop(order.id);
    if (r.ok) qc.invalidateQueries({ queryKey: ['ip-meds', admissionId] });
    else toast(r.error || 'Could not stop', 'error');
  };

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-2">
        <div className="relative">
          <input className="input" placeholder="Drug name (type to match pharmacy stock)" value={drug}
            onChange={(e) => { setDrug(e.target.value); setDrugMasterId(null); }} />
          {drug.trim().length >= 2 && drugMasterId === null && drugMatches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow">
              {drugMatches.slice(0, 8).map((dm: any) => (
                <button key={dm.id} className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-[12px] border-b last:border-0 border-gray-100 dark:border-slate-800"
                  onClick={() => { setDrug(dm.name); setDrugMasterId(dm.id); }}>
                  {dm.name} <span className="text-[10px] text-gray-400">· stock {dm.stock ?? dm.total_stock ?? '?'}</span>
                </button>
              ))}
            </div>
          )}
          {drugMasterId && <span className="text-[10px] text-emerald-600">✓ linked to pharmacy stock — administering will deplete stock and bill</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className="input" placeholder="Dose (e.g. 500mg)" value={dose} onChange={(e) => setDose(e.target.value)} />
          <select className="input" value={route} onChange={(e) => setRoute(e.target.value)}>
            <option>IV</option><option>IM</option><option>Oral</option><option>SC</option><option>Topical</option><option>Nebulised</option>
          </select>
          <input className="input" placeholder="Frequency (e.g. BD, TDS)" value={freq} onChange={(e) => setFreq(e.target.value)} />
          <button className="btn-primary text-xs" disabled={busy || !drug.trim()} onClick={addOrder}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Order
          </button>
        </div>
      </div>

      {orders.length === 0 ? <Empty label="No medications ordered" /> : (
        <div className="space-y-2">
          {orders.map((o: any) => (
            <div key={o.id} className={cn('card p-3', o.status !== 'active' && 'opacity-60')}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                    {o.drug_name} {o.dose && <span className="text-gray-500 font-normal">{o.dose}</span>}
                    {o.drug_master_id ? <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">stocked</span> : null}
                  </div>
                  <div className="text-[11px] text-gray-500">{o.route} · {o.frequency || '—'} · given {o.given_count}× · {o.status}</div>
                </div>
                {o.status === 'active' && (
                  <div className="flex gap-1.5">
                    <button className="btn-primary text-xs" onClick={() => give(o)}><Check className="w-3.5 h-3.5" /> Give dose</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => stop(o)} title="Stop order"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================================================================
function XConsultSection({ admissionId }: { admissionId: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const { data: consults = [] } = useQuery({ queryKey: ['ip-xconsult', admissionId], queryFn: () => window.electronAPI.ipd.xconsults(admissionId) });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const request = async () => {
    if (!doctorId) { toast('Pick a doctor', 'error'); return; }
    const r = await window.electronAPI.ipd.xconsultAdd(admissionId, Number(doctorId), reason);
    if (r.ok) { toast('Consultation requested', 'success'); setReason(''); setDoctorId(''); qc.invalidateQueries({ queryKey: ['ip-xconsult', admissionId] }); }
    else toast(r.error || 'Could not request', 'error');
  };

  const respond = async (c: any) => {
    const opinion = (await promptDialog(`Opinion from Dr. ${c.doctor_name}:`, { multiline: true, confirmLabel: 'Save' })) ?? '';
    if (!opinion) return;
    const r = await window.electronAPI.ipd.xconsultRespond(c.id, opinion);
    if (r.ok) qc.invalidateQueries({ queryKey: ['ip-xconsult', admissionId] });
    else toast(r.error || 'Could not save', 'error');
  };

  return (
    <div className="space-y-3">
      <div className="card p-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="label">Refer to</label>
          <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— doctor —</option>
            {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <input className="input flex-[2] min-w-[200px]" placeholder="Reason for consultation" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn-primary text-xs" onClick={request}><Plus className="w-3.5 h-3.5" /> Request</button>
      </div>
      {consults.length === 0 ? <Empty label="No cross-consultations" /> : (
        <div className="space-y-2">
          {consults.map((c: any) => (
            <div key={c.id} className="card p-3">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Dr. {c.doctor_name}</div>
                <span className={cn('px-1.5 py-0.5 rounded text-[10px]', c.status === 'seen' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{c.status}</span>
              </div>
              {c.reason && <div className="text-[12px] text-gray-600 dark:text-slate-400 mt-0.5">{c.reason}</div>}
              {c.opinion ? <div className="text-[12px] text-gray-800 dark:text-slate-200 mt-1 bg-gray-50 dark:bg-slate-800 rounded p-2">{c.opinion}</div>
                : <button className="btn-ghost text-xs mt-1" onClick={() => respond(c)}>Add opinion</button>}
            </div>
          ))}
        </div>
      )}
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
