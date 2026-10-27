// Two computers for real: a "main computer" in its own process (the app's real handlers + the real network server on a local port) and this process as an EXTRA
// computer (the real network client proxies installed over its handlers). Owner, 2026-10-27: one admin password on every computer, the admin can sign in on any computer,
// everyone signs in with their own login. What is proved, over a real socket:
//   - the admin password is asked of the main computer first; a stale password from before the change no longer opens Settings once the clinic has ONE password;
//     before that, this computer's own old Settings password still opens it; with the main computer off, the copy kept here decides; a change needs the main computer;
//   - an older main computer (no "…Ex" question) is still understood;
//   - a person signing in on this computer does not replace whoever is signed in at the main computer; a nurse here cannot act as the administrator because the
//     administrator sits at the main desk, an administrator here can manage even when a nurse sits at the main desk, and the audit trail names the right person;
//   - a computer that sends no identity (an older CureDesk) is left on the old behaviour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildSync } from 'esbuild';
import { boot, call, getDb } from './harness';
import { invokeLive } from './electron-stub';
import { ok, eq, section, finish } from './lib';
import { installNetworkClient, uninstallNetworkClient } from '../../src/main/network-client';
import { verifyLocalAdminPin } from '../../src/main/ipc';

boot();
const db = getDb();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pinHash = (pw: string) => { const salt = crypto.randomBytes(16).toString('hex'); return `$scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`; };
const setLocalPin = (pw: string) => db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(pinHash(pw));
const rejects = async (p: Promise<any>) => { try { await p; return null; } catch (e: any) { return String(e?.message || e); } };

// ---- the main computer, as a child process --------------------------------------------------------------------------------------------------------------------
const bundle = path.join(os.tmpdir(), `curedesk-net-host-${process.pid}.cjs`);
buildSync({ entryPoints: [path.join(root, 'tests', 'e2e', 'net-host.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: bundle, logLevel: 'error' });

interface Host { proc: ChildProcessWithoutNullStreams; port: number; secret: string; url: string; ask: (cmd: string, expect: string) => Promise<string>; stop: () => Promise<void> }
async function startHost(mode: 'unified' | 'legacy'): Promise<Host> {
  const secret = 'e2e-secret-' + crypto.randomBytes(6).toString('hex');
  for (let attempt = 0; attempt < 6; attempt++) {
    const port = 42000 + Math.floor(Math.random() * 6000);
    const proc = spawn(process.execPath, [bundle, mode, String(port), secret], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const waiters: { prefix: string; resolve: (l: string) => void }[] = [];
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { err += d; });
    proc.stdout.on('data', (d: string) => {
      out += d;
      let i: number;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i).trim(); out = out.slice(i + 1);
        const w = waiters.findIndex((x) => line.startsWith(x.prefix));
        if (w >= 0) waiters.splice(w, 1)[0].resolve(line);
      }
    });
    const waitFor = (prefix: string, ms = 25000) => new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for "${prefix}" from the main computer. stderr: ${err.slice(0, 400)}`)), ms);
      waiters.push({ prefix, resolve: (l) => { clearTimeout(t); resolve(l); } });
      proc.on('exit', () => { clearTimeout(t); reject(new Error(`the main computer exited. stderr: ${err.slice(0, 400)}`)); });
    });
    try {
      const first = await Promise.race([waitFor('READY'), waitFor('FAILED', 25000)]);
      if (first.startsWith('FAILED')) { try { proc.kill(); } catch { /* ignore */ } continue; }          // port busy: try another
      return {
        proc, port, secret, url: `http://127.0.0.1:${port}`,
        ask: async (cmd, expect) => { const p = waitFor(expect, 10000); proc.stdin.write(cmd + '\n'); return p; },
        stop: async () => { try { proc.stdin.write('quit\n'); } catch { /* ignore */ } await sleep(300); try { proc.kill(); } catch { /* ignore */ } },
      };
    } catch (e) { try { proc.kill(); } catch { /* ignore */ } if (attempt === 5) throw e; }
  }
  throw new Error('could not start the main computer');
}

(async () => {
  setLocalPin('OldLocal#99');                                         // what an older CureDesk left as THIS computer's own Settings password

  // ============================================================================================================
  section('1 · an extra computer and a main computer that has ONE admin password');
  let host = await startHost('unified');
  ok(installNetworkClient(host.url, host.secret).ok, 'this computer is connected to the main computer');
  ok((await invokeLive('auth:verifyAdminPassword', 'Clinic#Care26')) === true, 'the clinic\'s admin password opens Settings here (asked of the main computer)');
  ok(verifyLocalAdminPin('Clinic#Care26') && !verifyLocalAdminPin('OldLocal#99'), '…and this computer keeps a copy of it (its own old one is replaced)');
  ok((await invokeLive('auth:verifyAdminPassword', 'OldLocal#99')) === false, 'this computer\'s OWN old password no longer opens Settings — the clinic has one password now');
  ok((await invokeLive('auth:verifyAdminPassword', 'Clinic#Care26')) === true, '(the right one still does)');
  ok((await invokeLive('auth:isDefaultAdminPassword')) === false, 'the main computer\'s password is not the factory one — so no "set your password" screen here');
  const state = await invokeLive('auth:adminPasswordState');
  ok(state.unified === true && state.isDefault === false, 'the clinic\'s state is read from the main computer');

  const changed = await invokeLive('auth:changeAdminPassword', 'Clinic#Care26', 'Changed#Pass42');
  ok(changed.ok === true, 'changing the admin password from this computer works (it is done on the main computer)');
  ok((await invokeLive('auth:verifyAdminPassword', 'Changed#Pass42')) === true, '…the new one opens Settings');
  ok(verifyLocalAdminPin('Changed#Pass42'), '…and this computer keeps the new copy');
  ok((await invokeLive('auth:verifyAdminPassword', 'Clinic#Care26')) === false, '…the old one is gone');
  ok((await invokeLive('auth:verifyAdminPassword', 'Changed#Pass42')) === true, '(clears the slow-down)');
  const refused = await invokeLive('auth:changeAdminPassword', 'Changed#Pass42', 'short');
  ok(refused.ok === false && /at least 8/.test(refused.error), 'the main computer\'s password rules apply to a change made here');
  ok(verifyLocalAdminPin('Changed#Pass42'), '(a refused change leaves the copy alone)');

  // ============================================================================================================
  section('2 · signing in on this computer — who is who');
  eq(JSON.parse((await host.ask('whoami', 'WHOAMI')).slice(7))?.username, 'admin', 'the administrator is signed in at the main computer\'s own desk');
  const nina = await invokeLive('auth:login', 'nina', 'nina1234');
  ok(nina && nina.role === 'nurse', 'a nurse signs in on this computer (the account lives on the main computer)');
  eq(JSON.parse((await host.ask('whoami', 'WHOAMI')).slice(7))?.username, 'admin', 'the main computer\'s own session did NOT change');
  const asNurse = await rejects(invokeLive('auth:createUser', { username: 'sneaky', password: 'abcd', role: 'admin' }));
  ok(!!asNurse && /not allowed/.test(asNurse), 'the nurse here cannot create an administrator — even though the administrator is signed in at the main computer');
  ok(!(JSON.parse((await host.ask('users', 'USERS')).slice(6)) as any[]).some((u) => u.username === 'sneaky'), '…and nothing was created');
  await invokeLive('auth:logout');
  const asNobody = await rejects(invokeLive('auth:createUser', { username: 'ghost', password: 'abcd', role: 'admin' }));
  ok(!!asNobody && /sign in/i.test(asNobody), 'nobody signed in here: refused ("sign in first")');
  const adminHere = await invokeLive('auth:login', 'admin', 'Changed#Pass42');
  ok(adminHere && adminHere.role === 'admin', 'the Admin signs in on this computer with the SAME one admin password');
  await host.ask('logout', 'LOGOUT');
  const nurseAtHost = JSON.parse((await host.ask('login nina nina1234', 'LOGIN')).slice(6));
  eq(nurseAtHost, 'nina', 'now a nurse is signed in at the main computer\'s own desk');
  const created = await invokeLive('auth:createUser', { username: 'dr.cabin', password: 'abcd', role: 'doctor', display_name: 'Dr Cabin' });
  ok(created && created.username === 'dr.cabin', 'the administrator here can manage staff although a nurse sits at the main computer');
  const audit = await invokeLive('audit:list', 50);
  const row = (audit as any[]).find((a) => a.action === 'user_created' && a.entity_id === created.id);
  eq(row?.username, 'admin', 'the audit trail names the administrator who did it (not the nurse at the main desk)');
  eq(JSON.parse((await host.ask('whoami', 'WHOAMI')).slice(7))?.username, 'nina', '…and the main computer\'s own desk is still the nurse');
  await invokeLive('auth:logout');

  // ---- what an OLDER computer sends (no identity at all) is treated as before ----
  const raw = async (session: any, hasSession: boolean) => {
    const body: any = { args: [{ username: `raw.${Math.random().toString(36).slice(2, 7)}`, password: 'abcd', role: 'admin' }] };
    if (hasSession) body.session = session;
    const res = await fetch(`${host.url}/ipc/auth:createUser`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.secret}` }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
  };
  await host.ask('logout', 'LOGOUT');
  await host.ask('login admin Changed#Pass42', 'LOGIN');
  const legacyCall = await raw(undefined, false);
  ok(legacyCall.json.ok === true, 'a call with NO identity (an older computer) is run as the main computer\'s own session — unchanged behaviour');
  const wireNurse = await raw({ id: 999, username: 'nina', role: 'nurse' }, true);
  ok(wireNurse.json.ok === false && /not allowed/.test(wireNurse.json.error), 'a call that says "a nurse" is refused for an administrator-only action');
  const wireNobody = await raw(null, true);
  ok(wireNobody.json.ok === false && /sign in/i.test(wireNobody.json.error), 'a call that says "nobody is signed in" is refused');
  const wireJunk = await raw({ id: 5, username: 'x', role: 'superuser' }, true);
  ok(wireJunk.json.ok === false, 'a made-up role is not believed');

  // ============================================================================================================
  section('3 · the main computer is switched off');
  await host.stop();
  await sleep(300);
  ok((await invokeLive('auth:verifyAdminPassword', 'Changed#Pass42')) === true, 'the copy kept on this computer still opens Settings (so a station can reach Settings to repair the connection)');
  ok((await invokeLive('auth:verifyAdminPassword', 'Changed#Pass42')) === true, '(again)');
  ok((await invokeLive('auth:verifyAdminPassword', 'OldLocal#99')) === false, '…a wrong one does not');
  ok((await invokeLive('auth:verifyAdminPassword', 'Changed#Pass42')) === true, '(clears the slow-down)');
  const offlineChange = await invokeLive('auth:changeAdminPassword', 'Changed#Pass42', 'Offline#Pass1');
  ok(offlineChange.ok === false && /main computer cannot be reached/.test(offlineChange.error), 'the admin password cannot be changed while the main computer is off (one password for the clinic)');
  ok(verifyLocalAdminPin('Changed#Pass42'), '…and nothing was changed here');
  ok((await invokeLive('auth:isDefaultAdminPassword')) === false, 'the "factory password?" question is answered from this computer\'s copy');

  // ============================================================================================================
  section('4 · an older clinic: two different passwords, not unified yet (and an older main computer)');
  host = await startHost('legacy');
  ok(installNetworkClient(host.url, host.secret).ok, 'connected to the older clinic\'s main computer');
  setLocalPin('OwnOld#55');
  eq((await invokeLive('auth:adminPasswordState')).unified, false, 'the clinic is not unified yet');
  ok((await invokeLive('auth:verifyAdminPassword', 'OwnOld#55')) === true, 'this computer\'s own old Settings password still opens Settings (the update locks nobody out)');
  ok((await invokeLive('auth:verifyAdminPassword', 'HostLock#1')) === true, 'the main computer\'s Settings password opens it too');
  ok(verifyLocalAdminPin('HostLock#1'), '…and this computer keeps that copy');
  ok((await invokeLive('auth:verifyAdminPassword', 'HostLogin#1')) === true, 'the main computer\'s Admin login password opens Settings as well');
  ok((await invokeLive('auth:verifyAdminPassword', 'HostLock#1')) === true, '(and the Settings one again)');
  ok((await invokeLive('auth:verifyAdminPassword', 'nonsense')) === false, 'a wrong one does not');
  setLocalPin('OwnOld#55');
  const adminLoginHere = await invokeLive('auth:login', 'admin', 'HostLogin#1');
  ok(adminLoginHere && adminLoginHere.role === 'admin', 'the Admin login works here with the main computer\'s Admin password');
  await invokeLive('auth:logout');
  // the administrator sets the ONE password from this computer: from then on the old passwords are gone everywhere
  const unify = await invokeLive('auth:changeAdminPassword', 'HostLock#1', 'Unified#Pass77');
  ok(unify.ok === true && unify.unified === true, 'the administrator sets the one password from this computer');
  setLocalPin('OwnOld#55');
  ok((await invokeLive('auth:verifyAdminPassword', 'OwnOld#55')) === false, 'now this computer\'s own old password no longer opens Settings — the clinic has ONE password');
  ok((await invokeLive('auth:verifyAdminPassword', 'Unified#Pass77')) === true, '…only the new one opens it (a right password also clears the wrong-password slow-down)');
  ok((await invokeLive('auth:verifyAdminPassword', 'HostLock#1')) === false, '…nor does the main computer\'s old Settings password');
  ok((await invokeLive('auth:verifyAdminPassword', 'Unified#Pass77')) === true, '(the new one again)');
  eq((await invokeLive('auth:adminPasswordState')).unified, true, 'the clinic is unified now');
  const adminAfter = await invokeLive('auth:login', 'admin', 'Unified#Pass77');
  ok(adminAfter && adminAfter.role === 'admin', 'the same password signs in as Admin');
  await invokeLive('auth:logout');

  // an OLDER main computer has no "…Ex" question
  await host.ask('drop auth:verifyAdminPasswordEx', 'DROPPED');
  ok((await invokeLive('auth:verifyAdminPassword', 'Unified#Pass77')) === true, 'an OLDER main computer (no such question) is still understood — its yes is a yes');
  setLocalPin('OwnOld#55');
  ok((await invokeLive('auth:verifyAdminPassword', 'OwnOld#55')) === true, '…and its "no" lets this computer\'s own password decide (it cannot tell this computer the clinic is unified)');
  ok((await invokeLive('auth:verifyAdminPassword', 'Unified#Pass77')) === true, '(clears the slow-down)');
  ok((await invokeLive('auth:verifyAdminPassword', 'nonsense')) === false, '…and a wrong one is still no');
  await host.stop();
  uninstallNetworkClient();
  try { fs.rmSync(bundle, { force: true }); } catch { /* ignore */ }

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
