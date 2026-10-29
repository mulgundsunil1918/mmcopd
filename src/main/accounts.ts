/**
 * Accounts — what each doctor / referrer has EARNED (from money actually collected), what was PAID by vouchers, and the books around it
 * (vouchers, staff, attendance, day book, profit and loss). Pure database functions; the IPC layer (accounts-ipc.ts) adds roles and audit.
 *
 * The rules (owner, 2026-10-29):
 *  - STATISTICS go by billing; EARNINGS go by collection. A cut is worked out on what has been collected so far on a bill (its value before GST, after
 *    discount); money collected later is added to the same day, and shows "added after payment" if that day was already paid.
 *  - A day is the VISIT's day (a fee taken when the visit was booked still belongs to the day the doctor saw the patient); a bill with no visit — a walk-in lab
 *    test, a service — is counted on its own day. Visits: New patient (new to THIS doctor), Free follow-up (courtesy ones counted
 *    inside), Paid repeat visit; a visit with no consultation bill yet is counted apart as "not billed yet" — nothing is guessed.
 *  - A voucher records exactly what was paid. What it settles goes to the OLDEST unpaid days first; whatever is left stays "to pay" — nothing is
 *    written off. Cancelling a voucher returns its days to "to pay".
 *  - "Collected" is read from the same place as everywhere else (billPosition + bill_payments); nothing here invents its own meaning.
 */
import type Database from 'better-sqlite3';
import { fromPaise, toPaise } from '../lib/pharmacyMath';
import { referralKey } from '../lib/referralStats';
import { ADV_SPARE_SQL, billPosition, collections, kindOfBill, utcSlack } from './billing-portal';
import { profitReport } from './pharmacy-finance';
import {
  ATTENDANCE, CUT_STREAMS, cutAmount, daysInMonth, doctorRules, money2, numberOfVoucher, parseAcctSettings, parsePayRules, prefixFor,
  referrerRule, settleOldestFirst, suggestSalary, voucherNumber, voucherProblem, type AcctSettings, type CutStream, type DoctorPayRules,
  type PayRules, type ReferrerRule, type VoucherInput,
} from '../lib/accountsRules';

// ── small date helpers (local calendar days, 'YYYY-MM-DD') ──────────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export function eachDay(from: string, to: string, cap = 400): string[] {
  const out: string[] = []; const d = parseDay(from); const end = parseDay(to);
  while (d <= end && out.length < cap) { out.push(localDay(d)); d.setDate(d.getDate() + 1); }
  return out;
}
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const monthOf = (day: string) => day.slice(0, 7);
const isSunday = (day: string) => parseDay(day).getDay() === 0;
function workingDaysIn(ym: string): number {
  let n = 0; for (let d = 1; d <= daysInMonth(ym); d++) if (parseDay(`${ym}-${pad(d)}`).getDay() !== 0) n++;
  return n || 1;
}

// ── what one doctor brought in on one day ──────────────────────────────────────────────────────────────────────────────────────────
export type Stream = 'consultation' | 'services' | 'pharmacy' | 'lab' | 'radiology' | 'ipd';
const STREAMS: Stream[] = ['consultation', 'services', 'pharmacy', 'lab', 'radiology', 'ipd'];
interface StreamAgg { billedP: number; collectedP: number; baseP: number; shareSum: number; orders: number; profitP: number }
interface DayAgg {
  new_patient: number; new_first_ever: number; free_followup: number; free_courtesy: number; paid_repeat: number; not_billed: number;
  streams: Record<Stream, StreamAgg>; costMissing: number;
}
const blankStream = (): StreamAgg => ({ billedP: 0, collectedP: 0, baseP: 0, shareSum: 0, orders: 0, profitP: 0 });
const blankDay = (): DayAgg => ({
  new_patient: 0, new_first_ever: 0, free_followup: 0, free_courtesy: 0, paid_repeat: 0, not_billed: 0, costMissing: 0,
  streams: Object.fromEntries(STREAMS.map((s) => [s, blankStream()])) as Record<Stream, StreamAgg>,
});

interface BillRow {
  id: number; bill_type: string | null; bill_kind: string | null; admission_id: number | null; total: number; amount_paid: number; advance_adjusted: number;
  finalized_at: string | null; adv_spare: number; cgst_total: number; sgst_total: number; day: string; doctor_id: number | null; appointment_id: number | null;
  referred_by: string | null; patient_id: number | null;
}
const BILL_COLS = `b.id, b.bill_type, b.bill_kind, b.admission_id, b.total, b.amount_paid, b.advance_adjusted, b.finalized_at, b.cgst_total, b.sgst_total,
  b.appointment_id, b.patient_id, COALESCE(a.appointment_date, date(b.created_at, 'localtime')) AS day, a.referred_by AS referred_by,
  COALESCE(b.doctor_id, a.doctor_id, lo.doctor_id, ro.doctor_id) AS doctor_id, ${ADV_SPARE_SQL} AS adv_spare`;
const BILL_JOINS = `LEFT JOIN lab_orders lo ON lo.id = b.lab_order_id LEFT JOIN radiology_orders ro ON ro.id = b.radiology_order_id`;
/** Bills that belong to a visit are counted on the VISIT's day (a fee taken when the visit was booked still belongs to the day the doctor saw the patient). */
const BILL_FROM = `FROM bills b LEFT JOIN appointments a ON a.id = b.appointment_id ${BILL_JOINS}`;
const BILLS_OF_VISITS = `FROM appointments a JOIN bills b ON b.appointment_id = a.id ${BILL_JOINS}`;
const LIVE_BILL = `COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL`;

/** Value of a bill before GST, and how much of the bill has been collected. */
function billFigures(r: BillRow) {
  const pos = billPosition({ total: r.total, amount_paid: r.amount_paid, advance_adjusted: r.advance_adjusted, finalized_at: r.finalized_at, admission_id: r.admission_id, bill_type: r.bill_type, adv_spare: r.adv_spare });
  const collectedP = Math.min(pos.totalP, pos.paidP + pos.advanceP);
  const baseP = Math.max(0, pos.totalP - toPaise(r.cgst_total) - toPaise(r.sgst_total));
  const share = pos.totalP > 0 ? Math.max(0, Math.min(1, collectedP / pos.totalP)) : 0;
  return { totalP: pos.totalP, collectedP, baseP, share };
}
const streamOfKind = (k: ReturnType<typeof kindOfBill>): Stream | null =>
  k === 'consultation' ? 'consultation' : k === 'service' ? 'services' : k === 'lab' ? 'lab' : k === 'radiology' ? 'radiology'
    : k === 'pharmacy_manual' || k === 'pharmacy' ? 'pharmacy' : null;       // in-patient bills are counted by their doctor-visit lines below

function addToStream(s: StreamAgg, f: { totalP: number; collectedP: number; baseP: number; share: number }, scale = 1) {
  s.billedP += Math.round(f.totalP * scale); s.collectedP += Math.round(f.collectedP * scale);
  s.baseP += Math.round(f.baseP * f.share * scale); s.shareSum += f.share; s.orders += 1;
}

/** Bills, in-patient doctor-visit lines and pharmacy sales in the range, grouped by doctor and day (collected-based). */
function gather(db: Database.Database, from: string, to: string) {
  const slack = utcSlack(from, to);
  const perDoc = new Map<number, Map<string, DayAgg>>();
  const dayOf = (doc: number, day: string) => {
    let m = perDoc.get(doc); if (!m) perDoc.set(doc, (m = new Map()));
    let d = m.get(day); if (!d) m.set(day, (d = blankDay()));
    return d;
  };

  // 1) ordinary bills (consultation, service, lab, radiology, hand-typed pharmacy): those of a visit on the visit's day, the rest on their own day
  const bills = [
    ...db.prepare(`SELECT ${BILL_COLS} ${BILLS_OF_VISITS} WHERE a.appointment_date BETWEEN ? AND ? AND ${LIVE_BILL}`).all(from, to),
    ...db.prepare(`SELECT ${BILL_COLS} ${BILL_FROM} WHERE b.appointment_id IS NULL AND b.created_at >= ? AND b.created_at < ?
        AND date(b.created_at, 'localtime') BETWEEN ? AND ? AND ${LIVE_BILL}`).all(slack.lo, slack.hi, from, to),
  ] as BillRow[];
  for (const r of bills) {
    if (!r.doctor_id) continue;
    const st = streamOfKind(kindOfBill(r)); if (!st) continue;
    addToStream(dayOf(r.doctor_id, r.day).streams[st], billFigures(r));
  }

  // 2) in-patient doctor-visit lines (each line belongs to the doctor named on it, on the day it accrued)
  const visits = db.prepare(`SELECT bi.amount AS line_amount, bi.source_ref_id AS doc, bi.accrual_date AS day, ${BILL_COLS} ${BILL_FROM}
      JOIN bill_items bi ON bi.bill_id = b.id
      WHERE bi.source = 'doctor_visit' AND bi.accrual_date BETWEEN ? AND ? AND ${LIVE_BILL}`).all(from, to) as (BillRow & { line_amount: number; doc: number | null })[];
  for (const r of visits) {
    if (!r.doc) continue;
    const f = billFigures(r); const line = toPaise(r.line_amount);
    const s = dayOf(r.doc, r.day).streams.ipd;           // the line's own value, collected in the same proportion as its bill
    s.billedP += line; s.collectedP += Math.round(line * f.share); s.baseP += Math.round(line * f.share); s.shareSum += f.share; s.orders += 1;
  }

  // 3) pharmacy counter sales that carry a visit (and so a doctor): value, collected share, and profit where the cost is known
  const sales = db.prepare(`SELECT s.id, s.total, COALESCE(s.amount_paid, s.total) AS paid, a.appointment_date AS day, a.doctor_id AS doc,
         (SELECT COALESCE(SUM(dr.qty * dr.unit_cost), 0) FROM dispensing_register dr WHERE dr.sale_id = s.id AND dr.unit_cost IS NOT NULL) AS cost,
         (SELECT COUNT(*) FROM dispensing_register dr WHERE dr.sale_id = s.id AND dr.unit_cost IS NULL) AS uncosted,
         (SELECT COUNT(*) FROM dispensing_register dr WHERE dr.sale_id = s.id) AS lines
       FROM pharmacy_sales s JOIN appointments a ON a.id = s.appointment_id
      WHERE a.appointment_date BETWEEN ? AND ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill' AND a.doctor_id IS NOT NULL`).all(from, to) as
    { id: number; total: number; paid: number; day: string; doc: number; cost: number; uncosted: number; lines: number }[];
  for (const r of sales) {
    const totalP = toPaise(r.total); const collectedP = Math.min(totalP, toPaise(r.paid));
    const share = totalP > 0 ? collectedP / totalP : 0;
    const d = dayOf(r.doc, r.day); const s = d.streams.pharmacy;
    s.billedP += totalP; s.collectedP += collectedP; s.baseP += collectedP; s.shareSum += share; s.orders += 1;
    if (r.lines > 0 && r.uncosted === 0) s.profitP += Math.round(Math.max(0, totalP - toPaise(r.cost)) * share);
    else d.costMissing += 1;
  }

  // 4) visits and what kind each was
  const appts = db.prepare(`SELECT a.id, a.doctor_id AS doc, a.appointment_date AS day,
        EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = a.patient_id AND x.doctor_id = a.doctor_id AND x.status <> 'Cancelled'
                  AND (x.appointment_date < a.appointment_date OR (x.appointment_date = a.appointment_date AND x.id < a.id))) AS seen_by_doc,
        EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = a.patient_id AND x.status <> 'Cancelled'
                  AND (x.appointment_date < a.appointment_date OR (x.appointment_date = a.appointment_date AND x.id < a.id))) AS seen_at_clinic,
        (SELECT COALESCE(MAX(b.is_free_followup), 0) FROM bills b WHERE b.appointment_id = a.id AND ${LIVE_BILL}) AS free,
        (SELECT COALESCE(MAX(b.is_relaxed_followup), 0) FROM bills b WHERE b.appointment_id = a.id AND ${LIVE_BILL}) AS courtesy,
        (SELECT COUNT(*) FROM bills b WHERE b.appointment_id = a.id AND b.bill_type = 'opd_consult' AND COALESCE(b.bill_kind, 'opd') <> 'misc' AND ${LIVE_BILL}) AS consult_bills
      FROM appointments a WHERE a.status <> 'Cancelled' AND a.appointment_date BETWEEN ? AND ? AND a.doctor_id IS NOT NULL`).all(from, to) as
    { id: number; doc: number; day: string; seen_by_doc: number; seen_at_clinic: number; free: number; courtesy: number; consult_bills: number }[];
  for (const a of appts) {
    const d = dayOf(a.doc, a.day);
    if (!a.seen_by_doc) { d.new_patient++; if (!a.seen_at_clinic) d.new_first_ever++; }
    else if (a.free) { d.free_followup++; if (a.courtesy) d.free_courtesy++; }
    else if (a.consult_bills > 0) d.paid_repeat++;
    else d.not_billed++;
  }
  return perDoc;
}

// ── earnings ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rupees = (p: number) => fromPaise(Math.round(p));

/** What the clinic owes a doctor for ONE day under their pay rules (rupees, 2 decimals). */
export function earnedForDay(rules: DoctorPayRules, day: string, today: string, a: DayAgg): number {
  const ym = monthOf(day); const dim = daysInMonth(ym);
  const visits = a.new_patient + a.free_followup + a.paid_repeat + a.not_billed;
  let total = 0;
  const fixed = (() => {
    if (day > today) return 0;
    switch (rules.part_month) {
      case 'calendar': return rules.monthly / dim;
      case 'working': return isSunday(day) ? 0 : rules.monthly / workingDaysIn(ym);
      case 'full': return day.endsWith('-01') ? rules.monthly : 0;
      case 'full_months': return day === `${ym}-${pad(dim)}` ? rules.monthly : 0;
    }
  })();
  const revenueP = (['consultation', 'services', 'pharmacy', 'lab', 'radiology'] as const).reduce((x, k) => x + (rules.counts[k] ? a.streams[k].baseP : 0), 0);
  switch (rules.basis) {
    case 'fixed_monthly': total += fixed; break;
    case 'per_visit': total += rules.per_visit * visits; break;
    case 'per_visit_type': total += rules.per_type.new * a.new_patient + rules.per_type.free * a.free_followup + rules.per_type.paid * (a.paid_repeat + a.not_billed); break;
    case 'percent_of_fees': total += rupees(a.streams.consultation.baseP) * rules.percent / 100; break;
    case 'percent_of_revenue': total += rupees(revenueP) * rules.percent / 100; break;
    case 'fixed_plus_percent': total += fixed + rupees(revenueP) * rules.percent / 100; break;
    default: break;
  }
  for (const c of CUT_STREAMS) {
    const rule = rules.cuts[c.id as CutStream]; if (rule.mode === 'off') continue;
    const s = a.streams[c.id as Stream];
    const baseP = c.id === 'pharmacy' && rule.base === 'profit' ? s.profitP : s.baseP;
    total += cutAmount(rule, rupees(baseP), s.shareSum);
  }
  return money2(total);
}

export interface DoctorDay {
  doctor_id: number; day: string;
  new_patient: number; new_first_ever: number; free_followup: number; free_courtesy: number; paid_repeat: number; not_billed: number; visits: number;
  billed: number; collected: number; earned: number; paid: number; balance: number; overpaid: number;
  status: 'none' | 'to_pay' | 'part' | 'paid'; vouchers: string[]; added_after_payment: number;
}
export interface DoctorSummary {
  doctor_id: number; name: string; basis: string; visits: number; new_patient: number; new_first_ever: number; free_followup: number; free_courtesy: number;
  paid_repeat: number; not_billed: number; billed: number; collected: number; earned: number; paid: number; balance: number; cost_missing: number;
}

function paidMap(db: Database.Database, kind: 'doctor' | 'referrer', from: string, to: string) {
  const rows = db.prepare(`SELECT d.payee_ref AS ref, d.day, SUM(d.amount) AS amount, MAX(d.earned_then) AS then_e, GROUP_CONCAT(DISTINCT v.voucher_no) AS nos
      FROM acct_voucher_days d JOIN acct_vouchers v ON v.id = d.voucher_id
     WHERE v.status = 'active' AND d.payee_kind = ? AND d.day BETWEEN ? AND ? GROUP BY d.payee_ref, d.day`).all(kind, from, to) as
    { ref: string; day: string; amount: number; then_e: number; nos: string }[];
  return new Map(rows.map((r) => [`${r.ref}|${r.day}`, r]));
}

/** Per doctor, per day: visits, billed, collected, earned, paid, balance. Rows exist for days with activity, and every day for fixed-monthly doctors. */
export function doctorDays(db: Database.Database, opts: { from: string; to: string; doctorId?: number; today?: string; pay?: PayRules }):
  { days: DoctorDay[]; doctors: DoctorSummary[] } {
  const { from, to } = opts; const today = opts.today || localDay();
  const settings = readSetting(db, 'pay_rules_json'); const pay = opts.pay ?? parsePayRules(settings);
  const per = gather(db, from, to);
  const docs = db.prepare('SELECT id, name FROM doctors').all() as { id: number; name: string }[];
  const paid = paidMap(db, 'doctor', from, to);
  const days: DoctorDay[] = []; const doctors: DoctorSummary[] = [];
  for (const doc of docs) {
    if (opts.doctorId && doc.id !== opts.doctorId) continue;
    const rules = doctorRules(pay, doc.id); const m = per.get(doc.id);
    const fixedDays = rules.basis === 'fixed_monthly' || rules.basis === 'fixed_plus_percent';
    const dayList = fixedDays ? eachDay(from, to < today ? to : today) : [...(m?.keys() ?? [])];
    for (const x of [...(m?.keys() ?? [])]) if (!dayList.includes(x)) dayList.push(x);
    dayList.sort();
    const sum: DoctorSummary = { doctor_id: doc.id, name: doc.name, basis: rules.basis, visits: 0, new_patient: 0, new_first_ever: 0, free_followup: 0, free_courtesy: 0, paid_repeat: 0, not_billed: 0, billed: 0, collected: 0, earned: 0, paid: 0, balance: 0, cost_missing: 0 };
    for (const day of dayList) {
      const a = m?.get(day) ?? blankDay();
      const earned = earnedForDay(rules, day, today, a);
      const p = paid.get(`${doc.id}|${day}`);
      const paidAmt = money2(p?.amount ?? 0);
      const balance = money2(Math.max(0, earned - paidAmt));
      const billed = rupees(STREAMS.reduce((x, k) => x + a.streams[k].billedP, 0)); const collected = rupees(STREAMS.reduce((x, k) => x + a.streams[k].collectedP, 0));
      const visits = a.new_patient + a.free_followup + a.paid_repeat + a.not_billed;
      const added = p && p.then_e + 0.005 < earned && paidAmt > 0 ? money2(earned - p.then_e) : 0;
      days.push({
        doctor_id: doc.id, day, new_patient: a.new_patient, new_first_ever: a.new_first_ever, free_followup: a.free_followup, free_courtesy: a.free_courtesy,
        paid_repeat: a.paid_repeat, not_billed: a.not_billed, visits, billed: money2(billed), collected: money2(collected), earned, paid: paidAmt, balance,
        overpaid: money2(Math.max(0, paidAmt - earned)),
        status: earned <= 0.004 && paidAmt <= 0.004 ? 'none' : balance <= 0.004 && paidAmt > 0 ? 'paid' : paidAmt > 0 ? 'part' : 'to_pay',
        vouchers: p?.nos ? p.nos.split(',') : [], added_after_payment: added,
      });
      for (const k of ['visits', 'new_patient', 'new_first_ever', 'free_followup', 'free_courtesy', 'paid_repeat', 'not_billed'] as const) (sum as any)[k] += k === 'visits' ? visits : (a as any)[k];
      sum.billed = money2(sum.billed + billed); sum.collected = money2(sum.collected + collected); sum.earned = money2(sum.earned + earned);
      sum.paid = money2(sum.paid + paidAmt); sum.balance = money2(sum.balance + balance); sum.cost_missing += a.costMissing;
    }
    if (sum.visits || sum.billed || sum.earned || sum.paid) doctors.push(sum);
  }
  return { days, doctors };
}

// ── outside referrers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ReferrerDay { key: string; name: string; day: string; visits: number; collected: number; earned: number; paid: number; balance: number; status: DoctorDay['status']; vouchers: string[] }
export interface ReferrerSummary { key: string; name: string; visits: number; collected: number; earned: number; paid: number; balance: number }

export function referrerDays(db: Database.Database, opts: { from: string; to: string; pay?: PayRules }): { days: ReferrerDay[]; referrers: ReferrerSummary[] } {
  const { from, to } = opts; const pay = opts.pay ?? parsePayRules(readSetting(db, 'pay_rules_json'));
  const appts = db.prepare(`SELECT a.id, a.patient_id, a.appointment_date AS day, a.referred_by AS ref FROM appointments a
      WHERE a.status <> 'Cancelled' AND TRIM(COALESCE(a.referred_by, '')) <> '' AND a.appointment_date BETWEEN ? AND ?`).all(from, to) as
    { id: number; patient_id: number; day: string; ref: string }[];
  if (!appts.length) return { days: [], referrers: [] };
  // each patient's first visit that came through a given referrer (for rules that pay on the first visit only)
  const first = new Map<string, number>();
  for (const r of db.prepare(`SELECT id, patient_id, referred_by FROM appointments WHERE status <> 'Cancelled' AND TRIM(COALESCE(referred_by, '')) <> '' ORDER BY appointment_date, id`).all() as { id: number; patient_id: number; referred_by: string }[]) {
    const k = `${r.patient_id}|${referralKey(r.referred_by)}`; if (!first.has(k)) first.set(k, r.id);
  }
  const apptIds = new Set(appts.map((a) => a.id));
  const money = new Map<number, Record<Stream, { baseP: number; totalP: number; collectedP: number }>>();
  const slot = (id: number) => { let m = money.get(id); if (!m) money.set(id, (m = Object.fromEntries(STREAMS.map((s) => [s, { baseP: 0, totalP: 0, collectedP: 0 }])) as any)); return m!; };
  const billRows = db.prepare(`SELECT ${BILL_COLS} ${BILLS_OF_VISITS} WHERE a.appointment_date BETWEEN ? AND ? AND TRIM(COALESCE(a.referred_by, '')) <> '' AND ${LIVE_BILL}`)
    .all(from, to) as BillRow[];
  for (const r of billRows) {
    if (!r.appointment_id || !apptIds.has(r.appointment_id)) continue;
    const st = streamOfKind(kindOfBill(r)); if (!st) continue;
    const f = billFigures(r); const s = slot(r.appointment_id)[st];
    s.baseP += Math.round(f.baseP * f.share); s.totalP += f.totalP; s.collectedP += f.collectedP;
  }
  for (const r of db.prepare(`SELECT s.appointment_id AS appt, s.total, COALESCE(s.amount_paid, s.total) AS paid FROM pharmacy_sales s JOIN appointments a ON a.id = s.appointment_id
      WHERE a.appointment_date BETWEEN ? AND ? AND TRIM(COALESCE(a.referred_by, '')) <> '' AND COALESCE(s.payment_mode, '') <> 'IPD-bill'`).all(from, to) as { appt: number; total: number; paid: number }[]) {
    if (!apptIds.has(r.appt)) continue;
    const s = slot(r.appt).pharmacy; const t = toPaise(r.total); const c = Math.min(t, toPaise(r.paid));
    s.baseP += c; s.totalP += t; s.collectedP += c;
  }
  const paid = paidMap(db, 'referrer', from, to);
  const names = new Map<string, string>(); const acc = new Map<string, { visits: number; collectedP: number; earned: number }>();
  for (const a of appts) {
    const key = referralKey(a.ref); if (!key) continue;
    if (!names.has(key)) names.set(key, a.ref.trim().replace(/\s+/g, ' '));
    const rule: ReferrerRule = referrerRule(pay, key);
    const m = slot(a.id); let baseP = 0, totalP = 0, collectedP = 0;
    for (const s of STREAMS) { if ((rule.on as any)[s] === true) { baseP += m[s].baseP; totalP += m[s].totalP; collectedP += m[s].collectedP; } }
    let earned = 0;
    const counts = rule.scope === 'every' || first.get(`${a.patient_id}|${key}`) === a.id;
    if (counts && rule.mode === 'percent') earned = rupees(baseP) * rule.value / 100;
    if (counts && rule.mode === 'fixed') earned = rule.value * (totalP > 0 ? Math.min(1, collectedP / totalP) : 1);
    const k = `${key}|${a.day}`; const cur = acc.get(k) ?? { visits: 0, collectedP: 0, earned: 0 };
    cur.visits++; cur.collectedP += collectedP; cur.earned += earned; acc.set(k, cur);
  }
  const days: ReferrerDay[] = []; const sums = new Map<string, ReferrerSummary>();
  for (const [k, v] of [...acc.entries()].sort()) {
    const [key, day] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const p = paid.get(`${key}|${day}`); const earned = money2(v.earned); const paidAmt = money2(p?.amount ?? 0); const balance = money2(Math.max(0, earned - paidAmt));
    days.push({
      key, name: names.get(key)!, day, visits: v.visits, collected: money2(rupees(v.collectedP)), earned, paid: paidAmt, balance,
      status: earned <= 0.004 && paidAmt <= 0.004 ? 'none' : balance <= 0.004 && paidAmt > 0 ? 'paid' : paidAmt > 0 ? 'part' : 'to_pay', vouchers: p?.nos ? p.nos.split(',') : [],
    });
    const s = sums.get(key) ?? { key, name: names.get(key)!, visits: 0, collected: 0, earned: 0, paid: 0, balance: 0 };
    s.visits += v.visits; s.collected = money2(s.collected + rupees(v.collectedP)); s.earned = money2(s.earned + earned); s.paid = money2(s.paid + paidAmt); s.balance = money2(s.balance + balance);
    sums.set(key, s);
  }
  return { days, referrers: [...sums.values()].sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name)) };
}

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function readSetting(db: Database.Database, key: string): string {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined; return r?.value ?? '';
}
export const readAcct = (db: Database.Database): AcctSettings => parseAcctSettings(readSetting(db, 'acct_settings_json'));

// ── vouchers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface VoucherRow {
  id: number; voucher_no: string; voucher_type: string; voucher_date: string; payee_kind: string; payee_ref: string | null; payee_name: string;
  category: string | null; description: string | null; gross_amount: number; deduction_amount: number; deduction_kind: string | null; deduction_label: string | null;
  net_amount: number; pay_mode: string; pay_reference: string | null; period_from: string | null; period_to: string | null;
  raised_by: string | null; raised_role: string | null; status: string; cancelled_at: string | null; cancelled_by: string | null; cancel_reason: string | null; created_at: string;
  days?: { day: string; amount: number }[];
}

export type VoucherResult = { ok: true; voucher: VoucherRow; unused: number } | { ok: false; error: string };

/** Raise a voucher. For a doctor / referrer payment the amount settles that person's oldest unpaid days (inside the chosen period) first. */
export function createVoucher(db: Database.Database, v: VoucherInput & { client_ref?: string | null }, who: { name: string; role: string }): VoucherResult {
  const gross = money2(Number(v.gross)); const ded = money2(Number(v.deduction || 0));
  const bad = voucherProblem({ ...v, gross, deduction: ded }); if (bad) return { ok: false, error: bad };
  const ref = v.client_ref ? String(v.client_ref) : null;
  if (ref) {      // a repeated click / re-send of the same voucher must not pay twice
    const old = db.prepare('SELECT id FROM acct_vouchers WHERE client_ref = ?').get(ref) as { id: number } | undefined;
    if (old) return { ok: true, voucher: getVoucher(db, old.id)!, unused: 0 };
  }
  const acct = readAcct(db);
  const pay = parsePayRules(readSetting(db, 'pay_rules_json'));
  let unused = 0; let newId = 0;
  const tx = db.transaction(() => {
    const maxN = (db.prepare('SELECT voucher_no FROM acct_vouchers WHERE voucher_type = ?').all(v.type) as { voucher_no: string }[]).reduce((m, r) => Math.max(m, numberOfVoucher(r.voucher_no)), 0);
    const no = voucherNumber(prefixFor(acct, v.type), maxN + 1);
    newId = Number(db.prepare(`INSERT INTO acct_vouchers (voucher_no, voucher_type, voucher_date, payee_kind, payee_ref, payee_name, category, description, gross_amount,
        deduction_amount, deduction_kind, deduction_label, net_amount, pay_mode, pay_reference, period_from, period_to, raised_by, raised_role, client_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      no, v.type, v.date, v.payee_kind, v.payee_ref ?? null, String(v.payee_name).trim(), v.category?.trim() || null, v.description?.trim() || null, gross,
      ded, ded > 0 ? (v.deduction_kind || 'other') : null, ded > 0 ? (v.deduction_label?.trim() || null) : null, money2(gross - ded), v.pay_mode, v.reference?.trim() || null,
      v.period_from || null, v.period_to || null, who.name || null, who.role || null, ref).lastInsertRowid);
    if ((v.payee_kind === 'doctor' || v.payee_kind === 'referrer') && v.payee_ref && v.period_from && v.period_to) {
      const due = v.payee_kind === 'doctor'
        ? doctorDays(db, { from: v.period_from, to: v.period_to, doctorId: Number(v.payee_ref), pay }).days.filter((d) => d.balance > 0.004).map((d) => ({ day: d.day, due: d.balance, earned: d.earned }))
        : referrerDays(db, { from: v.period_from, to: v.period_to, pay }).days.filter((d) => d.key === v.payee_ref && d.balance > 0.004).map((d) => ({ day: d.day, due: d.balance, earned: d.earned }));
      const plan = settleOldestFirst(due, gross); unused = plan.unused;
      const ins = db.prepare('INSERT INTO acct_voucher_days (voucher_id, payee_kind, payee_ref, day, amount, earned_then) VALUES (?,?,?,?,?,?)');
      for (const a of plan.allocations) ins.run(newId, v.payee_kind, String(v.payee_ref), a.day, a.amount, due.find((d) => d.day === a.day)!.earned);
    }
  });
  tx();
  return { ok: true, voucher: getVoucher(db, newId)!, unused };
}

export function getVoucher(db: Database.Database, id: number): VoucherRow | null {
  const r = db.prepare('SELECT * FROM acct_vouchers WHERE id = ?').get(id) as VoucherRow | undefined; if (!r) return null;
  r.days = db.prepare('SELECT day, amount FROM acct_voucher_days WHERE voucher_id = ? ORDER BY day').all(id) as { day: string; amount: number }[];
  return r;
}

export function listVouchers(db: Database.Database, f: { from?: string; to?: string; type?: string; status?: string; payee_kind?: string; payee_ref?: string }): VoucherRow[] {
  const w: string[] = []; const p: (string | number)[] = [];
  if (f.from) { w.push('voucher_date >= ?'); p.push(f.from); }
  if (f.to) { w.push('voucher_date <= ?'); p.push(f.to); }
  if (f.type) { w.push('voucher_type = ?'); p.push(f.type); }
  if (f.status) { w.push('status = ?'); p.push(f.status); }
  if (f.payee_kind) { w.push('payee_kind = ?'); p.push(f.payee_kind); }
  if (f.payee_ref) { w.push('payee_ref = ?'); p.push(f.payee_ref); }
  return db.prepare(`SELECT * FROM acct_vouchers ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY voucher_date DESC, id DESC LIMIT 2000`).all(...p) as VoucherRow[];
}

export function cancelVoucher(db: Database.Database, id: number, reason: string, who: string): { ok: true; voucher: VoucherRow } | { ok: false; error: string } {
  const r = String(reason || '').trim(); if (r.length < 3) return { ok: false, error: 'Write the reason for cancelling (a few words).' };
  const v = getVoucher(db, id); if (!v) return { ok: false, error: 'That voucher was not found.' };
  if (v.status === 'cancelled') return { ok: false, error: `${v.voucher_no} is already cancelled.` };
  db.prepare("UPDATE acct_vouchers SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ?").run(who || null, r, id);
  return { ok: true, voucher: getVoucher(db, id)! };
}

// ── staff and attendance ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface StaffRow { id: number; name: string; job: string | null; phone: string | null; monthly_salary: number; keep_attendance: number; is_active: number; joined_on: string | null; advance_open: number; paid_this_month: number }
export function listStaff(db: Database.Database, month = localDay().slice(0, 7)): StaffRow[] {
  return db.prepare(`SELECT s.*,
      MAX(0, COALESCE((SELECT SUM(gross_amount) FROM acct_vouchers v WHERE v.payee_kind = 'staff' AND v.payee_ref = CAST(s.id AS TEXT) AND v.voucher_type = 'advance' AND v.status = 'active'), 0)
            - COALESCE((SELECT SUM(deduction_amount) FROM acct_vouchers v WHERE v.payee_kind = 'staff' AND v.payee_ref = CAST(s.id AS TEXT) AND v.deduction_kind = 'advance' AND v.status = 'active'), 0)) AS advance_open,
      COALESCE((SELECT SUM(net_amount) FROM acct_vouchers v WHERE v.payee_kind = 'staff' AND v.payee_ref = CAST(s.id AS TEXT) AND v.voucher_type = 'staff_salary' AND v.status = 'active'
                AND substr(v.voucher_date, 1, 7) = ?), 0) AS paid_this_month
    FROM acct_staff s ORDER BY s.is_active DESC, s.name`).all(month) as StaffRow[];
}
export function saveStaff(db: Database.Database, s: { id?: number; name: string; job?: string; phone?: string; monthly_salary?: number; keep_attendance?: boolean; is_active?: boolean; joined_on?: string }):
  { ok: true; id: number } | { ok: false; error: string } {
  const name = String(s.name || '').trim(); if (!name) return { ok: false, error: 'Enter the staff member’s name.' };
  const sal = Number(s.monthly_salary || 0); if (!(sal >= 0) || !Number.isFinite(sal)) return { ok: false, error: 'The monthly salary must be a number (0 or more).' };
  const vals = [name, s.job?.trim() || null, s.phone?.trim() || null, money2(sal), s.keep_attendance ? 1 : 0, s.is_active === false ? 0 : 1, s.joined_on || null];
  if (s.id) { db.prepare('UPDATE acct_staff SET name=?, job=?, phone=?, monthly_salary=?, keep_attendance=?, is_active=?, joined_on=? WHERE id=?').run(...vals, s.id); return { ok: true, id: s.id }; }
  return { ok: true, id: Number(db.prepare('INSERT INTO acct_staff (name, job, phone, monthly_salary, keep_attendance, is_active, joined_on) VALUES (?,?,?,?,?,?,?)').run(...vals).lastInsertRowid) };
}
export function getAttendance(db: Database.Database, staffId: number, ym: string) {
  return db.prepare('SELECT day, status, note FROM acct_attendance WHERE staff_id = ? AND substr(day, 1, 7) = ? ORDER BY day').all(staffId, ym) as { day: string; status: string; note: string | null }[];
}
export function setAttendance(db: Database.Database, staffId: number, day: string, status: string | null, note?: string) {
  if (!isDay(day)) return { ok: false as const, error: 'Pick a valid day.' };
  if (!status) { db.prepare('DELETE FROM acct_attendance WHERE staff_id = ? AND day = ?').run(staffId, day); return { ok: true as const }; }
  if (!ATTENDANCE.some((a) => a.id === status)) return { ok: false as const, error: 'Unknown attendance status.' };
  db.prepare('INSERT INTO acct_attendance (staff_id, day, status, note) VALUES (?,?,?,?) ON CONFLICT(staff_id, day) DO UPDATE SET status = excluded.status, note = excluded.note').run(staffId, day, status, note?.trim() || null);
  return { ok: true as const };
}
export function salarySuggestion(db: Database.Database, staffId: number, ym: string) {
  const s = db.prepare('SELECT monthly_salary, keep_attendance FROM acct_staff WHERE id = ?').get(staffId) as { monthly_salary: number; keep_attendance: number } | undefined;
  if (!s) return null;
  return { monthly: s.monthly_salary, keep_attendance: !!s.keep_attendance, ...suggestSalary(s.monthly_salary, ym, s.keep_attendance ? getAttendance(db, staffId, ym) : []) };
}
export const listCategories = (db: Database.Database) => db.prepare('SELECT id, name, is_active, sort_order FROM acct_categories ORDER BY sort_order, name').all() as { id: number; name: string; is_active: number; sort_order: number }[];
export function saveCategory(db: Database.Database, c: { id?: number; name?: string; is_active?: boolean }): { ok: true } | { ok: false; error: string } {
  if (c.id) {
    if (c.name !== undefined) { const n = c.name.trim(); if (!n) return { ok: false, error: 'The name cannot be empty.' }; db.prepare('UPDATE acct_categories SET name=? WHERE id=?').run(n, c.id); }
    if (c.is_active !== undefined) db.prepare('UPDATE acct_categories SET is_active=? WHERE id=?').run(c.is_active ? 1 : 0, c.id);
    return { ok: true };
  }
  const n = String(c.name || '').trim(); if (!n) return { ok: false, error: 'Type the name of the new head.' };
  if (db.prepare('SELECT 1 FROM acct_categories WHERE lower(name) = lower(?)').get(n)) return { ok: false, error: `“${n}” is already in the list.` };
  db.prepare('INSERT INTO acct_categories (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM acct_categories))').run(n);
  return { ok: true };
}

// ── money out, day book, profit and loss ───────────────────────────────────────────────────────────────────────────────────────
export interface OutLine { source: 'voucher' | 'supplier' | 'refund'; date: string; ref: string; who: string; what: string; mode: string; amount: number; status: string; counted: boolean; voucher_id?: number }
/** Everything that went out in the range: vouchers, supplier payments, and (shown, but already taken off Money in) patient refunds. */
export function moneyOut(db: Database.Database, from: string, to: string): { lines: OutLine[]; total: number; vouchers: number; suppliers: number; refunds: number } {
  const slack = utcSlack(from, to); const lines: OutLine[] = [];
  for (const v of listVouchers(db, { from, to })) {
    lines.push({ source: 'voucher', date: v.voucher_date, ref: v.voucher_no, who: v.payee_name, what: v.description || v.category || (v.voucher_type === 'staff_salary' ? 'Salary' : ''), mode: v.pay_mode, amount: v.net_amount, status: v.status, counted: v.status === 'active', voucher_id: v.id });
  }
  for (const r of db.prepare(`SELECT p.paid_on AS date, p.amount, COALESCE(p.payment_mode, '') AS mode, i.invoice_number AS inv, COALESCE(w.name, '') AS supplier
      FROM purchase_payments p JOIN purchase_invoices i ON i.id = p.invoice_id LEFT JOIN wholesalers w ON w.id = i.wholesaler_id WHERE p.paid_on BETWEEN ? AND ?`).all(from, to) as
    { date: string; amount: number; mode: string; inv: string | null; supplier: string }[]) {
    lines.push({ source: 'supplier', date: r.date, ref: r.inv || '', who: r.supplier, what: 'Supplier payment', mode: r.mode || 'Unspecified', amount: money2(r.amount), status: 'active', counted: true });
  }
  for (const r of db.prepare(`SELECT date(bp.received_at, 'localtime') AS date, -bp.amount AS amount, COALESCE(bp.payment_mode, '') AS mode, b.bill_number AS bill
      FROM bill_payments bp JOIN bills b ON b.id = bp.bill_id WHERE bp.amount < 0 AND bp.received_at >= ? AND bp.received_at < ? AND date(bp.received_at, 'localtime') BETWEEN ? AND ?`).all(slack.lo, slack.hi, from, to) as
    { date: string; amount: number; mode: string; bill: string }[]) {
    lines.push({ source: 'refund', date: r.date, ref: r.bill, who: 'Patient', what: 'Refund (already taken off Money in)', mode: r.mode || 'Unspecified', amount: money2(r.amount), status: 'active', counted: false });
  }
  lines.sort((a, b) => b.date.localeCompare(a.date));
  const sum = (src: OutLine['source']) => money2(lines.filter((l) => l.source === src && l.counted).reduce((a, l) => a + l.amount, 0));
  const vouchers = sum('voucher'); const suppliers = sum('supplier');
  return { lines, total: money2(vouchers + suppliers), vouchers, suppliers, refunds: money2(lines.filter((l) => l.source === 'refund').reduce((a, l) => a + l.amount, 0)) };
}

export interface DayBookDay { day: string; opening_cash: number; in_by_mode: Record<string, number>; out_by_mode: Record<string, number>; total_in: number; total_out: number; closing_cash: number }
export function dayBook(db: Database.Database, from: string, to: string): { days: DayBookDay[]; opening_cash_set: boolean } {
  const acct = readAcct(db); const start = acct.opening_date && acct.opening_date <= from ? acct.opening_date : from;
  const byMode = (rows: { mode: string; amount: number }[]) => { const o: Record<string, number> = {}; for (const r of rows) o[r.mode || 'Unspecified'] = money2((o[r.mode || 'Unspecified'] ?? 0) + r.amount); return o; };
  const outOn = (a: string, b: string) => {
    const rows: { mode: string; amount: number }[] = [];
    for (const l of moneyOut(db, a, b).lines) if (l.counted) rows.push({ mode: l.mode, amount: l.amount });
    return rows;
  };
  const cash = (m: Record<string, number>) => m['Cash'] ?? 0;
  let open = acct.opening_cash;
  if (start < from) {       // cash that moved between the opening day and the first day shown
    const prevEnd = localDay(new Date(parseDay(from).getTime() - 86400000));
    open = money2(acct.opening_cash + cash(byMode(collections(db, start, prevEnd).by_mode.map((m) => ({ mode: m.payment_mode, amount: m.total })))) - cash(byMode(outOn(start, prevEnd))));
  }
  const days: DayBookDay[] = [];
  for (const day of eachDay(from, to, 93)) {
    const inM = byMode(collections(db, day, day).by_mode.map((m) => ({ mode: m.payment_mode, amount: m.total }))); const outM = byMode(outOn(day, day));
    const totalIn = money2(Object.values(inM).reduce((a, n) => a + n, 0)); const totalOut = money2(Object.values(outM).reduce((a, n) => a + n, 0));
    const closing = money2(open + cash(inM) - cash(outM));
    days.push({ day, opening_cash: open, in_by_mode: inM, out_by_mode: outM, total_in: totalIn, total_out: totalOut, closing_cash: closing }); open = closing;
  }
  return { days, opening_cash_set: !!acct.opening_date };
}

export interface ProfitLoss {
  from: string; to: string; revenue: number; pharmacy_cost: number; pharmacy_cost_missing: boolean; expenses: number; expenses_by_head: { head: string; amount: number }[];
  salaries: number; doctor_payments: number; referral_payments: number; total_costs: number; profit: number;
}
export function profitAndLoss(db: Database.Database, from: string, to: string): ProfitLoss {
  const revenue = collections(db, from, to).total;
  let cost = 0, missing = false;
  try { const t = profitReport(db, { from, to }).totals; cost = t.cogs; missing = t.uncosted_units > 0; } catch { /* no pharmacy data: cost 0 */ }
  const rows = db.prepare(`SELECT voucher_type AS t, COALESCE(NULLIF(TRIM(category), ''), 'Other') AS head, SUM(gross_amount) AS g FROM acct_vouchers
      WHERE status = 'active' AND voucher_date BETWEEN ? AND ? AND voucher_type IN ('clinic_maintenance','expense','staff_salary','doctor_payment','referral_payment') GROUP BY t, head`).all(from, to) as { t: string; head: string; g: number }[];
  const sum = (t: string) => money2(rows.filter((r) => r.t === t).reduce((a, r) => a + r.g, 0));
  const heads = new Map<string, number>();
  for (const r of rows) if (r.t === 'clinic_maintenance' || r.t === 'expense') heads.set(r.head, money2((heads.get(r.head) ?? 0) + r.g));
  const expenses = money2([...heads.values()].reduce((a, n) => a + n, 0));
  const salaries = sum('staff_salary'); const doctor = sum('doctor_payment'); const referral = sum('referral_payment');
  const total = money2(cost + expenses + salaries + doctor + referral);
  return {
    from, to, revenue, pharmacy_cost: money2(cost), pharmacy_cost_missing: missing, expenses, expenses_by_head: [...heads.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount),
    salaries, doctor_payments: doctor, referral_payments: referral, total_costs: total, profit: money2(revenue - total),
  };
}
