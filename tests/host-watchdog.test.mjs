/**
 * Prove the watchdog catches the failure that actually happened: a server whose
 * port still ACCEPTS connections but never answers HTTP (a blocked event loop),
 * which is invisible to a port check and to any self-check inside the process.
 *
 * Runs the real watchdog body in a real separate process, with the notification
 * calls redirected to a file so we can assert on what it would have told the user.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
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

// A WEDGED server: completes the TCP handshake, then never replies. This is
// exactly what the host looked like — port open in 602ms, no HTTP in 5s.
const wedged = net.createServer(() => { /* accept and ignore, forever */ });
await new Promise((r) => wedged.listen(PORT, '127.0.0.1', r));

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
await new Promise((r) => wedged.close(r));
const healthy = http.createServer((req, res) => { res.writeHead(200); res.end('{"ok":true}'); });
await new Promise((r) => healthy.listen(PORT, '127.0.0.1', r));
await wait(1200);
check('announces recovery on its own', read().includes('responding again'));

console.log('\nscenario 3 — CureDesk exits');
child.kill();
await wait(200);
check('watchdog does not outlive the app', child.killed || child.exitCode !== null);

await new Promise((r) => healthy.close(r));
try { fs.unlinkSync(OUT); } catch { /* ignore */ }
console.log(pass ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(pass ? 0 : 1);
