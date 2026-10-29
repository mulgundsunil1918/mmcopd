/**
 * Accounts — the words, the settings shapes and the small pure rules (no database here, so the screen, the main process, the demo and the tests share them).
 *
 * Owner's rule (2026-10-29): every number has ONE home. Accounts = rupees; Analytics = people and visits. A doctor's pay is whatever the CLINIC decides
 * (Settings → Doctors & Templates → "Pay and cuts"); a voucher records exactly what was paid and whatever is left stays "to pay" — nothing is written off.
 */

// ── Vouchers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const VOUCHER_TYPES = [
  { id: 'clinic_maintenance', label: 'Clinic maintenance', prefix: 'CM', payee: 'other', hint: 'Small things bought for the clinic — hand wash, a bulb, a repair.' },
  { id: 'expense', label: 'Expense', prefix: 'EXP', payee: 'other', hint: 'Any other running cost — rent, electricity, internet, printing.' },
  { id: 'staff_salary', label: 'Staff salary', prefix: 'SAL', payee: 'staff', hint: 'Monthly pay to a member of staff.' },
  { id: 'doctor_payment', label: 'Doctor payment', prefix: 'DOC', payee: 'doctor', hint: 'Pay a doctor what the clinic owes them.' },
  { id: 'advance', label: 'Advance', prefix: 'ADV', payee: 'staff', hint: 'Money given to a staff member before their salary; recover it on the salary voucher.' },
  { id: 'referral_payment', label: 'Referral payment', prefix: 'REF', payee: 'referrer', hint: 'Pay an outside doctor who refers patients.' },
] as const;
export type VoucherTypeId = typeof VOUCHER_TYPES[number]['id'];
export type PayeeKind = 'staff' | 'doctor' | 'referrer' | 'other';
export const voucherType = (id: string) => VOUCHER_TYPES.find((t) => t.id === id);

export const PAY_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque'] as const;
export type VoucherPayMode = typeof PAY_MODES[number];

export const DEDUCTION_KINDS = [
  { id: 'none', label: 'No deduction' },
  { id: 'tds', label: 'TDS' },
  { id: 'advance', label: 'Advance recovery' },
  { id: 'other', label: 'Other' },
] as const;
export type DeductionKind = typeof DEDUCTION_KINDS[number]['id'];

/** Expense heads a new clinic starts with (it can add its own in Settings → Accounts). */
export const DEFAULT_CATEGORIES = ['Clinic maintenance', 'Consumables', 'Utilities', 'Rent', 'Marketing', 'Equipment', 'Other'];

export interface VoucherInput {
  type: string; date: string;
  payee_kind: PayeeKind; payee_ref?: string | null; payee_name: string;
  category?: string | null; description?: string | null;
  gross: number; deduction?: number; deduction_kind?: string | null; deduction_label?: string | null;
  pay_mode: string; reference?: string | null;
  period_from?: string | null; period_to?: string | null;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money2 = round2;

/** The first thing wrong with a voucher, in words a clinic understands; null when it is fine to save. */
export function voucherProblem(v: VoucherInput): string | null {
  const t = voucherType(v.type);
  if (!t) return 'Choose what kind of voucher this is.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ''))) return 'Pick the date of the voucher.';
  if (!(Number(v.gross) > 0)) return 'Enter the amount (more than zero).';
  const ded = Number(v.deduction || 0);
  if (ded < 0) return 'A deduction cannot be negative.';
  if (ded > Number(v.gross) + 1e-9) return 'The deduction is more than the amount.';
  if (!PAY_MODES.includes(v.pay_mode as VoucherPayMode)) return 'Say how it was paid — cash, UPI, bank transfer or cheque.';
  if (!String(v.payee_name || '').trim()) return t.payee === 'other' ? 'Say who it was paid to.' : 'Choose who is being paid.';
  if ((t.id === 'clinic_maintenance' || t.id === 'expense') && !String(v.description || '').trim()) return 'Say what it was for (for example “hand wash”).';
  if (v.period_from && v.period_to && v.period_from > v.period_to) return 'The “from” day is after the “to” day.';
  return null;
}

/** Voucher number: the type's prefix + a running number that is never reused (CM-0007). */
export function voucherNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
export function numberOfVoucher(no: string): number {
  const m = /-(\d+)$/.exec(String(no || '')); return m ? parseInt(m[1], 10) : 0;
}

// ── Settings shapes (stored as JSON in the settings table → every backup carries them) ────────────────────────────────────────────
export interface RaiseRule { allowed: boolean; limit: number | null }
export interface AcctSettings {
  /** Prefix per voucher type, when the clinic wants its own (default CM, EXP, SAL, DOC, ADV, REF). */
  prefixes: Partial<Record<VoucherTypeId, string>>;
  /** Cash in hand on `opening_date` (the Day book counts from there). */
  opening_cash: number; opening_date: string;
  /** Who may raise a voucher, by role. Admin always may. `limit` = largest amount for that role (blank = any). */
  raise: Record<string, RaiseRule>;
  /** Roles (besides admin) who may cancel a voucher. */
  cancel: string[];
}
export const ACCT_ROLES: { role: string; label: string }[] = [
  { role: 'manager', label: 'Manager' }, { role: 'receptionist', label: 'Receptionist' }, { role: 'staff', label: 'Reception desk (shared)' },
  { role: 'doctor', label: 'Doctor' }, { role: 'pharmacist', label: 'Pharmacist' }, { role: 'nurse', label: 'Nurse' },
];
export const DEFAULT_ACCT_SETTINGS: AcctSettings = { prefixes: {}, opening_cash: 0, opening_date: '', raise: { manager: { allowed: true, limit: null } }, cancel: [] };

export function parseAcctSettings(json: string | null | undefined): AcctSettings {
  let o: any = {};
  try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  const raise: Record<string, RaiseRule> = {};
  for (const [r, v] of Object.entries<any>(o?.raise && typeof o.raise === 'object' ? o.raise : DEFAULT_ACCT_SETTINGS.raise)) {
    const lim = v?.limit === null || v?.limit === '' || v?.limit === undefined ? null : Number(v.limit);
    raise[r] = { allowed: !!v?.allowed, limit: lim !== null && Number.isFinite(lim) && lim > 0 ? lim : null };
  }
  const prefixes: AcctSettings['prefixes'] = {};
  for (const t of VOUCHER_TYPES) { const p = String(o?.prefixes?.[t.id] ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (p) prefixes[t.id] = p; }
  return {
    prefixes,
    opening_cash: Number.isFinite(Number(o?.opening_cash)) ? round2(Number(o.opening_cash)) : 0,
    opening_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o?.opening_date || '')) ? String(o.opening_date) : '',
    raise,
    cancel: Array.isArray(o?.cancel) ? o.cancel.map(String) : [],
  };
}
export const prefixFor = (s: AcctSettings, type: string) => s.prefixes[type as VoucherTypeId] || voucherType(type)?.prefix || 'V';

/** May this role raise a voucher of this size? (Admin: always.) */
export function mayRaise(s: AcctSettings, role: string | undefined, amount = 0): { ok: boolean; reason?: string } {
  if (role === 'admin') return { ok: true };
  const r = role ? s.raise[role] : undefined;
  if (!r?.allowed) return { ok: false, reason: 'Raising vouchers is not switched on for your role. The admin can allow it in Settings → Accounts.' };
  if (r.limit !== null && amount > r.limit) return { ok: false, reason: `Your limit for one voucher is ₹${r.limit}. Ask the admin.` };
  return { ok: true };
}
export const mayCancel = (s: AcctSettings, role: string | undefined) => role === 'admin' || (!!role && s.cancel.includes(role));
/** Can this role see money in the Doctors view (and press Pay)? Same people who may raise vouchers. */
export const maySeeDoctorMoney = (s: AcctSettings, role: string | undefined) => role === 'admin' || (!!role && !!s.raise[role]?.allowed);

// ── Doctor pay and cuts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PayBasis = 'by_hand' | 'fixed_monthly' | 'per_visit' | 'per_visit_type' | 'percent_of_fees' | 'percent_of_revenue' | 'fixed_plus_percent';
export const PAY_BASES: { id: PayBasis; label: string; hint: string }[] = [
  { id: 'by_hand', label: 'I enter it by hand', hint: 'Nothing is worked out; you type the amount on the voucher.' },
  { id: 'fixed_monthly', label: 'Fixed monthly', hint: 'The same amount every month, spread over the days.' },
  { id: 'per_visit', label: 'Per visit', hint: 'A fixed amount for every patient visit.' },
  { id: 'per_visit_type', label: 'Per visit type', hint: 'A different amount for a new patient, a free follow-up and a paid repeat visit.' },
  { id: 'percent_of_fees', label: '% of consultation fees', hint: 'A share of the consultation fees collected.' },
  { id: 'percent_of_revenue', label: '% of the doctor’s revenue', hint: 'A share of what the doctor brings in (you choose what counts).' },
  { id: 'fixed_plus_percent', label: 'Fixed monthly + % of revenue', hint: 'A monthly amount plus a share of the doctor’s revenue.' },
];
export type PartMonth = 'calendar' | 'working' | 'full_months' | 'full';
export const PART_MONTH: { id: PartMonth; label: string; hint: string }[] = [
  { id: 'calendar', label: 'By calendar days', hint: 'Monthly amount ÷ days in the month, for each day.' },
  { id: 'working', label: 'By working days (Sundays off)', hint: 'Monthly amount ÷ working days in the month, for each working day.' },
  { id: 'full_months', label: 'Only full months', hint: 'Nothing is owed for a month until that month is over; then the whole amount.' },
  { id: 'full', label: 'Pay in full', hint: 'The whole monthly amount is owed from the 1st of the month.' },
];
export type CutStream = 'services' | 'pharmacy' | 'lab' | 'radiology' | 'ipd';
export const CUT_STREAMS: { id: CutStream; label: string; hint: string }[] = [
  { id: 'services', label: 'Services & procedures', hint: 'Dressings, injections, procedures billed under this doctor.' },
  { id: 'pharmacy', label: 'Pharmacy (their prescriptions)', hint: 'Medicines sold against this doctor’s visits.' },
  { id: 'lab', label: 'Laboratory', hint: 'Tests ordered by this doctor.' },
  { id: 'radiology', label: 'Radiology', hint: 'Scans ordered by this doctor.' },
  { id: 'ipd', label: 'In-patient doctor visits', hint: 'The “doctor visit” charges on ward bills.' },
];
export interface CutRule { mode: 'off' | 'percent' | 'fixed'; value: number; /** pharmacy only */ base: 'bill' | 'profit' }
export interface DoctorPayRules {
  basis: PayBasis; monthly: number; part_month: PartMonth;
  per_visit: number; per_type: { new: number; free: number; paid: number };
  percent: number;
  counts: { consultation: boolean; services: boolean; pharmacy: boolean; lab: boolean; radiology: boolean };
  cuts: Record<CutStream, CutRule>;
}
export interface ReferrerRule {
  mode: 'off' | 'percent' | 'fixed'; value: number; scope: 'every' | 'first';
  on: { consultation: boolean; services: boolean; pharmacy: boolean; lab: boolean; radiology: boolean };
}
export interface PayRules { doctors: Record<string, DoctorPayRules>; referrers: Record<string, ReferrerRule>; referrer_default: ReferrerRule }

export const defaultCut = (): CutRule => ({ mode: 'off', value: 0, base: 'bill' });
export const defaultDoctorRules = (): DoctorPayRules => ({
  basis: 'by_hand', monthly: 0, part_month: 'calendar', per_visit: 0, per_type: { new: 0, free: 0, paid: 0 }, percent: 0,
  counts: { consultation: true, services: true, pharmacy: false, lab: false, radiology: false },
  cuts: { services: defaultCut(), pharmacy: defaultCut(), lab: defaultCut(), radiology: defaultCut(), ipd: defaultCut() },
});
export const defaultReferrerRule = (): ReferrerRule => ({ mode: 'off', value: 0, scope: 'every', on: { consultation: true, services: false, pharmacy: false, lab: false, radiology: false } });

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? round2(n) : 0; };
function cleanCut(c: any): CutRule {
  const mode = c?.mode === 'percent' || c?.mode === 'fixed' ? c.mode : 'off';
  return { mode, value: mode === 'percent' ? Math.min(100, num(c?.value)) : num(c?.value), base: c?.base === 'profit' ? 'profit' : 'bill' };
}
export function cleanDoctorRules(r: any): DoctorPayRules {
  const d = defaultDoctorRules();
  const basis = PAY_BASES.some((b) => b.id === r?.basis) ? r.basis : d.basis;
  const cuts = {} as Record<CutStream, CutRule>;
  for (const s of CUT_STREAMS) cuts[s.id] = cleanCut(r?.cuts?.[s.id]);
  const counts = { ...d.counts };
  for (const k of Object.keys(counts) as (keyof typeof counts)[]) if (typeof r?.counts?.[k] === 'boolean') counts[k] = r.counts[k];
  return {
    basis, monthly: num(r?.monthly), part_month: PART_MONTH.some((p) => p.id === r?.part_month) ? r.part_month : d.part_month,
    per_visit: num(r?.per_visit), per_type: { new: num(r?.per_type?.new), free: num(r?.per_type?.free), paid: num(r?.per_type?.paid) },
    percent: Math.min(100, num(r?.percent)), counts, cuts,
  };
}
export function cleanReferrerRule(r: any): ReferrerRule {
  const d = defaultReferrerRule();
  const mode = r?.mode === 'percent' || r?.mode === 'fixed' ? r.mode : 'off';
  const on = { ...d.on };
  for (const k of Object.keys(on) as (keyof typeof on)[]) if (typeof r?.on?.[k] === 'boolean') on[k] = r.on[k];
  return { mode, value: mode === 'percent' ? Math.min(100, num(r?.value)) : num(r?.value), scope: r?.scope === 'first' ? 'first' : 'every', on };
}
export function parsePayRules(json: string | null | undefined): PayRules {
  let o: any = {};
  try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  const doctors: PayRules['doctors'] = {}; const referrers: PayRules['referrers'] = {};
  for (const [k, v] of Object.entries<any>(o?.doctors && typeof o.doctors === 'object' ? o.doctors : {})) doctors[k] = cleanDoctorRules(v);
  for (const [k, v] of Object.entries<any>(o?.referrers && typeof o.referrers === 'object' ? o.referrers : {})) referrers[k] = cleanReferrerRule(v);
  return { doctors, referrers, referrer_default: cleanReferrerRule(o?.referrer_default) };
}
export const doctorRules = (p: PayRules, doctorId: number | string) => p.doctors[String(doctorId)] ?? defaultDoctorRules();
export const referrerRule = (p: PayRules, key: string) => p.referrers[key] ?? p.referrer_default;

/**
 * What a cut yields: a % of the collected base, or a fixed amount per order. `collectedShare` is the SUM over the orders of how much of each has been
 * collected (0–1 each), so two fully collected orders carry the fixed amount twice and half a collected order carries half of it.
 */
export function cutAmount(c: CutRule, base: number, collectedShare: number): number {
  if (c.mode === 'percent') return round2(base * c.value / 100);
  if (c.mode === 'fixed') return round2(c.value * Math.max(0, collectedShare));
  return 0;
}

// ── Settling days (part payments go to the oldest days first) ──────────────────────────────────────────────────────────────────────────
export interface DueDay { day: string; due: number }
/** Spread `amount` over the days, oldest first; each day takes at most what is due. Anything left over is returned as `unused`. */
export function settleOldestFirst(days: DueDay[], amount: number): { allocations: { day: string; amount: number }[]; unused: number } {
  let left = round2(amount); const allocations: { day: string; amount: number }[] = [];
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (left <= 0.004) break;
    const take = round2(Math.min(left, d.due));
    if (take > 0) { allocations.push({ day: d.day, amount: take }); left = round2(left - take); }
  }
  return { allocations, unused: Math.max(0, left) };
}

// ── Staff attendance and the salary it suggests ──────────────────────────────────────────────────────────────────────────────────────
export const ATTENDANCE = [
  { id: 'present', label: 'Present', cut: 0 }, { id: 'absent', label: 'Absent', cut: 1 }, { id: 'half_day', label: 'Half day', cut: 0.5 },
  { id: 'paid_leave', label: 'Paid leave', cut: 0 }, { id: 'unpaid_leave', label: 'Unpaid leave', cut: 1 }, { id: 'weekly_off', label: 'Weekly off', cut: 0 },
] as const;
export type AttendanceId = typeof ATTENDANCE[number]['id'];
export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
/** Monthly pay less the days not paid. A day nobody marked is NOT cut (forgetting to mark never costs someone their pay). */
export function suggestSalary(monthly: number, ym: string, marks: { status: string }[]): { amount: number; cutDays: number; marked: number; days: number } {
  const days = daysInMonth(ym);
  const cutDays = marks.reduce((a, m) => a + (ATTENDANCE.find((x) => x.id === m.status)?.cut ?? 0), 0);
  return { amount: round2(Math.max(0, monthly * (days - cutDays) / days)), cutDays, marked: marks.length, days };
}
