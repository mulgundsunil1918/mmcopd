/**
 * Normal values (reference ranges) for lab results — the pure rules, shared by the screens, the main process, the defaults and the tests.
 *
 * A test can have PARAMETERS (a CBC has Hb, TLC, platelets …), each with a unit and a normal range: one range for everybody, or a different one for men and
 * women, or a normal TEXT for qualitative results ("Negative", "Non-reactive"). The lab types the value; the app marks it H (high) or L (low) — or A (abnormal) for
 * a qualitative result that is not the normal text — and prints the range beside it. A report keeps the range it was entered against: editing the normal
 * values later never changes a report already made.
 */

export interface RangeSpec {
  low: number | null; high: number | null;
  m_low: number | null; m_high: number | null;
  f_low: number | null; f_high: number | null;
  /** Normal text for a qualitative result, or free text shown as the range ("< 100 (optimal)"). */
  ref_text: string | null;
  /** The value is shown but never flagged (colour, appearance …). */
  no_flag: boolean;
}
export type Sex = 'M' | 'F' | null;
export type Flag = '' | 'H' | 'L' | 'A';

export const sexOf = (gender: string | null | undefined): Sex => {
  const g = String(gender ?? '').trim().toUpperCase();
  return g.startsWith('M') ? 'M' : g.startsWith('F') ? 'F' : null;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fmt = (n: number) => (Number.isInteger(n) && Math.abs(n) >= 1000 ? n.toLocaleString('en-IN') : String(n));       // 4,000 · 1,50,000 — grouped the way Indian labs print them

/** The low / high that apply to this person (a sex-specific range wins when the sex is known and that range exists). */
export function boundsFor(r: Partial<RangeSpec>, sex: Sex): { low: number | null; high: number | null } {
  if (sex === 'M' && (num(r.m_low) !== null || num(r.m_high) !== null)) return { low: num(r.m_low), high: num(r.m_high) };
  if (sex === 'F' && (num(r.f_low) !== null || num(r.f_high) !== null)) return { low: num(r.f_low), high: num(r.f_high) };
  return { low: num(r.low), high: num(r.high) };
}

const show = (low: number | null, high: number | null) => (low !== null && high !== null ? `${fmt(low)} - ${fmt(high)}` : high !== null ? `< ${fmt(high)}` : low !== null ? `> ${fmt(low)}` : '');

/** What is printed in the "Reference" column. Sex unknown but the range differs: both are shown ("M 13 - 17 · F 12 - 15"). */
export function rangeText(r: Partial<RangeSpec>, sex: Sex): string {
  const sexSpecific = (num(r.m_low) !== null || num(r.m_high) !== null) || (num(r.f_low) !== null || num(r.f_high) !== null);
  if (sexSpecific && sex === null) {
    const m = show(num(r.m_low), num(r.m_high)); const f = show(num(r.f_low), num(r.f_high));
    return [m && `M ${m}`, f && `F ${f}`].filter(Boolean).join(' · ');
  }
  const { low, high } = boundsFor(r, sex);
  const t = show(low, high);
  return t || (r.ref_text ? String(r.ref_text) : '');
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** H / L for a number outside its range; A for a qualitative result that is not the normal text; '' when fine, blank or not flagged. */
export function flagFor(value: unknown, r: Partial<RangeSpec>, sex: Sex): Flag {
  const raw = String(value ?? '').trim(); if (!raw || r.no_flag) return '';
  const { low, high } = boundsFor(r, sex);
  const n = /^[<>]?\s*-?[\d,]*\.?\d+/.test(raw) ? Number(raw.replace(/[<>,\s]/g, '')) : NaN;
  if (Number.isFinite(n) && (low !== null || high !== null)) {
    if (low !== null && n < low) return 'L';
    if (high !== null && n > high) return 'H';
    return '';
  }
  if (r.ref_text && low === null && high === null) return norm(raw) === norm(r.ref_text) ? '' : 'A';
  return '';
}

/**
 * One line of a default panel, written compactly:  range = "13-17"  (everybody) · "M13-17;F12-15" (by sex) · "<140" (up to) · ">40" (at least) · "Negative" (normal text)
 * · "<100|optimal below 100" (a number to flag by and the words to print).
 */
export function parseRangeSpec(spec: string): Partial<RangeSpec> {
  const s = String(spec ?? '').trim(); if (!s) return {};
  const [main, words] = s.split('|');
  const one = (t: string): { low: number | null; high: number | null } => {
    const m = /^(-?[\d.]+)\s*-\s*(-?[\d.]+)$/.exec(t.trim()); if (m) return { low: Number(m[1]), high: Number(m[2]) };
    const lt = /^<\s*=?\s*(-?[\d.]+)$/.exec(t.trim()); if (lt) return { low: null, high: Number(lt[1]) };
    const gt = /^>\s*=?\s*(-?[\d.]+)$/.exec(t.trim()); if (gt) return { low: Number(gt[1]), high: null };
    return { low: null, high: null };
  };
  if (/^[MF]\s*[<>\d-]/.test(main)) {
    const out: Partial<RangeSpec> = {};
    for (const part of main.split(';')) {
      const sx = part.trim()[0]; const b = one(part.trim().slice(1));
      if (sx === 'M') { out.m_low = b.low; out.m_high = b.high; } else if (sx === 'F') { out.f_low = b.low; out.f_high = b.high; }
    }
    return out;
  }
  const b = one(main);
  if (b.low !== null || b.high !== null) return { low: b.low, high: b.high, ref_text: words ?? null };
  return { ref_text: main };
}

// ── age groups ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Children are not small adults, so a parameter can have its own normal range for each AGE GROUP — and, inside a group, for boys and girls. There are five groups:
 *   Newborn (under 28 days) · Infant (to 1 year) · Child (to 12 years) · Adolescent (to 18 years) · Adult (the parameter's ordinary range).
 * The limits are the lab's to change (once, for every test). The group is worked out from the date of birth on the day of the test and the sex from the patient —
 * nobody has to choose. A group left blank means "same as the adult range".
 */
export type AgeGroup = 'newborn' | 'infant' | 'child' | 'adolescent' | 'adult';
export type ChildGroup = Exclude<AgeGroup, 'adult'>;
export const CHILD_GROUPS: ChildGroup[] = ['newborn', 'infant', 'child', 'adolescent'];
export const GROUP_NAMES: Record<AgeGroup, string> = { newborn: 'Newborn', infant: 'Infant', child: 'Child', adolescent: 'Adolescent', adult: 'Adult' };

/** Where one group ends and the next begins, in the units people think in. */
export interface AgeLimits { newborn_days: number; infant_months: number; child_years: number; adolescent_years: number }
export const DEFAULT_LIMITS: AgeLimits = { newborn_days: 28, infant_months: 12, child_years: 12, adolescent_years: 18 };

export type AgeUnit = 'days' | 'months' | 'years';
export const unitToDays = (n: number, unit: AgeUnit) => Math.round(n * (unit === 'years' ? 365.25 : unit === 'months' ? 30.4375 : 1));
/** The four limits as days: a patient younger than the first is a newborn, younger than the second an infant, and so on; from the last one on, an adult. */
const limitDays = (l: AgeLimits) => [l.newborn_days, unitToDays(l.infant_months, 'months'), unitToDays(l.child_years, 'years'), unitToDays(l.adolescent_years, 'years')];

/** What is wrong with a set of limits, in words — or null when they are fine. */
export function limitProblem(l: Partial<AgeLimits> | null | undefined): string | null {
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? NaN : Number(x));
  const [nb, inf, ch, ad] = [v(l?.newborn_days), v(l?.infant_months), v(l?.child_years), v(l?.adolescent_years)];
  if (![nb, inf, ch, ad].every((x) => Number.isInteger(x))) return 'Each age limit must be a whole number.';
  if (nb < 1 || nb > 90) return 'The newborn limit must be between 1 and 90 days.';
  if (inf < 2 || inf > 36) return 'The infant limit must be between 2 and 36 months.';
  if (ch < 2 || ch > 18) return 'The child limit must be between 2 and 18 years.';
  if (ad < 10 || ad > 25) return 'The adolescent limit must be between 10 and 25 years.';
  const d = limitDays({ newborn_days: nb, infant_months: inf, child_years: ch, adolescent_years: ad });
  if (!(d[0] < d[1] && d[1] < d[2] && d[2] < d[3])) return 'Each limit must be later than the one before it (newborn, infant, child, adolescent).';
  return null;
}
/** The limits saved in settings (JSON), or the standard ones when nothing valid is saved. */
export function parseLimits(json: string | null | undefined): AgeLimits {
  try { const o = json ? JSON.parse(json) : null; if (o && !limitProblem(o)) return { newborn_days: o.newborn_days, infant_months: o.infant_months, child_years: o.child_years, adolescent_years: o.adolescent_years }; } catch { /* fall through */ }
  return { ...DEFAULT_LIMITS };
}

/** The age group a patient is in; null when the age is unknown. */
export function groupOf(ageDays: number | null, l: AgeLimits = DEFAULT_LIMITS): AgeGroup | null {
  if (ageDays === null) return null;
  const d = limitDays(l);
  return ageDays < d[0] ? 'newborn' : ageDays < d[1] ? 'infant' : ageDays < d[2] ? 'child' : ageDays < d[3] ? 'adolescent' : 'adult';
}
/** "under 28 days" · "28 days to under 1 year" · "1 year to under 12 years" · "12 to under 18 years" · "18 years and over" — what each group covers. */
export function groupSpans(l: AgeLimits = DEFAULT_LIMITS): Record<AgeGroup, string> {
  const yrs = (n: number) => `${n} year${n === 1 ? '' : 's'}`; const infantEnd = l.infant_months % 12 === 0 ? yrs(l.infant_months / 12) : `${l.infant_months} months`;
  return { newborn: `under ${l.newborn_days} days`, infant: `${l.newborn_days} days to under ${infantEnd}`, child: `${infantEnd} to under ${yrs(l.child_years)}`,
    adolescent: `${l.child_years} to under ${yrs(l.adolescent_years)}`, adult: `${yrs(l.adolescent_years)} and over` };
}

/** One age group's normal range for a parameter — the same shape as the ordinary range: everyone, and/or men, and/or women (here: boys / girls), or words. */
export interface AgeRange extends RangeSpec { id?: number; grp: ChildGroup }
/** Does a range carry any number (for anybody)? */
export const hasNumbers = (r: Partial<RangeSpec>) => [r.low, r.high, r.m_low, r.m_high, r.f_low, r.f_high].some((v) => num(v) !== null);
const hasSexValues = (r: Partial<RangeSpec>) => [r.m_low, r.m_high, r.f_low, r.f_high].some((v) => num(v) !== null);

/** Whole days from the date of birth to a day (both 'YYYY-MM-DD' or a database timestamp); null when either is missing or the order is impossible. */
export function ageInDays(dob: string | null | undefined, on: string | null | undefined): number | null {
  const a = String(dob ?? '').slice(0, 10); const b = String(on ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const d = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}
/** "5 days" · "3 months" · "4 years" — for the line that says whose normal ranges these are. */
export function ageText(days: number | null): string {
  if (days === null) return '';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) { const m = Math.floor(days / 30.4375); return `${m} month${m === 1 ? '' : 's'}`; }
  const y = Math.floor(days / 365.25); return `${y} year${y === 1 ? '' : 's'}`;
}

export interface Resolved {
  low: number | null; high: number | null; ref_text: string | null; no_flag: boolean;
  /** The range printed beside the result ("11.5 - 14.5", "M 13 - 17 · F 12 - 15", "Negative"). */
  text: string;
  /** The range came from an age group (not the ordinary adult range). */
  by_age: boolean;
  /** The range is a sex-specific one and the sex is known. */
  by_sex: boolean;
  group: AgeGroup | null;
}
/**
 * THE choice of normal range for one patient: the parameter's range for the patient's age group (men / women inside it when it has them), or — for an adult, an
 * age group left blank, or an unknown age — the ordinary range (men / women / everyone). Nothing is guessed: a range for boys only is not used for a patient of unknown sex.
 */
export function pickRange(p: Partial<RangeSpec> & { ranges?: AgeRange[] }, ageDays: number | null, sex: Sex, limits: AgeLimits = DEFAULT_LIMITS): Resolved {
  const group = groupOf(ageDays, limits);
  const row = group && group !== 'adult' ? p.ranges?.find((r) => r.grp === group) : undefined;
  if (row) {
    const b = boundsFor(row, sex);
    if (b.low !== null || b.high !== null || row.ref_text) return { ...b, ref_text: row.ref_text ?? null, no_flag: !!row.no_flag, text: rangeText(row, sex), by_age: true, by_sex: sex !== null && hasSexValues(row), group };
  }
  const b = boundsFor(p, sex);
  return { ...b, ref_text: p.ref_text ?? null, no_flag: !!p.no_flag, text: rangeText(p, sex), by_age: false, by_sex: sex !== null && hasSexValues(p), group };
}
