// The pay rules a clinic can choose (Settings → Doctors & Templates → Pay and cuts), proved one by one on the pure earning function — no database.
// (tests/e2e/accounts.test.ts proves the same engine end to end: visits, collection, vouchers, permissions, books.)
import { earnedForDay } from '../../src/main/accounts';
import { cleanDoctorRules, cutAmount, defaultDoctorRules, parseAcctSettings, parsePayRules, settleOldestFirst, suggestSalary, mayRaise, mayCancel, maySeeDoctorMoney, voucherProblem } from '../../src/lib/accountsRules';
import { ok, eq, near, section, finish } from './lib';

const stream = (baseP = 0, shareSum = 0, profitP = 0, orders = 0) => ({ billedP: baseP, collectedP: baseP, baseP, shareSum, orders, profitP });
const day = (p: any = {}) => ({
  new_patient: 0, new_first_ever: 0, free_followup: 0, free_courtesy: 0, paid_repeat: 0, not_billed: 0, costMissing: 0,
  streams: { consultation: stream(), services: stream(), pharmacy: stream(), lab: stream(), radiology: stream(), ipd: stream(), ...(p.streams || {}) }, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'streams')),
}) as any;
const rules = (r: any) => cleanDoctorRules({ ...defaultDoctorRules(), ...r });
const TODAY = '2026-11-30';

(async () => {
  section('1 · fixed monthly pay, for a part of a month — the clinic chooses how');
  const fixed = (part_month: string, d: string) => earnedForDay(rules({ basis: 'fixed_monthly', monthly: 3000, part_month }), d, TODAY, day());
  near(fixed('calendar', '2026-11-10'), 100, 'by calendar days: 3000 ÷ 30 days = 100 for a day in November');
  near(fixed('calendar', '2026-10-10'), 3000 / 31, 'a 31-day month spreads over 31 days', 0.01);
  near(fixed('working', '2026-11-10'), 3000 / 25, 'by working days: November 2026 has 25 days that are not Sundays (five Sundays) → 120 a day', 0.01); near(fixed('working', '2026-11-08'), 0, 'a Sunday earns nothing');
  near(fixed('full', '2026-11-01'), 3000, 'pay in full: the whole month is owed from the 1st'); near(fixed('full', '2026-11-02'), 0, '…and nothing more on the other days');
  near(fixed('full_months', '2026-11-30'), 3000, 'only full months: owed on the last day of the month'); near(fixed('full_months', '2026-11-29'), 0, '…and not before');
  near(earnedForDay(rules({ basis: 'fixed_monthly', monthly: 3000 }), '2026-12-05', TODAY, day()), 0, 'a day that has not come yet earns nothing');

  section('2 · per visit, per kind of visit, and shares');
  const visits = day({ new_patient: 2, free_followup: 1, paid_repeat: 3, not_billed: 1 });
  near(earnedForDay(rules({ basis: 'per_visit', per_visit: 50 }), '2026-11-10', TODAY, visits), 50 * 7, 'per visit: every visit counts, billed or not');
  near(earnedForDay(rules({ basis: 'per_visit_type', per_type: { new: 100, free: 0, paid: 60 } }), '2026-11-10', TODAY, visits), 2 * 100 + 0 + 4 * 60, 'per visit type: new, free follow-up, paid repeat (a not-yet-billed repeat is paid as a repeat)');
  const money = day({ streams: { consultation: stream(40000), services: stream(10000), pharmacy: stream(20000), lab: stream(5000) } });
  near(earnedForDay(rules({ basis: 'percent_of_fees', percent: 25 }), '2026-11-10', TODAY, money), 100, '25% of consultation fees (₹400) = 100');
  near(earnedForDay(rules({ basis: 'percent_of_revenue', percent: 10 }), '2026-11-10', TODAY, money), 50, '10% of consultation + services (the default “counts”) = 10% of ₹500');
  near(earnedForDay(rules({ basis: 'percent_of_revenue', percent: 10, counts: { consultation: true, services: true, pharmacy: true, lab: true, radiology: true } }), '2026-11-10', TODAY, money), 75, '…and counting pharmacy and lab as well: 10% of ₹750');
  near(earnedForDay(rules({ basis: 'fixed_plus_percent', monthly: 3000, percent: 10 }), '2026-11-10', TODAY, money), 100 + 50, 'fixed monthly (per day) plus a share');
  near(earnedForDay(rules({ basis: 'by_hand' }), '2026-11-10', TODAY, money), 0, 'by hand: nothing is worked out, the amount is typed on the voucher');

  section('3 · cuts on what the doctor generates');
  const cut = (c: any) => earnedForDay(rules({ basis: 'by_hand', cuts: c }), '2026-11-10', TODAY, day({ streams: { services: stream(10000, 2), pharmacy: stream(20000, 1, 6000, 1), lab: stream(5000, 1.5, 0, 2), radiology: stream(8000, 1), ipd: stream(30000, 1) } }));
  near(cut({ services: { mode: 'percent', value: 20 } }), 20, 'services: 20% of ₹100 collected = 20');
  near(cut({ services: { mode: 'fixed', value: 30 } }), 60, 'services: ₹30 per order × (2 orders fully collected) = 60');
  near(cut({ lab: { mode: 'fixed', value: 40 } }), 60, 'lab: ₹40 per order, in proportion to how much has been collected (1.5 orders’ worth) = 60');
  near(cut({ pharmacy: { mode: 'percent', value: 10, base: 'bill' } }), 20, 'pharmacy on the sale value: 10% of ₹200 = 20');
  near(cut({ pharmacy: { mode: 'percent', value: 10, base: 'profit' } }), 6, 'pharmacy on the PROFIT: 10% of ₹60 = 6');
  near(cut({ radiology: { mode: 'percent', value: 5 }, ipd: { mode: 'percent', value: 10 } }), 4 + 30, 'radiology 5% of ₹80 + ward visits 10% of ₹300');
  near(cutAmount({ mode: 'fixed', value: 100, base: 'bill' }, 0, 0.25), 25, 'a fixed cut is scaled by how much of the order was collected');
  near(cutAmount({ mode: 'percent', value: 10, base: 'bill' }, 80, 1), 8, 'a percentage is taken of what was collected'); near(cutAmount({ mode: 'off', value: 50, base: 'bill' }, 80, 1), 0, '“no cut” gives nothing');

  section('4 · part payments settle the oldest days first');
  const s = settleOldestFirst([{ day: '2026-11-03', due: 30 }, { day: '2026-11-01', due: 50 }, { day: '2026-11-02', due: 20 }], 60);
  eq(s.allocations.map((a) => `${a.day}:${a.amount}`).join(' '), '2026-11-01:50 2026-11-02:10', 'the oldest day is settled first, then part of the next'); near(s.unused, 0, 'nothing left over');
  near(settleOldestFirst([{ day: '2026-11-01', due: 50 }], 80).unused, 30, 'more than is due: the rest is reported, not lost');
  eq(settleOldestFirst([], 50).allocations.length, 0, 'nothing due settles nothing');

  section('5 · salary from attendance, voucher rules, roles');
  near(suggestSalary(6000, '2026-11', [{ status: 'absent' }, { status: 'half_day' }, { status: 'paid_leave' }, { status: 'weekly_off' }, { status: 'present' }]).amount, 6000 * (30 - 1.5) / 30, 'salary = pay × (days − absent − half a day) ÷ days; paid leave, weekly off and present cost nothing');
  near(suggestSalary(6000, '2026-11', []).amount, 6000, 'nobody marked → nothing cut');
  const base = { type: 'expense', date: '2026-11-10', payee_kind: 'other' as const, payee_name: 'Shop', description: 'Soap', gross: 50, pay_mode: 'Cash' };
  eq(voucherProblem(base), null, 'a complete voucher is fine'); ok(!!voucherProblem({ ...base, gross: 0 }) && !!voucherProblem({ ...base, pay_mode: 'Barter' }) && !!voucherProblem({ ...base, description: '' }) && !!voucherProblem({ ...base, deduction: 60 }) && !!voucherProblem({ ...base, date: '10/11/2026' }), 'each missing or wrong thing is refused');
  const a = parseAcctSettings(JSON.stringify({ raise: { manager: { allowed: true, limit: 1000 }, staff: { allowed: false } }, cancel: ['manager'] }));
  ok(mayRaise(a, 'admin', 1e9).ok && mayRaise(a, 'manager', 900).ok && !mayRaise(a, 'manager', 1100).ok && !mayRaise(a, 'staff').ok && !mayRaise(a, 'nurse').ok, 'admin always; a role within its limit; not over it; not a role that was never allowed');
  ok(mayCancel(a, 'admin') && mayCancel(a, 'manager') && !mayCancel(a, 'staff'), 'cancelling: admin and the roles ticked for it');
  ok(maySeeDoctorMoney(a, 'manager') && !maySeeDoctorMoney(a, 'staff') && maySeeDoctorMoney(a, 'admin'), 'a doctor’s money is seen by the same people who may raise vouchers');
  const damaged = parsePayRules('{ nope'); eq(Object.keys(damaged.doctors).length, 0, 'damaged pay rules read as “none set”');
  eq(rules({ basis: 'rocket', percent: 500 }).basis, 'by_hand', 'an unknown pay basis falls back to by-hand'); eq(rules({ basis: 'per_visit', percent: 500 }).percent, 100, 'a percentage is held at 100');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
