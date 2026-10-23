// A licence key (and a password-reset code) must be accepted ONLY when it is exactly what the keygen issued — nothing added,
// nothing missing. Node's base64 reader used to skip stray characters and stop at the "=" padding, so a key with anything typed after
// it, or symbols dropped into it, or its last characters deleted, still passed. This suite fuzzes real-format codes and fails if any
// edited code is ever accepted again. It signs with a throw-away key (the private key never needs to be present); when the real
// private key IS on this machine it also proves the real keygen format is read by the strict reader.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { boot, stubState, userData } from './harness';
import { activateLicense, verifyToken, verifyTokenStrict, machineFingerprint } from '../../src/main/licensing/license';
import { verifyResetCode } from '../../src/main/licensing/passwordReset';
import { decodeBase64Strict, readSignedCodeStrict } from '../../src/main/licensing/envelope';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');

// ---- a code in EXACTLY the keygen's format (tools/license-gen.mjs, tools/keygen-server.mjs, server/activation-server.mjs)
const mint = (payload: object, privateKeyPem: string) => {
  const pStr = JSON.stringify(payload);
  const s = crypto.sign(null, Buffer.from(pStr, 'utf8'), privateKeyPem).toString('base64');
  return Buffer.from(JSON.stringify({ p: pStr, s })).toString('base64');
};
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const hw = machineFingerprint();
const licence = (id: string, extra: Record<string, any> = {}) => mint({
  v: 1, license_id: id, clinic: 'Strict Clinic', customer: '', edition: 'custom', modules: ['reception', 'opd', 'pharmacy'],
  issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), hardware_id: hw,
  contact: { phone: '8073935006', email: 'mulgundsunil@gmail.com' }, ...extra,
}, PRIV);

// ---- the same kinds of edits a person might try
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SYMBOLS = ' !@#$%^&*()[]{};:,.<>?~`|\\\t\n"\'';
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = (s: string) => s[rnd(s.length)];
const insertAt = (t: string, at: number, c: string) => t.slice(0, at) + c + t.slice(at);
const deleteAt = (t: string, at: number, n = 1) => t.slice(0, at) + t.slice(at + n);
const N = 300;
const edits = (token: string): Record<string, () => string> => ({
  'letters/digits typed after the code': () => token + Array.from({ length: 1 + rnd(10) }, () => pick(ALNUM)).join(''),
  'symbols or spaces typed after the code': () => token + Array.from({ length: 1 + rnd(10) }, () => pick(SYMBOLS.replace(/[\t\n ]/g, ''))).join(''),
  'a word after a line break': () => token + '\n' + Array.from({ length: 3 + rnd(8) }, () => pick(ALNUM)).join(''),
  'letters/digits added in the middle': () => { let t = token; for (let i = 0, k = 1 + rnd(3); i < k; i++) t = insertAt(t, rnd(t.length), pick(ALNUM)); return t; },
  'symbols or spaces added in the middle': () => { let t = token; for (let i = 0, k = 1 + rnd(3); i < k; i++) t = insertAt(t, rnd(t.length), pick(SYMBOLS)); return t; },
  'characters deleted from the middle': () => { let t = token; for (let i = 0, k = 1 + rnd(3); i < k; i++) t = deleteAt(t, rnd(t.length)); return t; },
  'the last 1-4 characters deleted': () => token.slice(0, token.length - (1 + rnd(4))),
  'the first 1-4 characters deleted': () => token.slice(1 + rnd(4)),
  'one character changed': () => { const at = rnd(token.length); let c = pick(ALNUM); while (c === token[at]) c = pick(ALNUM); return token.slice(0, at) + c + token.slice(at + 1); },
  'the code written twice': () => token + token,
  'cut in half': () => token.slice(0, Math.floor(token.length / 2)),
});

(async () => {
  stubState.isPackaged = true;                         // behave like an installed clinic PC (single-use ledger, no unbound licences)
  const good = licence('LIC-STRICT01');

  // ============================================================================================================
  section('1 · the exact code is accepted — and so is one with a stray newline or space around the whole code');
  ok(!!verifyTokenStrict(good, PUB), 'the exact code as the keygen issued it is accepted');
  ok(!!verifyTokenStrict(`\n  ${good}\r\n`, PUB), 'a newline / spaces BEFORE or AFTER the whole code (what a copy often brings) are fine');
  eq(verifyTokenStrict(good, PUB)?.clinic, 'Strict Clinic', 'it reads the signed licence');
  ok(!!readSignedCodeStrict(good) && decodeBase64Strict(good) !== null, 'the reader recognises the keygen format');

  // ============================================================================================================
  section('2 · any other edit is refused (random edits, every kind, ' + N + ' tries each)');
  for (const [what, make] of Object.entries(edits(good))) {
    let accepted = 0, example = '';
    for (let i = 0; i < N; i++) { const t = make(); if (t.trim() !== good && verifyTokenStrict(t, PUB)) { accepted++; example = JSON.stringify(t.slice(-20)); } }
    eq(accepted, 0, `${what}: none accepted${accepted ? ` (e.g. …${example})` : ''}`);
  }
  for (const [what, t] of [['nothing', ''], ['spaces only', '    '], ['plain words', 'hello world'], ['a different base64 text', Buffer.from('{"hello":"world"}').toString('base64')],
    ['valid base64 with no signature', Buffer.from(JSON.stringify({ p: '{}', s: '' })).toString('base64')], ['a short Machine-ID-like text', hw]] as [string, string][]) {
    ok(!verifyTokenStrict(t, PUB), `${what}: refused`);
  }
  const forged = mint({ v: 1, license_id: 'LIC-FORGED', clinic: 'Forger', modules: ['reception', 'opd', 'pharmacy', 'ipd', 'lab'], issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 9e10).toISOString(), hardware_id: hw },
    crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  ok(!verifyTokenStrict(forged, PUB), 'a code signed with any OTHER key is refused (it cannot be forged)');

  // ============================================================================================================
  section('3 · activating: an edited code changes nothing on the computer');
  const licFile = path.join(userData, 'license.dat');
  const edited = good + 'xyz';
  const bad = activateLicense(edited, PUB);
  ok(!bad.ok && /exactly the code we sent/i.test(bad.error || ''), `the screen says what is wrong in plain words (${(bad.error || '').slice(0, 70)}…)`);
  ok(!fs.existsSync(licFile), '…and nothing was saved');
  for (const [what, make] of Object.entries(edits(good))) {
    let saved = 0;
    for (let i = 0; i < 40; i++) { const t = make(); if (t.trim() !== good && activateLicense(t, PUB).ok) saved++; }
    eq(saved, 0, `activation refuses: ${what}`);
  }
  ok(!fs.existsSync(licFile), 'after all those edited codes still nothing was saved');
  const fine = activateLicense(`  ${good}\n`, PUB);
  ok(fine.ok, 'the exact code activates');
  eq(fs.readFileSync(licFile, 'utf8'), good, '…and exactly that code is what is stored');
  const again = activateLicense(good, PUB);
  ok(!again.ok && /already been used/i.test(again.error || ''), 'the same key cannot be applied twice on this computer (one key, one activation)');
  const other = activateLicense(licence('LIC-STRICT02', { hardware_id: 'f'.repeat(32) }), PUB);
  ok(!other.ok && /different computer/i.test(other.error || ''), 'a key made for another computer is still refused');
  const unbound = activateLicense(licence('LIC-STRICT03', { hardware_id: '' }), PUB);
  ok(!unbound.ok && /not locked to a computer/i.test(unbound.error || ''), 'a key not locked to a computer is still refused on an installed app');

  // ============================================================================================================
  section('4 · a clinic that is already activated is never locked out');
  const legacy = good + '.';                           // an older version saved whatever was pasted, trailing full stop and all
  ok(!!verifyToken(legacy, PUB), 'a licence ALREADY stored with stray characters after it still verifies at start-up (its signature still proves it)');
  ok(!verifyTokenStrict(legacy, PUB), '…while pasting that same text into the activation box now is refused');

  // ============================================================================================================
  section('5 · the password-reset code is just as strict');
  const reset = (extra: Record<string, any> = {}) => mint({ t: 'pwreset', hardware_id: hw, exp: Date.now() + 3_600_000, n: 'abc12345', ...extra }, PRIV);
  const rc = reset();
  ok(verifyResetCode(rc, PUB).ok, 'the exact reset code works');
  ok(verifyResetCode(`  ${rc}\n`, PUB).ok, '…also with a newline or spaces around the whole code');
  for (const [what, make] of Object.entries(edits(rc))) {
    let accepted = 0;
    for (let i = 0; i < 100; i++) { const t = make(); if (t.trim() !== rc && verifyResetCode(t, PUB).ok) accepted++; }
    eq(accepted, 0, `reset code: ${what}: none accepted`);
  }
  const msg = verifyResetCode(rc + 'oops', PUB);
  ok(!msg.ok && /extra, missing or changed characters/i.test((msg as any).error), 'an edited reset code says so in plain words');
  ok(!verifyResetCode(reset({ exp: Date.now() - 1000 }), PUB).ok, 'an expired reset code is still refused');
  ok(!verifyResetCode(reset({ hardware_id: 'e'.repeat(32) }), PUB).ok, 'a reset code for another computer is still refused');
  ok(!verifyResetCode(good, PUB).ok, 'a licence key is not accepted as a reset code');

  // ============================================================================================================
  section('6 · the real keygen\'s own output is read by the strict reader');
  const realKey = path.join(root, 'license-keys', 'private.pem');
  if (fs.existsSync(realKey)) {
    const real = mint({ v: 1, license_id: 'LIC-REAL-TEST', clinic: 'Real Key Test', modules: ['reception', 'opd'], issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), hardware_id: hw }, fs.readFileSync(realKey, 'utf8'));
    ok(!!verifyTokenStrict(real), 'a code signed with the real vendor key is accepted with the key built into the app');
    let accepted = 0;
    for (const make of Object.values(edits(real))) for (let i = 0; i < 100; i++) { const t = make(); if (t.trim() !== real && verifyTokenStrict(t)) accepted++; }
    eq(accepted, 0, 'and 1,100 random edits of it are all refused');
  } else {
    ok(true, '(the vendor private key is not on this computer, so the real-key check is skipped)');
  }

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
