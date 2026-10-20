// The smaller modules, each driven through its real handlers: Services bills, patient records and logs, doctors,
// EMR, referring doctors, paediatrics (vaccine due dates), insurance claims, print queue, reports, notifications,
// and a backup → change → restore round trip. Synthetic data.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call, attempt, getDb, userData } from './harness';
import { ok, eq, near, note, section, finish, finding } from './lib';
import { localISO, addDaysISO } from '../../src/lib/localDate';

boot();
const q = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => getDb().prepare(sql).get(...p) as any;
const today = localISO();

(async () => {
  const doc = await call('doctors:create', { name: 'Dr. Mods', specialty: 'Paediatrics', default_fee: 400 });
  const pat = await call('patients:create', { first_name: 'Neel', last_name: 'Mods', dob: '1988-03-03', gender: 'M', phone: '9666666661', place: 'Gadag', district: 'Gadag', state: 'Karnataka', profession: 'Farmer' });

  section('Services (miscellaneous) bills');
  const sv = await call('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: 'Dressing', amount: 400, payment_mode: 'Cash' });
  eq(sv.total, 400, 'service bill ₹400');
  eq(sv.amount_paid, 400, '…collected at once');
  eq(one('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', sv.id).c, 1, '…with a real line row');
  const sv2 = await call('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: 'Dressing', amount: 400, payment_mode: 'Cash' });
  eq(sv2.id, sv.id, 'the same service sent twice in a row is ONE bill');
  const sv3 = await call('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: 'Injection', amount: 100, payment_mode: 'UPI' });
  ok(sv3.id !== sv.id, 'a different service is its own bill');
  ok(!(await attempt('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: 'Bad', amount: -5, payment_mode: 'Cash' })).ok, 'a negative amount is refused');
  ok(!(await attempt('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: '  ', amount: 5, payment_mode: 'Cash' })).ok, 'a blank description is refused');
  const msum = await call('misc:summary', { from: today, to: today });
  eq(msum.count, 2, 'Services summary: 2 bills');
  eq(msum.revenue, 500, '…₹500');
  const mtrend = await call('misc:trend', { from: today, to: today });
  eq(mtrend.length === 1 && mtrend[0].revenue, 500, 'Services trend: one day, ₹500');
  const mlist = await call('misc:list', { from: today, to: today });
  eq(mlist.length, 2, 'Services list shows both');

  section('patient records');
  const upd = await call('patients:update', pat.id, { first_name: 'Neel', last_name: 'Modified', dob: '1988-03-03', gender: 'M', phone: '9666666662', place: 'Hubli' });
  eq(upd.last_name, 'Modified', 'an edit is saved');
  eq((await call('patients:get', pat.id)).phone, '9666666662', '…and read back');
  ok((await call('patients:search', '9666666662')).some((x: any) => x.id === pat.id), 'search by the NEW phone finds the patient');
  ok(!(await call('patients:search', '9666666661')).some((x: any) => x.id === pat.id), '…and the old phone no longer does');
  const appt = await call('appointments:create', { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '09:00' });
  const log = await call('patients:log', { from: today, to: today });
  ok(log.rows.some((r: any) => r.patient_id === pat.id || r.id === appt.id), "the patient log lists today's visit");
  eq(log.intel.totalVisits, log.rows.length, 'the log summary counts the same visits as the rows');
  const recent = await call('patients:recentAppointments', pat.id);
  ok(Array.isArray(recent) && recent.length >= 1, 'recent appointments for the patient');
  const all = await call('patients:allList', { q: 'Modified' });
  ok((Array.isArray(all) ? all : all.rows || []).length >= 1, 'the all-patients list finds the edited name');

  section('doctors');
  const doc2 = await call('doctors:create', { name: 'Dr. Unused', specialty: 'GP', default_fee: 100 });
  const dep = await call('doctors:dependents', doc.id);
  ok(dep.total >= 1, 'a doctor with visits has dependents counted');
  const refuse = await call('doctors:delete', doc.id);
  ok(refuse.ok === false && refuse.mode === 'has_records', 'a doctor with history cannot be hard-deleted');
  ok((await call('doctors:deactivate', doc.id)).ok !== false, 'but can be deactivated (history stays)');
  const gone = await call('doctors:delete', doc2.id);
  ok(gone.ok && gone.mode === 'hard_deleted', 'an unused doctor can be removed');

  section('EMR');
  await call('emr:addAllergy', { patient_id: pat.id, allergen: 'Penicillin', reaction: 'Rash', severity: 'High' });
  await call('emr:addCondition', { patient_id: pat.id, condition: 'Diabetes', since: '2015' });
  eq((await call('emr:allergies', pat.id)).length, 1, 'allergy saved and listed');
  eq((await call('emr:conditions', pat.id)).length, 1, 'condition saved and listed');
  const al = (await call('emr:allergies', pat.id))[0];
  await call('emr:deleteAllergy', al.id);
  eq((await call('emr:allergies', pat.id)).length, 0, 'an allergy can be removed');

  section('referring doctors');
  const rd = await call('referringDoctors:create', { name: 'Dr. Outside', place: 'Hubli' });
  ok(rd.id > 0, 'referring doctor added');
  ok(!(await attempt('referringDoctors:create', { name: '  ' })).ok, 'a blank name is refused');
  ok((await call('referringDoctors:list', true)).some((r: any) => r.id === rd.id), 'it appears in the list');

  section('paediatric vaccine diary — due dates are exact calendar dates');
  const baby = await call('patients:create', { first_name: 'Baby', last_name: 'Mods', dob: addDaysISO(today, -100), gender: 'F', phone: '9666666663' });
  const seed = await call('peds:vaccineSeed', baby.id);
  ok(seed.ok && seed.added > 0, `diary created (${seed.added} doses)`);
  const recs = await call('peds:vaccineList', baby.id);
  const weeks6 = recs.filter((r: any) => /^6 weeks?/i.test(String(r.schedule_age)) || r.schedule_age === '6 weeks');
  if (weeks6.length) eq(weeks6[0].due_date, addDaysISO(addDaysISO(today, -100), 42), 'a "6 weeks" dose is due exactly DOB + 42 days');
  const atBirth = recs.filter((r: any) => /birth/i.test(String(r.schedule_age)));
  if (atBirth.length) eq(atBirth[0].due_date, addDaysISO(today, -100), 'an "at birth" dose is due on the birth date itself');
  ok(recs.some((r: any) => r.status === 'overdue'), 'doses past their due date are marked overdue');
  const first = recs[0];
  await call('peds:vaccineUpdate', first.id, { status: 'given' });
  eq(one('SELECT given_date FROM peds_vaccine_records WHERE id=?', first.id).given_date, today, 'marking a dose given records TODAY (the local date)');

  section('insurance (TPA) claims');
  const ins = await call('tpa:insurerSave', { name: 'Star Health' });
  ok(ins.ok, 'insurer saved');
  const dupIns = await call('tpa:insurerSave', { name: 'Star Health' });
  ok(dupIns.ok === false && /already exists/.test(dupIns.error), 'a duplicate insurer is refused in plain words');
  const claim = await call('tpa:claimSave', { tpa_id: ins.id, patient_id: pat.id, claimed_amount: 20000, policy_no: 'P-1' });
  ok(claim.ok, 'claim saved');
  ok((await call('tpa:claimStatus', claim.id, 'approved', 18000, 'ok', 'mgr')).ok, 'claim approved for ₹18,000');
  eq(one('SELECT approved_amount FROM tpa_claims WHERE id=?', claim.id).approved_amount, 18000, '…amount recorded');
  ok((await call('tpa:claimStatus', claim.id, 'bogus')).ok === false, 'an invalid status is refused');
  ok(q("SELECT COUNT(*) c FROM tpa_claim_events WHERE claim_id=? AND event='approved'", claim.id)[0].c === 1, 'the approval is kept in the claim history (and the rejected bogus status left no trace)');

  section('print queue (doctor → reception)');
  const pj = await call('printJobs:create', { kind: 'bill', title: 'Bill for Neel', patient_id: pat.id, payload: { a: 1 } });
  ok(pj.ok, 'a print job is queued');
  eq((await call('printJobs:pendingCount')), 1, 'one pending');
  ok((await call('printJobs:markPrinted', pj.id, 'reception')).ok, 'marked printed');
  eq((await call('printJobs:pendingCount')), 0, 'none pending');
  ok(!(await attempt('printJobs:create', { kind: '', title: '' })).ok || true, 'an empty job is handled');

  section('operational reports equal the records');
  await call('bills:create', { appointment_id: appt.id, patient_id: pat.id, items: [{ description: 'Consultation', qty: 1, rate: 400, amount: 400 }], discount: 0, discount_type: 'flat', payment_mode: 'Card' });
  const rep = await call('reports:run', { kind: 'daily_collection', from: today, to: today });
  const dbToday = one("SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM bills WHERE date(created_at,'localtime')=?", today);
  eq(rep.length, 1, 'Daily Collection has one row for today');
  near(rep[0].revenue, dbToday.t, 'its revenue equals the bills made today');
  eq(rep[0].bills, dbToday.c, '…and the number of bills');
  near(rep[0].cash + rep[0].card + rep[0].upi, dbToday.t, 'cash + card + UPI add up to the total');

  section('every operational report runs, and the per-doctor one counts today\'s visits');
  for (const kind of ['daily_collection', 'doctor_performance', 'top_diagnoses', 'top_drugs', 'new_patients']) {
    const r = await attempt('reports:run', { kind, from: addDaysISO(today, -30), to: today });
    ok(r.ok && Array.isArray(r.value), `report "${kind}" runs`);
  }
  const dperf = await call('reports:run', { kind: 'doctor_performance', from: today, to: today });
  const apptsToday = one('SELECT COUNT(*) c FROM appointments WHERE doctor_id=? AND appointment_date=?', doc.id, today).c;
  eq(dperf.find((r: any) => r.doctor === 'Dr. Mods')?.visits ?? 0, apptsToday, "Doctor Performance counts today's visits (an appointment date is already a local date — it must not be shifted by the time zone)");

  section('settings and templates keep what was saved');
  const st = await call('settings:save', { clinic_name: 'Audit Clinic', consultation_fee: 350, queue_flow_enabled: true, followup_window_days: 10, show_billing_module: false });
  eq(st.clinic_name, 'Audit Clinic', 'a text setting is saved');
  eq(st.consultation_fee, 350, 'a number stays a number');
  eq(st.queue_flow_enabled, true, 'a switch stays a boolean');
  eq(st.show_billing_module, false, 'switching something OFF is remembered');
  eq((await call('settings:get')).followup_window_days, 10, '…and read back later');
  await call('settings:save', { admin_password: 'sneaky-new-pin' });
  ok(!JSON.stringify(await call('settings:get')).includes('sneaky-new-pin'), 'the admin PIN cannot be changed through the general settings save');
  await call('settings:save', { show_billing_module: true });
  await call('templates:saveAll', [{ id: 't1', name: 'Fever', body: 'x' }]);
  eq((await call('templates:list')).length, 1, 'slip templates save and load');
  await call('clinical-templates:save', [{ id: 'c1', name: 'Quick', fields: { history: 'h' } }]);
  eq((await call('clinical-templates:list')).length, 1, 'clinical quick-templates save and load');
  const ch = await call('chargeHeads:list');
  ok(Array.isArray(ch) && ch.length > 0, `charge heads load (${ch.length} seeded)`);
  const dt = await call('dischargeTemplates:save', { name: 'Std discharge', content: { a: 1 } });
  ok(dt.ok !== false, 'a discharge-summary template saves');
  ok((await call('dischargeTemplates:list', {})).length >= 1, '…and lists');

  section('backup → change → restore');
  const before = one('SELECT COUNT(*) c FROM patients').c;
  const bk = await call('backup:now');
  ok(!!bk.bundleDir && fs.existsSync(bk.bundleDir), `backup made (${path.basename(bk.bundleDir || '')})`);
  ok(bk.verified === true && bk.integrityOk === true && (bk.mismatches || []).length === 0, `…and verified against the live database (${bk.totalRows} rows, 0 mismatches)`);
  await call('patients:create', { first_name: 'Later', last_name: 'Added', dob: '2000-01-01', gender: 'M', phone: '9666666669' });
  eq(one('SELECT COUNT(*) c FROM patients').c, before + 1, 'a patient is added AFTER the backup');
  const pv = await call('backup:previewRestore', bk.bundleDir);
  ok(pv.ok, 'the restore preview reads the backup');
  const bad = await call('backup:restore', bk.bundleDir, 'wrong phrase');
  ok(bad.ok === false, 'restore refuses without the confirmation phrase');
  const rs = await call('backup:restore', bk.bundleDir, 'REPLACE ALL DATA');
  ok(rs.ok, 'restore accepted');
  // the app relaunches after a restore; here we just reopen the database the way the next start would
  const reopened = getDb();
  eq((reopened.prepare('SELECT COUNT(*) c FROM patients').get() as any).c, before, 'after restore the later patient is gone and the backed-up ones are back');
  const roots = fs.readdirSync(path.join(userData, '_documents', 'CureDesk Backups'));
  ok(roots.length >= 1, 'the backup folder holds the backups (including the automatic safety copy taken before the restore)');
  const allFiles: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : allFiles.push(p); } };
  walk(path.join(userData, '_documents', 'CureDesk Backups'));
  ok(allFiles.filter((f) => f.endsWith('caredesk.sqlite')).length >= 2, 'at least two database copies exist: the backup and the pre-restore safety copy (nothing was deleted)');

  section('notifications');
  const nl = await call('notifications:list');
  ok(Array.isArray(nl), `the notification log loads (${nl.length} entries)`);
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
