// Dates and times: the clinic's day is the day on the PC's clock. Timestamps are stored in UTC, so every
// "today", "this month", day bucket and hour bucket must be worked out in LOCAL time — otherwise, in India,
// a bill made at 1 a.m. lands on yesterday, the "busy hour" chart is 5½ hours off, and a free follow-up
// window ends a day early. Run in several zones by run.mjs.
import { boot, call, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { localISO, addDaysISO } from '../../src/lib/localDate';

boot();
const db = () => getDb();
const pad = (n: number) => String(n).padStart(2, '0');
const utcOf = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
const at = (dayOffset: number, h: number, mi: number) => new Date(Y, M, D + dayOffset, h, mi, 0);

function addBill(patientId: number, total: number, when: Date, kind: string | null = null) {
  const n = (db().prepare('SELECT COUNT(*) c FROM bills').get() as any).c + 1;
  const cols = ['bill_number', 'patient_id', 'items_json', 'subtotal', 'discount', 'discount_type', 'total', 'payment_mode', 'status', 'amount_paid', 'bill_type', 'created_at'];
  const vals: any[] = [`T-${n}`, patientId, '[]', total, 0, 'flat', total, 'Cash', 'paid', total, 'opd_consult', utcOf(when)];
  if (kind) { cols.push('bill_kind'); vals.push(kind); }       // otherwise the column default applies, exactly as bills:create does
  return Number(db().prepare(`INSERT INTO bills (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid);
}

(async () => {
  const doc = await call('doctors:create', { name: 'Dr. Time', specialty: 'GP', default_fee: 100 });
  const p = await call('patients:create', { first_name: 'Tara', last_name: 'Time', dob: '1990-01-01', gender: 'F', phone: '9111111111' });
  const localToday = localISO(now);
  console.log(`(zone ${process.env.TZ || 'system'}; local today ${localToday}; UTC today ${now.toISOString().slice(0, 10)})`);

  // Three bills: 00:30 today, 12:00 today, 23:30 yesterday (all LOCAL clock times).
  section('"today" is the local day');
  addBill(p.id, 100, at(0, 0, 30));
  addBill(p.id, 200, at(0, 12, 0));
  addBill(p.id, 400, at(-1, 23, 30));
  // appointments are stored with the LOCAL date by the booking screen
  await call('appointments:create', { patient_id: p.id, doctor_id: doc.id, appointment_date: localToday, appointment_time: '09:00' });
  await call('appointments:create', { patient_id: p.id, doctor_id: doc.id, appointment_date: localToday, appointment_time: '09:30' });

  const st = await call('stats:today');
  eq(st.date, localToday, "stats:today reports the local date");
  eq(st.total, 2, "stats:today counts today's 2 appointments");

  const fin = await call('finance:summary', {});
  eq(fin.today.count, 2, 'Finance → today: the 00:30 and 12:00 bills (not the one from 23:30 last night)');
  eq(fin.today.total, 300, 'Finance → today total ₹300');
  eq(fin.yesterday.count, 1, 'Finance → yesterday: the 23:30 bill');
  eq(fin.yesterday.total, 400, 'Finance → yesterday total ₹400');
  const hrs = new Map<string, number>(fin.byHour.map((h: any) => [String(h.hr), h.total]));
  eq(hrs.get('00'), 100, 'busy-hour chart: the 00:30 bill is in hour 00 (local clock)');
  eq(hrs.get('12'), 200, '…the 12:00 bill in hour 12');
  eq(hrs.get('23'), 400, '…the 23:30 bill in hour 23');
  const dayRows = new Map<string, number>(fin.byDay.map((r: any) => [r.day, r.total]));
  eq(dayRows.get(localToday), 300, 'by-day row for today = ₹300');
  eq(dayRows.get(localISO(at(-1, 12, 0))), 400, "by-day row for yesterday = ₹400");

  const ov = await call('analytics:overview');
  eq(ov.todayVisits, 2, 'Analytics → visits today');
  eq(ov.todayRevenue, 300, 'Analytics → revenue today');
  const monthBills = [100, 200, 400].filter((_, i) => localISO([at(0, 0, 30), at(0, 12, 0), at(-1, 23, 30)][i]).slice(0, 7) === localToday.slice(0, 7));
  eq(ov.monthRevenue, monthBills.reduce((a, b) => a + b, 0), 'Analytics → revenue this (local) month');

  const todayBills = await call('bills:list', { from: localToday, to: localToday });
  eq(todayBills.length, 2, 'Billing list filtered to today shows the 2 bills made today');
  const yBills = await call('bills:list', { from: localISO(at(-1, 12, 0)), to: localISO(at(-1, 12, 0)) });
  eq(yBills.length, 1, '…and yesterday shows the 23:30 one');

  const mods = await call('analytics:modules', localToday, localToday);
  eq(mods.modules.find((m: any) => m.key === 'opd')?.revenue, 300, 'Modules P&L for today: OPD ₹300');

  section('services page + misc summary default to the local month');
  addBill(p.id, 150, at(0, 0, 45), 'misc');
  const ms = await call('misc:summary', { from: localToday, to: localToday });
  eq(ms.count, 1, 'Services summary for today counts the 00:45 service bill');

  section('free follow-up window = visit date + N days, exactly');
  const a = (await call('appointments:list', { date: localToday }))[0];
  await call('bills:create', { appointment_id: a.id, patient_id: p.id, items: [{ description: 'Consultation', qty: 1, rate: 100, amount: 100 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  const win = (await call('settings:get')).followup_window_days;
  const chk = await call('followup:checkEligibility', p.id, doc.id, localToday);
  eq(chk.parent_appt_date, localToday, 'the paid visit is today');
  eq(chk.valid_till, addDaysISO(localToday, win), `valid until visit + ${win} days, to the day (${addDaysISO(localToday, win)})`);
  const lastDay = await call('followup:checkEligibility', p.id, doc.id, addDaysISO(localToday, win));
  ok(lastDay.eligible === true, 'a patient arriving on the LAST day of the window is still eligible for the free visit');
  const dayAfter = await call('followup:checkEligibility', p.id, doc.id, addDaysISO(localToday, win + 1));
  ok(dayAfter.eligible === false, 'the day after the window is no longer inside it');
  const sum = await call('followup:summaryForAppointment', a.id);
  eq(sum.valid_till, addDaysISO(localToday, win), 'the OPD slip summary quotes the same valid-till date');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
