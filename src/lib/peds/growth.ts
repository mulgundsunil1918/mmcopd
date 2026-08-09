/**
 * Paediatric growth: z-scores and centiles from the WHO LMS reference.
 *
 * Data (src/data/peds/who-lms.json) is the WHO Child Growth Standards L, M, S
 * parameters per day of age, extracted from the WHO expanded z-score tables
 * bundled in the pediaid project. Charts: weight-for-age (wfa), length/height-
 * for-age (lhfa), head-circumference-for-age (hcfa), BMI-for-age (bfa); boys
 * and girls; 0–5 years (0–1856 days).
 *
 * The LMS method (Cole & Green):
 *   z = ((X/M)^L − 1) / (L·S)     for L ≠ 0
 *   z = ln(X/M) / S               for L = 0
 * Centile = Φ(z), the standard-normal CDF.
 *
 * Pure functions, no UI, so the clinical maths is unit-tested on its own.
 */

import lms from '../../data/peds/who-lms.json';

export type GrowthChart = 'wfa' | 'lhfa' | 'hcfa' | 'bfa';
export type Sex = 'M' | 'F';

const SEX_KEY: Record<Sex, string> = { M: 'boys', F: 'girls' };

export interface LmsPoint { day: number; L: number; M: number; S: number; }

const CHART_LABEL: Record<GrowthChart, string> = {
  wfa: 'Weight-for-age',
  lhfa: 'Length/Height-for-age',
  hcfa: 'Head circumference-for-age',
  bfa: 'BMI-for-age',
};

export function chartLabel(c: GrowthChart): string { return CHART_LABEL[c]; }

/** Rows are [day, L, M, S]. */
function seriesFor(chart: GrowthChart, sex: Sex): number[][] | null {
  const key = `${chart}-${SEX_KEY[sex]}`;
  const s = (lms as Record<string, number[][]>)[key];
  return Array.isArray(s) ? s : null;
}

/** Highest age (days) the bundled data covers for this chart. */
export function maxDayFor(chart: GrowthChart, sex: Sex): number {
  const s = seriesFor(chart, sex);
  return s && s.length ? s[s.length - 1][0] : 0;
}

/**
 * L, M, S for an exact age in days, linearly interpolated between the two
 * nearest tabulated days. Returns null if the age is outside the data range,
 * so a caller never silently plots an out-of-range point.
 */
export function lmsAt(chart: GrowthChart, sex: Sex, ageDays: number): LmsPoint | null {
  const s = seriesFor(chart, sex);
  if (!s || s.length === 0) return null;
  if (ageDays < s[0][0] || ageDays > s[s.length - 1][0]) return null;

  // Binary search for the bracketing rows.
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= ageDays) lo = mid; else hi = mid;
  }
  const [d0, l0, m0, s0] = s[lo];
  const [d1, l1, m1, s1] = s[hi];
  if (d1 === d0) return { day: d0, L: l0, M: m0, S: s0 };
  const t = (ageDays - d0) / (d1 - d0);
  return {
    day: ageDays,
    L: l0 + (l1 - l0) * t,
    M: m0 + (m1 - m0) * t,
    S: s0 + (s1 - s0) * t,
  };
}

/** z-score of a measured value against the LMS point. */
export function zScoreFromLms(value: number, p: LmsPoint): number {
  if (!(value > 0) || !(p.M > 0) || !(p.S > 0)) return NaN;
  if (Math.abs(p.L) < 1e-7) return Math.log(value / p.M) / p.S;
  return (Math.pow(value / p.M, p.L) - 1) / (p.L * p.S);
}

/** Value at a given z-score (inverse LMS) — used to draw reference curves. */
export function valueAtZ(z: number, p: LmsPoint): number {
  if (Math.abs(p.L) < 1e-7) return p.M * Math.exp(p.S * z);
  return p.M * Math.pow(1 + p.L * p.S * z, 1 / p.L);
}

/**
 * Standard-normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation.
 * Max absolute error ~1.5e-7 — well within clinical needs.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export interface GrowthResult {
  chart: GrowthChart;
  sex: Sex;
  ageDays: number;
  value: number;
  z: number;
  centile: number;         // 0–100
  /** Human band for the centile, e.g. "3rd–15th". */
  band: string;
  /** Clinical flag when the z-score is outside ±2. */
  flag: 'normal' | 'low' | 'high';
  inRange: boolean;
}

function centileBand(c: number): string {
  if (c < 0.1) return '< 0.1st';
  if (c < 3) return '< 3rd';
  if (c < 15) return '3rd–15th';
  if (c < 50) return '15th–50th';
  if (c < 85) return '50th–85th';
  if (c < 97) return '85th–97th';
  return '> 97th';
}

/** Full assessment of a single measurement. */
export function assessGrowth(chart: GrowthChart, sex: Sex, ageDays: number, value: number): GrowthResult {
  const p = lmsAt(chart, sex, ageDays);
  if (!p) {
    return { chart, sex, ageDays, value, z: NaN, centile: NaN, band: 'out of range', flag: 'normal', inRange: false };
  }
  const z = zScoreFromLms(value, p);
  const centile = normalCdf(z) * 100;
  const flag: GrowthResult['flag'] = z < -2 ? 'low' : z > 2 ? 'high' : 'normal';
  return { chart, sex, ageDays, value, z, centile, band: centileBand(centile), flag, inRange: true };
}

/** Reference curve for plotting: value at each SD line across the age range. */
export function referenceCurves(chart: GrowthChart, sex: Sex, zLines = [-3, -2, 0, 2, 3]): { day: number; values: number[] }[] {
  const s = seriesFor(chart, sex);
  if (!s) return [];
  return s.map(([day, L, M, S]) => ({
    day,
    values: zLines.map((z) => valueAtZ(z, { day, L, M, S })),
  }));
}

// ===== Age-independent calculators =====

/**
 * Mid-parental (target) height in cm.
 * Boy: (father + mother + 13) / 2;  Girl: (father + mother − 13) / 2.
 * Target range is ±8.5 cm (roughly ±2 SD of the prediction).
 */
export function midParentalHeight(fatherCm: number, motherCm: number, sex: Sex): { target: number; low: number; high: number } | null {
  if (!(fatherCm > 0) || !(motherCm > 0)) return null;
  const target = sex === 'M' ? (fatherCm + motherCm + 13) / 2 : (fatherCm + motherCm - 13) / 2;
  return { target: round1(target), low: round1(target - 8.5), high: round1(target + 8.5) };
}

/**
 * Corrected age for prematurity, and postmenstrual age.
 * chronoDays: age since birth. gestWeeks/gestDays: gestational age at birth.
 * Correction applies until 2 years (24 months) chronological, per convention.
 */
export function correctedAge(chronoDays: number, gestWeeks: number, gestDays = 0): {
  chronoDays: number; correctedDays: number; correctionDays: number; pmaWeeks: number; correctionApplied: boolean;
} {
  const termDays = 40 * 7;
  const gaDays = gestWeeks * 7 + gestDays;
  const correction = Math.max(0, termDays - gaDays);
  const applies = chronoDays <= 2 * 365;
  const corrected = applies ? Math.max(0, chronoDays - correction) : chronoDays;
  const pmaWeeks = (gaDays + chronoDays) / 7;
  return {
    chronoDays,
    correctedDays: Math.round(corrected),
    correctionDays: correction,
    pmaWeeks: round1(pmaWeeks),
    correctionApplied: applies && correction > 0,
  };
}

/** BMI from weight (kg) and height (cm). */
export function bmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return round1(weightKg / (m * m));
}

/** Age in days between two ISO dates (birth → visit). */
export function ageInDays(dobISO: string, onISO?: string): number {
  const dob = new Date(dobISO).getTime();
  const on = onISO ? new Date(onISO).getTime() : Date.now();
  if (Number.isNaN(dob) || Number.isNaN(on)) return NaN;
  return Math.floor((on - dob) / 86_400_000);
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
