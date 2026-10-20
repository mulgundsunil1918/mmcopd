/**
 * The clinic's calendar day.
 *
 * Every timestamp the database writes is UTC, but "today", "this month" and "the 29th" mean the day on the
 * PC's own clock. `new Date().toISOString().slice(0, 10)` gives the UTC date — which in India is
 * YESTERDAY between 00:00 and 05:30 — and `new Date('2026-10-21T00:00:00').toISOString()` is 18:30 the
 * evening before, so adding days that way lands a day early. These helpers do the arithmetic on the
 * calendar itself, in the machine's local zone, so no hour of the day can change the answer.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as YYYY-MM-DD in the PC's local time zone. Defaults to now. */
export function localISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD plus a number of calendar days (negative allowed) — pure calendar arithmetic, no time zone involved. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** First day of the month containing `iso`. */
export const startOfMonthISO = (iso: string): string => `${iso.slice(0, 7)}-01`;
