import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 2;

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
      signature TEXT,
      qualifications TEXT,
      registration_no TEXT
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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT,
      doctor_id INTEGER REFERENCES doctors(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT,
      role TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      details TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

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

    CREATE TABLE IF NOT EXISTS patient_allergies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      allergen TEXT NOT NULL,
      reaction TEXT,
      severity TEXT,
      noted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_allergy_patient ON patient_allergies(patient_id);

    CREATE TABLE IF NOT EXISTS patient_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      condition TEXT NOT NULL,
      since TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_cond_patient ON patient_conditions(patient_id);

    CREATE TABLE IF NOT EXISTS patient_family_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      condition TEXT NOT NULL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fam_patient ON patient_family_history(patient_id);

    CREATE TABLE IF NOT EXISTS patient_immunizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      vaccine TEXT NOT NULL,
      given_at TEXT,
      dose TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_imm_patient ON patient_immunizations(patient_id);

    CREATE TABLE IF NOT EXISTS patient_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_type TEXT,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      note TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_doc_patient ON patient_documents(patient_id);

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

    -- =========================================================
    -- PHARMACY COMPLIANCE (Schedule H/H1, FEFO, batch tracking)
    -- =========================================================

    -- Master drug catalog (one row per SKU). Stock lives in drug_stock_batches.
    CREATE TABLE IF NOT EXISTS drug_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      generic_name TEXT,
      manufacturer TEXT,
      form TEXT,
      strength TEXT,
      pack_size INTEGER,
      schedule TEXT NOT NULL DEFAULT 'OTC' CHECK (schedule IN ('H','H1','G','X','OTC')),
      hsn_code TEXT,
      gst_rate REAL NOT NULL DEFAULT 12,
      default_mrp REAL NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 10,
      barcode TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_drug_master_name ON drug_master(name);
    CREATE INDEX IF NOT EXISTS idx_drug_master_generic ON drug_master(generic_name);
    CREATE INDEX IF NOT EXISTS idx_drug_master_barcode ON drug_master(barcode);
    CREATE INDEX IF NOT EXISTS idx_drug_master_schedule ON drug_master(schedule);

    -- Wholesalers (suppliers) — drug license number is required by inspectors.
    CREATE TABLE IF NOT EXISTS wholesalers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      drug_license_no TEXT NOT NULL,
      gstin TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Purchase invoice header (one row per wholesaler bill).
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL,
      wholesaler_id INTEGER NOT NULL REFERENCES wholesalers(id) ON DELETE RESTRICT,
      invoice_date TEXT NOT NULL,
      received_date TEXT NOT NULL DEFAULT (date('now')),
      subtotal REAL NOT NULL DEFAULT 0,
      cgst REAL NOT NULL DEFAULT 0,
      sgst REAL NOT NULL DEFAULT 0,
      igst REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_mode TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid','partial')),
      scan_path TEXT,
      ocr_job_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (wholesaler_id, invoice_number)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_inv_date ON purchase_invoices(invoice_date);
    CREATE INDEX IF NOT EXISTS idx_purchase_inv_wholesaler ON purchase_invoices(wholesaler_id);

    -- Purchase invoice line items — each row spawns one drug_stock_batches row.
    CREATE TABLE IF NOT EXISTS purchase_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      drug_master_id INTEGER NOT NULL REFERENCES drug_master(id) ON DELETE RESTRICT,
      batch_no TEXT NOT NULL,
      expiry TEXT NOT NULL,
      qty_received INTEGER NOT NULL,
      pack_qty INTEGER,
      free_qty INTEGER NOT NULL DEFAULT 0,
      purchase_price REAL NOT NULL,
      mrp REAL NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 12,
      manufacturer_license_no TEXT,
      line_total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pii_invoice ON purchase_invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_pii_drug ON purchase_invoice_items(drug_master_id);

    -- Live FEFO inventory: one row per (drug, batch). qty_remaining decrements on dispense.
    CREATE TABLE IF NOT EXISTS drug_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drug_master_id INTEGER NOT NULL REFERENCES drug_master(id) ON DELETE RESTRICT,
      purchase_item_id INTEGER REFERENCES purchase_invoice_items(id) ON DELETE SET NULL,
      batch_no TEXT NOT NULL,
      expiry TEXT NOT NULL,
      qty_received INTEGER NOT NULL,
      qty_remaining INTEGER NOT NULL,
      purchase_price REAL,
      mrp REAL NOT NULL DEFAULT 0,
      manufacturer_license_no TEXT,
      received_at TEXT NOT NULL DEFAULT (date('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (drug_master_id, batch_no)
    );
    CREATE INDEX IF NOT EXISTS idx_batch_drug_expiry ON drug_stock_batches(drug_master_id, expiry);
    CREATE INDEX IF NOT EXISTS idx_batch_active ON drug_stock_batches(is_active, qty_remaining);

    -- Schedule H/H1 dispensing register — every dispense slice is a permanent legal record.
    -- A single sale_item may consume multiple batches under FEFO; one register row per batch hit.
    -- All FKs are RESTRICT — never silently disappears.
    CREATE TABLE IF NOT EXISTS dispensing_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_item_id INTEGER NOT NULL REFERENCES pharmacy_sale_items(id) ON DELETE RESTRICT,
      sale_id INTEGER NOT NULL REFERENCES pharmacy_sales(id) ON DELETE RESTRICT,
      patient_id INTEGER REFERENCES patients(id),
      doctor_id INTEGER REFERENCES doctors(id),
      drug_master_id INTEGER NOT NULL REFERENCES drug_master(id),
      batch_id INTEGER NOT NULL REFERENCES drug_stock_batches(id),
      batch_no TEXT NOT NULL,
      expiry TEXT NOT NULL,
      schedule TEXT NOT NULL,
      qty INTEGER NOT NULL,
      rate REAL NOT NULL,
      rx_reference TEXT,
      dispensed_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispensed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_disp_date ON dispensing_register(dispensed_at);
    CREATE INDEX IF NOT EXISTS idx_disp_schedule ON dispensing_register(schedule, dispensed_at);
    CREATE INDEX IF NOT EXISTS idx_disp_patient ON dispensing_register(patient_id);
  `);
}
