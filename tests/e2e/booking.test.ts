// Booking a visit AND its bill is ONE all-or-nothing step (appointments:createWithBill). Before, the screen made two calls — the visit, then the
// bill — so a refusal in between (or a power cut) left a visit with no bill. Now if anything is refused, nothing is saved: no visit, no bill,
// no log line, and no token or visit number is used up. Real handlers on a temporary database.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const count = (t: string) => one(`SELECT COUNT(*) c FROM ${t}`).c as number;

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const doc = await call('doctors:create', { name: 'Dr. Atomic', specialty: 'GP', default_fee: 300 });
  const p1 = await call('patients:create', { first_name: 'Anil', last_name: 'One', dob: '1985-01-01', gender: 'M', phone: '9555000001' });
  const p2 = await call('patients:create', { first_name: 'Beena', last_name: 'Two', dob: '1990-02-02', gender: 'F', phone: '9555000002' });
  const line = (rate = 300, label = 'OPD Consultation') => ({ description: label, qty: 1, rate, amount: rate });
  const book = (patient: number, time: string, bill: Record<string, any> = {}, appt: Record<string, any> = {}) =>
    attempt('appointments:createWithBill', {
      appointment: { patient_id: patient, doctor_id: doc.id, appointment_date: today, appointment_time: time, ...appt },
      bill: { items: [line()], discount: 0, discount_type: 'flat', payment_mode: 'Cash', ...bill },
    });
  const snapshot = () => ({ appts: count('appointments'), bills: count('bills'), lines: count('bill_items'), notes: count('notification_log'),
    maxToken: one('SELECT COALESCE(MAX(token_number),0) m FROM appointments WHERE appointment_date=?', today).m as number,
    visits1: one('SELECT COUNT(*) c FROM appointments WHERE patient_id=?', p1.id).c as number });
  const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

  // ============================================================================================================
  section('1 · the visit and its bill are made together');
  const s0 = snapshot();
  const r1 = await book(p1.id, '09:00');
  ok(r1.ok, `booked with its bill in one step (${r1.ok ? '' : (r1 as any).error})`);
  const { appointment: a1, bill: b1 } = (r1 as any).value;
  eq(count('appointments'), s0.appts + 1, 'one visit was added');
  eq(count('bills'), s0.bills + 1, 'one bill was added');
  eq(b1.appointment_id, a1.id, 'the bill belongs to that visit');
  eq(b1.total, 300, 'the bill is ₹300');
  eq(b1.patient_id, p1.id, '…for the right patient');
  eq(one('SELECT status FROM appointments WHERE id=?', a1.id).status, 'Done', 'raising the bill marks the visit Done, as before');
  eq((await call('appointments:list', { date: today })).find((x: any) => x.id === a1.id)?.bill_id, b1.id, 'the visit list points the visit at its bill');
  eq(a1.token_number, s0.maxToken + 1, 'the visit takes the next token of the day');

  // ============================================================================================================
  section('2 · if the bill is refused, NOTHING is saved');
  const before = snapshot();
  const noLines = await book(p1.id, '09:30', { items: [] });
  ok(!noLines.ok && /at least one line/i.test((noLines as any).error), `a bill with no lines is refused (${(noLines as any).error?.slice(0, 60)})`);
  ok(same(snapshot(), before), '…and no visit, bill, line, log line or token was left behind');
  const bigDiscount = await book(p1.id, '09:30', { discount: 5000 });
  ok(!bigDiscount.ok && /more than the bill/i.test((bigDiscount as any).error), 'a discount bigger than the bill is refused');
  ok(same(snapshot(), before), '…also leaving nothing behind');
  const negative = await book(p1.id, '09:30', { items: [{ description: 'Bad', qty: 1, rate: -5, amount: -5 }] });
  ok(!negative.ok, 'a negative line is refused');
  ok(same(snapshot(), before), '…also leaving nothing behind');
  const after = await book(p1.id, '09:30');
  ok(after.ok, 'the next booking works');
  eq((after as any).value.appointment.token_number, before.maxToken + 1, 'its token is the very next one — the refused attempts used none up');
  eq(one('SELECT visit_number v FROM appointments WHERE id=?', (after as any).value.appointment.id).v,
    one('SELECT visit_number v FROM appointments WHERE id=?', a1.id).v + 1, "…and the patient's visit number carries on without a gap");

  // ============================================================================================================
  section('3 · if the visit is refused, no bill is made');
  const b4 = snapshot();
  const clash = await book(p2.id, '09:00');
  ok(!clash.ok && /already booked/i.test((clash as any).error), 'the same doctor at the same minute is refused');
  ok(same(snapshot(), b4), '…with no bill made for it');
  const ghost = await attempt('appointments:createWithBill', { appointment: { patient_id: 987654, doctor_id: doc.id, appointment_date: today, appointment_time: '11:00' }, bill: { items: [line()], discount: 0, discount_type: 'flat', payment_mode: 'Cash' } });
  ok(!ghost.ok, 'an unknown patient is refused');
  ok(same(snapshot(), b4), '…with nothing left behind');
  await call('doctors:update', doc.id, { available_from: '10:00', available_to: '14:00' });
  const late = await book(p2.id, '18:00');
  ok(!late.ok && /only available between/i.test((late as any).error), "a time outside the doctor's hours is refused");
  ok(same(snapshot(), b4), '…with nothing left behind');
  await call('doctors:update', doc.id, { available_from: null, available_to: null });

  // ============================================================================================================
  section('4 · the registration fee flag moves with the bill');
  eq(one('SELECT registration_fee_paid f FROM patients WHERE id=?', p2.id).f, 0, 'a new patient has not paid the registration fee');
  const bad = await book(p2.id, '12:00', { items: [line(), line(100, 'Patient Registration Fee')], discount: 9999, marks_registration_fee_paid: 1 });
  ok(!bad.ok, 'a refused booking that included the registration fee…');
  eq(one('SELECT registration_fee_paid f FROM patients WHERE id=?', p2.id).f, 0, '…does NOT mark the fee as paid');
  const good = await book(p2.id, '12:00', { items: [line(), line(100, 'Patient Registration Fee')], marks_registration_fee_paid: 1 });
  ok(good.ok, 'booking with the registration fee succeeds');
  eq(one('SELECT registration_fee_paid f FROM patients WHERE id=?', p2.id).f, 1, '…and marks it paid');
  eq((good as any).value.bill.total, 400, 'the bill is the consultation + the fee');

  // ============================================================================================================
  section('5 · the two-call way still works, and a read-only licence blocks the new one');
  const old = await call('appointments:create', { patient_id: p1.id, doctor_id: doc.id, appointment_date: today, appointment_time: '13:00' });
  const oldBill = await call('bills:create', { appointment_id: old.id, patient_id: p1.id, items: [line()], discount: 0, discount_type: 'flat', payment_mode: 'UPI' });
  ok(!!old.id && oldBill.appointment_id === old.id, 'appointments:create + bills:create still work for anything that uses them');
  setReadOnlyMode(true);
  const ro = await book(p1.id, '15:00');
  ok(!ro.ok, 'with an expired licence (read-only) a booking is blocked');
  setReadOnlyMode(false);

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
