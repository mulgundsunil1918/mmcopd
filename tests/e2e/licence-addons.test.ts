// Module (add-on) codes: each paid module can have its OWN signed code, stored apart from the main licence.
// Rules proved here, on the app's real licence engine and handlers (signed with a throw-away key; the real vendor key / the real keygen when they are on this machine):
//   - a module code ADDS: the main licence is not touched, every other module stays, and what the clinic can use is the main licence + every valid module code;
//   - it must be genuine, locked to THIS computer, unused, and there must be a main licence to add to — otherwise it is refused in plain words;
//   - each module code has its own expiry: renewing one replaces only it; one that expired long ago stops unlocking its module (the rest keeps working);
//   - an OLDER version of the app can never mistake a module code for a code that replaces the licence (it refuses it);
//   - replacing the main licence (a renewal) never switches off a module that a module code gives;
//   - the keygen issues them: one code per module, each with its own expiry, kept in the clinic's record.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { boot, stubState, userData } from './harness';
import { ADDON_PREFIX, activateLicense, getLicenseStatus, machineFingerprint, verifyAddonToken, verifyToken, verifyTokenStrict } from '../../src/main/licensing/license';
import { isModuleLicensed } from '../../src/main/licensing/enforce';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const BASE = ['reception', 'opd', 'peds', 'analytics'];
const hw = machineFingerprint();
const DAY = 86_400_000;
const eph = crypto.generateKeyPairSync('ed25519');
const PUB = eph.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = eph.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const mintText = (text: string, priv: string = PRIV) =>
  Buffer.from(JSON.stringify({ p: text, s: crypto.sign(null, Buffer.from(text, 'utf8'), priv).toString('base64') })).toString('base64');
let n = 0;
const body = (id: string, modules: string[], days: number, extra: object = {}) => ({
  v: 1, license_id: id, clinic: 'Add-on Clinic', customer: '', edition: 'custom', modules,
  issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + days * DAY).toISOString(), hardware_id: hw,
  contact: { phone: '8073935006', email: 'mulgundsunil@gmail.com' }, ...extra,
});
/** The main licence (no paid module unless asked). */
const main = (paid: string[] = [], days = 365, priv: string = PRIV) => mintText(JSON.stringify(body(`LIC-MAIN${String(++n).padStart(3, '0')}`, [...BASE, ...paid], days)), priv);
/** A module code: signed over the add-on prefix + the licence JSON. */
const addon = (modules: string[], days = 365, extra: object = {}, priv: string = PRIV) =>
  mintText(ADDON_PREFIX + JSON.stringify(body(`ADD-${String(++n).padStart(4, '0')}`, modules, days, extra)), priv);
const wipe = () => { for (const f of ['license.dat', 'license-addons.dat', '.used_licenses', '.license_meta']) fs.rmSync(path.join(userData, f), { force: true }); };
const paidOf = (mods: string[]) => mods.filter((m) => !BASE.includes(m)).sort().join(',') || '(none)';
const mainFile = () => { try { return fs.readFileSync(path.join(userData, 'license.dat'), 'utf8'); } catch { return ''; } };

(async () => {
  stubState.isPackaged = true;

  // ============================================================================================================
  section('1 · a module code adds to the main licence; nothing else moves');
  wipe();
  const m1 = main();
  ok(activateLicense(m1, PUB).ok, 'the clinic starts with a main licence and no paid module');
  eq(paidOf(getLicenseStatus(PUB).modules), '(none)', '…so no paid module is unlocked yet');
  const pharm = addon(['pharmacy']);
  const r1 = activateLicense(pharm, PUB);
  ok(r1.ok && r1.addon?.modules.join() === 'pharmacy', `a Pharmacy module code is accepted (${r1.error || 'ok'})`);
  eq(mainFile(), m1, '…the main licence file is exactly as it was');
  const st1 = getLicenseStatus(PUB);
  eq(paidOf(st1.modules), 'pharmacy', 'the clinic can now use Pharmacy — and only Pharmacy');
  ok(st1.addons.length === 1 && st1.addons[0].state === 'valid' && st1.addons[0].modules.join() === 'pharmacy' && st1.addons[0].daysLeft >= 364, 'the status lists the module code with its own expiry');
  ok(BASE.every((m) => st1.modules.includes(m)), '…and the base plan is there');
  const lab = addon(['lab']);
  ok(activateLicense(lab, PUB).ok, 'a Laboratory code is added later');
  const st2 = getLicenseStatus(PUB);
  eq(paidOf(st2.modules), 'lab,pharmacy', 'now both are unlocked: each module is its own layer');
  eq(st2.addons.length, 2, '…each with its own code');
  eq(new Set(st2.modules).size, st2.modules.length, 'no module is listed twice');
  const pro = addon(['whatsapp', 'whatsapp_pro']);
  ok(activateLicense(pro, PUB).ok && paidOf(getLicenseStatus(PUB).modules) === 'lab,pharmacy,whatsapp,whatsapp_pro', 'WhatsApp Pro (which carries Basic) is another code');
  ok(getLicenseStatus(PUB).readOnly === false && getLicenseStatus(PUB).state === 'valid', 'the clinic is not read-only: only the main licence decides that');

  // ============================================================================================================
  section('2 · what is refused, in plain words');
  wipe();
  const bare = activateLicense(addon(['pharmacy']), PUB);
  ok(!bare.ok && /Activate your main licence first/.test(bare.error || ''), `with no main licence a module code cannot start the software ("${(bare.error || '').slice(0, 60)}…")`);
  ok(activateLicense(main(), PUB).ok, '(a main licence is installed)');
  const code = addon(['pharmacy']);
  ok(activateLicense(code, PUB).ok, 'a module code is accepted once');
  const again = activateLicense(code, PUB);
  ok(!again.ok && /already been used/.test(again.error || ''), 'the same code cannot be used twice');
  const other = activateLicense(addon(['lab'], 365, { hardware_id: 'f'.repeat(32) }), PUB);
  ok(!other.ok && /different computer/.test(other.error || ''), 'a code made for another computer is refused');
  const loose = activateLicense(addon(['lab'], 365, { hardware_id: '' }), PUB);
  ok(!loose.ok && /not locked to a computer/.test(loose.error || ''), 'a code that is not locked to a computer is refused');
  const old = activateLicense(addon(['lab'], -30), PUB);
  ok(!old.ok && /already expired/.test(old.error || ''), 'a code that expired long ago is refused');
  const empty = activateLicense(addon([]), PUB);
  ok(!empty.ok && /does not contain any module/.test(empty.error || ''), 'a code with no module is refused');
  const forged = activateLicense(addon(['ipd'], 365, {}, crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), PUB);
  ok(!forged.ok && /Invalid licence code/.test(forged.error || ''), 'a code signed by anyone else is refused');
  const edited = activateLicense(addon(['lab']) + 'A', PUB);
  ok(!edited.ok, 'a code with anything added to it is refused (it must be exactly what the keygen issued)');
  eq(paidOf(getLicenseStatus(PUB).modules), 'pharmacy', '…and through all that, only the one good code is in effect');

  // ============================================================================================================
  section('3 · an older version of the app refuses a module code (it can never replace the licence by mistake)');
  const sample = addon(['pharmacy']);
  eq(verifyTokenStrict(sample, PUB), null, 'the code that ACTIVATES a main licence does not accept it');
  eq(verifyToken(sample, PUB), null, '…nor does the reader of an installed main licence');
  ok(verifyAddonToken(sample, PUB)?.modules.join() === 'pharmacy', '(this version reads it as a module code)');
  const asMain = Buffer.from(JSON.stringify({ p: JSON.stringify(body('LIC-FAKE', ['pharmacy'], 30)), s: 'AAAA' })).toString('base64');
  eq(verifyAddonToken(asMain, PUB), null, '…and a main licence is not a module code');

  // ============================================================================================================
  section('4 · renewing one module replaces only that module\'s code');
  wipe();
  activateLicense(main(), PUB);
  activateLicense(addon(['pharmacy'], 30), PUB);
  activateLicense(addon(['lab'], 400), PUB);
  const short = getLicenseStatus(PUB).addons.find((a) => a.modules.includes('pharmacy'))!;
  ok(short.daysLeft <= 30, 'Pharmacy is on a 30-day code');
  await new Promise((r) => setTimeout(r, 15));                                // the renewal is issued a moment later
  ok(activateLicense(addon(['pharmacy'], 365), PUB).ok, 'a renewal code for Pharmacy is applied');
  const st4 = getLicenseStatus(PUB);
  eq(st4.addons.length, 2, 'there are still two module codes — the old Pharmacy one was replaced, not kept beside it');
  ok(st4.addons.find((a) => a.modules.includes('pharmacy'))!.daysLeft >= 364, '…Pharmacy now has the longer expiry');
  ok(st4.addons.find((a) => a.modules.includes('lab'))!.daysLeft >= 399, '…and Laboratory\'s code is untouched');
  eq(paidOf(st4.modules), 'lab,pharmacy', 'both are still unlocked');

  // ============================================================================================================
  section('5 · each module code has its own expiry');
  wipe();
  activateLicense(main([], 365), PUB);
  activateLicense(addon(['pharmacy'], 365), PUB);
  // a Laboratory code that expires in a day, then time passes: hand-write the file the way a real one would age
  const soon = addon(['lab'], 1);
  activateLicense(soon, PUB);
  eq(paidOf(getLicenseStatus(PUB).modules), 'lab,pharmacy', 'a code with a day left unlocks its module');
  const aged = (daysAgo: number) => addon(['lab'], -daysAgo, { issued_at: new Date(Date.now() - (daysAgo + 30) * DAY).toISOString() });
  const put = (tokens: string[]) => fs.writeFileSync(path.join(userData, 'license-addons.dat'), JSON.stringify({ tokens }));
  const keepPharm = JSON.parse(fs.readFileSync(path.join(userData, 'license-addons.dat'), 'utf8')).tokens.find((t: string) => verifyAddonToken(t, PUB)?.modules.includes('pharmacy'));
  put([keepPharm, aged(3)]);
  const g = getLicenseStatus(PUB);
  ok(g.addons.find((a) => a.modules.includes('lab'))!.state === 'grace' && paidOf(g.modules) === 'lab,pharmacy', 'three days past its expiry a module is still in its 7-day grace');
  const gl = g.addons.find((a) => a.modules.includes('lab'))!.graceDaysLeft;
  ok(gl >= 3 && gl <= 4, `…and the screen is told how many grace days are left (${gl}) so it can say so`);
  eq(g.addons.find((a) => a.modules.includes('pharmacy'))!.graceDaysLeft, 0, 'a code that is still valid has no grace days to report');
  put([keepPharm, aged(20)]);
  const x = getLicenseStatus(PUB);
  ok(x.addons.find((a) => a.modules.includes('lab'))!.state === 'expired' && x.addons.find((a) => a.modules.includes('lab'))!.graceDaysLeft === 0, 'twenty days past, it is expired (no grace left)…');
  eq(paidOf(x.modules), 'pharmacy', '…its module is no longer unlocked, but Pharmacy and the whole main licence carry on');
  ok(x.state === 'valid' && !x.readOnly, '…and the software is not read-only');
  put([keepPharm, 'not-a-code', Buffer.from('{"p":"x","s":"y"}').toString('base64')]);
  eq(paidOf(getLicenseStatus(PUB).modules), 'pharmacy', 'garbage in the module-codes file is ignored, never a crash');
  fs.writeFileSync(path.join(userData, 'license-addons.dat'), '{{{ broken');
  eq(paidOf(getLicenseStatus(PUB).modules), '(none)', 'a damaged file simply means no module codes (the main licence is unaffected)');

  // ============================================================================================================
  section('6 · replacing the main licence never switches off a module a module code gives');
  wipe();
  activateLicense(main(['pharmacy']), PUB);                                   // a legacy-style main licence that carries Pharmacy
  activateLicense(addon(['lab']), PUB);
  const bareMain = activateLicense(main(), PUB);                              // a renewal without Pharmacy: that WOULD lose Pharmacy
  ok(!bareMain.ok && bareMain.needsConfirm && bareMain.removed?.join() === 'pharmacy', 'a renewal that would drop Pharmacy is still held back for confirmation');
  const labFine = activateLicense(main(['pharmacy']), PUB);
  ok(labFine.ok, 'a renewal that keeps Pharmacy goes through');
  eq(paidOf(getLicenseStatus(PUB).modules), 'lab,pharmacy', 'and the Laboratory module code is still in effect after the main licence was replaced');
  wipe();
  activateLicense(main(['lab']), PUB);
  activateLicense(addon(['lab']), PUB);                                       // Laboratory is now ALSO given by a module code
  ok(activateLicense(main(), PUB).ok, 'a new main licence without Laboratory goes straight through when a module code still gives Laboratory (nothing is lost)');
  eq(paidOf(getLicenseStatus(PUB).modules), 'lab', '…and Laboratory is still unlocked');

  // ============================================================================================================
  section('7 · the real vendor key (when it is on this computer): the app unlocks exactly the module written in the code');
  const realKey = path.join(root, 'license-keys', 'private.pem');
  if (fs.existsSync(realKey)) {
    const REAL = fs.readFileSync(realKey, 'utf8');
    wipe();
    ok(activateLicense(main([], 365, REAL)).ok, 'a main licence signed by the vendor key activates');
    ok(!isModuleLicensed('pharmacy') && !isModuleLicensed('lab'), 'no paid module is unlocked yet');
    ok(activateLicense(addon(['pharmacy'], 365, {}, REAL)).ok, 'a Pharmacy module code signed by the vendor key activates');
    ok(isModuleLicensed('pharmacy') && !isModuleLicensed('lab') && !isModuleLicensed('ipd'), 'the backend now allows Pharmacy writes — and still refuses Laboratory and IPD');
  } else ok(true, '(the vendor private key is not on this computer, so the real-key check is skipped)');

  // ============================================================================================================
  section('8 · the keygen issues module codes (the real keygen, run on a throw-away data folder)');
  const nodeOk = await new Promise<boolean>((res) => { const c = spawn('node', ['--version']); c.on('error', () => res(false)); c.on('exit', (code) => res(code === 0)); });
  if (fs.existsSync(realKey) && nodeOk) {
    const tmp = fs.mkdtempSync(path.join(userData, 'kg-'));
    fs.copyFileSync(path.join(root, 'tools', 'keygen-server.mjs'), path.join(tmp, 'keygen-server.mjs'));
    const PORT = String(4900 + Math.floor(Math.random() * 100));
    const kg = spawn('node', [path.join(tmp, 'keygen-server.mjs')], { cwd: root, env: { ...process.env, PORT, ELECTRON_RUN_AS_NODE: '', KEYGEN_NO_OPEN: '1' }, stdio: 'ignore' });
    try {
      const B = `http://127.0.0.1:${PORT}`;
      for (let i = 0; i < 50; i++) { try { await fetch(B + '/'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
      const post = async (p: string, b: any) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json() as any;
      const REAL = fs.readFileSync(realKey, 'utf8');
      const realPub = crypto.createPublicKey(REAL).export({ type: 'spki', format: 'pem' }).toString();
      const textOf = (c: string) => JSON.parse(Buffer.from(c, 'base64').toString('utf8')).p as string;
      const form = { clinic: 'Keygen Add-on', customer: 'Dr K', machineId: hw, days: '365', phone: '', email: '', place: '', gstin: '', amount: '', pay_mode: 'UPI' };
      const first = await post('/generate', { ...form, lab: false, pharmacy: false, ipd: false, wa: '' });
      ok(first.ok && !first.modules.some((m: string) => ['lab', 'pharmacy', 'ipd'].includes(m)), 'a base-only licence is issued');
      const two = await post('/addon', { id: first.id, modules: ['pharmacy', 'whatsapp_pro'], days: 120 });
      ok(two.ok && Array.isArray(two.codes) && two.codes.length === 2, `adding two modules gives TWO codes, one per module (${two.codes?.length})`);
      const byModule = Object.fromEntries((two.codes || []).map((c: any) => [c.module, c]));
      ok(!!byModule.pharmacy && !!byModule.whatsapp_pro, '…named Pharmacy and WhatsApp Pro');
      ok(textOf(byModule.pharmacy.code).startsWith(ADDON_PREFIX), 'each code is a module code (signed over the add-on line)');
      const pharmPayload = JSON.parse(textOf(byModule.pharmacy.code).slice(ADDON_PREFIX.length));
      ok(pharmPayload.modules.join() === 'pharmacy' && pharmPayload.hardware_id === hw && Math.round((Date.parse(pharmPayload.expires_at) - Date.parse(pharmPayload.issued_at)) / DAY) === 120, 'the Pharmacy code carries only Pharmacy, this computer and its own 120 days');
      const proPayload = JSON.parse(textOf(byModule.whatsapp_pro.code).slice(ADDON_PREFIX.length));
      eq(proPayload.modules.slice().sort().join(), 'whatsapp,whatsapp_pro', 'WhatsApp Pro carries WhatsApp Basic with it');
      eq(verifyTokenStrict(byModule.pharmacy.code, realPub), null, 'an older app refuses the code (it is not a main licence)');
      wipe();
      ok(activateLicense(first.code, realPub).ok && activateLicense(byModule.pharmacy.code, realPub).ok && activateLicense(byModule.whatsapp_pro.code, realPub).ok, 'the main licence and the two codes activate in this app, signed by the real key');
      eq(paidOf(getLicenseStatus(realPub).modules), 'pharmacy,whatsapp,whatsapp_pro', 'exactly what was issued is unlocked');
      const acc = (await (await fetch(B + '/accounts')).json() as any).issued.find((x: any) => x.id === first.id);
      ok(acc.addons?.length === 2 && acc.addons.every((a: any) => a.code && a.expires_at && a.id), 'the clinic\'s record keeps both codes with their own expiry');
      ok(acc.modules.every((m: string) => !['pharmacy', 'whatsapp', 'whatsapp_pro'].includes(m)), '…and the main licence\'s own module list is unchanged');
      ok(acc.history.some((h: any) => /Module code: Pharmacy/.test(h.note)), 'the history says which module codes were issued');
      const latestId = async () => ((await (await fetch(B + '/accounts')).json() as any).issued.find((x: any) => x.clinic === 'Keygen Add-on')).id as string;   // a main renewal / upgrade gives the record a new id
      const amountOf = async (id: string) => ((await (await fetch(B + '/accounts')).json() as any).issued.find((x: any) => x.id === id)).amount as number;
      eq(await amountOf(first.id), 8999 + 1999 + 1999, 'the record has collected the base plan + Pharmacy + WhatsApp Pro so far (₹12,997)');
      const renew = await post('/addon', { id: first.id, modules: ['pharmacy'], days: 365 });
      ok(renew.ok && renew.codes.length === 1, 'a renewal of one module is one new code');
      eq(renew.delta, 1999, 'renewing Pharmacy is money received: its price for another year (₹1,999)');
      eq(await amountOf(first.id), 12997 + 1999, '…and it is ADDED to the amount collected (₹14,996)');
      ok(JSON.stringify(renew.renewed) === '["pharmacy"]' && renew.added.length === 0, '…it was a renewal, not a new module');
      const acc2 = (await (await fetch(B + '/accounts')).json() as any).issued.find((x: any) => x.id === first.id);
      ok(acc2.addons.length === 2 && acc2.addons.find((a: any) => a.module === 'pharmacy').id === renew.codes[0].license_id, '…which replaces the old Pharmacy entry (still two records, Pharmacy now the new one)');
      const bad = await post('/addon', { id: first.id, modules: ['reception'], days: 30 });
      ok(!bad.ok && /module/i.test(bad.error || ''), 'a module that is not an add-on (the base plan) is refused');
      const none = await post('/addon', { id: first.id, modules: [], days: 30 });
      ok(!none.ok, 'no module ticked is refused');
      const unknown = await post('/addon', { id: 'LIC-NOPE', modules: ['lab'], days: 30 });
      ok(!unknown.ok, 'an unknown account is refused');
      const inv = await (await fetch(B + '/invoice?id=' + encodeURIComponent(first.id))).text();
      ok(/Pharmacy add-on/.test(inv) && /WhatsApp Pro add-on/.test(inv) && /Pharmacy module code valid until/.test(inv), 'the invoice lists the modules the clinic holds through module codes, with their end dates');
      ok(/Pharmacy add-on/.test(inv) && /Renewal — Pharmacy/.test(inv), '…and the renewal is a line of its own');
      ok(/Total \(incl\. GST\)<\/td><td class="r">₹14,996</.test(inv), '…and its total is the sum of its lines (base + Pharmacy + WhatsApp Pro + the Pharmacy renewal)');
      const free = await post('/addon', { id: first.id, modules: ['pharmacy'], days: 365, amount: '0' });
      eq(free.delta, 0, 'a renewal can be given free: type 0 and nothing is added');
      eq(await amountOf(first.id), 14996, '…the amount collected does not move');
      const disc = await post('/addon', { id: first.id, modules: ['pharmacy'], days: 365, amount: '1500' });
      eq(disc.delta, 1500, 'a renewal at a discount adds what was actually received');
      eq(await amountOf(first.id), 14996 + 1500, '…(₹1,500)');
      const mainRenew = await post('/renew', { id: first.id, days: 365 });
      ok(mainRenew.ok && mainRenew.charged === 8999, `renewing the main licence adds the plan price (₹8,999 for the base plan) — got ₹${mainRenew.charged}`);
      eq(await amountOf(mainRenew.id), 14996 + 1500 + 8999, '…to the amount collected');
      ok((await post('/renew', { id: await latestId(), days: 365, amount: '0' })).charged === 0, 'a free main renewal adds nothing');
      const inv2 = await (await fetch(B + '/invoice?id=' + encodeURIComponent(await latestId()))).text();
      const sumOf = (h: string) => [...h.matchAll(/<tr><td>([^<]*)<\/td><td class="r">₹([\d,]+)<\/td><\/tr>/g)].reduce((t, m) => t + Number(m[2].replace(/,/g, '')), 0);
      const invTotal = Number((inv2.match(/Total \(incl\. GST\)<\/td><td class="r">₹([\d,]+)</) || [])[1]?.replace(/,/g, ''));
      const invDiscount = Number(((inv2.match(/Discount<\/td><td class="r">- ₹([\d,]+)</) || [])[1] || '0').replace(/,/g, ''));
      ok(invTotal === 14996 + 1500 + 8999, `after renewals the invoice's total is the amount actually collected (₹${invTotal})`);
      eq(sumOf(inv2) - invDiscount, invTotal, `…and its lines (₹${sumOf(inv2)}) less the discount for the renewals charged below list (₹${invDiscount}) add up to that total`);
      const fresh = await post('/addon', { id: await latestId(), modules: ['lab'], days: 365 });
      ok(fresh.ok && fresh.delta === 999 && fresh.added.join() === 'lab' && fresh.renewed.length === 0, 'a module the clinic never had is charged as a new module (Laboratory ₹999), not as a renewal');
      // a clinic still on an older app gets ONE replacement code: what it already holds through module codes is not charged twice
      const legacy = await post('/upgrade', { id: await latestId(), lab: true, pharmacy: true, ipd: true, wa: 'pro' });
      ok(legacy.ok && legacy.delta === 4999, `the old-way replacement code charges only the NEW module (IPD ₹4,999; the rest is already held) — got ₹${legacy.delta}`);
      ok(['lab', 'pharmacy', 'ipd', 'whatsapp_pro'].every((m) => legacy.modules.includes(m)), '…and that code carries everything the clinic holds');
    } finally { kg.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  } else ok(true, '(the real keygen check is skipped here: it needs the vendor private key and node on this computer)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
