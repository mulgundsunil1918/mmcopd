// Deleting a consultation, a visit or a bill needs the ADMIN PASSWORD typed again for that one deletion — checked in the main process,
// whatever the screen thinks. Only the administrator may do it (when sign-in is on); an in-patient (admission) bill can be deleted too —
// the admission stays and the advance deposit the discharge used is given back; what each delete removes — and what it must leave alone —
// is exact; and a copy of what was erased is kept in the audit log.
// Real handlers on a temporary database.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: any[]) => (one(sql, ...p)?.c ?? 0) as number;

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const doc = await call('doctors:create', { name: 'Dr. Delete', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Dina', last_name: 'Delete', dob: '1985-05-05', gender: 'F', phone: '9411000001' });
  const line = (rate = 300, label = 'OPD Consultation') => ({ description: label, qty: 1, rate, amount: rate });
  let t = 0;
  /** A complete visit: appointment + bill (paid) + consultation + a 2-line prescription. */
  const visit = async () => {
    const r = await call('appointments:createWithBill', {
      appointment: { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: `0${9 + Math.floor(++t / 6)}:${String((t % 6) * 10).padStart(2, '0')}` },
      bill: { items: [line()], discount: 0, discount_type: 'flat', payment_mode: 'Cash' },
    });
    const appt = r.appointment, bill = r.bill;
    await call('consultations:save', { appointment_id: appt.id, patient_id: pat.id, doctor_id: doc.id, history: 'Fever 3 days', examination: 'Throat red', impression: 'Viral fever', advice: 'Rest' });
    await call('rx:saveAll', appt.id, [{ drug_name: 'Paracetamol 500', dosage: '1', frequency: 'TDS', duration: '3 days', instructions: '' }, { drug_name: 'ORS', dosage: '1', frequency: 'SOS', duration: '', instructions: '' }]);
    return { appt, bill };
  };
  /** The wrong-password slow-down is per process and two wrong guesses in a row lock for 10 s; a right password clears it. */
  const settle = () => call('admin:deleteConsultation', -1, '1234');
  const audit = (action: string) => one('SELECT details FROM audit_log WHERE action=? ORDER BY id DESC LIMIT 1', action)?.details as string | undefined;

  // ============================================================================================================
  section('1 · the password is checked every time, in the main process');
  const v1 = await visit();
  for (const [what, pw] of [['no password', undefined], ['an empty password', ''], ['a wrong password', 'nope']] as [string, any][]) {
    const r = await call('admin:deleteBill', v1.bill.id, pw);
    ok(!r.ok && /wrong admin password/i.test(r.error), `deleting a bill with ${what} is refused ("${r.error}")`);
  }
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', v1.bill.id), 1, '…and the bill is still there');
  ok(one("SELECT 1 x FROM audit_log WHERE action='delete_password_wrong'"), 'a wrong password is written to the audit log');
  await settle();
  const wrongConsult = await call('admin:deleteConsultation', v1.appt.id, 'nope');
  await settle();
  const wrongVisit = await call('admin:deleteAppointment', v1.appt.id, 'nope');
  await settle();
  ok(!wrongConsult.ok && /wrong admin password/i.test(wrongConsult.error) && !wrongVisit.ok && /wrong admin password/i.test(wrongVisit.error), 'the same for a consultation and a visit');
  eq(count('SELECT COUNT(*) c FROM consultations WHERE appointment_id=?', v1.appt.id), 1, '…the consultation is untouched');
  eq(count('SELECT COUNT(*) c FROM appointments WHERE id=?', v1.appt.id), 1, '…and so is the visit');

  // ============================================================================================================
  section('2 · deleting a consultation keeps the visit and its bill');
  const bad = await call('admin:deleteConsultation', 987654, '1234');
  ok(!bad.ok && /no consultation/i.test(bad.error), 'a visit with no consultation says so in plain words');
  const dc = await call('admin:deleteConsultation', v1.appt.id, '1234');
  ok(dc.ok, `the consultation is deleted with the right password (${dc.ok ? '' : dc.error})`);
  eq(dc.consultation.prescription_lines, 2, 'it reports the 2 prescription lines that went with it');
  eq(count('SELECT COUNT(*) c FROM consultations WHERE appointment_id=?', v1.appt.id), 0, 'the doctor\'s notes are gone');
  eq(count('SELECT COUNT(*) c FROM prescription_items WHERE appointment_id=?', v1.appt.id), 0, '…and the prescription written for that visit');
  eq(count('SELECT COUNT(*) c FROM appointments WHERE id=?', v1.appt.id), 1, 'the visit itself stays');
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', v1.bill.id), 1, '…and so does its bill');
  ok(/Viral fever/.test(audit('consultation_deleted') || '') && /Paracetamol 500/.test(audit('consultation_deleted') || ''), 'a copy of the notes and the prescription is kept in the audit log');
  const again = await call('admin:deleteConsultation', v1.appt.id, '1234');
  ok(!again.ok, 'a second delete finds nothing to delete');

  // ============================================================================================================
  section('3 · deleting a bill (OPD, then lab) — its lines and payments go; the visit and the lab order stay');
  const v2 = await visit();
  eq(count('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', v2.bill.id) >= 1, true, 'the bill has lines');
  const received = Number(one('SELECT amount_paid a FROM bills WHERE id=?', v2.bill.id).a);
  ok(received > 0, `…and money was received on it (₹${received})`);
  const delBill = await call('admin:deleteBill', v2.bill.id, '1234');
  ok(delBill.ok, `the bill is deleted with the right password (${delBill.ok ? '' : delBill.error})`);
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', v2.bill.id) + count('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', v2.bill.id) + count('SELECT COUNT(*) c FROM bill_payments WHERE bill_id=?', v2.bill.id), 0, 'the bill, its lines and its payment records are all gone');
  eq(count('SELECT COUNT(*) c FROM appointments WHERE id=?', v2.appt.id), 1, 'the visit stays');
  ok(new RegExp(String(v2.bill.bill_number)).test(audit('bill_deleted') || '') && /"payments":\[/.test(audit('bill_deleted') || ''), 'the bill number, its lines and its payments are kept in the audit log');
  const gone = await call('admin:deleteBill', v2.bill.id, '1234');
  ok(!gone.ok && /not found/i.test(gone.error), 'deleting it again says "not found"');

  const lab = await call('lab:upsertTest', { name: 'CBC (delete test)', price: 250, sample_type: 'Blood', category: 'haematology' });
  const order = await call('lab:createOrder', { appointment_id: v2.appt.id, patient_id: pat.id, doctor_id: doc.id, notes: '', items: [{ lab_test_id: lab.id, test_name: lab.name }] });
  const labOrderId = order?.id;
  const labBill = labOrderId ? await call('lab:billOf', labOrderId) : null;
  ok(!!labBill, 'a lab order has its lab bill');
  if (labBill && labOrderId) {
    const dl = await call('admin:deleteBill', labBill.id, '1234');
    ok(dl.ok, 'the lab bill is deleted with the right password');
    eq(await call('lab:billOf', labOrderId), null, '…the lab order no longer has a bill');
    eq(count('SELECT COUNT(*) c FROM lab_orders WHERE id=?', labOrderId), 1, '…but the lab order itself stays');
  }

  // ============================================================================================================
  section('4 · an in-patient (admission) bill can be deleted: the admission stays, the deposit is given back');
  await call('settings:save', { ipd_advance_enabled: true, pharmacy_ipd_charge_enabled: true });
  const sup4 = await call('wholesalers:upsert', { name: 'Ward Supplies', drug_license_no: 'DL-WARD' });
  const drug4 = await call('pharmacy:upsertDrug', { name: 'Ward Tab', default_mrp: 50, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  await call('purchase:create', { client_ref: 'ward-pur', invoice_number: 'WARD-1', wholesaler_id: sup4.id, invoice_date: today, items: [{ drug_master_id: drug4.id, batch_no: 'W1', expiry: '2031-01-01', qty_received: 30, purchase_price: 30, mrp: 50 }] });
  const stock4 = () => Number(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', drug4.id).s);
  const wardA = await call('wards:save', { name: 'General A', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bedA = await call('beds:save', { ward_id: wardA.id, bed_number: 'D-1' });
  const patA = await call('patients:create', { first_name: 'Ira', last_name: 'Inpatient', dob: '1975-01-01', gender: 'F', phone: '9411000010' });
  const admA = await call('ip:admitV2', { patient_id: patA.id, bed_id: bedA.id, admission_doctor_id: doc.id, advance_amount: 5000, advance_mode: 'Cash', performed_by: 'tester' });
  const admAId = one('SELECT id FROM ip_admissions WHERE patient_id=? ORDER BY id DESC LIMIT 1', patA.id)?.id;
  const ipBill = one('SELECT id, bill_number FROM bills WHERE admission_id=? ORDER BY id LIMIT 1', admAId);
  ok(admA.ok && !!ipBill, 'an admitted patient has a running bill');
  const wardSale4 = await call('pharmacy:sell', { client_ref: 'ward-sale-1', ipd_admission_id: admAId, patient_id: patA.id, items: [{ drug_master_id: drug4.id, drug_name: 'Ward Tab', qty: 2, rate: 50 }] });
  eq(wardSale4.payment_mode, 'IPD-bill', 'two tablets are charged to the admission (a line on its bill)');
  eq(stock4(), 28, '…and leave the shelf');
  const stuck = await call('admin:deleteSale', wardSale4.id, '1234');
  ok(!stuck.ok && /in-patient/i.test(stuck.error), 'while it is a line on the bill, the sale cannot be deleted on its own');
  await settle();
  const delIp = await call('admin:deleteBill', ipBill!.id, '1234');
  ok(delIp.ok && delIp.bill.inpatient === true, `the in-patient bill is deleted with the admin password (${delIp.ok ? 'inpatient' : delIp.error})`);
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', ipBill!.id), 0, '…the bill and its lines are gone');
  eq(one('SELECT status FROM ip_admissions WHERE id=?', admAId).status, 'admitted', '…the admission itself stays, still admitted');
  eq(one('SELECT bill_id b FROM ip_admissions WHERE id=?', admAId).b, null, '…and simply has no bill now');
  eq(Number(one('SELECT amount FROM advances WHERE admission_id=?', admAId).amount), 5000, '…the ₹5,000 deposit is still on record');
  ok(/IN-PATIENT bill/.test(audit('bill_deleted') || '') && /snapshot/.test(audit('bill_deleted') || ''), 'a copy is kept in the audit log, marked as an in-patient bill');
  const freed = await call('admin:deleteSale', wardSale4.id, '1234');
  ok(freed.ok, `the medicine sale is no longer on any bill, so it can be deleted like any other (${freed.ok ? '' : freed.error})`);
  eq(stock4(), 30, '…and its 2 tablets go back on the shelf');
  const prevA = await call('bill:previewAdmission', admAId);
  ok(!!prevA.bill && prevA.bill.id !== ipBill!.id, 'opening the admission\'s billing again starts a fresh running bill');

  // a discharged admission: the discharge used part of the deposit; deleting its bill gives that back
  const wardB = await call('wards:save', { name: 'General B', ward_type: 'general', per_day_rate: 1000, nursing_per_day: 0 });
  const bedB = await call('beds:save', { ward_id: wardB.id, bed_number: 'D-2' });
  const patB = await call('patients:create', { first_name: 'Omar', last_name: 'Discharged', dob: '1960-01-01', gender: 'M', phone: '9411000011' });
  const admB = await call('ip:admitV2', { patient_id: patB.id, bed_id: bedB.id, admission_doctor_id: doc.id, advance_amount: 4000, advance_mode: 'Cash', performed_by: 'tester' });
  const admBId = one('SELECT id FROM ip_admissions WHERE patient_id=? ORDER BY id DESC LIMIT 1', patB.id)?.id;
  const prevB = await call('bill:previewAdmission', admBId);
  eq(prevB.totals.total, 1000, 'one day of the ₹1,000 bed is on the bill');
  ok((await call('ip:requestDischarge', admBId, { outcome: 'discharged' }, 'dr')).ok && (await call('ip:approveDischarge', admBId, { by: 'mgr' })).ok, 'the discharge is requested and approved');
  const finB = one('SELECT id, advance_adjusted, finalized_at FROM bills WHERE admission_id=?', admBId);
  ok(finB.advance_adjusted === 1000 && !!finB.finalized_at, 'the final bill is frozen and used ₹1,000 of the deposit');
  eq(Number(one('SELECT adjusted_amount a FROM advances WHERE admission_id=?', admBId).a), 1000, '…the deposit shows ₹1,000 spent');
  const delB = await call('admin:deleteBill', finB.id, '1234');
  ok(delB.ok && delB.bill.advance_released === 1000, `the frozen final bill is deleted too, and ₹1,000 of the deposit is released (${delB.ok ? delB.bill.advance_released : delB.error})`);
  eq(Number(one('SELECT adjusted_amount a FROM advances WHERE admission_id=?', admBId).a), 0, '…so the whole ₹4,000 deposit is refundable again');
  eq(one('SELECT status FROM ip_admissions WHERE id=?', admBId).status, 'discharged', '…the admission stays discharged');
  eq(one('SELECT bill_id b FROM ip_admissions WHERE id=?', admBId).b, null, '…with no bill');
  ok(admB.ok, 'admissions were made on the real handlers');

  // ============================================================================================================
  section('5 · deleting a whole visit takes everything of that visit with it, and keeps a copy');
  const v3 = await visit();
  const dv = await call('admin:deleteAppointment', v3.appt.id, '1234');
  ok(dv.ok, `the visit is deleted with the right password (${dv.ok ? '' : dv.error})`);
  eq(count('SELECT COUNT(*) c FROM appointments WHERE id=?', v3.appt.id) + count('SELECT COUNT(*) c FROM consultations WHERE appointment_id=?', v3.appt.id)
    + count('SELECT COUNT(*) c FROM prescription_items WHERE appointment_id=?', v3.appt.id) + count('SELECT COUNT(*) c FROM bills WHERE id=?', v3.bill.id), 0,
    'the visit, its consultation, its prescription and its bill are all gone');
  const a3 = audit('appointment_deleted') || '';
  ok(/consultation/.test(a3) && new RegExp(String(v3.bill.bill_number)).test(a3) && /Fever 3 days/.test(a3), 'the audit log keeps a copy: the consultation, the prescription and the bill number');
  eq(count('SELECT COUNT(*) c FROM patients WHERE id=?', pat.id), 1, 'the patient is untouched');

  // ============================================================================================================
  section('6 · only the administrator, and not while the licence is read-only');
  const v4 = await visit();
  await call('auth:createUser', { username: 'rita', password: 'pass1234', role: 'receptionist', display_name: 'Rita' });
  await call('settings:save', { require_login: true });
  await call('auth:login', 'rita', 'pass1234');
  for (const [what, ch, id] of [['a visit', 'admin:deleteAppointment', v4.appt.id], ['a consultation', 'admin:deleteConsultation', v4.appt.id], ['a bill', 'admin:deleteBill', v4.bill.id]] as [string, string, number][]) {
    const r = await attempt(ch, id, '1234');
    ok(!r.ok && /not allowed/i.test((r as any).error), `a receptionist cannot delete ${what}, even with the right password (${String((r as any).error).slice(0, 55)}…)`);
  }
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  setReadOnlyMode(true);
  const ro = await attempt('admin:deleteBill', v4.bill.id, '1234');
  ok(!ro.ok, 'with an expired licence (read-only) deleting is blocked');
  setReadOnlyMode(false);
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', v4.bill.id), 1, '…and nothing was deleted');
  const asAdmin = await call('admin:deleteBill', v4.bill.id, '1234');
  ok(asAdmin.ok, 'the administrator, with the password, can');
  await call('auth:logout');
  await call('settings:save', { require_login: false });

  // ============================================================================================================
  section('6b · a pharmacy counter sale, and a patient');
  const sup = await call('wholesalers:upsert', { name: 'Delete Supplies', drug_license_no: 'DL-DEL' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Del Tab', default_mrp: 50, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  const stockOf = () => Number(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', drug.id).s);
  await call('purchase:create', { client_ref: 'del-pur', invoice_number: 'DEL-1', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: drug.id, batch_no: 'DL1', expiry: '2031-01-01', qty_received: 20, purchase_price: 30, mrp: 50 }] });
  const sale = await call('pharmacy:sell', { client_ref: 'del-sale', items: [{ drug_master_id: drug.id, drug_name: 'Del Tab', qty: 5, rate: 50 }], payment_mode: 'Cash' });
  eq(stockOf(), 15, 'a counter sale of 5 leaves 15 on the shelf');
  const wrongSale = await call('admin:deleteSale', sale.id, 'nope');
  ok(!wrongSale.ok && /wrong admin password/i.test(wrongSale.error), 'a sale cannot be deleted with a wrong password');
  await settle();
  eq(count('SELECT COUNT(*) c FROM pharmacy_sales WHERE id=?', sale.id), 1, '…and it is still there');
  const delSale = await call('admin:deleteSale', sale.id, '1234');
  ok(delSale.ok, `the sale is deleted with the right password (${delSale.ok ? '' : delSale.error})`);
  eq(count('SELECT COUNT(*) c FROM pharmacy_sales WHERE id=?', sale.id) + count('SELECT COUNT(*) c FROM pharmacy_sale_items WHERE sale_id=?', sale.id) + count('SELECT COUNT(*) c FROM dispensing_register WHERE sale_id=?', sale.id), 0, 'the sale, its lines and its register rows are gone');
  eq(stockOf(), 20, '…and the 5 medicines went back on the shelf');
  ok(/pharmacy_sale_deleted/.test(one("SELECT action a FROM audit_log WHERE action='pharmacy_sale_deleted' ORDER BY id DESC LIMIT 1")?.a || '') && /Del Tab/.test(audit('pharmacy_sale_deleted') || ''), 'a copy is kept in the audit log');
  // (a sale that is still a line on an in-patient's bill is refused — proved in section 4, with a real admission)

  const gone2 = await call('patients:create', { first_name: 'Gone', last_name: 'Patient', dob: '1990-01-01', gender: 'M', phone: '9411000077' });
  const noPw = await call('admin:deletePatient', gone2.id);
  ok(!noPw.ok && /wrong admin password/i.test(noPw.error), 'a patient cannot be deleted without the password');
  eq(count('SELECT COUNT(*) c FROM patients WHERE id=?', gone2.id), 1, '…and is still there');
  const delPat = await call('admin:deletePatient', gone2.id, '1234');
  ok(delPat.ok && count('SELECT COUNT(*) c FROM patients WHERE id=?', gone2.id) === 0, 'with the password the patient is deleted');
  ok(/Gone/.test(audit('patient_deleted') || '') && /snapshot/.test(audit('patient_deleted') || ''), '…and their details are kept in the audit log');
  const g3 = await call('patients:create', { first_name: 'Bulk', last_name: 'One', dob: '1990-01-01', gender: 'M', phone: '9411000078' });
  const bulkNo = await call('admin:deletePatients', [g3.id], 'nope');
  await settle();
  ok(!bulkNo.ok && count('SELECT COUNT(*) c FROM patients WHERE id=?', g3.id) === 1, 'the bulk delete needs the password too');
  ok((await call('admin:deletePatients', [g3.id], '1234')).ok && count('SELECT COUNT(*) c FROM patients WHERE id=?', g3.id) === 0, '…and works with it');

  // ============================================================================================================
  section('6c · Users & Access → Danger Zone: delete ONE visit (a consultation with a doctor) — the patient stays');
  const docB = await call('doctors:create', { name: 'Dr. Second', specialty: 'Paediatrics', default_fee: 400 });
  const pat2 = await call('patients:create', { first_name: 'Vera', last_name: 'Visits', dob: '2010-02-02', gender: 'F', phone: '9411000090' });
  const mk = async (doctor: any, time: string, impression: string, fee: number) => {
    const r = await call('appointments:createWithBill', {
      appointment: { patient_id: pat2.id, doctor_id: doctor.id, appointment_date: today, appointment_time: time },
      bill: { items: [line(fee)], discount: 0, discount_type: 'flat', payment_mode: 'Cash' },
    });
    await call('consultations:save', { appointment_id: r.appointment.id, patient_id: pat2.id, doctor_id: doctor.id, history: 'h', impression, advice: 'a' });
    await call('rx:saveAll', r.appointment.id, [{ drug_name: 'Syrup X', dosage: '5 ml', frequency: 'BD', duration: '5 days', instructions: '' }]);
    return { appt: r.appointment, bill: r.bill };
  };
  const first = await mk(doc, '15:00', 'Cough', 300);
  const second = await mk(docB, '16:00', 'Fever', 400);
  const listed = await call('admin:patientVisits', pat2.id);
  ok(listed.ok && listed.patient.uhid === pat2.uhid && listed.visits.length === 2, 'the patient\'s visits are listed (two)');
  eq(listed.visits.map((v: any) => v.doctor_name).join(' | '), 'Dr. Second | Dr. Delete', 'newest first, each with the doctor it was with');
  const l0 = listed.visits[0];
  ok(l0.has_consultation === true && l0.impression === 'Fever' && l0.rx_lines === 1 && l0.bills === 1 && l0.bill_total === 400 && l0.bill_paid > 0 && l0.lab_orders === 0 && l0.pharmacy_sales === 0 && l0.token_number > 0, 'each visit says what it carries: the consultation (with the impression), its prescription lines, its bill and money received');
  const none = await call('admin:patientVisits', 987654);
  ok(!none.ok && /not found/i.test(none.error), 'a patient who does not exist says so');
  const nobody = await call('patients:create', { first_name: 'No', last_name: 'Visits', dob: '1991-01-01', gender: 'M', phone: '9411000091' });
  const empty = await call('admin:patientVisits', nobody.id);
  ok(empty.ok && empty.visits.length === 0, 'a patient with no visits has an empty list');
  const lab2 = await call('lab:upsertTest', { name: 'CBC (visit test)', price: 250, sample_type: 'Blood', category: 'haematology' });
  await call('lab:createOrder', { appointment_id: second.appt.id, patient_id: pat2.id, doctor_id: docB.id, notes: '', items: [{ lab_test_id: lab2.id, test_name: lab2.name }] });
  eq((await call('admin:patientVisits', pat2.id)).visits[0].lab_orders, 1, 'a lab order of the visit is counted, so the confirmation can name it');

  // one wrong password changes nothing
  await settle();
  const wrongOne = await call('admin:deleteAppointment', second.appt.id, 'nope');
  await settle();
  ok(!wrongOne.ok && count('SELECT COUNT(*) c FROM appointments WHERE patient_id=?', pat2.id) === 2, 'a wrong password deletes nothing');

  // only the doctor's notes of the OLDER visit
  const notesOnly = await call('admin:deleteConsultation', first.appt.id, '1234');
  ok(notesOnly.ok, 'the notes of one visit are deleted with the password');
  const afterNotes = (await call('admin:patientVisits', pat2.id)).visits;
  ok(afterNotes.length === 2 && afterNotes.find((v: any) => v.id === first.appt.id).has_consultation === false && afterNotes.find((v: any) => v.id === first.appt.id).bills === 1, '…that visit and its bill stay, only its notes and prescription are gone');
  ok(afterNotes.find((v: any) => v.id === second.appt.id).has_consultation === true, '…and the other visit still has its notes');

  // the whole NEWER visit, with its bill and lab order
  const wholeVisit = await call('admin:deleteAppointment', second.appt.id, '1234');
  ok(wholeVisit.ok, 'the whole visit is deleted with the password');
  const left = (await call('admin:patientVisits', pat2.id)).visits;
  ok(left.length === 1 && left[0].id === first.appt.id, '…one visit is left: the other doctor\'s');
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', second.bill.id) + count('SELECT COUNT(*) c FROM lab_orders WHERE appointment_id=?', second.appt.id), 0, '…its bill and its lab order went with it');
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', first.bill.id), 1, '…the bill of the other visit is untouched');
  eq(count('SELECT COUNT(*) c FROM patients WHERE id=?', pat2.id), 1, '…and the patient is still there');
  ok(/Token #/.test(audit('appointment_deleted') || '') && /Vera/.test(audit('appointment_deleted') || ''), '…a copy is kept in the audit log');

  // who may look: the administrator only (when sign-in is on); reading still works on an expired licence
  await call('auth:createUser', { username: 'rita2', password: 'pass1234', role: 'receptionist', display_name: 'Rita Two' });
  await call('settings:save', { require_login: true });
  await call('auth:login', 'rita2', 'pass1234');
  const peek = await attempt('admin:patientVisits', pat2.id);
  ok(!peek.ok && /not allowed/i.test((peek as any).error), 'a receptionist cannot open the list of a patient\'s visits for deleting');
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  setReadOnlyMode(true);
  ok((await attempt('admin:patientVisits', pat2.id)).ok, 'the administrator can look even when the licence is read-only (looking changes nothing)');
  const roDel = await attempt('admin:deleteAppointment', first.appt.id, '1234');
  ok(!roDel.ok, '…but deleting is blocked');
  setReadOnlyMode(false);
  await call('auth:logout');
  await call('settings:save', { require_login: false });
  eq(count('SELECT COUNT(*) c FROM appointments WHERE id=?', first.appt.id), 1, '…and nothing was deleted');

  // ============================================================================================================
  section('7 · guessing the password is slowed down');
  const v5 = await visit();
  await settle();
  await call('admin:deleteBill', v5.bill.id, 'guess1');
  await call('admin:deleteBill', v5.bill.id, 'guess2');
  const held = await call('admin:deleteBill', v5.bill.id, '1234');
  ok(!held.ok && /too many wrong passwords/i.test(held.error), `after two wrong tries even the right password has to wait (${held.error})`);
  eq(count('SELECT COUNT(*) c FROM bills WHERE id=?', v5.bill.id), 1, '…and nothing was deleted');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
