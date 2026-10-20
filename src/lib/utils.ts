import clsx, { type ClassValue } from 'clsx';
import { differenceInDays, differenceInMonths, differenceInYears, parseISO, format, differenceInMinutes, subDays, subMonths, subYears } from 'date-fns';

export const cn = (...classes: ClassValue[]) => clsx(classes);

export function age(dob: string): number {
  try {
    return differenceInYears(new Date(), parseISO(dob));
  } catch {
    return 0;
  }
}

/** Exact Y / M / D breakdown — important for pediatric (newborns + infants). */
export function ageDetailed(dob: string): { years: number; months: number; days: number } {
  try {
    const d = parseISO(dob);
    const now = new Date();
    const years = differenceInYears(now, d);
    const afterYears = subYears(now, years);
    const months = differenceInMonths(afterYears, d);
    const afterMonths = subMonths(afterYears, months);
    const days = differenceInDays(afterMonths, d);
    return { years, months, days };
  } catch {
    return { years: 0, months: 0, days: 0 };
  }
}

/** Full Y/M/D age label, omits zero parts. e.g. "5y 2m 18d", "18d", "2m 5d", "32y 4m". */
export function ageStringFull(dob: string): string {
  const { years, months, days } = ageDetailed(dob);
  if (years === 0 && months === 0 && days === 0) return 'Today (0d)';
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (days > 0) parts.push(`${days}d`);
  return parts.join(' ');
}

/** Smart age label: >=1yr → "Xy Ym", >=6m → "Nm", else "Nm Dd" or "Dd". */
export function ageString(dob: string): string {
  try {
    const d = parseISO(dob);
    const now = new Date();
    const years = differenceInYears(now, d);
    if (years >= 1) {
      const afterYears = subYears(now, years);
      const months = differenceInMonths(afterYears, d);
      return months > 0 ? `${years}y ${months}m` : `${years}y`;
    }
    const months = differenceInMonths(now, d);
    if (months >= 6) return `${months}m`;
    const afterMonths = subMonths(now, months);
    const days = differenceInDays(afterMonths, d);
    if (months > 0) return `${months}m ${days}d`;
    return `${days}d`;
  } catch {
    return '—';
  }
}

/** Compute a synthetic DOB from age components so we can store only DOB. */
export function dobFromAge(years: number, months: number, days: number): string {
  let d = new Date();
  if (years) d = subYears(d, years);
  if (months) d = subMonths(d, months);
  if (days) d = subDays(d, days);
  return format(d, 'yyyy-MM-dd');
}

/**
 * Universal date format across the app: ordinal day + full month + year,
 * e.g. "27th April 2026". Override with the second arg only for special
 * cases — every plain user-facing date should go through fmtDate() with no
 * pattern so the whole app stays consistent.
 */
/**
 * Parse a timestamp from the database into a correct Date.
 *
 * Our tables store timestamps two ways: the SQLite column default `datetime('now')`
 * returns UTC as "YYYY-MM-DD HH:MM:SS" (no 'T', no 'Z'), while explicit writes use
 * `new Date().toISOString()` ("…Z"). `parseISO`/`new Date()` read the first form as
 * LOCAL time, so every default-stamped time (e.g. patient registration) printed off
 * by the machine's UTC offset — 5:30 behind in IST — which looked like a "random /
 * wrong registered time". Here a timezone-LESS datetime is normalised to explicit
 * UTC; a value that already carries a 'Z'/offset, or a date-only value, is left to
 * parseISO (both already correct). No timestamp is stored as local time, so reading
 * the bare form as UTC is the right fix.
 */
export function parseDbDate(d: string | Date | null | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  // "YYYY-MM-DD HH:MM[:SS][.fff]" with no timezone marker → it's UTC from SQLite.
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/.exec(d.trim());
  const date = m ? new Date(`${m[1]}T${m[2]}Z`) : parseISO(d);
  return isNaN(date.getTime()) ? null : date;
}

// A missing or malformed date returns an em-dash instead of throwing
// "Invalid time value", which would otherwise crash whatever screen renders it.
export function fmtDate(d: string | Date | null | undefined, pattern = 'do MMMM yyyy') {
  const date = parseDbDate(d);
  if (!date) return '—';
  return format(date, pattern);
}

export function fmtDateTime(d: string | Date | null | undefined) {
  const date = parseDbDate(d);
  if (!date) return '—';
  return format(date, "do MMMM yyyy '·' hh:mm a");
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function fmt12h(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (Number.isNaN(h)) return time24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Generate booking time slots at fixed intervals.
 *
 *  When `availableFrom` / `availableTo` ("HH:MM") are provided (the doctor's
 *  configured window), slots are restricted to inside that window — no
 *  greyed-out struck-through slots cluttering the picker. Otherwise we
 *  default to a wide 6 AM – 11 PM range so late-evening doctors still get
 *  full slot coverage.
 *
 *  durationMin is the spacing between slots (e.g. 30 for half-hour slots).
 *  endHour is exclusive (`endHour=18` stops at 17:30 for 30-min slots).
 */
export function generateTimeSlots(
  durationMin = 30,
  startHour = 6,
  endHour = 23,
  availableFrom?: string | null,
  availableTo?: string | null,
): string[] {
  // If the doctor has a configured window, snap the iteration bounds to it.
  let startMin = startHour * 60;
  let endMin = endHour * 60;
  const parseHHMM = (s: string | null | undefined): number | null => {
    if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
    const [h, m] = s.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const fromMin = parseHHMM(availableFrom);
  const toMin = parseHHMM(availableTo);
  if (fromMin != null) startMin = Math.max(startMin, fromMin);
  if (toMin != null) endMin = Math.min(endMin, toMin);
  // Round startMin UP to next slot boundary so the first slot is at-or-after the doctor's open time.
  if (durationMin > 0 && startMin % durationMin !== 0) {
    startMin = startMin + (durationMin - (startMin % durationMin));
  }
  const slots: string[] = [];
  for (let t = startMin; t <= endMin; t += durationMin) {
    const h = Math.floor(t / 60), m = t % 60;
    if (h > 23) break;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
}

export function waitMinutes(appointmentTime: string, appointmentDate: string): number {
  try {
    const target = new Date(`${appointmentDate}T${appointmentTime}:00`);
    return Math.max(0, differenceInMinutes(new Date(), target));
  } catch {
    return 0;
  }
}

export function formatINR(n: number): string {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A fresh id for ONE save attempt. The screen sends it with a purchase, payment or sale; if the same
 * attempt reaches the main process twice (double click, lost reply, retry) the second one returns the
 * first record instead of posting stock and money again.
 */
export function newRef(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** `base` tied to the exact content being saved: the same retry keeps its id, an edited one gets a new id. */
export function refFor(base: string, content: unknown): string {
  const s = JSON.stringify(content) ?? '';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${base}:${(h >>> 0).toString(36)}`;
}
