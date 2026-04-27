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
export function fmtDate(d: string | Date, pattern = 'do MMMM yyyy') {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, pattern);
}

export function fmtDateTime(d: string | Date) {
  const date = typeof d === 'string' ? parseISO(d) : d;
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

export function generateTimeSlots(durationMin = 30, startHour = 9, endHour = 18): string[] {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += durationMin) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
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
