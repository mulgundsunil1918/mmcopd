/**
 * IAP 2015 growth reference (Indian Academy of Pediatrics), 5–18 years.
 *
 * Unlike WHO (which we hold as LMS parameters), the IAP charts are published as
 * smoothed percentile tables — height, weight and BMI at the 3rd…97th centiles
 * for each half-year of age. We interpolate linearly between the tabulated ages,
 * exactly as the printed IAP charts are read. Data: src/data/peds/iap-2015.json,
 * extracted from the pediaid IAP 2015 chart. For under-5s the IAP endorses WHO,
 * so this reference deliberately starts at 5 years and WHO covers 0–5.
 *
 * BMI note: the IAP BMI chart's top two lines are not percentiles but the
 * adult-equivalent overweight (≡23) and obesity (≡27) cut-offs, per IAP 2015.
 */
import iap from '../../data/peds/iap-2015.json';
import type { Sex } from './growth';

export type IapMetric = 'ht' | 'wt' | 'bmi';

const SEX_KEY: Record<Sex, 'boy' | 'girl'> = { M: 'boy', F: 'girl' };

export const IAP_RANGE_Y = { min: 5, max: 18 };

/** Column labels for each metric's percentile table. */
export const IAP_LABELS: Record<IapMetric, string[]> = (iap as any).percentiles;

/** Numeric centiles behind the ht/wt columns (used to name the child's band). */
const HTWT_CENTILES = [3, 10, 25, 50, 75, 90, 97];

export const IAP_METRIC_LABEL: Record<IapMetric, string> = {
  ht: 'Height-for-age', wt: 'Weight-for-age', bmi: 'BMI-for-age',
};
export const IAP_UNIT: Record<IapMetric, string> = { ht: 'cm', wt: 'kg', bmi: 'kg/m²' };

function table(metric: IapMetric, sex: Sex): Record<string, number[]> {
  return (iap as any).data[SEX_KEY[sex]][metric];
}

/** All tabulated ages (years), ascending. */
function ages(metric: IapMetric, sex: Sex): number[] {
  return Object.keys(table(metric, sex)).map(Number).sort((a, b) => a - b);
}

/** The percentile line values across age — for plotting. */
export function iapCurves(metric: IapMetric, sex: Sex): { ageY: number; values: number[] }[] {
  const t = table(metric, sex);
  return ages(metric, sex).map((ageY) => ({ ageY, values: t[formatAge(ageY)] }));
}

/** JSON keys are "5", "5.5" … — match how the extractor wrote them. */
function formatAge(ageY: number): string {
  return Number.isInteger(ageY) ? String(ageY) : String(ageY);
}

/**
 * The percentile values (interpolated) at an exact age in years, or null if the
 * age is outside 5–18 so we never plot or assess out of range.
 */
export function iapPercentilesAt(metric: IapMetric, sex: Sex, ageY: number): number[] | null {
  const t = table(metric, sex);
  const a = ages(metric, sex);
  if (ageY < a[0] || ageY > a[a.length - 1]) return null;
  let lo = a[0], hi = a[a.length - 1];
  for (let i = 0; i < a.length - 1; i++) {
    if (ageY >= a[i] && ageY <= a[i + 1]) { lo = a[i]; hi = a[i + 1]; break; }
  }
  const vlo = t[formatAge(lo)], vhi = t[formatAge(hi)];
  if (hi === lo) return vlo.slice();
  const f = (ageY - lo) / (hi - lo);
  return vlo.map((v, i) => v + (vhi[i] - v) * f);
}

export interface IapResult {
  metric: IapMetric;
  band: string;
  flag: 'low' | 'normal' | 'high';
  inRange: boolean;
}

/**
 * Where a measurement falls on the IAP chart. For height/weight the band is the
 * percentile interval (e.g. "25th–50th"); < 3rd flags low, > 97th flags high.
 * For BMI the overweight/obesity cut-offs drive the high flag.
 */
export function iapAssess(metric: IapMetric, sex: Sex, ageY: number, value: number): IapResult {
  const p = iapPercentilesAt(metric, sex, ageY);
  if (!p || !(value > 0)) return { metric, band: 'out of range', flag: 'normal', inRange: false };

  if (metric === 'bmi') {
    // columns: [3,5,10,25,50, OW(≡23), Ob(≡27)]
    const [c3, , , , c50, ow, ob] = p;
    if (value >= ob) return { metric, band: 'Obese (≥ IAP obesity line)', flag: 'high', inRange: true };
    if (value >= ow) return { metric, band: 'Overweight (≥ IAP overweight line)', flag: 'high', inRange: true };
    if (value < c3) return { metric, band: '< 3rd (thin)', flag: 'low', inRange: true };
    if (value < c50) return { metric, band: '3rd–50th', flag: 'normal', inRange: true };
    return { metric, band: '50th–overweight', flag: 'normal', inRange: true };
  }

  // height / weight
  if (value < p[0]) return { metric, band: '< 3rd', flag: 'low', inRange: true };
  if (value > p[6]) return { metric, band: '> 97th', flag: 'high', inRange: true };
  for (let i = 0; i < p.length - 1; i++) {
    if (value >= p[i] && value <= p[i + 1]) {
      return { metric, band: `${HTWT_CENTILES[i]}th–${HTWT_CENTILES[i + 1]}th`, flag: 'normal', inRange: true };
    }
  }
  return { metric, band: 'on a centile line', flag: 'normal', inRange: true };
}

/** Map a WHO chart id to its IAP metric, if one exists (no head-circ in IAP). */
export function iapMetricForWhoChart(chart: string): IapMetric | null {
  if (chart === 'lhfa') return 'ht';
  if (chart === 'wfa') return 'wt';
  if (chart === 'bfa') return 'bmi';
  return null;
}
