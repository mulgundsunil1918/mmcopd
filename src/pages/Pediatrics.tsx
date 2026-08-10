import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Baby, Search, Ruler, Syringe, Calculator, Loader2, Plus, Check, TrendingUp, RefreshCw } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDate } from '../lib/utils';
import {
  assessGrowth, ageInDays, bmi as calcBmi, midParentalHeight, correctedAge,
  type GrowthChart, type Sex,
} from '../lib/peds/growth';
import { GrowthChartPanel } from '../components/peds/GrowthChartPanel';

/**
 * Pediatrics add-on. Growth centiles (WHO), the immunisation diary, and the
 * common calculators. Sex and age come from the selected patient's record so
 * the doctor only enters the measurement.
 */
type Tab = 'growth' | 'vaccines' | 'calculators';

export function Pediatrics() {
  const [patient, setPatient] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('growth');

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: results = [] } = useQuery({
    queryKey: ['peds-patient-search', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: q.trim().length >= 2 && !patient,
  });

  const tabs = ([
    { id: 'growth', label: 'Growth & Centiles', icon: Ruler, on: settings?.peds_growth_enabled !== false },
    { id: 'vaccines', label: 'Vaccine Diary', icon: Syringe, on: settings?.peds_vaccines_enabled !== false },
    { id: 'calculators', label: 'Calculators', icon: Calculator, on: settings?.peds_calculators_enabled !== false },
  ] as { id: Tab; label: string; icon: any; on: boolean }[]).filter((t) => t.on);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Baby className="w-5 h-5 text-pink-500" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Pediatrics</h1>
      </div>

      {/* Patient picker */}
      {patient ? (
        <div className="card p-3 flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
            <div className="text-[11px] text-gray-500">
              {patient.uhid} · {patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender}
              {patient.dob && ` · DOB ${fmtDate(patient.dob)} · ${ageLabel(patient.dob)}`}
            </div>
          </div>
          <button className="btn-ghost text-xs" onClick={() => { setPatient(null); setQ(''); }}>Change patient</button>
        </div>
      ) : (
        <div className="card p-4">
          <label className="label">Select a child</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9" placeholder="Search by name, phone or UHID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          {q.trim().length >= 2 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700">
              {results.length === 0 ? <div className="p-3 text-[12px] text-gray-400">No patients found.</div> :
                results.map((p: any) => (
                  <button key={p.id} onClick={() => setPatient(p)} className="w-full text-left px-3 py-2 hover:bg-pink-50 dark:hover:bg-pink-900/20 border-b last:border-0 border-gray-100 dark:border-slate-800">
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                    <div className="text-[11px] text-gray-500">{p.uhid} · {p.dob ? ageLabel(p.dob) : 'no DOB'}</div>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {patient && (
        <>
          <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 w-fit">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition',
                  tab === t.id ? 'bg-white dark:bg-slate-900 text-pink-700 dark:text-pink-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'growth' && <GrowthSection patient={patient} />}
          {tab === 'vaccines' && <VaccineSection patient={patient} />}
          {tab === 'calculators' && <CalculatorsSection patient={patient} />}
        </>
      )}
    </div>
  );
}

// ===================================================================
function GrowthSection({ patient }: { patient: any }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const sex: Sex = patient.gender === 'F' ? 'F' : 'M';
  const [measuredOn, setMeasuredOn] = useState(new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [hc, setHc] = useState('');
  const [busy, setBusy] = useState(false);

  const ageDays = patient.dob ? ageInDays(patient.dob, measuredOn) : NaN;

  const { data: history = [] } = useQuery({
    queryKey: ['peds-growth', patient.id],
    queryFn: () => window.electronAPI.peds.growthList(patient.id),
  });

  // Live centiles as the doctor types.
  const assess = useMemo(() => {
    if (!Number.isFinite(ageDays)) return null;
    const out: Record<string, any> = {};
    if (Number(weight) > 0) out.wfa = assessGrowth('wfa', sex, ageDays, Number(weight));
    if (Number(height) > 0) out.lhfa = assessGrowth('lhfa', sex, ageDays, Number(height));
    if (Number(hc) > 0) out.hcfa = assessGrowth('hcfa', sex, ageDays, Number(hc));
    if (Number(weight) > 0 && Number(height) > 0) {
      const b = calcBmi(Number(weight), Number(height));
      if (b) out.bfa = assessGrowth('bfa', sex, ageDays, b);
    }
    return out;
  }, [weight, height, hc, ageDays, sex]);

  const save = async () => {
    if (!Number.isFinite(ageDays)) { toast('This child has no date of birth on record — add it in Reception to compute centiles.', 'error'); return; }
    if (!(Number(weight) > 0 || Number(height) > 0 || Number(hc) > 0)) { toast('Enter at least one measurement', 'error'); return; }
    setBusy(true);
    try {
      const b = (Number(weight) > 0 && Number(height) > 0) ? calcBmi(Number(weight), Number(height)) : null;
      const r = await window.electronAPI.peds.growthAdd(patient.id, {
        measured_on: measuredOn, age_days: ageDays,
        weight_kg: Number(weight) || null, height_cm: Number(height) || null, head_circ_cm: Number(hc) || null, bmi: b,
        wfa_z: assess?.wfa?.z ?? null, wfa_c: assess?.wfa?.centile ?? null,
        lhfa_z: assess?.lhfa?.z ?? null, lhfa_c: assess?.lhfa?.centile ?? null,
        hcfa_z: assess?.hcfa?.z ?? null, hcfa_c: assess?.hcfa?.centile ?? null,
        bfa_z: assess?.bfa?.z ?? null, bfa_c: assess?.bfa?.centile ?? null,
        recorded_by: user?.username,
      });
      if (r.ok) { toast('Measurement saved', 'success'); setWeight(''); setHeight(''); setHc(''); qc.invalidateQueries({ queryKey: ['peds-growth', patient.id] }); }
      else toast(r.error || 'Could not save', 'error');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label">Measured on</label><input className="input" type="date" value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)} /></div>
          <div><label className="label">Weight (kg)</label><input className="input" type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
          <div><label className="label">Height/Length (cm)</label><input className="input" type="number" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} /></div>
          <div><label className="label">Head circ. (cm)</label><input className="input" type="number" step="0.1" value={hc} onChange={(e) => setHc(e.target.value)} /></div>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          {Number.isFinite(ageDays) ? <>Age at measurement: <b>{Math.floor(ageDays / 30.44)} months</b> ({ageDays} days) · Sex: <b>{sex === 'M' ? 'Boy' : 'Girl'}</b> · WHO 0–5y reference</> :
            <span className="text-amber-600">No date of birth on record — centiles need the child's DOB.</span>}
        </div>

        {/* Live centiles */}
        {assess && Object.keys(assess).length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {(['wfa', 'lhfa', 'hcfa', 'bfa'] as GrowthChart[]).map((c) => {
              const a = assess[c]; if (!a) return null;
              return (
                <div key={c} className={cn('rounded-lg border-2 p-2.5',
                  a.flag === 'normal' ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-900/10'
                    : 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20')}>
                  <div className="text-[10px] uppercase text-gray-500">{CHART_SHORT[c]}</div>
                  {a.inRange ? (
                    <>
                      <div className="text-lg font-extrabold text-gray-900 dark:text-slate-100 tabular-nums">{a.centile < 1 ? '<1' : a.centile > 99 ? '>99' : Math.round(a.centile)}<span className="text-[11px] font-normal">th</span></div>
                      <div className="text-[10px] text-gray-500">z = {a.z.toFixed(2)} · {a.band}</div>
                    </>
                  ) : <div className="text-[11px] text-gray-400 mt-1">out of range</div>}
                </div>
              );
            })}
          </div>
        )}

        <button className="btn-primary text-xs mt-3" disabled={busy} onClick={save}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save measurement
        </button>
      </div>

      {/* Visual chart */}
      {history.length > 0 && <GrowthChartPanel history={history} sex={sex} patient={patient} />}

      {/* History */}
      {history.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
              <th className="p-2">Date</th><th className="p-2">Wt</th><th className="p-2">Ht</th><th className="p-2">HC</th><th className="p-2">BMI</th>
              <th className="p-2">Wt %ile</th><th className="p-2">Ht %ile</th></tr></thead>
            <tbody>
              {history.map((m: any) => (
                <tr key={m.id} className="border-b border-gray-50 dark:border-slate-800/50">
                  <td className="p-2 whitespace-nowrap">{fmtDate(m.measured_on)}</td>
                  <td className="p-2">{m.weight_kg ?? '—'}</td>
                  <td className="p-2">{m.height_cm ?? '—'}</td>
                  <td className="p-2">{m.head_circ_cm ?? '—'}</td>
                  <td className="p-2">{m.bmi ?? '—'}</td>
                  <td className="p-2">{m.wfa_c != null ? Math.round(m.wfa_c) + 'th' : '—'}</td>
                  <td className="p-2">{m.lhfa_c != null ? Math.round(m.lhfa_c) + 'th' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CHART_SHORT: Record<GrowthChart, string> = { wfa: 'Weight-for-age', lhfa: 'Height-for-age', hcfa: 'Head circ.', bfa: 'BMI-for-age' };


// ===================================================================
function VaccineSection({ patient }: { patient: any }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['peds-vax', patient.id],
    queryFn: () => window.electronAPI.peds.vaccineList(patient.id),
  });

  const seed = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.peds.vaccineSeed(patient.id);
      if (r.ok) { toast(`Added ${r.added} vaccines from the ${r.schedule} schedule`, 'success'); qc.invalidateQueries({ queryKey: ['peds-vax', patient.id] }); }
      else toast(r.error || 'Could not build the diary', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  // Recompute every due date from the child's DOB using the current schedule
  // logic — fixes a diary built before a schedule correction. Given/skipped
  // doses are left untouched.
  const recalc = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.peds.vaccineRecalc(patient.id);
      if (r.ok) { toast(`Recalculated ${r.updated} due date${r.updated === 1 ? '' : 's'} from date of birth`, 'success'); qc.invalidateQueries({ queryKey: ['peds-vax', patient.id] }); }
      else toast(r.error || 'Could not recalculate', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const markGiven = async (rec: any, givenDate?: string) => {
    const r = await window.electronAPI.peds.vaccineUpdate(rec.id, { status: 'given', given_date: givenDate || new Date().toISOString().slice(0, 10), recorded_by: user?.username });
    if (r.ok) qc.invalidateQueries({ queryKey: ['peds-vax', patient.id] });
    else toast(r.error || 'Could not update', 'error');
  };

  // Un-mark a dose given (mistaken tap) — revert to due/overdue by its due date and clear the date.
  const undoGiven = async (rec: any) => {
    const today = new Date().toISOString().slice(0, 10);
    const revert = rec.due_date && rec.due_date < today ? 'overdue' : 'due';
    const r = await window.electronAPI.peds.vaccineUpdate(rec.id, { status: revert, given_date: null });
    if (r.ok) { toast('Marked not given', 'info'); qc.invalidateQueries({ queryKey: ['peds-vax', patient.id] }); }
    else toast(r.error || 'Could not update', 'error');
  };

  if (isLoading) return <div className="card p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>;

  return (
    <div className="space-y-3">
      {records.length === 0 ? (
        <div className="card p-6 text-center">
          <Syringe className="w-7 h-7 mx-auto text-gray-400 mb-2" />
          <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">No immunisation diary yet</div>
          <div className="text-[11px] text-gray-500 mt-1 mb-3">Build one from the schedule set in Settings → Pediatrics. Due dates are calculated from the child's date of birth.</div>
          <button className="btn-primary text-xs" disabled={busy} onClick={seed}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Build vaccine diary
          </button>
        </div>
      ) : (
        <>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost text-xs" disabled={busy} onClick={recalc}
              title="Recompute every due date from the child's date of birth using the current schedule">
              <RefreshCw className="w-3.5 h-3.5" /> Recalculate dates
            </button>
            <button className="btn-ghost text-xs" disabled={busy} onClick={seed} title="Add any vaccines missing from the current schedule">Refresh from schedule</button>
          </div>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                <th className="p-2">Age</th><th className="p-2">Vaccine</th><th className="p-2">Due</th><th className="p-2">Status</th><th className="p-2 text-right">Action</th></tr></thead>
              <tbody>
                {records.map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50">
                    <td className="p-2 whitespace-nowrap text-gray-500">{r.schedule_age}</td>
                    <td className="p-2 font-medium text-gray-900 dark:text-slate-100">{r.vaccine}{r.dose ? <span className="text-[10px] text-gray-400"> · {r.dose}</span> : null}</td>
                    <td className="p-2 whitespace-nowrap">{r.due_date ? fmtDate(r.due_date) : '—'}</td>
                    <td className="p-2">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                        r.status === 'given' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'overdue' ? 'bg-red-100 text-red-700' :
                        r.status === 'skipped' ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700')}>
                        {r.status}{r.given_date ? ` · ${fmtDate(r.given_date)}` : ''}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      {r.status === 'given' ? (
                        <button className="btn-ghost text-xs text-gray-500 hover:text-red-600" title="Mistake? Un-mark this dose" onClick={() => undoGiven(r)}>Undo</button>
                      ) : (
                        <button className="btn-primary text-xs !py-1" onClick={() => markGiven(r)}><Check className="w-3.5 h-3.5" /> Given</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ===================================================================
function CalculatorsSection({ patient }: { patient: any }) {
  const sex: Sex = patient.gender === 'F' ? 'F' : 'M';
  const [father, setFather] = useState('');
  const [mother, setMother] = useState('');
  const mph = (Number(father) > 0 && Number(mother) > 0) ? midParentalHeight(Number(father), Number(mother), sex) : null;

  const [gestWeeks, setGestWeeks] = useState('');
  const [gestDays, setGestDays] = useState('');
  const chronoDays = patient.dob ? ageInDays(patient.dob) : NaN;
  const ca = (Number(gestWeeks) > 0 && Number.isFinite(chronoDays)) ? correctedAge(chronoDays, Number(gestWeeks), Number(gestDays) || 0) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Mid-parental height */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-100"><TrendingUp className="w-4 h-4 text-violet-500" /> Mid-parental (target) height</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Father's height (cm)</label><input className="input" type="number" value={father} onChange={(e) => setFather(e.target.value)} /></div>
          <div><label className="label">Mother's height (cm)</label><input className="input" type="number" value={mother} onChange={(e) => setMother(e.target.value)} /></div>
        </div>
        {mph && (
          <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 p-3">
            <div className="text-2xl font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">{mph.target} cm</div>
            <div className="text-[11px] text-gray-500">Target range {mph.low}–{mph.high} cm ({sex === 'M' ? 'boy' : 'girl'})</div>
          </div>
        )}
      </div>

      {/* Corrected age */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-100"><Calculator className="w-4 h-4 text-blue-500" /> Corrected age (prematurity)</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Gestation (weeks)</label><input className="input" type="number" value={gestWeeks} onChange={(e) => setGestWeeks(e.target.value)} /></div>
          <div><label className="label">+ days</label><input className="input" type="number" value={gestDays} onChange={(e) => setGestDays(e.target.value)} /></div>
        </div>
        {!Number.isFinite(chronoDays) && <div className="text-[11px] text-amber-600">This child has no DOB on record.</div>}
        {ca && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-1">
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Chronological age</span><b>{Math.floor(ca.chronoDays / 7)}w {ca.chronoDays % 7}d</b></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Corrected age</span><b className="text-blue-700 dark:text-blue-300">{Math.floor(ca.correctedDays / 7)}w {ca.correctedDays % 7}d</b></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Postmenstrual age</span><b>{ca.pmaWeeks} wk</b></div>
            {!ca.correctionApplied && <div className="text-[10px] text-gray-400">Correction no longer applied (past 2 years).</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function ageLabel(dob: string): string {
  const days = ageInDays(dob);
  if (!Number.isFinite(days)) return '';
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)}y ${months % 12}m`;
}
