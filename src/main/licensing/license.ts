/**
 * Offline licence engine. A licence is an Ed25519-signed payload (see
 * tools/license-gen.mjs) bound to one machine, with an expiry, an allowed module
 * list and the vendor's renewal contact. On every launch we verify the signature
 * against the embedded public key, check the machine + clock, and derive a state:
 *
 *   valid → grace (7 days after expiry, still usable) → locked (read-only + export)
 *
 * Dev builds (electron-forge start) are never gated so we can't lock ourselves out.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { app } from 'electron';
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey';

export const GRACE_DAYS = 7;
export const DEFAULT_CONTACT = { phone: '8073935006', email: 'mulgundsunil@gmail.com' };
/** Every gate-able module. Reception/OPD is the always-on base. */
export const ALL_MODULES = ['reception', 'opd', 'pharmacy', 'ipd', 'lab', 'peds', 'whatsapp', 'analytics'] as const;

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

/** Verify a licence token → payload, or null if the signature/format is bad. */
export function verifyToken(token: string): LicensePayload | null {
  try {
    const env = JSON.parse(Buffer.from(token.trim(), 'base64').toString('utf8'));
    if (!env || typeof env.p !== 'string' || typeof env.s !== 'string') return null;
    const ok = crypto.verify(null, Buffer.from(env.p, 'utf8'), LICENSE_PUBLIC_KEY_PEM, Buffer.from(env.s, 'base64'));
    if (!ok) return null;
    const payload = JSON.parse(env.p) as LicensePayload;
    if (!payload || !payload.expires_at || !Array.isArray(payload.modules)) return null;
    return payload;
  } catch { return null; }
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

export function getLicenseStatus(): LicenseStatus {
  const hardwareId = machineFingerprint();
  const base: LicenseStatus = {
    state: 'none', ok: false, readOnly: false, needsActivation: true,
    daysLeft: null, graceDaysLeft: null, reminder: 'none',
    modules: [], payload: null, contact: DEFAULT_CONTACT, hardwareId, message: '',
  };

  if (!app.isPackaged) {
    return { ...base, state: 'dev', ok: true, needsActivation: false, modules: [...ALL_MODULES], message: 'Development build — licensing not enforced.' };
  }

  let token = '';
  try { token = fs.readFileSync(licensePath(), 'utf8'); } catch { /* none */ }
  if (!token) return { ...base, state: 'none', message: 'No licence installed. Activate to begin.' };

  const payload = verifyToken(token);
  if (!payload) return { ...base, state: 'invalid', message: 'Licence is invalid or corrupted. Re-activate with a fresh licence.' };

  if (payload.hardware_id && payload.hardware_id !== hardwareId) {
    return { ...base, state: 'wrong_machine', payload, message: 'This licence belongs to a different computer. Contact support to move it.' };
  }

  const contact = { ...DEFAULT_CONTACT, ...(payload.contact || {}) };
  const modules = payload.modules;
  const now = Date.now();
  const expiry = Date.parse(payload.expires_at);

  const seen = readSeen();
  if (seen && now < seen - DAY) {
    return { ...base, state: 'clock_tampered', ok: false, needsActivation: false, payload, modules, contact,
      message: 'The system clock is set earlier than the last time the app ran. Fix the date & time to continue.' };
  }
  writeSeen(Math.max(seen, now));

  const msLeft = expiry - now;
  const daysLeft = Math.ceil(msLeft / DAY);

  if (msLeft > 0) {
    const reminder = daysLeft <= 1 ? '1d' : daysLeft <= 7 ? '7d' : daysLeft <= 30 ? '30d' : 'none';
    return { ...base, state: 'valid', ok: true, needsActivation: false, daysLeft, reminder, modules, payload, contact,
      message: reminder === 'none' ? '' : `Your licence expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` };
  }

  const graceLeft = GRACE_DAYS + daysLeft; // daysLeft is ≤ 0 here
  if (graceLeft > 0) {
    return { ...base, state: 'grace', ok: true, needsActivation: false, daysLeft, graceDaysLeft: graceLeft, reminder: 'grace', modules, payload, contact,
      message: `Your licence has expired. ${graceLeft} grace day${graceLeft === 1 ? '' : 's'} left — renew now to avoid read-only mode.` };
  }
  return { ...base, state: 'locked', ok: true, needsActivation: false, readOnly: true, daysLeft, graceDaysLeft: 0, reminder: 'locked', modules, payload, contact,
    message: 'Your licence has expired. The app is now read-only — you can still view and back up your data. Renew to unlock.' };
}

/** Install/replace the licence after verifying it belongs to this machine. */
export function activateLicense(token: string): { ok: boolean; error?: string; status?: LicenseStatus } {
  const payload = verifyToken(token);
  if (!payload) return { ok: false, error: 'Invalid licence — check you pasted the whole code.' };
  const hw = machineFingerprint();
  if (payload.hardware_id && payload.hardware_id !== hw) {
    return { ok: false, error: 'This licence is for a different computer. Send us your Machine ID for a matching licence.' };
  }
  try {
    fs.writeFileSync(licensePath(), token.trim(), { mode: 0o600 });
    writeSeen(Date.now());
  } catch (e: any) { return { ok: false, error: e?.message || 'Could not save the licence.' }; }
  return { ok: true, status: getLicenseStatus() };
}
