// Accounts — what each doctor earned (from money COLLECTED), what vouchers paid, and the books around it. Real handlers on a temporary database.
// Rules proved here (owner, 2026-10-29):
//   - visits are New patient (new to THIS doctor) / Free follow-up (courtesy counted inside) / Paid repeat visit, and a visit with no bill yet is "not billed yet";
//   - STATISTICS go by billing, EARNINGS by collection: a cut is worked out on what has been collected so far (before GST), the rest is added when it comes in;
//   - a voucher records exactly what was paid; it settles the OLDEST days first; what is left stays "to pay"; cancelling returns the days;
//   - money is shown only to people allowed to raise vouchers; a voucher over a role's limit is refused; the admin password overrides;
//   - voucher numbers run per type and are never reused; the same click twice pays once;
//   - staff, advances recovered on a salary voucher, attendance → salary suggestion; day book carries cash from day to day; profit = revenue − costs.
import { boot, call, getDb } from './harness';
import { daysInMonth } from '../../src/lib/accountsRules';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const [d2, d1, d0] = [day(-2), day(-1), day(0)];
  const line = (rate: number, label = 'OPD Consultation') => ({ description: label, qty: 1, rate, amount: rate });
  const docA = await call('doctors:create', { name: 'Dr. Asha Earn', specialty: 'GP', default_fee: 300 });
  const docB = await call('doctors:create', { name: 'Dr. Bala Fixed', specialty: 'GP', default_fee: 400 });
  let n = 0, t = 0;
  const patient = (first: string) => call('patients:create', { first_name: first, last_name: 'Acct', dob: '1990-01-01', gender: 'F', phone: `96${String(++n).padStart(8, '0')}` });
  const [p1, p2, p3, p4] = await Promise.all(['Asha', 'Bina', 'Chitra', 'Deepa'].map(patient));
  const visit = async (p: any, doc: any, date: string, bill: any | null) => {
    const time = `${String(8 + Math.floor(++t / 6)).padStart(2, '0')}:${String((t % 6) * 10).padStart(2, '0')}`;
    const appointment = { patient_id: p.id, doctor_id: doc.id, appointment_date: date, appointment_time: time };
    if (!bill) return { appointment: await call('appointments:create', appointment), bill: null };
    const r = await call('appointments:createWithBill', { appointment, bill: { discount: 0, discount_type: 'flat', payment_mode: 'Cash', ...bill } });
    if (r.bill && r.bill.total > 0) setPaid(r.bill.id, r.bill.total);          // paid in full at the desk
    return r;
  };
  /** Make the bill's collected money exactly `paid` (one payment row, today). */
  const setPaid = (billId: number, paid: number) => {
    db.prepare('DELETE FROM bill_payments WHERE bill_id=?').run(billId);
    db.prepare('UPDATE bills SET amount_paid=? WHERE id=?').run(paid, billId);
    if (paid > 0) db.prepare("INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at) VALUES (?,?,?, datetime('now'))").run(billId, paid, 'Cash');
  };

  // the clinic's own pay rules: Dr. Asha gets 10% of consultation fees plus a 20% cut on services; Dr. Bala a fixed 3000 a month
  const saveRules = (rules: any) => call('settings:save', { pay_rules_json: JSON.stringify(rules) });
  await saveRules({ doctors: {
    [docA.id]: { basis: 'percent_of_fees', percent: 10, cuts: { services: { mode: 'percent', value: 20 } } },
    [docB.id]: { basis: 'fixed_monthly', monthly: 3000, part_month: 'calendar' },
  } });
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true, limit: 500 }, manager: { allowed: true } }, cancel: ['staff'] }) });

  // ---- the visits ----
  const v1 = await visit(p1, docA, d2, { items: [line(300)] });                                   // p1 new to Dr. Asha, first ever at the clinic
  const v2 = await visit(p1, docA, d1, { items: [line(0, 'Consultation (free follow-up)')], is_free_followup: 1, is_relaxed_followup: 1 });
  const v3 = await visit(p2, docA, d1, { items: [line(300)] });                                   // p2 new
  const svc = await call('bills:create', { appointment_id: v3.appointment.id, patient_id: p2.id, items: [line(500, 'Dressing')], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  db.prepare("UPDATE bills SET bill_kind='misc' WHERE id=?").run(svc.id); setPaid(svc.id, 200);  // a 500 service of which only 200 has come in
  await visit(p1, docA, d0, { items: [line(200)] });                                   // p1 again, paid repeat
  await visit(p2, docA, d0, null);                                                                // p2 again, nothing billed yet
  await visit(p3, docA, d0, null);                                                                // p3 new, not billed
  await visit(p4, docB, d0, { items: [line(400)] });

  // ============================================================================================================
  section('1 · visits are counted by kind, and billing and collection are told apart');
  const view = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  ok(view.money, 'a role allowed to raise vouchers sees the money');
  const row = (d: string) => view.days.find((x: any) => x.day === d);
  eq(row(d2).new_patient, 1, 'day 1: one NEW patient'); eq(row(d2).new_first_ever, 1, '…and she was also the clinic’s first-ever visit');
  eq(row(d1).free_followup, 1, 'day 2: one FREE follow-up'); eq(row(d1).free_courtesy, 1, '…and it was a courtesy one'); eq(row(d1).new_patient, 1, 'day 2: and one new patient');
  eq(row(d0).paid_repeat, 1, 'day 3: one PAID repeat visit (p1)'); eq(row(d0).not_billed, 1, '…a repeat visit with no bill is “not billed yet”, not guessed as paid');
  eq(row(d0).new_patient, 1, 'day 3: p3 is new (billed or not)');
  const sA = view.doctors.find((x: any) => x.doctor_id === docA.id);
  eq([sA.visits, sA.new_patient, sA.free_followup, sA.paid_repeat, sA.not_billed].join(','), '6,3,1,1,1', 'the totals add up to every visit');
  near(sA.billed, 1300, 'BILLED (statistics) = 300 + (0 + 300 + 500) + 200'); near(sA.collected, 1000, 'COLLECTED = 300 + (300 + 200) + 200 — the unpaid 300 of the service is not collected');

  // ============================================================================================================
  section('2 · earnings follow what was collected');
  near(row(d2).earned, 30, 'day 1: 10% of 300 fees = 30');
  near(row(d1).earned, 70, 'day 2: 10% of 300 fees = 30, plus a 20% cut on the 200 collected of the 500 service = 40');
  near(row(d0).earned, 20, 'day 3: 10% of 200 = 20');
  near(sA.earned, 120, 'earned in total'); near(sA.balance, 120, 'nothing paid yet, so all of it is to pay');
  setPaid(svc.id, 500);
  const later = (await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id })).days.find((x: any) => x.day === d1);
  near(later.earned, 130, 'day 2 now earns 30 + 100 = 130'); setPaid(svc.id, 200);

  const bala = (await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docB.id })).days;
  eq(bala.length, 3, 'a fixed-monthly doctor earns on every day, visits or not');
  const expectBala = [d2, d1, d0].reduce((a, d) => a + Math.round(3000 / daysInMonth(d.slice(0, 7)) * 100) / 100, 0);
  near(bala.reduce((a: number, x: any) => a + x.earned, 0), expectBala, 'a fixed 3000 a month is spread over the calendar days', 0.02);

  // ============================================================================================================
  section('3 · a voucher pays the oldest days first, and what is left stays to pay');
  const pay1 = await call('accounts:createVoucher', { type: 'doctor_payment', date: d0, payee_kind: 'doctor', payee_ref: String(docA.id), payee_name: docA.name, gross: 80, pay_mode: 'UPI', period_from: d2, period_to: d0, client_ref: 'pay-1' });
  ok(pay1.ok, 'the voucher is raised'); eq(pay1.voucher.voucher_no, 'DOC-0001', 'numbered DOC-0001'); near(pay1.voucher.net_amount, 80, 'it paid 80'); eq(pay1.unused, 0, 'all of it went to earned days');
  const twice = await call('accounts:createVoucher', { type: 'doctor_payment', date: d0, payee_kind: 'doctor', payee_ref: String(docA.id), payee_name: docA.name, gross: 80, pay_mode: 'UPI', period_from: d2, period_to: d0, client_ref: 'pay-1' });
  eq(twice.voucher.id, pay1.voucher.id, 'the same click twice raises ONE voucher');
  let after = (await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id }));
  const a = (d: string) => after.days.find((x: any) => x.day === d);
  eq([a(d2).status, a(d1).status, a(d0).status].join(','), 'paid,part,to_pay', 'day 1 is PAID, day 2 part-paid, day 3 still to pay');
  eq(a(d2).vouchers.join(','), 'DOC-0001', 'the paid day shows the voucher number'); near(a(d1).balance, 20, 'day 2 still owes 70 − 50 = 20');
  near(after.doctors[0].paid, 80, 'paid so far'); near(after.doctors[0].balance, 40, 'to pay = 20 + 20');
  // money collected later on an already-paid day is added to that day
  await visit(p4, docA, d2, { items: [line(100)] });
  after = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  near(a(d2).earned, 40, 'day 1 now earns 40 (a 100 fee came in on it)'); eq(a(d2).status, 'part', '…so it is part-paid again'); near(a(d2).added_after_payment, 10, '…and says 10 was “added after payment”');

  const bad = await call('accounts:cancelVoucher', pay1.voucher.id, 'x'); ok(!bad.ok, 'cancelling needs a reason');
  const can = await call('accounts:cancelVoucher', pay1.voucher.id, 'wrong amount'); ok(can.ok, 'cancelled with a reason'); eq(can.voucher.status, 'cancelled', 'it stays in the list as cancelled');
  after = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  near(after.doctors[0].paid, 0, 'a cancelled voucher pays nothing'); near(after.doctors[0].balance, 40 + 70 + 20, 'all days are due again');
  ok(!(await call('accounts:cancelVoucher', pay1.voucher.id, 'again')).ok, 'it cannot be cancelled twice');

  // any days the clinic likes — one day, a week, a month, or days that are not next to each other
  const rnd = await call('accounts:createVoucher', { type: 'doctor_payment', date: d0, payee_kind: 'doctor', payee_ref: String(docA.id), payee_name: docA.name, gross: 100, pay_mode: 'Cash', days: [d0, d2] });
  eq(rnd.voucher.voucher_no, 'DOC-0002', 'a payment for chosen days is numbered like any other'); eq(rnd.voucher.period_from, d2, '…and its period runs from the first chosen day'); eq(rnd.voucher.period_to, d0, '…to the last');
  near(rnd.unused, 40, 'the chosen days were owed 40 + 20 = 60, so 40 of the 100 settles no day');
  after = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  eq([a(d2).status, a(d1).status, a(d0).status].join(','), 'paid,to_pay,paid', 'only the days chosen are paid; the day in between is still to pay'); near(a(d1).balance, 70, '…and still owes all 70');
  await call('accounts:cancelVoucher', rnd.voucher.id, 'test: back to all due');
  const pay2 = await call('accounts:createVoucher', { type: 'doctor_payment', date: d0, payee_kind: 'doctor', payee_ref: String(docA.id), payee_name: docA.name, gross: 200, deduction: 20, deduction_kind: 'tds', deduction_label: 'TDS 10%', pay_mode: 'Bank transfer', period_from: d2, period_to: d0 });
  eq(pay2.voucher.voucher_no, 'DOC-0003', 'cancelled numbers are not reused'); near(pay2.voucher.net_amount, 180, 'a 20 deduction → 180 paid out'); near(pay2.unused, 70, 'more than was due: 70 is recorded but settles no day');
  after = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  near(after.doctors[0].balance, 0, 'everything due is settled'); ok(after.days.filter((x: any) => x.earned > 0).every((x: any) => x.status === 'paid'), 'every earning day is marked PAID');

  // ============================================================================================================
  section('4 · who may do what');
  const big = await call('accounts:createVoucher', { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'Landlord', description: 'Rent', category: 'Rent', gross: 600, pay_mode: 'Cash' });
  ok(!big.ok && /500/.test(big.error), `over the role’s limit is refused in words (“${big.error}”)`);
  const withAdmin = await call('accounts:createVoucher', { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'Landlord', description: 'Rent', category: 'Rent', gross: 600, pay_mode: 'Cash' }, '1234');
  ok(withAdmin.ok, 'the admin password overrides the limit'); eq(withAdmin.voucher.voucher_no, 'EXP-0001', 'expenses are numbered on their own (EXP-0001)');
  await call('accounts:createVoucher', { type: 'clinic_maintenance', date: d0, payee_kind: 'other', payee_name: 'Chemist', description: 'Hand wash', category: 'Clinic maintenance', gross: 45, pay_mode: 'Cash' });
  const cm2 = await call('accounts:createVoucher', { type: 'clinic_maintenance', date: d0, payee_kind: 'other', payee_name: 'Hardware shop', description: 'Bulb', category: 'Clinic maintenance', gross: 80, pay_mode: 'UPI' });
  eq(cm2.voucher.voucher_no, 'CM-0002', 'clinic maintenance vouchers run CM-0001, CM-0002');
  for (const [what, v] of [['no amount', { gross: 0 }], ['no description', { description: '' }], ['a bad pay mode', { pay_mode: 'Barter' }], ['a deduction above the amount', { deduction: 99 }]] as [string, any][]) {
    const r = await call('accounts:createVoucher', { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'X', description: 'x', gross: 10, pay_mode: 'Cash', ...v }, '1234');
    ok(!r.ok && r.error.length > 5, `${what} is refused in words`);
  }
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { manager: { allowed: true } }, cancel: [] }) });
  const noRaise = await call('accounts:createVoucher', { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'X', description: 'x', gross: 10, pay_mode: 'Cash' });
  ok(!noRaise.ok && /Settings/.test(noRaise.error), 'a role that is not allowed is told where to allow it');
  const hidden = await call('accounts:doctorDays', { from: d2, to: d0, doctorId: docA.id });
  eq(hidden.money, false, 'a role that may not raise vouchers gets no money'); eq(hidden.doctors[0].earned, 0, '…the figures are not just hidden on screen, they are not sent');
  eq(hidden.doctors[0].visits, 7, '…but the visit counts are still there'); ok((await call('accounts:doctorDays', { from: d2, to: d0 }, '1234')).money, 'the admin password shows the money');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true, limit: 500 } }, cancel: ['staff'], opening_cash: 1000, opening_date: d1, prefixes: { clinic_maintenance: 'mnt' } }) });

  // ============================================================================================================
  section('5 · staff, advances, attendance and the salary it suggests');
  const st = await call('accounts:saveStaff', { name: 'Ravi', job: 'Helper', monthly_salary: 6000, keep_attendance: true });
  ok(st.ok, 'a staff member is added');
  ok(!(await call('accounts:saveStaff', { name: '  ' })).ok, 'a nameless staff member is refused');
  const ym = d0.slice(0, 7);
  await call('accounts:setAttendance', st.id, `${ym}-02`, 'absent'); await call('accounts:setAttendance', st.id, `${ym}-03`, 'half_day'); await call('accounts:setAttendance', st.id, `${ym}-04`, 'paid_leave');
  const sug = await call('accounts:salarySuggestion', st.id, ym);
  near(sug.cutDays, 1.5, 'an absent day and a half day cut 1.5 days'); near(sug.amount, Math.round(6000 * (sug.days - 1.5) / sug.days * 100) / 100, 'the suggested salary is pay × (days − cut days) ÷ days');
  const unmarked = await call('accounts:salarySuggestion', st.id, '2000-02'); near(unmarked.amount, 6000, 'a month nobody marked cuts nothing');
  await call('accounts:setAttendance', st.id, `${ym}-03`, null); near((await call('accounts:salarySuggestion', st.id, ym)).cutDays, 1, 'clearing a mark removes its cut');
  await call('accounts:createVoucher', { type: 'advance', date: d0, payee_kind: 'staff', payee_ref: String(st.id), payee_name: 'Ravi', gross: 1000, pay_mode: 'Cash' }, '1234');
  near((await call('accounts:staff', ym)).find((x: any) => x.id === st.id).advance_open, 1000, 'an advance of 1000 is open');
  const sal = await call('accounts:createVoucher', { type: 'staff_salary', date: d0, payee_kind: 'staff', payee_ref: String(st.id), payee_name: 'Ravi', gross: 6000, deduction: 1000, deduction_kind: 'advance', deduction_label: 'Advance recovery', pay_mode: 'Bank transfer', period_from: `${ym}-01`, period_to: d0 }, '1234');
  eq(sal.voucher.voucher_no, 'SAL-0001', 'salary vouchers run SAL-0001'); near(sal.voucher.net_amount, 5000, '6000 less the advance = 5000 paid');
  const r1 = (await call('accounts:staff', ym)).find((x: any) => x.id === st.id);
  near(r1.advance_open, 0, 'the advance is recovered'); near(r1.paid_this_month, 5000, 'this month’s salary paid is 5000');
  const cm3 = await call('accounts:createVoucher', { type: 'clinic_maintenance', date: d0, payee_kind: 'other', payee_name: 'Chemist', description: 'Soap', gross: 20, pay_mode: 'Cash' });
  eq(cm3.voucher.voucher_no, 'MNT-0003', 'a prefix chosen in Settings applies from the next voucher, and the running number carries on');

  // ============================================================================================================
  section('6 · money out, day book and profit and loss');
  const out = await call('accounts:moneyOut', d2, d0);
  const counted = out.lines.filter((l: any) => l.counted && l.source === 'voucher').reduce((s: number, l: any) => s + l.amount, 0);
  near(out.vouchers, counted, 'money out = the active vouchers’ NET amounts'); ok(out.lines.some((l: any) => l.status === 'cancelled' && !l.counted), 'a cancelled voucher is listed but not counted');
  const book = await call('accounts:dayBook', d1, d0);
  eq(book.days.length, 2, 'one line per day'); near(book.days[0].opening_cash, 1000, 'the day book opens with the cash set in Settings');
  for (const d of book.days) near(d.closing_cash, d.opening_cash + (d.in_by_mode.Cash ?? 0) - (d.out_by_mode.Cash ?? 0), `${d.day}: closing cash = opening + cash in − cash out`);
  near(book.days[1].opening_cash, book.days[0].closing_cash, 'a day opens with what the day before closed with');
  const pl = await call('accounts:profitLoss', d2, d0);
  near(pl.profit, pl.revenue - pl.total_costs, 'profit = revenue − all costs');
  near(pl.salaries, 6000, 'salaries are counted at the full amount (the advance recovery is not a second cost)'); near(pl.doctor_payments, 200, 'doctor payments are counted in full (cancelled ones are not)');
  near(pl.expenses, 600 + 45 + 80 + 20, 'expenses = rent + clinic maintenance'); ok(pl.expenses_by_head.some((h: any) => h.head === 'Rent'), 'expenses are grouped by head');
  const listed = await call('accounts:vouchers', { type: 'clinic_maintenance' }); eq(listed.length, 3, 'the voucher list can be filtered by type');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
