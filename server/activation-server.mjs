// CureDesk HMS — online activation server (Phase 2).
//
// Turns the manual offline flow (run tools/license-gen.mjs, email a token) into a
// self-service one: you issue short activation CODES; the clinic types a code into
// the app; this server signs a machine-bound licence on the spot and returns it.
//
// Zero dependencies (Node built-ins only). Tokens are byte-identical to
// tools/license-gen.mjs, so the app's verifyToken() accepts them unchanged.
//
// The Ed25519 PRIVATE KEY lives ONLY here (as a secret/env). If this box is ever
// compromised the blast radius is licensing only — NO patient data touches this
// server. Rotate the key + ship an app update with a new public key to recover.
//
// ── Run locally ────────────────────────────────────────────────────────────
//   ADMIN_TOKEN=dev-admin \
//   LICENSE_PRIVATE_KEY_FILE=./license-keys/private.pem \
//   node server/activation-server.mjs
//
// ── Endpoints ──────────────────────────────────────────────────────────────
//   GET  /health                       → liveness
//   POST /activate      {code,machineId}                    (public, rate-limited)
//   POST /admin/issue   {clinic,modules,days,count?,...}    (Bearer ADMIN_TOKEN)
//   GET  /admin/codes                                       (Bearer ADMIN_TOKEN)
//   POST /admin/revoke  {code}                              (Bearer ADMIN_TOKEN)
import { createServer } from 'node:http';
import { sign, randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Config ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8787', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_FILE = process.env.DATA_FILE || './server/data/codes.json';
const DEFAULT_CONTACT = {
  phone: process.env.CONTACT_PHONE || '8073935006',
  email: process.env.CONTACT_EMAIL || 'mulgundsunil@gmail.com',
};
const ALL_MODULES = ['reception', 'opd', 'pharmacy', 'ipd', 'lab', 'peds', 'whatsapp', 'whatsapp_pro', 'analytics'];

const PRIVATE_KEY = (() => {
  if (process.env.LICENSE_PRIVATE_KEY) return process.env.LICENSE_PRIVATE_KEY;
  const f = process.env.LICENSE_PRIVATE_KEY_FILE || './license-keys/private.pem';
  try { return readFileSync(f, 'utf8'); }
  catch { console.error(`FATAL: no private key (set LICENSE_PRIVATE_KEY or LICENSE_PRIVATE_KEY_FILE; tried ${f})`); process.exit(1); }
})();
if (!ADMIN_TOKEN) { console.error('FATAL: set ADMIN_TOKEN (protects the code-issuing endpoints).'); process.exit(1); }

// ── Tiny JSON-file store (atomic writes) ──────────────────────────────────
let DB = { codes: {} };
function load() {
  try { DB = JSON.parse(readFileSync(DATA_FILE, 'utf8')); if (!DB.codes) DB.codes = {}; }
  catch { DB = { codes: {} }; }
}
function persist() {
  const dir = dirname(DATA_FILE);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(DB, null, 2));
  renameSync(tmp, DATA_FILE);      // atomic swap — never leaves a half-written file
}
load();

// ── Licence signing — identical format to tools/license-gen.mjs ───────────
function signLicence({ clinic, customer, edition, modules, days, machineId, contact }) {
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  const payload = {
    v: 1, license_id: 'LIC-' + randomUUID().slice(0, 8).toUpperCase(),
    clinic, customer: customer || '', edition: edition || 'custom', modules,
    issued_at: now.toISOString(), expires_at: expires.toISOString(),
    hardware_id: machineId,
    contact: { ...DEFAULT_CONTACT, ...(contact || {}) },
  };
  const pStr = JSON.stringify(payload);
  const s = sign(null, Buffer.from(pStr, 'utf8'), PRIVATE_KEY).toString('base64');
  const token = Buffer.from(JSON.stringify({ p: pStr, s })).toString('base64');
  return { token, expires_at: payload.expires_at, license_id: payload.license_id };
}

// Human-friendly code: CURE-XXXX-XXXX-XXXX (no 0/O/1/I to avoid mistyping).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const grp = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `CURE-${grp()}-${grp()}-${grp()}`;
}
const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

// ── HTTP helpers ──────────────────────────────────────────────────────────
const send = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
};
function bearerOk(req) {
  const h = req.headers['authorization'] || '';
  const got = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = Buffer.from(got), b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''; let tooBig = false;
    req.on('data', (c) => { data += c; if (data.length > 1e5) { tooBig = true; req.destroy(); } });
    req.on('end', () => { if (tooBig) return resolve(null); try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// Basic per-IP rate limit on /activate (brute-force defence on codes).
const hits = new Map();
function activateRateOk(ip) {
  const now = Date.now(); const win = 60_000; const max = 20;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length <= max;
}

// ── Router ────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  if (req.method === 'GET' && url.pathname === '/health')
    return send(res, 200, { ok: true, service: 'curedesk-activation', codes: Object.keys(DB.codes).length });

  // ── Public: activate ────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/activate') {
    if (!activateRateOk(ip)) return send(res, 429, { ok: false, error: 'Too many attempts. Try again in a minute.' });
    const body = await readBody(req);
    if (!body) return send(res, 400, { ok: false, error: 'Bad request.' });
    const code = normCode(body.code);
    const machineId = String(body.machineId || '').trim();
    if (!code) return send(res, 400, { ok: false, error: 'Enter your activation code.' });
    if (!machineId) return send(res, 400, { ok: false, error: 'Missing machine ID.' });

    const rec = DB.codes[code];
    if (!rec || rec.status === 'revoked') return send(res, 404, { ok: false, error: 'Invalid or revoked activation code.' });

    // Already activated: same machine → re-hand the same licence (reinstall-safe);
    // different machine → refuse (one licence per computer).
    if (rec.status === 'activated') {
      if (rec.machineId === machineId) return send(res, 200, { ok: true, token: rec.token, reused: true, expires_at: rec.expires_at });
      return send(res, 409, { ok: false, error: 'This licence is already active on another computer. Contact support to move it.' });
    }

    // First activation — sign a machine-bound licence now.
    const signed = signLicence({
      clinic: rec.clinic, customer: rec.customer, edition: rec.edition,
      modules: rec.modules, days: rec.days, machineId, contact: rec.contact,
    });
    rec.status = 'activated'; rec.machineId = machineId; rec.token = signed.token;
    rec.expires_at = signed.expires_at; rec.license_id = signed.license_id; rec.activatedAt = new Date().toISOString();
    persist();
    return send(res, 200, { ok: true, token: signed.token, expires_at: signed.expires_at });
  }

  // ── Admin: issue codes ──────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/admin/issue') {
    if (!bearerOk(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body) return send(res, 400, { ok: false, error: 'Bad request.' });
    const clinic = String(body.clinic || '').trim();
    if (!clinic) return send(res, 400, { ok: false, error: '"clinic" is required.' });
    const modules = (Array.isArray(body.modules) ? body.modules : String(body.modules || '').split(','))
      .map((s) => String(s).trim()).filter(Boolean);
    const bad = modules.filter((m) => !ALL_MODULES.includes(m));
    if (bad.length) return send(res, 400, { ok: false, error: `Unknown module(s): ${bad.join(', ')}. Valid: ${ALL_MODULES.join(', ')}` });
    const days = Math.max(1, parseInt(body.days || 365, 10) || 365);
    const count = Math.min(500, Math.max(1, parseInt(body.count || 1, 10) || 1));
    const contact = {};
    if (body.phone) contact.phone = String(body.phone);
    if (body.email) contact.email = String(body.email);

    const issued = [];
    for (let i = 0; i < count; i++) {
      let code; do { code = newCode(); } while (DB.codes[code]);
      DB.codes[code] = {
        code, clinic, customer: String(body.customer || ''), edition: String(body.edition || 'custom'),
        modules, days, contact, status: 'unused', machineId: null, token: null,
        createdAt: new Date().toISOString(),
      };
      issued.push(code);
    }
    persist();
    return send(res, 200, { ok: true, clinic, modules, days, codes: issued });
  }

  // ── Admin: list codes ───────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/admin/codes') {
    if (!bearerOk(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });
    const list = Object.values(DB.codes).map((r) => ({
      code: r.code, clinic: r.clinic, customer: r.customer, modules: r.modules, days: r.days,
      status: r.status, machineId: r.machineId, expires_at: r.expires_at || null,
      createdAt: r.createdAt, activatedAt: r.activatedAt || null,
    })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return send(res, 200, { ok: true, count: list.length, codes: list });
  }

  // ── Admin: revoke ───────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/admin/revoke') {
    if (!bearerOk(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });
    const body = await readBody(req);
    const code = normCode(body && body.code);
    const rec = DB.codes[code];
    if (!rec) return send(res, 404, { ok: false, error: 'Code not found.' });
    rec.status = 'revoked'; persist();
    return send(res, 200, { ok: true, code, status: 'revoked' });
  }

  return send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CureDesk activation server on :${PORT}  ·  ${Object.keys(DB.codes).length} code(s) loaded  ·  store=${DATA_FILE}`);
});
