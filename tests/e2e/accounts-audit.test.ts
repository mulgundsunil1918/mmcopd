// Accounts — the audit: tricky money, checked against numbers worked out by hand. Real handlers on a temporary database; the odd column (GST on a bill, a
// ward visit line) is set with SQL because the clinic's GST switches are not what is being tested here.
//   - a cut is worked out on the value BEFORE GST, after discount, and only on what has been COLLECTED (a part-paid bill, medicines on credit);
//   - a cancelled bill earns nothing; a refund is not money out twice;
//   - medicines: "% of the sale" and "% of the PROFIT" (profit = value before GST − what the medicines cost; a sale with no recorded cost is left out of a profit cut);
//   - a ward visit line counts for the doctor named on it, in proportion to how much of the ward bill has been paid;
//   - "count pay from" keeps old days from turning into money owed; referrers: every visit / first visit only, and the same date rule;
//   - salaries, vouchers and profit are shown only to people allowed to see money (and the Settings staff editor still gets everything);
//   - the day book does not invent cash before the day it was counted.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const [d1, d0, dNext] = [day(-1), day(0), day(1)];
  await call('settings:save', { gst_enabled: false, pharmacy_credit_enabled: true, ipd_auto_accrue_bed: false, ipd_auto_accrue_nursing: false, ipd_auto_accrue_doctor_visit: false, bill_round_off: false });
  const docA = await call('doctors:create', { name: 'Dr. Audit A', specialty: 'GP', default_fee: 1000 });
  const docB = await call('doctors:create', { name: 'Dr. Audit B', specialty: 'GP', default_fee: 400 });
  let n = 0, t = 0;
  const patient = (first: string) => call('patients:create', { first_name: first, last_name: 'Audit', dob: '1985-01-01', gender: 'F', phone: `97${String(++n).padStart(8, '0')}` });
  const [p1, p2, p3, p4, p5] = await Promise.all(['Ann', 'Bea', 'Cia', 'Dee', 'Eve'].map(patient));
  const time = () => `${String(8 + Math.floor(++t / 6)).padStart(2, '0')}:${String((t % 6) * 10).padStart(2, '0')}`;
  const visit = async (p: any, doc: any, date: string, fee: number | null, extra: any = {}) => {
    const appointment = { patient_id: p.id, doctor_id: doc.id, appointment_date: date, appointment_time: time(), ...extra };
    if (fee === null) return { appointment: await call('appointments:create', appointment), bill: null as any };
    return call('appointments:createWithBill', { appointment, bill: { items: [{ description: 'Consultation', qty: 1, rate: fee, amount: fee }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' } });
  };
  const setBill = (id: number, f: { total?: number; cgst?: number; sgst?: number; paid: number }) => {
    if (f.total !== undefined) db.prepare('UPDATE bills SET total=? WHERE id=?').run(f.total, id);
    if (f.cgst !== undefined) db.prepare('UPDATE bills SET cgst_total=?, sgst_total=? WHERE id=?').run(f.cgst, f.sgst ?? f.cgst, id);
    db.prepare('DELETE FROM bill_payments WHERE bill_id=?').run(id); db.prepare('UPDATE bills SET amount_paid=? WHERE id=?').run(f.paid, id);
    if (f.paid > 0) db.prepare("INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at) VALUES (?,?,?, datetime('now'))").run(id, f.paid, 'Cash');
  };
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true, limit: null } } }), pay_rules_json: JSON.stringify({
    doctors: {
      [docA.id]: { basis: 'percent_of_fees', percent: 10, cuts: { services: { mode: 'percent', value: 20 }, pharmacy: { mode: 'percent', value: 10, base: 'bill' }, ipd: { mode: 'percent', value: 10 } } },
      [docB.id]: { basis: 'by_hand', cuts: { pharmacy: { mode: 'percent', value: 10, base: 'profit' } } },
    },
    referrer_default: { mode: 'percent', value: 5, scope: 'every', on: { consultation: true, pharmacy: true } },
  }) });

  // stock: ₹6 a tablet, sold at ₹10
  const sup = await call('wholesalers:upsert', { name: 'Audit Supplies', drug_license_no: 'DL-AUD' });
  const tab = await call('pharmacy:upsertDrug', { name: 'Audit Tab', default_mrp: 10, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 5 });
  const pur = await call('purchase:create', { client_ref: 'aud-pur', invoice_number: 'AUD-1', wholesaler_id: sup.id, invoice_date: d0, items: [{ drug_master_id: tab.id, batch_no: 'A1', expiry: '2031-01-31', qty_received: 500, free_qty: 0, purchase_price: 6, mrp: 10, gst_rate: 0 }] });
  ok(pur.ok, 'stock is bought');
  const sell = (p: any, appt: any, qty: number, extra: any = {}) => call('pharmacy:sell', { patient_id: p.id, appointment_id: appt.id, items: [{ drug_master_id: tab.id, drug_name: 'Audit Tab', qty, rate: 10 }], payment_mode: 'Cash', client_ref: `aud-${++n}`, ...extra });

  // ---- Dr. A: a part-paid consultation with GST, a cancelled bill, a service, two medicine sales (one on credit), a ward visit
  const vA = await visit(p1, docA, d0, 1000);
  setBill(vA.bill.id, { total: 1180, cgst: 90, paid: 590 });                                              // 1000 + 180 GST, half paid
  const ghost = await call('bills:create', { appointment_id: vA.appointment.id, patient_id: p1.id, items: [{ description: 'Consultation', qty: 1, rate: 700, amount: 700 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  db.prepare("UPDATE bills SET status='cancelled', cancelled_at=datetime('now') WHERE id=?").run(ghost.id);
  const svc = await call('bills:create', { appointment_id: vA.appointment.id, patient_id: p1.id, items: [{ description: 'Dressing', qty: 1, rate: 600, amount: 600 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  db.prepare("UPDATE bills SET bill_kind='misc' WHERE id=?").run(svc.id); setBill(svc.id, { paid: 600 });
  const credit = await sell(p1, vA.appointment, 10, { credit: true, paid_now: 30 });                      // ₹100, ₹30 paid now
  ok(credit.id && credit.on_credit === 1, `a credit sale is made (${credit.error ?? 'ok'})`);
  const gstSale = await sell(p1, vA.appointment, 10);                                                    // ₹100 cash …
  db.prepare('UPDATE pharmacy_sales SET total=112, cgst_total=6, sgst_total=6, amount_paid=112 WHERE id=?').run(gstSale.id);   // … made to read ₹112 with ₹12 GST
  const ward = await call('wards:save', { name: 'Aud Ward', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bed = await call('beds:save', { ward_id: ward.id, bed_number: 'AUD-1' });
  const adm = await call('ip:admitV2', { patient_id: p5.id, bed_id: bed.id, admission_doctor_id: docA.id, performed_by: 'tester' });
  const ipdBill = one('SELECT id FROM bills WHERE admission_id=?', adm.admission_id ?? adm.id ?? adm.admission?.id);
  ok(!!ipdBill, 'the ward bill exists');
  db.prepare("INSERT INTO bill_items (bill_id, description, qty, rate, amount, source, source_ref_id, accrual_date) VALUES (?, 'Doctor visit', 1, 500, 500, 'doctor_visit', ?, ?)").run(ipdBill.id, docA.id, d0);
  db.prepare('UPDATE bills SET total=2000, subtotal=2000 WHERE id=?').run(ipdBill.id); setBill(ipdBill.id, { paid: 1000 });

  section('1 · Dr. A: every cut is on the value before GST, after discount, and on what was collected');
  let a = await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id });
  const rowA = a.days.find((x: any) => x.day === d0) || {};
  near(rowA.earned, 50 + 120 + 3 + 10 + 25, 'earned = 10% of 500 (the ₹1180 bill, ₹180 GST out, half paid) + 20% of the ₹600 service + 3 + 10 on the two medicine sales + 10% of half of the ward visit');
  const parts = (await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).doctors[0];
  near(parts.billed, 1180 + 600 + 100 + 112 + 500, 'billed (statistics): the cancelled ₹700 bill is not in it; the ward line counts as billed ₹500');
  near(parts.collected, 590 + 600 + 30 + 112 + 250, 'collected: 590 + 600 + 30 + 112 + 250 (half of the ward line)');
  const later = await call('pharmacy:payCredit', credit.id, { amount: 70, mode: 'Cash', client_ref: 'aud-credit-2' });
  ok(later.ok !== false, `the rest of the credit sale is paid later (${later.error ?? 'ok'})`);
  a = await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id });
  near(a.days[0].earned, 50 + 120 + 10 + 10 + 25, 'when the ₹70 comes in the cut on that sale grows from 3 to 10 — added to the same day');

  section('2 · Dr. B: a cut on PROFIT (before GST, less what the medicines cost)');
  const vB1 = await visit(p2, docB, d0, 400); const vB2 = await visit(p3, docB, d0, null);
  await sell(p2, vB1.appointment, 10);                                                                   // ₹100, cost ₹60 → profit 40
  const gst2 = await sell(p3, vB2.appointment, 10); db.prepare('UPDATE pharmacy_sales SET total=112, cgst_total=6, sgst_total=6, amount_paid=112 WHERE id=?').run(gst2.id);   // ₹112 with ₹12 GST: profit still 100 − 60
  db.prepare("INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, total, amount_paid, payment_mode) VALUES ('AUD-RAW', ?, ?, 100, 100, 100, 'Cash')").run(p3.id, vB2.appointment.id);   // a sale with no recorded cost
  const b = await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docB.id });
  near(b.days[0].earned, 4 + 4, 'earned = 10% of ₹40 profit + 10% of ₹40 profit (the GST is not profit); the sale with no cost is left out');
  eq(b.doctors[0].cost_missing, 1, '…and the card counts the sale whose cost is not recorded');

  section('3 · “count pay from” keeps old days from becoming money owed');
  const rulesNow = JSON.parse((await call('settings:get')).pay_rules_json);
  await call('settings:save', { pay_rules_json: JSON.stringify({ ...rulesNow, doctors: { ...rulesNow.doctors, [docA.id]: { ...rulesNow.doctors[docA.id], since: dNext } } }) });
  near((await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).days[0].earned, 0, 'before the date, nothing is earned (the visits are still counted)');
  eq((await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).doctors[0].visits, 1, '…the visit is still in the statistics');
  await call('settings:save', { pay_rules_json: JSON.stringify({ ...rulesNow, doctors: { ...rulesNow.doctors, [docA.id]: { ...rulesNow.doctors[docA.id], since: d0 } } }) });
  ok((await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).days[0].earned > 0, 'from the date itself it counts again');
  await call('settings:save', { pay_rules_json: JSON.stringify(rulesNow) });

  section('4 · referrers: every visit or first visit only');
  const rf1 = await visit(p4, docB, d0, 400, { referred_by: 'Dr. Ramesh' }); const rf2 = await visit(p4, docB, d0, 400, { referred_by: 'dr ramesh' });
  await sell(p4, rf1.appointment, 10);
  const r = await call('accounts:referrerDays', { from: d0, to: d0 });
  const ramesh = r.referrers.find((x: any) => /ramesh/i.test(x.name));
  ok(!!ramesh, 'the two spellings are ONE referrer'); eq(ramesh.visits, 2, '…with two visits');
  near(ramesh.earned, 0.05 * (400 + 400 + 100), '5% of what was collected on both visits (₹400 + ₹400 + the ₹100 of medicines)');
  const rules2 = JSON.parse((await call('settings:get')).pay_rules_json);
  await call('settings:save', { pay_rules_json: JSON.stringify({ ...rules2, referrer_default: { ...rules2.referrer_default, scope: 'first' } }) });
  near((await call('accounts:referrerDays', { from: d0, to: d0 })).referrers.find((x: any) => /ramesh/i.test(x.name)).earned, 0.05 * (400 + 100), 'first visit only: the second visit earns nothing');
  await call('settings:save', { pay_rules_json: JSON.stringify({ ...rules2, referrer_default: { ...rules2.referrer_default, since: dNext } }) });
  near((await call('accounts:referrerDays', { from: d0, to: d0 })).referrers.find((x: any) => /ramesh/i.test(x.name)).earned, 0, 'and the date rule applies to referrers too');
  await call('settings:save', { pay_rules_json: JSON.stringify(rules2) });

  section('5 · a refund is not money out twice');
  const refunded = await visit(p5, docB, d1, 300);
  const before = (await call('accounts:profitLoss', d1, d0)).revenue;
  const c = await attempt('bill:cancel', refunded.bill.id, 'audit: refund', 'Cash');
  ok(c.ok, `the bill is cancelled and refunded (${c.ok ? '' : (c as any).error})`);
  const out = await call('accounts:moneyOut', d1, d0);
  near(out.refunds, 300, 'the refund is listed'); near(out.total, out.vouchers + out.suppliers, '…but it is NOT added to money out (it is already taken off money in)');
  near((await call('accounts:profitLoss', d1, d0)).revenue, before - 300, 'money in fell by the refund once');

  section('6 · money is for people allowed to see it');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { manager: { allowed: true } } }) });
  const st = await call('accounts:saveStaff', { name: 'Audit Staff', monthly_salary: 9000 });
  for (const ch of ['moneyOut', 'vouchers', 'profitLoss'] as const) {
    const res = await attempt(`accounts:${ch}`, ...(ch === 'vouchers' ? [{}] : [d1, d0]));
    ok(!res.ok && /allowed to raise vouchers/.test((res as any).error), `${ch} is refused to a role that may not see money`);
  }
  eq((await call('accounts:staff')).find((x: any) => x.id === st.id).monthly_salary, 0, 'the staff list shows the person but not the salary');
  eq((await call('accounts:staff', undefined, undefined, true)).find((x: any) => x.id === st.id).monthly_salary, 9000, '…while the Settings staff editor still gets the real figure (so saving it cannot zero a salary)');
  ok((await attempt('accounts:profitLoss', d1, d0, '1234')).ok, 'the admin password opens it');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true } }, opening_cash: 5000, opening_date: d0 }) });

  section('7 · the day book does not invent cash before it was counted');
  const book = await call('accounts:dayBook', d1, d0);
  near(book.days[0].opening_cash, 0, 'the day before the cash was counted opens at 0');
  near(book.days[1].opening_cash, 5000, 'the day it was counted opens with exactly that cash — whatever the day before closed with');
  section('8 · an in-patient deposit is money in on the day it is received');
  await call('settings:save', { ipd_advance_enabled: true });
  const before8 = { pl: (await call('accounts:profitLoss', d0, d0)).revenue, cash: (await call('accounts:dayBook', d0, d0)).days[0].in_by_mode.Cash ?? 0 };
  const wardB = await call('wards:save', { name: 'Aud Ward 2', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bedB = await call('beds:save', { ward_id: wardB.id, bed_number: 'AUD-2' });
  const admD = await call('ip:admitV2', { patient_id: p2.id, bed_id: bedB.id, admission_doctor_id: docB.id, performed_by: 'tester', advance_amount: 3000, advance_mode: 'Cash' });
  ok(admD.ok, `a patient is admitted with a ₹3000 deposit (${admD.ok ? '' : admD.error})`);
  near((await call('accounts:profitLoss', d0, d0)).revenue, before8.pl + 3000, 'money in rose by the deposit');
  near((await call('accounts:dayBook', d0, d0)).days[0].in_by_mode.Cash, before8.cash + 3000, 'and so did cash in the drawer (day book)');
  section('9 · lab and radiology bills belong to the doctor who ordered them, on the bill\'s own day');
  const base9 = JSON.parse((await call('settings:get')).pay_rules_json);
  await call('settings:save', { pay_rules_json: JSON.stringify({ ...base9, doctors: { ...base9.doctors, [docA.id]: { ...base9.doctors[docA.id], cuts: { lab: { mode: 'fixed', value: 40 }, radiology: { mode: 'percent', value: 5 } } } } }) });
  const mk = async (type: string, amount: number, paid: number) => { const b = await call('bills:create', { appointment_id: null, patient_id: p5.id, items: [{ description: type, qty: 1, rate: amount, amount }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' }); db.prepare('UPDATE bills SET bill_type=?, doctor_id=? WHERE id=?').run(type, docA.id, b.id); setBill(b.id, { paid }); return b; };
  await mk('lab', 500, 250); await mk('radiology', 800, 800);
  const nineA = (await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).days.find((x: any) => x.day === d0);
  near(nineA.earned, 50 + 20 + 40, 'earned = 10% of the fees (50) + ₹40 a lab order × half collected (20) + 5% of the ₹800 scan (40); the visit-linked cuts are switched off in this rule');
  section('10 · tax held back from pay is not a second cost when it is deposited');
  const plBefore = await call('accounts:profitLoss', d0, d0); const outBefore = (await call('accounts:moneyOut', d0, d0)).vouchers;
  const tdsOut = await call('accounts:createVoucher', { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'Income Tax Dept', description: 'TDS for October', category: 'TDS deposit', gross: 100, pay_mode: 'Bank transfer' });
  ok(tdsOut.ok, 'the deposit is raised as an expense under “TDS deposit”');
  const plAfter = await call('accounts:profitLoss', d0, d0);
  near(plAfter.expenses, plBefore.expenses, 'Profit and loss does not count it again'); near((await call('accounts:moneyOut', d0, d0)).vouchers, outBefore + 100, 'it is still money out (+100)');
  section('11 · bad input is refused in words, never a crash');
  const base11 = { type: 'expense', date: d0, payee_kind: 'other', payee_name: 'Shop', description: 'Soap', gross: 10, pay_mode: 'Cash' };
  const bad11: [string, any][] = [
    ['a doctor payee on an expense voucher', { payee_kind: 'doctor', payee_ref: '1' }], ['a staff voucher with a staff member who does not exist', { type: 'staff_salary', payee_kind: 'staff', payee_ref: '987654', payee_name: 'Ghost' }],
    ['a doctor payment to a doctor who does not exist', { type: 'doctor_payment', payee_kind: 'doctor', payee_ref: '987654', payee_name: 'Ghost' }], ['a period that is not a date', { period_from: 'tomorrow', period_to: 'later' }],
    ['an absurd amount', { gross: 1e12 }], ['a very long description', { description: 'x'.repeat(600) }], ['a negative deduction', { deduction: -5 }], ['a text where the amount should be', { gross: 'ten' }],
  ];
  for (const [what, patch] of bad11) { const r = await attempt('accounts:createVoucher', { ...base11, ...patch }, '1234'); ok(r.ok && (r as any).value?.ok === false && String((r as any).value.error).length > 5, `${what} is refused in words`); }
  ok(!(await call('accounts:setAttendance', 987654, d0, 'present')).ok, 'attendance for a staff member who does not exist is refused');
  ok(!(await call('accounts:saveStaff', { name: 'Rich', monthly_salary: 1e12 })).ok, 'an absurd salary is refused'); ok(!(await call('accounts:saveStaff', { id: 987654, name: 'Nobody' })).ok, 'editing a staff member who does not exist is refused');
  ok(!(await call('accounts:cancelVoucher', 1, 'x'.repeat(400), '1234')).ok, 'a cancellation reason that is a page long is refused');
  for (const ch of ['moneyOut', 'dayBook', 'profitLoss']) { const r = await attempt(`accounts:${ch}`, 'not-a-date', d0, '1234'); ok(!r.ok && /valid start and end day/.test((r as any).error), `${ch} with a bad date says so`); }
  const swapped = await call('accounts:dayBook', d0, d1); eq(swapped.days.length, 2, 'a range given backwards is read the right way round');
  await call('settings:save', { acct_settings_json: '{ not json', pay_rules_json: '][', feature_switches_json: '???' });
  ok((await attempt('accounts:doctorDays', { from: d0, to: d0 })).ok && (await attempt('accounts:dayBook', d0, d0)).ok && (await attempt('accounts:permissions')).ok, 'damaged settings never stop the screens (they read as “nothing set”)');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true } }, opening_cash: 5000, opening_date: d0 }), pay_rules_json: JSON.stringify(rules2), feature_switches_json: '' });
  const many = await Promise.all(Array.from({ length: 12 }, (_, i) => call('accounts:createVoucher', { ...base11, description: `Parallel ${i}`, client_ref: `par-${i}` })));
  const nos = many.map((m: any) => m.voucher.voucher_no).sort(); eq(new Set(nos).size, 12, 'twelve vouchers raised at once get twelve different numbers');
  const same = await Promise.all(Array.from({ length: 8 }, () => call('accounts:createVoucher', { ...base11, description: 'Double click', client_ref: 'dbl-1' })));
  eq(new Set(same.map((m: any) => m.voucher.id)).size, 1, 'the same click sent eight times raises ONE voucher');

  section('12 · every figure traces back to a patient');
  const vis = await call('accounts:doctorVisits', { from: d0, to: d0, doctorId: docA.id });
  ok(vis.money && vis.visits.length >= 1, 'the visits behind a doctor’s day are listed');
  const v1 = vis.visits.find((v: any) => v.patient_id === p1.id);
  ok(!!v1 && v1.patient_name.startsWith('Ann') && v1.uhid === p1.uhid, 'each visit names its patient and UHID'); ok(['new_patient', 'free_followup', 'paid_repeat', 'not_billed'].includes(v1.kind), '…and what kind of visit it was');
  near(v1.billed, 1180 + 600 + 100 + 112, 'the money on a visit is what was billed for it (consultation, service, medicines)');
  eq(vis.visits.reduce((a: number, v: any) => a + (v.kind === 'new_patient' ? 1 : 0), 0), (await call('accounts:doctorDays', { from: d0, to: d0, doctorId: docA.id })).doctors[0].new_patient, 'the patients listed add up to the day’s count');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { manager: { allowed: true } } }) });
  const hid = await call('accounts:doctorVisits', { from: d0, to: d0, doctorId: docA.id });
  eq(hid.money, false, 'a role that may not see money still sees the patients…'); eq(hid.visits[0].billed, 0, '…but not the rupees');
  await call('settings:save', { acct_settings_json: JSON.stringify({ raise: { staff: { allowed: true } } }) });
  const out12 = await call('accounts:moneyOut', d1, d0); const refund = out12.lines.find((l: any) => l.source === 'refund');
  ok(!!refund && refund.who.startsWith('Eve') && !!refund.uhid, 'a refund names the patient and UHID');
  const walk = await attempt('bills:create', { appointment_id: null, patient_id: null, items: [{ description: 'Walk-in service', qty: 1, rate: 150, amount: 150 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash', notes: 'Name: Walk In' });
  const un = await call('accounts:unlinked', d0, d0);
  ok(!walk.ok || un.bills >= 1, 'a walk-in bill with no patient is counted so it can be seen, not hidden');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
