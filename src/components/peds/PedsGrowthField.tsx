import { useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import { assessGrowth, ageInDays, bmi as calcBmi, type GrowthChart, type Sex } from '../../lib/peds/growth';
import { iapAssess, type IapMetric } from '../../lib/peds/iap';
import { Modal } from '../Modal';
import { GrowthChartPanel } from './GrowthChartPanel';

/**
 * A pediatric growth section that lives INSIDE the consultation. The doctor types
 * weight / height (and head-circ for under-5s) and the centiles compute live.
 *
 * Which reference is used follows the child's age, exactly as paediatricians read
 * the printed charts: WHO 0–5y, IAP 2015 5–18y. A clinic can override the default
 * in Settings (`peds_growth_default`), but 'auto' (age-based) is the norm. Head
 * circumference is a WHO-only, under-5 measurement, so that field only appears for
 * children under five. BMI is computed automatically and plotted too.
 *
 * Nothing is shown until a value is entered. The whole thing is stored as one JSON
 * string in the consultation's extra field, so it saves and prints with the slip.
 * A "Growth chart" button opens the visual chart — printable, or push to reception.
 *
 * Gating (is this shown at all?) is the caller's job — this only renders the UI.
 */
type Vals = { weight?: string; height?: string; hc?: string };

function parse(v: string): Vals { try { return v ? JSON.parse(v) : {}; } catch { return {}; } }

const BAND_CLS: Record<string, string> = {
  low: 'text-amber-700 dark:text-amber-300', high: 'text-red-600 dark:text-red-400', normal: 'text-emerald-700 dark:text-emerald-300',
};

/** The reference to use for a given age — 'auto' picks WHO under 5, IAP from 5. */
function effectiveStandard(ageY: number, pref: 'auto' | 'who' | 'iap'): 'who' | 'iap' {
  if (pref === 'who') return 'who';
  if (pref === 'iap') return 'iap';
  return ageY < 5 ? 'who' : 'iap';
}

type Patient = { id?: number; name?: string; uhid?: string; dob?: string | null; gender?: string | null };

export function PedsGrowthField({ value, onChange, patient, defaultStandard = 'auto' }: {
  value: string;
  onChange: (v: string) => void;
  patient: Patient;
  defaultStandard?: 'auto' | 'who' | 'iap';
}) {
  const vals = parse(value);
  const set = (patch: Vals) => onChange(JSON.stringify({ ...vals, ...patch }));
  const [chartOpen, setChartOpen] = useState(false);

  const dob = patient.dob;
  const gender = patient.gender;
  const ageDays = dob ? ageInDays(dob) : NaN;
  const sex: Sex = gender === 'F' ? 'F' : 'M';
  const ageY = ageDays / 365.25;
  const haveAge = Number.isFinite(ageDays) && ageDays >= 0;
  const under5 = haveAge && ageY < 5;
  const std = haveAge ? effectiveStandard(ageY, defaultStandard) : 'iap';

  // Assess one metric. Primary reference follows the child's age; if the value
  // falls outside the primary chart's range we try the other so a dot still lands.
  const assess = (whoChart: GrowthChart, iapMetric: IapMetric | null, raw?: string): { band: string; flag: string; std: string } | null => {
    const n = Number(raw);
    if (!haveAge || !(n > 0)) return null;
    const tryWho = () => {
      const r = assessGrowth(whoChart, sex, ageDays, n);
      // r.band is the clinical band from the WHO reference ("< 3rd", "3rd–15th",
      // "> 97th"…) — never a raw "100th"/"0th" number.
      return r.inRange ? { band: r.band, flag: r.flag, std: 'WHO' } : null;
    };
    const tryIap = () => {
      if (!iapMetric) return null;
      const r = iapAssess(iapMetric, sex, ageY, n);
      return r.inRange ? { band: r.band, flag: r.flag, std: 'IAP' } : null;
    };
    return std === 'who' ? (tryWho() || tryIap()) : (tryIap() || tryWho());
  };

  const bmiVal = useMemo(() => calcBmi(Number(vals.weight), Number(vals.height)), [vals.weight, vals.height]);

  const wRes = assess('wfa', 'wt', vals.weight);
  const hRes = assess('lhfa', 'ht', vals.height);
  const hcRes = under5 ? assess('hcfa', null, vals.hc) : null;
  const bmiRes = bmiVal ? assess('bfa', 'bmi', String(bmiVal)) : null;

  const hasAnyValue = !!(vals.weight || vals.height || (under5 && vals.hc));

  // One measurement row for the chart viewer (the child's dot).
  const history = haveAge && hasAnyValue ? [{
    age_days: ageDays,
    weight_kg: vals.weight ? Number(vals.weight) : null,
    height_cm: vals.height ? Number(vals.height) : null,
    head_circ_cm: under5 && vals.hc ? Number(vals.hc) : null,
    bmi: bmiVal ?? null,
  }] : [];

  const Result = ({ label, res }: { label: string; res: { band: string; flag: string; std: string } | null }) => {
    if (!res) return null;
    return (
      <div className="text-[11px] mt-0.5">
        <span className="text-gray-500">{label}: </span>
        <span className={BAND_CLS[res.flag] || ''}>{res.band}{res.flag !== 'normal' ? ` · ${res.flag}` : ''}</span>
        <span className="text-gray-400"> · {res.std}</span>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50/40 dark:bg-pink-900/10 p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-pink-700 dark:text-pink-300">
          Growth &amp; centiles {haveAge
            ? <span className="text-gray-400 normal-case font-normal">· {Math.floor(ageDays / 30.44)} mo · {sex === 'M' ? 'boy' : 'girl'} · {std === 'who' ? 'WHO 0–5y' : 'IAP 5–18y'}</span>
            : <span className="text-amber-500 normal-case font-normal">· no DOB on record</span>}
        </div>
        {haveAge && hasAnyValue && (
          <button type="button" onClick={() => setChartOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-pink-700 dark:text-pink-300 hover:underline">
            <LineChart className="w-3.5 h-3.5" /> Growth chart / print
          </button>
        )}
      </div>
      <div className={`grid grid-cols-2 gap-2 ${under5 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <div>
          <label className="label">Weight (kg)</label>
          <input className="input" inputMode="decimal" value={vals.weight || ''} onChange={(e) => set({ weight: e.target.value.replace(/[^0-9.]/g, '') })} />
          <Result label="WFA" res={wRes} />
        </div>
        <div>
          <label className="label">Height (cm)</label>
          <input className="input" inputMode="decimal" value={vals.height || ''} onChange={(e) => set({ height: e.target.value.replace(/[^0-9.]/g, '') })} />
          <Result label="HFA" res={hRes} />
        </div>
        {under5 && (
          <div>
            <label className="label">Head circ. (cm)</label>
            <input className="input" inputMode="decimal" value={vals.hc || ''} onChange={(e) => set({ hc: e.target.value.replace(/[^0-9.]/g, '') })} />
            <Result label="HCFA" res={hcRes} />
          </div>
        )}
        <div>
          <label className="label">BMI</label>
          <input className="input bg-gray-50 dark:bg-slate-800" value={bmiVal ? String(bmiVal) : ''} readOnly placeholder="auto" />
          <Result label="BMI" res={bmiRes} />
        </div>
      </div>

      {chartOpen && (
        <Modal open onClose={() => setChartOpen(false)} title="Growth chart" size="lg">
          <GrowthChartPanel
            history={history}
            sex={sex}
            patient={{ id: patient.id, name: patient.name, uhid: patient.uhid, dob: patient.dob, gender: patient.gender }}
            initialStandard={std}
          />
          <p className="text-[10px] text-gray-400 mt-2">
            Plotted from today’s measurement. Use “Send to reception” to add it to the Print Jobs inbox, or “Print chart” for the letterhead copy.
          </p>
        </Modal>
      )}
    </div>
  );
}
