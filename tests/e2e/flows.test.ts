// End-to-end flows through the app's REAL IPC handlers on a temporary database (synthetic data only).
// Follows the owner's own example: register → search → appointment → consultation → lab / radiology →
// pharmacy → billing → payments → reports, checking the same patient and the same money everywhere.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, note, section, finish, defect } from './lib';

boot();
const db = () => getDb();
const q = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

(async () => {
  // ------------------------------------------------------------------------------------------
  section('1 · set-up and patient registration');
  const doc = await call('doctors:create', { name: 'Dr. Asha Rao', specialty: 'General Medicine', default_fee: 300, room_number: '1' });
  ok(doc.id > 0, 'doctor created');
  const p1 = await call('patients:create', { first_name: 'Ravi', last_name: 'Kumar', dob: '1985-04-12', gender: 'M', phone: '9000000001', place: 'Mulgund', district: 'Gadag', state: 'Karnataka' });
  const p2 = await call('patients:create', { first_name: 'Sita', last_name: 'Devi', dob: '1990-01-20', gender: 'F', phone: '9000000002' });
  ok(/^PT-/.test(p1.uhid) && p1.uhid !== p2.uhid, `two patients with distinct UHIDs (${p1.uhid}, ${p2.uhid})`);
  const byName = await call('patients:search', 'ravi');
  ok(byName.some((p: any) => p.id === p1.id) && !byName.some((p: any) => p.id === p2.id), 'search by first name finds only Ravi');
  ok((await call('patients:search', '9000000002')).some((p: any) => p.id === p2.id), 'search by phone finds Sita');
  ok((await call('patients:search', p1.uhid)).some((p: any) => p.id === p1.id), 'search by UHID finds Ravi');
  eq((await call('patients:get', p1.id)).phone, '9000000001', 'patients:get returns what was saved');
  const bad = await attempt('patients:create', { last_name: 'NoFirstName' });
  ok(!bad.ok, `a patient with no first name is refused (message: "${(bad as any).error}")`);

  // ------------------------------------------------------------------------------------------
  section('2 · appointments');
  const a1 = await call('appointments:create', { patient_id: p1.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:00', notes: 'fever 3 days' });
  const a2 = await call('appointments:create', { patient_id: p2.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:30' });
  eq(a1.token_number, 1, 'first appointment of the day = token 1');
  eq(a2.token_number, 2, 'second = token 2');
  eq(a1.patient_name, 'Ravi Kumar', 'appointment carries the right patient name');
  eq(a1.patient_uhid, p1.uhid, '…and UHID');
  ok(a1.visit_id && a1.visit_id.startsWith(p1.uhid), `visit id is built from the UHID (${a1.visit_id})`);
  const clash = await attempt('appointments:create', { patient_id: p2.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:00' });
  ok(!clash.ok && /already booked/.test((clash as any).error), 'double-booking the same doctor and minute is refused');
  const missing = await attempt('appointments:create', { patient_id: 99999, doctor_id: doc.id, appointment_date: today, appointment_time: '11:00' });
  ok(!missing.ok && /not found/.test((missing as any).error), 'an unknown patient is refused with a plain message');
  const list = await call('appointments:list', { date: today });
  eq(list.length, 2, 'the day list shows both');
  ok(list.every((a: any) => a.patient_name && a.doctor_name), 'each row carries patient + doctor names');
  const st = await call('stats:today');
  eq(st.total, 2, "today's stats count 2 appointments");

  // optimistic locking between two stations
  const row = await call('appointments:get', a1.id);
  const s1 = await attempt('appointments:updateStatus', a1.id, 'In Progress', row.row_version);
  ok(s1.ok, 'station A changes status (correct version)');
  const s2 = await attempt('appointments:updateStatus', a1.id, 'Done', row.row_version);
  ok(!s2.ok && /Conflict/.test((s2 as any).error), 'station B with a stale version gets a clear conflict instead of overwriting');

  // ------------------------------------------------------------------------------------------
  section('3 · consultation + prescription');
  const c = await call('consultations:save', { appointment_id: a1.id, patient_id: p1.id, doctor_id: doc.id, history: 'Fever 3 days', impression: 'Viral fever', advice: 'Rest', vitals: { temp: '101' } });
  eq(c.impression, 'Viral fever', 'consultation saved');
  const c2 = await call('consultations:save', { appointment_id: a1.id, patient_id: p1.id, doctor_id: doc.id, history: 'Fever 3 days', impression: 'Viral fever (revised)', advice: 'Rest' });
  eq(q('SELECT COUNT(*) c FROM consultations WHERE appointment_id=?', a1.id)[0].c, 1, 'saving the consultation again updates it — no second record');
  eq((await call('consultations:getByAppointment', a1.id)).impression, 'Viral fever (revised)', '…and the latest text is what loads');
  void c2;
  const rx = await call('rx:saveAll', a1.id, [{ drug_name: 'Paracetamol 500mg', dosage: '1 tab', frequency: 'TDS', duration: '3 days' }, { drug_name: '  ', dosage: 'x' }]);
  eq(rx.length, 1, 'prescription saved; the blank row is dropped');

  // ------------------------------------------------------------------------------------------
  section('4 · OPD consultation bill');
  const bill = await call('bills:create', { appointment_id: a1.id, patient_id: p1.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  eq(bill.total, 300, 'bill total = ₹300');
  eq(bill.amount_paid, 300, 'a counter bill is settled when raised');
  eq(bill.patient_name, 'Ravi Kumar', 'bill shows the right patient');
  const lines = q('SELECT description, amount FROM bill_items WHERE bill_id=?', bill.id);
  eq(lines.length, 1, 'one real bill line row');
  eq(one('SELECT status FROM appointments WHERE id=?', a1.id).status, 'Done', 'raising the bill marks the appointment Done');
  const pv = await call('bill:previewById', bill.id);
  ok(pv.ok && pv.totals && pv.items.length === 1, 'bill preview loads with its line');
  near(pv.totals.total, 300, 'preview total matches the bill');
  {
    // the visit list says which visits have a bill, so the desk can print it from the list (the "Bill" button)
    const day = await call('appointments:list', { date: today });
    eq(day.find((x: any) => x.id === a1.id)?.bill_id, bill.id, 'the visit list points a billed visit at its bill');
    ok(day.find((x: any) => x.id === a2.id)?.bill_id == null, '…and a visit with no bill has none');
  }
  const pct = await call('bills:create', { appointment_id: a2.id, patient_id: p2.id, items: [{ description: 'Consultation', qty: 1, rate: 300, amount: 300 }, { description: 'Dressing', qty: 2, rate: 100, amount: 200 }], discount: 10, discount_type: 'percent', payment_mode: 'UPI' });
  eq(pct.subtotal, 500, 'subtotal = 300 + 2×100');
  eq(pct.total, 450, '10% discount → ₹450');
  const flat = await attempt('bills:create', { appointment_id: null, patient_id: p2.id, items: [{ description: 'X', qty: 1, rate: 100, amount: 100 }], discount: 150, discount_type: 'flat', payment_mode: 'Cash' });
  ok(!flat.ok && /discount is more than the bill/i.test((flat as any).error), 'a flat discount larger than the bill is refused (a typo must not give a free bill) — never a negative total');
  const full = await call('bills:create', { appointment_id: null, patient_id: p2.id, items: [{ description: 'X', qty: 1, rate: 100, amount: 100 }], discount: 100, discount_type: 'flat', payment_mode: 'Cash' });
  eq(full.total, 0, 'a discount equal to the whole bill gives ₹0');
  const found = await call('bills:list', { q: 'Sita' });
  ok(found.length >= 1 && found.every((b: any) => /Sita/.test(b.patient_name)), 'Billing search by patient name works');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
