import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../db/db';
import { nextUHID, nextBillNumber, nextIpNumber, nextVisitNumber, formatVisitId, nextLabOrderNumber } from '../db/ids';
import { clinicalLineTax } from './gst';
import { recalcBill } from './bill-totals';
import { money } from './billing-engine';
import { writeLabBillLines } from './lab-billing';
import { ADV_SPARE_SQL, billPosition, collections, dailyCollection, outstandingBills, outstandingTotal, utcSlack } from './billing-portal';
import { SALE_DUE_SQL } from './pharmacy-finance';
import { fromPaise, toPaise } from '../lib/pharmacyMath';
import { localISO, addDaysISO } from '../lib/localDate';
import { LAB_CATALOG } from '../data/lab-catalog';
import { PHARMACY_CATALOG } from '../data/pharmacy-catalog';
import { refreshCatalogue } from '../db/catalogue';
import { seedSampleData } from '../db/sample-data';

/**
 * Cross-module hook: registerIpc() sets this to its internal `performBackupToRoot`
 * function so main.ts's auto-backup scheduler can run the FULL backup (sqlite +
 * xlsx + manifest) instead of just dumping the sqlite file. Null until registerIpc
 * has run at app startup.
 */
let _performBackupToRoot: ((root: string, label?: 'backup' | 'pre-restore') => Promise<{
  ok: true; bundleDir: string; xlsxFile: string; documentCount: number; totalBackups: number;
}>) | null = null;
export function runFullBackup(root: string, label: 'backup' | 'pre-restore' = 'backup') {
  if (!_performBackupToRoot) throw new Error('Backup service not yet initialized — call after registerIpc()');
  return _performBackupToRoot(root, label);
}
export function isBackupServiceReady() {
  return _performBackupToRoot !== null;
}
/**
 * Where backups go. If the clinic has picked a folder (ideally a USB drive or a
 * Google-Drive folder) use it; otherwise default to Documents/CureDesk Backups —
 * OUTSIDE the app's data folder. The old default (userData/backups) lived INSIDE
 * %APPDATA%\CureDesk HMS\, so deleting that folder (or a reinstall that wipes it)
 * destroyed the backups along with the live database. Documents survives all of
 * that; userData/backups is kept only as a last resort if Documents won't resolve.
 */
export function defaultBackupRoot(): string {
  try { return path.join(app.getPath('documents'), 'CureDesk Backups'); }
  catch { return path.join(app.getPath('userData'), 'backups'); }
}
export function backupRoot(s: { backup_folder?: string | null } | null | undefined): string {
  const picked = (s?.backup_folder || '').trim();
  return picked || defaultBackupRoot();
}

/** Full backup to the clinic's configured folder (falls back to Documents/CureDesk
 *  Backups, which always works). Used to force a safety backup before an app update. */
export async function runConfiguredBackup(label: 'backup' | 'pre-restore' = 'backup') {
  const s = getAllSettings(getDb()) as any;
  const root = backupRoot(s);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return runFullBackup(root, label);
}
import { getAllSettings, saveSettings } from '../db/settings';
import { broadcastEvent as broadcastNetworkEvent } from './network-server';
import { NotificationService } from '../services/notifications';
import { createUser, verifyLogin, ensureDefaultAdmin, changePassword, listUsers, updateUser, logAudit, listAudit, type Role, type SessionUser } from './auth';
import { verifyResetCode } from './licensing/passwordReset';
import { requireModule } from './licensing/enforce';
import { deleteOrdersForPatient as deleteRadiologyForPatient, deleteOrdersForAppointment as deleteRadiologyForAppointment } from './radiology';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentWithJoins,
  Bill,
  BillItem,
  BillWithJoins,
  Doctor,
  NotificationLog,
  Patient,
  PatientInput,
  PaymentMode,
  Settings,
} from '../types';

/** Today on the clinic's own clock (the PC's local day) — NOT the UTC date, which in India is yesterday until 5:30 a.m. */
function todayISO() {
  return localISO();
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

// Identifier generation lives in db/ids.ts. The old COUNT(*)+1 generators that
// used to sit here reissued a number after any record was deleted, which then
// failed on the UNIQUE constraint — see the comment at the top of that file.
function generateUHID(): string {
  return nextUHID(getDb());
}

/**
 * Bill number honouring the clinic's configured invoice prefix.
 *
 * Settings offers an "Invoice number prefix", but this ignored it and hardcoded
 * the default — while IPD bills DID use it. A clinic that set "MMC" ended up
 * running two parallel series (MMC-… for in-patients, INV-… for everything
 * else), which is a real problem when the numbering has to be continuous for
 * tax purposes.
 */
function generateBillNumber(): string {
  const db = getDb();
  let prefix = 'INV';
  try { prefix = (getAllSettings(db).invoice_prefix || 'INV').trim() || 'INV'; } catch { /* fall back */ }
  return nextBillNumber(db, prefix);
}

// ── Admin password helpers (scrypt) ───────────────────────────────────────────
function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(password, salt, 32).toString('hex');
  return `$scrypt$${salt}$${h}`;
}

function verifyAdminPassword(input: string, stored: string): boolean {
  if (stored.startsWith('$scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [, , salt, storedHash] = parts;
    try {
      const calc = crypto.scryptSync(input, salt, 32).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(storedHash));
    } catch { return false; }
  }
  // Legacy plaintext — constant-time compare
  if (input.length !== stored.length) return false;
  const a = Buffer.alloc(stored.length);
  const b = Buffer.alloc(stored.length);
  Buffer.from(input).copy(a);
  Buffer.from(stored).copy(b);
  return crypto.timingSafeEqual(a, b);
}

// ── Auth rate limiter ─────────────────────────────────────────────────────────
// Repeated wrong passwords/PINs slow down: free for the first two, then 10 s, 30 s, 2 min, 5 min, 15 min.
// (The streak used to be wiped whenever the previous block had expired — and the first two "blocks" last 0 s,
// so it was wiped on EVERY attempt and nothing was ever throttled.) A streak is only forgiven after 15 quiet minutes.
const authFailures = new Map<string, { count: number; blockedUntil: number; last: number }>();

function checkRateLimit(key: string): boolean {
  const s = authFailures.get(key);
  return !s || Date.now() >= s.blockedUntil;
}

function recordAuthFailure(key: string) {
  const now = Date.now();
  const s = authFailures.get(key) ?? { count: 0, blockedUntil: 0, last: 0 };
  if (now - s.last > 15 * 60_000) s.count = 0;
  s.count++;
  s.last = now;
  const delays = [0, 0, 10_000, 30_000, 120_000, 300_000, 900_000];
  s.blockedUntil = now + (delays[Math.min(s.count, delays.length - 1)] ?? 900_000);
  authFailures.set(key, s);
}

function clearAuthFailures(key: string) { authFailures.delete(key); }

// ── Server-side session + role enforcement ───────────────────────────────────
/**
 * Who is signed in, as far as the MAIN process is concerned. Until now roles only
 * hid screens in the renderer — any code could still invoke a destructive IPC
 * channel directly. The session is set here on a successful auth:login (never
 * supplied by the renderer, which could lie about it) and cleared on logout.
 */
let currentSession: SessionUser | null = null;

/**
 * Guard a destructive channel by role.
 *
 * Deliberately permissive in exactly one case: when the clinic has NOT turned on
 * staff sign-in there is no identity to check, and every existing single-shared-PC
 * install would break if we denied. That matches the app's own promise — sign-in
 * is what turns roles into enforcement.
 */
/**
 * Who is performing the current action, for the audit log.
 *
 * Most logAudit calls used to pass a literal `null`, which recorded THAT
 * something happened but never who did it — useless in the one situation an
 * audit log exists for. This returns the live main-process session, so the
 * trail names a person whenever the clinic uses logins (and honestly records
 * nobody when it doesn't).
 */
export function actor(): SessionUser | null {
  return currentSession;
}

/** Rupees for a message shown to a human. */
function formatMoney(n: number): string {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

export function requireRole(allowed: Role[], action: string): void {
  let loginRequired = false;
  try { loginRequired = getAllSettings(getDb()).require_login === true; } catch { /* fail open */ }
  if (!loginRequired) return;                       // shared-PC mode: no identity to enforce
  if (!currentSession) {
    throw new Error(`Please sign in before you ${action}.`);
  }
  if (currentSession.role === 'admin') return;      // owner may do anything
  if (!allowed.includes(currentSession.role)) {
    throw new Error(
      `Your role (${currentSession.role}) is not allowed to ${action}. Ask an administrator to do this.`
    );
  }
}

export function registerIpc() {
  // Ensure a default admin exists on first boot
  ensureDefaultAdmin(getDb());

  // ===== Auth =====
  ipcMain.handle('auth:login', (_e, username: string, password: string) => {
    const key = `login:${(username || '').toLowerCase().slice(0, 64)}`;
    if (!checkRateLimit(key)) return null;
    const db = getDb();
    const user = verifyLogin(db, username, password);
    if (user) {
      clearAuthFailures(key);
      currentSession = user;          // main-process session — the basis for requireRole()
      logAudit(db, user, 'login');
      return user;
    }
    recordAuthFailure(key);
    return null;
  });
  const ROLES: Role[] = ['admin', 'manager', 'receptionist', 'doctor', 'nurse', 'ward_incharge', 'lab_tech', 'radiology_tech', 'pharmacist'];
  ipcMain.handle('auth:createUser', (_e, input: { username: string; password: string; role: Role; display_name?: string; doctor_id?: number }) => {
    if (!String(input?.username ?? '').trim()) throw new Error('Enter a username.');
    if (String(input?.password ?? '').length < 4) throw new Error('Choose a password of at least 4 characters.');
    if (!ROLES.includes(input?.role)) throw new Error('Choose a role for this user.');
    // With sign-in switched on, only an administrator may create another administrator (otherwise any signed-in
    // account could make itself one). A no-login clinic has no identity to enforce and is unaffected.
    if (input.role === 'admin') requireRole([], 'create an administrator account');
    const db = getDb();
    const u = createUser(db, input);
    logAudit(db, actor(), 'user_created', 'users', u.id, `role=${input.role}`);
    return u;
  });
  ipcMain.handle('auth:changePassword', (_e, userId: number, newPassword: string) => {
    if (String(newPassword ?? '').length < 4) throw new Error('Choose a password of at least 4 characters.');
    const db = getDb();
    // Anyone may change their OWN password; changing someone else's is an administrator's job.
    if (actor()?.id !== userId) requireRole([], "change another person's password");
    changePassword(db, userId, newPassword);
    logAudit(db, actor(), 'password_changed', 'users', userId);
    return true;
  });

  // "Forgot admin password" recovery. Takes a support-signed, machine-bound reset
  // code (minted by the keygen tool) + a new password the clinic chooses now, and
  // resets BOTH the admin login and the admin-gate PIN to it. Works while locked
  // out because it runs in main with direct DB access — no login required — yet is
  // safe because only a validly-signed, non-expired, this-machine code is accepted.
  ipcMain.handle('auth:recoverWithCode', (_e, code: string, newPassword: string) => {
    const chk = verifyResetCode(code);
    if (!chk.ok) return { ok: false as const, error: chk.error };
    const pw = String(newPassword || '');
    if (pw.length < 4) return { ok: false as const, error: 'Choose a new password of at least 4 characters.' };
    const db = getDb();
    // 1) Reset the admin USER login — prefer the built-in 'admin', else any admin role.
    const users = listUsers(db) as Array<{ id: number; username: string; role: string }>;
    const target = users.find((u) => u.username === 'admin') || users.find((u) => u.role === 'admin') || null;
    if (target) {
      changePassword(db, target.id, pw); // also clears must_change_password
      // Reactivate too. verifyLogin() only matches is_active=1, so resetting the
      // password of a DEACTIVATED admin would still leave the clinic locked out —
      // the recovery code has to actually restore access, not just the password.
      db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(target.id);
      clearAuthFailures(`login:${target.username.toLowerCase()}`);
    }
    // 2) Reset the admin-GATE password (the PIN that guards Settings / destructive ops).
    saveSettings(db, { admin_password: hashAdminPassword(pw) });
    clearAuthFailures('admin_unlock');
    logAudit(db, actor(), 'password_recovered_via_code', 'users', target?.id);
    return { ok: true as const, username: target?.username || null };
  });

  ipcMain.handle('auth:logout', () => {
    if (currentSession) logAudit(getDb(), currentSession, 'logout');
    currentSession = null;
    return { ok: true as const };
  });
  ipcMain.handle('auth:listUsers', () => listUsers(getDb()));
  ipcMain.handle('auth:updateUser', (_e, id: number, patch: any) => {
    if (patch?.role === 'admin') requireRole([], 'make someone an administrator');
    const db = getDb();
    updateUser(db, id, patch);
    logAudit(db, actor(), 'user_updated', 'users', id, JSON.stringify(patch));
    return listUsers(db);
  });
  ipcMain.handle('auth:verifyAdminPassword', (_e, password: string) => {
    if (!checkRateLimit('admin_unlock')) return false;
    const db = getDb();
    const settings = getAllSettings(db);
    const input = password || '';
    const stored = settings.admin_password || '1234';

    const ok = verifyAdminPassword(input, stored);
    if (ok) {
      clearAuthFailures('admin_unlock');
      // Transparently migrate plaintext to hashed on first successful unlock
      if (!stored.startsWith('$scrypt$')) {
        saveSettings(db, { admin_password: hashAdminPassword(input) });
      }
    } else {
      recordAuthFailure('admin_unlock');
    }
    logAudit(db, actor(), ok ? 'admin_unlock' : 'admin_unlock_failed');
    return ok;
  });
  // Returns true while the admin password is still the factory default (1234) or empty.
  // Used by the unlock screen to decide whether to show the 'default is 1234' hint.
  // Legacy '1918' still counts as "default" so old installs that were migrated
  // also drop the hint correctly once the user sets a real password.
  ipcMain.handle('auth:isDefaultAdminPassword', () => {
    const settings = getAllSettings(getDb());
    const stored = (settings.admin_password || '').trim();
    if (stored === '') return true;
    // Legacy plaintext rows: compare directly.
    if (!stored.startsWith('$scrypt$')) return stored === '1234' || stored === '1918';
    // Hashed rows: a plain string compare can never match, which used to make ANY
    // hashed PIN — including a factory-weak one — report as "properly configured"
    // and silenced the first-run gate forever. Verify against the known-weak list.
    return ['1234', '1918', '0000', '1111', 'admin'].some((weak) => verifyAdminPassword(weak, stored));
  });
  ipcMain.handle('auth:changeAdminPassword', (_e, currentPassword: string, newPassword: string) => {
    const db = getDb();
    const settings = getAllSettings(db);
    const stored = settings.admin_password || '1234';

    if (!verifyAdminPassword(currentPassword || '', stored)) {
      return { ok: false, error: 'Current password incorrect' };
    }
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters' };
    }
    saveSettings(db, { admin_password: hashAdminPassword(newPassword) });
    logAudit(db, actor(), 'admin_password_changed');
    return { ok: true };
  });
  // First-run only: set the admin password when it's still the factory default,
  // WITHOUT requiring the current one (there is none the user chose). Refuses
  // once a real password exists — after that, use auth:changeAdminPassword.
  ipcMain.handle('auth:setInitialAdminPassword', (_e, newPassword: string) => {
    const db = getDb();
    const stored = (getAllSettings(db).admin_password || '').trim();
    const isDefault = stored === '' || stored === '1234' || stored === '1918';
    if (!isDefault) return { ok: false, error: 'An admin password is already set — use Change password in Settings.' };
    const pw = String(newPassword || '');
    if (pw.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    if (['1234', '1918', '12345678', 'password', 'admin123'].includes(pw.toLowerCase())) {
      return { ok: false, error: 'That password is too easy to guess — choose another.' };
    }
    saveSettings(db, { admin_password: hashAdminPassword(pw) });
    logAudit(db, actor(), 'admin_password_set_initial');
    return { ok: true };
  });

  ipcMain.handle('audit:list', (_e, limit?: number) => listAudit(getDb(), limit ?? 500));

  ipcMain.handle('admin:resetAuditLog', (_e, confirmPhrase: string, adminPassword?: string) => {
    requireRole([], 'clear the audit log');
    if (confirmPhrase !== 'iknowwhatiamdoing') {
      return { ok: false, error: 'Confirmation phrase required' };
    }
    const db = getDb();
    const settings = getAllSettings(db);
    const stored = settings.admin_password || '1234';
    if (!adminPassword || !verifyAdminPassword(adminPassword, stored)) {
      return { ok: false, error: 'Admin password required' };
    }
    const count = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c;
    db.exec('DELETE FROM audit_log');
    logAudit(db, actor(), 'audit_log_reset', 'audit_log', undefined, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });

  ipcMain.handle('admin:resetNotificationLog', (_e, confirmPhrase: string) => {
    requireRole([], 'clear the notification log');
    if (confirmPhrase !== 'iknowwhatiamdoing') {
      return { ok: false, error: 'Confirmation phrase required' };
    }
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM notification_log').get() as { c: number }).c;
    db.exec('DELETE FROM notification_log');
    logAudit(db, actor(), 'notification_log_reset', 'notification_log', undefined, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });

  // Helper — manually cascades non-FK-cascade dependents so DELETE FROM patients can succeed.
  // Ordering matters: child tables with RESTRICT FKs must be cleared before their parents.
  /**
   * Put dispensed units back on the shelf before their sale records are erased.
   *
   * Deleting a patient or a visit removes its pharmacy sales and dispensing register — the record that a unit left
   * a batch. Nothing returned the units, so every deletion permanently shrank stock (and stock value) by whatever
   * had been "sold" to a record that no longer exists. Erasing a sale means it never happened, so its quantities go
   * back to the batches they came from. `where` selects the register rows (alias `dr`); `params` bind it.
   */
  const restoreDispensedStock = (db: any, where: string, ...params: any[]) => {
    db.prepare(
      `UPDATE drug_stock_batches
          SET qty_remaining = qty_remaining + COALESCE(
                (SELECT SUM(dr.qty) FROM dispensing_register dr WHERE dr.batch_id = drug_stock_batches.id AND (${where})), 0)
        WHERE id IN (SELECT dr.batch_id FROM dispensing_register dr WHERE ${where})`
    ).run(...params, ...params);
  };

  /** What a patient's records hold in money, for the audit line written when they are erased (so a deletion is never silent about it). */
  const moneyOf = (db: any, id: number): string => {
    try {
      const b = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t, COALESCE(SUM(amount_paid),0) AS p FROM bills WHERE patient_id=? AND COALESCE(status,'') <> 'cancelled'").get(id) as any;
      const a = db.prepare('SELECT COALESCE(SUM(amount - refunded_amount),0) AS h FROM advances WHERE patient_id=?').get(id) as any;
      const c = db.prepare("SELECT COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)),0) AS d FROM pharmacy_sales WHERE patient_id=? AND COALESCE(payment_mode,'') <> 'IPD-bill'").get(id) as any;
      return `${b.n} bill(s) ₹${money(b.t)} (₹${money(b.p)} received), deposit held ₹${money(a.h)}, pharmacy credit owing ₹${money(c.d)}`;
    } catch { return ''; }
  };

  const purgePatient = (db: any, id: number) => {
    restoreDispensedStock(db, 'dr.patient_id = ? OR dr.sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)', id, id);
    // Dispensing register has RESTRICT FKs on pharmacy_sale_items / pharmacy_sales — must go first.
    // Danger Zone semantics: bulk-purging a patient erases their dispensing record alongside everything else.
    db.prepare('DELETE FROM dispensing_register WHERE patient_id = ?').run(id);
    // Also kill any dispensing rows tied to this patient's pharmacy sales (defensive — covers walk-in sales whose patient_id is null but sale references patient via other paths).
    db.prepare('DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)').run(id);
    /**
     * Tables with a NOT NULL FK to patients and NO cascade. Every one of these
     * blocks the delete with a raw "FOREIGN KEY constraint failed" if left
     * behind — which is exactly what happened to any patient who had ever been
     * admitted, taken a deposit, or been raised as an insurance claim.
     * They must go before bills and ip_admissions, which they in turn reference.
     */
    db.prepare('DELETE FROM advances WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM tpa_claims WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM mlc_register WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM admission_requests WHERE patient_id = ?').run(id);
    // Bills (NOT NULL FK, no cascade) — drop them; audit log captures the patient who was billed.
    db.prepare('DELETE FROM bills WHERE patient_id = ?').run(id);
    // Lab orders + their items
    db.prepare('DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE patient_id = ?)').run(id);
    db.prepare('DELETE FROM lab_orders WHERE patient_id = ?').run(id);
    // Radiology orders + their items
    deleteRadiologyForPatient(db, id);
    // Pharmacy sales + items (now safe because dispensing_register no longer references them).
    db.prepare('DELETE FROM pharmacy_sale_payments WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)').run(id);
    db.prepare('DELETE FROM pharmacy_sale_items WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)').run(id);
    db.prepare('DELETE FROM pharmacy_sales WHERE patient_id = ?').run(id);
    // IP admissions
    db.prepare('DELETE FROM ip_admissions WHERE patient_id = ?').run(id);
    // Consultations directly reference patients with no CASCADE — usually deleted via appointment cascade,
    // but orphans (consultations whose appointment was somehow removed) would block. Belt-and-braces:
    db.prepare('DELETE FROM consultations WHERE patient_id = ?').run(id);
    // Now delete patient — appointments + their cascades (consultations/Rx/EMR) handle the rest.
    db.prepare('DELETE FROM patients WHERE id = ?').run(id);
  };

  /**
   * How the fictional sample patients are recognised.
   *
   * seedSampleData numbers them MMC1000, MMC1001, … while every real patient
   * gets a UHID from nextUHID() in the form PT-YYYYMMDD-NNNN. The two can never
   * collide, so this pattern identifies invented records exactly — which is what
   * makes removing them safe on a database that also holds real patients.
   */
  const SAMPLE_UHID_SQL = "uhid GLOB 'MMC[0-9][0-9][0-9][0-9]'";

  /** How many fictional patients are sitting in this database right now. */
  ipcMain.handle('admin:sampleDataCount', (_e) => {
    try {
      const db = getDb();
      const row = db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE ${SAMPLE_UHID_SQL}`).get() as { c: number };
      return { ok: true as const, patients: row.c };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not check for sample data.' };
    }
  });

  /**
   * Remove every fictional sample patient and everything attached to them.
   *
   * Loading demo data into a live clinic database is an easy mistake and, until
   * now, a permanent one — 50 invented patients and ~100 invented bills mixed
   * into real records with no way to separate them. This is the undo. It touches
   * ONLY the MMC-numbered records, so real patients, their bills and their
   * history are never at risk.
   */
  ipcMain.handle('admin:removeSampleData', (_e) => {
    requireRole([], 'remove sample data');
    try {
      const db = getDb();
      const ids = (db.prepare(`SELECT id FROM patients WHERE ${SAMPLE_UHID_SQL}`).all() as { id: number }[]).map((r) => r.id);
      if (!ids.length) return { ok: true as const, removed: 0, note: 'No sample patients found — nothing to remove.' };

      let removed = 0;
      db.transaction(() => {
        for (const id of ids) { purgePatient(db, id); removed++; }
        logAudit(db, actor(), 'sample_data_removed', 'patients', undefined, `Removed ${removed} fictional patients and their records`);
      })();
      return {
        ok: true as const,
        removed,
        note: `Removed ${removed} sample patient${removed === 1 ? '' : 's'} and every bill, sale, lab order and admission belonging to them. Real patients were not touched.`,
      };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not remove the sample data.' };
    }
  });

  ipcMain.handle('admin:deletePatient', (_e, patientId: number, adminPassword?: string) => {
    requireRole([], 'delete a patient');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    const p = db.prepare('SELECT uhid, first_name, last_name FROM patients WHERE id=?').get(patientId) as any;
    if (!p) return { ok: false, error: 'Patient not found' };
    const held = moneyOf(db, patientId);
    const whole = db.prepare('SELECT * FROM patients WHERE id=?').get(patientId);
    const tx = db.transaction(() => purgePatient(db, patientId));
    try { tx(); } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, actor(), 'patient_deleted', 'patients', patientId, `${p.uhid} ${p.first_name} ${p.last_name} · erased with ${held} · snapshot ${snapshotText({ patient: whole })}`);
    return { ok: true, patient: p };
  });

  /**
   * Deleting a consultation, a visit or a bill needs the ADMIN PASSWORD typed again for that one deletion — checked here in the
   * main process (the "admin unlocked" lock on a screen is never trusted for this), with the same wrong-password slow-down as the
   * unlock screen. Returns null when the password is right, else the message to show.
   */
  const adminPasswordProblem = (password: unknown): string | null => {
    if (!checkRateLimit('admin_unlock')) return 'Too many wrong passwords — wait a little and try again.';
    const db = getDb();
    const stored = getAllSettings(db).admin_password || '1234';
    if (typeof password !== 'string' || password === '') return 'Wrong admin password.';      // nothing typed is not a guess: not counted
    if (!verifyAdminPassword(password, stored)) {
      recordAuthFailure('admin_unlock');
      logAudit(db, actor(), 'delete_password_wrong');
      return 'Wrong admin password.';
    }
    clearAuthFailures('admin_unlock');
    return null;
  };
  /** A compact copy of what is being erased, kept in the audit log so a deletion can always be traced and the record rebuilt by hand. */
  const snapshotText = (o: unknown) => { try { return JSON.stringify(o).slice(0, 9000); } catch { return ''; } };
  const rowsOf = (db: any, sql: string, ...p: any[]): any[] => { try { return db.prepare(sql).all(...p); } catch { return []; } };

  ipcMain.handle('admin:deleteAppointment', (_e, appointmentId: number, adminPassword?: string) => {
    requireRole([], 'delete an appointment');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    const a = db
      .prepare(
        `SELECT a.id, a.token_number, a.appointment_date, a.appointment_time,
                (p.first_name || ' ' || p.last_name) as patient_name, p.uhid
         FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=?`
      )
      .get(appointmentId) as any;
    if (!a) return { ok: false, error: 'Appointment not found' };
    const snapshot = {
      appointment: db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId),
      consultation: db.prepare('SELECT * FROM consultations WHERE appointment_id=?').get(appointmentId) ?? null,
      prescription: rowsOf(db, 'SELECT drug_name, dosage, frequency, duration FROM prescription_items WHERE appointment_id=? ORDER BY order_idx', appointmentId),
      bills: rowsOf(db, 'SELECT bill_number, total, amount_paid, payment_mode, status FROM bills WHERE appointment_id=?', appointmentId),
      lab_orders: rowsOf(db, 'SELECT order_number, status FROM lab_orders WHERE appointment_id=?', appointmentId),
      pharmacy_sales: rowsOf(db, 'SELECT sale_number, total FROM pharmacy_sales WHERE appointment_id=?', appointmentId),
    };
    const tx = db.transaction(() => {
      // A later visit's free-follow-up bill may name this visit as its "parent": forget that link (the follow-up bill itself stays).
      db.prepare('UPDATE bills SET followup_parent_appt_id = NULL WHERE followup_parent_appt_id = ?').run(appointmentId);
      restoreDispensedStock(db, 'dr.sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)', appointmentId);
      // Dispensing register has RESTRICT FKs on pharmacy_sales/_items — must clear first.
      db.prepare('DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)').run(appointmentId);
      // Delete bills tied to this specific appointment (NOT NULL patient_id is fine — the bill goes away entirely)
      db.prepare('DELETE FROM bills WHERE appointment_id = ?').run(appointmentId);
      // Lab orders + items linked to this appointment
      db.prepare('DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE appointment_id = ?)').run(appointmentId);
      db.prepare('DELETE FROM lab_orders WHERE appointment_id = ?').run(appointmentId);
      // Radiology orders + items linked to this appointment
      deleteRadiologyForAppointment(db, appointmentId);
      // Pharmacy sales linked to this appointment (now safe — dispensing_register cleared above).
      db.prepare('DELETE FROM pharmacy_sale_payments WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)').run(appointmentId);
      db.prepare('DELETE FROM pharmacy_sale_items WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)').run(appointmentId);
      db.prepare('DELETE FROM pharmacy_sales WHERE appointment_id = ?').run(appointmentId);
      // Now delete the appointment — consultation + Rx cascade
      db.prepare('DELETE FROM appointments WHERE id = ?').run(appointmentId);
    });
    try { tx(); } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, actor(), 'appointment_deleted', 'appointments', appointmentId,
      `Token #${a.token_number} · ${a.uhid} ${a.patient_name} · ${a.appointment_date} ${a.appointment_time} · erased with ${snapshot.consultation ? '1 consultation, ' : ''}${snapshot.bills.length} bill(s), ${snapshot.lab_orders.length} lab order(s), ${snapshot.pharmacy_sales.length} pharmacy sale(s) · snapshot ${snapshotText(snapshot)}`);
    broadcastNetworkEvent('appointment:updated', { appointmentId });
    return { ok: true, appointment: a };
  });

  // Delete the doctor's CONSULTATION for a visit: the notes (history, vitals, examination, impression, advice, follow-up date) and the
  // prescription lines written for it. The visit itself, its bill and any lab / radiology orders stay.
  ipcMain.handle('admin:deleteConsultation', (_e, appointmentId: number, adminPassword?: string) => {
    requireRole([], 'delete a consultation');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    const c = db.prepare(
      `SELECT c.*, a.token_number, a.appointment_date, p.uhid, (p.first_name || ' ' || p.last_name) AS patient_name
         FROM consultations c JOIN appointments a ON a.id = c.appointment_id JOIN patients p ON p.id = c.patient_id
        WHERE c.appointment_id = ?`
    ).get(appointmentId) as any;
    if (!c) return { ok: false, error: 'This visit has no consultation recorded.' };
    const rx = rowsOf(db, 'SELECT drug_name, dosage, frequency, duration, instructions FROM prescription_items WHERE appointment_id=? ORDER BY order_idx', appointmentId);
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM prescription_items WHERE appointment_id = ?').run(appointmentId);
        db.prepare('DELETE FROM consultations WHERE id = ?').run(c.id);
      })();
    } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, actor(), 'consultation_deleted', 'consultations', c.id,
      `Token #${c.token_number} · ${c.uhid} ${c.patient_name} · ${c.appointment_date} · erased with ${rx.length} prescription line(s) · snapshot ${snapshotText({ consultation: c, prescription: rx })}`);
    broadcastNetworkEvent('appointment:updated', { appointmentId });
    return { ok: true, consultation: { id: c.id, token_number: c.token_number, uhid: c.uhid, patient_name: c.patient_name, appointment_date: c.appointment_date, prescription_lines: rx.length } };
  });

  // Delete a PHARMACY counter sale: the sale, its lines and payments, and its dispensing-register rows — the medicines go back on the shelf.
  // (Erasing a register row of a Schedule H medicine removes a legal record, which is why this asks for the admin password.)
  // A sale charged to an in-patient's bill is not deletable here: it is a line on that bill.
  ipcMain.handle('admin:deleteSale', (_e, saleId: number, adminPassword?: string) => {
    requireRole([], 'delete a pharmacy sale');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    const s = db.prepare(
      `SELECT s.*, COALESCE(p.uhid, '') AS uhid, COALESCE(p.first_name || ' ' || p.last_name, s.customer_name, '') AS who
         FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id WHERE s.id = ?`
    ).get(saleId) as any;
    if (!s) return { ok: false, error: 'Sale not found' };
    if (s.payment_mode === 'IPD-bill') {
      return { ok: false, error: `${s.sale_number} was charged to an in-patient's bill. It is a line on that bill — remove the line there instead.` };
    }
    const items = rowsOf(db, 'SELECT drug_name, qty, rate, amount FROM pharmacy_sale_items WHERE sale_id=? ORDER BY id', saleId);
    const payments = rowsOf(db, 'SELECT * FROM pharmacy_sale_payments WHERE sale_id=? ORDER BY id', saleId);
    const register = rowsOf(db, 'SELECT batch_no, qty, rate, schedule FROM dispensing_register WHERE sale_id=? ORDER BY id', saleId);
    try {
      db.transaction(() => {
        restoreDispensedStock(db, 'dr.sale_id = ?', saleId);
        db.prepare('DELETE FROM dispensing_register WHERE sale_id = ?').run(saleId);
        db.prepare('DELETE FROM pharmacy_sale_payments WHERE sale_id = ?').run(saleId);
        db.prepare('DELETE FROM pharmacy_sale_items WHERE sale_id = ?').run(saleId);
        db.prepare('DELETE FROM pharmacy_sales WHERE id = ?').run(saleId);
      })();
    } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, actor(), 'pharmacy_sale_deleted', 'pharmacy_sales', saleId,
      `${s.sale_number} · ${s.uhid} ${s.who} · total ₹${money(s.total)} · ${items.length} line(s), ${register.length} register row(s), ${payments.length} payment record(s) erased; stock returned to the shelf · snapshot ${snapshotText({ sale: s, items, payments, register })}`);
    broadcastNetworkEvent('bill:updated', { saleId });
    return { ok: true, sale: { id: saleId, sale_number: s.sale_number, total: s.total, who: s.who } };
  });

  // Delete ANY bill (consultation, lab, radiology, services…) — the bill, its lines and its payment records. Money that was received on it
  // disappears from the books with it; "Cancel bill" is the way to keep a refund on record. In-patient admission bills are not deletable.
  ipcMain.handle('admin:deleteBill', (_e, billId: number, adminPassword?: string) => {
    requireRole([], 'delete a bill');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    const b = db.prepare(
      `SELECT b.*, COALESCE(p.uhid, '') AS uhid, COALESCE(p.first_name || ' ' || p.last_name, '') AS patient_name
         FROM bills b LEFT JOIN patients p ON p.id = b.patient_id WHERE b.id = ?`
    ).get(billId) as any;
    if (!b) return { ok: false, error: 'Bill not found' };
    const admission = db.prepare('SELECT id FROM ip_admissions WHERE bill_id = ?').get(billId);
    if (b.admission_id != null || b.bill_type === 'ipd' || admission) {
      return { ok: false, error: `${b.bill_number} is an in-patient bill. It belongs to an admission and is closed at discharge — to take a charge off it, remove the line or give a discount.` };
    }
    const items = rowsOf(db, 'SELECT description, qty, rate, amount, gst_rate FROM bill_items WHERE bill_id=? ORDER BY id', billId);
    const payments = rowsOf(db, 'SELECT amount, payment_mode, received_at, reference FROM bill_payments WHERE bill_id=? ORDER BY id', billId);
    const { items_json: _drop, ...header } = b;
    try { db.transaction(() => { db.prepare('DELETE FROM bills WHERE id = ?').run(billId); })(); }
    catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, actor(), 'bill_deleted', 'bills', billId,
      `${b.bill_number} · ${b.uhid} ${b.patient_name} · total ₹${money(b.total)} · received ₹${money(Number(b.amount_paid) || 0)} · ${items.length} line(s), ${payments.length} payment record(s) erased · snapshot ${snapshotText({ bill: header, items, payments })}`);
    broadcastNetworkEvent('bill:updated', { billId });
    return { ok: true, bill: { id: billId, bill_number: b.bill_number, total: b.total, amount_paid: b.amount_paid, patient_name: b.patient_name } };
  });

  ipcMain.handle('admin:deletePatients', (_e, patientIds: number[], adminPassword?: string) => {
    requireRole([], 'delete patients');
    const bad = adminPasswordProblem(adminPassword);
    if (bad) return { ok: false, error: bad };
    const db = getDb();
    if (!Array.isArray(patientIds) || patientIds.length === 0) return { ok: true, deleted: 0 };
    const sel = db.prepare('SELECT uhid, first_name, last_name FROM patients WHERE id=?');
    const tx = db.transaction((ids: number[]) => {
      let count = 0;
      const audits: { id: number; label: string }[] = [];
      for (const id of ids) {
        const p = sel.get(id) as any;
        if (!p) continue;
        const held = moneyOf(db, id);
        purgePatient(db, id);
        audits.push({ id, label: `${p.uhid} ${p.first_name} ${p.last_name} · erased with ${held}` });
        count++;
      }
      // Log audit entries inside the same tx
      for (const a of audits) logAudit(db, actor(), 'patient_deleted', 'patients', a.id, a.label);
      return count;
    });
    try {
      const deleted = tx(patientIds);
      return { ok: true, deleted };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Bulk delete failed' };
    }
  });
  ipcMain.handle('audit:log', (_e, user: SessionUser | null, action: string, entity?: string, entity_id?: number, details?: string) => {
    logAudit(getDb(), user, action, entity, entity_id, details);
  });

  // ===== Patients =====
  ipcMain.handle('patients:search', (_e, q: string, opts: { window?: string; sort?: string } = {}) => {
    const db = getDb();
    const like = `%${q.trim()}%`;
    const activity = "COALESCE((SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id), date(p.created_at, 'localtime'))";
    const ORDER: Record<string, string> = {
      recent: `${activity} DESC`,
      registered: 'p.created_at DESC',
      name: "lower(p.first_name || ' ' || p.last_name) ASC",
    };
    const orderBy = ORDER[opts.sort || ''] || `${activity} DESC`;
    if (!q.trim()) {
      // Default (no search) list: patients within the chosen window, so a
      // 50,000-patient database still opens instantly. A search (below) always
      // scans the whole table, so nobody is hidden. The window defaults to the
      // Settings value but the Reception UI can override it per-view.
      const win = opts.window || (getAllSettings(db) as any).records_list_window || 'month';
      const DAYS: Record<string, number> = { week: 7, month: 31, quarter: 92 };
      const days = DAYS[win];   // 'all' → undefined → no date restriction
      const windowClause = days ? `WHERE ${activity} >= date('now', 'localtime', '-${days} days')` : '';
      return db
        .prepare(
          `SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit
           FROM patients p ${windowClause}
           ORDER BY ${orderBy} LIMIT 100`
        )
        .all();
    }
    return db
      .prepare(
        `SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit
         FROM patients p
         WHERE p.uhid LIKE ? OR p.phone LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ?
         ORDER BY ${orderBy} LIMIT 50`
      )
      .all(like, like, like);
  });

  ipcMain.handle('patients:get', (_e, id: number) => {
    return getDb().prepare('SELECT * FROM patients WHERE id=?').get(id);
  });

  // Full patient master — searchable by name / UHID / phone / place, sortable by
  // registration date, name or age. Used by the "All Patients" directory.
  ipcMain.handle('patients:allList', (_e, filter: { q?: string; sort?: string; limit?: number } = {}) => {
    const db = getDb();
    const q = (filter.q || '').trim();
    const params: any[] = [];
    let where = '';
    if (q) {
      where = `WHERE (p.uhid LIKE ? OR p.phone LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ? OR p.place LIKE ? OR p.district LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const ORDER: Record<string, string> = {
      registered_desc: 'p.created_at DESC, p.id DESC',
      registered_asc: 'p.created_at ASC, p.id ASC',
      name_asc: "(p.first_name || ' ' || p.last_name) COLLATE NOCASE ASC",
      name_desc: "(p.first_name || ' ' || p.last_name) COLLATE NOCASE DESC",
      age_desc: '(p.dob IS NULL), p.dob ASC',   // oldest first
      age_asc: '(p.dob IS NULL), p.dob DESC',    // youngest first
    };
    const order = ORDER[filter.sort || 'registered_desc'] || ORDER.registered_desc;
    const limit = Math.min(Math.max(Number(filter.limit) || 1000, 1), 5000);
    params.push(limit);
    const rows = db.prepare(
      `SELECT p.id, p.uhid, p.first_name, p.last_name, p.dob, p.gender, p.phone, p.place, p.district, p.blood_group, p.created_at,
              (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) AS last_visit,
              (SELECT COUNT(*) FROM appointments WHERE patient_id=p.id AND status<>'Cancelled') AS visit_count
       FROM patients p ${where} ORDER BY ${order} LIMIT ?`
    ).all(...params);
    const total = (db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c;
    return { rows, total };
  });

  /** The fields a patient record cannot exist without — named in plain words when one is missing. */
  function requirePatientFields(input: any) {
    if (!String(input?.first_name ?? '').trim()) throw new Error("Enter the patient's first name.");
    if (!String(input?.phone ?? '').trim()) throw new Error("Enter the patient's phone number.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input?.dob ?? ''))) throw new Error("Enter the patient's date of birth.");
    if (!['M', 'F', 'Other'].includes(input?.gender)) throw new Error("Choose the patient's gender.");
  }

  ipcMain.handle('patients:create', (_e, input: PatientInput) => {
    requirePatientFields(input);
    const db = getDb();
    const uhid = generateUHID();
    const stmt = db.prepare(
      `INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state, profession)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uhid,
      input.first_name.trim(),
      (input.last_name || '').trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      input.place?.trim() || null,
      input.district?.trim() || null,
      input.state?.trim() || null,
      input.profession?.trim() || null
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('patients:update', (_e, id: number, input: PatientInput) => {
    requirePatientFields(input);
    const db = getDb();
    if (!db.prepare('SELECT id FROM patients WHERE id=?').get(id)) throw new Error('That patient was not found.');
    db.prepare(
      `UPDATE patients SET first_name=?, last_name=?, dob=?, gender=?, phone=?, email=?, address=?, blood_group=?, place=?, district=?, state=?, profession=? WHERE id=?`
    ).run(
      input.first_name.trim(),
      (input.last_name || '').trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      input.place?.trim() || null,
      input.district?.trim() || null,
      input.state?.trim() || null,
      input.profession?.trim() || null,
      id
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  });

  // Distinct places/districts for autocomplete
  ipcMain.handle('patients:knownPlaces', () => {
    const db = getDb();
    const places = db
      .prepare("SELECT DISTINCT place FROM patients WHERE place IS NOT NULL AND place <> '' ORDER BY place")
      .all() as { place: string }[];
    const districts = db
      .prepare("SELECT DISTINCT district FROM patients WHERE district IS NOT NULL AND district <> '' ORDER BY district")
      .all() as { district: string }[];
    return {
      places: places.map((r) => r.place),
      districts: districts.map((r) => r.district),
    };
  });

  ipcMain.handle('patients:recentAppointments', (_e, patientId: number, limit = 5) => {
    return getDb()
      .prepare(
        `SELECT a.*, d.name as doctor_name, d.specialty as doctor_specialty
         FROM appointments a JOIN doctors d ON d.id=a.doctor_id
         WHERE a.patient_id=? ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ?`
      )
      .all(patientId, limit);
  });

  // ===== Doctors =====
  ipcMain.handle('doctors:list', (_e, activeOnly = true) => {
    const db = getDb();
    return activeOnly
      ? db.prepare('SELECT * FROM doctors WHERE is_active=1 ORDER BY name').all()
      : db.prepare('SELECT * FROM doctors ORDER BY is_active DESC, name').all();
  });

  ipcMain.handle('doctors:get', (_e, id: number) => {
    return getDb().prepare('SELECT * FROM doctors WHERE id=?').get(id);
  });

  ipcMain.handle('doctors:create', (_e, d: Partial<Doctor>) => {
    if (!String(d?.name ?? '').trim()) throw new Error("Enter the doctor's name.");
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO doctors (name, specialty, phone, email, room_number, is_active, default_fee, signature, qualifications, registration_no, color, available_from, available_to, template_id, template_id_2, template_id_3, template_slot_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null,
        d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null,
        d.qualifications ?? null, d.registration_no ?? null, d.color ?? null,
        d.available_from || null, d.available_to || null,
        d.template_id ?? null, d.template_id_2 ?? null, d.template_id_3 ?? null,
        d.template_slot_names ?? null
      );
    return db.prepare('SELECT * FROM doctors WHERE id=?').get(info.lastInsertRowid);
  });

  // ===== Referrals — the managed list behind the "Referral" field on an appointment: Google, Self, Family, an outside
  // doctor's name… Free text that prints exactly as typed (no "Dr." is added). Added/edited in Settings. =====
  // (The table is still called referring_doctors — it began as a list of outside doctors.)
  ipcMain.handle('referringDoctors:list', (_e, activeOnly = true) => {
    return getDb()
      .prepare(`SELECT * FROM referring_doctors ${activeOnly ? 'WHERE is_active=1' : ''} ORDER BY name COLLATE NOCASE`)
      .all();
  });
  ipcMain.handle('referringDoctors:create', (_e, d: { name: string; qualification?: string | null; place?: string | null; phone?: string | null }) => {
    const db = getDb();
    const name = String(d?.name || '').trim();
    if (!name) throw new Error('Referral name is required.');
    const info = db
      .prepare('INSERT INTO referring_doctors (name, qualification, place, phone, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(name, d.qualification?.trim() || null, d.place?.trim() || null, d.phone?.trim() || null);
    return db.prepare('SELECT * FROM referring_doctors WHERE id=?').get(info.lastInsertRowid);
  });
  ipcMain.handle('referringDoctors:update', (_e, id: number, d: { name?: string; qualification?: string | null; place?: string | null; phone?: string | null; is_active?: number }) => {
    const db = getDb();
    const name = d.name !== undefined ? String(d.name).trim() : undefined;
    if (name !== undefined && !name) throw new Error('Referral name is required.');
    db.prepare(
      'UPDATE referring_doctors SET name=COALESCE(?,name), qualification=?, place=?, phone=?, is_active=COALESCE(?,is_active) WHERE id=?'
    ).run(name ?? null, d.qualification?.trim() || null, d.place?.trim() || null, d.phone?.trim() || null, d.is_active ?? null, id);
    return db.prepare('SELECT * FROM referring_doctors WHERE id=?').get(id);
  });
  ipcMain.handle('referringDoctors:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM referring_doctors WHERE id=?').run(id);
    return { ok: true };
  });

  // Every table that references doctors(id) — must all be counted, otherwise hard delete
  // succeeds the count check but FK-fails at the DELETE itself.
  const countDoctorRefs = (db: any, id: number) => {
    const c = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c;
    return {
      appointments: c('SELECT COUNT(*) as c FROM appointments WHERE doctor_id=?'),
      consultations: c('SELECT COUNT(*) as c FROM consultations WHERE doctor_id=?'),
      lab_orders: c('SELECT COUNT(*) as c FROM lab_orders WHERE doctor_id=?'),
      radiology_orders: c('SELECT COUNT(*) as c FROM radiology_orders WHERE doctor_id=?'),
      ip_admissions: c('SELECT COUNT(*) as c FROM ip_admissions WHERE admission_doctor_id=?'),
      dispensed: c('SELECT COUNT(*) as c FROM dispensing_register WHERE doctor_id=?'),
      user_accounts: c('SELECT COUNT(*) as c FROM users WHERE doctor_id=?'),
    };
  };

  ipcMain.handle('doctors:dependents', (_e, id: number) => {
    const db = getDb();
    const counts = countDoctorRefs(db, id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total };
  });

  ipcMain.handle('doctors:delete', (_e, id: number) => {
    const db = getDb();
    const doc = db.prepare('SELECT name FROM doctors WHERE id=?').get(id) as { name: string } | undefined;
    if (!doc) return { ok: false, error: 'Doctor not found' };

    const counts = countDoctorRefs(db, id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (total === 0) {
      try {
        db.prepare('DELETE FROM doctors WHERE id=?').run(id);
        logAudit(db, actor(), 'doctor_deleted', 'doctors', id, doc.name);
        return { ok: true, mode: 'hard_deleted' as const, doctorName: doc.name };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    }

    // Has historical records — refuse hard delete; caller should use 'doctors:deactivate'
    return {
      ok: false,
      mode: 'has_records' as const,
      counts,
      total,
      doctorName: doc.name,
      error: `Cannot permanently delete — Dr. ${doc.name} has ${total} historical record(s).`,
    };
  });

  ipcMain.handle('doctors:deactivate', (_e, id: number) => {
    const db = getDb();
    const doc = db.prepare('SELECT name FROM doctors WHERE id=?').get(id) as { name: string } | undefined;
    if (!doc) return { ok: false, error: 'Doctor not found' };
    db.prepare('UPDATE doctors SET is_active=0 WHERE id=?').run(id);
    logAudit(db, actor(), 'doctor_deactivated', 'doctors', id, doc.name);
    return { ok: true, doctorName: doc.name };
  });

  ipcMain.handle('doctors:update', (_e, id: number, d: Partial<Doctor>) => {
    const db = getDb();
    db.prepare(
      'UPDATE doctors SET name=?, specialty=?, phone=?, email=?, room_number=?, is_active=?, default_fee=?, signature=?, qualifications=?, registration_no=?, color=?, available_from=?, available_to=?, template_id=?, template_id_2=?, template_id_3=?, template_slot_names=? WHERE id=?'
    ).run(
      d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null,
      d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null,
      d.qualifications ?? null, d.registration_no ?? null, d.color ?? null,
      d.available_from || null, d.available_to || null,
      d.template_id ?? null, d.template_id_2 ?? null, d.template_id_3 ?? null,
      d.template_slot_names ?? null, id
    );
    return db.prepare('SELECT * FROM doctors WHERE id=?').get(id);
  });

  // ===== Appointments =====
  ipcMain.handle(
    'appointments:bookedSlots',
    (_e, doctorId: number, date: string) => {
      return getDb()
        .prepare(
          "SELECT appointment_time FROM appointments WHERE doctor_id=? AND appointment_date=? AND status <> 'Cancelled'"
        )
        .all(doctorId, date);
    }
  );

  // ===== Booking a visit — and, in ONE all-or-nothing step, its bill =====
  type AppointmentCreateIn = Omit<Appointment, 'id' | 'created_at' | 'token_number' | 'consultation_token' | 'status'> & { status?: AppointmentStatus };
  type BillCreateIn = {
    appointment_id: number | null;
    patient_id: number;
    items: BillItem[];
    discount: number;
    discount_type: 'flat' | 'percent';
    payment_mode: PaymentMode;
    // Follow-up flags — set by the booking modal when the consultation is waived
    // because the patient is inside their free-follow-up window or got a courtesy grant.
    is_free_followup?: number;
    is_relaxed_followup?: number;
    followup_parent_appt_id?: number | null;
    // 1 = the bill INCLUDES a registration-fee line item; flips the patient flag.
    marks_registration_fee_paid?: number;
    discount_reason?: string | null;
  };

  /**
   * Everything a booking writes to the database: the guards (doctor's hours, double booking), the clinic-wide token, the visit number, the row,
   * and the confirmation / doctor-alert log lines. Throws before writing anything if a guard refuses. Shared by appointments:create and
   * appointments:createWithBill, so a visit and its bill can be one step. The live "queue +1" event is NOT sent from here — see announceBooking.
   */
  const insertAppointment = (db: Database.Database, payload: AppointmentCreateIn): AppointmentWithJoins => {

    // === Guard 1: doctor's daily availability window ===
    // If the doctor has available_from / available_to set (HH:MM strings),
    // refuse bookings outside that window. Empty = no constraint.
    const docHours = db
      .prepare('SELECT name, available_from, available_to FROM doctors WHERE id=?')
      .get(payload.doctor_id) as { name: string; available_from: string | null; available_to: string | null } | undefined;
    if (docHours?.available_from && docHours?.available_to && payload.appointment_time) {
      const t = payload.appointment_time;
      // String compare works because all are HH:MM zero-padded.
      if (t < docHours.available_from || t > docHours.available_to) {
        throw new Error(
          `${docHours.name} is only available between ${docHours.available_from} and ${docHours.available_to}. The slot ${t} is outside that window.`
        );
      }
    }

    // === Guard 2: double-booking ===
    // No two non-cancelled appointments for the same doctor at the same minute.
    if (payload.appointment_time) {
      const clash = db
        .prepare(
          "SELECT id, token_number FROM appointments WHERE doctor_id=? AND appointment_date=? AND appointment_time=? AND status <> 'Cancelled' LIMIT 1"
        )
        .get(payload.doctor_id, payload.appointment_date, payload.appointment_time) as { id: number; token_number: number } | undefined;
      if (clash) {
        throw new Error(
          `That time slot (${payload.appointment_time}) is already booked for ${docHours?.name || 'this doctor'} (Token #${clash.token_number}). Pick a different time.`
        );
      }
    }

    // Clinic-wide token: serial number of this patient across ALL doctors for the day.
    const tokenRow = db
      .prepare(
        "SELECT COALESCE(MAX(token_number), 0) as mx FROM appointments WHERE appointment_date=?"
      )
      .get(payload.appointment_date) as { mx: number };
    const token = tokenRow.mx + 1;

    // Visit ID — the patient's nth visit, printed as UHID/V{n}.
    // Single definition, stored on the row, so the slip, the WhatsApp message
    // and patient search all quote the same identifier. Previously the slip
    // showed a non-unique label while WhatsApp showed UHID/V{global row id}.
    const patient = db.prepare('SELECT uhid FROM patients WHERE id=?').get(payload.patient_id) as { uhid: string } | undefined;
    if (!patient) {
      throw new Error(`Cannot book appointment: patient id ${payload.patient_id} was not found. The patient may have been deleted.`);
    }
    const visitNumber = nextVisitNumber(db, payload.patient_id);
    const visitId = formatVisitId(patient.uhid, visitNumber);

    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, consultation_token, visit_number, visit_id, status, notes, patient_group, procedure_tags, referred_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.patient_id,
        payload.doctor_id,
        payload.appointment_date,
        payload.appointment_time,
        token,
        visitId,
        visitNumber,
        visitId,
        payload.status ?? (getAllSettings(db).queue_flow_enabled ? 'Waiting' : 'Done'),
        payload.notes ?? null,
        (payload as any).patient_group ?? null,
        (payload as any).procedure_tags ?? null,
        ((payload as any).referred_by ?? null) || null
      );

    const created = db
      .prepare(
        `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
      )
      .get(info.lastInsertRowid) as AppointmentWithJoins;

    // Trigger notifications
    const notif = new NotificationService(db);
    const patientRow = db.prepare('SELECT * FROM patients WHERE id=?').get(payload.patient_id) as Patient;
    const doctor = db.prepare('SELECT * FROM doctors WHERE id=?').get(payload.doctor_id) as Doctor;
    const settings = getAllSettings(db);
    notif.sendAppointmentConfirmation(patientRow, created, doctor, settings.clinic_name);
    notif.sendDoctorAlert(doctor, created, patientRow);

    return created;
  };
  /** After the booking is safely saved: tell the other screens (doctor cabin "queue +1", reception list). */
  const announceBooking = (created: AppointmentWithJoins) => {
    try { broadcastNetworkEvent('appointment:new', { id: created.id, doctor_id: created.doctor_id, token_number: created.token_number, patient_name: created.patient_name }); } catch { /* ignore */ }

  };

  ipcMain.handle('appointments:create', (_e, payload: AppointmentCreateIn) => {
    const db = getDb();
    const created = db.transaction(() => insertAppointment(db, payload))();   // the visit and its log lines are saved together or not at all
    announceBooking(created);
    return created;
  });

  ipcMain.handle(
    'appointments:list',
    (_e, filter: { date?: string; doctor_id?: number; status?: AppointmentStatus }) => {
      const db = getDb();
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (filter?.date) {
        conditions.push('a.appointment_date = ?');
        params.push(filter.date);
      }
      if (filter?.doctor_id) {
        conditions.push('a.doctor_id = ?');
        params.push(filter.doctor_id);
      }
      if (filter?.status) {
        conditions.push('a.status = ?');
        params.push(filter.status);
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      return db
        .prepare(
          `SELECT a.*,
            (p.first_name || ' ' || p.last_name) as patient_name,
            p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
            p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
            d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room,
            (SELECT b.id FROM bills b WHERE b.appointment_id = a.id AND COALESCE(b.status,'') <> 'cancelled' AND b.cancelled_at IS NULL
              ORDER BY b.id DESC LIMIT 1) as bill_id
          FROM appointments a
          JOIN patients p ON p.id=a.patient_id
          JOIN doctors d ON d.id=a.doctor_id
          ${where}
          ORDER BY a.token_number ASC`
        )
        .all(...params);
    }
  );

  ipcMain.handle('appointments:updateStatus', (_e, id: number, status: AppointmentStatus, expectedVersion?: number) => {
    const db = getDb();
    // Optimistic locking — when the caller passes its last-seen row_version, we
    // compare-and-swap so two stations changing the same appointment concurrently
    // produce a clear "ConflictError" for the loser instead of silent overwrite.
    // Backwards compatible: if expectedVersion is undefined (older renderer or
    // pre-multistation install), fall back to plain last-write-wins UPDATE.
    if (typeof expectedVersion === 'number') {
      const info = db.prepare(
        'UPDATE appointments SET status=?, row_version=row_version+1 WHERE id=? AND row_version=?'
      ).run(status, id, expectedVersion);
      if (info.changes === 0) {
        const current = db.prepare('SELECT row_version, status FROM appointments WHERE id=?').get(id) as { row_version: number; status: string } | undefined;
        if (!current) throw new Error('Appointment not found');
        const err: any = new Error(`Conflict — another station already changed this appointment to "${current.status}". Refresh and try again.`);
        err.code = 'CONFLICT';
        err.currentVersion = current.row_version;
        err.currentStatus = current.status;
        throw err;
      }
    } else {
      db.prepare('UPDATE appointments SET status=?, row_version=row_version+1 WHERE id=?').run(status, id);
    }
    const row = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
    // Live event so doctor cabin / reception screens refresh without polling.
    try { broadcastNetworkEvent('appointment:status', { id, status, doctor_id: (row as any)?.doctor_id, row_version: (row as any)?.row_version }); } catch { /* ignore */ }
    return row;
  });

  ipcMain.handle('appointments:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
      )
      .get(id);
  });

  // ===== Bills =====
  /**
   * Everything a bill for a visit (or any patient) writes: validation, the same-charge-twice guard, the bill, its lines, the registration-fee
   * flag and the visit's status — in one transaction. Returns the saved bill with its patient / doctor names. Shared by bills:create and
   * appointments:createWithBill.
   */
  const insertBill = (db: Database.Database, payload: BillCreateIn) => {
    if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('Add at least one line to the bill before saving.');
    if (!payload.patient_id || !db.prepare('SELECT id FROM patients WHERE id=?').get(payload.patient_id)) {
      throw new Error('That patient was not found — pick the patient for this bill.');
    }
    // Whole, sensible lines only: a negative or non-numeric amount would silently change what the patient owes.
    const lineItems = payload.items.map((it: any, i: number) => {
      const qty = Number(it.qty ?? 1);
      const amt = it.amount !== undefined && it.amount !== null ? Number(it.amount) : qty * Number(it.rate ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Line ${i + 1}: the quantity must be above zero.`);
      if (!Number.isFinite(amt) || amt < 0 || amt > 100_000_000) throw new Error(`Line ${i + 1}: the amount cannot be negative or enormous.`);
      const rate = Number.isFinite(Number(it.rate)) ? Number(it.rate) : amt / qty;
      return { description: String(it.description ?? '').trim() || 'Item', qty, rate: money(rate), amount: money(amt) };
    });
    const subtotal = money(lineItems.reduce((s2, it) => s2 + it.amount, 0));
    const discountIn = Number(payload.discount ?? 0);
    if (!Number.isFinite(discountIn) || discountIn < 0) throw new Error('The discount cannot be negative.');
    if (payload.discount_type === 'percent' ? discountIn > 100 : discountIn > subtotal + 0.001) {
      throw new Error('The discount is more than the bill.');
    }
    const itemsJson = JSON.stringify(lineItems);

    // The same charge sent twice (a double-click, or a retry after a reply was lost) must be ONE bill.
    // Two bills would count the consultation twice in every report and ask the patient to pay twice. Anything
    // identical — same patient, visit, lines, discount and payment mode — within the last two minutes is the
    // same request; a genuine second charge later (or with different lines) is unaffected.
    const dupe = db.prepare(
      `SELECT id FROM bills
        WHERE patient_id = ? AND appointment_id IS ? AND items_json = ? AND discount = ? AND payment_mode = ?
          AND COALESCE(status,'') <> 'cancelled' AND created_at >= datetime('now', '-120 seconds')
        ORDER BY id DESC LIMIT 1`
    ).get(payload.patient_id, payload.appointment_id ?? null, itemsJson, discountIn, payload.payment_mode) as { id: number } | undefined;

    let billId = dupe ? dupe.id : 0;
    if (!dupe) {
      const billNumber = generateBillNumber();
      // Bill, its lines, the registration flag and the appointment status move together or not at all.
      db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, amount_paid, status, is_free_followup, is_relaxed_followup, followup_parent_appt_id, discount_by, discount_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'paid', ?, ?, ?, ?, ?)`
          )
          .run(
            billNumber,
            payload.appointment_id,
            payload.patient_id,
            itemsJson,
            subtotal,
            discountIn,
            payload.discount_type === 'percent' ? 'percent' : 'flat',
            payload.payment_mode,
            new Date().toISOString(),
            payload.is_free_followup ? 1 : 0,
            payload.is_relaxed_followup ? 1 : 0,
            payload.followup_parent_appt_id ?? null,
            discountIn > 0 ? (actor()?.username ?? null) : null,
            discountIn > 0 ? (String((payload as any).discount_reason ?? '').trim().slice(0, 120) || null) : null
          );
        billId = Number(info.lastInsertRowid);

        // Real line rows as well as items_json — see the note in misc:create.
        const insLine = db.prepare(
          `INSERT INTO bill_items (bill_id, description, qty, rate, amount, is_taxable, gst_rate, hsn_sac, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'opd')`
        );
        // Consultation and procedures follow the clinical rule (exempt unless a charge head says otherwise).
        const opdTax = clinicalLineTax(db, null);
        for (const it of lineItems) {
          insLine.run(billId, it.description, it.qty, it.rate, it.amount, opdTax.is_taxable ? 1 : 0, opdTax.gst_rate, opdTax.hsn_sac);
        }
        // Totalled by the same engine as every other bill (discount, GST, round-off), then settled at the counter:
        // what is received is exactly the total, so the bill can never read as owing after it is printed.
        const t = recalcBill(db, billId, { force: true });
        db.prepare('UPDATE bills SET amount_paid=? WHERE id=?').run(t.total, billId);

        if (payload.marks_registration_fee_paid) {
          db.prepare("UPDATE patients SET registration_fee_paid=1, registration_fee_paid_at=date('now', 'localtime') WHERE id=?")
            .run(payload.patient_id);
        }

        if (payload.appointment_id) {
          db.prepare("UPDATE appointments SET status='Done' WHERE id=?").run(payload.appointment_id);
        }
      })();
    }

    const billResult = db
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name,
           p.phone as patient_phone
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN appointments a ON a.id=b.appointment_id
         LEFT JOIN doctors d ON d.id=a.doctor_id
         WHERE b.id=?`
      )
      .get(billId) as any;

    return billResult;
  };

  ipcMain.handle('bills:create', (_e, payload: BillCreateIn) => insertBill(getDb(), payload));

  /**
   * Book a visit AND raise its bill as ONE all-or-nothing step. Booking used to be two separate calls — the visit, then the bill — so a
   * refusal (or a power cut) in between left a visit with no bill. Now if anything fails, neither is saved: no visit, no bill, no token or
   * visit number used up. Returns { appointment, bill }.
   */
  ipcMain.handle('appointments:createWithBill', (_e, payload: { appointment: AppointmentCreateIn; bill: Omit<BillCreateIn, 'appointment_id' | 'patient_id'> }) => {
    const db = getDb();
    let created!: AppointmentWithJoins;
    let bill: any = null;
    db.transaction(() => {
      created = insertAppointment(db, payload.appointment);
      bill = insertBill(db, { ...payload.bill, appointment_id: created.id, patient_id: created.patient_id });
    })();
    announceBooking(created);
    return { appointment: created, bill };
  });

  ipcMain.handle('bills:list', (_e, filter: { q?: string; from?: string; to?: string }) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter?.q) {
      // A walk-in bill (raised with just a typed name) has no patient; its name is kept in the notes as "Name: …".
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR b.bill_number LIKE ? OR (b.patient_id IS NULL AND b.notes LIKE ?))");
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    if (filter?.from) {
      conditions.push("date(b.created_at, 'localtime') >= ?");
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push("date(b.created_at, 'localtime') <= ?");
      params.push(filter.to);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return db
      .prepare(
        // LEFT JOIN: this list used to skip every walk-in bill (no patient), so money that was billed and counted in
        // Accounts could not be found here.
        `SELECT b.*,
           COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''),
                    CASE WHEN b.notes LIKE 'Name: %' THEN substr(b.notes, 7) END, 'Walk-in') as patient_name,
           p.uhid as patient_uhid,
           COALESCE(da.name, db2.name) as doctor_name
         FROM bills b
         LEFT JOIN patients p ON p.id=b.patient_id
         LEFT JOIN appointments a ON a.id=b.appointment_id
         LEFT JOIN doctors da ON da.id=a.doctor_id
         LEFT JOIN doctors db2 ON db2.id=b.doctor_id
         ${where}
         ORDER BY b.created_at DESC LIMIT 200`
      )
      .all(...params);
  });

  ipcMain.handle('bills:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           COALESCE(da.name, db2.name) as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN appointments a ON a.id=b.appointment_id
         LEFT JOIN doctors da ON da.id=a.doctor_id
         LEFT JOIN doctors db2 ON db2.id=b.doctor_id
         WHERE b.id=?`
      )
      .get(id);
  });

  // ===== Miscellaneous charges (procedures, vaccinations, etc.) =====
  // Standalone bill not tied to any appointment. The receptionist picks a
  // patient + (optional) attributing doctor + a service line item + amount.
  ipcMain.handle('misc:create', (_e, payload: {
    patient_id: number;
    doctor_id: number | null;
    description: string;
    amount: number;
    payment_mode: PaymentMode;
    notes?: string | null;
  }) => {
    const db = getDb();
    if (!payload.patient_id) throw new Error('Patient is required');
    if (!payload.description?.trim()) throw new Error('Service description is required');
    payload = { ...payload, amount: money(Number(payload.amount)) };
    if (!Number.isFinite(payload.amount) || payload.amount < 0 || payload.amount > 100_000_000) throw new Error('Amount must be zero or more.');
    if (!db.prepare('SELECT id FROM patients WHERE id=?').get(payload.patient_id)) throw new Error('That patient was not found — pick the patient for this service.');
    const items = [{ description: payload.description.trim(), qty: 1, rate: payload.amount, amount: payload.amount }];
    // The same service charged twice (double-click / retry) is ONE bill: identical patient, service and amount in the last two minutes.
    {
      const dup = db.prepare(
        `SELECT b.id FROM bills b
          WHERE b.patient_id = ? AND b.bill_kind = 'misc' AND b.items_json = ? AND b.total = ?
            AND COALESCE(b.status,'') <> 'cancelled' AND b.created_at >= datetime('now', '-120 seconds')
          ORDER BY b.id DESC LIMIT 1`
      ).get(payload.patient_id, JSON.stringify(items), payload.amount) as { id: number } | undefined;
      if (dup) {
        return db.prepare(
          `SELECT b.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name
             FROM bills b JOIN patients p ON p.id=b.patient_id LEFT JOIN doctors d ON d.id=b.doctor_id WHERE b.id=?`
        ).get(dup.id);
      }
    }
    const billNumber = generateBillNumber();
    const info = db
      .prepare(
        `INSERT INTO bills
          (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, bill_kind, bill_type, amount_paid, status, notes)
         VALUES (?, NULL, ?, ?, ?, ?, 0, 'flat', ?, ?, ?, 'misc', 'misc', ?, 'paid', ?)`
      )
      .run(
        billNumber,
        payload.patient_id,
        payload.doctor_id ?? null,
        JSON.stringify(items),
        payload.amount,
        payload.amount,
        payload.payment_mode,
        new Date().toISOString(),
        // bill_type was left at its 'opd_consult' default, so every Services bill
        // was counted BOTH as OPD (bill_type) and as Misc (bill_kind) in the
        // Modules P&L. And amount_paid was never written even though paid_at was
        // stamped, so "Collected" read zero and the whole amount looked outstanding.
        payload.amount,
        payload.notes?.trim() || null
      );
    /**
     * Write the line as a real bill_items row too, not only into items_json.
     *
     * Two storage paths for the same thing is what caused a printed Services bill
     * to be re-totalled from an empty bill_items table and saved as ₹0. The
     * migration repairs the damaged rows and recalcBill now refuses to zero a
     * line-less bill, but the honest fix is for every bill to have real lines
     * from the moment it is created.
     */
    const miscBillId = Number(info.lastInsertRowid);
    // GST now applies here too — clinical work is normally exempt, but a charge
    // head the clinic marked taxable (a cosmetic procedure, say) is charged.
    const miscTax = clinicalLineTax(db, (payload as any).charge_head_id ?? null);
    db.prepare(
      `INSERT INTO bill_items (bill_id, charge_head_id, description, qty, rate, amount, is_taxable, gst_rate, hsn_sac, source)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'misc')`
    ).run(miscBillId, (payload as any).charge_head_id ?? null, payload.description.trim(), payload.amount, payload.amount,
          miscTax.is_taxable ? 1 : 0, miscTax.gst_rate, miscTax.hsn_sac);
    // Totalled like every other bill (GST for a taxable charge head, round-off), then settled for exactly that total.
    const miscTotals = recalcBill(db, miscBillId, { force: true });
    db.prepare('UPDATE bills SET amount_paid=? WHERE id=?').run(miscTotals.total, miscBillId);
    return db
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN doctors d ON d.id=b.doctor_id
         WHERE b.id=?`
      )
      .get(info.lastInsertRowid);
  });

  ipcMain.handle('misc:list', (_e, filter: { from?: string; to?: string; q?: string; doctor_id?: number } = {}) => {
    const db = getDb();
    const conds = ["b.bill_kind='misc'"];
    const params: any[] = [];
    if (filter.from) { conds.push("date(b.created_at, 'localtime') >= ?"); params.push(filter.from); }
    if (filter.to)   { conds.push("date(b.created_at, 'localtime') <= ?"); params.push(filter.to); }
    if (filter.doctor_id) { conds.push('b.doctor_id = ?'); params.push(filter.doctor_id); }
    if (filter.q) {
      conds.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR b.notes LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    return db
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN doctors d ON d.id=b.doctor_id
         WHERE ${conds.join(' AND ')}
         ORDER BY b.created_at DESC LIMIT 200`
      )
      .all(...params);
  });

  // Daily trend for the Services analytics tab — one row per calendar day in
  // the requested range with count + revenue. Used to draw the column chart.
  ipcMain.handle('misc:trend', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const today = localISO();
    const from = filter.from || today.slice(0, 8) + '01';
    const to = filter.to || today;
    return db.prepare(`
      SELECT date(b.created_at, 'localtime') as day,
             COUNT(*) as count,
             COALESCE(SUM(b.total),0) as revenue
      FROM bills b
      WHERE b.bill_kind='misc' AND COALESCE(b.status,'') <> 'cancelled' AND date(b.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY day
      ORDER BY day ASC
    `).all(from, to);
  });

  ipcMain.handle('misc:summary', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const today = localISO();
    const from = filter.from || today.slice(0, 8) + '01';
    const to = filter.to || today;
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    const count = sc(`SELECT COUNT(*) as c FROM bills WHERE bill_kind='misc' AND COALESCE(status,'') <> 'cancelled' AND date(created_at, 'localtime') BETWEEN ? AND ?`, from, to);
    const revenue = ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE bill_kind='misc' AND COALESCE(status,'') <> 'cancelled' AND date(created_at, 'localtime') BETWEEN ? AND ?`, from, to);
    const topServices = db.prepare(`
      SELECT json_extract(j.value, '$.description') as service,
             COUNT(*) as count,
             COALESCE(SUM(json_extract(j.value, '$.amount')), 0) as revenue
      FROM bills b, json_each(b.items_json) j
      WHERE b.bill_kind='misc' AND COALESCE(b.status,'') <> 'cancelled' AND date(b.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY service
      ORDER BY revenue DESC
      LIMIT 10
    `).all(from, to);
    const byDoctor = db.prepare(`
      SELECT d.name as doctor_name, d.color as doctor_color,
             COUNT(*) as count,
             COALESCE(SUM(b.total),0) as revenue
      FROM bills b
      LEFT JOIN doctors d ON d.id = b.doctor_id
      WHERE b.bill_kind='misc' AND COALESCE(b.status,'') <> 'cancelled' AND date(b.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY d.id
      ORDER BY revenue DESC
    `).all(from, to);
    return { from, to, count, revenue, topServices, byDoctor };
  });

  // ===== Free follow-up policy =====
  // Pure function: given an ISO date string + N days, return ISO date string N days later.
  // (Calendar arithmetic, not Date-in-local-midnight → toISOString(): that is the UTC date, which in India is
  // always the day BEFORE, so every follow-up window used to end a day early.)
  const addDays = (iso: string, days: number) => addDaysISO(iso, days);

  // Booking-time check: can this patient get the next consultation free with this doctor?
  // The check date defaults to today, but pre-bookings can pass a future appointment
  // date so the window comparison reflects when the visit will ACTUALLY happen, not
  // when it was booked. (A patient booking today for next month is NOT inside the
  // follow-up window even if today still is.)
  ipcMain.handle('followup:checkEligibility', (_e, patientId: number, doctorId: number, checkDate?: string) => {
    const db = getDb();
    const s = getAllSettings(db);
    if (!s.followup_enabled) {
      return { enabled: false, eligible: false, relaxed_eligible: false, free_remaining: 0, total_free: 0, valid_till: null, parent_appt_id: null, parent_appt_date: null, reason: 'disabled' };
    }
    const today = (checkDate && /^\d{4}-\d{2}-\d{2}$/.test(checkDate))
      ? checkDate
      : localISO();
    // Most recent PAID anchor visit for this patient + same doctor.
    const paid = db.prepare(`
      SELECT a.id as appt_id, a.appointment_date
      FROM bills b
      JOIN appointments a ON a.id = b.appointment_id
      WHERE b.patient_id = ?
        AND a.doctor_id = ?
        AND COALESCE(b.is_free_followup, 0) = 0
        AND COALESCE(b.is_relaxed_followup, 0) = 0
      ORDER BY a.appointment_date DESC, a.id DESC
      LIMIT 1
    `).get(patientId, doctorId) as { appt_id: number; appointment_date: string } | undefined;

    const base = {
      enabled: true,
      total_free: s.followup_free_visits,
      free_remaining: 0,
      valid_till: null as string | null,
      parent_appt_id: null as number | null,
      parent_appt_date: null as string | null,
    };

    if (!paid) {
      return { ...base, eligible: false, relaxed_eligible: false, reason: 'no_paid_visit' };
    }
    const validTill = addDays(paid.appointment_date, s.followup_window_days);
    const graceTill = addDays(paid.appointment_date, s.followup_window_days + s.followup_grace_days);
    const used = (db.prepare(`
      SELECT COUNT(*) as c FROM bills
      WHERE followup_parent_appt_id = ?
        AND (COALESCE(is_free_followup, 0) = 1 OR COALESCE(is_relaxed_followup, 0) = 1)
    `).get(paid.appt_id) as { c: number }).c;
    const remaining = Math.max(0, s.followup_free_visits - used);
    const out = {
      ...base,
      free_remaining: remaining,
      valid_till: validTill,
      parent_appt_id: paid.appt_id,
      parent_appt_date: paid.appointment_date,
    };
    if (today <= validTill && remaining > 0) {
      return { ...out, eligible: true, relaxed_eligible: false };
    }
    // Past the strict window OR all consumed — but inside grace period AND quota not yet
    // exhausted? Receptionist may grant a courtesy free visit.
    if (today <= graceTill && remaining > 0) {
      return { ...out, eligible: false, relaxed_eligible: true, reason: 'window_expired' };
    }
    if (remaining <= 0) {
      return { ...out, eligible: false, relaxed_eligible: false, reason: 'all_consumed' };
    }
    return { ...out, eligible: false, relaxed_eligible: false, reason: 'window_expired' };
  });

  // OPD-slip-time summary: AFTER an appointment has a bill, what should the
  // FOLLOW-UP / ಮರು ಭೇಟಿ box on Page 2 say?
  ipcMain.handle('followup:summaryForAppointment', (_e, appointmentId: number) => {
    const db = getDb();
    const s = getAllSettings(db);
    if (!s.followup_enabled) return { enabled: false, mode: 'hidden' };

    const appt = db.prepare(`
      SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, d.name as doctor_name
      FROM appointments a JOIN doctors d ON d.id=a.doctor_id
      WHERE a.id=?
    `).get(appointmentId) as { id: number; patient_id: number; doctor_id: number; appointment_date: string; doctor_name: string } | undefined;
    if (!appt) return { enabled: true, mode: 'hidden' };

    const bill = db.prepare(`SELECT * FROM bills WHERE appointment_id=? ORDER BY id DESC LIMIT 1`).get(appointmentId) as any;

    // Today is FREE / RELAXED → anchor is the parent visit, not today.
    if (bill && (bill.is_free_followup || bill.is_relaxed_followup)) {
      const parent = bill.followup_parent_appt_id
        ? db.prepare(`SELECT appointment_date FROM appointments WHERE id=?`).get(bill.followup_parent_appt_id) as { appointment_date: string } | undefined
        : null;
      const anchorDate = parent?.appointment_date || appt.appointment_date;
      const validTill = addDays(anchorDate, s.followup_window_days);
      const used = (db.prepare(`
        SELECT COUNT(*) as c FROM bills
        WHERE followup_parent_appt_id = ?
          AND (COALESCE(is_free_followup, 0) = 1 OR COALESCE(is_relaxed_followup, 0) = 1)
      `).get(bill.followup_parent_appt_id ?? -1) as { c: number }).c;
      const remainingAfter = Math.max(0, s.followup_free_visits - used);
      return {
        enabled: true,
        mode: bill.is_relaxed_followup ? 'today_relaxed' : 'today_free',
        doctor_name: appt.doctor_name,
        free_remaining: remainingAfter,
        valid_till: validTill,
      };
    }

    // Today is the new PAID anchor → patient gets fresh quota of N free visits.
    const validTill = addDays(appt.appointment_date, s.followup_window_days);
    return {
      enabled: true,
      mode: 'today_paid',
      doctor_name: appt.doctor_name,
      free_remaining: s.followup_free_visits,
      valid_till: validTill,
    };
  });

  // ===== EMR =====
  const emrGet = (table: string) => (_e: any, patientId: number) =>
    getDb().prepare(`SELECT * FROM ${table} WHERE patient_id=? ORDER BY id DESC`).all(patientId);

  const emrDelete = (table: string) => (_e: any, id: number) => {
    getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    return true;
  };

  ipcMain.handle('emr:allergies', emrGet('patient_allergies'));
  ipcMain.handle('emr:addAllergy', (_e, payload: { patient_id: number; allergen: string; reaction?: string; severity?: string }) => {
    const db = getDb();
    const info = db
      .prepare('INSERT INTO patient_allergies (patient_id, allergen, reaction, severity) VALUES (?, ?, ?, ?)')
      .run(payload.patient_id, payload.allergen, payload.reaction ?? null, payload.severity ?? null);
    return db.prepare('SELECT * FROM patient_allergies WHERE id=?').get(info.lastInsertRowid);
  });
  ipcMain.handle('emr:deleteAllergy', emrDelete('patient_allergies'));

  ipcMain.handle('emr:conditions', emrGet('patient_conditions'));
  ipcMain.handle('emr:addCondition', (_e, payload: { patient_id: number; condition: string; since?: string; notes?: string }) => {
    const db = getDb();
    const info = db
      .prepare('INSERT INTO patient_conditions (patient_id, condition, since, notes, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(payload.patient_id, payload.condition, payload.since ?? null, payload.notes ?? null);
    return db.prepare('SELECT * FROM patient_conditions WHERE id=?').get(info.lastInsertRowid);
  });
  ipcMain.handle('emr:deleteCondition', emrDelete('patient_conditions'));

  ipcMain.handle('emr:family', emrGet('patient_family_history'));
  ipcMain.handle('emr:addFamily', (_e, payload: { patient_id: number; relation: string; condition: string; notes?: string }) => {
    const db = getDb();
    const info = db
      .prepare('INSERT INTO patient_family_history (patient_id, relation, condition, notes) VALUES (?, ?, ?, ?)')
      .run(payload.patient_id, payload.relation, payload.condition, payload.notes ?? null);
    return db.prepare('SELECT * FROM patient_family_history WHERE id=?').get(info.lastInsertRowid);
  });
  ipcMain.handle('emr:deleteFamily', emrDelete('patient_family_history'));

  ipcMain.handle('emr:immunizations', emrGet('patient_immunizations'));
  ipcMain.handle('emr:addImmunization', (_e, payload: { patient_id: number; vaccine: string; given_at?: string; dose?: string; notes?: string }) => {
    const db = getDb();
    const info = db
      .prepare('INSERT INTO patient_immunizations (patient_id, vaccine, given_at, dose, notes) VALUES (?, ?, ?, ?, ?)')
      .run(payload.patient_id, payload.vaccine, payload.given_at ?? null, payload.dose ?? null, payload.notes ?? null);
    return db.prepare('SELECT * FROM patient_immunizations WHERE id=?').get(info.lastInsertRowid);
  });
  ipcMain.handle('emr:deleteImmunization', emrDelete('patient_immunizations'));

  ipcMain.handle('emr:documents', emrGet('patient_documents'));
  ipcMain.handle(
    'emr:addDocument',
    (_e, payload: { patient_id: number; file_name: string; file_type: string; data_base64: string; note?: string }) => {
      // Coerce the id to a positive integer so it can never contain "../".
      const pid = Number(payload.patient_id);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid patient id.');
      const dir = path.join(app.getPath('userData'), 'documents', String(pid));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = String(payload.file_name || 'file').replace(/[^\w.\-]/g, '_');
      const fileName = `${Date.now()}-${safeName}`;
      const filePath = path.join(dir, fileName);
      const buf = Buffer.from(payload.data_base64.split(',').pop() || '', 'base64');
      fs.writeFileSync(filePath, buf);
      const db = getDb();
      const info = db
        .prepare('INSERT INTO patient_documents (patient_id, file_name, file_type, file_path, size_bytes, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pid, payload.file_name, payload.file_type, filePath, buf.byteLength, payload.note ?? null);
      return db.prepare('SELECT * FROM patient_documents WHERE id=?').get(info.lastInsertRowid);
    }
  );
  ipcMain.handle('emr:openDocument', (_e, id: number) => {
    const row = getDb().prepare('SELECT file_path FROM patient_documents WHERE id=?').get(id) as any;
    if (!row?.file_path) return;
    const SAFE_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.csv']);
    const ext = path.extname(row.file_path).toLowerCase();
    if (!SAFE_EXTS.has(ext)) return;
    shell.openPath(row.file_path);
  });
  ipcMain.handle('emr:deleteDocument', (_e, id: number) => {
    const db = getDb();
    const row = db.prepare('SELECT file_path FROM patient_documents WHERE id=?').get(id) as any;
    if (row?.file_path && fs.existsSync(row.file_path)) { try { fs.unlinkSync(row.file_path); } catch { /* ignore */ } }
    db.prepare('DELETE FROM patient_documents WHERE id=?').run(id);
    return true;
  });

  // ===== Consultations =====
  // Helper: hydrate the row (parse vitals + extra_fields JSON columns).
  const hydrateConsultation = (row: any) => row ? ({
    ...row,
    vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
    extra_fields: row.extra_fields_json ? (() => { try { return JSON.parse(row.extra_fields_json); } catch { return {}; } })() : {},
  }) : null;

  ipcMain.handle('consultations:getByAppointment', (_e, appointmentId: number) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM consultations WHERE appointment_id=?')
      .get(appointmentId);
    return hydrateConsultation(row);
  });

  ipcMain.handle(
    'consultations:save',
    (
      _e,
      payload: {
        appointment_id: number;
        patient_id: number;
        doctor_id: number;
        history?: string;
        vitals?: Record<string, string>;
        examination?: string;
        impression?: string;
        advice?: string;
        follow_up_date?: string | null;
        extra_fields?: Record<string, string>;
      }
    ) => {
      const db = getDb();
      const vitalsJson = payload.vitals ? JSON.stringify(payload.vitals) : null;
      const extraJson = payload.extra_fields ? JSON.stringify(payload.extra_fields) : null;
      const existing = db
        .prepare('SELECT id FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id) as { id: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE consultations SET history=?, vitals_json=?, examination=?, impression=?, advice=?, follow_up_date=?, extra_fields_json=?, updated_at=datetime('now') WHERE id=?`
        ).run(
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null,
          extraJson,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO consultations (appointment_id, patient_id, doctor_id, history, vitals_json, examination, impression, advice, follow_up_date, extra_fields_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          payload.appointment_id,
          payload.patient_id,
          payload.doctor_id,
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null,
          extraJson
        );
      }
      const row = db
        .prepare('SELECT * FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id);
      return hydrateConsultation(row);
    }
  );

  // ===== Slip body templates =====
  // Stored as JSON in the settings table (key: 'slip_templates'). The whole array
  // is read/written together — the editor sends a complete list back on save.
  ipcMain.handle('templates:list', () => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key='slip_templates'").get() as { value: string } | undefined;
    if (!row?.value) return [];
    try { return JSON.parse(row.value); } catch { return []; }
  });
  ipcMain.handle('templates:saveAll', (_e, templates: any[]) => {
    const db = getDb();
    const json = JSON.stringify(Array.isArray(templates) ? templates : []);
    db.prepare("INSERT INTO settings (key, value) VALUES ('slip_templates', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
    return { ok: true };
  });

  // ===== Prescriptions =====
  ipcMain.handle('rx:getByAppointment', (_e, appointmentId: number) => {
    return getDb()
      .prepare('SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id')
      .all(appointmentId);
  });

  ipcMain.handle(
    'rx:saveAll',
    (
      _e,
      appointmentId: number,
      items: { drug_name: string; drug_master_id?: number | null; dosage?: string; frequency?: string; duration?: string; instructions?: string }[]
    ) => {
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM prescription_items WHERE appointment_id=?').run(appointmentId);
        const ins = db.prepare(
          'INSERT INTO prescription_items (appointment_id, drug_master_id, drug_name, dosage, frequency, duration, instructions, order_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        items.forEach((it, idx) => {
          if (!it.drug_name?.trim()) return;
          ins.run(
            appointmentId,
            it.drug_master_id ?? null,
            it.drug_name.trim(),
            it.dosage ?? null, it.frequency ?? null, it.duration ?? null, it.instructions ?? null,
            idx
          );
        });
      });
      tx();
      return db
        .prepare('SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id')
        .all(appointmentId);
    }
  );

  // ===== Lab =====
  ipcMain.handle('lab:listTests', (_e, activeOnly = true) => {
    const db = getDb();
    // Imaging lives in the Radiology department now. Old rows stay in lab_tests (past lab
    // orders point at them) but are never offered for new lab work.
    return activeOnly
      ? db.prepare("SELECT * FROM lab_tests WHERE is_active=1 AND category <> 'radiology' ORDER BY name").all()
      : db.prepare("SELECT * FROM lab_tests WHERE category <> 'radiology' ORDER BY is_active DESC, name").all();
  });

  /**
   * Delete lab tests, one or many. Mirrors pharmacy's bulk delete: a test that
   * was never ordered is removed outright; one with history is DEACTIVATED
   * instead, so past reports and bills keep their test names intact.
   */
  ipcMain.handle('lab:bulkDeleteTests', (_e, ids: number[]) => {
    requireRole(['lab_tech'], 'delete lab tests');
    requireModule('lab', 'Laboratory');
    if (!Array.isArray(ids) || ids.length === 0) return { ok: true, hardDeleted: 0, softDeleted: 0, results: [] };
    const db = getDb();
    const results: Array<{ id: number; name: string; mode: 'hard_deleted' | 'soft_deleted' | 'failed'; error?: string }> = [];
    let hardDeleted = 0, softDeleted = 0;

    const tx = db.transaction(() => {
      for (const id of ids) {
        const t = db.prepare('SELECT id, name FROM lab_tests WHERE id=?').get(id) as { id: number; name: string } | undefined;
        if (!t) { results.push({ id, name: '(not found)', mode: 'failed', error: 'Test not found' }); continue; }
        const used = (db.prepare('SELECT COUNT(*) AS c FROM lab_order_items WHERE lab_test_id=?').get(id) as { c: number }).c;
        try {
          if (used === 0) {
            db.prepare('DELETE FROM lab_tests WHERE id=?').run(id);
            logAudit(db, actor(), 'lab_test_deleted', 'lab_tests', id, t.name);
            results.push({ id, name: t.name, mode: 'hard_deleted' }); hardDeleted++;
          } else {
            db.prepare('UPDATE lab_tests SET is_active=0 WHERE id=?').run(id);
            logAudit(db, actor(), 'lab_test_deactivated', 'lab_tests', id, `${t.name} · ${used} past order(s)`);
            results.push({ id, name: t.name, mode: 'soft_deleted' }); softDeleted++;
          }
        } catch (e: any) {
          results.push({ id, name: t.name, mode: 'failed', error: e?.message || String(e) });
        }
      }
    });
    tx();
    return { ok: true, hardDeleted, softDeleted, results };
  });

  ipcMain.handle('lab:upsertTest', (_e, test: any) => {
    requireModule('lab', 'Laboratory');
    const db = getDb();
    if (test.id) {
      db.prepare(
        'UPDATE lab_tests SET name=?, price=?, sample_type=?, ref_range=?, unit=?, category=?, is_active=? WHERE id=?'
      ).run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.category ?? 'pathology', test.is_active ?? 1, test.id);
      return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(test.id);
    }
    const info = db
      .prepare('INSERT INTO lab_tests (name, price, sample_type, ref_range, unit, category, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.category ?? 'pathology', test.is_active ?? 1);
    return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(info.lastInsertRowid);
  });

  /**
   * Bulk-load the standard Indian investigation catalog. Only adds tests whose
   * name isn't already present (case-insensitive), so it's safe to run repeatedly.
   * Prices default to 0 — the clinic sets its own afterwards.
   */
  ipcMain.handle('lab:loadStandardCatalog', (_e) => {
    const db = getDb();
    const existing = new Set((db.prepare('SELECT LOWER(name) AS n FROM lab_tests').all() as any[]).map((r) => r.n));
    const ins = db.prepare('INSERT INTO lab_tests (name, price, sample_type, ref_range, unit, category, is_active) VALUES (?, 0, ?, ?, ?, ?, 1)');
    let added = 0;
    const tx = db.transaction((rows: any[]) => {
      for (const t of rows) {
        if (existing.has(t.name.toLowerCase())) continue;
        ins.run(t.name, t.sample_type ?? null, t.ref_range ?? null, t.unit ?? null, t.category ?? 'pathology');
        added++;
      }
    });
    tx(LAB_CATALOG);
    return { ok: true, added, total: LAB_CATALOG.length };
  });

  // Load the standard pharmacy catalogue into drug_master: adds the drugs the list does not have (names, compositions, prices and GST — never
  // stock: what the clinic holds comes from its own purchases) and corrects the composition of a drug nobody has edited (db/catalogue.ts).
  // Mirrors lab:loadStandardCatalog.
  ipcMain.handle('pharmacy:loadStandardCatalog', (_e) => {
    requireModule('pharmacy', 'Pharmacy');
    const r = refreshCatalogue(getDb(), 'manual');
    return { ok: true, added: r.added, corrected: r.corrected, kept: r.kept, total: PHARMACY_CATALOG.length };
  });

  // Testing/evaluation: populate the app with ~50 fictional patients + full
  // cross-module activity so Analytics has something to show. Never auto-runs.
  ipcMain.handle('admin:loadSampleData', (_e) => {
    requireRole([], 'load sample data');
    // Deliberately available in packaged builds too: demos to prospective clinics
    // are run from the real installer, so barring it there took the feature away
    // from the person who needs it. The protection is that it cannot be triggered
    // by accident (the UI requires typing a confirmation word) and that it is
    // fully reversible — see admin:removeSampleData.
    try {
      const counts = seedSampleData(getDb());
      logAudit(getDb(), actor(), 'sample_data_loaded', 'patients', undefined, JSON.stringify(counts));
      return { ok: true as const, ...counts };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Failed to load sample data' };
    }
  });

  ipcMain.handle(
    'lab:createOrder',
    (
      _e,
      payload: { appointment_id: number | null; patient_id: number; doctor_id: number | null; notes?: string; items: { lab_test_id?: number; test_name: string }[] }
    ) => {
      requireModule('lab', 'Laboratory');
      const db = getDb();
      if (!Array.isArray(payload?.items) || payload.items.length === 0) throw new Error('Pick at least one test to order.');
      if (!db.prepare('SELECT id FROM patients WHERE id=?').get(payload.patient_id)) throw new Error('That patient was not found — pick the patient for this lab request.');

      // The same request sent twice (double-click, retry) is ONE order and ONE bill: an identical test list for the
      // same patient and visit, raised in the last two minutes and not yet started, is the same request.
      const wanted = payload.items.map((i) => String(i.test_name).trim().toLowerCase()).sort().join('|');
      const recent = db.prepare(
        `SELECT o.* FROM lab_orders o
          WHERE o.patient_id = ? AND o.appointment_id IS ? AND o.status = 'ordered'
            AND o.ordered_at >= datetime('now', '-120 seconds')
          ORDER BY o.id DESC`
      ).all(payload.patient_id, payload.appointment_id ?? null) as any[];
      for (const o of recent) {
        const have = (db.prepare('SELECT test_name FROM lab_order_items WHERE lab_order_id=?').all(o.id) as { test_name: string }[])
          .map((i) => String(i.test_name).trim().toLowerCase()).sort().join('|');
        if (have === wanted) return o;
      }
      const d = new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      // Atomic counter, not COUNT(*)+1: deleting an order used to make the
      // next one reuse an existing number, and order_number is UNIQUE — so a
      // single deletion blocked every lab order for the rest of that day.
      const orderNumber = nextLabOrderNumber(db, d);
      const tx = db.transaction(() => {
        const info = db
          .prepare(
            'INSERT INTO lab_orders (order_number, appointment_id, patient_id, doctor_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(orderNumber, payload.appointment_id, payload.patient_id, payload.doctor_id, 'ordered', payload.notes ?? null);
        const orderId = Number(info.lastInsertRowid);
        const insItem = db.prepare(
          'INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, ref_range, unit) VALUES (?, ?, ?, ?, ?)'
        );
        const priced: { id: number; description: string; qty: number; rate: number; amount: number }[] = [];
        for (const it of payload.items) {
          let range: string | null = null;
          let unit: string | null = null;
          let price = 0;
          if (it.lab_test_id) {
            const t = db.prepare('SELECT ref_range, unit, price FROM lab_tests WHERE id=?').get(it.lab_test_id) as any;
            range = t?.ref_range ?? null; unit = t?.unit ?? null; price = Number(t?.price) || 0;
          }
          const itemId = Number(insItem.run(orderId, it.lab_test_id ?? null, it.test_name, range, unit).lastInsertRowid);
          if (price > 0) priced.push({ id: itemId, description: it.test_name, qty: 1, rate: price, amount: price });
        }

        // Auto-raise an (unpaid) lab bill from the ordered tests' prices, so lab
        // revenue lands in billing instead of leaking. Reception collects later.
        const autoBill = getAllSettings(db).lab_auto_bill !== false;
        if (autoBill && priced.length) {
          const total = priced.reduce((s, r) => s + r.amount, 0);
          const billNumber = generateBillNumber();
          const billInfo = db.prepare(
            `INSERT INTO bills
               (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type,
                total, payment_mode, bill_kind, bill_type, amount_paid, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, 0, 'flat', ?, 'Pending', 'lab', 'lab', 0, ?, 'unpaid')`
          ).run(
            billNumber, payload.appointment_id, payload.patient_id, payload.doctor_id ?? null,
            '[]', total, total, `Lab order ${orderNumber}`
          );
          const labBillId = Number(billInfo.lastInsertRowid);
          // Real link, so the bill can be found and re-priced later.
          db.prepare('UPDATE bills SET lab_order_id=? WHERE id=?').run(orderId, labBillId);
          db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(writeLabBillLines(db, labBillId, priced.map((p) => ({ id: p.id, description: p.description, rate: p.rate }))), labBillId);
        }
        return orderId;
      });
      const id = tx();
      return db.prepare('SELECT * FROM lab_orders WHERE id=?').get(id);
    }
  );

  ipcMain.handle('lab:listOrders', (_e, filter: { status?: string; patient_id?: number; window?: string; sort?: string } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.status) { conds.push('o.status=?'); params.push(filter.status); }
    if (filter.patient_id) { conds.push('o.patient_id=?'); params.push(filter.patient_id); }
    // Time window on the order date (skipped when looking up one patient's orders).
    if (!filter.patient_id) {
      const DAYS: Record<string, number> = { week: 7, month: 31, quarter: 92 };
      const days = filter.window ? DAYS[filter.window] : undefined; // 'all'/undefined → no limit
      if (days) conds.push(`date(o.ordered_at, 'localtime') >= date('now', 'localtime', '-${days} days')`);
    }
    const ORDER: Record<string, string> = {
      recent: 'o.ordered_at DESC',
      name: "lower(p.first_name || ' ' || p.last_name) ASC",
      status: 'o.status ASC, o.ordered_at DESC',
    };
    const orderBy = ORDER[filter.sort || ''] || 'o.ordered_at DESC';
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db
      .prepare(
        /*
         * test_names rides along with the header so callers that must SHOW the
         * investigations — the OPD slip above all — don't have to fan out a
         * getOrderItems call per order. Without it the slip could only print the
         * order number, so a patient went home holding a prescription that said
         * "LAB-20260817-0001" instead of the tests the doctor actually ordered.
         *
         * Joined on char(31) (ASCII unit separator) rather than a comma: real
         * test names contain commas ("Vitamin D, 25-Hydroxy"), so a comma-joined
         * string cannot be split back apart correctly.
         */
        `SELECT o.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name,
                (SELECT group_concat(i.test_name, char(31)) FROM lab_order_items i WHERE i.lab_order_id = o.id) AS test_names,
                (SELECT a.referred_by FROM appointments a WHERE a.id = o.appointment_id) AS referred_by
         FROM lab_orders o
         JOIN patients p ON p.id=o.patient_id
         LEFT JOIN doctors d ON d.id=o.doctor_id
         ${where}
         ORDER BY ${orderBy} LIMIT 300`
      )
      .all(...params);
  });

  ipcMain.handle('lab:getOrderItems', (_e, orderId: number) => {
    return getDb().prepare(
      `SELECT i.*, COALESCE(t.price, 0) AS price
       FROM lab_order_items i LEFT JOIN lab_tests t ON t.id = i.lab_test_id
       WHERE i.lab_order_id = ?`
    ).all(orderId);
  });

  ipcMain.handle('lab:updateOrderStatus', (_e, orderId: number, status: string) => {
    const db = getDb();
    if (!['ordered', 'sample_collected', 'reported'].includes(status)) {
      throw new Error(`"${status}" is not a lab order status. Use ordered, sample_collected or reported.`);
    }
    if (!db.prepare('SELECT id FROM lab_orders WHERE id=?').get(orderId)) throw new Error('That lab order was not found.');
    const now = new Date().toISOString();
    const fields: Record<string, any> = { status };
    if (status === 'sample_collected') fields.collected_at = now;
    if (status === 'reported') fields.reported_at = now;
    const cols = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    db.prepare(`UPDATE lab_orders SET ${cols} WHERE id=?`).run(...Object.values(fields), orderId);

    return db.prepare('SELECT * FROM lab_orders WHERE id=?').get(orderId);
  });

  ipcMain.handle('lab:updateResults', (_e, orderId: number, items: { id: number; result: string; is_abnormal?: number }[]) => {
    const db = getDb();
    /**
     * Two guards, both defence-in-depth against results landing in the wrong place.
     *
     * 1. `AND lab_order_id=?` — the renderer sends the item ids it has touched.
     *    If a stale draft from a previously-viewed order slips through, the write
     *    simply matches nothing instead of overwriting another patient's result.
     * 2. Only the fields actually supplied are written. Blindly setting both
     *    columns meant a caller sending just `is_abnormal` cleared the result
     *    text, and vice versa.
     */
    const updBoth = db.prepare('UPDATE lab_order_items SET result=?, is_abnormal=? WHERE id=? AND lab_order_id=?');
    const updResult = db.prepare('UPDATE lab_order_items SET result=? WHERE id=? AND lab_order_id=?');
    const updFlag = db.prepare('UPDATE lab_order_items SET is_abnormal=? WHERE id=? AND lab_order_id=?');
    const tx = db.transaction(() => {
      for (const it of items) {
        const hasResult = it.result !== undefined;
        const hasFlag = it.is_abnormal !== undefined;
        if (hasResult && hasFlag) updBoth.run(it.result, it.is_abnormal ?? 0, it.id, orderId);
        else if (hasResult) updResult.run(it.result, it.id, orderId);
        else if (hasFlag) updFlag.run(it.is_abnormal ?? 0, it.id, orderId);
      }
    });
    tx();
    return db.prepare('SELECT * FROM lab_order_items WHERE lab_order_id=?').all(orderId);
  });

  /**
   * Re-price the auto-raised bill for a lab order from its CURRENT test list.
   *
   * Called after a test is added or removed. Returns a short note describing
   * what happened to the bill so the caller can tell the user plainly, instead
   * of the amount changing silently behind their back.
   *
   * Refuses to touch a bill that has been paid, cancelled or frozen at
   * discharge — those are settled records. In that case the test list still
   * changes (the lab did what it did) and the caller is told the bill needs a
   * manual adjustment, which is a bookkeeping decision, not ours to make.
   */
  function repriceLabBill(db: any, orderId: number): { billChanged: boolean; note: string; total?: number } {
    const order = db.prepare('SELECT order_number FROM lab_orders WHERE id=?').get(orderId) as any;
    const bill = db.prepare('SELECT * FROM bills WHERE lab_order_id=?').get(orderId) as any;

    // Price the current lines. A test with no price is deliberately not billed.
    const rows = db.prepare(
      `SELECT i.id, i.test_name, COALESCE(t.price, 0) AS price
         FROM lab_order_items i LEFT JOIN lab_tests t ON t.id = i.lab_test_id
        WHERE i.lab_order_id = ? ORDER BY i.id`
    ).all(orderId) as { id: number; test_name: string; price: number }[];
    const priced = rows.filter((r) => Number(r.price) > 0)
      .map((r) => ({ id: r.id, description: r.test_name, qty: 1, rate: Number(r.price), amount: Number(r.price) }));
    const total = priced.reduce((s, r) => s + r.amount, 0);

    if (!bill) {
      // No bill existed (auto-billing off, or every test was unpriced at the time).
      if (!priced.length) return { billChanged: false, note: 'No bill — none of these tests has a price set.' };
      const autoBill = getAllSettings(db).lab_auto_bill !== false;
      if (!autoBill) return { billChanged: false, note: 'No bill raised — auto-billing for lab is switched off.' };
      const billNumber = generateBillNumber();
      const o = db.prepare('SELECT * FROM lab_orders WHERE id=?').get(orderId) as any;
      const raised = db.prepare(
        `INSERT INTO bills
           (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type,
            total, payment_mode, bill_kind, bill_type, amount_paid, notes, lab_order_id, status)
         VALUES (?, ?, ?, ?, '[]', ?, 0, 'flat', ?, 'Pending', 'lab', 'lab', 0, ?, ?, 'unpaid')`
      ).run(billNumber, o.appointment_id, o.patient_id, o.doctor_id ?? null,
            total, total, `Lab order ${order?.order_number ?? orderId}`, orderId);
      const newBillId = Number(raised.lastInsertRowid);
      db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(writeLabBillLines(db, newBillId, priced.map((p) => ({ id: p.id, description: p.description, rate: p.rate }))), newBillId);
      return { billChanged: true, total, note: `Bill ${billNumber} raised — ${formatMoney(total)}.` };
    }

    // Deliberately NOT keyed on bills.status: that column defaults to 'paid'
    // (see migrations) and the auto-raised lab bill never sets it, so every
    // unpaid lab bill carries status='paid'. Money actually received is what
    // makes a bill settled, so that is what is checked.
    const settled =
      Number(bill.amount_paid) > 0 || !!bill.paid_at || !!bill.cancelled_at || !!bill.finalized_at;
    if (settled) {
      return {
        billChanged: false,
        note: `Bill ${bill.bill_number} is already settled, so it was left untouched. The test list changed — adjust or re-issue that bill manually.`,
      };
    }

    // An unpaid bill may carry a discount; the lines are rewritten and the bill is totalled again by the shared engine
    // (which keeps the discount and applies round-off).
    const itemsJson = writeLabBillLines(db, bill.id, priced.map((p) => ({ id: p.id, description: p.description, rate: p.rate })));
    db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(itemsJson, bill.id);
    const newTotal = Number((db.prepare('SELECT total FROM bills WHERE id=?').get(bill.id) as any).total);
    return { billChanged: true, total: newTotal, note: `Bill ${bill.bill_number} updated — now ${formatMoney(newTotal)}.` };
  }

  /** Add tests to an order the doctor already sent. */
  ipcMain.handle('lab:addOrderItems', (_e, orderId: number, items: { lab_test_id?: number; test_name: string }[]) => {
    requireModule('lab', 'Laboratory');
    requireRole(['lab_tech', 'receptionist', 'doctor', 'ward_incharge', 'manager'], 'add tests to a lab order');
    const db = getDb();
    try {
      const order = db.prepare('SELECT * FROM lab_orders WHERE id=?').get(orderId) as any;
      if (!order) return { ok: false as const, error: `Lab order #${orderId} no longer exists.` };
      if (order.status === 'cancelled') {
        return { ok: false as const, error: 'This order was cancelled. Raise a new lab request instead of adding to it.' };
      }
      const clean = (items || []).filter((i) => (i?.test_name || '').trim());
      if (!clean.length) return { ok: false as const, error: 'Pick at least one test to add.' };

      // Don't silently add a test the order already has.
      const have = new Set(
        (db.prepare('SELECT LOWER(test_name) AS n FROM lab_order_items WHERE lab_order_id=?').all(orderId) as any[])
          .map((r) => r.n)
      );
      const fresh = clean.filter((i) => !have.has(i.test_name.trim().toLowerCase()));
      if (!fresh.length) return { ok: false as const, error: 'Those tests are already on this order.' };

      const ins = db.prepare(
        'INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, ref_range, unit) VALUES (?, ?, ?, ?, ?)'
      );
      let res!: { billChanged: boolean; note: string; total?: number };
      db.transaction(() => {
        for (const it of fresh) {
          let range: string | null = null, unit: string | null = null;
          if (it.lab_test_id) {
            const t = db.prepare('SELECT ref_range, unit FROM lab_tests WHERE id=?').get(it.lab_test_id) as any;
            range = t?.ref_range ?? null; unit = t?.unit ?? null;
          }
          ins.run(orderId, it.lab_test_id ?? null, it.test_name.trim(), range, unit);
        }
        res = repriceLabBill(db, orderId);
        logAudit(db, actor(), 'lab_order_items_added', 'lab_orders', orderId,
          JSON.stringify({ added: fresh.map((f) => f.test_name), bill: res.note }));
      })();
      return { ok: true as const, added: fresh.length, ...res };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not add tests to this order.' };
    }
  });

  /** Remove a test from an order — refused once its result is recorded. */
  // The bill raised for a lab order (read-only): lets the Lab screen offer "Delete bill" to the admin.
  ipcMain.handle('lab:billOf', (_e, orderId: number) => {
    return getDb().prepare(
      `SELECT id, bill_number, total, amount_paid, status FROM bills WHERE lab_order_id = ? ORDER BY id DESC LIMIT 1`
    ).get(orderId) ?? null;
  });

  ipcMain.handle('lab:removeOrderItem', (_e, orderId: number, itemId: number) => {
    requireModule('lab', 'Laboratory');
    requireRole(['lab_tech', 'receptionist', 'doctor', 'ward_incharge', 'manager'], 'remove a test from a lab order');
    const db = getDb();
    try {
      const item = db.prepare('SELECT * FROM lab_order_items WHERE id=? AND lab_order_id=?').get(itemId, orderId) as any;
      if (!item) return { ok: false as const, error: 'That test is no longer on this order.' };
      // A recorded result is clinical evidence. Deleting the line would delete
      // the result with it, so this is refused outright rather than warned about.
      if (item.result !== null && String(item.result).trim() !== '') {
        return {
          ok: false as const,
          error: `“${item.test_name}” already has a result entered, so it cannot be removed. Clear the result first if it was entered by mistake.`,
        };
      }
      const count = (db.prepare('SELECT COUNT(*) AS c FROM lab_order_items WHERE lab_order_id=?').get(orderId) as any).c;
      if (count <= 1) {
        return { ok: false as const, error: 'An order must have at least one test. Cancel the whole order instead.' };
      }

      let res!: { billChanged: boolean; note: string; total?: number };
      db.transaction(() => {
        db.prepare('DELETE FROM lab_order_items WHERE id=?').run(itemId);
        res = repriceLabBill(db, orderId);
        logAudit(db, actor(), 'lab_order_item_removed', 'lab_orders', orderId,
          JSON.stringify({ removed: item.test_name, bill: res.note }));
      })();
      return { ok: true as const, ...res };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not remove that test.' };
    }
  });

  // ===== Pharmacy (v2 — batch-tracked, FEFO, Schedule H compliant) =====
  // Listing returns drug_master rows with summed qty_remaining + earliest expiry
  // joined in. Old fields (mrp, batch, expiry, stock_qty) are aliased so any
  // remaining UI code that still expects the legacy Drug shape keeps working.
  ipcMain.handle('pharmacy:listDrugs', (_e, filter: { q?: string; activeOnly?: boolean } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.activeOnly !== false) conds.push('m.is_active=1');
    if (filter.q) {
      conds.push('(m.name LIKE ? OR m.generic_name LIKE ? OR m.barcode = ?)');
      const like = `%${filter.q}%`;
      params.push(like, like, filter.q);
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db.prepare(`
      SELECT m.*,
        m.default_mrp as mrp,
        (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1) as stock_qty,
        (SELECT b.batch_no FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC LIMIT 1) as batch,
        (SELECT b.expiry FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC LIMIT 1) as expiry,
        (SELECT b.expiry FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC LIMIT 1) as next_expiry,
        -- Price and true cost of the batch FEFO will hand out next (same order the sale uses), so a
        -- screen can default the rate to the batch's own MRP / selling price instead of the drug's
        -- stale default MRP.
        (SELECT b.mrp FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC, b.received_at ASC LIMIT 1) as next_mrp,
        (SELECT COALESCE(b.selling_price, b.mrp) FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC, b.received_at ASC LIMIT 1) as next_selling_price,
        (SELECT COALESCE(b.unit_cost, b.purchase_price) FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1 AND b.qty_remaining>0
          ORDER BY date(b.expiry) ASC, b.received_at ASC LIMIT 1) as next_unit_cost
      FROM drug_master m
      ${where}
      ORDER BY m.name LIMIT 500
    `).all(...params);
  });

  ipcMain.handle('pharmacy:listBatches', (_e, drugMasterId: number) => {
    const db = getDb();
    return db.prepare(`
      SELECT b.*, m.name as drug_name, m.schedule as schedule
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE b.drug_master_id=?
      ORDER BY date(b.expiry) ASC, b.received_at ASC
    `).all(drugMasterId);
  });

  ipcMain.handle('pharmacy:upsertDrug', (_e, drug: any) => {
    requireModule('pharmacy', 'Pharmacy');
    const db = getDb();
    if (drug.id) {
      db.prepare(`
        UPDATE drug_master SET
          name=?, generic_name=?, manufacturer=?, form=?, strength=?, pack_size=?,
          schedule=?, hsn_code=?, gst_rate=?, default_mrp=?, low_stock_threshold=?,
          barcode=?, is_active=?, notes=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        drug.name, drug.generic_name ?? null, drug.manufacturer ?? null,
        drug.form ?? null, drug.strength ?? null, drug.pack_size ?? null,
        drug.schedule ?? 'OTC', drug.hsn_code ?? null, drug.gst_rate ?? 12,
        drug.default_mrp ?? drug.mrp ?? 0, drug.low_stock_threshold ?? 10,
        drug.barcode ?? null, drug.is_active ?? 1, drug.notes ?? null, drug.id
      );
      return db.prepare('SELECT * FROM drug_master WHERE id=?').get(drug.id);
    }
    const info = db.prepare(`
      INSERT INTO drug_master
        (name, generic_name, manufacturer, form, strength, pack_size, schedule,
         hsn_code, gst_rate, default_mrp, low_stock_threshold, barcode, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      drug.name, drug.generic_name ?? null, drug.manufacturer ?? null,
      drug.form ?? null, drug.strength ?? null, drug.pack_size ?? null,
      drug.schedule ?? 'OTC', drug.hsn_code ?? null, drug.gst_rate ?? 12,
      drug.default_mrp ?? drug.mrp ?? 0, drug.low_stock_threshold ?? 10,
      drug.barcode ?? null, drug.is_active ?? 1, drug.notes ?? null
    );
    return db.prepare('SELECT * FROM drug_master WHERE id=?').get(info.lastInsertRowid);
  });

  // Manual batch entry (corrections, sample stock without a purchase invoice).
  //
  // A batch edit can change what the REMAINING units are worth, but never what units already sold cost:
  // each sale froze its own unit cost in dispensing_register. Every edit is written to the audit log
  // with the before/after figures, so a cost or quantity change can always be explained later.
  ipcMain.handle('pharmacy:upsertBatch', (_e, batch: any) => {
    requireModule('pharmacy', 'Pharmacy');
    const db = getDb();
    const note = (action: string, id: number, detail: unknown) => {
      try { logAudit(db, actor(), action, 'drug_stock_batches', id, JSON.stringify(detail)); } catch { /* never block stock work */ }
    };
    if (batch.id) {
      const before = db.prepare('SELECT * FROM drug_stock_batches WHERE id=?').get(batch.id) as any;
      // Editing the purchase price is the user stating the cost: the unit cost follows it. Left alone
      // (e.g. only the quantity changed) the unit cost — which may include freight and free units — stays.
      const sameRate = (before?.purchase_price ?? null) === (batch.purchase_price ?? null);
      const unitCost = sameRate ? (before?.unit_cost ?? null) : (batch.purchase_price ?? null);
      const sellingPrice = batch.selling_price === undefined ? (before?.selling_price ?? null) : (batch.selling_price ?? null);
      db.prepare(`
        UPDATE drug_stock_batches SET
          batch_no=?, expiry=?, manufacture_date=?, qty_received=?, qty_remaining=?, purchase_price=?,
          unit_cost=?, selling_price=?, mrp=?, manufacturer_license_no=?, is_active=?
        WHERE id=?
      `).run(
        batch.batch_no, batch.expiry, batch.manufacture_date ?? null, batch.qty_received, batch.qty_remaining,
        batch.purchase_price ?? null, unitCost, sellingPrice, batch.mrp ?? 0,
        batch.manufacturer_license_no ?? null, batch.is_active ?? 1, batch.id
      );
      const after = db.prepare('SELECT * FROM drug_stock_batches WHERE id=?').get(batch.id) as any;
      const pick = (r: any) => r && ({
        batch_no: r.batch_no, qty_remaining: r.qty_remaining, purchase_price: r.purchase_price,
        unit_cost: r.unit_cost, selling_price: r.selling_price, mrp: r.mrp, expiry: r.expiry, is_active: r.is_active,
      });
      note('batch.edit', batch.id, { before: pick(before), after: pick(after) });
      return after;
    }
    const info = db.prepare(`
      INSERT INTO drug_stock_batches
        (drug_master_id, batch_no, expiry, manufacture_date, qty_received, qty_remaining,
         purchase_price, unit_cost, selling_price, mrp, manufacturer_license_no, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drug_master_id, batch_no) DO UPDATE SET
        expiry=excluded.expiry,
        manufacture_date=excluded.manufacture_date,
        qty_received=qty_received + excluded.qty_received,
        qty_remaining=qty_remaining + excluded.qty_remaining,
        mrp=excluded.mrp,
        selling_price=COALESCE(excluded.selling_price, selling_price),
        unit_cost = CASE
          WHEN excluded.unit_cost IS NULL THEN unit_cost
          WHEN unit_cost IS NULL OR qty_remaining <= 0 THEN excluded.unit_cost
          ELSE ROUND((qty_remaining * unit_cost + excluded.qty_remaining * excluded.unit_cost) / (qty_remaining + excluded.qty_remaining), 4)
        END
    `).run(
      batch.drug_master_id, batch.batch_no, batch.expiry, batch.manufacture_date ?? null,
      batch.qty_received, batch.qty_remaining ?? batch.qty_received,
      batch.purchase_price ?? null, batch.purchase_price ?? null, batch.selling_price ?? null, batch.mrp ?? 0,
      batch.manufacturer_license_no ?? null, batch.is_active ?? 1
    );
    const row = db.prepare('SELECT * FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?')
      .get(batch.drug_master_id, batch.batch_no) as any;
    note('batch.add', row.id, {
      batch_no: row.batch_no, qty_added: batch.qty_remaining ?? batch.qty_received,
      purchase_price: batch.purchase_price ?? null, qty_remaining_now: row.qty_remaining, unit_cost_now: row.unit_cost,
    });
    return row;
  });

  // Bulk delete drugs — same safety model as doctors:
  //   - If a drug has zero stock-batches / Rx / sale / dispensing-register / purchase
  //     references → HARD delete (drug_master row removed entirely).
  //   - Otherwise → SOFT delete (is_active=0). Drug stays in history but disappears
  //     from active dispense + master listings.
  // Returns a per-drug summary so the UI can explain what happened.
  ipcMain.handle('pharmacy:bulkDeleteDrugs', (_e, ids: number[]) => {
    requireRole(['pharmacist'], 'delete drugs');
    if (!Array.isArray(ids) || ids.length === 0) return { ok: true, hardDeleted: 0, softDeleted: 0, results: [] };
    const db = getDb();
    const countRefs = (id: number) => {
      const c = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c;
      return {
        batches: c('SELECT COUNT(*) as c FROM drug_stock_batches WHERE drug_master_id=?'),
        rx: c('SELECT COUNT(*) as c FROM prescription_items WHERE drug_master_id=?'),
        sale_items: c('SELECT COUNT(*) as c FROM pharmacy_sale_items WHERE drug_master_id=?'),
        dispensed: c('SELECT COUNT(*) as c FROM dispensing_register WHERE drug_master_id=?'),
        purchase_lines: c('SELECT COUNT(*) as c FROM purchase_invoice_items WHERE drug_master_id=?'),
      };
    };

    const results: Array<{ id: number; name: string; mode: 'hard_deleted' | 'soft_deleted' | 'failed'; refs?: any; error?: string }> = [];
    let hardDeleted = 0;
    let softDeleted = 0;

    const tx = db.transaction(() => {
      for (const id of ids) {
        const drug = db.prepare('SELECT id, name FROM drug_master WHERE id=?').get(id) as { id: number; name: string } | undefined;
        if (!drug) {
          results.push({ id, name: '(not found)', mode: 'failed', error: 'Drug not found' });
          continue;
        }
        const refs = countRefs(id);
        const total = refs.batches + refs.rx + refs.sale_items + refs.dispensed + refs.purchase_lines;
        if (total === 0) {
          try {
            db.prepare('DELETE FROM drug_master WHERE id=?').run(id);
            logAudit(db, actor(), 'drug_deleted', 'drug_master', id, drug.name);
            results.push({ id, name: drug.name, mode: 'hard_deleted' });
            hardDeleted++;
          } catch (e: any) {
            results.push({ id, name: drug.name, mode: 'failed', error: e?.message || String(e), refs });
          }
        } else {
          db.prepare('UPDATE drug_master SET is_active=0 WHERE id=?').run(id);
          logAudit(db, actor(), 'drug_deactivated', 'drug_master', id, `${drug.name} (kept ${total} historical record(s))`);
          results.push({ id, name: drug.name, mode: 'soft_deleted', refs });
          softDeleted++;
        }
      }
    });
    tx();

    return { ok: true, hardDeleted, softDeleted, results };
  });

  ipcMain.handle('pharmacy:alerts', () => {
    const db = getDb();
    // Low stock = sum of qty_remaining across active batches <= threshold.
    const lowStock = db.prepare(`
      SELECT m.*, m.default_mrp as mrp,
        (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1) as stock_qty
      FROM drug_master m
      WHERE m.is_active=1
        AND (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
             WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold
      ORDER BY stock_qty ASC LIMIT 50
    `).all();
    // Expiring soon = batch-level, any active batch with qty_remaining > 0
    // expiring within 90 days (more useful than the old 30-day window).
    const expiringSoon = db.prepare(`
      SELECT b.*, m.name as drug_name, m.schedule as schedule, m.default_mrp as mrp
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE b.is_active=1 AND b.qty_remaining > 0
        AND date(b.expiry) <= date('now', 'localtime', '+90 days')
      ORDER BY date(b.expiry) ASC LIMIT 50
    `).all();
    return { lowStock, expiringSoon };
  });

  ipcMain.handle('pharmacy:pendingRx', () => {
    const db = getDb();
    // List recent appointments with Rx items that haven't been dispensed yet (no pharmacy_sale linked to the appointment)
    return db
      .prepare(
        `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.phone as patient_phone,
          d.name as doctor_name,
          (SELECT COUNT(*) FROM prescription_items WHERE appointment_id=a.id) as rx_count
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id IN (SELECT DISTINCT appointment_id FROM prescription_items)
          AND a.id NOT IN (SELECT COALESCE(appointment_id, 0) FROM pharmacy_sales)
          AND a.appointment_date >= date('now', 'localtime', '-7 days')
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 100`
      )
      .all();
  });

  ipcMain.handle('pharmacy:getAppointmentRx', (_e, appointmentId: number) => {
    return getDb().prepare('SELECT * FROM prescription_items WHERE appointment_id=?').all(appointmentId);
  });

  // 'pharmacy:sell' (FEFO dispense with frozen unit cost) lives in main/pharmacy-finance*.ts.

  /** One sale with its lines + customer — everything a printed receipt needs. */
  ipcMain.handle('pharmacy:saleDetail', (_e, saleId: number) => {
    const db = getDb();
    const sale = db.prepare(
      `SELECT s.*, (p.first_name || ' ' || p.last_name) AS patient_name,
              p.uhid AS patient_uhid, p.phone AS patient_phone, p.address AS patient_address
         FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id
        WHERE s.id = ?`
    ).get(saleId) as any;
    if (!sale) return null;
    // Batch/expiry come from the dispensing register (written per batch at sale time),
    // so a Schedule-H receipt can show exactly what was handed over.
    const items = db.prepare(
      `SELECT si.id, si.drug_name, si.qty, si.rate, si.amount, si.drug_master_id,
              m.generic_name, m.strength, m.form, m.schedule, m.hsn_code,
              (SELECT GROUP_CONCAT(dr.batch_no || ' (exp ' || dr.expiry || ')', ', ')
                 FROM dispensing_register dr WHERE dr.sale_item_id = si.id) AS batches
         FROM pharmacy_sale_items si
         LEFT JOIN drug_master m ON m.id = si.drug_master_id
        WHERE si.sale_id = ? ORDER BY si.id`
    ).all(saleId);
    // Credit: what has been received so far and each later payment, so a reprint shows the true balance.
    const received = Number(sale.amount_paid ?? sale.total);
    const payments = db.prepare(
      'SELECT amount, payment_mode, received_at, received_by, reference FROM pharmacy_sale_payments WHERE sale_id = ? ORDER BY id'
    ).all(saleId);
    const due = sale.payment_mode === 'IPD-bill' ? 0 : Math.max(0, Math.round((Number(sale.total) - received) * 100) / 100);
    return { ...sale, items, amount_received: received, due, payments };
  });

  ipcMain.handle('pharmacy:listSales', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.from) { conds.push("date(s.created_at, 'localtime') >= ?"); params.push(filter.from); }
    if (filter.to) { conds.push("date(s.created_at, 'localtime') <= ?"); params.push(filter.to); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db
      .prepare(
        `SELECT s.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid,
                ${SALE_DUE_SQL} as due
         FROM pharmacy_sales s
         LEFT JOIN patients p ON p.id=s.patient_id
         ${where}
         ORDER BY s.created_at DESC LIMIT 300`
      )
      .all(...params);
  });

  // Free-form "Record a New Sale" — same idea as misc:create on the Services
  // page. Skips FEFO / inventory deduction / dispensing register entirely so the
  // receptionist can quickly capture a walk-in pharmacy sale even when the drug
  // names + quantities are unknown or missing. Blank rows are allowed and
  // filtered out before persisting.

  // ===== Wholesalers =====
  ipcMain.handle('wholesalers:list', (_e, filter: { activeOnly?: boolean } = {}) => {
    const db = getDb();
    const where = filter.activeOnly !== false ? 'WHERE is_active=1' : '';
    return db.prepare(`SELECT * FROM wholesalers ${where} ORDER BY name`).all();
  });

  ipcMain.handle('wholesalers:upsert', (_e, w: any) => {
    const db = getDb();
    if (w.id) {
      db.prepare(`
        UPDATE wholesalers SET
          name=?, contact_person=?, phone=?, email=?, address=?,
          drug_license_no=?, gstin=?, is_active=?, notes=?
        WHERE id=?
      `).run(
        w.name, w.contact_person ?? null, w.phone ?? null, w.email ?? null, w.address ?? null,
        w.drug_license_no, w.gstin ?? null, w.is_active ?? 1, w.notes ?? null, w.id
      );
      return db.prepare('SELECT * FROM wholesalers WHERE id=?').get(w.id);
    }
    const info = db.prepare(`
      INSERT INTO wholesalers
        (name, contact_person, phone, email, address, drug_license_no, gstin, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      w.name, w.contact_person ?? null, w.phone ?? null, w.email ?? null, w.address ?? null,
      w.drug_license_no, w.gstin ?? null, w.is_active ?? 1, w.notes ?? null
    );
    return db.prepare('SELECT * FROM wholesalers WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('wholesalers:delete', (_e, id: number) => {
    // Soft delete — preserve referential integrity for purchase_invoices.
    getDb().prepare('UPDATE wholesalers SET is_active=0 WHERE id=?').run(id);
    return { ok: true };
  });

  // ===== Purchase invoices =====
  // purchase:list / get / create / addPayment live in main/pharmacy-finance*.ts (server-side totals,
  // idempotent saves, supplier payments).


  // ===== Stock register (every batch with days-to-expiry) =====
  ipcMain.handle('stock:register', (_e, filter: { activeOnly?: boolean; includeExpired?: boolean } = {}) => {
    const db = getDb();
    const conds: string[] = ['m.is_active=1'];
    if (filter.activeOnly !== false) conds.push('b.is_active=1');
    if (filter.includeExpired === false) conds.push("date(b.expiry) >= date('now', 'localtime')");
    return db.prepare(`
      SELECT b.id, b.batch_no, b.expiry, b.qty_received, b.qty_remaining,
             b.purchase_price, b.unit_cost, b.selling_price, b.mrp, b.manufacturer_license_no, b.received_at,
             m.id as drug_master_id, m.name as drug_name, m.generic_name,
             m.manufacturer, m.form, m.strength, m.schedule, m.hsn_code,
             CAST((julianday(b.expiry) - julianday('now')) AS INTEGER) as days_to_expiry
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE ${conds.join(' AND ')}
      ORDER BY m.name, date(b.expiry)
    `).all();
  });

  // ===== Purchase register (invoices joined with wholesaler + line counts) =====
  ipcMain.handle('purchase:register', (_e, filter: { from: string; to: string; wholesaler_id?: number }) => {
    const db = getDb();
    const conds: string[] = ['date(pi.invoice_date) >= ?', 'date(pi.invoice_date) <= ?'];
    const params: any[] = [filter.from, filter.to];
    if (filter.wholesaler_id) {
      conds.push('pi.wholesaler_id = ?');
      params.push(filter.wholesaler_id);
    }
    return db.prepare(`
      SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.received_date,
             pi.subtotal, pi.cgst, pi.sgst, pi.igst, pi.discount, pi.total,
             pi.other_charges, pi.round_off, pi.amount_paid,
             pi.payment_mode, pi.payment_status, pi.notes,
             w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no,
             w.gstin as wholesaler_gstin,
             (SELECT COUNT(*) FROM purchase_invoice_items pii WHERE pii.invoice_id=pi.id) as line_count
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      WHERE ${conds.join(' AND ')}
      ORDER BY date(pi.invoice_date) ASC, pi.id ASC
    `).all(...params);
  });

  // ===== Dispensing register =====
  ipcMain.handle('dispensing:register', (_e, filter: { from: string; to: string; schedule?: string }) => {
    const db = getDb();
    const conds: string[] = ["date(dr.dispensed_at, 'localtime') >= ?", "date(dr.dispensed_at, 'localtime') <= ?"];
    const params: any[] = [filter.from, filter.to];
    if (filter.schedule) {
      conds.push('dr.schedule = ?');
      params.push(filter.schedule);
    }
    return db.prepare(`
      SELECT dr.*,
        (p.first_name || ' ' || p.last_name) as patient_name,
        p.uhid as patient_uhid,
        m.name as drug_name,
        d.name as doctor_name
      FROM dispensing_register dr
      LEFT JOIN patients p ON p.id=dr.patient_id
      LEFT JOIN doctors d ON d.id=dr.doctor_id
      JOIN drug_master m ON m.id=dr.drug_master_id
      WHERE ${conds.join(' AND ')}
      ORDER BY dr.dispensed_at ASC
    `).all(...params);
  });

  // ===== IP Admissions =====
  ipcMain.handle('ip:list', (_e, filter: { status?: string; q?: string; window?: string; limit?: number } = {}) => {
    const db = getDb();
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.status) { clauses.push('a.status = ?'); params.push(filter.status); }

    const q = (filter.q || '').trim();
    if (q) {
      // A search reaches every admission (no window), by patient or IP number.
      clauses.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR p.phone LIKE ? OR a.admission_number LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    } else {
      // No search: keep the list recent so a big hospital's history stays fast.
      const DAYS: Record<string, number> = { week: 7, month: 31, quarter: 92 };
      const days = filter.window ? DAYS[filter.window] : undefined;
      if (days) {
        clauses.push(`(date(a.admitted_at, 'localtime') >= date('now', 'localtime', '-${days} days') OR (a.discharged_at IS NOT NULL AND date(a.discharged_at, 'localtime') >= date('now', 'localtime', '-${days} days')))`);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(filter.limit) || 1000, 1), 5000);
    params.push(limit);
    return db
      .prepare(
        `SELECT a.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, p.phone as patient_phone,
                p.dob as patient_dob, p.gender as patient_gender, d.name as doctor_name
         FROM ip_admissions a
         JOIN patients p ON p.id=a.patient_id
         LEFT JOIN doctors d ON d.id=a.admission_doctor_id
         ${where}
         ORDER BY a.admitted_at DESC LIMIT ?`
      )
      .all(...params);
  });

  ipcMain.handle('ip:admit', (_e, payload: { patient_id: number; admission_doctor_id?: number; bed_number?: string; ward?: string; admission_notes?: string }) => {
    requireModule('ipd', 'In-Patient (IPD)');
    const db = getDb();
    // Financial-year series (IP/2026-27/0007), separate from the patient's UHID.
    const num = nextIpNumber(db);
    const info = db
      .prepare(
        'INSERT INTO ip_admissions (admission_number, patient_id, admission_doctor_id, bed_number, ward, admission_notes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(num, payload.patient_id, payload.admission_doctor_id ?? null, payload.bed_number ?? null, payload.ward ?? null, payload.admission_notes ?? null);
    return db.prepare('SELECT * FROM ip_admissions WHERE id=?').get(info.lastInsertRowid);
  });


  // ===== Notifications =====
  ipcMain.handle('notifications:list', (_e, status?: string) => {
    const db = getDb();
    const where = status ? 'WHERE n.status = ?' : '';
    const params = status ? [status] : [];
    return db
      .prepare(
        `SELECT n.*,
           (p.first_name || ' ' || p.last_name) as patient_name
         FROM notification_log n
         LEFT JOIN patients p ON p.id=n.patient_id
         ${where}
         ORDER BY n.created_at DESC LIMIT 500`
      )
      .all(...params);
  });

  // ===== Settings =====
  // The admin-password hash must never reach the renderer or a network client;
  // it's set only via auth:changeAdminPassword (which verifies the current one).
  const redactSettings = (s: any) => { const o = { ...s }; delete o.admin_password; return o; };
  ipcMain.handle('settings:get', () => redactSettings(getAllSettings(getDb())));
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const clean = { ...(patch || {}) } as any;
    delete clean.admin_password; // cannot be changed through the generic save path
    saveSettings(getDb(), clean);
    return redactSettings(getAllSettings(getDb()));
  });

  // ===== Clinical Quick Templates =====
  const CLINICAL_TPL_KEY = 'clinical_quick_templates';
  ipcMain.handle('clinical-templates:list', () => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key=?").get(CLINICAL_TPL_KEY) as { value: string } | undefined;
    try { return row ? JSON.parse(row.value) : []; } catch { return []; }
  });
  ipcMain.handle('clinical-templates:save', (_e, templates: unknown[]) => {
    const db = getDb();
    const json = JSON.stringify(templates);
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(CLINICAL_TPL_KEY, json);
    return templates;
  });

  // ===== Patient Log =====
  ipcMain.handle('patients:log', (_e, filter: { from: string; to: string; q?: string; doctor_id?: number }) => {
    const db = getDb();
    const conditions: string[] = ['a.appointment_date >= ?', 'a.appointment_date <= ?'];
    const params: (string | number)[] = [filter.from, filter.to];
    if (filter.doctor_id) {
      conditions.push('a.doctor_id = ?');
      params.push(filter.doctor_id);
    }
    if (filter.q && filter.q.trim()) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR p.phone LIKE ?)");
      const like = `%${filter.q.trim()}%`;
      params.push(like, like, like);
    }
    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = db
      .prepare(
        `SELECT a.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
           p.phone as patient_phone, p.blood_group as patient_blood_group,
           p.created_at as patient_created_at,
           d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room,
           /*
            * One row per VISIT, not per bill.
            *
            * This joined bills straight onto appointments, so a visit carrying
            * two bills (a zero-rupee consultation plus a ₹300 charge, say) came
            * back TWICE — the log showed the same patient, same token and same
            * time on two lines. Worse, everything counted off these rows was
            * inflated with it: the per-day "N visits" heading, avgPerDay, and
            * the per-doctor tallies all counted bills while claiming to count
            * visits.
            *
            * SUM collapses the money back onto the visit. MAX(b.id) is what
            * makes the bare b.payment_mode / b.bill_number well-defined: with a
            * min/max aggregate present, SQLite takes the bare columns from the
            * row that produced it — so they describe the most recent bill
            * rather than an arbitrary one.
            */
           SUM(b.total) as bill_total,
           COUNT(b.id) as bill_count,
           MAX(b.id) as latest_bill_id,
           b.payment_mode as bill_payment_mode, b.bill_number
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN bills b ON b.appointment_id = a.id
         ${where}
         GROUP BY a.id
         ORDER BY a.appointment_date DESC, a.appointment_time ASC`
      )
      .all(...params) as any[];

    // Additional intel
    const uniquePatients = new Set(rows.map((r) => r.patient_id)).size;
    const revenue = rows.reduce((s, r) => s + Number(r.bill_total || 0), 0);
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.appointment_date, (byDate.get(r.appointment_date) || 0) + 1);
    const peakDay = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const daysCovered = byDate.size || 1;
    const avgPerDay = Math.round((rows.length / daysCovered) * 10) / 10;

    const byDoctor = new Map<string, { doctor: string; specialty: string; count: number }>();
    for (const r of rows) {
      const key = r.doctor_name;
      const cur = byDoctor.get(key) || { doctor: r.doctor_name, specialty: r.doctor_specialty, count: 0 };
      cur.count += 1;
      byDoctor.set(key, cur);
    }

    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);

    // First-time vs repeat (among this range)
    const patientFirstSeen = new Map<number, string>();
    for (const r of rows) {
      const prev = patientFirstSeen.get(r.patient_id);
      if (!prev || r.appointment_date < prev) patientFirstSeen.set(r.patient_id, r.appointment_date);
    }

    return {
      rows,
      intel: {
        totalVisits: rows.length,
        uniquePatients,
        repeatVisits: rows.length - uniquePatients,
        revenue,
        daysCovered,
        avgPerDay,
        peakDay: peakDay ? { date: peakDay[0], count: peakDay[1] } : null,
        byDoctor: [...byDoctor.values()].sort((a, b) => b.count - a.count),
        byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      },
    };
  });

  // ===== Reports =====
  ipcMain.handle('reports:run', (_e, params: { kind: string; from?: string; to?: string }) => {
    const db = getDb();
    const { kind, from, to } = params;
    // `utc` = the column holds a UTC timestamp (convert to the clinic's day); false = it already holds the local calendar
    // date (appointment_date) and must be compared as it is — converting it would shift it a day in zones west of UTC.
    const range = (col: string, utc = true) => {
      const conds: string[] = [];
      const p: any[] = [];
      const day = utc ? `date(${col}, 'localtime')` : `date(${col})`;
      if (from) { conds.push(`${day} >= ?`); p.push(from); }
      if (to) { conds.push(`${day} <= ?`); p.push(to); }
      return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params: p };
    };
    if (kind === 'daily_collection') return dailyCollection(db, from, to);
    if (kind === 'doctor_performance') {
      const r = range('a.appointment_date', false);
      return db
        .prepare(
          `SELECT d.name as doctor, d.specialty,
             COUNT(a.id) as visits,
             COUNT(DISTINCT a.patient_id) as unique_patients,
             COALESCE(SUM(b.total), 0) as revenue
           FROM appointments a
           JOIN doctors d ON d.id=a.doctor_id
           LEFT JOIN bills b ON b.appointment_id=a.id AND COALESCE(b.status,'') <> 'cancelled'
           ${r.where}
           GROUP BY d.id ORDER BY revenue DESC`
        )
        .all(...r.params);
    }
    if (kind === 'top_diagnoses') {
      const r = range('a.appointment_date', false);
      return db
        .prepare(
          `SELECT c.impression as diagnosis, COUNT(*) as count
           FROM consultations c
           JOIN appointments a ON a.id=c.appointment_id
           ${r.where}
           AND c.impression IS NOT NULL AND c.impression <> ''
           GROUP BY c.impression ORDER BY count DESC LIMIT 50`
        )
        .all(...r.params);
    }
    if (kind === 'top_drugs') {
      const r = range('s.created_at');
      return db
        .prepare(
          `SELECT si.drug_name as drug,
             SUM(si.qty) as qty_sold,
             COUNT(*) as sales,
             COALESCE(SUM(si.amount), 0) as revenue
           FROM pharmacy_sale_items si
           JOIN pharmacy_sales s ON s.id=si.sale_id
           ${r.where}
           GROUP BY si.drug_name ORDER BY revenue DESC LIMIT 50`
        )
        .all(...r.params);
    }
    if (kind === 'new_patients') {
      const r = range('created_at');
      return db
        .prepare(`SELECT date(created_at, 'localtime') as day, COUNT(*) as new_patients FROM patients ${r.where} GROUP BY day ORDER BY day DESC`)
        .all(...r.params);
    }
    return [];
  });

  // ===== Backup =====
  // Recursively copy a directory (Node 16+ has fs.cpSync but we keep it manual for compatibility)
  function copyDirRecursive(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const sp = path.join(src, entry.name);
      const dp = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDirRecursive(sp, dp);
      else fs.copyFileSync(sp, dp);
    }
  }

  // Export every major table to a CSV (UTF-8 with BOM so Excel opens Unicode cleanly).
  function exportTableToCsv(db: any, sql: string, destFile: string) {
    const rows = db.prepare(sql).all() as any[];
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const csvValue = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      // Escape: wrap in quotes, double up existing quotes
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines: string[] = [];
    if (headers.length) lines.push(headers.map(csvValue).join(','));
    for (const r of rows) lines.push(headers.map((h) => csvValue(r[h])).join(','));
    // UTF-8 BOM makes Excel open non-ASCII chars correctly
    fs.writeFileSync(destFile, '\uFEFF' + lines.join('\r\n'), 'utf8');
    return rows.length;
  }

  // Excel hard limit per cell is 32,767 chars; truncate anything bigger to keep export safe.
  const EXCEL_CELL_MAX = 32_000;
  function safeCellValue(v: any): any {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && v.length > EXCEL_CELL_MAX) {
      return v.slice(0, EXCEL_CELL_MAX) + ` …[truncated, original ${v.length} chars]`;
    }
    return v;
  }
  function sanitizeRows(rows: any[]): any[] {
    return rows.map((r) => {
      const out: any = {};
      for (const k of Object.keys(r)) out[k] = safeCellValue(r[k]);
      return out;
    });
  }

  // Build a single .xlsx file with one sheet per major table.
  function exportAllToXlsx(db: any, destFile: string): { sheets: string[]; rowCounts: Record<string, number> } {
    const EXPORTS = buildExportSpecs();
    const wb = XLSX.utils.book_new();
    const rowCounts: Record<string, number> = {};
    const sheets: string[] = [];
    for (const spec of EXPORTS) {
      try {
        const rawRows = (spec.rows ? spec.rows(db) : db.prepare(spec.sql!).all()) as any[];
        const rows = sanitizeRows(rawRows);
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
        const sheetName = spec.sheet.replace(/[\/\\?*\[\]]/g, '').slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        rowCounts[sheetName] = rawRows.length;
        sheets.push(sheetName);
      } catch {
        rowCounts[spec.sheet] = -1;
      }
    }
    // Completeness net: any table NOT covered by a curated sheet above still gets
    // dumped raw, so a newly-added module's data can never silently miss the
    // workbook. The .sqlite copy already has everything; this keeps the readable
    // Excel complete too. Secrets/internal tables stay in the .sqlite backup only.
    try {
      const CURATED = new Set(['patients', 'doctors', 'appointments', 'consultations', 'prescription_items', 'bills', 'lab_orders', 'lab_order_items', 'lab_tests', 'pharmacy_sales', 'pharmacy_sale_items', 'pharmacy_sale_payments', 'drug_inventory', 'drug_master', 'drug_stock_batches', 'wholesalers', 'purchase_invoices', 'purchase_invoice_items', 'purchase_payments', 'dispensing_register', 'ip_admissions', 'wards', 'beds', 'bed_transfers', 'ip_vitals', 'ip_medication_orders', 'ip_medication_admin', 'ip_progress_notes', 'ip_nursing_notes', 'ip_intake_output', 'ip_diet_orders', 'ip_cross_consultations', 'mlc_register', 'admission_requests', 'bill_items', 'bill_payments', 'advances', 'charge_heads', 'tpa_master', 'tpa_claims', 'discharge_templates', 'peds_growth_measurements', 'peds_vaccine_records', 'patient_allergies', 'patient_conditions', 'patient_family_history', 'radiology_orders', 'radiology_order_items', 'radiology_tests']);
      const SKIP = new Set(['sqlite_sequence', 'schema_meta', 'settings', 'users']); // secrets/internal → .sqlite backup only
      for (const t of listUserTables(db)) {
        if (CURATED.has(t) || SKIP.has(t)) continue;
        try {
          const rawRows = db.prepare(`SELECT * FROM "${t}"`).all() as any[];
          const rows = sanitizeRows(rawRows);
          const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
          const sheetName = ('tbl ' + t).replace(/[\/\\?*\[\]]/g, '').slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          rowCounts[sheetName] = rawRows.length;
          sheets.push(sheetName);
        } catch { /* skip a bad/locked table */ }
      }
    } catch { /* ignore — curated sheets are already written */ }
    if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
    // SheetJS doesn't reliably auto-detect Node fs inside a Vite-bundled Electron main —
    // generate the workbook into a buffer and write it ourselves.
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    fs.writeFileSync(destFile, buf);
    return { sheets, rowCounts };
  }

  function buildExportSpecs(): { sheet: string; sql?: string; rows?: (db: any) => any[] }[] {
    return [
      { sheet: 'Patients', sql: `SELECT id, uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state, created_at FROM patients ORDER BY created_at DESC` },
      { sheet: 'Doctors', sql: `SELECT id, name, specialty, qualifications, registration_no, phone, email, room_number, default_fee, is_active FROM doctors ORDER BY name` },
      { sheet: 'Appointments', sql: `
        SELECT a.id, a.token_number, a.appointment_date, a.appointment_time, a.status, a.notes, a.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, d.specialty as doctor_specialty
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC, a.appointment_time DESC` },
      { sheet: 'Consultations', sql: `
        SELECT c.id, c.appointment_id, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, c.history, c.vitals_json, c.examination, c.impression, c.advice, c.follow_up_date, c.created_at
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        ORDER BY c.created_at DESC` },
      { sheet: 'Prescriptions', sql: `
        SELECT r.id, r.appointment_id, a.appointment_date, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, r.drug_name, r.dosage, r.frequency, r.duration, r.instructions
        FROM prescription_items r
        JOIN appointments a ON a.id = r.appointment_id
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC` },
      { sheet: 'Bills', sql: `
        SELECT b.id, b.bill_number, b.total, b.subtotal, b.discount, b.discount_type, b.payment_mode,
               b.paid_at, b.created_at, b.items_json,
               b.status, b.bill_type, b.bill_kind, b.amount_paid, b.advance_adjusted,
               b.discount_reason, b.round_off, b.taxable_total, b.exempt_total, b.cgst_total, b.sgst_total, b.is_tax_invoice,
               b.is_free_followup, b.is_relaxed_followup, b.admission_id, b.lab_order_id, b.radiology_order_id,
               b.finalized_at, b.cancelled_at, b.cancelled_by, b.cancel_reason, b.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               COALESCE(d.name, bd.name) as doctor_name
        FROM bills b
        LEFT JOIN patients p ON p.id = b.patient_id
        LEFT JOIN appointments a ON a.id = b.appointment_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        LEFT JOIN doctors bd ON bd.id = b.doctor_id
        ORDER BY b.created_at DESC` },
      // Computed at backup time with the same rule the Billing portal and Accounts use, so the workbook says who
      // owed what on the day it was taken.
      { sheet: 'Outstanding Dues', rows: (d) => outstandingBills(d).map((r) => ({
          bill_number: r.bill_number, source: r.source === 'bill' ? 'Bill' : 'Pharmacy sale on credit',
          patient_uhid: r.uhid, patient_name: r.name, kind: r.kind, billed_on: r.created_at,
          total: r.total, paid: r.paid, advance_counted: r.advance, still_due: r.due, days_outstanding: r.age_days,
        })) },
      { sheet: 'Lab Orders', sql: `
        SELECT o.id, o.order_number, o.status, o.ordered_at, o.collected_at, o.reported_at, o.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM lab_orders o
        JOIN patients p ON p.id = o.patient_id
        LEFT JOIN doctors d ON d.id = o.doctor_id
        ORDER BY o.ordered_at DESC` },
      { sheet: 'Lab Results', sql: `
        SELECT oi.id, oi.lab_order_id, lo.order_number, oi.test_name, oi.result, oi.unit, oi.ref_range, oi.is_abnormal,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM lab_order_items oi
        JOIN lab_orders lo ON lo.id = oi.lab_order_id
        JOIN patients p ON p.id = lo.patient_id
        ORDER BY lo.ordered_at DESC` },
      { sheet: 'Lab Test Catalog', sql: `SELECT * FROM lab_tests ORDER BY name` },
      { sheet: 'Radiology Orders', sql: `
        SELECT o.id, o.order_number, o.status, o.ordered_at, o.performed_at, o.reported_at, o.reported_by,
               o.referred_by, o.clinical_info, o.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM radiology_orders o
        JOIN patients p ON p.id = o.patient_id
        LEFT JOIN doctors d ON d.id = o.doctor_id
        ORDER BY o.ordered_at DESC` },
      { sheet: 'Radiology Reports', sql: `
        SELECT oi.id, oi.order_id, ro.order_number, oi.test_name, oi.modality, oi.price, oi.findings, oi.impression, oi.is_abnormal,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM radiology_order_items oi
        JOIN radiology_orders ro ON ro.id = oi.order_id
        JOIN patients p ON p.id = ro.patient_id
        ORDER BY ro.ordered_at DESC` },
      { sheet: 'Radiology Catalog', sql: `SELECT * FROM radiology_tests ORDER BY name` },
      { sheet: 'Pharmacy Sales', sql: `
        SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.payment_mode, s.created_at,
               CASE WHEN s.payment_mode = 'IPD-bill' THEN 'Ward (on the IPD bill)'
                    WHEN s.patient_id IS NULL THEN 'Walk-in guest' ELSE 'Registered patient' END as customer_type,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name, s.customer_name as guest_name,
               s.sold_by, s.appointment_id, s.taxable_total, s.exempt_total, s.cgst_total, s.sgst_total, s.is_tax_invoice,
               CASE WHEN s.payment_mode = 'IPD-bill' THEN NULL ELSE COALESCE(s.amount_paid, s.total) END as amount_received,
               ${SALE_DUE_SQL} as balance_due,
               CASE WHEN s.on_credit = 1 THEN 'Yes' ELSE '' END as on_credit
        FROM pharmacy_sales s
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY s.created_at DESC` },
      // Money taken later against medicines sold on credit — one row per payment, so the workbook can rebuild every balance.
      { sheet: 'Pharmacy Credit Payments', sql: `
        SELECT sp.id, s.sale_number, s.created_at as sale_date, s.total as sale_total,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               sp.amount, sp.payment_mode, sp.received_at, sp.received_by, sp.reference, sp.notes
        FROM pharmacy_sale_payments sp
        JOIN pharmacy_sales s ON s.id = sp.sale_id
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY sp.received_at DESC, sp.id DESC` },
      { sheet: 'Pharmacy Sale Items', sql: `
        SELECT si.id, si.sale_id, s.sale_number, s.created_at as sale_date,
               si.drug_name, si.qty, si.rate, si.amount, si.discount_alloc,
               si.gst_rate, si.gst_amount, si.cgst, si.sgst, si.hsn_sac, si.drug_master_id, si.batch_id
        FROM pharmacy_sale_items si
        JOIN pharmacy_sales s ON s.id = si.sale_id
        ORDER BY s.created_at DESC` },
      { sheet: 'Pharmacy Inventory (legacy)', sql: `SELECT * FROM drug_inventory ORDER BY name` },
      { sheet: 'Drug List', sql: `
        SELECT id, name, generic_name, manufacturer, form, strength, pack_size,
               schedule, hsn_code, gst_rate, default_mrp, low_stock_threshold,
               barcode, is_active, notes, created_at
        FROM drug_master ORDER BY name
      `},
      { sheet: 'Drug Stock Batches', sql: `
        SELECT b.id, m.name as drug_name, b.batch_no, b.expiry, b.manufacture_date,
               b.qty_received, b.qty_remaining, b.purchase_price, b.unit_cost, b.mrp, b.selling_price,
               CASE WHEN b.purchase_item_id IS NULL THEN 'typed in by hand' ELSE 'from a purchase bill' END as cost_source,
               b.purchase_item_id, b.manufacturer_license_no, b.received_at, b.is_active
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
        ORDER BY m.name, date(b.expiry)
      `},
      { sheet: 'Wholesalers', sql: `
        SELECT id, name, contact_person, phone, email, address,
               drug_license_no, gstin, is_active, notes, created_at
        FROM wholesalers ORDER BY name
      `},
      { sheet: 'Purchase Invoices', sql: `
        SELECT pi.id, pi.invoice_number, w.name as wholesaler_name,
               w.drug_license_no as wholesaler_license_no,
               pi.invoice_date, pi.received_date, pi.subtotal, pi.cgst, pi.sgst, pi.igst,
               pi.discount, pi.other_charges, pi.round_off, pi.total, pi.payment_mode, pi.payment_status,
               pi.amount_paid, (pi.total - COALESCE(pi.amount_paid, 0)) as balance_due, pi.gst_in_cost,
               pi.scan_path, pi.notes, pi.created_at
        FROM purchase_invoices pi
        JOIN wholesalers w ON w.id=pi.wholesaler_id
        ORDER BY date(pi.invoice_date) DESC
      `},
      { sheet: 'Purchase Invoice Items', sql: `
        SELECT pii.id, pi.invoice_number, w.name as wholesaler_name,
               m.name as drug_name, pii.batch_no, pii.expiry,
               pii.qty_received, pii.pack_qty, pii.free_qty,
               pii.purchase_price, pii.disc_pct, pii.discount_amount, pii.taxable_value, pii.gst_rate, pii.gst_amount,
               pii.unit_cost, pii.mrp, pii.selling_price, pii.manufacture_date,
               pii.manufacturer_license_no, pii.line_total
        FROM purchase_invoice_items pii
        JOIN purchase_invoices pi ON pi.id=pii.invoice_id
        JOIN wholesalers w ON w.id=pi.wholesaler_id
        JOIN drug_master m ON m.id=pii.drug_master_id
        ORDER BY date(pi.invoice_date) DESC, pii.id
      `},
      { sheet: 'Supplier Payments', sql: `
        SELECT pp.id, pi.invoice_number, w.name as wholesaler_name, pp.amount, pp.payment_mode, pp.paid_on,
               pp.reference, pp.notes, pp.created_by, pp.created_at
        FROM purchase_payments pp
        JOIN purchase_invoices pi ON pi.id = pp.invoice_id
        JOIN wholesalers w ON w.id = pi.wholesaler_id
        ORDER BY pp.paid_on DESC, pp.id DESC
      `},
      { sheet: 'Dispensing Register', sql: `
        SELECT dr.id, dr.dispensed_at, dr.schedule,
               (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid,
               m.name as drug_name, dr.batch_no, dr.expiry,
               dr.qty, dr.rate, dr.unit_cost, dr.sale_id, d.name as doctor_name,
               dr.rx_reference, dr.dispensed_by
        FROM dispensing_register dr
        LEFT JOIN patients p ON p.id=dr.patient_id
        LEFT JOIN doctors d ON d.id=dr.doctor_id
        JOIN drug_master m ON m.id=dr.drug_master_id
        ORDER BY dr.dispensed_at DESC
      `},
      { sheet: 'IP Admissions', sql: `
        SELECT a.id, a.admission_number, a.admitted_at, a.discharged_at, a.ward, a.bed_number,
               a.status, a.admission_notes, a.discharge_summary,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as admission_doctor
        FROM ip_admissions a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.admission_doctor_id
        ORDER BY a.admitted_at DESC` },
      // ── IPD, billing, insurance, pediatrics — every new table, so the Excel is
      // as complete as the .sqlite backup. SELECT * keeps each sheet self-describing
      // and immune to column renames.
      { sheet: 'Wards', sql: `SELECT * FROM wards ORDER BY sort_order, name` },
      { sheet: 'Beds', sql: `SELECT b.*, w.name AS ward_name FROM beds b LEFT JOIN wards w ON w.id=b.ward_id ORDER BY w.name, b.bed_number` },
      { sheet: 'Bed Transfers', sql: `SELECT * FROM bed_transfers ORDER BY transferred_at DESC` },
      { sheet: 'IP Vitals', sql: `SELECT * FROM ip_vitals ORDER BY recorded_at DESC` },
      { sheet: 'IP Medication Orders', sql: `SELECT * FROM ip_medication_orders ORDER BY id DESC` },
      { sheet: 'IP Medication Admin (MAR)', sql: `SELECT * FROM ip_medication_admin ORDER BY administered_at DESC` },
      { sheet: 'IP Progress Notes', sql: `SELECT * FROM ip_progress_notes ORDER BY noted_at DESC` },
      { sheet: 'IP Nursing Notes', sql: `SELECT * FROM ip_nursing_notes ORDER BY noted_at DESC` },
      { sheet: 'IP Intake Output', sql: `SELECT * FROM ip_intake_output ORDER BY recorded_at DESC` },
      { sheet: 'IP Diet Orders', sql: `SELECT * FROM ip_diet_orders ORDER BY id DESC` },
      { sheet: 'IP Cross Consultations', sql: `SELECT * FROM ip_cross_consultations ORDER BY requested_at DESC` },
      { sheet: 'MLC Register', sql: `SELECT * FROM mlc_register ORDER BY id DESC` },
      { sheet: 'Admission Requests', sql: `SELECT * FROM admission_requests ORDER BY requested_at DESC` },
      { sheet: 'Bill Items', sql: `SELECT bi.*, b.bill_number FROM bill_items bi LEFT JOIN bills b ON b.id=bi.bill_id ORDER BY bi.bill_id DESC, bi.id` },
      { sheet: 'Bill Payments', sql: `SELECT bp.*, b.bill_number FROM bill_payments bp LEFT JOIN bills b ON b.id=bp.bill_id ORDER BY bp.received_at DESC` },
      { sheet: 'Advances', sql: `SELECT a.*, p.uhid AS patient_uhid, (p.first_name || ' ' || p.last_name) AS patient_name FROM advances a LEFT JOIN patients p ON p.id=a.patient_id ORDER BY a.received_at DESC` },
      { sheet: 'Charge Heads', sql: `SELECT * FROM charge_heads ORDER BY sort_order, name` },
      { sheet: 'TPA Insurers', sql: `SELECT * FROM tpa_master ORDER BY name` },
      { sheet: 'TPA Claims', sql: `SELECT c.*, t.name AS insurer_name_master, p.uhid AS patient_uhid, (p.first_name || ' ' || p.last_name) AS patient_name FROM tpa_claims c LEFT JOIN tpa_master t ON t.id=c.tpa_id LEFT JOIN patients p ON p.id=c.patient_id ORDER BY c.created_at DESC` },
      { sheet: 'Discharge Templates', sql: `SELECT * FROM discharge_templates ORDER BY name` },
      { sheet: 'Peds Growth', sql: `SELECT g.*, p.uhid AS patient_uhid, (p.first_name || ' ' || p.last_name) AS patient_name FROM peds_growth_measurements g LEFT JOIN patients p ON p.id=g.patient_id ORDER BY g.measured_on DESC` },
      { sheet: 'Peds Vaccines', sql: `SELECT v.*, p.uhid AS patient_uhid, (p.first_name || ' ' || p.last_name) AS patient_name FROM peds_vaccine_records v LEFT JOIN patients p ON p.id=v.patient_id ORDER BY v.id DESC` },
      { sheet: 'EMR Allergies', sql: `
        SELECT a.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               a.allergen, a.reaction, a.severity, a.noted_at
        FROM patient_allergies a JOIN patients p ON p.id = a.patient_id` },
      { sheet: 'EMR Conditions', sql: `
        SELECT c.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               c.condition, c.since, c.notes, c.is_active
        FROM patient_conditions c JOIN patients p ON p.id = c.patient_id` },
      { sheet: 'EMR Family History', sql: `
        SELECT f.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               f.relation, f.condition, f.notes
        FROM patient_family_history f JOIN patients p ON p.id = f.patient_id` },
      { sheet: 'EMR Immunizations', sql: `
        SELECT i.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               i.vaccine, i.given_at, i.dose, i.notes
        FROM patient_immunizations i JOIN patients p ON p.id = i.patient_id` },
      { sheet: 'EMR Documents Index', sql: `
        SELECT d.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.file_name, d.file_type, d.size_bytes, d.note, d.uploaded_at, d.file_path
        FROM patient_documents d JOIN patients p ON p.id = d.patient_id
        ORDER BY d.uploaded_at DESC` },
      { sheet: 'Notifications', sql: `
        SELECT n.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               n.type, n.message, n.status, n.sent_at, n.created_at
        FROM notification_log n LEFT JOIN patients p ON p.id = n.patient_id
        ORDER BY n.created_at DESC` },
      { sheet: 'Audit Log', sql: `SELECT id, at, username, role, action, entity, entity_id, details FROM audit_log ORDER BY at DESC` },
      { sheet: 'Users', sql: `SELECT id, username, role, display_name, doctor_id, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC` },
      { sheet: 'Settings', sql: `SELECT key, value FROM settings WHERE key NOT IN ('admin_password', 'clinic_logo') ORDER BY key` },
    ];
  }

  // Old CSV function kept for compatibility — no longer called by default flow
  function exportAllCsvs(db: any, destDir: string): { files: string[]; rowCounts: Record<string, number> } {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const EXPORTS: { name: string; sql: string }[] = [
      { name: 'patients.csv', sql: `SELECT id, uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state, created_at FROM patients ORDER BY created_at DESC` },
      { name: 'doctors.csv', sql: `SELECT id, name, specialty, qualifications, registration_no, phone, email, room_number, default_fee, is_active FROM doctors ORDER BY name` },
      { name: 'appointments.csv', sql: `
        SELECT a.id, a.token_number, a.appointment_date, a.appointment_time, a.status, a.notes, a.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, d.specialty as doctor_specialty
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC, a.appointment_time DESC` },
      { name: 'consultations.csv', sql: `
        SELECT c.id, c.appointment_id, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, c.history, c.vitals_json, c.examination, c.impression, c.advice, c.follow_up_date, c.created_at
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        ORDER BY c.created_at DESC` },
      { name: 'prescriptions.csv', sql: `
        SELECT r.id, r.appointment_id, a.appointment_date, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, r.drug_name, r.dosage, r.frequency, r.duration, r.instructions
        FROM prescription_items r
        JOIN appointments a ON a.id = r.appointment_id
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC` },
      { name: 'bills.csv', sql: `
        SELECT b.id, b.bill_number, b.total, b.subtotal, b.discount, b.discount_type, b.payment_mode,
               b.paid_at, b.created_at, b.items_json,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM bills b
        LEFT JOIN patients p ON p.id = b.patient_id
        LEFT JOIN appointments a ON a.id = b.appointment_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        ORDER BY b.created_at DESC` },
      { name: 'lab_orders.csv', sql: `
        SELECT o.id, o.order_number, o.status, o.ordered_at, o.collected_at, o.reported_at, o.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM lab_orders o
        JOIN patients p ON p.id = o.patient_id
        LEFT JOIN doctors d ON d.id = o.doctor_id
        ORDER BY o.ordered_at DESC` },
      { name: 'lab_results.csv', sql: `
        SELECT oi.id, oi.lab_order_id, lo.order_number, oi.test_name, oi.result, oi.unit, oi.ref_range, oi.is_abnormal,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM lab_order_items oi
        JOIN lab_orders lo ON lo.id = oi.lab_order_id
        JOIN patients p ON p.id = lo.patient_id
        ORDER BY lo.ordered_at DESC` },
      { name: 'lab_test_catalog.csv', sql: `SELECT * FROM lab_tests ORDER BY name` },
      { name: 'radiology_orders.csv', sql: `
        SELECT o.id, o.order_number, o.status, o.ordered_at, o.performed_at, o.reported_at, o.reported_by,
               o.referred_by, o.clinical_info, o.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM radiology_orders o
        JOIN patients p ON p.id = o.patient_id
        LEFT JOIN doctors d ON d.id = o.doctor_id
        ORDER BY o.ordered_at DESC` },
      { name: 'radiology_reports.csv', sql: `
        SELECT oi.id, oi.order_id, ro.order_number, oi.test_name, oi.modality, oi.price, oi.findings, oi.impression, oi.is_abnormal,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM radiology_order_items oi
        JOIN radiology_orders ro ON ro.id = oi.order_id
        JOIN patients p ON p.id = ro.patient_id
        ORDER BY ro.ordered_at DESC` },
      { name: 'radiology_test_catalog.csv', sql: `SELECT * FROM radiology_tests ORDER BY name` },
      { name: 'pharmacy_sales.csv', sql: `
        SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.payment_mode, s.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               CASE WHEN s.payment_mode = 'IPD-bill' THEN NULL ELSE COALESCE(s.amount_paid, s.total) END as amount_received,
               ${SALE_DUE_SQL} as balance_due
        FROM pharmacy_sales s
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY s.created_at DESC` },
      { name: 'pharmacy_credit_payments.csv', sql: `
        SELECT sp.id, s.sale_number, sp.amount, sp.payment_mode, sp.received_at, sp.received_by, sp.reference,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM pharmacy_sale_payments sp
        JOIN pharmacy_sales s ON s.id = sp.sale_id
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY sp.received_at DESC, sp.id DESC` },
      { name: 'pharmacy_sale_items.csv', sql: `
        SELECT si.id, si.sale_id, s.sale_number, s.created_at as sale_date,
               si.drug_name, si.qty, si.rate, si.amount
        FROM pharmacy_sale_items si
        JOIN pharmacy_sales s ON s.id = si.sale_id
        ORDER BY s.created_at DESC` },
      { name: 'pharmacy_inventory.csv', sql: `SELECT * FROM drug_inventory ORDER BY name` },
      { name: 'ip_admissions.csv', sql: `
        SELECT a.id, a.admission_number, a.admitted_at, a.discharged_at, a.ward, a.bed_number,
               a.status, a.admission_notes, a.discharge_summary,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as admission_doctor
        FROM ip_admissions a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.admission_doctor_id
        ORDER BY a.admitted_at DESC` },
      { name: 'emr_allergies.csv', sql: `
        SELECT a.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               a.allergen, a.reaction, a.severity, a.noted_at
        FROM patient_allergies a JOIN patients p ON p.id = a.patient_id` },
      { name: 'emr_conditions.csv', sql: `
        SELECT c.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               c.condition, c.since, c.notes, c.is_active
        FROM patient_conditions c JOIN patients p ON p.id = c.patient_id` },
      { name: 'emr_family_history.csv', sql: `
        SELECT f.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               f.relation, f.condition, f.notes
        FROM patient_family_history f JOIN patients p ON p.id = f.patient_id` },
      { name: 'emr_immunizations.csv', sql: `
        SELECT i.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               i.vaccine, i.given_at, i.dose, i.notes
        FROM patient_immunizations i JOIN patients p ON p.id = i.patient_id` },
      { name: 'emr_documents_index.csv', sql: `
        SELECT d.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.file_name, d.file_type, d.size_bytes, d.note, d.uploaded_at, d.file_path
        FROM patient_documents d JOIN patients p ON p.id = d.patient_id
        ORDER BY d.uploaded_at DESC` },
      { name: 'notifications_log.csv', sql: `
        SELECT n.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               n.type, n.message, n.status, n.sent_at, n.created_at
        FROM notification_log n LEFT JOIN patients p ON p.id = n.patient_id
        ORDER BY n.created_at DESC` },
      { name: 'audit_log.csv', sql: `
        SELECT id, at, username, role, action, entity, entity_id, details
        FROM audit_log ORDER BY at DESC` },
      { name: 'users.csv', sql: `SELECT id, username, role, display_name, doctor_id, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC` },
      { name: 'settings.csv', sql: `SELECT key, value FROM settings WHERE key NOT IN ('admin_password') ORDER BY key` },
    ];
    const rowCounts: Record<string, number> = {};
    const files: string[] = [];
    for (const spec of EXPORTS) {
      try {
        const n = exportTableToCsv(db, spec.sql, path.join(destDir, spec.name));
        rowCounts[spec.name] = n;
        files.push(spec.name);
      } catch (e: any) {
        // Table may not exist on a fresh DB — skip but note it
        rowCounts[spec.name] = -1;
      }
    }
    return { files, rowCounts };
  }

  function validateFolderPath(p: string): string | null {
    if (!p) return null;
    if (/^https?:\/\//i.test(p.trim())) return 'Backup folder is a web URL (http/https). You need a LOCAL folder path like G:\\My Drive\\CureDesk Backups — install Google Drive for Desktop and use the folder it creates.';
    if (p.includes('drive.google.com')) return 'That is a Google Drive sharing link, not a folder on this PC. Install Google Drive for Desktop and point this at the synced folder (usually G:\\My Drive\\...).';
    return null;
  }

  // Count files recursively
  function countFilesRec(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countFilesRec(path.join(dir, e.name));
      else n += 1;
    }
    return n;
  }

  // Keep the last N items (files or folders) inside a directory
  function retainLast(dir: string, n: number) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir)
      .map((name) => ({ name, full: path.join(dir, name), t: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of items.slice(n)) {
      try {
        const st = fs.statSync(old.full);
        if (st.isDirectory()) fs.rmSync(old.full, { recursive: true, force: true });
        else fs.unlinkSync(old.full);
      } catch { /* ignore */ }
    }
  }

  // Returns YYYY-MM-DD and HH-MM-SS (local time) for tidy folder naming
  function dateParts(d = new Date()) {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    return { day, time };
  }

  // Core backup routine. Layout:
  //   <root>/sqlite/<YYYY-MM-DD>/<HH-MM-SS>/caredesk.sqlite + documents/ + manifest.json
  //   <root>/excel/<YYYY-MM-DD>/<HH-MM-SS>.xlsx   (single xlsx with one sheet per table)
  async function performBackupToRoot(root: string, label: 'backup' | 'pre-restore' = 'backup'):
    Promise<{ ok: true; bundleDir: string; xlsxFile: string; documentCount: number; totalBackups: number;
      verified: boolean; integrityOk: boolean; mismatches: { table: string; live: number; backup: number | null }[];
      receipt: { label: string; count: number }[]; totalRows: number }> {
    const userData = app.getPath('userData');
    const sqliteSrc = path.join(userData, 'caredesk.sqlite');
    const docsSrc = path.join(userData, 'documents');

    const { day, time } = dateParts();
    const folderName = label === 'pre-restore' ? `pre-restore-${time}` : time;

    // Snapshot live row counts right before the copy so verification compares
    // like-for-like (a couple of writes could otherwise sneak in between).
    const liveCounts: Record<string, number> = {};
    try {
      const live = getDb();
      for (const t of listUserTables(live)) {
        try { liveCounts[t] = (live.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c; }
        catch { /* skip */ }
      }
    } catch { /* if this fails, verification simply has nothing to compare against */ }

    // sqlite/<day>/<time>/...
    const bundleDir = path.join(root, 'sqlite', day, folderName);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dbDest = path.join(bundleDir, 'caredesk.sqlite');
    /**
     * Prefer SQLite's own online-backup API: it produces a consistent snapshot
     * that INCLUDES anything still sitting in the write-ahead log.
     *
     * The fallback is a plain file copy, and on a WAL database that is not the
     * same thing — recent transactions live in `caredesk.sqlite-wal` until a
     * checkpoint folds them back into the main file, so a bare copy can silently
     * lose the last stretch of work. This used to swallow the error and copy
     * anyway, which meant the one case where the safe path failed was also the
     * case nobody was told about. Now the WAL is checkpointed into the database
     * first, and the fallback is recorded so it shows up on the receipt.
     */
    let backupMethod: 'online' | 'file-copy-after-checkpoint' = 'online';
    let backupFallbackReason: string | null = null;
    try {
      await getDb().backup(dbDest);
    } catch (e: any) {
      backupMethod = 'file-copy-after-checkpoint';
      backupFallbackReason = e?.message || String(e);
      try { getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
      fs.copyFileSync(sqliteSrc, dbDest);
    }
    if (fs.existsSync(docsSrc)) copyDirRecursive(docsSrc, path.join(bundleDir, 'documents'));
    const documentCount = countFilesRec(docsSrc);

    // Verify the file we just wrote: not corrupt + every row accounted for.
    let verify: ReturnType<typeof verifyBackupFile>;
    try {
      verify = verifyBackupFile(dbDest, liveCounts);
    } catch (e: any) {
      verify = { integrityOk: false, verified: false,
        mismatches: [{ table: '(could not open backup)', live: -1, backup: null }],
        receipt: [], totalRows: 0 };
    }

    // excel/<day>/<time>.xlsx
    const excelDayDir = path.join(root, 'excel', day);
    fs.mkdirSync(excelDayDir, { recursive: true });
    const xlsxFile = path.join(excelDayDir, `${folderName}.xlsx`);
    const xlsx = exportAllToXlsx(getDb(), xlsxFile);

    // Manifest
    const manifest = {
      app: 'CureDesk HMS',
      version: app.getVersion(),
      created_at: new Date().toISOString(),
      kind: label,
      sqlite_path: dbDest,
      xlsx_path: xlsxFile,
      sqlite_size_bytes: fs.statSync(dbDest).size,
      // How the copy was taken. 'online' is the safe path; the fallback is noted
      // (with its cause) so a support call can tell them apart months later.
      backup_method: backupMethod,
      ...(backupFallbackReason ? { backup_fallback_reason: backupFallbackReason } : {}),
      xlsx_size_bytes: fs.statSync(xlsxFile).size,
      document_files: documentCount,
      sheets: xlsx.sheets,
      sheet_row_counts: xlsx.rowCounts,
      // Proof this backup is sound: integrity_check passed AND every table's row
      // count in the copy matches the live database at the moment of backup.
      verification: {
        integrity_check: verify.integrityOk ? 'ok' : 'FAILED',
        row_counts_match: verify.mismatches.length === 0,
        verified: verify.verified,
        total_rows: verify.totalRows,
        mismatches: verify.mismatches,
        receipt: verify.receipt,
      },
      note: 'If the app is unusable, open the .xlsx file in Excel or Google Sheets — every table is a sheet inside it.',
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Retention is OFF by default (keep_all_backups=true) — deleting old local files would
    // also delete them from a synced cloud folder (Google Drive Desktop is two-way sync).
    // Receptionist can opt back into auto-cleanup from Settings if they want to save disk space.
    const settings = getAllSettings(getDb());
    if (!settings.keep_all_backups) {
      retainLast(path.join(root, 'sqlite', day), 10);
      retainLast(path.join(root, 'excel', day), 10);
      retainLast(path.join(root, 'sqlite'), 30);
      retainLast(path.join(root, 'excel'), 30);
    }

    // Count total backup folders for reporting
    const totalBackups = fs.existsSync(path.join(root, 'sqlite'))
      ? fs.readdirSync(path.join(root, 'sqlite')).reduce((acc, dayDir) => {
          const p = path.join(root, 'sqlite', dayDir);
          if (!fs.statSync(p).isDirectory()) return acc;
          return acc + fs.readdirSync(p).filter((x) => fs.statSync(path.join(p, x)).isDirectory()).length;
        }, 0)
      : 0;

    return { ok: true, bundleDir, xlsxFile, documentCount, totalBackups,
      verified: verify.verified, integrityOk: verify.integrityOk, mismatches: verify.mismatches,
      receipt: verify.receipt, totalRows: verify.totalRows };
  }

  async function performBackup() {
    const s = getAllSettings(getDb());
    const invalid = validateFolderPath(s.backup_folder);
    if (invalid) throw new Error(invalid);
    const root = backupRoot(s);
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const r = await performBackupToRoot(root, 'backup');
    logAudit(getDb(), actor(), 'backup_run', 'backups', undefined, `${r.bundleDir} · ${r.documentCount} docs`);
    return { path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, totalBundles: r.totalBackups, documentCount: r.documentCount,
      verified: r.verified, integrityOk: r.integrityOk, mismatches: r.mismatches, receipt: r.receipt, totalRows: r.totalRows };
  }

  ipcMain.handle('backup:now', async () => performBackup());
  // Expose performBackupToRoot to main.ts (auto-backup scheduler).
  _performBackupToRoot = performBackupToRoot;

  async function performBackupTo(targetDir: string) {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const r = await performBackupToRoot(targetDir, 'backup');
    logAudit(getDb(), actor(), 'backup_to_external', 'backups', undefined, r.bundleDir);
    return { ok: true as const, path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, documentCount: r.documentCount,
      verified: r.verified, integrityOk: r.integrityOk, mismatches: r.mismatches, receipt: r.receipt, totalRows: r.totalRows };
  }
  ipcMain.handle('backup:nowTo', async (_e, targetDir: string) => {
    if (!targetDir) return { ok: false, error: 'No folder selected' };
    const invalid = validateFolderPath(targetDir);
    if (invalid) return { ok: false, error: invalid };
    try { return await performBackupTo(targetDir); }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed' }; }
  });

  ipcMain.handle('dialog:pickFolder', async (_e, opts: { title?: string; defaultPath?: string } = {}) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: opts.title || 'Pick a folder',
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('dialog:pickFile', async (_e, opts: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {}) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: opts.title || 'Pick a file',
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  // ===== Restore preview =====
  // Tables we count for the restore summary. Order = display order in the UI.
  // Every real (non-internal) table in a database, straight from its schema — so
  // the backup preview always reflects the CURRENT schema, never a stale list.
  // New modules' tables (IPD, lab, billing…) show up automatically; an empty
  // table shows 0, and a table missing from an older backup shows null.
  function listUserTables(db: any): string[] {
    return (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[]).map((r) => r.name);
  }

  // Post-write verification of a just-created backup .sqlite. Proves the copy is
  // (a) not corrupt (PRAGMA integrity_check) and (b) actually contains the rows we
  // expect (row-count-per-table compared against the live DB). Also builds a
  // human "receipt" of the key patient-linked records so the user gets a visible,
  // trustworthy confirmation instead of a silent "done".
  function verifyBackupFile(
    backupSqlitePath: string,
    liveCounts: Record<string, number>,
  ): {
    integrityOk: boolean;
    verified: boolean;
    mismatches: { table: string; live: number; backup: number | null }[];
    receipt: { label: string; count: number }[];
    totalRows: number;
  } {
    const db = new Database(backupSqlitePath, { readonly: true, fileMustExist: true });
    try {
      // (a) SQLite's own corruption check. "ok" on a single row = clean file.
      let integrityOk = false;
      try {
        const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
        integrityOk = rows.length === 1 && String(rows[0].integrity_check).toLowerCase() === 'ok';
      } catch { integrityOk = false; }

      // (b) Row counts in the backup, compared to the live DB captured a moment ago.
      const backupCounts: Record<string, number> = {};
      let totalRows = 0;
      for (const t of listUserTables(db)) {
        try {
          const r = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number };
          backupCounts[t] = r.c;
          totalRows += r.c;
        } catch { /* skip unreadable table */ }
      }
      const mismatches: { table: string; live: number; backup: number | null }[] = [];
      for (const [t, live] of Object.entries(liveCounts)) {
        const b = t in backupCounts ? backupCounts[t] : null;
        if (b !== live) mismatches.push({ table: t, live, backup: b });
      }

      // Human-readable receipt of the records that matter to a clinic. Discharge
      // summaries are a column on ip_admissions, so they get a custom count.
      const receipt: { label: string; count: number }[] = [];
      const add = (label: string, table: string) => {
        if (table in backupCounts) receipt.push({ label, count: backupCounts[table] });
      };
      add('Patients', 'patients');
      add('Visits / appointments', 'appointments');
      add('OPD consultations', 'consultations');
      add('Prescriptions', 'prescription_items');
      add('Bills', 'bills');
      add('Bill line items', 'bill_items');
      add('Payments recorded', 'bill_payments');
      add('IPD admissions', 'ip_admissions');
      try {
        const d = db.prepare(
          "SELECT COUNT(*) AS c FROM ip_admissions WHERE discharge_summary IS NOT NULL AND TRIM(discharge_summary) != ''"
        ).get() as { c: number };
        receipt.push({ label: 'Discharge summaries', count: d.c });
      } catch { /* table/column absent in older schema — skip */ }
      add('IPD progress notes', 'ip_progress_notes');
      add('Medication given (MAR)', 'ip_medication_admin');
      add('Lab orders', 'lab_orders');
      add('Radiology orders', 'radiology_orders');
      add('Pharmacy sales', 'pharmacy_sales');
      add('Pharmacy sale lines', 'pharmacy_sale_items');
      add('Stock batches', 'drug_stock_batches');
      add('Supplier purchase bills', 'purchase_invoices');
      add('Supplier payments', 'purchase_payments');
      add('Pharmacy credit payments', 'pharmacy_sale_payments');
      add('Dispensing register entries', 'dispensing_register');
      add('Advance deposits', 'advances');
      add('Uploaded documents', 'patient_documents');

      return { integrityOk, verified: integrityOk && mismatches.length === 0, mismatches, receipt, totalRows };
    } finally {
      db.close();
    }
  }

  function countTablesIn(sqlitePath: string): { counts: Record<string, number | null>; totalRows: number } {
    const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const counts: Record<string, number | null> = {};
      let totalRows = 0;
      for (const t of listUserTables(db)) {
        try {
          const r = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get() as { c: number };
          counts[t] = r.c;
          totalRows += r.c;
        } catch {
          counts[t] = null;
        }
      }
      return { counts, totalRows };
    } finally {
      db.close();
    }
  }

  /** Pulls timestamp out of a `sqlite/YYYY-MM-DD/HH-MM-SS/...` path. Falls back to file mtime. */
  function parseBackupTimestamp(sourcePath: string, sqliteFilePath: string): string | null {
    const m = sourcePath.replace(/\\/g, '/').match(/sqlite\/(\d{4}-\d{2}-\d{2})\/(\d{2})-(\d{2})-(\d{2})(?:\/|$)/);
    if (m) {
      const [, date, hh, mm, ss] = m;
      // Treat as local time; build ISO that re-renders cleanly client-side.
      const local = new Date(`${date}T${hh}:${mm}:${ss}`);
      if (!isNaN(local.getTime())) return local.toISOString();
    }
    try {
      const st = fs.statSync(sqliteFilePath);
      return st.mtime.toISOString();
    } catch { return null; }
  }

  function resolveSourceSqlite(sourcePath: string): { ok: true; sqlitePath: string; docsDir: string | null } | { ok: false; error: string } {
    if (!sourcePath || !fs.existsSync(sourcePath)) return { ok: false, error: 'Source path does not exist' };
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      const cand = path.join(sourcePath, 'caredesk.sqlite');
      if (!fs.existsSync(cand)) return { ok: false, error: 'Folder does not contain caredesk.sqlite (not a valid CureDesk bundle)' };
      const docsDir = path.join(sourcePath, 'documents');
      return { ok: true, sqlitePath: cand, docsDir: fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory() ? docsDir : null };
    }
    if (!sourcePath.toLowerCase().endsWith('.sqlite') && !sourcePath.toLowerCase().endsWith('.db')) {
      return { ok: false, error: 'Pick a .sqlite file or a CureDesk bundle folder' };
    }
    return { ok: true, sqlitePath: sourcePath, docsDir: null };
  }

  ipcMain.handle('backup:previewRestore', async (_e, sourcePath: string) => {
    try {
      const resolved = resolveSourceSqlite(sourcePath);
      if (!resolved.ok) return { ok: false, error: resolved.error };

      const backupTakenAt = parseBackupTimestamp(sourcePath, resolved.sqlitePath);

      let backup: { counts: Record<string, number | null>; totalRows: number };
      try {
        backup = countTablesIn(resolved.sqlitePath);
      } catch (e: any) {
        return { ok: false, error: 'Could not read backup database: ' + (e?.message || e) };
      }

      const userData = app.getPath('userData');
      const currentDbPath = path.join(userData, 'caredesk.sqlite');
      let current: { counts: Record<string, number | null>; totalRows: number } = { counts: {}, totalRows: 0 };
      try {
        // Use the live db, not a separate connection — avoids WAL conflict.
        const db = getDb();
        for (const t of listUserTables(db)) {
          try {
            const r = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get() as { c: number };
            current.counts[t] = r.c;
            current.totalRows += r.c;
          } catch {
            current.counts[t] = null;
          }
        }
      } catch { /* ignore — show backup counts only */ }

      let docsCount: number | null = null;
      if (resolved.docsDir) {
        try { docsCount = fs.readdirSync(resolved.docsDir).length; } catch { docsCount = null; }
      }

      return {
        ok: true,
        sourcePath,
        sqlitePath: resolved.sqlitePath,
        hasBundleDocs: !!resolved.docsDir,
        documentFileCount: docsCount,
        backupTakenAt,
        backup: backup,
        current,
        currentDbPath,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ===== Restore / Import =====
  ipcMain.handle('backup:restore', async (_e, sourcePath: string, confirmPhrase: string) => {
    if (confirmPhrase !== 'REPLACE ALL DATA') {
      return { ok: false, error: 'Confirmation phrase required to proceed' };
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'Source path does not exist' };
    }
    const stat = fs.statSync(sourcePath);

    // Resolve the source DB file + optional documents folder
    let sourceSqlite: string;
    let sourceDocs: string | null = null;

    if (stat.isDirectory()) {
      const candidate = path.join(sourcePath, 'caredesk.sqlite');
      if (!fs.existsSync(candidate)) {
        return { ok: false, error: 'Folder does not contain caredesk.sqlite (not a valid CureDesk bundle)' };
      }
      sourceSqlite = candidate;
      const docsDir = path.join(sourcePath, 'documents');
      if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) sourceDocs = docsDir;
    } else {
      if (!sourcePath.toLowerCase().endsWith('.sqlite')) {
        return { ok: false, error: 'Pick a .sqlite file or a CureDesk bundle folder' };
      }
      sourceSqlite = sourcePath;
    }

    const userData = app.getPath('userData');
    const currentDb = path.join(userData, 'caredesk.sqlite');
    const currentDocs = path.join(userData, 'documents');

    // 1) Safety-backup the current data first (always, no matter what)
    try {
      const s = getAllSettings(getDb());
      const safeDir = backupRoot(s);
      if (!fs.existsSync(safeDir)) fs.mkdirSync(safeDir, { recursive: true });
      const r = await performBackupToRoot(safeDir, 'pre-restore');
      logAudit(getDb(), actor(), 'pre_restore_backup', 'backups', undefined, r.bundleDir);
    } catch (e: any) {
      return { ok: false, error: 'Could not make safety backup of current data: ' + (e?.message || e) };
    }

    // 2) Close the DB so we can overwrite the file
    closeDb();

    // 3) Replace caredesk.sqlite (and remove WAL sidecars so new DB is loaded cleanly)
    try {
      for (const sidecar of ['caredesk.sqlite-wal', 'caredesk.sqlite-shm']) {
        const p = path.join(userData, sidecar);
        if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
      }
      fs.copyFileSync(sourceSqlite, currentDb);
    } catch (e: any) {
      return { ok: false, error: 'Failed to copy new database: ' + (e?.message || e) };
    }

    // 4) Replace documents folder (if the bundle has one)
    try {
      if (sourceDocs) {
        if (fs.existsSync(currentDocs)) fs.rmSync(currentDocs, { recursive: true, force: true });
        copyDirRecursive(sourceDocs, currentDocs);
      }
    } catch (e: any) {
      return { ok: false, error: 'DB restored but documents copy failed: ' + (e?.message || e) };
    }

    logAudit(getDb(), actor(), 'restore_completed', 'backups', undefined, sourcePath);

    // 5) Relaunch app so all queries re-open against the new DB
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    return { ok: true, restartIn: 1000 };
  });

  ipcMain.handle('backup:list', () => {
    const userData = app.getPath('userData');
    const s = getAllSettings(getDb());
    const dir = backupRoot(s);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f: string) => f.startsWith('caredesk-') && f.endsWith('.sqlite'))
      .map((f: string) => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { name: f, path: p, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a: any, b: any) => b.mtime.localeCompare(a.mtime));
  });

  ipcMain.handle('backup:open', () => {
    const s = getAllSettings(getDb());
    const dir = backupRoot(s);
    shell.openPath(dir);
  });

  function scanBackupStatus(dir: string) {
    if (!fs.existsSync(dir)) return { lastBackupAt: null, lastBackupName: null, totalBackups: 0, dir };
    const sqliteRoot = path.join(dir, 'sqlite');
    let latestMtime = 0;
    let latestPath: string | null = null;
    let total = 0;
    if (fs.existsSync(sqliteRoot)) {
      for (const day of fs.readdirSync(sqliteRoot)) {
        const dayDir = path.join(sqliteRoot, day);
        try { if (!fs.statSync(dayDir).isDirectory()) continue; } catch { continue; }
        for (const time of fs.readdirSync(dayDir)) {
          const timeDir = path.join(dayDir, time);
          try { if (!fs.statSync(timeDir).isDirectory()) continue; } catch { continue; }
          const dbFile = path.join(timeDir, 'caredesk.sqlite');
          if (fs.existsSync(dbFile)) {
            total++;
            const mt = fs.statSync(dbFile).mtimeMs;
            if (mt > latestMtime) { latestMtime = mt; latestPath = dbFile; }
          }
        }
      }
    }
    return {
      lastBackupAt: latestMtime ? new Date(latestMtime).toISOString() : null,
      lastBackupName: latestPath,
      totalBackups: total,
      dir,
    };
  }

  ipcMain.handle('backup:status', () => {
    const s = getAllSettings(getDb());
    const dir = backupRoot(s);
    return scanBackupStatus(dir);
  });

  // ---- Cloud backup: point the auto-backup folder at a cloud-synced folder ----
  /** Find Google Drive / OneDrive / Dropbox / iCloud folders synced on this PC.
   *  We back up INTO one of these; the cloud client handles the upload — no API
   *  keys, works with any provider, patient data stays in the clinic's account. */
  function detectCloudFolders(): { provider: string; path: string }[] {
    const home = app.getPath('home');
    const found: { provider: string; path: string }[] = [];
    const add = (provider: string, dir?: string | null) => {
      if (!dir) return;
      try { if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) found.push({ provider, path: dir }); } catch { /* ignore */ }
    };
    if (process.platform === 'darwin') {
      const cs = path.join(home, 'Library', 'CloudStorage');
      try {
        for (const e of fs.readdirSync(cs)) {
          if (/^GoogleDrive-/i.test(e)) add('Google Drive', path.join(cs, e, 'My Drive'));
          else if (/^OneDrive/i.test(e)) add('OneDrive', path.join(cs, e));
          else if (/^Dropbox/i.test(e)) add('Dropbox', path.join(cs, e));
        }
      } catch { /* no CloudStorage dir */ }
      add('Google Drive', path.join(home, 'Google Drive'));
      add('OneDrive', path.join(home, 'OneDrive'));
      add('Dropbox', path.join(home, 'Dropbox'));
      add('iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    } else if (process.platform === 'win32') {
      add('OneDrive', process.env.OneDrive || process.env.OneDriveConsumer || path.join(home, 'OneDrive'));
      add('OneDrive', process.env.OneDriveCommercial);
      add('Dropbox', path.join(home, 'Dropbox'));
      add('Google Drive', path.join(home, 'Google Drive'));
      add('Google Drive', path.join(home, 'My Drive'));
      // Google Drive for Desktop mounts as a virtual drive letter (usually G:).
      for (let c = 68 /* D */; c <= 90 /* Z */; c++) add('Google Drive', `${String.fromCharCode(c)}:\\My Drive`);
    }
    const seen = new Set<string>();
    return found.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
  }

  ipcMain.handle('backup:detectCloudFolders', () => {
    try { return { ok: true as const, folders: detectCloudFolders() }; }
    catch (err: any) { return { ok: false as const, folders: [], error: err?.message || 'Failed' }; }
  });

  /** Create "CureDesk Backups" inside a cloud folder and route auto-backups there. */
  ipcMain.handle('backup:useCloudFolder', (_e, baseDir: string, provider?: string) => {
    try {
      if (!baseDir || !fs.existsSync(baseDir)) return { ok: false as const, error: 'That cloud folder no longer exists — is the cloud app still installed?' };
      const target = path.join(baseDir, 'CureDesk Backups');
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      const invalid = validateFolderPath(target);
      if (invalid) return { ok: false as const, error: invalid };
      const db = getDb();
      saveSettings(db, { backup_folder: target, auto_backup_enabled: true });
      logAudit(db, actor(), 'backup_cloud_set', 'backups', undefined, `${provider || 'cloud'} → ${target}`);
      return { ok: true as const, path: target };
    } catch (err: any) { return { ok: false as const, error: err?.message || 'Failed' }; }
  });

  ipcMain.handle('backup:quitAfter', async () => {
    const r = await performBackup();
    logAudit(getDb(), actor(), 'backup_and_close', 'backups', undefined, r.bundleDir);
    closeDb();
    setTimeout(() => app.quit(), 250);
    return { ok: true, path: r.bundleDir };
  });

  // ============================================================
  // ANALYTICS — top-level snapshot, demographics, pharmacy mix.
  // (Finance / origin / reports already have their own handlers above; the
  //  Analytics page reuses those plus the three new ones below.)
  // ============================================================
  ipcMain.handle('analytics:overview', () => {
    const db = getDb();
    const today = localISO();
    const monthStart = today.slice(0, 8) + '01';
    // UTC lower bounds (see utcSlack): the index on created_at skips everything older before the exact local-day test runs.
    const loToday = utcSlack(today, today).lo;
    const loMonth = utcSlack(monthStart, monthStart).lo;
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    // Defensive variants — return 0 on ANY error (missing column on a pre-migration
    // DB, SQL parse error, etc.) so one bad query doesn't kill the whole overview
    // and leave the UI stuck on "Loading…".
    const scSafe = (sql: string, ...p: any[]) => { try { return sc(sql, ...p); } catch { return 0; } };
    const ssSafe = (sql: string, ...p: any[]) => { try { return ss(sql, ...p); } catch { return 0; } };
    return {
      asOf: new Date().toISOString(),
      todayVisits: sc(`SELECT COUNT(*) as c FROM appointments WHERE appointment_date=?`, today),
      todayDone: sc(`SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Done'`, today),
      todayRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime')=?`, loToday, today),
      monthRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= ?`, loMonth, monthStart),
      // Counter sales only: ward-dispensed medicines are already lines on the in-patient bill, so counting the sale
      // too reported the same rupee twice.
      pharmacyMonthRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE created_at >= ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') >= ?`, loMonth, monthStart),
      pharmacyMonthPatientRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE created_at >= ? AND patient_id IS NOT NULL AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') >= ?`, loMonth, monthStart),
      pharmacyMonthGuestRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE created_at >= ? AND patient_id IS NULL AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') >= ?`, loMonth, monthStart),
      // Money still to collect across every bill and credit sale (same rule as the patient portal and Accounts).
      outstandingTotal: outstandingTotal(db),
      // …of which owed for medicines sold on credit.
      pharmacyCreditDue: ss(`SELECT COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)), 0) as t FROM pharmacy_sales WHERE on_credit = 1 AND COALESCE(payment_mode, '') <> 'IPD-bill'`),
      totalPatients: sc(`SELECT COUNT(*) as c FROM patients`),
      patientsThisMonth: sc(`SELECT COUNT(*) as c FROM patients WHERE created_at >= ? AND date(created_at, 'localtime') >= ?`, loMonth, monthStart),
      activeDoctors: sc(`SELECT COUNT(*) as c FROM doctors WHERE is_active=1`),
      pendingRx: sc(`
        SELECT COUNT(DISTINCT a.id) as c FROM appointments a
        WHERE a.id IN (SELECT DISTINCT appointment_id FROM prescription_items)
          AND a.id NOT IN (SELECT COALESCE(appointment_id, 0) FROM pharmacy_sales)
          AND a.appointment_date >= date('now', 'localtime', '-7 days')
      `),
      lowStockDrugs: sc(`
        SELECT COUNT(*) as c FROM drug_master m
        WHERE m.is_active=1 AND
          (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
           WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold
      `),
      expiringSoonBatches: sc(`
        SELECT COUNT(*) as c FROM drug_stock_batches
        WHERE is_active=1 AND qty_remaining > 0 AND date(expiry) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+90 days')
      `),
      expiredBatches: sc(`
        SELECT COUNT(*) as c FROM drug_stock_batches
        WHERE is_active=1 AND qty_remaining > 0 AND date(expiry) < date('now', 'localtime')
      `),
      // Free follow-up + registration-fee tracking — surfaced in Analytics so the
      // user can see what waivers cost them and what registration revenue came in.
      // All defensive: a fresh-from-old-binary DB without the migration columns
      // returns 0 instead of throwing and breaking the whole Overview tab.
      freeFollowupsThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_free_followup,0)=1 AND created_at >= ? AND date(created_at, 'localtime') >= ?
      `, loMonth, monthStart),
      relaxedFollowupsThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_relaxed_followup,0)=1 AND created_at >= ? AND date(created_at, 'localtime') >= ?
      `, loMonth, monthStart),
      registrationFeesThisMonth: ssSafe(`
        SELECT COALESCE(SUM(rate),0) as t
        FROM bills b, json_each(b.items_json) j
        WHERE b.created_at >= ? AND date(b.created_at, 'localtime') >= ?
          AND lower(json_extract(j.value, '$.description')) LIKE '%registration%'
      `, loMonth, monthStart),
      registrationFeeCountThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM patients WHERE registration_fee_paid=1 AND date(registration_fee_paid_at) >= ?
      `, monthStart),
      servicesCountThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND bill_kind='misc' AND created_at >= ? AND date(created_at, 'localtime') >= ?
      `, loMonth, monthStart),
      servicesRevenueThisMonth: ssSafe(`
        SELECT COALESCE(SUM(total),0) as t FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND bill_kind='misc' AND created_at >= ? AND date(created_at, 'localtime') >= ?
      `, loMonth, monthStart),
    };
  });

  // Standalone monthly summary endpoint for the Analytics → Patients sub-tab —
  // counts and revenue forgone (using each doctor's default_fee at time of waiver).

  ipcMain.handle('analytics:demographics', () => {
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) as c FROM patients`).get() as any).c;
    // Revenue joins live in the same call so the renderer fetches once.
    const revenueByGender = db.prepare(`
      SELECT COALESCE(NULLIF(p.gender,''), '(unknown)') as label,
             COUNT(DISTINCT b.id) as bills,
             COALESCE(SUM(b.total), 0) as revenue
      FROM bills b JOIN patients p ON p.id = b.patient_id
      GROUP BY label ORDER BY revenue DESC
    `).all();
    const revenueByAge = db.prepare(`
      SELECT
        CASE
          WHEN p.dob IS NULL OR p.dob = '' THEN '(unknown)'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 1 THEN '< 1 yr'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 5 THEN '1-4 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 13 THEN '5-12 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 18 THEN '13-17 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 30 THEN '18-29 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 45 THEN '30-44 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 60 THEN '45-59 yrs'
          WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 75 THEN '60-74 yrs'
          ELSE '75+ yrs'
        END as label,
        COUNT(DISTINCT b.id) as bills,
        COALESCE(SUM(b.total), 0) as revenue
      FROM bills b JOIN patients p ON p.id = b.patient_id
      GROUP BY label
      ORDER BY revenue DESC
    `).all();
    const revenueByProfession = db.prepare(`
      SELECT COALESCE(NULLIF(p.profession,''), '(unknown)') as label,
             COUNT(DISTINCT b.id) as bills,
             COALESCE(SUM(b.total), 0) as revenue
      FROM bills b JOIN patients p ON p.id = b.patient_id
      GROUP BY label ORDER BY revenue DESC LIMIT 20
    `).all();
    return {
      total,
      byGender: db.prepare(`
        SELECT COALESCE(NULLIF(gender,''), '(unknown)') as gender, COUNT(*) as c
        FROM patients GROUP BY gender ORDER BY c DESC
      `).all(),
      revenueByGender,
      revenueByAge,
      revenueByProfession,
      byAgeGroup: db.prepare(`
        SELECT
          CASE
            WHEN dob IS NULL OR dob = '' THEN '(unknown)'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 1 THEN '< 1 yr (Infant)'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 5 THEN '1-4 yrs (Toddler)'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 13 THEN '5-12 yrs (Child)'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 18 THEN '13-17 yrs (Teen)'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 30 THEN '18-29 yrs'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 45 THEN '30-44 yrs'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 60 THEN '45-59 yrs'
            WHEN (julianday('now') - julianday(dob)) / 365.25 < 75 THEN '60-74 yrs (Senior)'
            ELSE '75+ yrs (Elderly)'
          END as label,
          COUNT(*) as c
        FROM patients GROUP BY label
        ORDER BY MIN(julianday(dob)) DESC
      `).all(),
      byBloodGroup: db.prepare(`
        SELECT COALESCE(NULLIF(blood_group,''), '(unknown)') as label, COUNT(*) as c
        FROM patients GROUP BY label ORDER BY c DESC
      `).all(),
      byProfession: db.prepare(`
        SELECT COALESCE(NULLIF(profession,''), '(unknown)') as label, COUNT(*) as c
        FROM patients GROUP BY label ORDER BY c DESC LIMIT 20
      `).all(),
      newPatientsByMonth: db.prepare(`
        SELECT strftime('%Y-%m', created_at, 'localtime') as month, COUNT(*) as c
        FROM patients WHERE created_at >= date('now', 'localtime', '-12 months')
        GROUP BY month ORDER BY month
      `).all(),
    };
  });

  // Repeat-visit rate (30 / 60 / 90 day windows from each patient's first visit).
  // Only patients whose first visit was at least N days ago are eligible for the
  // N-day rate — otherwise we'd unfairly count them as 'never returned'.
  ipcMain.handle('analytics:retention', () => {
    const db = getDb();
    type Row = { patient_id: number; first_date: string; days_since_first: number; visits_30d: number; visits_60d: number; visits_90d: number };
    const rows = db.prepare(`
      SELECT
        fv.patient_id,
        fv.first_date,
        CAST(julianday('now') - julianday(fv.first_date) AS INTEGER) as days_since_first,
        (SELECT COUNT(*) FROM appointments a2
          WHERE a2.patient_id = fv.patient_id
            AND date(a2.appointment_date) > fv.first_date
            AND julianday(a2.appointment_date) - julianday(fv.first_date) <= 30
            AND a2.status != 'Cancelled') as visits_30d,
        (SELECT COUNT(*) FROM appointments a2
          WHERE a2.patient_id = fv.patient_id
            AND date(a2.appointment_date) > fv.first_date
            AND julianday(a2.appointment_date) - julianday(fv.first_date) <= 60
            AND a2.status != 'Cancelled') as visits_60d,
        (SELECT COUNT(*) FROM appointments a2
          WHERE a2.patient_id = fv.patient_id
            AND date(a2.appointment_date) > fv.first_date
            AND julianday(a2.appointment_date) - julianday(fv.first_date) <= 90
            AND a2.status != 'Cancelled') as visits_90d
      FROM (
        SELECT patient_id, MIN(date(appointment_date)) as first_date
        FROM appointments WHERE status != 'Cancelled'
        GROUP BY patient_id
      ) fv
    `).all() as Row[];

    const compute = (windowDays: number, key: 'visits_30d' | 'visits_60d' | 'visits_90d') => {
      const eligible = rows.filter((r) => r.days_since_first >= windowDays);
      const returned = eligible.filter((r) => r[key] > 0);
      return {
        eligible: eligible.length,
        returned: returned.length,
        rate: eligible.length === 0 ? 0 : Math.round((returned.length / eligible.length) * 1000) / 10,
      };
    };

    return {
      totalPatients: rows.length,
      window30: compute(30, 'visits_30d'),
      window60: compute(60, 'visits_60d'),
      window90: compute(90, 'visits_90d'),
    };
  });

  // Patient retention cohort — group patients by their first-visit month, then
  // count how many returned in each subsequent calendar month. Returns a list
  // of cohorts; UI pivots into the cohort × month-offset grid.
  ipcMain.handle('analytics:cohort', () => {
    const db = getDb();
    type R = { cohort_month: string; visit_month: string; active: number };
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', fv.first_date) as cohort_month,
        strftime('%Y-%m', a.appointment_date) as visit_month,
        COUNT(DISTINCT a.patient_id) as active
      FROM appointments a
      JOIN (
        SELECT patient_id, MIN(date(appointment_date)) as first_date
        FROM appointments WHERE status != 'Cancelled'
        GROUP BY patient_id
      ) fv ON fv.patient_id = a.patient_id
      WHERE a.status != 'Cancelled'
        AND fv.first_date >= date('now', 'localtime', '-12 months')
      GROUP BY cohort_month, visit_month
      ORDER BY cohort_month, visit_month
    `).all() as R[];

    // Group into cohorts: { cohort_month, size, retention: [count_at_offset_0, 1, 2, ...] }
    const byCohort = new Map<string, R[]>();
    for (const r of rows) {
      if (!byCohort.has(r.cohort_month)) byCohort.set(r.cohort_month, []);
      byCohort.get(r.cohort_month)!.push(r);
    }
    const monthOffset = (a: string, b: string) => {
      const [ay, am] = a.split('-').map((x) => parseInt(x, 10));
      const [by, bm] = b.split('-').map((x) => parseInt(x, 10));
      return (by - ay) * 12 + (bm - am);
    };
    const cohorts = Array.from(byCohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort_month, items]) => {
        const retention: number[] = [];
        for (const r of items) {
          const off = monthOffset(cohort_month, r.visit_month);
          if (off >= 0 && off < 13) {
            retention[off] = (retention[off] || 0) + r.active;
          }
        }
        const size = retention[0] || 0;
        return { cohort_month, size, retention };
      });
    return { cohorts };
  });

  // Weekday × hour heatmap (last 90 days). Returns sparse rows; UI pivots to 7×24.
  ipcMain.handle('analytics:weekdayHourHeatmap', () => {
    const db = getDb();
    return db.prepare(`
      SELECT
        CAST(strftime('%w', appointment_date) AS INTEGER) as weekday,
        CAST(substr(appointment_time, 1, 2) AS INTEGER) as hour,
        COUNT(*) as visits
      FROM appointments
      WHERE status != 'Cancelled'
        AND appointment_time IS NOT NULL AND appointment_time <> ''
        AND date(appointment_date) >= date('now', 'localtime', '-90 days')
      GROUP BY weekday, hour
      ORDER BY weekday, hour
    `).all();
  });

  // Pharmacy basket size — sales count, avg ₹ per sale, avg units per sale, by month.
  ipcMain.handle('analytics:pharmacyBasket', () => {
    const db = getDb();
    return db.prepare(`
      SELECT
        strftime('%Y-%m', s.created_at, 'localtime') as month,
        COUNT(*) as sales,
        COALESCE(AVG(s.total), 0) as avg_revenue,
        COALESCE(SUM(s.total), 0) as total_revenue,
        (SELECT COALESCE(AVG(units), 0) FROM (
          SELECT SUM(qty) as units FROM pharmacy_sale_items psi
          JOIN pharmacy_sales s2 ON s2.id = psi.sale_id
          WHERE strftime('%Y-%m', s2.created_at, 'localtime') = strftime('%Y-%m', s.created_at, 'localtime')
            AND COALESCE(s2.payment_mode, '') <> 'IPD-bill'
          GROUP BY psi.sale_id
        )) as avg_units
      FROM pharmacy_sales s
      WHERE s.created_at >= date('now', 'localtime', '-12 months') AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
      GROUP BY month
      ORDER BY month
    `).all();
  });

  ipcMain.handle('analytics:pharmacyOverview', (_e, filter: { from: string; to: string }) => {
    const db = getDb();
    // UTC bounds that only prune (see utcSlack) — the exact local-day test still decides.
    const slack = utcSlack(filter.from, filter.to);
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    return {
      totalDispensed: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE dispensed_at >= ? AND dispensed_at < ? AND date(dispensed_at, 'localtime') BETWEEN ? AND ?`, slack.lo, slack.hi, filter.from, filter.to),
      scheduleHCount: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE dispensed_at >= ? AND dispensed_at < ? AND date(dispensed_at, 'localtime') BETWEEN ? AND ? AND schedule IN ('H','H1')`, slack.lo, slack.hi, filter.from, filter.to),
      totalRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?`, slack.lo, slack.hi, filter.from, filter.to),
      totalSales: sc(`SELECT COUNT(*) as c FROM pharmacy_sales WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?`, slack.lo, slack.hi, filter.from, filter.to),
      // Live inventory valuation (not date-filtered — it's a snapshot of stock now).
      valuation: db.prepare(`
        SELECT COUNT(DISTINCT m.id) as skus,
               COALESCE(SUM(b.qty_remaining), 0) as units,
               COALESCE(SUM(b.qty_remaining * COALESCE(b.unit_cost, b.purchase_price)), 0) as at_cost,
               COALESCE(SUM(b.qty_remaining * b.mrp), 0) as at_mrp,
               COALESCE(SUM(b.qty_remaining * COALESCE(b.selling_price, b.mrp)), 0) as at_selling
        FROM drug_master m LEFT JOIN drug_stock_batches b ON b.drug_master_id=m.id AND b.is_active=1
        WHERE m.is_active=1
      `).get(),
      expiredStock: db.prepare(`
        SELECT COUNT(*) as batches, COALESCE(SUM(qty_remaining * COALESCE(unit_cost, purchase_price)), 0) as value
        FROM drug_stock_batches WHERE is_active=1 AND qty_remaining > 0 AND date(expiry) < date('now', 'localtime')
      `).get(),
      lowStockCount: sc(`SELECT COUNT(*) as c FROM drug_master m WHERE m.is_active=1
        AND (SELECT COALESCE(SUM(qty_remaining),0) FROM drug_stock_batches b WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold`),
      topDrugs: db.prepare(`
        SELECT COALESCE(m.name, ps.drug_name) as name,
               SUM(ps.qty) as units,
               SUM(ps.amount) as revenue,
               COUNT(DISTINCT ps.sale_id) as sales
        FROM pharmacy_sale_items ps
        JOIN pharmacy_sales s ON s.id = ps.sale_id
        LEFT JOIN drug_master m ON m.id = ps.drug_master_id
        WHERE s.created_at >= ? AND s.created_at < ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill' AND date(s.created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY name
        ORDER BY revenue DESC LIMIT 20
      `).all(slack.lo, slack.hi, filter.from, filter.to),
      salesMix: db.prepare(`
        SELECT
          CASE WHEN appointment_id IS NULL THEN 'Counter Sale (walk-in)' ELSE 'Rx-driven (from doctor)' END as kind,
          COUNT(*) as count,
          COALESCE(SUM(total),0) as revenue
        FROM pharmacy_sales
        -- Ward-dispensed medicines are billed on the IPD bill; counting the
        -- pharmacy sale too would report the same rupee twice.
        WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY kind
      `).all(slack.lo, slack.hi, filter.from, filter.to),
      // Whose sales: registered patients (also in their Billing) vs walk-in guests. Together they are totalSales/totalRevenue.
      customerMix: db.prepare(`
        SELECT CASE WHEN patient_id IS NULL THEN 'guest' ELSE 'patient' END as kind,
               COUNT(*) as count, COALESCE(SUM(total),0) as revenue, COALESCE(AVG(total),0) as avg_sale
        FROM pharmacy_sales
        WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY kind
      `).all(slack.lo, slack.hi, filter.from, filter.to),
      // Paid by: what was taken at the counter, by payment mode — plus "On credit" for the part of a sale left owing.
      paymentMix: (() => {
        const rows = db.prepare(`
          SELECT COALESCE(NULLIF(TRIM(x.payment_mode), ''), 'Unspecified') as mode,
                 COALESCE(SUM(x.at_sale), 0) as paid_now, COALESCE(SUM(x.total - x.at_sale), 0) as credit,
                 SUM(CASE WHEN x.at_sale > 0.004 THEN 1 ELSE 0 END) as paid_n,
                 SUM(CASE WHEN x.total - x.at_sale > 0.004 THEN 1 ELSE 0 END) as credit_n
            FROM (SELECT s.payment_mode, s.total,
                         MAX(COALESCE(s.amount_paid, s.total) - COALESCE(pp.s, 0), 0) as at_sale
                    FROM pharmacy_sales s
                    LEFT JOIN (SELECT sale_id, SUM(amount) AS s FROM pharmacy_sale_payments GROUP BY sale_id) pp ON pp.sale_id = s.id
                   WHERE s.created_at >= ? AND s.created_at < ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
                     AND date(s.created_at, 'localtime') BETWEEN ? AND ?) x
           GROUP BY mode
        `).all(slack.lo, slack.hi, filter.from, filter.to) as { mode: string; paid_now: number; credit: number; paid_n: number; credit_n: number }[];
        const out: { mode: string; count: number; revenue: number }[] = [];
        let creditP = 0, creditN = 0;
        for (const r of rows) {
          if (r.paid_now > 0.004) out.push({ mode: r.mode, count: r.paid_n || 0, revenue: Math.round(r.paid_now * 100) / 100 });
          creditP += Math.round(r.credit * 100); creditN += r.credit_n || 0;
        }
        if (creditP > 0) out.push({ mode: 'On credit', count: creditN, revenue: creditP / 100 });
        return out.sort((a, b) => b.revenue - a.revenue);
      })(),
      // Medicines sold on credit: this period's, and what is owed now across every credit sale.
      creditSummary: (() => {
        const win = db.prepare(`
          SELECT COUNT(*) as sold_count,
                 COALESCE(SUM(s.total - MAX(COALESCE(s.amount_paid, s.total) - COALESCE(pp.s, 0), 0)), 0) as credit_value,
                 COALESCE(SUM(MAX(s.total - COALESCE(s.amount_paid, s.total), 0)), 0) as still_owed
            FROM pharmacy_sales s
            LEFT JOIN (SELECT sale_id, SUM(amount) AS s FROM pharmacy_sale_payments GROUP BY sale_id) pp ON pp.sale_id = s.id
           WHERE s.on_credit = 1 AND s.created_at >= ? AND s.created_at < ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
             AND date(s.created_at, 'localtime') BETWEEN ? AND ?
        `).get(slack.lo, slack.hi, filter.from, filter.to) as { sold_count: number; credit_value: number; still_owed: number };
        const all = db.prepare(`
          SELECT COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)), 0) as due, COUNT(DISTINCT patient_id) as patients,
                 SUM(CASE WHEN total - COALESCE(amount_paid, total) > 0.004 THEN 1 ELSE 0 END) as sales,
                 MIN(CASE WHEN total - COALESCE(amount_paid, total) > 0.004 THEN date(created_at, 'localtime') END) as oldest
            FROM pharmacy_sales WHERE on_credit = 1 AND COALESCE(payment_mode, '') <> 'IPD-bill' AND total - COALESCE(amount_paid, total) > 0.004
        `).get() as { due: number; patients: number; sales: number | null; oldest: string | null };
        return {
          sold_count: win.sold_count, credit_value: Math.round(win.credit_value * 100) / 100, still_owed_from_these: Math.round(win.still_owed * 100) / 100,
          owed_now: Math.round(all.due * 100) / 100, sales_owing: all.sales ?? 0, patients_owing: all.patients ?? 0, oldest_owed_since: all.oldest ?? null,
        };
      })(),
      topPatients: db.prepare(`
        SELECT p.id as patient_id, (p.first_name || ' ' || p.last_name) as name, p.uhid,
               COUNT(*) as sales, COALESCE(SUM(s.total),0) as revenue
        FROM pharmacy_sales s JOIN patients p ON p.id = s.patient_id
        WHERE s.created_at >= ? AND s.created_at < ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill' AND date(s.created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY p.id ORDER BY revenue DESC LIMIT 10
      `).all(slack.lo, slack.hi, filter.from, filter.to),
      scheduleMix: db.prepare(`
        SELECT schedule, COUNT(*) as count, SUM(qty) as units
        FROM dispensing_register
        WHERE dispensed_at >= ? AND dispensed_at < ? AND date(dispensed_at, 'localtime') BETWEEN ? AND ?
        GROUP BY schedule
        ORDER BY count DESC
      `).all(slack.lo, slack.hi, filter.from, filter.to),
      lowStock: db.prepare(`
        SELECT m.name,
               (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
                WHERE b.drug_master_id=m.id AND b.is_active=1) as stock,
               m.low_stock_threshold
        FROM drug_master m
        WHERE m.is_active=1
          AND (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
               WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold
        ORDER BY stock ASC LIMIT 20
      `).all(),
      expiringSoon: db.prepare(`
        SELECT m.name as drug_name, b.batch_no, b.expiry, b.qty_remaining,
               CAST((julianday(b.expiry) - julianday(date('now', 'localtime'))) AS INTEGER) as days
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
        WHERE b.is_active=1 AND b.qty_remaining > 0
          AND date(b.expiry) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+90 days')
        ORDER BY date(b.expiry) ASC LIMIT 30
      `).all(),
    };
  });

  // ===== Modules P&L — revenue by clinical module, side by side =====
  ipcMain.handle('analytics:modules', (_e, from: string, to: string) => {
    const db = getDb();
    // Collected = billed − still due, with "due" worked out per bill by the one rule the patient portal and Accounts
    // use (billing-portal.ts): an in-patient's advance deposit counts as received, a cancelled bill is out. Everything
    // except in-patient bills is plain arithmetic (billed − paid, never below zero), so it is summed in SQL; the few
    // in-patient bills go through the full rule one by one.
    const slack = utcSlack(from, to);
    const billAgg = (cond: string) => {
      const rangeSql = `FROM bills b WHERE (b.status IS NULL OR b.status <> 'cancelled') AND b.created_at >= ? AND b.created_at < ?
                        AND date(b.created_at, 'localtime') BETWEEN ? AND ? AND ${cond}`;
      const args = [slack.lo, slack.hi, from, to];
      const isIpd = "(b.admission_id IS NOT NULL OR COALESCE(b.bill_type, '') = 'ipd')";
      const flat = db.prepare(
        `SELECT SUM(CASE WHEN ${isIpd} THEN 0 ELSE 1 END) AS n,
                COALESCE(SUM(CASE WHEN ${isIpd} THEN 0 ELSE b.total END), 0) AS revenue,
                COALESCE(SUM(CASE WHEN ${isIpd} THEN 0 ELSE MAX(b.total - b.amount_paid, 0) END), 0) AS due,
                SUM(CASE WHEN ${isIpd} THEN 1 ELSE 0 END) AS ipd_n
           ${rangeSql}`
      ).get(...args) as { n: number | null; revenue: number; due: number; ipd_n: number | null };
      let revenueP = toPaise(flat.revenue), dueP = toPaise(flat.due), n = flat.n ?? 0;
      if ((flat.ipd_n ?? 0) > 0) {
        const ipd = db.prepare(
          `SELECT b.total, b.amount_paid, b.advance_adjusted, b.finalized_at, b.admission_id, b.bill_type, ${ADV_SPARE_SQL} AS adv_spare
             ${rangeSql} AND ${isIpd}`
        ).all(...args) as any[];
        for (const r of ipd) { const pos = billPosition(r); revenueP += pos.totalP; dueP += pos.dueP; n++; }
      }
      return { count: n, revenue: fromPaise(revenueP), collected: fromPaise(revenueP - dueP) };
    };
    // Pharmacy sales are normally paid at the counter; one made on credit can still owe (all or part of it).
    const phar = db.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue,
              COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)), 0) as due
         FROM pharmacy_sales
        WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?`
    ).get(slack.lo, slack.hi, from, to) as { count: number; revenue: number; due: number };

    const mk = (key: string, label: string, a: { count: number; revenue: number; collected: number }) => ({
      key, label, count: a.count, revenue: Math.round(a.revenue),
      collected: Math.round(a.collected), outstanding: Math.round(a.revenue - a.collected),
    });
    // Every non-cancelled bill falls in exactly one of these, so the rows add up to the Accounts total:
    // in-patient / lab / radiology by bill type first; then a Services bill (bill_kind='misc'); then a consultation;
    // and whatever is left (Quick-Bill "custom" and hand-made pharmacy bills) is "Other".
    // A hand-typed pharmacy bill (Quick Bill → Pharmacy) never touched stock, cost or profit, so it has its own row and is
    // never mixed into Pharmacy (stock sales) or Other.
    const NOT_SPECIAL = "COALESCE(bill_type,'') NOT IN ('ipd','lab','radiology','pharmacy')";
    const modules = [
      mk('opd', 'OPD / Consultation', billAgg(`bill_type='opd_consult' AND COALESCE(bill_kind,'') <> 'misc'`)),
      mk('ipd', 'IPD (in-patient)', billAgg("bill_type='ipd'")),
      mk('lab', 'Laboratory', billAgg("bill_type='lab'")),
      mk('radiology', 'Radiology', billAgg("bill_type='radiology'")),
      // Pharmacy (from stock): sale value, less what a credit sale still owes.
      { key: 'pharmacy', label: 'Pharmacy', count: phar.count, revenue: Math.round(phar.revenue), collected: Math.round(phar.revenue - phar.due), outstanding: Math.round(phar.due) },
      mk('pharmacy_manual', 'Pharmacy — hand-typed bills', billAgg("bill_type='pharmacy'")),
      mk('misc', 'Procedures / Misc', billAgg(`bill_kind='misc' AND ${NOT_SPECIAL}`)),
      mk('other', 'Other / quick bills', billAgg(`${NOT_SPECIAL} AND COALESCE(bill_type,'') <> 'opd_consult' AND COALESCE(bill_kind,'') <> 'misc'`)),
    ].filter((m) => m.count > 0 || m.revenue > 0);

    const totals = modules.reduce((t, m) => ({
      revenue: t.revenue + m.revenue, collected: t.collected + m.collected,
      outstanding: t.outstanding + m.outstanding, count: t.count + m.count,
    }), { revenue: 0, collected: 0, outstanding: 0, count: 0 });
    return { ok: true, modules, totals };
  });

  // ===== Patient Origin (place stats) =====
  ipcMain.handle('origin:summary', (_e, filter: { from: string; to: string }) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.patient_id,
                p.place, p.district, p.state,
                a.appointment_date
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.appointment_date >= ? AND a.appointment_date <= ?
           AND a.status <> 'Cancelled'`
      )
      .all(filter.from, filter.to) as { patient_id: number; place: string | null; district: string | null; state: string | null; appointment_date: string }[];

    const norm = (s?: string | null) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const title = (s: string) => s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

    const byPlace = new Map<string, { display: string; visits: number; patients: Set<number> }>();
    const byDistrict = new Map<string, { display: string; visits: number; patients: Set<number> }>();
    const byState = new Map<string, { display: string; visits: number; patients: Set<number> }>();

    for (const r of rows) {
      const placeKey = norm(r.place) || '__unknown__';
      const districtKey = norm(r.district) || '__unknown__';
      const stateKey = norm(r.state) || '__unknown__';
      const placeDisp = r.place ? title(norm(r.place)) : 'Unknown';
      const districtDisp = r.district ? title(norm(r.district)) : 'Unknown';
      const stateDisp = r.state ? title(norm(r.state)) : 'Unknown';

      const p = byPlace.get(placeKey) || { display: placeDisp, visits: 0, patients: new Set<number>() };
      p.visits += 1; p.patients.add(r.patient_id); byPlace.set(placeKey, p);

      const d = byDistrict.get(districtKey) || { display: districtDisp, visits: 0, patients: new Set<number>() };
      d.visits += 1; d.patients.add(r.patient_id); byDistrict.set(districtKey, d);

      const s = byState.get(stateKey) || { display: stateDisp, visits: 0, patients: new Set<number>() };
      s.visits += 1; s.patients.add(r.patient_id); byState.set(stateKey, s);
    }

    const serialize = (m: Map<string, { display: string; visits: number; patients: Set<number> }>) =>
      [...m.values()]
        .map((v) => ({ name: v.display, visits: v.visits, patients: v.patients.size }))
        .sort((a, b) => b.visits - a.visits);

    return {
      totalVisits: rows.length,
      uniquePatients: new Set(rows.map((r) => r.patient_id)).size,
      missingPlace: rows.filter((r) => !r.place).length,
      byPlace: serialize(byPlace),
      byDistrict: serialize(byDistrict),
      byState: serialize(byState),
    };
  });

  // ===== Finance =====
  ipcMain.handle('finance:summary', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const today = todayISO();
    const row = (sql: string, params: any[] = []) => db.prepare(sql).get(...params) as any;
    const all = (sql: string, params: any[] = []) => db.prepare(sql).all(...params) as any[];
    // Bills and sales are indexed by their UTC timestamp. Each window query below first narrows to a UTC range that
    // surely contains the window (utcSlack), then applies the exact local-day test — otherwise every card scanned the
    // whole table. `lo`/`hi` only prune; they never decide which day a bill belongs to.
    const lo = (fromISO: string) => utcSlack(fromISO, fromISO).lo;
    const hi = (toISO: string) => utcSlack(toISO, toISO).hi;
    const monthStartOf = (iso: string) => iso.slice(0, 8) + '01';
    const prevMonthStart = addDaysISO(monthStartOf(today), -1).slice(0, 8) + '01';

    // --- Quick-period cards
    const yesterday = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime')=date(?, '-1 day')", [lo(addDaysISO(today, -1)), hi(today), today]);
    const todayTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime')=?", [lo(today), today]);
    const weekTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= date(?, '-6 days')", [lo(addDaysISO(today, -6)), today]);
    const prevWeek = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime') >= date(?, '-13 days') AND date(created_at, 'localtime') < date(?, '-6 days')", [lo(addDaysISO(today, -13)), hi(addDaysISO(today, -7)), today, today]);
    const monthTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', ?)", [lo(monthStartOf(today)), today]);
    const prevMonth = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND created_at < ? AND strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', date(?, 'start of month', '-1 day'))", [lo(prevMonthStart), hi(addDaysISO(monthStartOf(today), -1)), today]);
    const allTime = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled'");

    // Avg + largest in whole-time
    const avg = row("SELECT COALESCE(AVG(total),0) as avg, COALESCE(MAX(total),0) as max FROM bills WHERE COALESCE(status,'') <> 'cancelled'");

    // Custom range (default = last 30 days)
    const rangeFrom = filter.from || addDaysISO(today, -29);
    const rangeTo = filter.to || today;
    const rangeBills = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime') BETWEEN ? AND ?", [lo(rangeFrom), hi(rangeTo), rangeFrom, rangeTo]);
    const rangePharma = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM pharmacy_sales WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?", [lo(rangeFrom), hi(rangeTo), rangeFrom, rangeTo]);
    // Counter sales under a registered patient (they also show in that patient's Billing) vs walk-in / guest sales.
    // Both are in `rangePharma` already, so the split never adds anything — it only says whose they were.
    const pharmaWho = all(
      `SELECT CASE WHEN patient_id IS NULL THEN 'guest' ELSE 'patient' END as who, COALESCE(SUM(total),0) as t, COUNT(*) as c
         FROM pharmacy_sales WHERE created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY who`,
      [lo(rangeFrom), hi(rangeTo), rangeFrom, rangeTo]
    );
    const whoOf = (k: string) => { const r = pharmaWho.find((x) => x.who === k); return { total: r ? r.t : 0, count: r ? r.c : 0 }; };
    // Medicines sold on credit in the range: how much of the sales was left owing, and what is still owed on those sales.
    const pharmaCreditRow = row(
      `SELECT COUNT(*) as c, COALESCE(SUM(MAX(total - COALESCE(amount_paid, total), 0)), 0) as due
         FROM pharmacy_sales WHERE on_credit = 1 AND created_at >= ? AND created_at < ? AND COALESCE(payment_mode, '') <> 'IPD-bill'
          AND date(created_at, 'localtime') BETWEEN ? AND ?`,
      [lo(rangeFrom), hi(rangeTo), rangeFrom, rangeTo]);

    const byDay = all(
      `SELECT date(created_at, 'localtime') as day, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY date(created_at, 'localtime') ORDER BY day DESC`,
      [lo(rangeFrom), hi(rangeTo), rangeFrom, rangeTo]
    );
    const byWeek = all(
      `SELECT strftime('%Y-W%W', created_at, 'localtime') as week, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= date(?, '-56 days')
       GROUP BY week ORDER BY week DESC`,
      [lo(addDaysISO(today, -56)), today]
    );
    const byMonth = all(
      // Only the last 12 months are shown, so only they are read.
      `SELECT strftime('%Y-%m', created_at, 'localtime') as month, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? GROUP BY month ORDER BY month DESC LIMIT 12`,
      [lo(localISO(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)))]
    );
    const byMode = all(
      `SELECT payment_mode, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' GROUP BY payment_mode ORDER BY total DESC`
    );
    const byDoctor = all(
      `SELECT d.name as doctor, d.specialty, COALESCE(SUM(b.total),0) as total, COUNT(b.id) as count
       FROM bills b
       LEFT JOIN appointments a ON a.id=b.appointment_id
       LEFT JOIN doctors d ON d.id=a.doctor_id
       WHERE d.id IS NOT NULL AND COALESCE(b.status,'') <> 'cancelled'
       GROUP BY d.id ORDER BY total DESC`
    );
    // Money actually received today, by how it was paid — payments taken against bills, bills paid when raised, and
    // pharmacy counter sales. (This used to group today's BILLS by their payment mode, so an unpaid lab bill showed up
    // as a "Pending" collection and a payment taken today on an older bill was missing.)
    const todayByMode = collections(db, today, today).by_mode.map((m) => ({ payment_mode: m.payment_mode, total: m.total, count: m.count }));

    // Weekday pattern (0=Sun ... 6=Sat) — last 90 days
    const byWeekday = all(
      `SELECT strftime('%w', created_at, 'localtime') as wd, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= date(?, '-89 days')
       GROUP BY wd ORDER BY wd`,
      [lo(addDaysISO(today, -89)), today]
    );

    // Hour-of-day distribution — last 30 days
    const byHour = all(
      `SELECT strftime('%H', created_at, 'localtime') as hr, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= date(?, '-29 days')
       GROUP BY hr ORDER BY hr`,
      [lo(addDaysISO(today, -29)), today]
    );

    // Top patients by revenue — all-time
    const topPatients = all(
      `SELECT p.id, (p.first_name || ' ' || p.last_name) as name, p.uhid, p.place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE COALESCE(b.status,'') <> 'cancelled'
       GROUP BY p.id ORDER BY total DESC LIMIT 10`
    );

    // By Place/Origin — last 90 days
    const byPlace = all(
      `SELECT COALESCE(NULLIF(TRIM(p.place), ''), 'Unknown') as place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE COALESCE(b.status,'') <> 'cancelled' AND b.created_at >= ? AND date(b.created_at, 'localtime') >= date(?, '-89 days')
       GROUP BY LOWER(TRIM(COALESCE(p.place,''))) ORDER BY total DESC LIMIT 15`,
      [lo(addDaysISO(today, -89)), today]
    );

    // Pharmacy vs OPD comparison — last 30 days
    const opd30 = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND created_at >= ? AND date(created_at, 'localtime') >= date(?, '-29 days')", [lo(addDaysISO(today, -29)), today]);
    const pharma30 = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM pharmacy_sales WHERE created_at >= ? AND COALESCE(payment_mode, '') <> 'IPD-bill' AND date(created_at, 'localtime') >= date(?, '-29 days')", [lo(addDaysISO(today, -29)), today]);

    // Change against the period before it, as a fraction (0.12 = 12% up); null when there was nothing to compare with.
    const change = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
    return {
      today: { total: todayTotal.t, count: todayTotal.c, byMode: todayByMode, delta: change(todayTotal.t, yesterday.t) },
      yesterday: { total: yesterday.t, count: yesterday.c },
      week: { total: weekTotal.t, count: weekTotal.c, delta: change(weekTotal.t, prevWeek.t) },
      prevWeek: { total: prevWeek.t, count: prevWeek.c },
      month: { total: monthTotal.t, count: monthTotal.c, delta: change(monthTotal.t, prevMonth.t) },
      prevMonth: { total: prevMonth.t, count: prevMonth.c },
      allTime: { total: allTime.t, count: allTime.c, avg: avg.avg, max: avg.max },
      range: {
        from: rangeFrom, to: rangeTo,
        bills: { total: rangeBills.t, count: rangeBills.c },
        pharma: { total: rangePharma.t, count: rangePharma.c },
        pharmaSplit: { patient: whoOf('patient'), guest: whoOf('guest') },
        pharmaCredit: { count: pharmaCreditRow.c, still_owed: pharmaCreditRow.due },
      },
      compare30: {
        opd: { total: opd30.t, count: opd30.c },
        pharma: { total: pharma30.t, count: pharma30.c },
      },
      byDay, byWeek, byMonth, byMode, byDoctor, byWeekday, byHour, topPatients, byPlace,
    };
  });

  // ===== Stats =====
  ipcMain.handle('stats:today', () => {
    const db = getDb();
    const date = todayISO();
    const total = db.prepare('SELECT COUNT(*) as c FROM appointments WHERE appointment_date=?').get(date) as { c: number };
    const waiting = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Waiting'").get(date) as { c: number };
    const inprog = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='In Progress'").get(date) as { c: number };
    const done = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Done'").get(date) as { c: number };
    return { date, total: total.c, waiting: waiting.c, inprogress: inprog.c, done: done.c };
  });
}
