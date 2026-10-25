// "A unlocks only A": every paid module (Laboratory, Pharmacy, IPD, WhatsApp) is unlocked ONLY by its own name appearing inside the signed
// licence — never by what a screen had ticked, never as a side effect of another module. And a new code REPLACES the old one, so one that
// would switch off a paid module the clinic has today is refused until the person confirms; the keygen's Upgrade only ever ADDS.
// Real handlers; signed with a throw-away key (plus the real vendor key / the real keygen when they are on this machine).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { boot, stubState, userData } from './harness';
import { activateLicense, getLicenseStatus, machineFingerprint, verifyTokenStrict } from '../../src/main/licensing/license';
import { isModuleLicensed } from '../../src/main/licensing/enforce';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const BASE = ['reception', 'opd', 'peds', 'analytics'];
const PAID = ['lab', 'pharmacy', 'ipd', 'whatsapp', 'whatsapp_pro'];
const hw = machineFingerprint();
const mint = (payload: object, privateKeyPem: string) => {
  const pStr = JSON.stringify(payload);
  const s = crypto.sign(null, Buffer.from(pStr, 'utf8'), privateKeyPem).toString('base64');
  return Buffer.from(JSON.stringify({ p: pStr, s })).toString('base64');
};
const eph = crypto.generateKeyPairSync('ed25519');
const PUB = eph.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = eph.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
let n = 0;
const licence = (addons: string[], priv: string = PRIV) => mint({
  v: 1, license_id: `LIC-MOD${String(++n).padStart(4, '0')}`, clinic: 'Modules Clinic', customer: '', edition: 'custom', modules: [...BASE, ...addons],
  issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), hardware_id: hw,
  contact: { phone: '8073935006', email: 'mulgundsunil@gmail.com' },
}, priv);
const licFile = () => path.join(userData, 'license.dat');
const installed = () => { try { return fs.readFileSync(licFile(), 'utf8'); } catch { return ''; } };
const wipe = () => { for (const f of ['license.dat', '.used_licenses', '.license_meta']) fs.rmSync(path.join(userData, f), { force: true }); };

(async () => {
  stubState.isPackaged = true;

  // ============================================================================================================
  section('1 · a code unlocks exactly the modules written inside it (the real vendor key, when it is on this computer)');
  const realKey = path.join(root, 'license-keys', 'private.pem');
  if (fs.existsSync(realKey)) {
    const REAL = fs.readFileSync(realKey, 'utf8');
    const sets: [string, string[]][] = [['Pharmacy only', ['pharmacy']], ['Laboratory only', ['lab']], ['IPD only', ['ipd']], ['WhatsApp Basic only', ['whatsapp']],
      ['WhatsApp Pro', ['whatsapp', 'whatsapp_pro']], ['Laboratory + Pharmacy', ['lab', 'pharmacy']], ['nothing extra (base plan)', []]];
    for (const [label, addons] of sets) {
      wipe();
      const r = activateLicense(licence(addons, REAL));
      ok(r.ok, `${label}: the code activates (${r.error || 'ok'})`);
      const got = PAID.filter((m) => isModuleLicensed(m));
      eq(got.join(',') || '(none)', addons.join(',') || '(none)', `${label}: the app unlocks exactly ${addons.join(' + ') || 'no paid module'} — nothing else`);
      ok(BASE.every((m) => isModuleLicensed(m)), `${label}: the base plan is there`);
      eq(getLicenseStatus().modules.filter((m) => PAID.includes(m)).join(',') || '(none)', addons.join(',') || '(none)', `${label}: the plan screen lists the same`);
    }
  } else ok(true, '(the vendor private key is not on this computer, so the real-key unlock check is skipped)');

  // ============================================================================================================
  section('2 · a new code never silently switches a module off');
  wipe();
  const labPharm = licence(['lab', 'pharmacy']);
  ok(activateLicense(labPharm, PUB).ok, 'a clinic is activated with Laboratory + Pharmacy');
  const pharmOnly = licence(['pharmacy']);                                   // an upgrade code made by mistake WITHOUT Laboratory
  const warn = activateLicense(pharmOnly, PUB);
  ok(!warn.ok && warn.needsConfirm === true && warn.removed?.join() === 'lab', 'a Pharmacy-only code is held back and says it would remove Laboratory');
  ok(/Laboratory/.test(warn.error || '') && /ask us for an upgrade code/i.test(warn.error || ''), `…in plain words (${(warn.error || '').slice(0, 85)}…)`);
  eq(installed(), labPharm, '…and nothing changed: the clinic still has the Laboratory + Pharmacy licence');
  const confirmed = activateLicense(pharmOnly, PUB, { confirmRemoval: true });
  ok(confirmed.ok && installed() === pharmOnly, 'only after the person confirms is the smaller licence applied');
  const up = licence(['pharmacy', 'ipd']);                                   // a real upgrade: keeps Pharmacy, adds IPD
  ok(activateLicense(up, PUB).ok, 'an upgrade that keeps everything and adds a module goes straight through');
  ok(activateLicense(licence(['pharmacy', 'ipd']), PUB).ok, 'a renewal with the same modules goes straight through');
  const bigger = licence(['lab', 'pharmacy', 'ipd', 'whatsapp', 'whatsapp_pro']);
  ok(activateLicense(bigger, PUB).ok, 'a bigger plan goes straight through');
  const basic = activateLicense(licence(['lab', 'pharmacy', 'ipd', 'whatsapp']), PUB);
  ok(!basic.ok && basic.needsConfirm && basic.removed?.join() === 'whatsapp_pro', 'dropping WhatsApp Pro to Basic is also held back for confirmation');
  eq(installed(), bigger, '…and nothing changed');
  const other = activateLicense(licence(['lab'], crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), PUB);
  ok(!other.ok && !other.needsConfirm, 'a code signed by anyone else is refused outright (no confirmation offered)');
  ok(!!verifyTokenStrict(bigger, PUB), '(control: the bigger plan is a genuine code)');

  // ============================================================================================================
  section('3 · the keygen\'s Upgrade only ever adds (the real keygen, run on a throw-away data folder)');
  const nodeOk = await new Promise<boolean>((res) => { const c = spawn('node', ['--version']); c.on('error', () => res(false)); c.on('exit', (code) => res(code === 0)); });
  if (fs.existsSync(realKey) && nodeOk) {
    const tmp = fs.mkdtempSync(path.join(userData, 'kg-'));
    fs.copyFileSync(path.join(root, 'tools', 'keygen-server.mjs'), path.join(tmp, 'keygen-server.mjs'));
    const PORT = String(4700 + Math.floor(Math.random() * 200));
    const kg = spawn('node', [path.join(tmp, 'keygen-server.mjs')], { cwd: root, env: { ...process.env, PORT, ELECTRON_RUN_AS_NODE: '' }, stdio: 'ignore' });
    try {
      const B = `http://127.0.0.1:${PORT}`;
      for (let i = 0; i < 50; i++) { try { await fetch(B + '/'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
      const post = async (p: string, body: any) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as any;
      const addons = (code: string) => (JSON.parse(JSON.parse(Buffer.from(code, 'base64').toString('utf8')).p).modules as string[]).filter((m) => !BASE.includes(m)).sort().join(',') || '(none)';
      const form = { clinic: 'Keygen Test', customer: 'Dr K', machineId: 'b'.repeat(32), days: '365', phone: '', email: '', place: '', gstin: '', amount: '', pay_mode: 'UPI' };
      const first = await post('/generate', { ...form, lab: true, pharmacy: false, ipd: false, wa: '' });
      eq(addons(first.code), 'lab', 'a new code with only Laboratory ticked contains only Laboratory');
      const upg = await post('/upgrade', { ...form, id: first.id, lab: false, pharmacy: true, ipd: false, wa: '' });   // Laboratory carelessly UNticked
      ok(upg.ok, 'the upgrade is made');
      eq(addons(upg.code), 'lab,pharmacy', 'ticking Pharmacy (and leaving Laboratory unticked) gives Laboratory + Pharmacy — Laboratory is kept, Pharmacy added, IPD never appears');
      eq(upg.delta, 1999, 'the clinic is charged only for what was added (₹1,999)');
      const nothing = await post('/upgrade', { ...form, id: upg.id, lab: true, pharmacy: true, ipd: false, wa: '' });
      ok(!nothing.ok && /No new modules/i.test(nothing.error || ''), 'an "upgrade" that adds nothing is refused');
      const html = await (await fetch(B + '/')).text();
      ok(html.includes('id="unlocks"') && html.includes('This code unlocks only:'), 'the keygen shows what the signed code unlocks, read back from the code itself');
    } finally { kg.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  } else ok(true, '(the real keygen check is skipped here: it needs the vendor private key and node on this computer)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
