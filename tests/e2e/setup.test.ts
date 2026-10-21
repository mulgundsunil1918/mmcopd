// First-run setup guide — through the app's REAL IPC handlers on a brand-new temporary database. Synthetic data only.
//
// The owner's words: "once the app is freshly installed it should walk through all the setup screens and make them enter
// the clinic details, doctors' details and all — and a skip-now-I-will-set-up-later button below"; and "without entering
// the clinic name it shouldn't work". So: a fresh clinic is shown the guide; every step can be skipped EXCEPT the clinic
// name; closing the app half-way resumes; a clinic that already has data is never shown it; a client PC never is.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, section, finish } from './lib';

boot();
const db = () => getDb();
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;

(async () => {
  section('1 · a brand-new install');
  const s0 = await call('setup:status');
  eq(s0.show, true, 'the guide is shown on a fresh install');
  eq(s0.status, 'pending', '…and is pending');
  eq(s0.clinic_named, false, 'the clinic has no name yet');
  eq(s0.existing_clinic, false, '…and is not mistaken for an existing clinic');
  ok(Object.values(s0.steps).every((x) => x === 'todo'), '…with every step still to do');
  eq((await call('settings:get')).clinic_name, 'CureDesk HMS', 'the app\'s stand-in name ("CureDesk HMS") is what Settings reads on a fresh install');
  eq(s0.clinic_named, false, '…but that stand-in does NOT count as a name — the guide still asks for the real one');
  eq(JSON.parse(one("SELECT value v FROM settings WHERE key='setup_wizard'").v).origin, 'fresh', 'the first look is remembered as "fresh"');

  section('2 · the clinic name is the one thing that cannot be skipped');
  const noName = await call('setup:setStatus', 'skipped');
  ok(noName.ok === false && /clinic name/i.test(noName.error), `"skip setup" is refused without a name, saying why (${noName.ok ? 'ALLOWED' : noName.error})`);
  const noName2 = await call('setup:setStatus', 'done');
  ok(noName2.ok === false && /clinic name/i.test(noName2.error), '…and so is "finish"');
  eq((await call('setup:status')).show, true, '…the guide stays open');
  await call('settings:save', { clinic_name: '   ' });
  eq((await call('setup:status')).clinic_named, false, 'a name of only spaces is not a name');
  ok((await call('setup:setStatus', 'skipped')).ok === false, '…and does not let the guide be skipped');

  section('3 · every other step can be saved or skipped, and is remembered');
  const bad = await call('setup:markStep', 'nonsense', 'done');
  ok(bad.ok === false, 'an unknown step is refused');
  ok((await call('setup:markStep', 'clinic', 'maybe')).ok === false, 'a step is either done or skipped, nothing else');
  await call('settings:save', { clinic_name: 'Test Clinic' });
  const m1 = await call('setup:markStep', 'clinic', 'done');
  ok(m1.ok && m1.status.steps.clinic === 'done', 'the clinic step is saved');
  eq(m1.status.clinic_named, true, '…and the name now counts');
  eq(m1.status.clinic_name, 'Test Clinic', '…read back exactly');
  const m2 = await call('setup:markStep', 'doctors', 'skipped');
  eq(m2.status.steps.doctors, 'skipped', 'the doctors step is skipped');
  const m3 = await call('setup:markStep', 'doctors', 'done');
  eq(m3.status.steps.doctors, 'done', '…and can be done later');
  const m4 = await call('setup:markStep', 'doctors', 'skipped');
  eq(m4.status.steps.doctors, 'done', 'pressing skip again does not undo a step that was saved');
  eq((await call('setup:status')).show, true, 'still pending: the guide resumes if the app is closed here');

  section('4 · adding data half-way never makes it look like an old clinic');
  await call('doctors:create', { name: 'Dr. Guide', specialty: 'GP', default_fee: 300 });
  const mid = await call('setup:status');
  eq(mid.show, true, 'a doctor added during the guide leaves it open');
  eq(mid.existing_clinic, false, '…and the clinic is still "fresh"');

  section('5 · skipping, reminders, reopening');
  const sk = await call('setup:setStatus', 'skipped');
  ok(sk.ok && sk.status.status === 'skipped' && sk.status.show === false, '"skip setup for now" closes the guide once the clinic has a name');
  eq(sk.status.reminder, true, '…and leaves a reminder, because steps are still open');
  const stop = await call('setup:setStatus', 'skipped', { stop_reminders: true });
  eq(stop.status.reminder, false, '"don\'t remind me" switches the reminder off');
  const re = await call('setup:setStatus', 'pending');
  ok(re.ok && re.status.show === true, 'the guide can be reopened any time (Settings → Open the setup guide)');
  eq(re.status.steps.clinic, 'done', '…with what was saved still saved');
  eq(re.status.reminder, false, '…and no reminder while it is open');
  for (const k of ['doctors', 'fees', 'staff', 'pharmacy', 'inpatient', 'clinic']) await call('setup:markStep', k, 'done');
  const fin = await call('setup:setStatus', 'done');
  ok(fin.ok && fin.status.status === 'done' && fin.status.show === false && fin.status.reminder === false, 'finishing closes the guide, with no reminder');
  eq((await call('setup:status')).show, false, '…and it stays closed on the next start');
  const again = await call('setup:setStatus', 'skipped');
  ok(again.ok && again.status.reminder === false, 'skipping after every step is saved leaves no reminder');
  ok(db().prepare("SELECT 1 FROM audit_log WHERE action='setup.guide'").get() !== undefined, 'settling the guide is written to the audit log');

  section('6 · a clinic that already has data is never shown the guide');
  db().prepare("DELETE FROM settings WHERE key='setup_wizard'").run();      // as if this were an upgrade: no note yet, but data exists
  const old = await call('setup:status');
  eq(old.show, false, 'an upgraded clinic (doctors already exist) is not shown the guide');
  eq(old.status, 'done', '…it is settled as done');
  eq(old.existing_clinic, true, '…and recorded as an existing clinic');
  eq(JSON.parse(one("SELECT value v FROM settings WHERE key='setup_wizard'").v).origin, 'existing-clinic', '…for good');
  await call('patients:create', { first_name: 'Later', last_name: 'Patient', dob: '1990-01-01', gender: 'F', phone: '9500000001' });
  eq((await call('setup:status')).show, false, '…and a new patient changes nothing');

  section('7 · a client PC never shows it');
  db().prepare("DELETE FROM settings WHERE key='setup_wizard'").run();
  db().prepare("INSERT INTO settings (key, value) VALUES ('network_mode','client') ON CONFLICT(key) DO UPDATE SET value='client'").run();
  const cl = await call('setup:status');
  eq(cl.show, false, 'an extra PC connected to the main PC is never shown the guide');
  eq(cl.reminder, false, '…nor the reminder');
  eq(one("SELECT COUNT(*) c FROM settings WHERE key='setup_wizard'").c, 0, '…and writes nothing about it');
  db().prepare("UPDATE settings SET value='local' WHERE key='network_mode'").run();

  section('8 · damaged or odd stored state');
  db().prepare("INSERT INTO settings (key, value) VALUES ('setup_wizard','{not json') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const dmg = await call('setup:status');
  eq(dmg.show, false, 'a damaged note is treated as never made — and this clinic has data, so no guide');
  eq(dmg.status, 'done', '…and it is repaired');

  section('9 · an expired licence');
  setReadOnlyMode(true);
  ok((await attempt('setup:status')).ok, 'looking at the guide status still works when the licence has expired');
  const ro1 = await attempt('setup:markStep', 'clinic', 'done');
  const ro2 = await attempt('setup:setStatus', 'pending');
  ok(!ro1.ok && /read-only/i.test((ro1 as any).error), 'saving a step is blocked while read-only');
  ok(!ro2.ok && /read-only/i.test((ro2 as any).error), '…and so is reopening the guide');
  setReadOnlyMode(false);

  section('10 · the guide\'s data goes through the same channels as Settings');
  const wards = await call('wards:save', { name: 'Guide Ward', ward_type: 'general', per_day_rate: 800, nursing_per_day: 100 });
  ok(wards.ok, 'a ward can be added');
  for (let i = 1; i <= 3; i++) ok((await call('beds:save', { ward_id: wards.id, bed_number: `GU-${i}` })).ok, `bed GU-${i} is added`);
  eq(one('SELECT COUNT(*) c FROM beds WHERE ward_id=?', wards.id).c, 3, 'the ward has its 3 beds');
  const u = await call('auth:createUser', { username: 'guide_rita', password: 'pass1234', role: 'receptionist', display_name: 'Rita' });
  ok(u && u.id > 0, 'a staff login can be added');
  const dupe = await attempt('auth:createUser', { username: 'guide_rita', password: 'pass1234', role: 'receptionist' });
  ok(!dupe.ok, '…and the same username cannot be added twice');
  const shortPw = await attempt('auth:createUser', { username: 'guide_short', password: '123', role: 'nurse' });
  ok(!shortPw.ok && /at least 4/.test((shortPw as any).error), 'a too-short password is refused in plain words');
  await call('settings:save', { followup_enabled: true, followup_window_days: 10, followup_free_visits: 3, registration_fee_enabled: true, registration_fee_amount: 150, invoice_prefix: 'GUIDE', pharmacy_credit_enabled: true });
  const st = await call('settings:get');
  ok(st.followup_enabled === true && st.followup_window_days === 10 && st.followup_free_visits === 3, 'follow-up rules are saved');
  ok(st.registration_fee_enabled === true && st.registration_fee_amount === 150, 'the registration fee is saved');
  eq(st.invoice_prefix, 'GUIDE', 'the bill prefix is saved');
  eq(st.pharmacy_credit_enabled, true, 'the pharmacy credit switch is saved');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
