import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export type Role = 'admin' | 'receptionist' | 'doctor' | 'lab_tech' | 'pharmacist';

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  display_name: string | null;
  doctor_id: number | null;
}

function hash(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function createUser(
  db: Database.Database,
  input: { username: string; password: string; role: Role; display_name?: string; doctor_id?: number }
): SessionUser {
  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = hash(input.password, salt);
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, salt, role, display_name, doctor_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    )
    .run(input.username.trim().toLowerCase(), password_hash, salt, input.role, input.display_name ?? null, input.doctor_id ?? null);
  const row = db.prepare('SELECT id, username, role, display_name, doctor_id FROM users WHERE id=?').get(info.lastInsertRowid) as any;
  return row;
}

export function verifyLogin(db: Database.Database, username: string, password: string): SessionUser | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username=? AND is_active=1')
    .get(username.trim().toLowerCase()) as any;
  if (!row) return null;
  const calc = hash(password, row.salt);
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(row.password_hash))) return null;
  db.prepare('UPDATE users SET last_login_at = datetime("now") WHERE id=?').run(row.id);
  return { id: row.id, username: row.username, role: row.role, display_name: row.display_name, doctor_id: row.doctor_id };
}

export function ensureDefaultAdmin(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (count.c === 0) {
    // Default admin: admin / admin123 — prompt user to change after first login
    createUser(db, { username: 'admin', password: 'admin123', role: 'admin', display_name: 'Administrator' });
  }
}

export function changePassword(db: Database.Database, userId: number, newPassword: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = hash(newPassword, salt);
  db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(password_hash, salt, userId);
}

export function listUsers(db: Database.Database) {
  return db
    .prepare('SELECT id, username, role, display_name, doctor_id, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC')
    .all();
}

export function updateUser(
  db: Database.Database,
  id: number,
  patch: { role?: Role; display_name?: string; doctor_id?: number | null; is_active?: 0 | 1 }
) {
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.role) { fields.push('role=?'); params.push(patch.role); }
  if (patch.display_name !== undefined) { fields.push('display_name=?'); params.push(patch.display_name); }
  if (patch.doctor_id !== undefined) { fields.push('doctor_id=?'); params.push(patch.doctor_id); }
  if (patch.is_active !== undefined) { fields.push('is_active=?'); params.push(patch.is_active); }
  if (fields.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
}

export function logAudit(
  db: Database.Database,
  user: SessionUser | null,
  action: string,
  entity?: string,
  entity_id?: number,
  details?: string
) {
  db.prepare(
    'INSERT INTO audit_log (user_id, username, role, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user?.id ?? null, user?.username ?? null, user?.role ?? null, action, entity ?? null, entity_id ?? null, details ?? null);
}

export function listAudit(db: Database.Database, limit = 500) {
  return db.prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit);
}
