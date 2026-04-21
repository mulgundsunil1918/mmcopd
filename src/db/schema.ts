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
      place TEXT,
      district TEXT,
      state TEXT,
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
      default_fee REAL NOT NULL DEFAULT 500,
      signature TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id),
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      token_number INTEGER NOT NULL,
      consultation_token TEXT,
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

    CREATE TABLE IF NOT EXISTS prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      drug_name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      instructions TEXT,
      order_idx INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_rx_appt ON prescription_items(appointment_id);

    CREATE TABLE IF NOT EXISTS lab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      sample_type TEXT,
      ref_range TEXT,
      unit TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lab_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      doctor_id INTEGER REFERENCES doctors(id),
      status TEXT NOT NULL DEFAULT 'ordered',
      ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
      collected_at TEXT,
      reported_at TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id);

    CREATE TABLE IF NOT EXISTS lab_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_order_id INTEGER NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
      lab_test_id INTEGER REFERENCES lab_tests(id),
      test_name TEXT NOT NULL,
      result TEXT,
      unit TEXT,
      ref_range TEXT,
      is_abnormal INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS drug_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      generic_name TEXT,
      form TEXT,
      strength TEXT,
      mrp REAL NOT NULL DEFAULT 0,
      purchase_price REAL,
      batch TEXT,
      expiry TEXT,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 10,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_drug_name ON drug_inventory(name);

    CREATE TABLE IF NOT EXISTS pharmacy_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_number TEXT NOT NULL UNIQUE,
      patient_id INTEGER REFERENCES patients(id),
      appointment_id INTEGER REFERENCES appointments(id),
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_mode TEXT,
      sold_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
      drug_id INTEGER REFERENCES drug_inventory(id),
      drug_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ip_admissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_number TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      admission_doctor_id INTEGER REFERENCES doctors(id),
      admitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      discharged_at TEXT,
      bed_number TEXT,
      ward TEXT,
      admission_notes TEXT,
      discharge_summary TEXT,
      status TEXT NOT NULL DEFAULT 'admitted'
    );
    CREATE INDEX IF NOT EXISTS idx_ip_status ON ip_admissions(status);

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
