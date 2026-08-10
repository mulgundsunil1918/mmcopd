// Sign a customer licence with the vendor private key (license-keys/private.pem).
// Usage:
//   node tools/license-gen.mjs --clinic "Gadag Clinic" --hwid <machineId> \
//     --modules reception,opd,pharmacy,ipd,lab,peds,whatsapp,analytics \
//     --days 365 [--customer "Dr X"] [--edition full] [--phone ...] [--email ...] [--out clinic.lic]
import { readFileSync, writeFileSync } from 'node:fs';
import { sign, randomUUID } from 'node:crypto';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const priv = readFileSync('license-keys/private.pem', 'utf8');
const clinic = arg('clinic'); if (!clinic) { console.error('ERROR: --clinic required'); process.exit(1); }
const modules = (arg('modules', 'reception,opd') || '').split(',').map(s => s.trim()).filter(Boolean);
const days = parseInt(arg('days', '365'), 10);
const now = new Date(), expires = new Date(now.getTime() + days * 86400000);
const payload = {
  v: 1, license_id: 'LIC-' + randomUUID().slice(0, 8).toUpperCase(),
  clinic, customer: arg('customer', ''), edition: arg('edition', 'custom'), modules,
  issued_at: now.toISOString(), expires_at: expires.toISOString(),
  hardware_id: arg('hwid', ''),
  contact: { phone: arg('phone', '8073935006'), email: arg('email', 'mulgundsunil@gmail.com') },
};
const pStr = JSON.stringify(payload);
const s = sign(null, Buffer.from(pStr, 'utf8'), priv).toString('base64');
const token = Buffer.from(JSON.stringify({ p: pStr, s })).toString('base64');
const out = arg('out', '');
if (out) { writeFileSync(out, token); console.error('Wrote ' + out); }
console.error(`--- LICENCE · ${clinic} · expires ${expires.toISOString().slice(0,10)} · modules: ${modules.join(',') || '(none)'} · hwid: ${payload.hardware_id || '(unbound)'} ---`);
console.log(token);
