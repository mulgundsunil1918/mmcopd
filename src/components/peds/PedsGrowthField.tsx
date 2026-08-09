import { useMemo } from 'react';
import { assessGrowth, ageInDays, bmi as calcBmi, type GrowthChart, type Sex } from '../../lib/peds/growth';
import { iapAssess, type IapMetric } from '../../lib/peds/iap';

/**
 * A pediatric growth section that lives INSIDE the consultation. The doctor types
 * weight / height / head-circ and the centiles compute live — WHO for under-5s,
 * IAP 2015 for 5–18y. Nothing is shown until a value is entered. The whole thing
 * is stored as one JSON string in the consultation's extra field, so it saves and
 * prints with the slip.
 *
 * Gating (is this shown at all?) is the caller's job — this only renders the UI.
 */
type Vals = { weight?: string; height?: string; hc?: string };

function parse(v: string): Vals { try { return v ? JSON.parse(v) : {}; } catch { return {}; } }

const BAND_CLS: Record<string, string> = {
  low: 'text-amber-700 dark:text-amber-300', high: 'text-red-600 dark:text-red-400', normal: 'text-emerald-700 dark:text-emerald-300',
};

export function PedsGrowthField({ value, onChange, dob, gender }: {
  value: string; onChange: (v: string) => void; dob?: string | null; gender?: string | null;
}) {
  const vals = parse(value);
  const set = (patch: Vals) => onChange(JSON.stringify({ ...vals, ...patch }));

  const ageDays = dob ? ageInDays(dob) : NaN;
  const sex: Sex = gender === 'F' ? 'F' : 'M';
  const ageY = ageDays / 365.25;
  const haveAge = Number.isFinite(ageDays) && ageDays >= 0;

  // Assess one metric: WHO under 5, IAP 5–18. Returns a short band label or null.
  const assess = (whoChart: GrowthChart, iapMetric: IapMetric | null, raw?: string): { band: string; flag: string } | null => {
    const n = Number(raw);
    if (!haveAge || !(n > 0)) return null;
    if (ageY <= 5) {
      const r = assessGrowth(whoChart, sex, ageDays, n);
      if (!r.inRange) return iapMetric ? assessIap(iapMetric, n) : null;
      return { band: `${Math.round(r.centile)}th centile`, flag: r.flag };
    }
    return iapMetric ? assessIap(iapMetric, n) : null;
  };
  const assessIap = (metric: IapMetric, n: number) => {
    const r = iapAssess(metric, sex, ageY, n);
    return r.inRange ? { band: r.band, flag: r.flag } : null;
  };

  const bmiVal = useMemo(() => calcBmi(Number(vals.weight), Number(vals.height)), [vals.weight, vals.height]);

  const wRes = assess('wfa', 'wt', vals.weight);
  const hRes = assess('lhfa', 'ht', vals.height);
  const hcRes = ageY <= 5 ? assess('hcfa', null, vals.hc) : null;
  const bmiRes = bmiVal ? assess('bfa', 'bmi', String(bmiVal)) : null;

  const Result = ({ label, res, extra }: { label: string; res: { band: string; flag: string } | null; extra?: string }) => {
    if (!res && !extra) return null;
    return (
      <div className="text-[11px] mt-0.5">
        <span className="text-gray-500">{label}: </span>
        {extra && <span className="font-semibold text-gray-700 dark:text-slate-200">{extra} </span>}
        {res && <span className={BAND_CLS[res.flag] || ''}>{res.band}{res.flag !== 'normal' ? ` · ${res.flag}` : ''}</span>}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50/40 dark:bg-pink-900/10 p-3">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-pink-700 dark:text-pink-300 mb-2">
        Growth &amp; centiles {haveAge ? <span className="text-gray-400 normal-case font-normal">· {Math.floor(ageDays / 30.44)} mo · {sex === 'M' ? 'boy' : 'girl'} · {ageY <= 5 ? 'WHO' : 'IAP'}</span> : <span className="text-amber-500 normal-case font-normal">· no DOB on record</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
        <div>
          <label className="label">Head circ. (cm)</label>
          <input className="input" inputMode="decimal" value={vals.hc || ''} onChange={(e) => set({ hc: e.target.value.replace(/[^0-9.]/g, '') })} />
          <Result label="HCFA" res={hcRes} />
        </div>
        <div>
          <label className="label">BMI</label>
          <input className="input bg-gray-50 dark:bg-slate-800" value={bmiVal ? String(bmiVal) : ''} readOnly placeholder="auto" />
          <Result label="BMI" res={bmiRes} />
        </div>
      </div>
    </div>
  );
}
