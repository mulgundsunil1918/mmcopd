/**
 * Offline licence engine. A licence is an Ed25519-signed payload (see
 * tools/license-gen.mjs) bound to one machine, with an expiry, an allowed module
 * list and the vendor's renewal contact. On every launch we verify the signature
 * against the embedded public key, check the machine + clock, and derive a state:
 *
 *   valid → grace (7 days after expiry, still usable) → locked (read-only + export)
 *
 * Dev builds (electron-forge start) are never gated so we can't lock ourselves out.
 *
 * MODULE (ADD-ON) CODES. Besides the main licence, a clinic can hold separate signed codes that each ADD modules (Pharmacy, Laboratory, IPD, WhatsApp…)
 * with their own expiry. They are stored apart from the main licence (license-addons.dat), so installing one can never switch anything else off, and
 * renewing one module never touches the rest. What the clinic can use = the main licence's modules + the modules of every add-on code that is genuine,
 * bound to this computer and not expired (a 7-day grace like the main licence). An add-on code is signed over ADDON_PREFIX + the licence JSON: an older
 * version of the app reads the signed text as JSON, fails, and REFUSES the code — it can never mistake a module code for a code that replaces the licence.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { app } from 'electron';
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey';
import { ACTIVATION_SERVER_URL } from './activationConfig';
import { readSignedCodeStrict, signatureIsGenuine } from './envelope';

export const GRACE_DAYS = 7;
export const DEFAULT_CONTACT = { phone: '8073935006', email: 'mulgundsunil@gmail.com' };
/** Every gate-able module. Reception/OPD is the always-on base. */
// `whatsapp` = Basic (click-to-send + templates). `whatsapp_pro` = Pro upgrade
// (Meta Cloud API automation). A Pro clinic's licence carries both.
export const ALL_MODULES = ['reception', 'opd', 'pharmacy', 'ipd', 'lab', 'peds', 'whatsapp', 'whatsapp_pro', 'analytics'] as const;

export interface LicensePayload {
  v: number;
  license_id: string;
  clinic: string;
  customer?: string;
  edition?: string;
  modules: string[];
  issued_at: string;
  expires_at: string;
  hardware_id?: string;
  contact?: { phone?: string; email?: string };
}

/** One module (add-on) code installed on this computer, and where it stands today. */
export interface AddonStatus {
  license_id: string;
  modules: string[];
  issued_at: string;
  expires_at: string;
  /** valid · grace (expired, still within the 7 days) · expired (its modules are no longer unlocked) */
  state: 'valid' | 'grace' | 'expired';
  daysLeft: number;
  /** Grace days still left after its expiry (0 while valid, and again once the grace is used up). */
  graceDaysLeft: number;
}

export type LicenseState =
  | 'valid' | 'grace' | 'locked' | 'invalid' | 'wrong_machine' | 'clock_tampered' | 'none' | 'dev';

export interface LicenseStatus {
  state: LicenseState;
  ok: boolean;            // app usable (possibly read-only)
  readOnly: boolean;      // writes blocked; view + export only
  needsActivation: boolean;
  daysLeft: number | null;
  graceDaysLeft: number | null;
  reminder: 'none' | '30d' | '7d' | '1d' | 'grace' | 'locked';
  modules: string[];
  payload: LicensePayload | null;
  contact: { phone?: string; email?: string };
  hardwareId: string;
  message: string;
  onlineAvailable: boolean;   // true when an activation server URL is configured
  /** Module (add-on) codes installed here — their modules are already included in `modules` while they are valid or in grace. */
  addons: AddonStatus[];
}

const DAY = 86_400_000;
const licensePath = () => path.join(app.getPath('userData'), 'license.dat');
const metaPath = () => path.join(app.getPath('userData'), '.license_meta');

/** Stable, hashed machine fingerprint (best-effort per OS). */
export function machineFingerprint(): string {
  let raw = '';
  try {
    if (process.platform === 'darwin') {
      raw = (execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 3000 })
        .match(/IOPlatformUUID"?\s*=\s*"([^"]+)"/) || [])[1] || '';
    } else if (process.platform === 'win32') {
      raw = (execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8', timeout: 3000 })
        .match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i) || [])[1] || '';
    } else {
      raw = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    }
  } catch { /* fall through */ }
  if (!raw) raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`;
  return crypto.createHash('sha256').update('curedesk-hw|' + raw).digest('hex').slice(0, 32);
}

/**
 * Verify a licence ALREADY STORED on this computer → payload, or null if the signature/format is bad. Deliberately tolerant of stray
 * characters around the code: earlier versions accepted a pasted key with extra characters and saved it as pasted, and a paying
 * clinic must never be locked out at start-up over that. The signature still proves the content, so nothing can be forged this way.
 * A code someone is typing or pasting NOW is checked with verifyTokenStrict() instead.
 */
export function verifyToken(token: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  try {
    const env = JSON.parse(Buffer.from(token.trim(), 'base64').toString('utf8'));
    if (!env || typeof env.p !== 'string' || typeof env.s !== 'string') return null;
    const ok = crypto.verify(null, Buffer.from(env.p, 'utf8'), publicKeyPem, Buffer.from(env.s, 'base64'));
    if (!ok) return null;
    const payload = JSON.parse(env.p) as LicensePayload;
    if (!payload || !payload.expires_at || !Array.isArray(payload.modules)) return null;
    return payload;
  } catch { return null; }
}

/**
 * Verify a code being ACTIVATED right now: it must be exactly what the keygen issued — nothing added, nothing missing (see
 * envelope.ts) — and carry a genuine signature. `publicKeyPem` is only ever passed by tests; the app always uses the embedded key.
 */
export function verifyTokenStrict(raw: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  const code = readSignedCodeStrict(raw);
  if (!code || !signatureIsGenuine(code.payloadText, code.signature, publicKeyPem)) return null;
  try {
    const payload = JSON.parse(code.payloadText) as LicensePayload;
    return payload && payload.expires_at && Array.isArray(payload.modules) ? payload : null;
  } catch { return null; }
}

/** What an add-on code is signed over, before its licence JSON. Older versions fail to read it as JSON and so refuse it (see the header). */
export const ADDON_PREFIX = 'curedesk-addon-v1\n';

function addonPayload(text: string): LicensePayload | null {
  if (typeof text !== 'string' || !text.startsWith(ADDON_PREFIX)) return null;
  try {
    const payload = JSON.parse(text.slice(ADDON_PREFIX.length)) as LicensePayload;
    return payload && payload.expires_at && Array.isArray(payload.modules) ? payload : null;
  } catch { return null; }
}

/** An add-on code ALREADY STORED on this computer (read leniently, like the main licence) → its payload, or null when it is not a genuine add-on code. */
export function verifyAddonToken(token: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  try {
    const env = JSON.parse(Buffer.from(token.trim(), 'base64').toString('utf8'));
    if (!env || typeof env.p !== 'string' || typeof env.s !== 'string') return null;
    if (!crypto.verify(null, Buffer.from(env.p, 'utf8'), publicKeyPem, Buffer.from(env.s, 'base64'))) return null;
    return addonPayload(env.p);
  } catch { return null; }
}

/** An add-on code being ACTIVATED now: exactly what the keygen issued (nothing added, nothing missing) with a genuine signature. */
export function verifyAddonTokenStrict(raw: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  const code = readSignedCodeStrict(raw);
  if (!code || !signatureIsGenuine(code.payloadText, code.signature, publicKeyPem)) return null;
  return addonPayload(code.payloadText);
}

// Clock-rollback defence: remember the highest time ever seen, HMAC-bound to the
// machine so the marker can't be hand-edited without detection.
const metaKey = () => crypto.createHash('sha256').update('curedesk-meta|' + machineFingerprint()).digest();
function readSeen(): number {
  try {
    const j = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
    const mac = crypto.createHmac('sha256', metaKey()).update(String(j.seen)).digest('hex');
    return mac === j.mac ? (Number(j.seen) || 0) : 0;
  } catch { return 0; }
}
function writeSeen(ms: number) {
  try {
    const mac = crypto.createHmac('sha256', metaKey()).update(String(ms)).digest('hex');
    fs.writeFileSync(metaPath(), JSON.stringify({ seen: ms, mac }));
  } catch { /* ignore */ }
}

// ── Single-use key ledger ─────────────────────────────────────────────────────
// Each activation code carries a unique license_id (the keygen mints a fresh one
// for every issue / renew / upgrade / move). We remember the ids already spent on
// THIS machine so the same key can't be applied twice — "one key, one activation".
// HMAC-bound to the machine so the ledger can't be hand-edited to un-spend a key.
// (A fresh reinstall legitimately starts an empty ledger — the machine-binding on
// the key itself is the cross-machine protection.)
const usedPath = () => path.join(app.getPath('userData'), '.used_licenses');
function readUsed(): Set<string> {
  try {
    const j = JSON.parse(fs.readFileSync(usedPath(), 'utf8'));
    const ids: string[] = Array.isArray(j.ids) ? j.ids : [];
    const mac = crypto.createHmac('sha256', metaKey()).update(JSON.stringify(ids)).digest('hex');
    return mac === j.mac ? new Set(ids) : new Set();   // tampered → treat as empty, never crash
  } catch { return new Set(); }
}
function markUsed(id: string) {
  try {
    const ids = [...readUsed()];
    if (ids.includes(id)) return;
    ids.push(id);
    const mac = crypto.createHmac('sha256', metaKey()).update(JSON.stringify(ids)).digest('hex');
    fs.writeFileSync(usedPath(), JSON.stringify({ ids, mac }), { mode: 0o600 });
  } catch { /* ignore */ }
}

// ── Module (add-on) codes on this computer ────────────────────────────────────
const addonsPath = () => path.join(app.getPath('userData'), 'license-addons.dat');
function storedAddonTokens(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(addonsPath(), 'utf8'));
    return Array.isArray(j.tokens) ? j.tokens.filter((t: unknown): t is string => typeof t === 'string') : [];
  } catch { return []; }
}
function writeAddonTokens(tokens: string[]) { fs.writeFileSync(addonsPath(), JSON.stringify({ tokens }), { mode: 0o600 }); }

/** The add-on codes here that are genuine and bound to this computer, each with where it stands now. Tampered, foreign or duplicate ones are ignored. */
function readAddons(publicKeyPem: string, hardwareId: string, now: number = Date.now()): AddonStatus[] {
  const out: AddonStatus[] = [];
  const seen = new Set<string>();
  for (const t of storedAddonTokens()) {
    const p = verifyAddonToken(t, publicKeyPem);
    if (!p || (p.hardware_id && p.hardware_id !== hardwareId) || (p.license_id && seen.has(p.license_id))) continue;
    if (p.license_id) seen.add(p.license_id);
    const msLeft = Date.parse(p.expires_at) - now;
    const daysLeft = Math.ceil(msLeft / DAY);
    out.push({
      license_id: p.license_id, modules: p.modules.filter((m) => (ALL_MODULES as readonly string[]).includes(m)),
      issued_at: p.issued_at, expires_at: p.expires_at, daysLeft,
      graceDaysLeft: msLeft > 0 ? 0 : Math.max(0, GRACE_DAYS + daysLeft),
      state: msLeft > 0 ? 'valid' : GRACE_DAYS + daysLeft > 0 ? 'grace' : 'expired',
    });
  }
  return out;
}
/** The modules the main licence gives, plus those of every add-on code that is still valid or in grace (no duplicates). */
const withAddons = (base: string[], addons: AddonStatus[]) =>
  [...new Set([...base, ...addons.filter((a) => a.state !== 'expired').flatMap((a) => a.modules)])];

export function getLicenseStatus(publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicenseStatus {
  const hardwareId = machineFingerprint();
  const base: LicenseStatus = {
    state: 'none', ok: false, readOnly: false, needsActivation: true,
    daysLeft: null, graceDaysLeft: null, reminder: 'none',
    modules: [], payload: null, contact: DEFAULT_CONTACT, hardwareId, message: '',
    onlineAvailable: !!ACTIVATION_SERVER_URL, addons: [],
  };

  if (!app.isPackaged) {
    return { ...base, state: 'dev', ok: true, needsActivation: false, modules: [...ALL_MODULES], message: 'Development build — licensing not enforced.' };
  }

  let token = '';
  try { token = fs.readFileSync(licensePath(), 'utf8'); } catch { /* none */ }
  if (!token) return { ...base, state: 'none', message: 'No licence installed. Activate to begin.' };

  const payload = verifyToken(token, publicKeyPem);
  if (!payload) return { ...base, state: 'invalid', message: 'Licence is invalid or corrupted. Re-activate with a fresh licence.' };

  if (payload.hardware_id && payload.hardware_id !== hardwareId) {
    return { ...base, state: 'wrong_machine', payload, message: 'This licence belongs to a different computer. Contact support to move it.' };
  }

  const contact = { ...DEFAULT_CONTACT, ...(payload.contact || {}) };
  const now = Date.now();
  const addons = readAddons(publicKeyPem, hardwareId, now);
  const modules = withAddons(payload.modules, addons);
  const expiry = Date.parse(payload.expires_at);

  const seen = readSeen();
  if (seen && now < seen - DAY) {
    return { ...base, state: 'clock_tampered', ok: false, needsActivation: false, payload, modules, addons, contact,
      message: 'The system clock is set earlier than the last time the app ran. Fix the date & time to continue.' };
  }
  writeSeen(Math.max(seen, now));

  const msLeft = expiry - now;
  const daysLeft = Math.ceil(msLeft / DAY);

  if (msLeft > 0) {
    const reminder = daysLeft <= 1 ? '1d' : daysLeft <= 7 ? '7d' : daysLeft <= 30 ? '30d' : 'none';
    return { ...base, state: 'valid', ok: true, needsActivation: false, daysLeft, reminder, modules, addons, payload, contact,
      message: reminder === 'none' ? '' : `Your licence expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` };
  }

  const graceLeft = GRACE_DAYS + daysLeft; // daysLeft is ≤ 0 here
  if (graceLeft > 0) {
    return { ...base, state: 'grace', ok: true, needsActivation: false, daysLeft, graceDaysLeft: graceLeft, reminder: 'grace', modules, addons, payload, contact,
      message: `Your licence has expired. ${graceLeft} grace day${graceLeft === 1 ? '' : 's'} left — renew now to avoid read-only mode.` };
  }
  return { ...base, state: 'locked', ok: true, needsActivation: false, readOnly: true, daysLeft, graceDaysLeft: 0, reminder: 'locked', modules, addons, payload, contact,
    message: 'Your licence has expired. The app is now read-only — you can still view and back up your data. Renew to unlock.' };
}

/** The paid add-ons, with the names a clinic knows them by. Each is unlocked ONLY by its own name appearing inside the signed licence. */
const PAID_ADDONS = ['lab', 'pharmacy', 'ipd', 'whatsapp', 'whatsapp_pro'] as const;
const ADDON_LABEL: Record<string, string> = { lab: 'Laboratory', pharmacy: 'Pharmacy', ipd: 'In-Patient (IPD)', whatsapp: 'WhatsApp Basic', whatsapp_pro: 'WhatsApp Pro' };

/** The paid modules of the MAIN licence installed on THIS computer right now — none when there is no valid licence or it belongs to another PC. */
function installedAddons(publicKeyPem: string): string[] {
  try {
    const p = verifyToken(fs.readFileSync(licensePath(), 'utf8'), publicKeyPem);
    if (!p || (p.hardware_id && p.hardware_id !== machineFingerprint())) return [];
    return p.modules.filter((m) => (PAID_ADDONS as readonly string[]).includes(m));
  } catch { return []; }
}
/** The main licence on this computer (genuine, for this PC), or null. */
function installedBase(publicKeyPem: string): LicensePayload | null {
  try {
    const p = verifyToken(fs.readFileSync(licensePath(), 'utf8'), publicKeyPem);
    return p && (!p.hardware_id || p.hardware_id === machineFingerprint()) ? p : null;
  } catch { return null; }
}

export interface ActivationResult { ok: boolean; error?: string; status?: LicenseStatus; needsConfirm?: boolean; removed?: string[]; addon?: { modules: string[]; expires_at: string } }

/**
 * Install/replace the licence after verifying it belongs to this machine.
 * A new code REPLACES the old one, so one that leaves out a paid module the clinic has today would silently switch that module off.
 * That is refused (needsConfirm + the module names) until the person confirms — the screen asks, then calls again with confirmRemoval.
 */
export function activateLicense(token: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM, opts: { confirmRemoval?: boolean } = {}): ActivationResult {
  const payload = verifyTokenStrict(token, publicKeyPem);
  if (!payload) {
    const addon = verifyAddonTokenStrict(token, publicKeyPem);            // a module (add-on) code: it ADDS, it never replaces the main licence
    if (addon) return activateAddon(token, addon, publicKeyPem);
    return { ok: false, error: 'Invalid licence code. It must be exactly the code we sent — nothing added, nothing missing. Copy the whole code again and paste it as it is.' };
  }
  const hw = machineFingerprint();
  if (payload.hardware_id && payload.hardware_id !== hw) {
    return { ok: false, error: 'This licence is for a different computer. Send us your Machine ID for a matching licence.' };
  }
  // Refuse UNBOUND (blank hardware_id) licences on real installs. An unbound
  // code works on ANY PC, so accepting one would let a single code be reused
  // across clinics. Dev builds aren't licence-gated, so this only bites when
  // packaged. (Test on the packaged .dmg with a code bound to this Mac's ID.)
  if (app.isPackaged && !payload.hardware_id) {
    return { ok: false, error: 'This licence is not locked to a computer. Send us this PC’s Machine ID and we’ll issue a matching code.' };
  }
  // Single-use: a key already spent on this computer can't be applied again. Each
  // renewal / upgrade / move is a fresh code (new license_id), so this only blocks
  // re-using the exact same key — not legitimate upgrades.
  if (app.isPackaged && payload.license_id && readUsed().has(payload.license_id)) {
    return { ok: false, error: 'This key has already been used on this computer. For any change, ask us for a fresh upgrade/renewal code.' };
  }
  if (!opts.confirmRemoval) {
    // a module a still-valid module code gives is not lost when the main licence changes
    const keptByCodes = new Set(readAddons(publicKeyPem, hw).filter((a) => a.state !== 'expired').flatMap((a) => a.modules));
    const losing = installedAddons(publicKeyPem).filter((m) => !payload.modules.includes(m) && !keptByCodes.has(m));
    if (losing.length) {
      const names = losing.map((m) => ADDON_LABEL[m] || m).join(', ');
      return { ok: false, needsConfirm: true, removed: losing,
        error: `This code does not include ${names}, which this computer has now. Applying it would switch ${losing.length > 1 ? 'them' : 'it'} off. If you only wanted to ADD a module, ask us for an upgrade code that keeps everything you already have.` };
    }
  }
  try {
    fs.writeFileSync(licensePath(), token.trim(), { mode: 0o600 });
    writeSeen(Date.now());
    if (payload.license_id) markUsed(payload.license_id);
  } catch (e: any) { return { ok: false, error: e?.message || 'Could not save the licence.' }; }
  return { ok: true, status: getLicenseStatus() };
}

/**
 * Install a module (add-on) code. It ADDS to the main licence and never replaces it: the main licence file is not touched, every other module
 * code stays, and an older code for the same module(s) is superseded by this newer one (a renewal). It must belong to this computer, be unused,
 * not already be long expired, and there must be a main licence for it to add to.
 */
function activateAddon(token: string, payload: LicensePayload, publicKeyPem: string): ActivationResult {
  const hw = machineFingerprint();
  if (payload.hardware_id && payload.hardware_id !== hw) {
    return { ok: false, error: 'This module code is for a different computer. Send us your Machine ID for a matching code.' };
  }
  if (app.isPackaged && !payload.hardware_id) {
    return { ok: false, error: 'This module code is not locked to a computer. Send us this PC’s Machine ID and we’ll issue a matching code.' };
  }
  if (app.isPackaged && !installedBase(publicKeyPem)) {
    return { ok: false, error: 'Activate your main licence first — a module code adds to it, it cannot start the software on its own.' };
  }
  if (app.isPackaged && payload.license_id && readUsed().has(payload.license_id)) {
    return { ok: false, error: 'This key has already been used on this computer. For any change, ask us for a fresh module or renewal code.' };
  }
  const mods = [...new Set(payload.modules.filter((m) => (ALL_MODULES as readonly string[]).includes(m)))];
  if (!mods.length) return { ok: false, error: 'This code does not contain any module.' };
  const msLeft = Date.parse(payload.expires_at) - Date.now();
  if (!(GRACE_DAYS * DAY + msLeft > 0)) return { ok: false, error: 'This module code has already expired. Ask us for a fresh one.' };
  try {
    // a code that carries only modules this one also carries, and was issued before it, is superseded (a renewal replaces the old one)
    const kept = storedAddonTokens().filter((t) => {
      const p = verifyAddonToken(t, publicKeyPem);
      return !!p && !(p.modules.every((m) => mods.includes(m)) && Date.parse(p.issued_at) <= Date.parse(payload.issued_at));
    });
    writeAddonTokens([...kept, token.trim()]);
    writeSeen(Date.now());
    if (payload.license_id) markUsed(payload.license_id);
  } catch (e: any) { return { ok: false, error: e?.message || 'Could not save the module code.' }; }
  return { ok: true, status: getLicenseStatus(publicKeyPem), addon: { modules: mods, expires_at: payload.expires_at } };
}

/**
 * Online activation (Phase 2). Sends this machine's fingerprint + a short
 * activation code to the vendor server, which signs a machine-bound licence and
 * returns it; we then install it exactly like a pasted one. Falls back cleanly
 * (clear error) when offline or unconfigured so the paste path still works.
 */
export async function activateOnline(code: string, opts: { confirmRemoval?: boolean } = {}): Promise<ActivationResult> {
  const c = String(code || '').trim();
  if (!ACTIVATION_SERVER_URL) return { ok: false, error: 'Online activation isn’t set up. Paste your licence code instead.' };
  if (!c) return { ok: false, error: 'Enter the activation code you were given.' };
  const machineId = machineFingerprint();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let resp: Response;
    try {
      resp = await fetch(`${ACTIVATION_SERVER_URL}/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: c, machineId }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) return { ok: false, error: data?.error || `Activation failed (HTTP ${resp.status}).` };
    if (!data.token) return { ok: false, error: 'The server did not return a licence. Contact support.' };
    return activateLicense(String(data.token), undefined, opts);
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'timed out' : (e?.message || 'no connection');
    return { ok: false, error: `Couldn’t reach the activation server (${msg}). Check your internet, or paste your licence code instead.` };
  }
}
