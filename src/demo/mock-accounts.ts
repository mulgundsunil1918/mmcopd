/**
 * Demo version of the Accounts API (website demo and screenshots): the same shapes the real main process returns, filled from the demo's visits and bills.
 * Simplified on purpose — earnings are a share of the fees; the real rules and the real engine live in src/main/accounts.ts (tested there).
 */
import { DEDUCTION_KINDS, parseAcctSettings, parsePayRules, prefixFor, voucherNumber, voucherProblem, voucherType, numberOfVoucher, suggestSalary, daysInMonth } from '../lib/accountsRules';
import { referralKey } from '../lib/referralStats';

const r = <T,>(v: T): Promise<T> => Promise.resolve(v);
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const money2 = (n: number) => Math.round(n * 100) / 100;

export function makeAccountsMock(ctx: { doctors: () => any[]; appointments: () => any[]; bills: () => any[]; settings: any }) {
  let id = 10;
  const vouchers: any[] = [
    { id: 1, voucher_no: 'CM-0001', voucher_type: 'clinic_maintenance', voucher_date: day(-6), payee_kind: 'other', payee_ref: null, payee_name: 'Medical store', category: 'Clinic maintenance', description: 'Hand wash', gross_amount: 45, deduction_amount: 0, deduction_kind: null, deduction_label: null, net_amount: 45, pay_mode: 'Cash', pay_reference: null, period_from: null, period_to: null, raised_by: 'Admin', raised_role: 'admin', status: 'active', cancelled_at: null, cancelled_by: null, cancel_reason: null, created_at: '', days: [] },
    { id: 2, voucher_no: 'EXP-0001', voucher_type: 'expense', voucher_date: day(-5), payee_kind: 'other', payee_ref: null, payee_name: 'Sri Lakshmi Properties', category: 'Rent', description: 'Clinic rent', gross_amount: 18000, deduction_amount: 0, deduction_kind: null, deduction_label: null, net_amount: 18000, pay_mode: 'Bank transfer', pay_reference: 'NEFT 4471', period_from: null, period_to: null, raised_by: 'Admin', raised_role: 'admin', status: 'active', cancelled_at: null, cancelled_by: null, cancel_reason: null, created_at: '', days: [] },
    { id: 3, voucher_no: 'SAL-0001', voucher_type: 'staff_salary', voucher_date: day(-3), payee_kind: 'staff', payee_ref: '1', payee_name: 'Sunita Rao', category: null, description: 'Salary', gross_amount: 14000, deduction_amount: 1000, deduction_kind: 'advance', deduction_label: 'Advance recovery', net_amount: 13000, pay_mode: 'UPI', pay_reference: null, period_from: null, period_to: null, raised_by: 'Admin', raised_role: 'admin', status: 'active', cancelled_at: null, cancelled_by: null, cancel_reason: null, created_at: '', days: [] },
    { id: 4, voucher_no: 'CM-0002', voucher_type: 'clinic_maintenance', voucher_date: day(-1), payee_kind: 'other', payee_name: 'Hardware shop', payee_ref: null, category: 'Clinic maintenance', description: 'Bulb for room 2', gross_amount: 120, deduction_amount: 0, deduction_kind: null, deduction_label: null, net_amount: 120, pay_mode: 'Cash', pay_reference: null, period_from: null, period_to: null, raised_by: 'Reception', raised_role: 'staff', status: 'active', cancelled_at: null, cancelled_by: null, cancel_reason: null, created_at: '', days: [] },
  ];
  const staff: any[] = [
    { id: 1, name: 'Sunita Rao', job: 'Nurse', phone: '', monthly_salary: 14000, keep_attendance: 1, is_active: 1, joined_on: null, advance_open: 2000, paid_this_month: 13000 },
    { id: 2, name: 'Mahesh', job: 'Helper', phone: '', monthly_salary: 8000, keep_attendance: 0, is_active: 1, joined_on: null, advance_open: 0, paid_this_month: 0 },
    { id: 3, name: 'Divya', job: 'Front desk', phone: '', monthly_salary: 11000, keep_attendance: 1, is_active: 1, joined_on: null, advance_open: 0, paid_this_month: 0 },
  ];
  const marks = new Map<string, string>([[`1|${day(-4)}`, 'absent'], [`1|${day(-9)}`, 'half_day']]);
  const cats = ['Clinic maintenance', 'Consumables', 'Utilities', 'Rent', 'Marketing', 'Equipment', 'Other'].map((name, i) => ({ id: i + 1, name, is_active: 1, sort_order: i }));

  const doctorRows = (from: string, to: string, doctorId?: number) => {
    const pay = parsePayRules(ctx.settings.pay_rules_json);
    const appts = ctx.appointments().filter((a: any) => a.status !== 'Cancelled');
    const dates = appts.map((a: any) => String(a.appointment_date)).sort();
    // the demo's visits sit in a fixed window in the past: slide them so the LAST visit day is today, and the period chips (Today, Yesterday, This month …) all have something to show
    const last = dates[dates.length - 1] ?? day(0);
    const shiftBy = Math.round((new Date(day(0) + 'T00:00:00').getTime() - new Date(last + 'T00:00:00').getTime()) / 86400000);
    const slid = (s: string) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + shiftBy); return d.toLocaleDateString('en-CA'); };
    const days: any[] = []; const sums = new Map<number, any>();
    const seen = new Set<string>();
    for (const a of [...appts].sort((x: any, y: any) => String(x.appointment_date).localeCompare(String(y.appointment_date)) || x.id - y.id)) {
      const key = `${a.patient_id}|${a.doctor_id}`; const first = !seen.has(key); seen.add(key);
      const when = slid(String(a.appointment_date));
      if (when < from || when > to || (doctorId && a.doctor_id !== doctorId)) continue;
      const bs = ctx.bills().filter((b: any) => b.appointment_id === a.id && b.status !== 'cancelled');
      const total = bs.reduce((s: number, b: any) => s + (b.total || 0), 0), paid = bs.reduce((s: number, b: any) => s + (b.amount_paid ?? b.total ?? 0), 0);
      const free = bs.some((b: any) => b.is_free_followup);
      const kind = first ? 'new_patient' : free ? 'free_followup' : bs.length ? 'paid_repeat' : 'not_billed';
      const k = `${a.doctor_id}|${when}`;
      let d = days.find((x) => x.__k === k);
      if (!d) { d = { __k: k, doctor_id: a.doctor_id, day: when, new_patient: 0, new_first_ever: 0, free_followup: 0, free_courtesy: 0, paid_repeat: 0, not_billed: 0, visits: 0, billed: 0, collected: 0, earned: 0, paid: 0, balance: 0, overpaid: 0, status: 'none', vouchers: [], added_after_payment: 0 }; days.push(d); }
      d[kind]++; d.visits++; if (first) d.new_first_ever += first ? 1 : 0; d.billed += total; d.collected += paid;
      const rule = pay.doctors[String(a.doctor_id)]; const pct = rule?.basis === 'percent_of_fees' || rule?.basis === 'percent_of_revenue' ? rule.percent : 0;
      d.earned = money2(d.earned + (rule?.basis === 'per_visit' ? rule.per_visit : paid * pct / 100));
    }
    // yesterday-and-older demo days are partly paid, so the screen shows every state
    days.sort((x, y) => x.day.localeCompare(y.day)).forEach((d, i) => {
      const stateIdx = i % 4; if (d.earned <= 0) { delete d.__k; return; }
      if (stateIdx === 0) { d.paid = d.earned; d.status = 'paid'; d.vouchers = ['DOC-0001']; }
      else if (stateIdx === 1) { d.paid = money2(d.earned / 2); d.status = 'part'; d.vouchers = ['DOC-0001']; }
      else d.status = 'to_pay';
      d.balance = money2(d.earned - d.paid); delete d.__k;
    });
    for (const d of days) {
      const dr: any = ctx.doctors().find((x: any) => x.id === d.doctor_id);
      const s = sums.get(d.doctor_id) ?? { doctor_id: d.doctor_id, name: dr?.name ?? '', basis: pay.doctors[String(d.doctor_id)]?.basis ?? 'by_hand', visits: 0, new_patient: 0, new_first_ever: 0, free_followup: 0, free_courtesy: 0, paid_repeat: 0, not_billed: 0, billed: 0, collected: 0, earned: 0, paid: 0, balance: 0, cost_missing: 0 };
      for (const f of ['visits', 'new_patient', 'new_first_ever', 'free_followup', 'free_courtesy', 'paid_repeat', 'not_billed', 'billed', 'collected', 'earned', 'paid', 'balance']) s[f] = money2(s[f] + d[f]);
      sums.set(d.doctor_id, s);
    }
    return { money: true, days, doctors: [...sums.values()] };
  };

  const outLines = (from: string, to: string) => {
    const lines: any[] = vouchers.filter((v) => v.voucher_date >= from && v.voucher_date <= to).map((v) => ({ source: 'voucher', date: v.voucher_date, ref: v.voucher_no, who: v.payee_name, what: v.description || v.category || '', mode: v.pay_mode, amount: v.net_amount, status: v.status, counted: v.status === 'active', voucher_id: v.id }));
    if (day(-4) >= from && day(-4) <= to) lines.push({ source: 'supplier', date: day(-4), ref: 'INV-2291', who: 'Sri Ganesh Pharma', what: 'Supplier payment', mode: 'Bank transfer', amount: 9400, status: 'active', counted: true });
    if (day(-2) >= from && day(-2) <= to) lines.push({ source: 'refund', date: day(-2), ref: 'INV-0087', who: 'Patient', what: 'Refund (already taken off Money in)', mode: 'Cash', amount: 250, status: 'active', counted: false });
    lines.sort((a, b) => b.date.localeCompare(a.date));
    const sum = (src: string) => money2(lines.filter((l) => l.source === src && l.counted).reduce((a, l) => a + l.amount, 0));
    return { lines, total: money2(sum('voucher') + sum('supplier')), vouchers: sum('voucher'), suppliers: sum('supplier'), refunds: 250 };
  };

  return {
    permissions: () => r({ role: 'admin', name: 'Admin', can_raise: true, can_cancel: true, can_see_money: true, limit: null, reason: '' }),
    moneyOut: (from: string, to: string) => r(outLines(from, to)),
    vouchers: (f: any = {}) => r(vouchers.filter((v) => (!f.status || v.status === f.status) && (!f.type || v.voucher_type === f.type)).sort((a, b) => b.id - a.id)),
    voucher: (vid: number) => r(vouchers.find((v) => v.id === vid) ?? null),
    dayBook: (from: string, to: string) => {
      const days: any[] = []; let open = parseAcctSettings(ctx.settings.acct_settings_json).opening_cash || 12500;
      const d = new Date(from + 'T00:00:00'); const end = new Date(to + 'T00:00:00');
      for (let i = 0; d <= end && i < 93; i++, d.setDate(d.getDate() + 1)) {
        const dd = d.toLocaleDateString('en-CA'); const seed = (i * 37 + 11) % 9;
        const cashIn = 2800 + seed * 310, upiIn = 1900 + seed * 240, cashOut = vouchers.filter((v) => v.voucher_date === dd && v.pay_mode === 'Cash' && v.status === 'active').reduce((a, v) => a + v.net_amount, 0);
        const bankOut = vouchers.filter((v) => v.voucher_date === dd && v.pay_mode !== 'Cash' && v.status === 'active').reduce((a, v) => a + v.net_amount, 0);
        const close = money2(open + cashIn - cashOut);
        days.push({ day: dd, opening_cash: open, in_by_mode: { Cash: cashIn, UPI: upiIn }, out_by_mode: { ...(cashOut ? { Cash: cashOut } : {}), ...(bankOut ? { UPI: bankOut } : {}) }, total_in: cashIn + upiIn, total_out: cashOut + bankOut, closing_cash: close }); open = close;
      }
      return r({ days, opening_cash_set: true });
    },
    profitLoss: (from: string, to: string) => {
      const act = vouchers.filter((v) => v.status === 'active' && v.voucher_date >= from && v.voucher_date <= to);
      const sum = (t: string) => act.filter((v) => v.voucher_type === t).reduce((a, v) => a + v.gross_amount, 0);
      const heads = new Map<string, number>(); for (const v of act) if (v.voucher_type === 'clinic_maintenance' || v.voucher_type === 'expense') heads.set(v.category || 'Other', (heads.get(v.category || 'Other') ?? 0) + v.gross_amount);
      const expenses = [...heads.values()].reduce((a, n) => a + n, 0); const revenue = 142600, cost = 21800;
      const total = cost + expenses + sum('staff_salary') + sum('doctor_payment') + sum('referral_payment');
      return r({ from, to, revenue, pharmacy_cost: cost, pharmacy_cost_missing: false, expenses, expenses_by_head: [...heads.entries()].map(([head, amount]) => ({ head, amount })), salaries: sum('staff_salary'), doctor_payments: sum('doctor_payment'), referral_payments: sum('referral_payment'), total_costs: total, profit: revenue - total });
    },
    staff: () => r(staff.map((s) => ({ ...s }))),
    attendance: (staffId: number, ym: string) => r([...marks.entries()].filter(([k]) => k.startsWith(`${staffId}|${ym}`)).map(([k, status]) => ({ day: k.split('|')[1], status, note: null }))),
    salarySuggestion: (staffId: number, ym: string) => { const s = staff.find((x) => x.id === staffId); if (!s) return r(null); const m = [...marks.entries()].filter(([k]) => k.startsWith(`${staffId}|${ym}`)).map(([, status]) => ({ status })); return r({ monthly: s.monthly_salary, keep_attendance: !!s.keep_attendance, ...suggestSalary(s.monthly_salary, ym, s.keep_attendance ? m : []) }); },
    categories: () => r(cats),
    doctorDays: (f: any) => r(doctorRows(f.from, f.to, f.doctorId)),
    referrerDays: () => r({ money: true, days: [], referrers: [{ key: referralKey('Dr. Ramesh Kumar'), name: 'Dr. Ramesh Kumar', visits: 6, collected: 3400, earned: 340, paid: 0, balance: 340 }] }),
    createVoucher: (input: any) => {
      const bad = voucherProblem(input); if (bad) return r({ ok: false as const, error: bad });
      const t = voucherType(input.type)!; const n = vouchers.filter((v) => v.voucher_type === input.type).reduce((m, v) => Math.max(m, numberOfVoucher(v.voucher_no)), 0) + 1;
      const ded = Number(input.deduction || 0); const v = { id: ++id, voucher_no: voucherNumber(prefixFor(parseAcctSettings(ctx.settings.acct_settings_json), t.id), n), voucher_type: input.type, voucher_date: input.date, payee_kind: input.payee_kind, payee_ref: input.payee_ref ?? null, payee_name: input.payee_name, category: input.category ?? null, description: input.description ?? null, gross_amount: Number(input.gross), deduction_amount: ded, deduction_kind: ded ? input.deduction_kind : null, deduction_label: ded ? (input.deduction_label || DEDUCTION_KINDS.find((d) => d.id === input.deduction_kind)?.label) : null, net_amount: money2(Number(input.gross) - ded), pay_mode: input.pay_mode, pay_reference: input.reference ?? null, period_from: input.period_from ?? null, period_to: input.period_to ?? null, raised_by: 'Admin', raised_role: 'admin', status: 'active', cancelled_at: null, cancelled_by: null, cancel_reason: null, created_at: '', days: [] };
      vouchers.push(v as any); return r({ ok: true as const, voucher: v, unused: 0 });
    },
    cancelVoucher: (vid: number, reason: string) => { const v = vouchers.find((x) => x.id === vid); if (!v) return r({ ok: false as const, error: 'That voucher was not found.' }); if (String(reason).trim().length < 3) return r({ ok: false as const, error: 'Write the reason for cancelling (a few words).' }); v.status = 'cancelled'; v.cancel_reason = reason; v.cancelled_by = 'Admin'; return r({ ok: true as const, voucher: v }); },
    saveStaff: (s: any) => { if (!String(s.name || '').trim()) return r({ ok: false as const, error: 'Enter the staff member’s name.' }); if (s.id) Object.assign(staff.find((x) => x.id === s.id) ?? {}, { ...s, keep_attendance: s.keep_attendance ? 1 : 0, is_active: s.is_active === false ? 0 : 1 }); else staff.push({ id: ++id, ...s, keep_attendance: s.keep_attendance ? 1 : 0, is_active: 1, advance_open: 0, paid_this_month: 0 }); return r({ ok: true as const, id: s.id ?? id }); },
    saveCategory: (c: any) => { if (c.id) Object.assign(cats.find((x) => x.id === c.id) ?? {}, { ...(c.name !== undefined ? { name: c.name } : {}), ...(c.is_active !== undefined ? { is_active: c.is_active ? 1 : 0 } : {}) }); else if (c.name) cats.push({ id: ++id, name: c.name, is_active: 1, sort_order: cats.length }); return r({ ok: true as const }); },
    setAttendance: (staffId: number, d: string, status: string | null) => { if (status) marks.set(`${staffId}|${d}`, status); else marks.delete(`${staffId}|${d}`); void daysInMonth; return r({ ok: true as const }); },
  };
}
