/**
 * What this computer believes the time is — so "the registered time looks wrong" can be settled
 * in one glance instead of a guessing game.
 *
 * Every timestamp the app stores (registration, bills, lab and radiology orders…) is held in UTC and
 * shown in THIS PC's time zone. So if a PC's Windows time zone is wrong (a US region left on from
 * installation, say), every time on that PC is wrong by the same amount, consistently — the app has
 * nothing to correct, the PC does. These helpers just make that visible.
 */
export interface ClockInfo {
  /** IANA name, e.g. "Asia/Calcutta". */
  zone: string;
  /** Minutes east of UTC (India = 330). */
  offsetMinutes: number;
  /** "UTC+05:30" */
  offsetLabel: string;
  /** True for India Standard Time (UTC+05:30) — what CureDesk clinics are expected to run on. */
  isIndia: boolean;
}

export function clockInfo(now: Date = new Date()): ClockInfo {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* very old runtime */ }
  const off = -now.getTimezoneOffset();
  const a = Math.abs(off);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    zone,
    offsetMinutes: off,
    offsetLabel: `UTC${off >= 0 ? '+' : '−'}${p(Math.floor(a / 60))}:${p(a % 60)}`,
    isIndia: off === 330,
  };
}
