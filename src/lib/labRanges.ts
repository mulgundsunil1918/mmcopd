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
