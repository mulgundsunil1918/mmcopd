// Referrals (formerly "Referring Doctors"): where a patient came from — Google, Self, Family, a doctor's name… — is FREE TEXT and prints
// exactly as typed: no "Dr." is added in front any more, and the printed label is "Referral" (it used to be "Referred by").
// Older versions stored a doctor's name WITHOUT "Dr." and added it on every screen, so when an existing clinic's data is carried over,
// the "Dr. " those screens used to add is written into the stored names ONCE — what the clinic sees and prints stays the same —
// and anything typed afterwards is never touched. Real handlers on a temporary database.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call, attempt, getDb } from './harness';
import { runMigrations } from '../../src/db/migrations';
import { legacyReferralName } from '../../src/lib/referral';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

(async () => {
  const today = new Date().toLocaleDateString('en-CA');

  // ============================================================================================================
  section('1 · a referral is free text and is stored and listed exactly as typed');
  for (const name of ['Google', 'Self', 'Family', 'Dr. Ramesh Kumar']) await call('referringDoctors:create', { name });
  eq((await call('referringDoctors:list', true)).map((r: any) => r.name).join(' | '), 'Dr. Ramesh Kumar | Family | Google | Self', 'the list holds Google, Self, Family and a doctor — with no "Dr." added to any of them');
  const none = await attempt('referringDoctors:create', { name: '   ' });
  ok(!none.ok && /referral name is required/i.test((none as any).error), `a blank referral is refused in plain words (${(none as any).error})`);
  const doc = await call('doctors:create', { name: 'Dr. Ref', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Rhea', last_name: 'Referral', dob: '1990-01-01', gender: 'F', phone: '9400000001' });
  const a1 = await call('appointments:create', { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '09:00', referred_by: 'Google' });
  eq(one('SELECT referred_by r FROM appointments WHERE id=?', a1.id).r, 'Google', 'a visit booked under "Google" keeps exactly that…');
  eq((await call('appointments:list', { date: today })).find((x: any) => x.id === a1.id)?.referred_by, 'Google', '…and the visit list returns it as typed');
  const a2 = await call('appointments:create', { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '09:30', referred_by: 'Dr. Ramesh Kumar' });
  eq(one('SELECT referred_by r FROM appointments WHERE id=?', a2.id).r, 'Dr. Ramesh Kumar', 'a doctor typed with "Dr." is kept once, not doubled');

  // ============================================================================================================
  section('2 · the helper that reproduces what the old screens showed');
  const cases: [string, string][] = [['Ramesh Kumar', 'Dr. Ramesh Kumar'], ['Dr. Meena Shetty', 'Dr. Meena Shetty'], ['dr anita', 'dr anita'], ['DR. Anil', 'DR. Anil'],
    ['Drishti', 'Dr. Drishti'], ['  Google  ', 'Dr. Google'], ['', ''], ['   ', '   ']];
  for (const [input, expected] of cases) eq(legacyReferralName(input), expected, `"${input}" → "${expected}"`);

  // ============================================================================================================
  section('3 · an existing clinic: names carried over keep what they showed before, once');
  // put the database back as an OLDER version left it: names stored without "Dr.", and no marker that the conversion ran
  db.prepare('DELETE FROM referring_doctors').run();
  db.prepare('DELETE FROM appointments').run();
  db.prepare("DELETE FROM settings WHERE key='referral_names_as_typed'").run();
  const ins = db.prepare('INSERT INTO referring_doctors (name, is_active) VALUES (?, 1)');
  for (const n of ['Ramesh Kumar', 'Dr. Meena Shetty', '  Anil  ', 'dr anita', 'Drishti', 'Google']) ins.run(n);
  const mkAppt = (time: string, by: string | null) => Number(db.prepare(
    'INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status, referred_by) VALUES (?, ?, ?, ?, 1, \'Waiting\', ?)'
  ).run(pat.id, doc.id, today, time, by).lastInsertRowid);
  const ids = { ramesh: mkAppt('10:00', 'Ramesh Kumar'), meena: mkAppt('10:05', 'Dr. Meena Shetty'), blank: mkAppt('10:10', ''), nul: mkAppt('10:15', null), spaced: mkAppt('10:20', '  Anil ') };
  db.prepare('INSERT INTO radiology_orders (order_number, patient_id, referred_by) VALUES (?, ?, ?)').run('RAD-REF-1', pat.id, 'Ramesh Kumar');
  db.prepare('INSERT INTO radiology_orders (order_number, patient_id, referred_by) VALUES (?, ?, ?)').run('RAD-REF-2', pat.id, null);
  const ref = (id: number) => one('SELECT referred_by r FROM appointments WHERE id=?', id).r;

  runMigrations(db);
  eq(all('SELECT name FROM referring_doctors ORDER BY id').map((r) => r.name).join(' | '), 'Dr. Ramesh Kumar | Dr. Meena Shetty | Dr. Anil | dr anita | Dr. Drishti | Dr. Google',
    'the list shows what it showed before: "Dr." added where the old screens added it, none doubled (a Google typed before the update is shown as "Dr. Google" — edit it to "Google")');
  eq(`${ref(ids.ramesh)} | ${ref(ids.meena)} | ${JSON.stringify(ref(ids.blank))} | ${ref(ids.nul)} | ${ref(ids.spaced)}`, 'Dr. Ramesh Kumar | Dr. Meena Shetty | "" | null | Dr. Anil',
    'past visits print the same referral line as before; a blank or missing referral stays blank');
  eq(all('SELECT referred_by r FROM radiology_orders ORDER BY id').map((r) => r.r).join(' | '), 'Dr. Ramesh Kumar | ', 'a past radiology request keeps its referral line too (none stays none)');
  eq(one("SELECT value v FROM settings WHERE key='referral_names_as_typed'")?.v, '1', 'the conversion is marked as done');

  // the conversion never runs a second time — what is typed from now on is left exactly alone
  const before = JSON.stringify([all('SELECT name FROM referring_doctors ORDER BY id'), all('SELECT referred_by FROM appointments ORDER BY id'), all('SELECT referred_by FROM radiology_orders ORDER BY id')]);
  runMigrations(db); runMigrations(db);
  eq(JSON.stringify([all('SELECT name FROM referring_doctors ORDER BY id'), all('SELECT referred_by FROM appointments ORDER BY id'), all('SELECT referred_by FROM radiology_orders ORDER BY id')]), before, 'running the update again changes nothing');
  await call('referringDoctors:create', { name: 'Self' });
  const a3 = await call('appointments:create', { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '11:00', referred_by: 'Family' });
  runMigrations(db);
  eq(one("SELECT name n FROM referring_doctors WHERE name LIKE '%Self'").n, 'Self', 'a referral added after the update ("Self") is never given a "Dr."');
  eq(ref(a3.id), 'Family', '…nor a visit booked under "Family"');

  // ============================================================================================================
  section('4 · nothing on screen or on paper adds "Dr." to a referral, and the label says "Referral"');
  const files: [string, string[]][] = [
    ['OPD slip', ['src', 'components', 'OpdSlip.tsx']], ['booking confirmation', ['src', 'components', 'BookingDoneDialog.tsx']],
    ['lab report print', ['src', 'components', 'LabPrint.tsx']], ['radiology print', ['src', 'components', 'radiology', 'RadiologyPrint.tsx']],
    ['patient radiology list', ['src', 'components', 'radiology', 'PatientRadiology.tsx']], ['new radiology request', ['src', 'components', 'radiology', 'NewRadiologyRequest.tsx']],
    ['radiology desk', ['src', 'pages', 'Radiology.tsx']], ['booking form', ['src', 'pages', 'Appointments.tsx']],
  ];
  for (const [what, p] of files) {
    const t = read(...p);
    ok(!/Dr\.\s*(\{|\$\{)[^}]*(referred_by|referredBy|\br\.name)/.test(t), `${what}: no "Dr." is put in front of the referral`);
    ok(!/Referred by/.test(t), `${what}: the old label "Referred by" is gone`);
  }
  const slip = read('src', 'components', 'OpdSlip.tsx');
  ok(/>Referral<\/span>/.test(slip) && slip.includes('{appointment.referred_by}'), 'the OPD slip prints "Referral" and then the referral exactly as stored');
  const settings = read('src', 'pages', 'Settings.tsx');
  const mgr = settings.slice(settings.indexOf('function ReferringDoctorsManager'), settings.indexOf('function DoctorsManagement'));
  ok(mgr.length > 1000 && !/Dr\.\s*\{/.test(mgr), 'Settings → Referrals lists and removes names as typed (no "Dr." added)');
  ok(/Add Referral/.test(mgr) && /title=\{editing\?\.id \? 'Edit Referral' : 'Add Referral'\}/.test(mgr) && !/Referring Doctor/.test(mgr), 'Settings → Referrals says "Referral" everywhere, not "Referring Doctor"');
  ok(/<SettingsGroup title="Referrals"/.test(settings), 'the Settings group is called "Referrals"');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
