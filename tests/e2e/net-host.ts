// The "main computer" of the two-computer test (tests/e2e/net-two-pcs.test.ts): the app's real handlers on its own temporary database, with the real network server
// listening on a local port. Run as its own process so the test's "extra computer" can talk to it over a real socket. Not a suite — the runner only runs *.test.ts.
//
//   node net-host.cjs <unified|legacy> <port> <secret>
//     unified — a clinic that has ONE admin password: "Clinic#Care26" (Admin login and Settings lock)
//     legacy  — an older clinic: Settings lock "HostLock#1", Admin login "HostLogin#1" (two different passwords, not unified)
// Prints "READY" when listening. Commands on stdin, one per line: `whoami` (who is signed in on THIS computer), `login <user> <password>`, `logout`, `users`, `drop <channel>`, `quit`.
import './no-broadcast';
import crypto from 'node:crypto';
import { boot, call, getDb } from './harness';
import { startNetworkServer } from '../../src/main/network-server';
import { stopHostWatchdog } from '../../src/main/host-watchdog';
import { actor } from '../../src/main/ipc';
import { ipcHandlers } from '../../src/main/ipc-registry';

boot();
const [mode = 'unified', portArg = '0', secret = 'test-secret'] = process.argv.slice(2);
const scrypt = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 32).toString('hex');

(async () => {
  const db = getDb();
  if (mode === 'legacy') {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare("UPDATE users SET password_hash=?, salt=?, must_change_password=0 WHERE username='admin'").run(scrypt('HostLogin#1', salt), salt);
    const pinSalt = crypto.randomBytes(16).toString('hex');
    db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`$scrypt$${pinSalt}$${scrypt('HostLock#1', pinSalt)}`);
  } else {
    await call('auth:setInitialAdminPassword', 'Clinic#Care26');
  }
  await call('settings:save', { require_login: true });
  await call('auth:createUser', { username: 'nina', password: 'nina1234', role: 'nurse', display_name: 'Nina' });
  await call('auth:createUser', { username: 'rita', password: 'rita1234', role: 'receptionist', display_name: 'Rita' });
  const adminPw = mode === 'legacy' ? 'HostLogin#1' : 'Clinic#Care26';
  await call('auth:login', 'admin', adminPw);                     // someone is signed in at the main computer's own desk: the administrator

  const r = await startNetworkServer(Number(portArg), secret, '1.0.0-e2e');
  stopHostWatchdog();                                              // the test host needs no watchdog process
  if (!r.ok) { console.log('FAILED ' + r.error); process.exit(1); }
  console.log('READY');

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const [cmd, a, b] = line.split(/\s+/);
      if (cmd === 'whoami') console.log('WHOAMI ' + JSON.stringify(actor() ? { username: actor()!.username, role: actor()!.role } : null));
      else if (cmd === 'login') { const u = await call('auth:login', a, b); console.log('LOGIN ' + JSON.stringify(u ? u.username : null)); }
      else if (cmd === 'logout') { await call('auth:logout'); console.log('LOGOUT'); }
      else if (cmd === 'users') console.log('USERS ' + JSON.stringify((db.prepare('SELECT username, role FROM users ORDER BY id').all())));
      else if (cmd === 'drop') { ipcHandlers.delete(a); console.log('DROPPED ' + a); }      // pretend this main computer is an older CureDesk without that channel
      else if (cmd === 'quit') process.exit(0);
    }
  });
  process.stdin.on('end', () => process.exit(0));
})().catch((e) => { console.log('FAILED ' + (e?.stack || e)); process.exit(1); });
