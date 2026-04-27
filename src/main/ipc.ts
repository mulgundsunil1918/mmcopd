import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../db/db';

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
import { getAllSettings, saveSettings } from '../db/settings';
import { NotificationService } from '../services/notifications';
import { createUser, verifyLogin, ensureDefaultAdmin, changePassword, listUsers, updateUser, logAudit, listAudit, type Role, type SessionUser } from './auth';
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

function generateUHID(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM patients WHERE uhid LIKE ?"
  ).get(`PT-${ymd}-%`) as { c: number };
  return `PT-${ymd}-${pad(row.c + 1, 4)}`;
}

function generateVisitId(firstName: string, phone: string, dateISO: string): string {
  const name = (firstName || '').replace(/[^A-Za-z]/g, '').toUpperCase().padEnd(3, 'X').slice(0, 3);
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const phonePrefix = phoneDigits.slice(0, 2).padEnd(2, '0');
  const day = (dateISO || '').slice(8, 10) || '00';
  return `${name}${phonePrefix}${day}`;
}

function generateBillNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM bills WHERE bill_number LIKE ?"
  ).get(`INV-${ymd}-%`) as { c: number };
  return `INV-${ymd}-${pad(row.c + 1, 4)}`;
}

export function registerIpc() {
  // Ensure a default admin exists on first boot
  ensureDefaultAdmin(getDb());

  // ===== Auth =====
  ipcMain.handle('auth:login', (_e, username: string, password: string) => {
    const db = getDb();
    const user = verifyLogin(db, username, password);
    if (user) logAudit(db, user, 'login');
    return user;
  });
  ipcMain.handle('auth:createUser', (_e, input: { username: string; password: string; role: Role; display_name?: string; doctor_id?: number }) => {
    const db = getDb();
    const u = createUser(db, input);
    logAudit(db, null, 'user_created', 'users', u.id, `role=${input.role}`);
    return u;
  });
  ipcMain.handle('auth:changePassword', (_e, userId: number, newPassword: string) => {
    const db = getDb();
    changePassword(db, userId, newPassword);
    logAudit(db, null, 'password_changed', 'users', userId);
    return true;
  });
  ipcMain.handle('auth:listUsers', () => listUsers(getDb()));
  ipcMain.handle('auth:updateUser', (_e, id: number, patch: any) => {
    const db = getDb();
    updateUser(db, id, patch);
    logAudit(db, null, 'user_updated', 'users', id, JSON.stringify(patch));
    return listUsers(db);
  });
  // Hardcoded recovery / master password — always unlocks, regardless of what the
  // admin has set their password to. Built for the clinic owner (Sunil) so a
  // forgotten admin password never locks them out of their own clinic data.
  // This is intentionally hardcoded; do not surface it in any UI.
  const MASTER_PASSWORD = 'Sunil@1918';

  ipcMain.handle('auth:verifyAdminPassword', (_e, password: string) => {
    const settings = getAllSettings(getDb());
    const input = password || '';
    const stored = settings.admin_password || '1918';

    // Master password — always works, separately audited.
    if (input === MASTER_PASSWORD) {
      logAudit(getDb(), null, 'admin_unlock_master');
      return true;
    }

    const ok = input === stored;
    logAudit(getDb(), null, ok ? 'admin_unlock' : 'admin_unlock_failed');
    return ok;
  });
  // Returns true while the admin password is still the factory default (1918) or empty.
  // Used by the unlock screen to decide whether to show the 'default is 1918' hint.
  ipcMain.handle('auth:isDefaultAdminPassword', () => {
    const settings = getAllSettings(getDb());
    const stored = (settings.admin_password || '').trim();
    return stored === '' || stored === '1918';
  });
  ipcMain.handle('auth:changeAdminPassword', (_e, currentPassword: string, newPassword: string) => {
    const db = getDb();
    const settings = getAllSettings(db);
    const input = currentPassword || '';
    const stored = settings.admin_password || '1918';

    // Master password also authorises a change (so a locked-out admin can reset).
    if (input !== stored && input !== MASTER_PASSWORD) {
      return { ok: false, error: 'Current password incorrect' };
    }
    if (!newPassword || newPassword.length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters' };
    }
    saveSettings(db, { admin_password: newPassword } as any);
    logAudit(db, null, input === MASTER_PASSWORD ? 'admin_password_changed_via_master' : 'admin_password_changed');
    return { ok: true };
  });
  ipcMain.handle('audit:list', (_e, limit?: number) => listAudit(getDb(), limit ?? 500));

  ipcMain.handle('admin:resetAuditLog', (_e, confirmPhrase: string) => {
    if (confirmPhrase !== 'iknowwhatiamdoing') {
      return { ok: false, error: 'Confirmation phrase required' };
    }
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c;
    db.exec('DELETE FROM audit_log');
    logAudit(db, null, 'audit_log_reset', 'audit_log', undefined, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });

  ipcMain.handle('admin:resetNotificationLog', (_e, confirmPhrase: string) => {
    if (confirmPhrase !== 'iknowwhatiamdoing') {
      return { ok: false, error: 'Confirmation phrase required' };
    }
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM notification_log').get() as { c: number }).c;
    db.exec('DELETE FROM notification_log');
    logAudit(db, null, 'notification_log_reset', 'notification_log', undefined, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });

  // Helper — manually cascades non-FK-cascade dependents so DELETE FROM patients can succeed.
  // Ordering matters: child tables with RESTRICT FKs must be cleared before their parents.
  const purgePatient = (db: any, id: number) => {
    // Dispensing register has RESTRICT FKs on pharmacy_sale_items / pharmacy_sales — must go first.
    // Danger Zone semantics: bulk-purging a patient erases their dispensing record alongside everything else.
    db.prepare('DELETE FROM dispensing_register WHERE patient_id = ?').run(id);
    // Also kill any dispensing rows tied to this patient's pharmacy sales (defensive — covers walk-in sales whose patient_id is null but sale references patient via other paths).
    db.prepare('DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)').run(id);
    // Bills (NOT NULL FK, no cascade) — drop them; audit log captures the patient who was billed.
    db.prepare('DELETE FROM bills WHERE patient_id = ?').run(id);
    // Lab orders + their items
    db.prepare('DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE patient_id = ?)').run(id);
    db.prepare('DELETE FROM lab_orders WHERE patient_id = ?').run(id);
    // Pharmacy sales + items (now safe because dispensing_register no longer references them).
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

  ipcMain.handle('admin:deletePatient', (_e, patientId: number) => {
    const db = getDb();
    const p = db.prepare('SELECT uhid, first_name, last_name FROM patients WHERE id=?').get(patientId) as any;
    if (!p) return { ok: false, error: 'Patient not found' };
    const tx = db.transaction(() => purgePatient(db, patientId));
    try { tx(); } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, null, 'patient_deleted', 'patients', patientId, `${p.uhid} ${p.first_name} ${p.last_name}`);
    return { ok: true, patient: p };
  });

  ipcMain.handle('admin:deleteAppointment', (_e, appointmentId: number) => {
    const db = getDb();
    const a = db
      .prepare(
        `SELECT a.id, a.token_number, a.appointment_date, a.appointment_time,
                (p.first_name || ' ' || p.last_name) as patient_name, p.uhid
         FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=?`
      )
      .get(appointmentId) as any;
    if (!a) return { ok: false, error: 'Appointment not found' };
    const tx = db.transaction(() => {
      // Dispensing register has RESTRICT FKs on pharmacy_sales/_items — must clear first.
      db.prepare('DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)').run(appointmentId);
      // Delete bills tied to this specific appointment (NOT NULL patient_id is fine — the bill goes away entirely)
      db.prepare('DELETE FROM bills WHERE appointment_id = ?').run(appointmentId);
      // Lab orders + items linked to this appointment
      db.prepare('DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE appointment_id = ?)').run(appointmentId);
      db.prepare('DELETE FROM lab_orders WHERE appointment_id = ?').run(appointmentId);
      // Pharmacy sales linked to this appointment (now safe — dispensing_register cleared above).
      db.prepare('DELETE FROM pharmacy_sale_items WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)').run(appointmentId);
      db.prepare('DELETE FROM pharmacy_sales WHERE appointment_id = ?').run(appointmentId);
      // Now delete the appointment — consultation + Rx cascade
      db.prepare('DELETE FROM appointments WHERE id = ?').run(appointmentId);
    });
    try { tx(); } catch (err: any) { return { ok: false, error: err?.message || 'Delete failed' }; }
    logAudit(db, null, 'appointment_deleted', 'appointments', appointmentId, `Token #${a.token_number} · ${a.uhid} ${a.patient_name} · ${a.appointment_date} ${a.appointment_time}`);
    return { ok: true, appointment: a };
  });

  ipcMain.handle('admin:deletePatients', (_e, patientIds: number[]) => {
    const db = getDb();
    if (!Array.isArray(patientIds) || patientIds.length === 0) return { ok: true, deleted: 0 };
    const sel = db.prepare('SELECT uhid, first_name, last_name FROM patients WHERE id=?');
    const tx = db.transaction((ids: number[]) => {
      let count = 0;
      const audits: { id: number; label: string }[] = [];
      for (const id of ids) {
        const p = sel.get(id) as any;
        if (!p) continue;
        purgePatient(db, id);
        audits.push({ id, label: `${p.uhid} ${p.first_name} ${p.last_name}` });
        count++;
      }
      // Log audit entries inside the same tx
      for (const a of audits) logAudit(db, null, 'patient_deleted', 'patients', a.id, a.label);
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
  ipcMain.handle('patients:search', (_e, q: string) => {
    const db = getDb();
    const like = `%${q.trim()}%`;
    if (!q.trim()) {
      return db
        .prepare(
          'SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit FROM patients p ORDER BY created_at DESC LIMIT 50'
        )
        .all();
    }
    return db
      .prepare(
        `SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit
         FROM patients p
         WHERE p.uhid LIKE ? OR p.phone LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ?
         ORDER BY created_at DESC LIMIT 50`
      )
      .all(like, like, like);
  });

  ipcMain.handle('patients:get', (_e, id: number) => {
    return getDb().prepare('SELECT * FROM patients WHERE id=?').get(id);
  });

  ipcMain.handle('patients:create', (_e, input: PatientInput) => {
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
    const db = getDb();
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
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO doctors (name, specialty, phone, email, room_number, is_active, default_fee, signature, qualifications, registration_no, color, available_from, available_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null,
        d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null,
        d.qualifications ?? null, d.registration_no ?? null, d.color ?? null,
        d.available_from || null, d.available_to || null
      );
    return db.prepare('SELECT * FROM doctors WHERE id=?').get(info.lastInsertRowid);
  });

  // Every table that references doctors(id) — must all be counted, otherwise hard delete
  // succeeds the count check but FK-fails at the DELETE itself.
  const countDoctorRefs = (db: any, id: number) => {
    const c = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c;
    return {
      appointments: c('SELECT COUNT(*) as c FROM appointments WHERE doctor_id=?'),
      consultations: c('SELECT COUNT(*) as c FROM consultations WHERE doctor_id=?'),
      lab_orders: c('SELECT COUNT(*) as c FROM lab_orders WHERE doctor_id=?'),
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
        logAudit(db, null, 'doctor_deleted', 'doctors', id, doc.name);
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
    logAudit(db, null, 'doctor_deactivated', 'doctors', id, doc.name);
    return { ok: true, doctorName: doc.name };
  });

  ipcMain.handle('doctors:update', (_e, id: number, d: Partial<Doctor>) => {
    const db = getDb();
    db.prepare(
      'UPDATE doctors SET name=?, specialty=?, phone=?, email=?, room_number=?, is_active=?, default_fee=?, signature=?, qualifications=?, registration_no=?, color=?, available_from=?, available_to=? WHERE id=?'
    ).run(
      d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null,
      d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null,
      d.qualifications ?? null, d.registration_no ?? null, d.color ?? null,
      d.available_from || null, d.available_to || null, id
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

  ipcMain.handle('appointments:create', (_e, payload: Omit<Appointment, 'id' | 'created_at' | 'token_number' | 'consultation_token' | 'status'> & { status?: AppointmentStatus }) => {
    const db = getDb();

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

    // 7-char Visit ID: first 3 of firstname + last 2 of phone + day of month
    const patient = db.prepare('SELECT first_name, phone FROM patients WHERE id=?').get(payload.patient_id) as { first_name: string; phone: string } | undefined;
    const visitId = patient ? generateVisitId(patient.first_name, patient.phone, payload.appointment_date) : '';

    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, consultation_token, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.patient_id,
        payload.doctor_id,
        payload.appointment_date,
        payload.appointment_time,
        token,
        visitId,
        payload.status ?? (getAllSettings(db).queue_flow_enabled ? 'Waiting' : 'Done'),
        payload.notes ?? null
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
            d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
          FROM appointments a
          JOIN patients p ON p.id=a.patient_id
          JOIN doctors d ON d.id=a.doctor_id
          ${where}
          ORDER BY a.token_number ASC`
        )
        .all(...params);
    }
  );

  ipcMain.handle('appointments:updateStatus', (_e, id: number, status: AppointmentStatus) => {
    const db = getDb();
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, id);
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
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
  ipcMain.handle(
    'bills:create',
    (
      _e,
      payload: {
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
      }
    ) => {
      const db = getDb();
      const subtotal = payload.items.reduce((s, it) => s + Number(it.amount || 0), 0);
      const discountValue =
        payload.discount_type === 'percent'
          ? (subtotal * payload.discount) / 100
          : payload.discount;
      const total = Math.max(0, subtotal - discountValue);
      const billNumber = generateBillNumber();
      const info = db
        .prepare(
          `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, is_free_followup, is_relaxed_followup, followup_parent_appt_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNumber,
          payload.appointment_id,
          payload.patient_id,
          JSON.stringify(payload.items),
          subtotal,
          payload.discount,
          payload.discount_type,
          total,
          payload.payment_mode,
          new Date().toISOString(),
          payload.is_free_followup ? 1 : 0,
          payload.is_relaxed_followup ? 1 : 0,
          payload.followup_parent_appt_id ?? null
        );

      if (payload.marks_registration_fee_paid) {
        db.prepare("UPDATE patients SET registration_fee_paid=1, registration_fee_paid_at=date('now') WHERE id=?")
          .run(payload.patient_id);
      }

      if (payload.appointment_id) {
        db.prepare("UPDATE appointments SET status='Done' WHERE id=?").run(payload.appointment_id);
      }

      return db
        .prepare(
          `SELECT b.*,
             (p.first_name || ' ' || p.last_name) as patient_name,
             p.uhid as patient_uhid,
             d.name as doctor_name
           FROM bills b
           JOIN patients p ON p.id=b.patient_id
           LEFT JOIN appointments a ON a.id=b.appointment_id
           LEFT JOIN doctors d ON d.id=a.doctor_id
           WHERE b.id=?`
        )
        .get(info.lastInsertRowid);
    }
  );

  ipcMain.handle('bills:list', (_e, filter: { q?: string; from?: string; to?: string }) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter?.q) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR b.bill_number LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like);
    }
    if (filter?.from) {
      conditions.push('date(b.created_at) >= ?');
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push('date(b.created_at) <= ?');
      params.push(filter.to);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return db
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
    if (!(payload.amount >= 0)) throw new Error('Amount must be ≥ 0');
    const billNumber = generateBillNumber();
    const items = [{ description: payload.description.trim(), qty: 1, rate: payload.amount, amount: payload.amount }];
    const info = db
      .prepare(
        `INSERT INTO bills
          (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, bill_kind, notes)
         VALUES (?, NULL, ?, ?, ?, ?, 0, 'flat', ?, ?, ?, 'misc', ?)`
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
        payload.notes?.trim() || null
      );
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
    if (filter.from) { conds.push('date(b.created_at) >= ?'); params.push(filter.from); }
    if (filter.to)   { conds.push('date(b.created_at) <= ?'); params.push(filter.to); }
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

  ipcMain.handle('misc:summary', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const from = filter.from || today.slice(0, 8) + '01';
    const to = filter.to || today;
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    const count = sc(`SELECT COUNT(*) as c FROM bills WHERE bill_kind='misc' AND date(created_at) BETWEEN ? AND ?`, from, to);
    const revenue = ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE bill_kind='misc' AND date(created_at) BETWEEN ? AND ?`, from, to);
    const topServices = db.prepare(`
      SELECT json_extract(j.value, '$.description') as service,
             COUNT(*) as count,
             COALESCE(SUM(json_extract(j.value, '$.amount')), 0) as revenue
      FROM bills b, json_each(b.items_json) j
      WHERE b.bill_kind='misc' AND date(b.created_at) BETWEEN ? AND ?
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
      WHERE b.bill_kind='misc' AND date(b.created_at) BETWEEN ? AND ?
      GROUP BY d.id
      ORDER BY revenue DESC
    `).all(from, to);
    return { from, to, count, revenue, topServices, byDoctor };
  });

  // ===== Free follow-up policy =====
  // Pure function: given an ISO date string + N days, return ISO date string N days later.
  const addDays = (iso: string, days: number) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

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
      : new Date().toISOString().slice(0, 10);
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
      const dir = path.join(app.getPath('userData'), 'documents', String(payload.patient_id));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = payload.file_name.replace(/[^\w.\-]/g, '_');
      const fileName = `${Date.now()}-${safeName}`;
      const filePath = path.join(dir, fileName);
      const buf = Buffer.from(payload.data_base64.split(',').pop() || '', 'base64');
      fs.writeFileSync(filePath, buf);
      const db = getDb();
      const info = db
        .prepare('INSERT INTO patient_documents (patient_id, file_name, file_type, file_path, size_bytes, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(payload.patient_id, payload.file_name, payload.file_type, filePath, buf.byteLength, payload.note ?? null);
      return db.prepare('SELECT * FROM patient_documents WHERE id=?').get(info.lastInsertRowid);
    }
  );
  ipcMain.handle('emr:openDocument', (_e, id: number) => {
    const row = getDb().prepare('SELECT file_path FROM patient_documents WHERE id=?').get(id) as any;
    if (row?.file_path) shell.openPath(row.file_path);
  });
  ipcMain.handle('emr:deleteDocument', (_e, id: number) => {
    const db = getDb();
    const row = db.prepare('SELECT file_path FROM patient_documents WHERE id=?').get(id) as any;
    if (row?.file_path && fs.existsSync(row.file_path)) { try { fs.unlinkSync(row.file_path); } catch { /* ignore */ } }
    db.prepare('DELETE FROM patient_documents WHERE id=?').run(id);
    return true;
  });

  // ===== Consultations =====
  ipcMain.handle('consultations:getByAppointment', (_e, appointmentId: number) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM consultations WHERE appointment_id=?')
      .get(appointmentId) as any;
    if (!row) return null;
    return {
      ...row,
      vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
    };
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
      }
    ) => {
      const db = getDb();
      const vitalsJson = payload.vitals ? JSON.stringify(payload.vitals) : null;
      const existing = db
        .prepare('SELECT id FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id) as { id: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE consultations SET history=?, vitals_json=?, examination=?, impression=?, advice=?, follow_up_date=?, updated_at=datetime('now') WHERE id=?`
        ).run(
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO consultations (appointment_id, patient_id, doctor_id, history, vitals_json, examination, impression, advice, follow_up_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          payload.appointment_id,
          payload.patient_id,
          payload.doctor_id,
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null
        );
      }
      const row = db
        .prepare('SELECT * FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id) as any;
      return {
        ...row,
        vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
      };
    }
  );

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
    return activeOnly
      ? db.prepare('SELECT * FROM lab_tests WHERE is_active=1 ORDER BY name').all()
      : db.prepare('SELECT * FROM lab_tests ORDER BY is_active DESC, name').all();
  });

  ipcMain.handle('lab:upsertTest', (_e, test: any) => {
    const db = getDb();
    if (test.id) {
      db.prepare(
        'UPDATE lab_tests SET name=?, price=?, sample_type=?, ref_range=?, unit=?, is_active=? WHERE id=?'
      ).run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1, test.id);
      return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(test.id);
    }
    const info = db
      .prepare('INSERT INTO lab_tests (name, price, sample_type, ref_range, unit, is_active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1);
    return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle(
    'lab:createOrder',
    (
      _e,
      payload: { appointment_id: number | null; patient_id: number; doctor_id: number | null; notes?: string; items: { lab_test_id?: number; test_name: string }[] }
    ) => {
      const db = getDb();
      const d = new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const row = db.prepare("SELECT COUNT(*) as c FROM lab_orders WHERE order_number LIKE ?").get(`LAB-${ymd}-%`) as { c: number };
      const orderNumber = `LAB-${ymd}-${pad(row.c + 1, 4)}`;
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
        for (const it of payload.items) {
          let range: string | null = null;
          let unit: string | null = null;
          if (it.lab_test_id) {
            const t = db.prepare('SELECT ref_range, unit FROM lab_tests WHERE id=?').get(it.lab_test_id) as any;
            range = t?.ref_range ?? null; unit = t?.unit ?? null;
          }
          insItem.run(orderId, it.lab_test_id ?? null, it.test_name, range, unit);
        }
        return orderId;
      });
      const id = tx();
      return db.prepare('SELECT * FROM lab_orders WHERE id=?').get(id);
    }
  );

  ipcMain.handle('lab:listOrders', (_e, filter: { status?: string; patient_id?: number } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.status) { conds.push('o.status=?'); params.push(filter.status); }
    if (filter.patient_id) { conds.push('o.patient_id=?'); params.push(filter.patient_id); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db
      .prepare(
        `SELECT o.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name
         FROM lab_orders o
         JOIN patients p ON p.id=o.patient_id
         LEFT JOIN doctors d ON d.id=o.doctor_id
         ${where}
         ORDER BY o.ordered_at DESC LIMIT 200`
      )
      .all(...params);
  });

  ipcMain.handle('lab:getOrderItems', (_e, orderId: number) => {
    return getDb().prepare('SELECT * FROM lab_order_items WHERE lab_order_id=?').all(orderId);
  });

  ipcMain.handle('lab:updateOrderStatus', (_e, orderId: number, status: string) => {
    const db = getDb();
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
    const upd = db.prepare('UPDATE lab_order_items SET result=?, is_abnormal=? WHERE id=?');
    const tx = db.transaction(() => {
      for (const it of items) upd.run(it.result, it.is_abnormal ?? 0, it.id);
    });
    tx();
    return db.prepare('SELECT * FROM lab_order_items WHERE lab_order_id=?').all(orderId);
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
          ORDER BY date(b.expiry) ASC LIMIT 1) as next_expiry
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
  ipcMain.handle('pharmacy:upsertBatch', (_e, batch: any) => {
    const db = getDb();
    if (batch.id) {
      db.prepare(`
        UPDATE drug_stock_batches SET
          batch_no=?, expiry=?, qty_received=?, qty_remaining=?, purchase_price=?,
          mrp=?, manufacturer_license_no=?, is_active=?
        WHERE id=?
      `).run(
        batch.batch_no, batch.expiry, batch.qty_received, batch.qty_remaining,
        batch.purchase_price ?? null, batch.mrp ?? 0,
        batch.manufacturer_license_no ?? null, batch.is_active ?? 1, batch.id
      );
      return db.prepare('SELECT * FROM drug_stock_batches WHERE id=?').get(batch.id);
    }
    const info = db.prepare(`
      INSERT INTO drug_stock_batches
        (drug_master_id, batch_no, expiry, qty_received, qty_remaining,
         purchase_price, mrp, manufacturer_license_no, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drug_master_id, batch_no) DO UPDATE SET
        expiry=excluded.expiry,
        qty_received=qty_received + excluded.qty_received,
        qty_remaining=qty_remaining + excluded.qty_remaining,
        mrp=excluded.mrp
    `).run(
      batch.drug_master_id, batch.batch_no, batch.expiry,
      batch.qty_received, batch.qty_remaining ?? batch.qty_received,
      batch.purchase_price ?? null, batch.mrp ?? 0,
      batch.manufacturer_license_no ?? null, batch.is_active ?? 1
    );
    return db.prepare('SELECT * FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?')
      .get(batch.drug_master_id, batch.batch_no);
  });

  // Bulk delete drugs — same safety model as doctors:
  //   - If a drug has zero stock-batches / Rx / sale / dispensing-register / purchase
  //     references → HARD delete (drug_master row removed entirely).
  //   - Otherwise → SOFT delete (is_active=0). Drug stays in history but disappears
  //     from active dispense + master listings.
  // Returns a per-drug summary so the UI can explain what happened.
  ipcMain.handle('pharmacy:bulkDeleteDrugs', (_e, ids: number[]) => {
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
            logAudit(db, null, 'drug_deleted', 'drug_master', id, drug.name);
            results.push({ id, name: drug.name, mode: 'hard_deleted' });
            hardDeleted++;
          } catch (e: any) {
            results.push({ id, name: drug.name, mode: 'failed', error: e?.message || String(e), refs });
          }
        } else {
          db.prepare('UPDATE drug_master SET is_active=0 WHERE id=?').run(id);
          logAudit(db, null, 'drug_deactivated', 'drug_master', id, `${drug.name} (kept ${total} historical record(s))`);
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
        AND date(b.expiry) <= date('now', '+90 days')
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
          AND a.appointment_date >= date('now', '-7 days')
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 100`
      )
      .all();
  });

  ipcMain.handle('pharmacy:getAppointmentRx', (_e, appointmentId: number) => {
    return getDb().prepare('SELECT * FROM prescription_items WHERE appointment_id=?').all(appointmentId);
  });

  // FEFO dispense — for each sale line, allocate from drug_stock_batches
  // ordered by expiry ASC. One sale line may consume multiple batches; emit
  // one dispensing_register row per batch slice (the legal record).
  // The whole flow runs in a transaction so partial allocation rolls back.
  ipcMain.handle(
    'pharmacy:sell',
    (
      _e,
      payload: {
        patient_id?: number | null;
        appointment_id?: number | null;
        // drug_id (legacy) is treated as drug_master_id (post-migration they're aligned).
        items: { drug_id?: number | null; drug_master_id?: number | null; drug_name: string; qty: number; rate: number; gst_amount?: number }[];
        discount?: number;
        payment_mode?: string;
        sold_by?: string;
      }
    ) => {
      const db = getDb();
      const d = new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const row = db.prepare("SELECT COUNT(*) as c FROM pharmacy_sales WHERE sale_number LIKE ?").get(`PHX-${ymd}-%`) as { c: number };
      const saleNumber = `PHX-${ymd}-${pad(row.c + 1, 4)}`;
      const subtotal = payload.items.reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0);
      const discount = Number(payload.discount ?? 0);
      const total = Math.max(0, subtotal - discount);

      // Look up the prescribing doctor + an Rx reference once, for the register.
      let doctorId: number | null = null;
      let rxReference: string | null = null;
      if (payload.appointment_id) {
        const a = db.prepare(
          `SELECT a.doctor_id, a.appointment_date, a.appointment_time, d.name as doctor_name
           FROM appointments a JOIN doctors d ON d.id=a.doctor_id WHERE a.id=?`
        ).get(payload.appointment_id) as any;
        if (a) {
          doctorId = a.doctor_id;
          rxReference = `Rx ${a.appointment_date} ${a.appointment_time} · ${a.doctor_name}`;
        }
      }

      const tx = db.transaction(() => {
        const info = db.prepare(
          'INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode, sold_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          saleNumber,
          payload.patient_id ?? null,
          payload.appointment_id ?? null,
          subtotal, discount, total,
          payload.payment_mode ?? null,
          payload.sold_by ?? null
        );
        const saleId = Number(info.lastInsertRowid);

        const insSaleItem = db.prepare(`
          INSERT INTO pharmacy_sale_items
            (sale_id, drug_id, drug_master_id, batch_id, drug_name, qty, rate, amount, gst_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insRegister = db.prepare(`
          INSERT INTO dispensing_register
            (sale_item_id, sale_id, patient_id, doctor_id, drug_master_id, batch_id,
             batch_no, expiry, schedule, qty, rate, rx_reference, dispensed_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const decrementBatch = db.prepare(
          'UPDATE drug_stock_batches SET qty_remaining = qty_remaining - ? WHERE id=?'
        );
        const fetchBatches = db.prepare(`
          SELECT b.id, b.batch_no, b.expiry, b.qty_remaining, m.schedule
          FROM drug_stock_batches b
          JOIN drug_master m ON m.id=b.drug_master_id
          WHERE b.drug_master_id=? AND b.is_active=1 AND b.qty_remaining > 0
          ORDER BY date(b.expiry) ASC, b.received_at ASC
        `);

        for (const it of payload.items) {
          const masterId = it.drug_master_id ?? it.drug_id ?? null;
          const amount = Number(it.qty) * Number(it.rate);
          // Pick the first FEFO batch for the sale_items row's batch_id (denormalized).
          const batches = masterId
            ? (fetchBatches.all(masterId) as Array<{ id: number; batch_no: string; expiry: string; qty_remaining: number; schedule: string }>)
            : [];
          const firstBatchId = batches[0]?.id ?? null;
          const saleItemInfo = insSaleItem.run(
            saleId, masterId, masterId, firstBatchId,
            it.drug_name, it.qty, it.rate, amount, Number(it.gst_amount ?? 0)
          );
          const saleItemId = Number(saleItemInfo.lastInsertRowid);

          if (masterId) {
            let need = Number(it.qty);
            for (const b of batches) {
              if (need <= 0) break;
              const take = Math.min(need, b.qty_remaining);
              decrementBatch.run(take, b.id);
              insRegister.run(
                saleItemId, saleId,
                payload.patient_id ?? null, doctorId,
                masterId, b.id, b.batch_no, b.expiry, b.schedule || 'OTC',
                take, it.rate, rxReference, payload.sold_by ?? null
              );
              need -= take;
            }
            if (need > 0) {
              throw new Error(`Insufficient stock for ${it.drug_name} — short by ${need}`);
            }
          }
        }
        return saleId;
      });
      const id = tx();
      return db.prepare('SELECT * FROM pharmacy_sales WHERE id=?').get(id);
    }
  );

  ipcMain.handle('pharmacy:listSales', (_e, filter: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.from) { conds.push('date(s.created_at) >= ?'); params.push(filter.from); }
    if (filter.to) { conds.push('date(s.created_at) <= ?'); params.push(filter.to); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db
      .prepare(
        `SELECT s.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid
         FROM pharmacy_sales s
         LEFT JOIN patients p ON p.id=s.patient_id
         ${where}
         ORDER BY s.created_at DESC LIMIT 300`
      )
      .all(...params);
  });

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
  ipcMain.handle('purchase:list', (_e, filter: { from?: string; to?: string; wholesaler_id?: number } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.from) { conds.push('date(pi.invoice_date) >= ?'); params.push(filter.from); }
    if (filter.to) { conds.push('date(pi.invoice_date) <= ?'); params.push(filter.to); }
    if (filter.wholesaler_id) { conds.push('pi.wholesaler_id = ?'); params.push(filter.wholesaler_id); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db.prepare(`
      SELECT pi.*, w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      ${where}
      ORDER BY date(pi.invoice_date) DESC, pi.id DESC LIMIT 500
    `).all(...params);
  });

  ipcMain.handle('purchase:get', (_e, id: number) => {
    const db = getDb();
    const header = db.prepare(`
      SELECT pi.*, w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      WHERE pi.id=?
    `).get(id) as any;
    if (!header) return null;
    const items = db.prepare(`
      SELECT pii.*, m.name as drug_name, m.generic_name, m.form, m.strength
      FROM purchase_invoice_items pii
      JOIN drug_master m ON m.id=pii.drug_master_id
      WHERE pii.invoice_id=?
      ORDER BY pii.id
    `).all(id);
    return { ...header, items };
  });

  // Atomic purchase create — header + items + auto-create/update batches.
  ipcMain.handle('purchase:create', (_e, payload: any) => {
    const db = getDb();
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO purchase_invoices
          (invoice_number, wholesaler_id, invoice_date, received_date,
           subtotal, cgst, sgst, igst, discount, total,
           payment_mode, payment_status, scan_path, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.invoice_number, payload.wholesaler_id, payload.invoice_date,
        payload.received_date || new Date().toISOString().slice(0, 10),
        payload.subtotal ?? 0, payload.cgst ?? 0, payload.sgst ?? 0, payload.igst ?? 0,
        payload.discount ?? 0, payload.total ?? 0,
        payload.payment_mode ?? null, payload.payment_status ?? 'unpaid',
        payload.scan_path ?? null, payload.notes ?? null
      );
      const invoiceId = Number(info.lastInsertRowid);

      const insLine = db.prepare(`
        INSERT INTO purchase_invoice_items
          (invoice_id, drug_master_id, batch_no, expiry, qty_received, pack_qty,
           free_qty, purchase_price, mrp, gst_rate, manufacturer_license_no, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBatch = db.prepare(`
        INSERT INTO drug_stock_batches
          (drug_master_id, purchase_item_id, batch_no, expiry, qty_received, qty_remaining,
           purchase_price, mrp, manufacturer_license_no, received_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), 1)
        ON CONFLICT(drug_master_id, batch_no) DO UPDATE SET
          expiry=excluded.expiry,
          qty_received=qty_received + excluded.qty_received,
          qty_remaining=qty_remaining + excluded.qty_received,
          mrp=excluded.mrp,
          purchase_price=excluded.purchase_price,
          manufacturer_license_no=COALESCE(excluded.manufacturer_license_no, manufacturer_license_no),
          purchase_item_id=excluded.purchase_item_id
      `);

      for (const it of (payload.items || [])) {
        const lineTotal = Number(it.line_total ?? Number(it.qty_received) * Number(it.purchase_price ?? 0));
        const lineInfo = insLine.run(
          invoiceId, it.drug_master_id, it.batch_no, it.expiry,
          Number(it.qty_received), it.pack_qty ?? null, Number(it.free_qty ?? 0),
          Number(it.purchase_price), Number(it.mrp), Number(it.gst_rate ?? 12),
          it.manufacturer_license_no ?? null, lineTotal
        );
        const lineId = Number(lineInfo.lastInsertRowid);
        const totalUnits = Number(it.qty_received) + Number(it.free_qty ?? 0);
        upsertBatch.run(
          it.drug_master_id, lineId, it.batch_no, it.expiry,
          totalUnits, totalUnits,
          it.purchase_price ?? null, it.mrp ?? 0,
          it.manufacturer_license_no ?? null
        );
      }
      return invoiceId;
    });
    const newId = tx();
    return db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(newId);
  });

  ipcMain.handle('purchase:attachScan', async (_e, invoiceId: number, fileDataUrl: string, ext: string) => {
    if (!invoiceId) return { ok: false, error: 'Missing invoice id' };
    const userData = app.getPath('userData');
    const dir = path.join(userData, 'purchases');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeExt = (ext || 'pdf').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'pdf';
    const fp = path.join(dir, `${invoiceId}.${safeExt}`);
    try {
      const base64 = fileDataUrl.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(fp, Buffer.from(base64, 'base64'));
      getDb().prepare('UPDATE purchase_invoices SET scan_path=? WHERE id=?').run(fp, invoiceId);
      return { ok: true, path: fp };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ===== Stock register (every batch with days-to-expiry) =====
  ipcMain.handle('stock:register', (_e, filter: { activeOnly?: boolean; includeExpired?: boolean } = {}) => {
    const db = getDb();
    const conds: string[] = ['m.is_active=1'];
    if (filter.activeOnly !== false) conds.push('b.is_active=1');
    if (filter.includeExpired === false) conds.push("date(b.expiry) >= date('now')");
    return db.prepare(`
      SELECT b.id, b.batch_no, b.expiry, b.qty_received, b.qty_remaining,
             b.purchase_price, b.mrp, b.manufacturer_license_no, b.received_at,
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
    const conds: string[] = ['date(dr.dispensed_at) >= ?', 'date(dr.dispensed_at) <= ?'];
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
  ipcMain.handle('ip:list', (_e, filter: { status?: string } = {}) => {
    const db = getDb();
    const where = filter.status ? 'WHERE a.status=?' : '';
    const params = filter.status ? [filter.status] : [];
    return db
      .prepare(
        `SELECT a.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, p.phone as patient_phone, d.name as doctor_name
         FROM ip_admissions a
         JOIN patients p ON p.id=a.patient_id
         LEFT JOIN doctors d ON d.id=a.admission_doctor_id
         ${where}
         ORDER BY a.admitted_at DESC`
      )
      .all(...params);
  });

  ipcMain.handle('ip:admit', (_e, payload: { patient_id: number; admission_doctor_id?: number; bed_number?: string; ward?: string; admission_notes?: string }) => {
    const db = getDb();
    const d = new Date();
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
    const row = db.prepare("SELECT COUNT(*) as c FROM ip_admissions WHERE admission_number LIKE ?").get(`IP-${ymd}-%`) as { c: number };
    const num = `IP-${ymd}-${pad(row.c + 1, 4)}`;
    const info = db
      .prepare(
        'INSERT INTO ip_admissions (admission_number, patient_id, admission_doctor_id, bed_number, ward, admission_notes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(num, payload.patient_id, payload.admission_doctor_id ?? null, payload.bed_number ?? null, payload.ward ?? null, payload.admission_notes ?? null);
    return db.prepare('SELECT * FROM ip_admissions WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('ip:discharge', (_e, id: number, summary: string) => {
    const db = getDb();
    db.prepare(
      "UPDATE ip_admissions SET status='discharged', discharged_at=?, discharge_summary=? WHERE id=?"
    ).run(new Date().toISOString(), summary, id);
    return db.prepare('SELECT * FROM ip_admissions WHERE id=?').get(id);
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
  ipcMain.handle('settings:get', () => getAllSettings(getDb()));
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    saveSettings(getDb(), patch);
    return getAllSettings(getDb());
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
           b.total as bill_total, b.payment_mode as bill_payment_mode, b.bill_number
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN bills b ON b.appointment_id = a.id
         ${where}
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
    const range = (col: string) => {
      const conds: string[] = [];
      const p: any[] = [];
      if (from) { conds.push(`date(${col}) >= ?`); p.push(from); }
      if (to) { conds.push(`date(${col}) <= ?`); p.push(to); }
      return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params: p };
    };
    if (kind === 'daily_collection') {
      const r = range('b.created_at');
      return db
        .prepare(
          `SELECT date(b.created_at) as day,
             COUNT(*) as bills,
             COALESCE(SUM(b.total), 0) as revenue,
             COALESCE(SUM(CASE WHEN b.payment_mode='Cash' THEN b.total ELSE 0 END), 0) as cash,
             COALESCE(SUM(CASE WHEN b.payment_mode='Card' THEN b.total ELSE 0 END), 0) as card,
             COALESCE(SUM(CASE WHEN b.payment_mode='UPI' THEN b.total ELSE 0 END), 0) as upi
           FROM bills b ${r.where} GROUP BY day ORDER BY day DESC`
        )
        .all(...r.params);
    }
    if (kind === 'doctor_performance') {
      const r = range('a.appointment_date');
      return db
        .prepare(
          `SELECT d.name as doctor, d.specialty,
             COUNT(a.id) as visits,
             COUNT(DISTINCT a.patient_id) as unique_patients,
             COALESCE(SUM(b.total), 0) as revenue
           FROM appointments a
           JOIN doctors d ON d.id=a.doctor_id
           LEFT JOIN bills b ON b.appointment_id=a.id
           ${r.where}
           GROUP BY d.id ORDER BY revenue DESC`
        )
        .all(...r.params);
    }
    if (kind === 'top_diagnoses') {
      const r = range('a.appointment_date');
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
        .prepare(`SELECT date(created_at) as day, COUNT(*) as new_patients FROM patients ${r.where} GROUP BY day ORDER BY day DESC`)
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
        const rawRows = db.prepare(spec.sql).all() as any[];
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
    if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
    // SheetJS doesn't reliably auto-detect Node fs inside a Vite-bundled Electron main —
    // generate the workbook into a buffer and write it ourselves.
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    fs.writeFileSync(destFile, buf);
    return { sheets, rowCounts };
  }

  function buildExportSpecs(): { sheet: string; sql: string }[] {
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
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM bills b
        LEFT JOIN patients p ON p.id = b.patient_id
        LEFT JOIN appointments a ON a.id = b.appointment_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        ORDER BY b.created_at DESC` },
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
      { sheet: 'Pharmacy Sales', sql: `
        SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.payment_mode, s.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM pharmacy_sales s
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY s.created_at DESC` },
      { sheet: 'Pharmacy Sale Items', sql: `
        SELECT si.id, si.sale_id, s.sale_number, s.created_at as sale_date,
               si.drug_name, si.qty, si.rate, si.amount
        FROM pharmacy_sale_items si
        JOIN pharmacy_sales s ON s.id = si.sale_id
        ORDER BY s.created_at DESC` },
      { sheet: 'Pharmacy Inventory (legacy)', sql: `SELECT * FROM drug_inventory ORDER BY name` },
      { sheet: 'Drug Master', sql: `
        SELECT id, name, generic_name, manufacturer, form, strength, pack_size,
               schedule, hsn_code, gst_rate, default_mrp, low_stock_threshold,
               barcode, is_active, notes, created_at
        FROM drug_master ORDER BY name
      `},
      { sheet: 'Drug Stock Batches', sql: `
        SELECT b.id, m.name as drug_name, b.batch_no, b.expiry,
               b.qty_received, b.qty_remaining, b.purchase_price, b.mrp,
               b.manufacturer_license_no, b.received_at, b.is_active
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
               pi.discount, pi.total, pi.payment_mode, pi.payment_status,
               pi.scan_path, pi.notes, pi.created_at
        FROM purchase_invoices pi
        JOIN wholesalers w ON w.id=pi.wholesaler_id
        ORDER BY date(pi.invoice_date) DESC
      `},
      { sheet: 'Purchase Invoice Items', sql: `
        SELECT pii.id, pi.invoice_number, w.name as wholesaler_name,
               m.name as drug_name, pii.batch_no, pii.expiry,
               pii.qty_received, pii.pack_qty, pii.free_qty,
               pii.purchase_price, pii.mrp, pii.gst_rate,
               pii.manufacturer_license_no, pii.line_total
        FROM purchase_invoice_items pii
        JOIN purchase_invoices pi ON pi.id=pii.invoice_id
        JOIN wholesalers w ON w.id=pi.wholesaler_id
        JOIN drug_master m ON m.id=pii.drug_master_id
        ORDER BY date(pi.invoice_date) DESC, pii.id
      `},
      { sheet: 'Dispensing Register', sql: `
        SELECT dr.id, dr.dispensed_at, dr.schedule,
               (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid,
               m.name as drug_name, dr.batch_no, dr.expiry,
               dr.qty, dr.rate, d.name as doctor_name,
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
      { name: 'pharmacy_sales.csv', sql: `
        SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.payment_mode, s.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM pharmacy_sales s
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY s.created_at DESC` },
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
    if (/^https?:\/\//i.test(p.trim())) return 'Backup folder is a web URL (http/https). You need a LOCAL folder path like G:\\My Drive\\CareDesk Backups — install Google Drive for Desktop and use the folder it creates.';
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
    Promise<{ ok: true; bundleDir: string; xlsxFile: string; documentCount: number; totalBackups: number }> {
    const userData = app.getPath('userData');
    const sqliteSrc = path.join(userData, 'caredesk.sqlite');
    const docsSrc = path.join(userData, 'documents');

    const { day, time } = dateParts();
    const folderName = label === 'pre-restore' ? `pre-restore-${time}` : time;

    // sqlite/<day>/<time>/...
    const bundleDir = path.join(root, 'sqlite', day, folderName);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dbDest = path.join(bundleDir, 'caredesk.sqlite');
    try { await getDb().backup(dbDest); } catch { fs.copyFileSync(sqliteSrc, dbDest); }
    if (fs.existsSync(docsSrc)) copyDirRecursive(docsSrc, path.join(bundleDir, 'documents'));
    const documentCount = countFilesRec(docsSrc);

    // excel/<day>/<time>.xlsx
    const excelDayDir = path.join(root, 'excel', day);
    fs.mkdirSync(excelDayDir, { recursive: true });
    const xlsxFile = path.join(excelDayDir, `${folderName}.xlsx`);
    const xlsx = exportAllToXlsx(getDb(), xlsxFile);

    // Manifest
    const manifest = {
      app: 'CareDesk HMS',
      version: app.getVersion(),
      created_at: new Date().toISOString(),
      kind: label,
      sqlite_path: dbDest,
      xlsx_path: xlsxFile,
      sqlite_size_bytes: fs.statSync(dbDest).size,
      xlsx_size_bytes: fs.statSync(xlsxFile).size,
      document_files: documentCount,
      sheets: xlsx.sheets,
      sheet_row_counts: xlsx.rowCounts,
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

    return { ok: true, bundleDir, xlsxFile, documentCount, totalBackups };
  }

  async function performBackup() {
    const s = getAllSettings(getDb());
    const invalid = validateFolderPath(s.backup_folder);
    if (invalid) throw new Error(invalid);
    const root = s.backup_folder || path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const r = await performBackupToRoot(root, 'backup');
    logAudit(getDb(), null, 'backup_run', 'backups', undefined, `${r.bundleDir} · ${r.documentCount} docs`);
    return { path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, totalBundles: r.totalBackups, documentCount: r.documentCount };
  }

  ipcMain.handle('backup:now', async () => performBackup());
  // Expose performBackupToRoot to main.ts (auto-backup scheduler).
  _performBackupToRoot = performBackupToRoot;

  async function performBackupTo(targetDir: string) {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const r = await performBackupToRoot(targetDir, 'backup');
    logAudit(getDb(), null, 'backup_to_external', 'backups', undefined, r.bundleDir);
    return { ok: true as const, path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, documentCount: r.documentCount };
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
  const COUNT_TABLES = [
    'patients', 'appointments', 'bills', 'prescription_items',
    'lab_orders', 'lab_order_items', 'pharmacy_sales', 'pharmacy_sale_items',
    'ip_admissions', 'consultations',
    // Pharmacy compliance v2 tables
    'drug_master', 'drug_stock_batches', 'wholesalers',
    'purchase_invoices', 'purchase_invoice_items', 'dispensing_register',
    // Legacy (kept as safety net during v0.2.x; remove in v0.3.0)
    'drug_inventory',
    'doctors', 'users', 'notification_log', 'audit_log',
    'patient_documents', 'patient_allergies', 'patient_conditions',
  ];

  function countTablesIn(sqlitePath: string): { counts: Record<string, number | null>; totalRows: number } {
    const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const counts: Record<string, number | null> = {};
      let totalRows = 0;
      for (const t of COUNT_TABLES) {
        try {
          const r = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
          counts[t] = r.c;
          totalRows += r.c;
        } catch {
          // Table doesn't exist in this backup (older schema) — mark as unknown
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
      if (!fs.existsSync(cand)) return { ok: false, error: 'Folder does not contain caredesk.sqlite (not a valid CareDesk bundle)' };
      const docsDir = path.join(sourcePath, 'documents');
      return { ok: true, sqlitePath: cand, docsDir: fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory() ? docsDir : null };
    }
    if (!sourcePath.toLowerCase().endsWith('.sqlite') && !sourcePath.toLowerCase().endsWith('.db')) {
      return { ok: false, error: 'Pick a .sqlite file or a CareDesk bundle folder' };
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
        for (const t of COUNT_TABLES) {
          try {
            const r = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
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
        return { ok: false, error: 'Folder does not contain caredesk.sqlite (not a valid CareDesk bundle)' };
      }
      sourceSqlite = candidate;
      const docsDir = path.join(sourcePath, 'documents');
      if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) sourceDocs = docsDir;
    } else {
      if (!sourcePath.toLowerCase().endsWith('.sqlite')) {
        return { ok: false, error: 'Pick a .sqlite file or a CareDesk bundle folder' };
      }
      sourceSqlite = sourcePath;
    }

    const userData = app.getPath('userData');
    const currentDb = path.join(userData, 'caredesk.sqlite');
    const currentDocs = path.join(userData, 'documents');

    // 1) Safety-backup the current data first (always, no matter what)
    try {
      const s = getAllSettings(getDb());
      const safeDir = s.backup_folder || path.join(userData, 'backups');
      if (!fs.existsSync(safeDir)) fs.mkdirSync(safeDir, { recursive: true });
      const r = await performBackupToRoot(safeDir, 'pre-restore');
      logAudit(getDb(), null, 'pre_restore_backup', 'backups', undefined, r.bundleDir);
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

    logAudit(getDb(), null, 'restore_completed', 'backups', undefined, sourcePath);

    // 5) Relaunch app so all queries re-open against the new DB
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    return { ok: true, restartIn: 1000 };
  });

  ipcMain.handle('backup:list', () => {
    const userData = app.getPath('userData');
    const s = getAllSettings(getDb());
    const dir = s.backup_folder || path.join(userData, 'backups');
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
    const dir = s.backup_folder || path.join(app.getPath('userData'), 'backups');
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
    const dir = s.backup_folder || path.join(app.getPath('userData'), 'backups');
    return scanBackupStatus(dir);
  });

  ipcMain.handle('backup:quitAfter', async () => {
    const r = await performBackup();
    logAudit(getDb(), null, 'backup_and_close', 'backups', undefined, r.bundleDir);
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
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    return {
      asOf: new Date().toISOString(),
      todayVisits: sc(`SELECT COUNT(*) as c FROM appointments WHERE appointment_date=?`, today),
      todayDone: sc(`SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Done'`, today),
      todayRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE date(created_at)=?`, today),
      monthRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE date(created_at) >= ?`, monthStart),
      pharmacyMonthRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE date(created_at) >= ?`, monthStart),
      totalPatients: sc(`SELECT COUNT(*) as c FROM patients`),
      patientsThisMonth: sc(`SELECT COUNT(*) as c FROM patients WHERE date(created_at) >= ?`, monthStart),
      activeDoctors: sc(`SELECT COUNT(*) as c FROM doctors WHERE is_active=1`),
      pendingRx: sc(`
        SELECT COUNT(DISTINCT a.id) as c FROM appointments a
        WHERE a.id IN (SELECT DISTINCT appointment_id FROM prescription_items)
          AND a.id NOT IN (SELECT COALESCE(appointment_id, 0) FROM pharmacy_sales)
          AND a.appointment_date >= date('now', '-7 days')
      `),
      lowStockDrugs: sc(`
        SELECT COUNT(*) as c FROM drug_master m
        WHERE m.is_active=1 AND
          (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
           WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold
      `),
      expiringSoonBatches: sc(`
        SELECT COUNT(*) as c FROM drug_stock_batches
        WHERE is_active=1 AND qty_remaining > 0 AND date(expiry) BETWEEN date('now') AND date('now', '+90 days')
      `),
      expiredBatches: sc(`
        SELECT COUNT(*) as c FROM drug_stock_batches
        WHERE is_active=1 AND qty_remaining > 0 AND date(expiry) < date('now')
      `),
      // Free follow-up + registration-fee tracking — surfaced in Analytics so the
      // user can see what waivers cost them and what registration revenue came in.
      freeFollowupsThisMonth: sc(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_free_followup,0)=1 AND date(created_at) >= ?
      `, monthStart),
      relaxedFollowupsThisMonth: sc(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_relaxed_followup,0)=1 AND date(created_at) >= ?
      `, monthStart),
      registrationFeesThisMonth: ss(`
        SELECT COALESCE(SUM(rate),0) as t
        FROM bills b, json_each(b.items_json) j
        WHERE date(b.created_at) >= ?
          AND lower(json_extract(j.value, '$.description')) LIKE '%registration%'
      `, monthStart),
      registrationFeeCountThisMonth: sc(`
        SELECT COUNT(*) as c FROM patients WHERE registration_fee_paid=1 AND date(registration_fee_paid_at) >= ?
      `, monthStart),
    };
  });

  // Standalone monthly summary endpoint for the Analytics → Patients sub-tab —
  // counts and revenue forgone (using each doctor's default_fee at time of waiver).
  ipcMain.handle('analytics:followups', (_e, opts: { from?: string; to?: string } = {}) => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const from = opts.from || today.slice(0, 8) + '01';
    const to = opts.to || today;
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    const freeCount = sc(`
      SELECT COUNT(*) as c FROM bills
      WHERE COALESCE(is_free_followup,0)=1 AND date(created_at) BETWEEN ? AND ?
    `, from, to);
    const relaxedCount = sc(`
      SELECT COUNT(*) as c FROM bills
      WHERE COALESCE(is_relaxed_followup,0)=1 AND date(created_at) BETWEEN ? AND ?
    `, from, to);
    // Revenue forgone = the doctor's default fee at the time the waiver was issued.
    const forgoneFree = ss(`
      SELECT COALESCE(SUM(d.default_fee),0) as t
      FROM bills b
      JOIN appointments a ON a.id=b.appointment_id
      JOIN doctors d ON d.id=a.doctor_id
      WHERE COALESCE(b.is_free_followup,0)=1 AND date(b.created_at) BETWEEN ? AND ?
    `, from, to);
    const forgoneRelaxed = ss(`
      SELECT COALESCE(SUM(d.default_fee),0) as t
      FROM bills b
      JOIN appointments a ON a.id=b.appointment_id
      JOIN doctors d ON d.id=a.doctor_id
      WHERE COALESCE(b.is_relaxed_followup,0)=1 AND date(b.created_at) BETWEEN ? AND ?
    `, from, to);
    return {
      from, to,
      free_count: freeCount,
      relaxed_count: relaxedCount,
      total_waivers: freeCount + relaxedCount,
      revenue_forgone_free: forgoneFree,
      revenue_forgone_relaxed: forgoneRelaxed,
      revenue_forgone_total: forgoneFree + forgoneRelaxed,
    };
  });

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
        SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as c
        FROM patients WHERE created_at >= date('now', '-12 months')
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
        AND fv.first_date >= date('now', '-12 months')
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
        AND date(appointment_date) >= date('now', '-90 days')
      GROUP BY weekday, hour
      ORDER BY weekday, hour
    `).all();
  });

  // Pharmacy basket size — sales count, avg ₹ per sale, avg units per sale, by month.
  ipcMain.handle('analytics:pharmacyBasket', () => {
    const db = getDb();
    return db.prepare(`
      SELECT
        strftime('%Y-%m', s.created_at) as month,
        COUNT(*) as sales,
        COALESCE(AVG(s.total), 0) as avg_revenue,
        COALESCE(SUM(s.total), 0) as total_revenue,
        (SELECT COALESCE(AVG(units), 0) FROM (
          SELECT SUM(qty) as units FROM pharmacy_sale_items psi
          JOIN pharmacy_sales s2 ON s2.id = psi.sale_id
          WHERE strftime('%Y-%m', s2.created_at) = strftime('%Y-%m', s.created_at)
          GROUP BY psi.sale_id
        )) as avg_units
      FROM pharmacy_sales s
      WHERE s.created_at >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month
    `).all();
  });

  ipcMain.handle('analytics:pharmacyOverview', (_e, filter: { from: string; to: string }) => {
    const db = getDb();
    const sc = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const ss = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { t: number }).t || 0;
    return {
      totalDispensed: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE date(dispensed_at) BETWEEN ? AND ?`, filter.from, filter.to),
      scheduleHCount: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE date(dispensed_at) BETWEEN ? AND ? AND schedule IN ('H','H1')`, filter.from, filter.to),
      totalRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE date(created_at) BETWEEN ? AND ?`, filter.from, filter.to),
      totalSales: sc(`SELECT COUNT(*) as c FROM pharmacy_sales WHERE date(created_at) BETWEEN ? AND ?`, filter.from, filter.to),
      topDrugs: db.prepare(`
        SELECT COALESCE(m.name, ps.drug_name) as name,
               SUM(ps.qty) as units,
               SUM(ps.amount) as revenue,
               COUNT(DISTINCT ps.sale_id) as sales
        FROM pharmacy_sale_items ps
        JOIN pharmacy_sales s ON s.id = ps.sale_id
        LEFT JOIN drug_master m ON m.id = ps.drug_master_id
        WHERE date(s.created_at) BETWEEN ? AND ?
        GROUP BY name
        ORDER BY revenue DESC LIMIT 20
      `).all(filter.from, filter.to),
      salesMix: db.prepare(`
        SELECT
          CASE WHEN appointment_id IS NULL THEN 'Counter Sale (walk-in)' ELSE 'Rx-driven (from doctor)' END as kind,
          COUNT(*) as count,
          COALESCE(SUM(total),0) as revenue
        FROM pharmacy_sales
        WHERE date(created_at) BETWEEN ? AND ?
        GROUP BY kind
      `).all(filter.from, filter.to),
      scheduleMix: db.prepare(`
        SELECT schedule, COUNT(*) as count, SUM(qty) as units
        FROM dispensing_register
        WHERE date(dispensed_at) BETWEEN ? AND ?
        GROUP BY schedule
        ORDER BY count DESC
      `).all(filter.from, filter.to),
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
               CAST((julianday(b.expiry) - julianday('now')) AS INTEGER) as days
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
        WHERE b.is_active=1 AND b.qty_remaining > 0
          AND date(b.expiry) BETWEEN date('now') AND date('now', '+90 days')
        ORDER BY date(b.expiry) ASC LIMIT 30
      `).all(),
    };
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

    // --- Quick-period cards
    const yesterday = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at)=date(?, '-1 day')", [today]);
    const todayTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at)=?", [today]);
    const weekTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-6 days')", [today]);
    const prevWeek = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-13 days') AND date(created_at) < date(?, '-6 days')", [today, today]);
    const monthTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', ?)", [today]);
    const prevMonth = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', date(?, 'start of month', '-1 day'))", [today]);
    const allTime = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills");

    // Avg + largest in whole-time
    const avg = row("SELECT COALESCE(AVG(total),0) as avg, COALESCE(MAX(total),0) as max FROM bills");

    // Custom range (default = last 30 days)
    const rangeFrom = filter.from || (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();
    const rangeTo = filter.to || today;
    const rangeBills = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) BETWEEN ? AND ?", [rangeFrom, rangeTo]);
    const rangePharma = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM pharmacy_sales WHERE date(created_at) BETWEEN ? AND ?", [rangeFrom, rangeTo]);

    const byDay = all(
      `SELECT date(created_at) as day, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) BETWEEN ? AND ?
       GROUP BY date(created_at) ORDER BY day DESC`,
      [rangeFrom, rangeTo]
    );
    const byWeek = all(
      `SELECT strftime('%Y-W%W', created_at) as week, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-56 days')
       GROUP BY week ORDER BY week DESC`,
      [today]
    );
    const byMonth = all(
      `SELECT strftime('%Y-%m', created_at) as month, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills GROUP BY month ORDER BY month DESC LIMIT 12`
    );
    const byMode = all(
      `SELECT payment_mode, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills GROUP BY payment_mode ORDER BY total DESC`
    );
    const byDoctor = all(
      `SELECT d.name as doctor, d.specialty, COALESCE(SUM(b.total),0) as total, COUNT(b.id) as count
       FROM bills b
       LEFT JOIN appointments a ON a.id=b.appointment_id
       LEFT JOIN doctors d ON d.id=a.doctor_id
       WHERE d.id IS NOT NULL
       GROUP BY d.id ORDER BY total DESC`
    );
    const todayByMode = all(
      `SELECT payment_mode, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at)=?
       GROUP BY payment_mode`,
      [today]
    );

    // Weekday pattern (0=Sun ... 6=Sat) — last 90 days
    const byWeekday = all(
      `SELECT strftime('%w', created_at) as wd, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-89 days')
       GROUP BY wd ORDER BY wd`,
      [today]
    );

    // Hour-of-day distribution — last 30 days
    const byHour = all(
      `SELECT strftime('%H', created_at) as hr, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-29 days')
       GROUP BY hr ORDER BY hr`,
      [today]
    );

    // Top patients by revenue — all-time
    const topPatients = all(
      `SELECT p.id, (p.first_name || ' ' || p.last_name) as name, p.uhid, p.place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       GROUP BY p.id ORDER BY total DESC LIMIT 10`
    );

    // By Place/Origin — last 90 days
    const byPlace = all(
      `SELECT COALESCE(NULLIF(TRIM(p.place), ''), 'Unknown') as place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE date(b.created_at) >= date(?, '-89 days')
       GROUP BY LOWER(TRIM(COALESCE(p.place,''))) ORDER BY total DESC LIMIT 15`,
      [today]
    );

    // Pharmacy vs OPD comparison — last 30 days
    const opd30 = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-29 days')", [today]);
    const pharma30 = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM pharmacy_sales WHERE date(created_at) >= date(?, '-29 days')", [today]);

    return {
      today: { total: todayTotal.t, count: todayTotal.c, byMode: todayByMode },
      yesterday: { total: yesterday.t, count: yesterday.c },
      week: { total: weekTotal.t, count: weekTotal.c },
      prevWeek: { total: prevWeek.t, count: prevWeek.c },
      month: { total: monthTotal.t, count: monthTotal.c },
      prevMonth: { total: prevMonth.t, count: prevMonth.c },
      allTime: { total: allTime.t, count: allTime.c, avg: avg.avg, max: avg.max },
      range: {
        from: rangeFrom, to: rangeTo,
        bills: { total: rangeBills.t, count: rangeBills.c },
        pharma: { total: rangePharma.t, count: rangePharma.c },
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
