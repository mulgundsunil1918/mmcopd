// ONE admin password for the whole clinic, and "who is making this call" on a network. Owner, 2026-10-27: "admin password should be same on all PCs", "admin should be
// able to log in on any PC and manage", "personal login required for everyone". Before: TWO admin secrets (the Settings lock on each computer, and the Admin login's
// password) and ONE signed-in person per main computer (a sign-in anywhere replaced everybody's identity). Rules proved here on the real handlers:
//   - a new clinic sets ONE password and both the Admin login and the Settings lock take it; an older clinic with two different ones is not locked out — either opens
//     Settings — until the administrator sets the one password, which sets both together (and kills the old ones);
//   - the password rules are the same everywhere (8+ characters, not an easy one), the Admin login's password change is the admin password change;
//   - confirming a deletion accepts the admin password (either half, until unified);
//   - an extra computer asks the main computer first, and falls back to its own copy only when it must (decision function, with every case);
//   - the main computer runs a call from another computer AS the person signed in there: a remote sign-in does not replace the main computer's own session, a
//     cabin user cannot act with the administrator's rights because the administrator is signed in at the main desk (and the other way round), and the audit trail
//     names the right person. An older computer that sends no identity is left on the old behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { verifyAdminViaHost, isUnknownChannelError, type AdminVerifyDeps } from '../../src/main/admin-verify';
import { runForRemoteCaller, remoteCaller, isRemoteCall, sanitizeWireSession } from '../../src/main/caller-session';
import { adminPasswordChoiceProblem, ADMIN_USERNAME, verifyAdminAccount } from '../../src/main/auth';
import { actor, adminPasswordProblem, adminPasswordUnified } from '../../src/main/ipc';

boot();
const db = getDb();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

(async () => {
  // ============================================================================================================
  section('1 · a new clinic: ONE password for the Admin login and the Settings lock');
  let st = await call('auth:adminPasswordState');
  eq(st.isDefault, true, 'a fresh clinic is on the factory password');
  eq(st.unified, false, '…and has not set the one password yet');
  ok(await call('auth:verifyAdminPassword', '1234'), 'the factory Settings password opens Settings');
  ok(!!(await call('auth:login', 'admin', 'admin123')), 'and the factory Admin login signs in');
  await call('auth:logout');
  eq((await call('auth:setInitialAdminPassword', 'short')).ok, false, 'a short password is refused');
  eq((await call('auth:setInitialAdminPassword', 'admin123')).ok, false, 'an easy one is refused');
  const first = await call('auth:setInitialAdminPassword', 'Clinic#Care26');
  ok(first.ok && first.unified === true, 'a good password is accepted — and the clinic now has ONE');
  st = await call('auth:adminPasswordState');
  ok(st.unified === true && st.isDefault === false, '…the state says so');
  ok(await call('auth:verifyAdminPassword', 'Clinic#Care26'), 'the new password opens Settings');
  ok(!(await call('auth:verifyAdminPassword', '1234')), '…the factory one no longer does');
  const asAdmin = await call('auth:login', 'admin', 'Clinic#Care26');
  ok(!!asAdmin, 'the SAME password signs in as Admin');
  ok(!asAdmin.must_change_password, '…without being told to change it again');
  await call('auth:logout');
  ok(!(await call('auth:login', 'admin', 'admin123')), 'the factory Admin login password no longer works');
  eq((await call('auth:setInitialAdminPassword', 'Another#Pass9')).ok, false, 'setting the first password again is refused (use Change password)');
  ok(adminPasswordUnified(db), 'the unified note is saved with the clinic\'s data (so a backup carries it)');

  // ============================================================================================================
  section('2 · an older clinic with two different passwords is not locked out');
  // What an updated clinic can look like: the Settings lock was set to one thing, the Admin login's password changed to another.
  await call('auth:changePassword', 1, 'Login#Pass77');                // the admin ACCOUNT → this also moves the lock (one password)…
  // …so rebuild the old two-password state by hand, exactly as an older version left it:
  const adminId = (q('SELECT id FROM users WHERE username=?', ADMIN_USERNAME)[0]).id;
  const crypto = await import('node:crypto');
  const scryptHash = (pw: string) => { const salt = crypto.randomBytes(16).toString('hex'); return `$scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`; };
  db.prepare("UPDATE settings SET value=? WHERE key='admin_password'").run(scryptHash('OldLock#1234'));
  db.prepare("DELETE FROM settings WHERE key='admin_password_unified'").run();
  // (the account keeps 'Login#Pass77')
  st = await call('auth:adminPasswordState');
  eq(st.unified, false, 'the two passwords differ, and the clinic is not unified');
  ok(await call('auth:verifyAdminPassword', 'OldLock#1234'), 'the old Settings password still opens Settings');
  ok(await call('auth:verifyAdminPassword', 'Login#Pass77'), 'the Admin login\'s password opens Settings too (whoever knows it is the administrator anyway)');
  ok(!(await call('auth:verifyAdminPassword', 'wrong-one')), 'a wrong one does not');
  eq((await call('auth:verifyAdminPasswordEx', 'OldLock#1234')).unified, false, 'the main computer reports "not unified" to the computers that ask');
  ok(!(await call('auth:verifyAdminPasswordEx', 'nope')).ok, '…and "no" to a wrong password');
  eq(adminPasswordProblem('OldLock#1234'), null, 'a deletion is confirmed by the Settings password…');
  eq(adminPasswordProblem('Login#Pass77'), null, '…or by the Admin login\'s password');
  eq(adminPasswordProblem('nope'), 'Wrong admin password.', '…and refused for a wrong one');
  eq(adminPasswordProblem(''), 'Wrong admin password.', '…and for nothing typed');
  const audit = await call('admin:resetAuditLog', 'iknowwhatiamdoing', 'Login#Pass77');
  ok(audit.ok, 'clearing the audit log takes either password too');
  eq((await call('admin:resetAuditLog', 'iknowwhatiamdoing', 'bad')).ok, false, '…and refuses a wrong one');

  // setting the ONE password: either current password works, both halves move together
  const chg = await call('auth:changeAdminPassword', 'OldLock#1234', 'One#Password88');
  ok(chg.ok && chg.unified, 'changing with the OLD Settings password sets the one password');
  ok(await call('auth:verifyAdminPassword', 'One#Password88'), '…which opens Settings');
  ok(!!(await call('auth:login', 'admin', 'One#Password88')), '…and signs in as Admin');
  await call('auth:logout');
  ok(!(await call('auth:verifyAdminPassword', 'OldLock#1234')), 'the old Settings password is gone');
  ok(await call('auth:verifyAdminPassword', 'One#Password88'), '(the right one still works — a success also clears the wrong-password slow-down)');
  ok(!(await call('auth:verifyAdminPassword', 'Login#Pass77')), 'and so is the old Admin login password');
  ok(await call('auth:verifyAdminPassword', 'One#Password88'), '(again)');
  ok(!(await call('auth:login', 'admin', 'Login#Pass77')), '…also as a login');
  st = await call('auth:adminPasswordState');
  eq(st.unified, true, 'the clinic is unified now');
  // the other way: current = the Admin login's password
  db.prepare("UPDATE settings SET value=? WHERE key='admin_password'").run(scryptHash('Diverged#Lock5'));
  ok((await call('auth:changeAdminPassword', 'One#Password88', 'Second#Pass99')).ok, 'changing with the Admin login\'s password works too');
  ok(verifyAdminAccount(db, 'Second#Pass99') && await call('auth:verifyAdminPassword', 'Second#Pass99'), 'both halves hold the new password');

  // ============================================================================================================
  section('3 · the rules for choosing it, and trying to guess it');
  eq(adminPasswordChoiceProblem('Abcdefg'), 'Password must be at least 8 characters', 'under 8 characters is refused');
  eq(adminPasswordChoiceProblem('password'), 'That password is too easy to guess — choose another.', 'an easy one is refused');
  eq(adminPasswordChoiceProblem('1234'), 'Password must be at least 8 characters', '1234 is too short anyway');
  eq(adminPasswordChoiceProblem('Strong#Pass1'), null, 'a reasonable one is fine');
  eq((await call('auth:changeAdminPassword', 'Second#Pass99', 'short')).ok, false, 'Change password refuses a short one');
  eq((await call('auth:changeAdminPassword', 'Second#Pass99', 'admin123')).ok, false, '…and an easy one');
  eq((await call('auth:changeAdminPassword', 'not-it', 'Third#Pass123')).error, 'Current password incorrect', '…and a wrong "current" password');
  ok(await call('auth:verifyAdminPassword', 'Second#Pass99'), '(a refused change changes nothing; a right password also clears the slow-down)');
  const bad = await attempt('auth:changePassword', adminId, 'tiny');
  ok(!bad.ok && /at least 8/.test((bad as any).error), 'the Admin login\'s own password change follows the same rule');
  const weak = await attempt('auth:changePassword', adminId, 'password');
  ok(!weak.ok && /too easy/.test((weak as any).error), '…including the easy-password rule');
  ok((await call('auth:changePassword', adminId, 'Fourth#Pass456')) === true, '…and when it passes it moves the Settings lock with it');
  ok(await call('auth:verifyAdminPassword', 'Fourth#Pass456') && !!(await call('auth:login', 'admin', 'Fourth#Pass456')), 'one password for both');
  await call('auth:logout');
  const nurse = await call('auth:createUser', { username: 'nina', password: 'abcd', role: 'nurse', display_name: 'Nina' });
  ok((await call('auth:changePassword', nurse.id, 'wxyz')) === true, 'an ordinary person\'s password still needs only 4 characters');
  ok(!(await call('auth:verifyAdminPassword', 'wxyz')), '…and is not an admin password');
  let locked = '';
  for (let i = 0; i < 12; i++) { const r = await call('auth:changeAdminPassword', 'guess' + i, 'Fifth#Pass789'); if (/Too many/.test(r.error || '')) { locked = r.error; break; } }
  ok(/Too many wrong passwords/.test(locked), 'guessing the "current" password is slowed down like the unlock screen');

  // ============================================================================================================
  section('4 · an extra computer asks the main computer first (every case, with the asking faked)');
  const mk = (over: Partial<AdminVerifyDeps> & { host?: { ok: boolean; unified: boolean } | 'down' | 'old'; oldAnswer?: boolean; local?: boolean }) => {
    const log: string[] = [];
    const deps: AdminVerifyDeps = {
      askHostEx: async (pw) => { log.push('ex'); if (over.host === 'down') throw new Error('fetch failed'); if (over.host === 'old') throw new Error('HTTP 404 {"ok":false,"error":"Unknown IPC channel: auth:verifyAdminPasswordEx"}'); return over.host ?? { ok: true, unified: true }; },
      askHostOld: async () => { log.push('old'); if (over.oldAnswer === undefined) throw new Error('fetch failed'); return over.oldAnswer; },
      askLocal: async () => { log.push('local'); return over.local ?? false; },
      remember: (pw, unified) => { log.push(`remember:${pw}:${unified}`); },
      ...over,
    };
    return { deps, log };
  };
  let m = mk({ host: { ok: true, unified: true } });
  ok((await verifyAdminViaHost(m.deps, 'secret')) === true && m.log.join() === 'ex,remember:secret:true', 'main computer says yes: yes, and this computer keeps a copy');
  m = mk({ host: { ok: false, unified: true }, local: true });
  ok((await verifyAdminViaHost(m.deps, 'old-local')) === false && m.log.join() === 'ex', 'main says no and the clinic has ONE password: no — the stale local password is not tried');
  m = mk({ host: { ok: false, unified: false }, local: true });
  ok((await verifyAdminViaHost(m.deps, 'own-old')) === true && m.log.join() === 'ex,local', 'main says no, clinic not unified yet: this computer\'s own old password still opens Settings');
  m = mk({ host: { ok: false, unified: false }, local: false });
  ok((await verifyAdminViaHost(m.deps, 'nothing')) === false, '…and a wrong one is no');
  m = mk({ host: 'down', local: true });
  ok((await verifyAdminViaHost(m.deps, 'copy')) === true && m.log.join() === 'ex,local', 'main computer unreachable: this computer\'s own copy decides');
  m = mk({ host: 'down', local: false });
  ok((await verifyAdminViaHost(m.deps, 'copy')) === false, '…and says no to a wrong one');
  m = mk({ host: 'old', oldAnswer: true });
  ok((await verifyAdminViaHost(m.deps, 'pw')) === true && m.log.join() === 'ex,old,remember:pw:false', 'an older main computer (no such question): the plain question is asked; the clinic counts as not unified');
  m = mk({ host: 'old', oldAnswer: false, local: true });
  ok((await verifyAdminViaHost(m.deps, 'pw')) === true && m.log.join() === 'ex,old,local', '…and its "no" lets this computer\'s own password decide (not unified)');
  m = mk({ host: 'old', local: true });
  ok((await verifyAdminViaHost(m.deps, 'pw')) === true && m.log.join() === 'ex,old,local', '…and an older main computer that then fails is "unreachable"');
  ok(isUnknownChannelError(new Error('Unknown IPC channel: x')) && !isUnknownChannelError(new Error('fetch failed')) && !isUnknownChannelError(undefined), 'an "unknown channel" error is told apart from a network error');
  m = mk({ host: { ok: true, unified: false }, remember: () => { throw new Error('disk full'); } });
  ok((await verifyAdminViaHost(m.deps, 'pw')) === true, 'a failed copy never turns a "yes" into a "no"');

  // ============================================================================================================
  section('5 · who is making the call (a call from another computer is made AS the person signed in there)');
  eq(isRemoteCall(), false, 'on the main computer\'s own screen there is no remote caller');
  eq(sanitizeWireSession(undefined), undefined, 'a computer that says nothing (an older CureDesk) stays "undefined"');
  eq(sanitizeWireSession(null), null, '"nobody signed in" stays null');
  eq(sanitizeWireSession('admin'), null, 'text instead of a person is nobody');
  eq(sanitizeWireSession({ id: 0, username: 'x', role: 'admin' }), null, 'id 0 (the shared desk) is nobody');
  eq(sanitizeWireSession({ id: 3, username: 'x', role: 'god' }), null, 'an unknown role is nobody');
  eq(sanitizeWireSession({ id: 3, username: '  ', role: 'nurse' }), null, 'no user name is nobody');
  const wire = sanitizeWireSession({ id: 7, username: 'nina', role: 'nurse', display_name: 'Nina', doctor_id: 0, extra: 'dropped' }) as any;
  ok(wire && wire.id === 7 && wire.username === 'nina' && wire.role === 'nurse' && wire.doctor_id === null && !('extra' in wire), 'a proper person is kept, and only the known fields');

  await call('settings:save', { require_login: true });
  // Someone signs in at the MAIN computer.
  const hostAdmin = await call('auth:login', 'admin', 'Fourth#Pass456');
  ok(actor()?.username === 'admin', 'the administrator is signed in at the main computer');
  // A nurse signs in on ANOTHER computer.
  const nurseLogin = await runForRemoteCaller(null, () => call('auth:login', 'nina', 'wxyz'));
  ok(nurseLogin && nurseLogin.role === 'nurse', 'a sign-in from another computer works…');
  ok(actor()?.username === 'admin', '…and does NOT replace the person signed in at the main computer');
  const nurseSession = { id: nurseLogin.id, username: 'nina', role: 'nurse', display_name: 'Nina', doctor_id: null } as any;
  // A cabin user acting with the administrator's rights because the administrator is at the main desk: that used to pass.
  const asNurse = await runForRemoteCaller(nurseSession, () => attempt('auth:createUser', { username: 'sneaky', password: 'abcd', role: 'admin' }));
  ok(!asNurse.ok && /not allowed/.test((asNurse as any).error), 'a nurse at another computer cannot create an administrator, even though the administrator is signed in at the main computer');
  eq(q("SELECT COUNT(*) c FROM users WHERE username='sneaky'")[0].c, 0, '…and nothing was created');
  const asNobody = await runForRemoteCaller(null, () => attempt('auth:createUser', { username: 'ghost', password: 'abcd', role: 'admin' }));
  ok(!asNobody.ok && /sign in/.test((asNobody as any).error), 'nobody signed in at the other computer is refused too ("sign in first")');
  // The other way round: an administrator at a cabin is the administrator, whoever is signed in at the main computer.
  await call('auth:logout');
  await call('auth:login', 'nina', 'wxyz');                                   // a nurse is signed in at the MAIN computer now
  const adminSession = { id: adminId, username: 'admin', role: 'admin', display_name: 'Administrator', doctor_id: null } as any;
  const asCabinAdmin = await runForRemoteCaller(adminSession, () => attempt('auth:createUser', { username: 'dr.new', password: 'abcd', role: 'doctor' }));
  ok(asCabinAdmin.ok, 'an administrator at another computer can manage, whoever is signed in at the main one');
  const created = q("SELECT id FROM users WHERE username='dr.new'")[0];
  const auditRow = q("SELECT username, action FROM audit_log WHERE action='user_created' AND entity_id=?", created.id)[0];
  eq(auditRow?.username, 'admin', 'the audit trail names the administrator at the other computer (not the nurse at the main one)');
  ok(actor()?.username === 'nina', 'inside the main computer\'s own screen the nurse is still the signed-in person');
  const seen = await runForRemoteCaller(adminSession, async () => { await new Promise((r) => setTimeout(r, 5)); return [isRemoteCall(), remoteCaller()?.session?.username, actor()?.username]; });
  ok(seen[0] === true && seen[1] === 'admin' && seen[2] === 'admin', 'the caller is still known after the handler waits (it is not lost on the first await)');
  eq(isRemoteCall(), false, '…and the main computer\'s own calls are not marked remote afterwards');
  await runForRemoteCaller(nurseSession, () => call('auth:logout'));
  ok(actor()?.username === 'nina', 'signing out at another computer does not sign out the main computer');
  await call('auth:logout');
  ok(actor() === null, '…only its own sign-out does');
  await call('settings:save', { require_login: false });
  const shared = await runForRemoteCaller(null, () => attempt('auth:createUser', { username: 'shared.ok', password: 'abcd', role: 'admin' }));
  ok(shared.ok, 'with sign-in off (shared desks) nothing is enforced, as before');

  // ============================================================================================================
  section('6 · the wiring: main computer, extra computer and screens');
  const server = fs.readFileSync(path.join(root, 'src', 'main', 'network-server.ts'), 'utf8');
  ok(/sanitizeWireSession\(body\?\.session\)/.test(server) && /runForRemoteCaller\(caller/.test(server), 'the main computer runs a forwarded call as the person who sent it');
  ok(/caller === undefined\s*\?\s*await handler\(fakeEvent, \.\.\.args\)/.test(server), '…and leaves a computer that sends no identity on the old behaviour');
  const client = fs.readFileSync(path.join(root, 'src', 'main', 'network-client.ts'), 'utf8');
  ok(/JSON\.stringify\(\{ args, session: clientSession \}\)/.test(client), 'an extra computer says who is signed in with every call');
  ok(/if \(result\) clientSession = result/.test(client) && /clientSession = null/.test(client), '…learns it from a sign-in and forgets it on sign-out');
  ok(!/'auth:verifyAdminPassword',\s*\n\s*'auth:isDefaultAdminPassword'/.test(client) && /verifyAdminViaHost\(/.test(client), 'the admin password is asked of the main computer first (no longer "this PC only")');
  ok(/auth:changeAdminPassword/.test(client) && /cacheClinicAdminPassword\(String\(next\), true\)/.test(client), 'a change goes to the main computer, and this computer keeps the new copy');
  const users = fs.readFileSync(path.join(root, 'src', 'pages', 'Users.tsx'), 'utf8');
  ok(/Set one admin password/.test(users) && /passwordState/.test(users), 'Users & Access tells a clinic with two passwords to set one');
  const auth = fs.readFileSync(path.join(root, 'src', 'hooks', 'useAuth.tsx'), 'utf8');
  ok(/if \(u\.role === 'admin'\) setAdminUnlocked\(true\)/.test(auth), 'signing in as Admin unlocks Settings (no second password)');
  ok(/sessionStorage\.setItem\(SESSION_KEY/.test(auth) && !/localStorage\.setItem\(SESSION_KEY/.test(auth) && /localStorage\.removeItem\(SESSION_KEY\)/.test(auth), 'who is signed in is remembered for this run of the app only — after a restart everyone signs in again (and an older stored sign-in is forgotten)');
  ok(/signs in again each time CureDesk is opened/.test(fs.readFileSync(path.join(root, 'src', 'pages', 'Login.tsx'), 'utf8')), '…and the sign-in screen says so'); 

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
