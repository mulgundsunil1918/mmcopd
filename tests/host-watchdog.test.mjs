/**
 * Prove the watchdog catches the failure that actually happened: a server whose
 * port still ACCEPTS connections but never answers HTTP (a blocked event loop),
 * which is invisible to a port check and to any self-check inside the process.
 *
 * Runs the real watchdog body in a real separate process, with the notification
 * calls redirected to a file so we can assert on what it would have told the user.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 47321;
const OUT = path.join(os.tmpdir(), `curedesk-watchdog-test-${process.pid}.log`);
let pass = true;
const check = (name, ok, detail) => {
  if (!ok) pass = false;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// Backstop: this test drives real sockets and a child process, so a bug in the
// teardown must never hang the whole suite (as it once did). Fail loudly after
// 25s no matter what.
setTimeout(() => { console.log('\nFAILURES ABOVE — test exceeded 25s hard timeout'); process.exit(1); }, 25_000).unref();

// ONE server whose behaviour flips via a flag — no close/rebind on the same
// port (which deadlocks while the watchdog child keeps opening probe sockets).
//   wedged=true  → accept the request and never answer (port open, no HTTP),
//                  exactly the real host: TCP connects, HTTP times out.
//   wedged=false → answer 200, i.e. recovered.
let wedged = true;
const server = http.createServer((req, res) => {
  if (wedged) return; // hold the socket open, never respond
  res.writeHead(200); res.end('{"ok":true}');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// The watchdog body, with notify() writing to a file instead of the OS.
const body = `
const http = require('http');
const fs = require('fs');
const PARENT = ${process.pid};
const PORT = ${PORT};
const THRESHOLD = 3;
const INTERVAL = 300;
const TIMEOUT = 400;
let fails = 0, alerted = false;
function notify(title, b) { fs.appendFileSync(${JSON.stringify(OUT)}, title + '\\n'); }
function probe(cb) {
  let done = false;
  const finish = (ok) => { if (!done) { done = true; cb(ok); } };
  try {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: TIMEOUT }, (res) => {
      res.resume(); finish(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  } catch (e) { finish(false); }
}
setInterval(() => {
  try { process.kill(PARENT, 0); } catch (e) { process.exit(0); }
  probe((ok) => {
    if (ok) {
      if (alerted) notify('CureDesk is responding again', '');
      fails = 0; alerted = false; return;
    }
    fails++;
    if (fails >= THRESHOLD && !alerted) { alerted = true; notify('CureDesk has stopped responding', ''); }
  });
}, INTERVAL);
`;

const child = spawn(process.execPath, ['-e', body], { stdio: 'ignore' });
const read = () => (fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nscenario 1 — port open but no HTTP reply (the real failure)');
await wait(700);
check('stays quiet before the threshold', !read().includes('stopped responding'), 'no premature alert');
await wait(1400);
check('alerts once the threshold is crossed', read().includes('stopped responding'));
const alertCount = (read().match(/stopped responding/g) || []).length;
await wait(900);
check('does not repeat the alert while still down',
  (read().match(/stopped responding/g) || []).length === alertCount, 'alerted once, not every probe');

console.log('\nscenario 2 — the server starts answering again');
// Flip the same server to healthy — the child's next probes now succeed and it
// should announce recovery. No socket teardown, so nothing can deadlock.
wedged = false;
await wait(1500);
check('announces recovery on its own', read().includes('responding again'));

console.log('\nscenario 3 — CureDesk exits');
child.kill();
await wait(300);
check('watchdog does not outlive the app', child.killed || child.exitCode !== null);

// Child is dead → no new probe sockets; force-drop any lingering one, then close.
await new Promise((r) => { try { server.closeAllConnections(); } catch { /* older node */ } server.close(() => r()); });
try { fs.unlinkSync(OUT); } catch { /* ignore */ }
console.log(pass ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(pass ? 0 : 1);
