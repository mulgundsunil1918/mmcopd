import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

export function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uhid TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('M','F','Other')),
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      blood_group TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      room_number TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      default_fee REAL NOT NULL DEFAULT 500
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id),
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      token_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Waiting',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_appt_date_doctor ON appointments(appointment_date, doctor_id);
    CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_number TEXT NOT NULL UNIQUE,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'flat',
      total REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
    CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at);

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_log(status);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      doctor_id INTEGER NOT NULL REFERENCES doctors(id),
      history TEXT,
      vitals_json TEXT,
      examination TEXT,
      impression TEXT,
      advice TEXT,
      follow_up_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_consult_patient ON consultations(patient_id);
  `);
}
