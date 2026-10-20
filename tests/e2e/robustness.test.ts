// Garbage in, nothing broken out: every channel the screens can call is invoked with missing, empty, wrong-typed
// and absurd arguments on a scratch database. Pass means: the app does not crash, every reply can cross the
// IPC boundary (structured-clone safe), the database is still internally consistent afterwards, and no
// data was destroyed. It also LISTS which channels answer with a raw JavaScript error instead of a sentence,
// so the quality of validation messages is on record (informational — the screens validate before sending).
import { boot, call, channels, getDb } from './harness';
import { ok, eq, section, finish, note } from './lib';

boot();
// Channels that must not run against even a scratch database: destructive resets, restores, OS / network / licence plumbing.
const SKIP = /^(admin:(hardResetAndRestart|deletePatients?|deleteAppointment|loadSampleData|removeSampleData|resetAuditLog|resetNotificationLog)|backup:|network:|license:|dialog:|app:|updates:|emr:openDocument|auth:recoverWithCode|printJobs:|pharmacy:bulkDeleteDrugs|lab:bulkDeleteTests|radiology:deleteTests|doctors:delete)/;

const ARGSETS: any[][] = [
  [], [null], [undefined], [{}], [[]], ['x'], [-1], [0], [1], [1e12], [{ id: 'abc' }], [{ id: 1 }], [1, {}], [1, 'x'], [1, 'x', 'y'], ['', ''], [{ items: 'not-an-array' }], [{ items: [] }], [{ patient_id: 999999 }],
];

(async () => {
  const d = await call('doctors:create', { name: 'Dr. Fuzz', specialty: 'GP', default_fee: 100 });
  const p = await call('patients:create', { first_name: 'Fuzz', last_name: 'Patient', dob: '1990-01-01', gender: 'M', phone: '9333333333' });
  const today = (() => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
  await call('appointments:create', { patient_id: p.id, doctor_id: d.id, appointment_date: today, appointment_time: '10:00' });
  const db = getDb();
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c as number;
  const before = { patients: count('patients'), appointments: count('appointments'), bills: count('bills'), drugs: count('drug_master'), users: count('users') };

  const targets = channels().filter((c) => !SKIP.test(c));
  section(`calling ${targets.length} channels × ${ARGSETS.length} bad-argument sets`);
  let calls = 0, threw = 0, rawErrors = 0;
  const raw = new Map<string, string>();
  const notCloneable: string[] = [];
  for (const ch of targets) {
    for (const args of ARGSETS) {
      calls++;
      let res: any;
      try { res = await call(ch, ...args); }
      catch (e: any) {
        threw++;
        const m = String(e?.message ?? e);
        if (/^(Cannot read prop|Cannot destructure|undefined is not|.* is not a function|.* is not iterable|Unexpected token|Invalid (array|string) length)|SQLITE_|FOREIGN KEY|NOT NULL constraint|UNIQUE constraint|no such (table|column)|datatype mismatch|too many SQL variables|RangeError|TypeError|ReferenceError/.test(m)) {
          rawErrors++; if (!raw.has(ch)) raw.set(ch, m.slice(0, 90));
        }
        continue;
      }
      try { structuredClone(res); } catch { if (!notCloneable.includes(ch)) notCloneable.push(ch); }
    }
  }
  note(`${calls} calls; ${threw} answered with an error; ${rawErrors} of those were a raw JavaScript/SQL message rather than a sentence`);
  ok(notCloneable.length === 0, `every reply can cross the IPC boundary${notCloneable.length ? ' — NOT cloneable: ' + notCloneable.join(', ') : ''}`);

  section('the database is still sound');
  eq((db.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok', 'PRAGMA integrity_check = ok');
  eq(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'no foreign-key violations');
  const after = { patients: count('patients'), appointments: count('appointments'), bills: count('bills'), drugs: count('drug_master'), users: count('users') };
  ok(after.patients >= before.patients && after.appointments >= before.appointments && after.drugs >= before.drugs && after.users >= before.users, `nothing was destroyed (patients ${before.patients}→${after.patients}, appointments ${before.appointments}→${after.appointments}, drugs ${before.drugs}→${after.drugs}, users ${before.users}→${after.users})`);
  eq(count('patients') > 0 && count('doctors') > 0, true, 'core records still present');

  section('channels that answered with a raw JavaScript / SQL message (informational)');
  const list = [...raw.entries()].sort(([a], [b]) => a.localeCompare(b));
  note(`${list.length} channel(s):`);
  for (const [ch, m] of list) console.log(`     ${ch.padEnd(34)} ${m}`);
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
