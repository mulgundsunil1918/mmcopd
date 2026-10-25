/**
 * Reading what ChatGPT (or anyone) typed into the bill Excel — carefully, never creatively.
 *
 * Every function here either returns what was written, understood exactly, or says it could not (null / a problem text). Nothing is ever
 * "corrected" into a different number or date: a value that cannot be read with certainty comes back empty so the screen asks a person.
 */

/** Text from a cell: empty for nothing / NaN, single spaces, no stray line breaks. */
export function cleanText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A number from a cell. Understands "1,234.50", "₹ 78.4", "78.4/-", "Rs.100", "12%", "1." (a dot left after the digit), and a real number.
 * Anything else — letters, two numbers, "10+2" — is null, never a guess.
 */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = cleanText(v);
  if (!t) return null;
  const s = t.replace(/^(rs\.?|inr|₹)\s*/i, '').replace(/\/-$/, '').replace(/%$/, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(s)) return null;
  const n = Number(s.endsWith('.') ? s.slice(0, -1) : s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 2-digit years are 2000–2069 (these are expiry dates and recent bill dates, never the 1900s). */
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
const validYMD = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);

/** A date the spreadsheet itself stored (a JS Date): the calendar day it shows, whatever the time zone nudged the time to. */
function ymdOfDate(d: Date): [number, number, number] {
  const x = new Date(d.getTime() + 12 * 3600 * 1000);          // noon: a few minutes either side of midnight still lands on the same day
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
}

export interface ParsedDate { iso: string | null; problem?: string }

/**
 * A bill's own date: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (also 2-digit years), YYYY-MM-DD, "28 Apr 2024", "05-Aug-25", a real date cell.
 * Indian bills put the DAY first; "03/04/2026" is the 3rd of April. Not understood → iso null with the reason.
 */
export function parseBillDate(v: unknown): ParsedDate {
  if (v instanceof Date) { const [y, m, d] = ymdOfDate(v); return validYMD(y, m, d) ? { iso: `${y}-${pad(m)}-${pad(d)}` } : { iso: null, problem: 'That date is not valid.' }; }
  const t = cleanText(v);
  if (!t) return { iso: null };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYMD(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { iso: null, problem: `"${t}" is not a valid date.` };
  }
  if ((m = t.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/))) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(Number(m[3]))];
    return validYMD(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { iso: null, problem: `"${t}" is not a valid date (day first: DD-MM-YYYY).` };
  }
  if ((m = t.match(/^(\d{1,2})[-/. ]?([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})$/)) && MONTHS[m[2].toLowerCase()]) {
    const [d, mo, y] = [Number(m[1]), MONTHS[m[2].toLowerCase()], fullYear(Number(m[3]))];
    return validYMD(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { iso: null, problem: `"${t}" is not a valid date.` };
  }
  return { iso: null, problem: `Could not read "${t}" as a date.` };
}

/**
 * An expiry. Packs print a MONTH and a YEAR, and a batch is good to the END of that month, so a month gives the last day of it:
 * "03-2026", "03/2026", "03/26", "3/26", "2026-03", "Mar-26", "March 2026" → 2026-03-31. A full date (DD-MM-YYYY) is kept as it is.
 * "25/10" (could be 25th of October, or year 25 / month 10) is NOT guessed.
 */
export function parseExpiry(v: unknown): ParsedDate {
  if (v instanceof Date) {                                    // a real date cell: a month-and-year typed into Excel comes through as the 1st of that month
    const [y, m, d] = ymdOfDate(v);
    if (!validYMD(y, m, d)) return { iso: null, problem: 'That expiry date is not valid.' };
    return { iso: d === 1 ? `${y}-${pad(m)}-${pad(lastDay(y, m))}` : `${y}-${pad(m)}-${pad(d)}` };
  }
  const t = cleanText(v);
  if (!t) return { iso: null };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})$/))) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    return validYMD(y, mo, 1) ? { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` } : { iso: null, problem: `"${t}" is not a valid expiry.` };
  }
  if ((m = t.match(/^(\d{1,2})\s*[-/.]\s*(\d{4})$/))) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    return validYMD(y, mo, 1) ? { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` } : { iso: null, problem: `"${t}" is not a valid expiry.` };
  }
  if ((m = t.match(/^(\d{1,2})\s*[-/.]\s*(\d{2})$/))) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a >= 1 && a <= 12) return { iso: `${fullYear(b)}-${pad(a)}-${pad(lastDay(fullYear(b), a))}` };
    return { iso: null, problem: `Cannot tell the month from the year in "${t}" — type it as month/year, like 03/2026.` };
  }
  if ((m = t.match(/^([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})$/)) && MONTHS[m[1].toLowerCase()]) {
    const [mo, y] = [MONTHS[m[1].toLowerCase()], fullYear(Number(m[2]))];
    return { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
  }
  const full = parseBillDate(t);
  if (full.iso) return full;
  return { iso: null, problem: `Could not read "${t}" as an expiry (month and year).` };
}

/** What a bill calls a batch that is not a batch. */
export function looksLikePlaceholderBatch(b: string): boolean {
  const t = cleanText(b).toLowerCase();
  return /^(new batch|newbatch|na|n\/a|nil|none|null|batch|batch no\.?|unknown|\?+|x+|-+|\.+|0+)$/.test(t) || /^(new|old|same|ditto|do)\b/.test(t);
}

/** The words a name is compared by: lower case, letters and digits, single spaces. */
export function simplify(s: string): string {
  return cleanText(s).toLowerCase().replace(/[^a-z0-9.%+ऀ-ॿ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
