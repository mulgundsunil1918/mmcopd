"use strict";
const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto$1 = require("node:crypto");
const XLSX = require("xlsx");
const Database = require("better-sqlite3");
const ws = require("ws");
const http = require("node:http");
const dgram = require("node:dgram");
const os = require("node:os");
const net = require("node:net");
const node_child_process = require("node:child_process");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const XLSX__namespace = /* @__PURE__ */ _interopNamespaceDefault(XLSX);
const SCHEMA_VERSION = 4;
function createSchema(db2) {
  db2.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Monotonic counters backing every generated identifier (UHID, invoice
    -- number, admission number, per-patient visit number).
    --
    -- Replaces the old COUNT(*)+1 scheme, which reused a number after any
    -- record was deleted and then failed on the UNIQUE constraint. A counter
    -- never decrements, so numbers are never reused. Gaps are intentional.
    CREATE TABLE IF NOT EXISTS counters (
      scope      TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
const DEFAULT_LAYOUT = {
  pages: 2,
  logoSize: "large",
  headerStyle: "full",
  fontSize: 13,
  showVitals: true,
  showRxTable: true,
  showSignature: true,
  showQrCodes: true,
  showFollowupBox: true,
  page1Keys: [],
  page2Keys: []
};
const generalSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 55, printed: true },
  { key: "examination", title: "Examination", type: "textarea", height_mm: 60, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 60, printed: true }
];
const obgSections = [
  { key: "lmp", title: "LMP (Last Menstrual Period)", type: "date", printed: true },
  { key: "edd", title: "EDD (Expected Date of Delivery)", type: "date", printed: true },
  { key: "parity", title: "G / P / A / L", type: "singleline", height_mm: 8, placeholder: "e.g. G2 P1 A0 L1", printed: true },
  { key: "gestational_age", title: "Gestational Age", type: "singleline", height_mm: 8, placeholder: "e.g. 28 wks 3 days", printed: true },
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 40, printed: true },
  { key: "examination", title: "P/A & P/V Examination", type: "textarea", height_mm: 40, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 50, printed: true }
];
const pediatricsSections = [
  { key: "feeding", title: "Feeding History", type: "textarea", height_mm: 18, printed: true },
  { key: "milestones", title: "Developmental Milestones", type: "textarea", height_mm: 18, printed: true },
  { key: "immunization", title: "Immunization Status", type: "singleline", height_mm: 8, placeholder: "e.g. Up to date / Partial / Pending DPT-3", printed: true },
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 40, printed: true },
  { key: "examination", title: "Examination", type: "textarea", height_mm: 40, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 50, printed: true }
];
const cardiologySections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 35, printed: true },
  { key: "exertional", title: "Exertional Capacity / NYHA Class", type: "singleline", height_mm: 8, placeholder: "e.g. NYHA II — breathless on climbing 1 flight", printed: true },
  { key: "heart_sounds", title: "Heart Sounds / Murmurs", type: "textarea", height_mm: 22, placeholder: "S1 S2 normal · No added sounds · No murmur", printed: true },
  { key: "ecg_findings", title: "ECG / Echo Findings", type: "textarea", height_mm: 22, printed: true },
  { key: "examination", title: "Other Examination", type: "textarea", height_mm: 22, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 45, printed: true }
];
const orthoSections = [
  { key: "site", title: "Site / Side", type: "singleline", height_mm: 8, placeholder: "e.g. Right knee · Left shoulder", printed: true },
  { key: "mechanism", title: "Mechanism of Injury", type: "textarea", height_mm: 18, placeholder: "How did the injury happen?", printed: true },
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, printed: true },
  { key: "rom", title: "Range of Motion (ROM)", type: "textarea", height_mm: 18, placeholder: "Flexion / Extension / Abduction / Rotation", printed: true },
  { key: "deformities", title: "Deformities / Tenderness", type: "textarea", height_mm: 18, printed: true },
  { key: "examination", title: "Other Examination", type: "textarea", height_mm: 22, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 40, printed: true }
];
const entSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 35, placeholder: "Onset, duration, side, associated symptoms", printed: true },
  { key: "otoscopy_right", title: "Otoscopy — Right Ear", type: "textarea", height_mm: 18, placeholder: "EAC · TM appearance · Cone of light · Discharge", printed: true },
  { key: "otoscopy_left", title: "Otoscopy — Left Ear", type: "textarea", height_mm: 18, placeholder: "EAC · TM appearance · Cone of light · Discharge", printed: true },
  { key: "hearing", title: "Hearing Assessment", type: "singleline", height_mm: 8, placeholder: "e.g. Whisper test passed · Audiometry pending", printed: true },
  { key: "tuning_fork", title: "Tuning Fork Tests", type: "textarea", height_mm: 14, placeholder: "Rinne · Weber · ABC", printed: true },
  { key: "nasal", title: "Nasal Examination", type: "textarea", height_mm: 18, placeholder: "Septum · Turbinates · Discharge · Polyps", printed: true },
  { key: "throat", title: "Throat / Pharynx Examination", type: "textarea", height_mm: 18, placeholder: "Tonsils · Posterior pharyngeal wall · Uvula", printed: true },
  { key: "examination", title: "Other Examination", type: "textarea", height_mm: 18, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 40, printed: true }
];
const generalMedicineSections = [
  { key: "history", title: "Chief Complaints", type: "textarea", height_mm: 35, placeholder: "Presenting complaints with onset, duration, progression", printed: true },
  { key: "past_history", title: "Past History", type: "textarea", height_mm: 18, placeholder: "DM · HTN · TB · IHD · Surgeries · Allergies", printed: true },
  { key: "personal_history", title: "Personal History", type: "textarea", height_mm: 18, placeholder: "Diet · Sleep · Bowel · Bladder · Addictions (smoking / alcohol / tobacco)", printed: true },
  { key: "family_history", title: "Family History", type: "textarea", height_mm: 14, placeholder: "Heritable / chronic illnesses in immediate family", printed: true },
  { key: "general_exam", title: "General Examination", type: "textarea", height_mm: 22, placeholder: "Pallor · Icterus · Cyanosis · Clubbing · Lymphadenopathy · Edema", printed: true },
  { key: "examination", title: "Systemic Examination (CVS · RS · P/A · CNS)", type: "textarea", height_mm: 35, printed: true },
  { key: "impression", title: "Provisional Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 50, printed: true }
];
const dermaSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, placeholder: "Onset, duration, site, spread, associated symptoms, aggravating / relieving factors", printed: true },
  { key: "lesion_description", title: "Lesion Description", type: "textarea", height_mm: 22, placeholder: "Type · Size · Shape · Border · Colour · Surface · Consistency", printed: true },
  { key: "distribution", title: "Distribution / Site", type: "singleline", height_mm: 8, placeholder: "e.g. Bilateral extensor surface of forearms", printed: true },
  { key: "examination", title: "General & Systemic Examination", type: "textarea", height_mm: 22, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 50, printed: true }
];
const ophthoSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, placeholder: "Visual disturbance, pain, redness, discharge — onset and duration", printed: true },
  { key: "vision_re", title: "Vision — Right Eye (RE)", type: "singleline", height_mm: 8, placeholder: "e.g. 6/6 unaided · 6/12 with PH", printed: true },
  { key: "vision_le", title: "Vision — Left Eye (LE)", type: "singleline", height_mm: 8, placeholder: "e.g. 6/6 unaided · 6/18 with PH", printed: true },
  { key: "iop", title: "IOP (Intraocular Pressure)", type: "singleline", height_mm: 8, placeholder: "RE: __mmHg  LE: __mmHg", printed: true },
  { key: "slit_lamp", title: "Slit-lamp Examination", type: "textarea", height_mm: 22, placeholder: "Cornea · Anterior chamber · Lens · Vitreous", printed: true },
  { key: "fundus", title: "Fundus Examination", type: "textarea", height_mm: 22, placeholder: "Disc · Vessels · Macula · Periphery", printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 18, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 45, printed: true }
];
const neuroSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 35, placeholder: "Headache, weakness, numbness, seizures, speech, memory — onset & progression", printed: true },
  { key: "cranial_nerves", title: "Cranial Nerve Examination", type: "textarea", height_mm: 22, placeholder: "CN II–XII assessment", printed: true },
  { key: "motor", title: "Motor System", type: "textarea", height_mm: 18, placeholder: "Tone · Power (MRC grade) · Reflexes · Coordination", printed: true },
  { key: "sensory", title: "Sensory System", type: "textarea", height_mm: 18, placeholder: "Pain · Touch · Vibration · Proprioception", printed: true },
  { key: "examination", title: "Other Examination", type: "textarea", height_mm: 18, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 45, printed: true }
];
const psychiatrySections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, placeholder: "Presenting problem, onset, duration, precipitating factors", printed: true },
  { key: "mse_appearance", title: "Mental Status — Appearance & Behaviour", type: "textarea", height_mm: 18, placeholder: "Grooming · Eye contact · Psychomotor activity", printed: true },
  { key: "mse_speech_mood", title: "Mental Status — Speech & Mood", type: "textarea", height_mm: 18, placeholder: "Rate · Volume · Mood (subjective) · Affect", printed: true },
  { key: "mse_thought", title: "Mental Status — Thought & Perception", type: "textarea", height_mm: 18, placeholder: "Form · Content · Hallucinations · Delusions", printed: true },
  { key: "sleep_appetite", title: "Sleep / Appetite", type: "singleline", height_mm: 8, placeholder: "Sleep: __hrs · Appetite: Good/Poor", printed: true },
  { key: "impression", title: "Impression / Diagnosis (ICD-10)", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Plan / Prescription", type: "textarea", height_mm: 45, printed: true }
];
const dentalSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 25, placeholder: "Pain, sensitivity, swelling — onset, character, severity", printed: true },
  { key: "tooth_no", title: "Tooth / Site", type: "singleline", height_mm: 8, placeholder: "e.g. 36 (lower left 1st molar)", printed: true },
  { key: "clinical_findings", title: "Clinical Findings", type: "textarea", height_mm: 22, placeholder: "Caries · Mobility · Percussion · Gingival status", printed: true },
  { key: "xray_findings", title: "X-ray / Radiograph Findings", type: "textarea", height_mm: 18, placeholder: "Periapical / OPG / CBCT findings", printed: true },
  { key: "procedure", title: "Procedure Done / Planned", type: "textarea", height_mm: 22, placeholder: "Scaling · Extraction · RCT · Crown · Filling", printed: true },
  { key: "impression", title: "Diagnosis", type: "textarea", height_mm: 18, printed: true },
  { key: "advice", title: "Advice & Post-procedure Instructions", type: "textarea", height_mm: 40, printed: true }
];
const gastroSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 35, placeholder: "Pain, nausea, vomiting, diarrhoea, constipation, bleeding — onset & progression", printed: true },
  { key: "abdominal_exam", title: "Abdominal Examination", type: "textarea", height_mm: 25, placeholder: "Inspection · Palpation (tender quadrant, guarding, rigidity) · Percussion · Auscultation", printed: true },
  { key: "endoscopy", title: "Endoscopy / Colonoscopy Findings", type: "textarea", height_mm: 18, placeholder: "Findings and biopsy notes", printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 50, printed: true }
];
const pulmoSections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, placeholder: "Cough, breathlessness, wheeze, haemoptysis — onset, triggers, severity", printed: true },
  { key: "spo2_trend", title: "SpO₂ / Peak Flow / 6MWT", type: "singleline", height_mm: 8, placeholder: "SpO₂ at rest: __% · Exertion: __% · PEFR: __L/min", printed: true },
  { key: "spirometry", title: "Spirometry / PFT", type: "textarea", height_mm: 18, placeholder: "FEV1: __ · FVC: __ · FEV1/FVC: __ · Pattern: Obstructive/Restrictive/Mixed", printed: true },
  { key: "examination", title: "Examination", type: "textarea", height_mm: 25, placeholder: "Air entry · Wheeze · Crepitations · Added sounds", printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 45, printed: true }
];
const urologySections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, placeholder: "Dysuria, frequency, haematuria, stone symptoms, retention — onset & duration", printed: true },
  { key: "urine_exam", title: "Urine Examination / Culture", type: "singleline", height_mm: 8, placeholder: "Report summary or pending", printed: true },
  { key: "usg_findings", title: "USG / KUB Findings", type: "textarea", height_mm: 22, placeholder: "Kidney · Ureter · Bladder — size, calculi, hydronephrosis", printed: true },
  { key: "psa", title: "PSA (if applicable)", type: "singleline", height_mm: 8, placeholder: "Total PSA: __ ng/mL  Date: __", printed: true },
  { key: "examination", title: "Examination", type: "textarea", height_mm: 22, printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 22, printed: true },
  { key: "advice", title: "Advice / Prescription (Rx)", type: "textarea", height_mm: 45, printed: true }
];
const surgerySections = [
  { key: "history", title: "Chief Complaints / History", type: "textarea", height_mm: 30, printed: true },
  { key: "examination", title: "Examination / Local Finding", type: "textarea", height_mm: 25, placeholder: "Local: site, size, swelling, tenderness · Systemic: CVS, RS, P/A", printed: true },
  { key: "investigation", title: "Investigations", type: "textarea", height_mm: 18, placeholder: "Blood workup · USG / CT / X-ray findings", printed: true },
  { key: "procedure_plan", title: "Procedure / Operation Planned", type: "singleline", height_mm: 8, placeholder: "e.g. Laparoscopic cholecystectomy · Hernia repair", printed: true },
  { key: "post_op_notes", title: "Post-operative Notes", type: "textarea", height_mm: 22, placeholder: "Wound status · Drains · Diet · Activity restrictions", printed: true },
  { key: "impression", title: "Impression / Diagnosis", type: "textarea", height_mm: 18, printed: true },
  { key: "advice", title: "Advice / Discharge Instructions", type: "textarea", height_mm: 40, printed: true }
];
const DEFAULT_SLIP_TEMPLATES = [
  { id: 1, name: "General", specialty_hint: "Default short layout", sections: generalSections },
  { id: 2, name: "General Medicine", specialty_hint: "Full medicine workup — past / personal / family / systemic exam", sections: generalMedicineSections },
  { id: 3, name: "OBG", specialty_hint: "Obstetrics & Gynaecology", sections: obgSections },
  { id: 4, name: "Pediatrics", specialty_hint: "Children — feeding, milestones, immunization", sections: pediatricsSections },
  { id: 5, name: "Cardiology", specialty_hint: "Heart-focused workflow with NYHA, sounds, ECG", sections: cardiologySections },
  { id: 6, name: "Orthopedic", specialty_hint: "Site, ROM, deformities", sections: orthoSections },
  { id: 7, name: "ENT", specialty_hint: "Ear · Nose · Throat — otoscopy, tuning fork, nasal, throat", sections: entSections },
  { id: 8, name: "Dermatology", specialty_hint: "Skin — lesion description, distribution", sections: dermaSections },
  { id: 9, name: "Ophthalmology", specialty_hint: "Eye — vision, IOP, slit-lamp, fundus", sections: ophthoSections },
  { id: 10, name: "Neurology", specialty_hint: "Cranial nerves, motor, sensory", sections: neuroSections },
  { id: 11, name: "Psychiatry", specialty_hint: "MSE — appearance, mood, thought, perception", sections: psychiatrySections },
  { id: 12, name: "Dentistry", specialty_hint: "Tooth #, procedure, radiograph — Vitals & Rx off by default", sections: dentalSections, layout: { ...DEFAULT_LAYOUT, showVitals: false, showRxTable: false } },
  { id: 13, name: "Gastroenterology", specialty_hint: "Abdomen, endoscopy, colonoscopy", sections: gastroSections },
  { id: 14, name: "Pulmonology", specialty_hint: "SpO₂, PFT, spirometry", sections: pulmoSections },
  { id: 15, name: "Urology", specialty_hint: "KUB, USG, PSA", sections: urologySections },
  { id: 16, name: "General Surgery", specialty_hint: "Pre-op / post-op — procedure, wound status", sections: surgerySections }
];
const FACTORY_PASSWORD = "admin123";
function flagFactoryPasswordUsers(db2) {
  let rows;
  try {
    rows = db2.prepare("SELECT id, salt, password_hash FROM users").all();
  } catch {
    return;
  }
  const upd = db2.prepare("UPDATE users SET must_change_password=1 WHERE id=?");
  for (const r of rows) {
    if (!r.salt || !r.password_hash) continue;
    try {
      const calc = crypto$1.scryptSync(FACTORY_PASSWORD, r.salt, 32).toString("hex");
      if (calc === r.password_hash) upd.run(r.id);
    } catch {
    }
  }
}
function addColumnIfMissing(db2, table, column, decl) {
  const cols = db2.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db2.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
function backfillVisitNumbers(db2) {
  let pending = 0;
  try {
    pending = db2.prepare("SELECT COUNT(*) AS c FROM appointments WHERE visit_number IS NULL").get().c;
  } catch (err) {
    throw new Error(`Visit-number backfill could not read appointments: ${(err == null ? void 0 : err.message) || String(err)}`);
  }
  if (pending === 0) return;
  const rows = db2.prepare(
    `SELECT a.id, a.patient_id, p.uhid
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       ORDER BY a.patient_id, a.appointment_date, a.appointment_time, a.id`
  ).all();
  const upd = db2.prepare("UPDATE appointments SET visit_number=?, visit_id=? WHERE id=?");
  const perPatient = /* @__PURE__ */ new Map();
  const tx = db2.transaction(() => {
    for (const r of rows) {
      const n = (perPatient.get(r.patient_id) ?? 0) + 1;
      perPatient.set(r.patient_id, n);
      upd.run(n, r.uhid ? `${r.uhid}/V${n}` : null, r.id);
    }
  });
  try {
    tx();
  } catch (err) {
    throw new Error(
      `Visit-number backfill failed while numbering ${rows.length} appointments: ${(err == null ? void 0 : err.message) || String(err)}. No changes were applied (the backfill runs in a transaction).`
    );
  }
}
function seedCountersFromExistingData(db2) {
  const raise = db2.prepare(
    `INSERT INTO counters (scope, next_value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET
       next_value = MAX(next_value, excluded.next_value),
       updated_at = datetime('now')`
  );
  const maxSuffix = (table, col, like) => {
    try {
      const row = db2.prepare(
        `SELECT MAX(CAST(replace(substr(${col}, length(${col}) - 3), '-', '') AS INTEGER)) AS mx
           FROM ${table} WHERE ${col} LIKE ?`
      ).get(like);
      return (row == null ? void 0 : row.mx) ?? 0;
    } catch {
      return 0;
    }
  };
  try {
    const days = db2.prepare(`SELECT DISTINCT substr(uhid, 4, 8) AS day FROM patients WHERE uhid LIKE 'PT-%'`).all();
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`uhid:${day}`, maxSuffix("patients", "uhid", `PT-${day}-%`));
    }
  } catch {
  }
  try {
    const days = db2.prepare(`SELECT DISTINCT substr(bill_number, 5, 8) AS day FROM bills WHERE bill_number LIKE 'INV-%'`).all();
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`bill-legacy:${day}`, maxSuffix("bills", "bill_number", `INV-${day}-%`));
    }
  } catch {
  }
  try {
    const days = db2.prepare(`SELECT DISTINCT substr(admission_number, 4, 8) AS day FROM ip_admissions WHERE admission_number LIKE 'IP-%'`).all();
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`ip-legacy:${day}`, maxSuffix("ip_admissions", "admission_number", `IP-${day}-%`));
    }
  } catch {
  }
  const seedFySeries = (table, col, prefix, scopePrefix) => {
    try {
      const rows = db2.prepare(`SELECT ${col} AS v FROM ${table} WHERE ${col} LIKE '${prefix}/%'`).all();
      const best = /* @__PURE__ */ new Map();
      for (const { v } of rows) {
        const m = /^([A-Za-z]+)\/(\d{4}-\d{2})\/(\d+)$/.exec(v);
        if (!m) continue;
        const scope = `${scopePrefix}:${m[1]}:${m[2]}`;
        const n = parseInt(m[3], 10);
        if (Number.isFinite(n)) best.set(scope, Math.max(best.get(scope) ?? 0, n));
      }
      for (const [scope, n] of best) raise.run(scope, n);
    } catch {
    }
  };
  seedFySeries("bills", "bill_number", "INV", "bill");
  seedFySeries("ip_admissions", "admission_number", "IP", "ip");
  try {
    const rows = db2.prepare(`SELECT patient_id, COUNT(*) AS c FROM appointments GROUP BY patient_id`).all();
    for (const r of rows) raise.run(`visit:${r.patient_id}`, r.c);
  } catch {
  }
}
function setSettingIfEmpty(db2, key, value) {
  const row = db2.prepare("SELECT value FROM settings WHERE key=?").get(key);
  const current = (row == null ? void 0 : row.value) ?? "";
  if (current.trim().length === 0) {
    db2.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
}
function runMigrations(db2) {
  createSchema(db2);
  addColumnIfMissing(db2, "doctors", "signature", "TEXT");
  addColumnIfMissing(db2, "doctors", "qualifications", "TEXT");
  addColumnIfMissing(db2, "doctors", "registration_no", "TEXT");
  addColumnIfMissing(db2, "doctors", "color", "TEXT");
  addColumnIfMissing(db2, "doctors", "available_from", "TEXT");
  addColumnIfMissing(db2, "doctors", "available_to", "TEXT");
  addColumnIfMissing(db2, "patients", "place", "TEXT");
  addColumnIfMissing(db2, "patients", "district", "TEXT");
  addColumnIfMissing(db2, "patients", "state", "TEXT");
  addColumnIfMissing(db2, "appointments", "consultation_token", "TEXT");
  addColumnIfMissing(db2, "patients", "profession", "TEXT");
  addColumnIfMissing(db2, "users", "doctor_id", "INTEGER REFERENCES doctors(id)");
  addColumnIfMissing(db2, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  flagFactoryPasswordUsers(db2);
  addColumnIfMissing(db2, "appointments", "visit_number", "INTEGER");
  addColumnIfMissing(db2, "appointments", "visit_id", "TEXT");
  backfillVisitNumbers(db2);
  seedCountersFromExistingData(db2);
  addColumnIfMissing(db2, "bills", "is_free_followup", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db2, "bills", "followup_parent_appt_id", "INTEGER REFERENCES appointments(id)");
  setSettingIfEmpty(db2, "followup_enabled", "true");
  setSettingIfEmpty(db2, "followup_window_days", "7");
  setSettingIfEmpty(db2, "followup_free_visits", "2");
  setSettingIfEmpty(db2, "followup_grace_days", "2");
  addColumnIfMissing(db2, "bills", "is_relaxed_followup", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db2, "patients", "registration_fee_paid", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db2, "patients", "registration_fee_paid_at", "TEXT");
  setSettingIfEmpty(db2, "registration_fee_enabled", "true");
  setSettingIfEmpty(db2, "registration_fee_amount", "100");
  setSettingIfEmpty(db2, "registration_fee_default_timing", "ask");
  addColumnIfMissing(db2, "bills", "doctor_id", "INTEGER REFERENCES doctors(id)");
  addColumnIfMissing(db2, "bills", "notes", "TEXT");
  addColumnIfMissing(db2, "bills", "bill_kind", "TEXT NOT NULL DEFAULT 'opd'");
  setSettingIfEmpty(db2, "misc_services", "Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other");
  setSettingIfEmpty(db2, "network_mode", "local");
  setSettingIfEmpty(db2, "network_listen_port", "4321");
  setSettingIfEmpty(db2, "network_server_url", "");
  setSettingIfEmpty(db2, "network_secret", "");
  setSettingIfEmpty(db2, "station_name", "");
  try {
    const row = db2.prepare("SELECT value FROM settings WHERE key='admin_password'").get();
    if (row && row.value === "1918") {
      db2.prepare("UPDATE settings SET value='1234' WHERE key='admin_password'").run();
    }
  } catch {
  }
  addColumnIfMissing(db2, "appointments", "row_version", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db2, "consultations", "row_version", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db2, "patients", "row_version", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db2, "doctors", "template_id", "INTEGER");
  addColumnIfMissing(db2, "doctors", "template_id_2", "INTEGER");
  addColumnIfMissing(db2, "doctors", "template_id_3", "INTEGER");
  addColumnIfMissing(db2, "doctors", "template_slot_names", "TEXT");
  addColumnIfMissing(db2, "consultations", "extra_fields_json", "TEXT");
  setSettingIfEmpty(db2, "slip_templates", JSON.stringify(DEFAULT_SLIP_TEMPLATES));
  try {
    const row = db2.prepare("SELECT value FROM settings WHERE key='slip_templates'").get();
    if (row == null ? void 0 : row.value) {
      const current2 = JSON.parse(row.value);
      const haveNames = new Set(current2.map((t) => (t.name || "").toLowerCase()));
      const additions = DEFAULT_SLIP_TEMPLATES.filter((t) => !haveNames.has(t.name.toLowerCase()));
      if (additions.length > 0) {
        const maxId = current2.reduce((mx, t) => Math.max(mx, t.id || 0), 0);
        const merged = [...current2];
        for (let i = 0; i < additions.length; i++) {
          merged.push({ ...additions[i], id: maxId + i + 1 });
        }
        db2.prepare("UPDATE settings SET value=? WHERE key='slip_templates'").run(JSON.stringify(merged));
      }
    }
  } catch {
  }
  addColumnIfMissing(db2, "prescription_items", "drug_master_id", "INTEGER REFERENCES drug_master(id)");
  addColumnIfMissing(db2, "pharmacy_sale_items", "drug_master_id", "INTEGER REFERENCES drug_master(id)");
  addColumnIfMissing(db2, "pharmacy_sale_items", "batch_id", "INTEGER REFERENCES drug_stock_batches(id)");
  addColumnIfMissing(db2, "pharmacy_sale_items", "gst_amount", "REAL DEFAULT 0");
  addColumnIfMissing(db2, "ip_admissions", "discharge_diagnosis", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "condition_at_discharge", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "treatment_given", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "investigation_findings", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "operative_notes", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "discharge_medications_json", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "followup_plan", "TEXT");
  addColumnIfMissing(db2, "ip_admissions", "discharge_doctor_id", "INTEGER REFERENCES doctors(id)");
  addColumnIfMissing(db2, "appointments", "patient_group", "TEXT");
  addColumnIfMissing(db2, "appointments", "procedure_tags", "TEXT");
  try {
    const row = db2.prepare("SELECT value FROM settings WHERE key='known_villages'").get();
    if (row && row.value === "Mulgund, Gadag, Lakshmeshwar, Shirahatti, Naregal, Rona, Ron, Hulkoti, Koppal, Hubli, Dharwad") {
      db2.prepare("UPDATE settings SET value='' WHERE key='known_villages'").run();
    }
  } catch {
  }
  db2.exec("CREATE INDEX IF NOT EXISTS idx_patients_place ON patients(place, district);");
  const current = db2.prepare("SELECT value FROM schema_meta WHERE key='version'").get();
  const currentVersion = current ? parseInt(current.value, 10) : 0;
  if (currentVersion < 2) {
    migrateV1toV2(db2);
  }
  if (currentVersion < 3) {
    migrateV2toV3(db2);
  }
  if (currentVersion < 4) {
    migrateV3toV4(db2);
  }
  if (currentVersion < SCHEMA_VERSION) {
    db2.prepare(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
    ).run(String(SCHEMA_VERSION));
  }
}
function migrateV1toV2(db2) {
  const hasLegacy = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drug_inventory'").get();
  const tx = db2.transaction(() => {
    if (hasLegacy) {
      const legacy = db2.prepare("SELECT * FROM drug_inventory").all();
      if (legacy.length > 0) {
        const insMaster = db2.prepare(`
          INSERT INTO drug_master
            (name, generic_name, form, strength, schedule, default_mrp, low_stock_threshold, is_active)
          VALUES (?, ?, ?, ?, 'OTC', ?, ?, ?)
        `);
        const insBatch = db2.prepare(`
          INSERT OR IGNORE INTO drug_stock_batches
            (drug_master_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, mrp, received_at, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), 1)
        `);
        const existsByName = db2.prepare("SELECT id FROM drug_master WHERE LOWER(name)=LOWER(?) LIMIT 1");
        for (const d of legacy) {
          const already = existsByName.get(d.name);
          let masterId;
          if (already) {
            masterId = already.id;
          } else {
            const info = insMaster.run(
              d.name,
              d.generic_name,
              d.form,
              d.strength,
              d.mrp ?? 0,
              d.low_stock_threshold ?? 10,
              d.is_active ?? 1
            );
            masterId = Number(info.lastInsertRowid);
          }
          const batchNo = d.batch && String(d.batch).trim() || "LEGACY";
          const expiry = d.expiry || "2099-12-31";
          insBatch.run(masterId, batchNo, expiry, d.stock_qty ?? 0, d.stock_qty ?? 0, d.purchase_price, d.mrp ?? 0);
        }
      }
    }
    db2.exec(`
      UPDATE prescription_items SET drug_master_id = (
        SELECT id FROM drug_master WHERE LOWER(drug_master.name) = LOWER(prescription_items.drug_name) LIMIT 1
      ) WHERE drug_master_id IS NULL
    `);
    db2.exec(`
      UPDATE pharmacy_sale_items SET drug_master_id = (
        SELECT id FROM drug_master WHERE LOWER(drug_master.name) = LOWER(pharmacy_sale_items.drug_name) LIMIT 1
      ) WHERE drug_master_id IS NULL
    `);
    const remapMode = db2.prepare(`
      UPDATE settings SET value = ?
      WHERE key = 'app_mode' AND value = ?
    `);
    remapMode.run("reception_pharmacy_doctor_lab", "reception_doctor_lab");
    remapMode.run("full", "reception_doctor_lab_ip");
  });
  tx();
}
function migrateV2toV3(db2) {
  db2.exec(`
    CREATE TABLE IF NOT EXISTS wa_accounts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number_id     TEXT NOT NULL UNIQUE,
      waba_id             TEXT NOT NULL,
      display_name        TEXT,
      phone_number        TEXT,
      access_token_enc    TEXT NOT NULL,
      webhook_verify_token TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'disconnected',
      last_health_check   TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wa_templates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'UTILITY',
      language     TEXT NOT NULL DEFAULT 'en',
      status       TEXT NOT NULL DEFAULT 'PENDING',
      components   TEXT NOT NULL DEFAULT '[]',
      meta_id      TEXT,
      use_case     TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS wa_automation_rules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      trigger        TEXT NOT NULL,
      template_name  TEXT NOT NULL,
      is_enabled     INTEGER NOT NULL DEFAULT 1,
      delay_minutes  INTEGER NOT NULL DEFAULT 0,
      extra_config   TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, trigger)
    );

    CREATE TABLE IF NOT EXISTS wa_message_queue (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      to_phone       TEXT NOT NULL,
      patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      template_name  TEXT NOT NULL,
      template_vars  TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      attempts       INTEGER NOT NULL DEFAULT 0,
      last_error     TEXT,
      scheduled_at   TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at        TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wa_queue_status_sched
      ON wa_message_queue(status, scheduled_at);

    CREATE TABLE IF NOT EXISTS wa_conversations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      patient_id      INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      phone           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      last_message_at TEXT,
      assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, phone)
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      wam_id          TEXT UNIQUE,
      conversation_id INTEGER REFERENCES wa_conversations(id) ON DELETE SET NULL,
      patient_id      INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      direction       TEXT NOT NULL DEFAULT 'outbound',
      message_type    TEXT NOT NULL DEFAULT 'template',
      content         TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'sent',
      timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wa_messages_conv
      ON wa_messages(conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS wa_webhook_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER REFERENCES wa_accounts(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL,
      processed   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wa_webhook_processed
      ON wa_webhook_events(processed, created_at);
  `);
}
function migrateV3toV4(db2) {
  db2.exec(`
    CREATE TABLE IF NOT EXISTS wa_campaigns (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      template_name  TEXT NOT NULL,
      template_vars  TEXT,
      segment        TEXT NOT NULL DEFAULT 'all',
      segment_config TEXT,
      status         TEXT NOT NULL DEFAULT 'draft',
      total_count    INTEGER NOT NULL DEFAULT 0,
      sent_count     INTEGER NOT NULL DEFAULT 0,
      failed_count   INTEGER NOT NULL DEFAULT 0,
      scheduled_at   TEXT,
      started_at     TEXT,
      completed_at   TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wa_campaigns_account
      ON wa_campaigns(account_id, status);

    CREATE TABLE IF NOT EXISTS wa_campaign_recipients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id  INTEGER NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
      patient_id   INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      phone        TEXT NOT NULL,
      patient_name TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      wam_id       TEXT,
      error        TEXT,
      sent_at      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wa_camp_recip_campaign
      ON wa_campaign_recipients(campaign_id, status);
  `);
}
const DEFAULT_SETTINGS = {
  // Empty by design — every install asks the admin to fill these in via
  // Settings → Clinic. Showcase / demo build seeds its own values separately.
  clinic_name: "",
  clinic_address: "",
  clinic_phone: "",
  clinic_email: "",
  clinic_tagline: "",
  clinic_registration_no: "",
  slot_duration: "30",
  consultation_fee: "250",
  special_price: "150",
  queue_flow_enabled: "false",
  show_user_badge: "true",
  show_billing_module: "true",
  show_patient_origin: "true",
  app_mode: "reception_pharmacy_doctor",
  default_state: "",
  default_district: "",
  known_villages: "",
  backup_folder: "",
  backup_reminder_time: "21:00",
  usb_reminder_weekday: "1",
  usb_reminder_time: "09:30",
  auto_launch: "true",
  minimize_to_tray: "true",
  start_minimized: "false",
  keep_all_backups: "true",
  auto_backup_enabled: "true",
  auto_backup_frequency: "daily",
  auto_backup_time: "13:00",
  update_check_enabled: "true",
  update_check_time: "10:30",
  admin_password: "1234",
  sms_enabled: "false",
  whatsapp_enabled: "false",
  sms_provider: "",
  sms_account_sid: "",
  sms_auth_token: "",
  sms_from_number: "",
  whatsapp_api_url: "",
  whatsapp_api_key: "",
  whatsapp_country_code: "91",
  appointments_default_sort: "oldest_first",
  followup_enabled: "true",
  followup_window_days: "7",
  followup_free_visits: "2",
  followup_grace_days: "2",
  registration_fee_enabled: "true",
  registration_fee_amount: "100",
  registration_fee_default_timing: "ask",
  misc_services: "Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other",
  // Network mode (multi-station / client-server). Default 'local' = single PC,
  // private SQLite. 'server' = this PC hosts; 'client' = this PC connects to
  // another PC running 'server'. URL + port + secret are honored only by the
  // active mode. The mode is also mirrored to localStorage at runtime so the
  // renderer can route IPC vs HTTP at boot.
  network_mode: "local",
  network_listen_port: "4321",
  network_server_url: "",
  network_secret: "",
  // Friendly name for THIS PC, shown to other stations + on the sidebar pill.
  // Receptionist can rename later in Settings. Examples: "Reception Desk",
  // "Cabin 1 — Dr. Patil", "Pharmacy Counter".
  station_name: "",
  // Default click-to-WhatsApp template. Placeholders are case-insensitive.
  whatsapp_template: "Namaste {{patient_name}} 🙏\n\nYour appointment at *{{clinic_name}}* is confirmed.\n\n👨‍⚕️ *Doctor:* {{doctor_name}}\n🚪 *Room:* {{room}}\n📅 *Date:* {{date}}    🕒 *Time:* {{time}}\n🎟️ *Token:* #{{token}}\n\n🆔 *Patient ID (UHID):* {{uhid}}\n📋 *Visit ID:* {{visit_id}}\n\n📍 {{clinic_address}}\n☎️ {{clinic_phone}}\n\nPlease arrive 10 minutes early. For any change, simply reply to this message or call us.\n\nThank you,\n*{{clinic_name}}*"
};
function seedIfEmpty(db2) {
  const upsert = db2.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
  const drugCount = db2.prepare("SELECT COUNT(*) as c FROM drug_inventory").get();
  if (drugCount.c === 0) {
    const ins = db2.prepare(
      "INSERT INTO drug_inventory (name, generic_name, form, strength, mrp, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const drugs = [
      ["Paracetamol 500mg", "Paracetamol", "Tablet", "500mg", 2, 100, 20],
      ["Cetirizine 10mg", "Cetirizine", "Tablet", "10mg", 1.5, 100, 20],
      ["Amoxicillin 500mg", "Amoxicillin", "Capsule", "500mg", 4, 50, 10],
      ["Azithromycin 500mg", "Azithromycin", "Tablet", "500mg", 15, 30, 10],
      ["Pantoprazole 40mg", "Pantoprazole", "Tablet", "40mg", 3, 50, 15],
      ["Ondansetron 4mg", "Ondansetron", "Tablet", "4mg", 5, 40, 10],
      ["Metformin 500mg", "Metformin", "Tablet", "500mg", 2, 60, 15],
      ["Amlodipine 5mg", "Amlodipine", "Tablet", "5mg", 2.5, 60, 15],
      ["Atorvastatin 10mg", "Atorvastatin", "Tablet", "10mg", 4, 40, 10],
      ["Ibuprofen 400mg", "Ibuprofen", "Tablet", "400mg", 2, 80, 20],
      ["ORS Sachet", "Oral Rehydration Salts", "Sachet", "—", 15, 50, 10],
      ["Cough Syrup 100ml", "Dextromethorphan", "Syrup", "100ml", 60, 25, 5],
      ["Crocin Syrup 60ml", "Paracetamol", "Syrup", "60ml", 45, 25, 5],
      ["Dettol Antiseptic 100ml", "Chloroxylenol", "Solution", "100ml", 55, 15, 5],
      ["Bandage Roll", "—", "Dressing", "—", 25, 30, 10]
    ];
    for (const d of drugs) ins.run(...d);
  }
  const labCount = db2.prepare("SELECT COUNT(*) as c FROM lab_tests").get();
  if (labCount.c === 0) {
    const ins = db2.prepare("INSERT INTO lab_tests (name, price, sample_type, ref_range, unit) VALUES (?, ?, ?, ?, ?)");
    const tests = [
      ["Complete Blood Count (CBC)", 300, "Blood (EDTA)", "Hb 12-16 g/dL; WBC 4-11 ×10³/µL", ""],
      ["Fasting Blood Sugar (FBS)", 80, "Blood (Fluoride)", "70-100", "mg/dL"],
      ["Post-prandial Blood Sugar (PPBS)", 80, "Blood (Fluoride)", "<140", "mg/dL"],
      ["HbA1c", 400, "Blood (EDTA)", "4-5.6", "%"],
      ["Lipid Profile", 500, "Blood (SST)", "Total Cholesterol <200 mg/dL", ""],
      ["Liver Function Test (LFT)", 450, "Blood (SST)", "—", ""],
      ["Kidney Function Test (KFT)", 450, "Blood (SST)", "Creatinine 0.6-1.2 mg/dL", ""],
      ["Thyroid Profile (T3 T4 TSH)", 400, "Blood (SST)", "TSH 0.4-4.0", "µIU/mL"],
      ["Urine Routine", 100, "Urine", "Normal", ""],
      ["ECG", 200, "—", "Normal sinus rhythm", ""],
      ["X-Ray Chest PA", 250, "—", "Normal lung fields", ""],
      ["Dengue NS1", 350, "Blood (SST)", "Negative", ""],
      ["Malaria Parasite (MP)", 150, "Blood", "Not detected", ""],
      ["Widal Test", 150, "Blood (SST)", "<1:80", ""],
      ["COVID-19 Rapid Antigen", 300, "Nasal swab", "Negative", ""]
    ];
    for (const t of tests) ins.run(...t);
  }
  const ctplRow = db2.prepare("SELECT value FROM settings WHERE key='clinical_quick_templates'").get();
  if (!ctplRow) {
    const CLINICAL_TEMPLATES = [
      {
        id: "dm2",
        name: "Type 2 Diabetes",
        category: "Endocrinology",
        fields: {
          history: "Known case of Type 2 Diabetes Mellitus. Presenting for routine follow-up.\nCompliance with medications — good/poor. No hypoglycaemic episodes reported.",
          examination: "Vitals stable. No pallor, icterus, cyanosis, clubbing, lymphadenopathy, oedema. CVS — S1 S2 normal. RS — NVBS. P/A — soft, non-tender.",
          impression: "Diabetes Mellitus Type 2 (E11) — controlled/uncontrolled",
          advice: "Diabetic diet — avoid sugar, sweets, white rice, maida. Brisk walking 30 min daily.\nFasting & post-prandial blood sugar monthly. HbA1c every 3 months.\nFoot inspection daily. Ophthalmology review annually."
        },
        follow_up_days: 30
      },
      {
        id: "htn",
        name: "Hypertension",
        category: "Cardiology",
        fields: {
          history: "Known hypertensive, on medications. Presenting for follow-up. No headache, giddiness, chest pain, or breathlessness at rest.",
          examination: "BP: /  mmHg (bilateral arms). Pulse — regular. No pedal oedema. CVS — S1 S2 heard, no murmurs. Fundus — not done today.",
          impression: "Essential Hypertension (I10) — controlled/uncontrolled",
          advice: "Low-sodium diet. Restrict pickles, processed foods. Avoid stress. Regular BP monitoring at home.\nComplete medication compliance — do not skip doses."
        },
        follow_up_days: 30
      },
      {
        id: "urti",
        name: "Acute URTI",
        category: "General Medicine",
        fields: {
          history: "C/O fever since ___ days, sore throat, runny nose, body ache. No cough, no breathing difficulty. Appetite reduced.",
          examination: "Throat — congested, tonsils mildly enlarged. Bilateral nasal congestion. Chest clear. P/A — soft. Temperature — °F.",
          impression: "Acute Viral Upper Respiratory Tract Infection (J06.9)",
          advice: "Rest. Warm fluids. Steam inhalation twice daily. Saline nasal drops PRN.\nReturn immediately if fever > 5 days, difficulty breathing, or rash appears."
        },
        follow_up_days: 5
      },
      {
        id: "age",
        name: "Acute Gastroenteritis",
        category: "General Medicine",
        fields: {
          history: "C/O loose stools ___ times since ___ hours, nausea, vomiting ___ times. No blood in stools. Mild abdominal cramps. Appetite poor.",
          examination: "Dehydration — mild/moderate. P/A — soft, mild diffuse tenderness, no guarding/rigidity. BS — present.",
          impression: "Acute Gastroenteritis (K52.9)",
          advice: "ORS after every loose stool. Small frequent meals — rice, curd, banana, khichdi. Avoid spicy/oily food.\nReturn if unable to tolerate orally, persistent vomiting, or blood in stools."
        },
        follow_up_days: 3
      },
      {
        id: "ped_fever",
        name: "Paediatric Fever",
        category: "Paediatrics",
        fields: {
          history: "Child with fever since ___ days. Max recorded — °F. No rash, no fits. Feeding — adequate/reduced. Activity — playful/dull.",
          examination: "Temperature — °F. Alert & active. No rash. Throat — clear/congested. Chest — clear. P/A — soft. No signs of meningism.",
          impression: "Fever, likely viral aetiology (R50.9)",
          advice: "Paracetamol 15 mg/kg/dose 4-6 hourly if temp > 38°C. Sponging with lukewarm water.\nAdequate fluids. Light diet. Return if fits, rash, persistent vomiting, or no improvement in 72h."
        },
        follow_up_days: 3
      },
      {
        id: "hypothyroid",
        name: "Hypothyroidism",
        category: "Endocrinology",
        fields: {
          history: "Known case of hypothyroidism on T4 replacement. C/O fatigue, weight gain, cold intolerance.",
          examination: "No goitre. No pedal oedema. Pulse — bradycardia/normal. Reflexes — delayed/normal.",
          impression: "Hypothyroidism (E03.9) — on replacement therapy",
          advice: "Take levothyroxine on empty stomach 30 min before food. Avoid calcium/iron supplements within 4h of dose.\nTSH every 6 months when stable."
        },
        follow_up_days: 90
      },
      {
        id: "asthma",
        name: "Bronchial Asthma",
        category: "Pulmonology",
        fields: {
          history: "Known asthmatic. C/O wheeze, breathlessness since ___. Trigger — dust/cold/exercise/infection. Last attack — ___. Using reliever inhaler ___ times/day.",
          examination: "RR — /min. SpO2 — %. Air entry — bilateral, wheeze present/absent. No use of accessory muscles.",
          impression: "Bronchial Asthma (J45) — mild/moderate/severe exacerbation / well-controlled",
          advice: "Avoid triggers — dust, smoke, cold air. Use spacer with MDI. Peak flow monitoring.\nController inhaler must be used daily even when asymptomatic."
        },
        follow_up_days: 14
      },
      {
        id: "osteo",
        name: "Osteoarthritis Knee",
        category: "Orthopaedics",
        fields: {
          history: "C/O bilateral/unilateral knee pain since ___ months. Pain on walking, climbing stairs. Morning stiffness < 30 min. No swelling/locking/giving way.",
          examination: "Joint line tenderness present. Crepitus +++. Range of motion — restricted. McMurray/Lachman — negative. No effusion.",
          impression: "Osteoarthritis, Knee (M17)",
          advice: "Quadriceps strengthening exercises. Weight reduction. Avoid squatting, sitting on floor.\nHot fomentation. Knee brace if needed."
        },
        follow_up_days: 30
      },
      {
        id: "lbp",
        name: "Low Back Pain",
        category: "Orthopaedics",
        fields: {
          history: "C/O low back pain since ___ days/weeks. Radiates to ___. Aggravated by bending/lifting. No bladder/bowel involvement.",
          examination: "Lumbar spine — tenderness at L___. SLR — negative/positive at ___°. Muscle spasm present/absent. Neurological — intact.",
          impression: "Mechanical Low Back Pain (M54.5)",
          advice: "Bed rest 48h, then gradual mobilisation. Hot pack twice daily. Core strengthening exercises.\nAvoid lifting heavy weights, forward bending."
        },
        follow_up_days: 7
      },
      {
        id: "anxiety",
        name: "Anxiety Disorder",
        category: "Psychiatry",
        fields: {
          history: "C/O excessive worry, restlessness, palpitations, sleep disturbance since ___ months. No suicidal ideation. No substance use.",
          examination: "Alert, oriented. No psychomotor agitation. Affect appropriate. Insight — present.",
          impression: "Generalised Anxiety Disorder (F41.1)",
          advice: "Breathing exercises, mindfulness, progressive muscle relaxation. Sleep hygiene.\nLimit caffeine and screen time. Follow up as scheduled."
        },
        follow_up_days: 14
      }
    ];
    db2.prepare("INSERT INTO settings(key,value) VALUES('clinical_quick_templates', ?)").run(JSON.stringify(CLINICAL_TEMPLATES));
  }
}
let db = null;
function preMigrationSnapshotIfNeeded(userData, dbPath) {
  if (!fs.existsSync(dbPath)) return;
  let storedVersion = 0;
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = probe.prepare("SELECT value FROM schema_meta WHERE key='version'").get();
      storedVersion = row ? parseInt(row.value, 10) : 0;
    } catch {
      storedVersion = 0;
    } finally {
      probe.close();
    }
  } catch {
    return;
  }
  if (storedVersion >= SCHEMA_VERSION) return;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(userData, "backups", "pre-migration", `v${storedVersion}-to-v${SCHEMA_VERSION}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const sidecar of ["caredesk.sqlite", "caredesk.sqlite-wal", "caredesk.sqlite-shm"]) {
    const src = path.join(userData, sidecar);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(dir, sidecar));
      } catch {
      }
    }
  }
  try {
    fs.writeFileSync(
      path.join(dir, "README.txt"),
      `CureDesk HMS — pre-migration snapshot.

Taken automatically just before upgrading the database schema from
v${storedVersion} to v${SCHEMA_VERSION} on ${stamp}.

If something is wrong with the upgraded database, you can roll back by
closing the app and copying caredesk.sqlite from this folder back into
the app's userData folder (the .sqlite file lives next to this folder's
parent — usually %APPDATA%\\CureDesk HMS\\).
`
    );
  } catch {
  }
}
function getDb() {
  if (db) return db;
  const userData = electron.app.getPath("userData");
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, "caredesk.sqlite");
  preMigrationSnapshotIfNeeded(userData, dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  seedIfEmpty(db);
  return db;
}
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
function financialYear(date = /* @__PURE__ */ new Date()) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}
function dateKey(date = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}
function allocate(db2, scope) {
  if (!scope || typeof scope !== "string") {
    throw new Error(`ID allocation failed: scope must be a non-empty string, received ${JSON.stringify(scope)}`);
  }
  let row;
  try {
    row = db2.prepare(
      `INSERT INTO counters (scope, next_value, updated_at)
         VALUES (?, 1, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET
           next_value = next_value + 1,
           updated_at = datetime('now')
         RETURNING next_value`
    ).get(scope);
  } catch (err) {
    throw new Error(
      `ID allocation failed for scope "${scope}": ${(err == null ? void 0 : err.message) || String(err)}. The counters table may be missing — check that migrations ran.`
    );
  }
  if (!row || typeof row.next_value !== "number") {
    throw new Error(
      `ID allocation for scope "${scope}" returned no value. This usually means the counters table exists but RETURNING is unsupported by this SQLite build.`
    );
  }
  return row.next_value;
}
function nextUHID(db2, when = /* @__PURE__ */ new Date()) {
  const day = dateKey(when);
  const n = allocate(db2, `uhid:${day}`);
  return `PT-${day}-${String(n).padStart(4, "0")}`;
}
function nextBillNumber(db2, prefix = "INV", when = /* @__PURE__ */ new Date()) {
  const fy = financialYear(when);
  const n = allocate(db2, `bill:${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, "0")}`;
}
function nextIpNumber(db2, prefix = "IP", when = /* @__PURE__ */ new Date()) {
  const fy = financialYear(when);
  const n = allocate(db2, `ip:${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, "0")}`;
}
function nextVisitNumber(db2, patientId) {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error(`Visit number allocation failed: patientId must be a positive integer, received ${JSON.stringify(patientId)}`);
  }
  return allocate(db2, `visit:${patientId}`);
}
function formatVisitId(uhid, visitNumber) {
  if (!uhid) return "";
  return `${uhid}/V${visitNumber}`;
}
function normalizePhone$2(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}
function enqueueWaEvent(db2, trigger, opts) {
  const rules = db2.prepare(
    `SELECT r.account_id, r.template_name
     FROM wa_automation_rules r
     JOIN wa_accounts a ON a.id = r.account_id
     WHERE r.trigger = ? AND r.is_enabled = 1 AND a.status = 'connected'`
  ).all(trigger);
  if (rules.length === 0) return;
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  const toPhone = normalizePhone$2(opts.phone);
  for (const rule of rules) {
    const exists = db2.prepare(
      `SELECT 1 FROM wa_message_queue
       WHERE account_id=? AND patient_id=? AND template_name=? AND status IN ('pending','sent')
         AND date(scheduled_at)=date('now') LIMIT 1`
    ).get(rule.account_id, opts.patientId, rule.template_name);
    if (exists) continue;
    insert.run(
      rule.account_id,
      toPhone,
      opts.patientId,
      opts.appointmentId ?? null,
      rule.template_name,
      opts.vars ? JSON.stringify(opts.vars) : null
    );
  }
}
function getAllSettings(db2) {
  const rows = db2.prepare("SELECT key, value FROM settings").all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    clinic_name: map.clinic_name || "CureDesk HMS",
    clinic_address: map.clinic_address || "",
    clinic_phone: map.clinic_phone || "",
    clinic_email: map.clinic_email || "",
    clinic_tagline: map.clinic_tagline || "",
    clinic_registration_no: map.clinic_registration_no || "",
    clinic_logo: map.clinic_logo || "",
    slot_duration: parseInt(map.slot_duration || "30", 10),
    consultation_fee: parseInt(map.consultation_fee || "250", 10),
    special_price: parseInt(map.special_price || "150", 10),
    queue_flow_enabled: map.queue_flow_enabled === "true",
    // Default true to preserve existing behavior; users on a single-account
    // setup can hide this from Settings to declutter the sidebar.
    show_user_badge: map.show_user_badge !== "false",
    // Billing module is for the queue-flow workflow (Send to Billing → invoice).
    // For clinics that take payment upfront at registration it's mostly empty.
    // Default true for backward compat; toggle off in Settings to hide.
    show_billing_module: map.show_billing_module !== "false",
    // Patient Origin page is also covered by the consolidated Analytics tab.
    // Single-clinic users may want to hide the standalone entry.
    show_patient_origin: map.show_patient_origin !== "false",
    app_mode: map.app_mode || "reception_pharmacy_doctor",
    default_state: map.default_state || "",
    default_district: map.default_district || "",
    known_villages: map.known_villages || "",
    backup_folder: map.backup_folder || "",
    backup_reminder_time: map.backup_reminder_time || "21:00",
    usb_reminder_weekday: parseInt(map.usb_reminder_weekday || "1", 10),
    usb_reminder_time: map.usb_reminder_time || "09:30",
    auto_launch: map.auto_launch === "true",
    minimize_to_tray: map.minimize_to_tray !== "false",
    start_minimized: map.start_minimized === "true",
    keep_all_backups: map.keep_all_backups !== "false",
    auto_backup_enabled: map.auto_backup_enabled !== "false",
    auto_backup_frequency: map.auto_backup_frequency || "daily",
    auto_backup_time: map.auto_backup_time || "13:00",
    update_check_enabled: map.update_check_enabled !== "false",
    update_check_time: map.update_check_time || "10:30",
    admin_password: map.admin_password || "1234",
    sms_enabled: map.sms_enabled === "true",
    whatsapp_enabled: map.whatsapp_enabled === "true",
    sms_provider: map.sms_provider || null,
    sms_account_sid: map.sms_account_sid || null,
    sms_auth_token: map.sms_auth_token || null,
    sms_from_number: map.sms_from_number || null,
    whatsapp_api_url: map.whatsapp_api_url || null,
    whatsapp_api_key: map.whatsapp_api_key || null,
    whatsapp_template: map.whatsapp_template || "Namaste {{patient_name}} 🙏\n\nYour appointment at *{{clinic_name}}* is confirmed.\n\n👨‍⚕️ *Doctor:* {{doctor_name}}\n🚪 *Room:* {{room}}\n📅 *Date:* {{date}}    🕒 *Time:* {{time}}\n🎟️ *Token:* #{{token}}\n\n🆔 *Patient ID (UHID):* {{uhid}}\n📋 *Visit ID:* {{visit_id}}\n\n📍 {{clinic_address}}\n☎️ {{clinic_phone}}\n\nPlease arrive 10 minutes early. For any change, simply reply to this message or call us.\n\nThank you,\n*{{clinic_name}}*",
    whatsapp_country_code: map.whatsapp_country_code || "91",
    appointments_default_sort: map.appointments_default_sort || "oldest_first",
    followup_enabled: map.followup_enabled !== "false",
    followup_window_days: parseInt(map.followup_window_days || "7", 10),
    followup_free_visits: parseInt(map.followup_free_visits || "2", 10),
    followup_grace_days: parseInt(map.followup_grace_days || "2", 10),
    registration_fee_enabled: map.registration_fee_enabled !== "false",
    registration_fee_amount: parseInt(map.registration_fee_amount || "100", 10),
    registration_fee_default_timing: map.registration_fee_default_timing || "ask",
    misc_services: map.misc_services || "Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other",
    network_mode: map.network_mode || "local",
    network_listen_port: parseInt(map.network_listen_port || "4321", 10),
    network_server_url: map.network_server_url || "",
    network_secret: map.network_secret || "",
    // Pinned adapter IP for Server mode. Empty = auto-pick (wired preferred).
    network_bind_ip: map.network_bind_ip || "",
    station_name: map.station_name || "",
    qr1_img: map.qr1_img || "",
    qr1_label: map.qr1_label || "Scan to Pay / Review",
    qr2_img: map.qr2_img || "",
    qr2_label: map.qr2_label || "Scan to Pay / Review",
    anthropic_api_key: map.anthropic_api_key || "",
    google_review_url: map.google_review_url || ""
  };
}
function saveSettings(db2, patch) {
  const upsert = db2.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db2.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === void 0) continue;
      upsert.run(k, typeof v === "boolean" ? String(v) : v === null ? "" : String(v));
    }
  });
  tx();
}
const ipcHandlers = /* @__PURE__ */ new Map();
let monkeyPatched = false;
let originalHandle = null;
function installIpcRegistry() {
  if (monkeyPatched) return;
  monkeyPatched = true;
  originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
  electron.ipcMain.handle = (channel, handler) => {
    ipcHandlers.set(channel, handler);
    return originalHandle(channel, handler);
  };
}
function rawHandle(channel, handler) {
  if (!originalHandle) throw new Error("IPC registry not installed yet");
  originalHandle(channel, handler);
}
function classify(name) {
  const n = name.toLowerCase();
  if (/(wi-?fi|wlan|wl[po]|airport|wireless|802\.11)/.test(n)) return "wireless";
  if (/(ethernet|eth\d|en[opsx]?\d|local area connection|lan|thunderbolt bridge|usb.*lan|realtek|intel\(r\) ethernet)/.test(n)) return "wired";
  if (/^en\d+$/.test(n)) return "other";
  return "other";
}
function scoreOf(kind, address) {
  let s = kind === "wired" ? 100 : kind === "other" ? 50 : 10;
  if (/^192\.168\./.test(address)) s += 5;
  else if (/^10\./.test(address)) s += 4;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 3;
  if (/^169\.254\./.test(address)) s -= 200;
  return s;
}
function listNetworkInterfaces() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, infos] of Object.entries(nets)) {
    for (const info of infos || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (/(virtual|vmware|hyper-?v|loopback|docker|vethernet|vbox|tailscale|zerotier|utun|tun\d|tap\d)/i.test(name)) continue;
      const kind = classify(name);
      out.push({
        name,
        address: info.address,
        netmask: info.netmask,
        cidr: info.cidr ?? null,
        kind,
        score: scoreOf(kind, info.address)
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}
function broadcastAddressFor(address, netmask) {
  const a = address.split(".").map(Number);
  const m = netmask.split(".").map(Number);
  if (a.length !== 4 || m.length !== 4 || a.some(isNaN) || m.some(isNaN)) return null;
  return a.map((oct, i) => oct & m[i] | ~m[i] & 255).join(".");
}
function tcpProbe(host, port, timeoutMs = 4e3) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = new net.Socket();
    let settled = false;
    const done = (ok, error) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
      }
      resolve({ ok, ms: Date.now() - started, error });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false, "Timed out — no response from that IP/port"));
    sock.once("error", (e) => done(false, (e == null ? void 0 : e.code) || (e == null ? void 0 : e.message) || "Connection failed"));
    try {
      sock.connect(port, host);
    } catch (e) {
      done(false, (e == null ? void 0 : e.message) || "connect() threw");
    }
  });
}
async function runDiagnostics(serverUrl, secret) {
  const steps = [];
  const interfaces = listNetworkInterfaces();
  const push = (s) => {
    steps.push(s);
    return s.ok;
  };
  let url = null;
  try {
    url = new URL((serverUrl || "").trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("Not an http(s) URL");
    push({
      id: "config",
      label: "Server address is valid",
      ok: true,
      detail: `${url.protocol}//${url.hostname}:${url.port || "80"}`
    });
  } catch (e) {
    push({
      id: "config",
      label: "Server address is valid",
      ok: false,
      detail: serverUrl ? `Could not parse "${serverUrl}"` : "No server address configured",
      hint: "Set the host PC address as http://<host-ip>:4321 — for example http://192.168.1.5:4321. Use the join code flow to fill this in automatically."
    });
    return { ok: false, ranAt: (/* @__PURE__ */ new Date()).toISOString(), target: serverUrl, steps, interfaces };
  }
  const usable = interfaces.filter((i) => !/^169\.254\./.test(i.address));
  if (usable.length === 0) {
    push({
      id: "adapter",
      label: "This PC has a network connection",
      ok: false,
      detail: interfaces.length ? "Only self-assigned (169.254.x.x) addresses found" : "No active network adapter found",
      hint: "Plug in the network cable or connect to the clinic Wi-Fi. A 169.254.x.x address means the router did not hand out an IP — check the cable and the router."
    });
  } else {
    const best = usable[0];
    push({
      id: "adapter",
      label: "This PC has a network connection",
      ok: true,
      detail: `${best.name} · ${best.address}${best.kind !== "other" ? ` (${best.kind})` : ""}${usable.length > 1 ? ` · +${usable.length - 1} more` : ""}`
    });
  }
  const host = url.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIp && usable.length > 0) {
    const sameSubnet = usable.some((i) => {
      const bcast = broadcastAddressFor(i.address, i.netmask);
      const hostBcast = broadcastAddressFor(host, i.netmask);
      return bcast !== null && bcast === hostBcast;
    });
    push({
      id: "subnet",
      label: "Host PC is on the same network as this PC",
      ok: sameSubnet,
      detail: sameSubnet ? `${host} is reachable from ${usable[0].address}` : `${host} is not in the same range as ${usable.map((i) => i.address).join(", ")}`,
      hint: sameSubnet ? void 0 : "The two PCs are on different networks. Common cause: one is on Wi-Fi and the other is on the wired LAN, and the router keeps them separate (guest network or AP isolation). Put both on the same router/switch, or plug both into the same wired switch."
    });
  }
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  const tcp = await tcpProbe(host, port);
  push({
    id: "tcp",
    label: `Port ${port} is open on the host PC`,
    ok: tcp.ok,
    detail: tcp.ok ? `Connected in ${tcp.ms} ms` : tcp.error || "Could not connect",
    ms: tcp.ms,
    hint: tcp.ok ? void 0 : 'The host PC is not accepting connections on this port. Check: (1) CureDesk is actually running on the host and set to Server mode, (2) Windows Firewall is allowing the port — re-run "Allow through firewall" on the host, (3) the IP address has not changed (DHCP may have given the host a new one — re-pair with a fresh join code).'
  });
  let healthOk = false;
  if (tcp.ok) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5e3);
      const res = await fetch(`${url.origin}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body = res.ok ? await res.json().catch(() => null) : null;
      healthOk = res.ok && (body == null ? void 0 : body.ok) === true;
      push({
        id: "health",
        label: "CureDesk server is responding",
        ok: healthOk,
        detail: healthOk ? `v${body.version} · ${body.clients} client(s) connected · ${body.ipcChannels} channels` : `HTTP ${res.status} ${res.statusText}`,
        ms: Date.now() - t0,
        hint: healthOk ? void 0 : `Something is listening on that port but it is not CureDesk. Check the port number matches the host's "Listen port" setting (default 4321).`
      });
    } catch (e) {
      push({
        id: "health",
        label: "CureDesk server is responding",
        ok: false,
        detail: (e == null ? void 0 : e.name) === "AbortError" ? "Timed out after 5s" : (e == null ? void 0 : e.message) || String(e),
        hint: "The port is open but CureDesk did not answer. Restart CureDesk on the host PC."
      });
    }
  } else {
    push({ id: "health", label: "CureDesk server is responding", ok: false, detail: "Skipped — port not reachable" });
  }
  if (healthOk) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${url.origin}/ipc/settings:get`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...secret ? { Authorization: `Bearer ${secret}` } : {} },
        body: JSON.stringify({ args: [] })
      });
      const ok2 = res.status !== 401;
      push({
        id: "auth",
        label: "Access token accepted",
        ok: ok2,
        detail: ok2 ? "Token verified by host" : "Host rejected the token (HTTP 401)",
        ms: Date.now() - t0,
        hint: ok2 ? void 0 : `This PC's saved token no longer matches the host. Click "Forget this server" below and re-pair using a fresh join code from the host PC (Settings → Network Mode → join code panel).`
      });
    } catch (e) {
      push({ id: "auth", label: "Access token accepted", ok: false, detail: (e == null ? void 0 : e.message) || String(e) });
    }
  } else {
    push({ id: "auth", label: "Access token accepted", ok: false, detail: "Skipped — server not responding" });
  }
  const ok = steps.every((s) => s.ok);
  return { ok, ranAt: (/* @__PURE__ */ new Date()).toISOString(), target: url.origin, steps, interfaces };
}
let httpServer = null;
let wss = null;
let activePort = 0;
let activeSecret = "";
let activeVersion = "";
let preferredIp = "";
const wsClients = /* @__PURE__ */ new Set();
function setPreferredIp(ip) {
  preferredIp = (ip || "").trim();
}
let joinCode = null;
const JOIN_CODE_TTL_MS = 10 * 60 * 1e3;
const JOIN_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genJoinCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += JOIN_CODE_CHARS[crypto$1.randomInt(JOIN_CODE_CHARS.length)];
  return s;
}
function regenerateJoinCode(secret, port) {
  const code = genJoinCode();
  joinCode = { code, secret, port, expiresAt: Date.now() + JOIN_CODE_TTL_MS };
  return { code, expiresAt: joinCode.expiresAt };
}
function getJoinCode() {
  if (!joinCode) return null;
  if (Date.now() > joinCode.expiresAt) {
    joinCode = null;
    return null;
  }
  return { code: joinCode.code, expiresAt: joinCode.expiresAt };
}
const UDP_PORT$1 = 4322;
let udpSocket = null;
let udpTimer = null;
function getLocalLanIP() {
  var _a;
  const ifaces = listNetworkInterfaces();
  if (preferredIp && ifaces.some((i) => i.address === preferredIp)) return preferredIp;
  return ((_a = ifaces[0]) == null ? void 0 : _a.address) || null;
}
function startUdpBroadcast() {
  if (udpSocket) return;
  try {
    const sock = dgram.createSocket("udp4");
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
      } catch {
      }
      const send = () => {
        if (!httpServer) return;
        const ip = getLocalLanIP();
        const payload = JSON.stringify({
          product: "CureDesk HMS",
          version: activeVersion,
          ip,
          port: activePort,
          ts: Date.now()
        });
        const targets = /* @__PURE__ */ new Set(["255.255.255.255"]);
        for (const iface of listNetworkInterfaces()) {
          const b = broadcastAddressFor(iface.address, iface.netmask);
          if (b) targets.add(b);
        }
        for (const t of targets) {
          try {
            sock.send(payload, UDP_PORT$1, t);
          } catch {
          }
        }
      };
      send();
      udpTimer = setInterval(send, 5e3);
    });
    udpSocket = sock;
  } catch {
  }
}
function stopUdpBroadcast() {
  if (udpTimer) {
    clearInterval(udpTimer);
    udpTimer = null;
  }
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch {
    }
    udpSocket = null;
  }
}
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json)
  });
  res.end(json);
}
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const MAX = 50 * 1024 * 1024;
    req.on("data", (c) => {
      chunks.push(c);
      total += c.length;
      if (total > MAX) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
async function stopNetworkServer() {
  stopUdpBroadcast();
  joinCode = null;
  if (wss) {
    try {
      wss.clients.forEach((c) => c.terminate());
    } catch {
    }
    try {
      wss.close();
    } catch {
    }
    wss = null;
  }
  if (httpServer) {
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
    }).catch(() => {
    });
    httpServer = null;
  }
  wsClients.clear();
  activePort = 0;
  activeSecret = "";
}
async function startNetworkServer(port, secret, appVersion) {
  await stopNetworkServer();
  try {
    activeSecret = secret || "";
    activeVersion = appVersion;
    httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      const method = req.method || "GET";
      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          product: "CureDesk HMS",
          version: appVersion,
          mode: "server",
          clients: wsClients.size,
          ipcChannels: ipcHandlers.size,
          time: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (method === "GET" && url.pathname === "/api/info") {
        return sendJson(res, 200, {
          product: "CureDesk HMS",
          version: appVersion,
          port: activePort,
          ip: getLocalLanIP(),
          clients: wsClients.size
        });
      }
      if (method === "POST" && url.pathname === "/api/pair") {
        try {
          const body = await readJsonBody(req);
          const raw = String((body == null ? void 0 : body.code) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (!joinCode) return sendJson(res, 401, { ok: false, error: "Pairing not active" });
          if (Date.now() > joinCode.expiresAt) {
            joinCode = null;
            return sendJson(res, 401, { ok: false, error: "Join code expired — generate a new one on the host PC" });
          }
          if (raw !== joinCode.code) return sendJson(res, 401, { ok: false, error: "Invalid join code" });
          return sendJson(res, 200, {
            ok: true,
            secret: joinCode.secret,
            port: joinCode.port,
            product: "CureDesk HMS",
            version: appVersion
          });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: (err == null ? void 0 : err.message) || "Bad request" });
        }
      }
      if (method === "POST" && url.pathname.startsWith("/ipc/")) {
        if (activeSecret) {
          const auth = req.headers["authorization"] || "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
          if (token !== activeSecret) {
            return sendJson(res, 401, { ok: false, error: "Invalid or missing token" });
          }
        }
        const channel = decodeURIComponent(url.pathname.slice("/ipc/".length));
        const handler = ipcHandlers.get(channel);
        if (!handler) return sendJson(res, 404, { ok: false, error: `Unknown IPC channel: ${channel}` });
        try {
          const body = await readJsonBody(req);
          const args = Array.isArray(body == null ? void 0 : body.args) ? body.args : [];
          const fakeEvent = { sender: { send: () => {
          } } };
          const result = await handler(fakeEvent, ...args);
          return sendJson(res, 200, { ok: true, result });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: (err == null ? void 0 : err.message) || String(err) });
        }
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    });
    wss = new ws.WebSocketServer({ server: httpServer, path: "/ws" });
    wss.on("connection", (ws2, req) => {
      const url = new URL(req.url || "/ws", "http://localhost");
      const token = url.searchParams.get("token") || "";
      if (activeSecret && token !== activeSecret) {
        ws2.close(4401, "unauthorized");
        return;
      }
      wsClients.add(ws2);
      try {
        ws2.send(JSON.stringify({ event: "hello", payload: { product: "CureDesk HMS", version: appVersion, ts: Date.now() } }));
      } catch {
      }
      ws2.on("close", () => wsClients.delete(ws2));
      ws2.on("error", () => wsClients.delete(ws2));
    });
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, () => resolve());
    });
    activePort = port;
    regenerateJoinCode(secret || "", port);
    startUdpBroadcast();
    return { ok: true, port };
  } catch (err) {
    await stopNetworkServer();
    return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
  }
}
function broadcastEvent(event, payload) {
  if (!wss || wsClients.size === 0) return;
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  wsClients.forEach((c) => {
    try {
      if (c.readyState === c.OPEN) c.send(msg);
    } catch {
    }
  });
}
function networkServerStatus() {
  return {
    running: httpServer !== null,
    port: activePort,
    clients: wsClients.size,
    ipcChannels: ipcHandlers.size
  };
}
class NotificationService {
  constructor(db2) {
    this.db = db2;
  }
  config() {
    const s = getAllSettings(this.db);
    return {
      smsEnabled: s.sms_enabled,
      whatsappEnabled: s.whatsapp_enabled,
      provider: s.sms_provider || null
    };
  }
  logToDb(patient_id, type, message, status = "pending") {
    this.db.prepare(
      "INSERT INTO notification_log (patient_id, type, message, status, sent_at) VALUES (?, ?, ?, ?, ?)"
    ).run(patient_id, type, message, status, status === "sent" ? (/* @__PURE__ */ new Date()).toISOString() : null);
  }
  sendAppointmentConfirmation(patient, appointment, doctor, clinicName = "CureDesk HMS") {
    const name = `${patient.first_name} ${patient.last_name}`.trim();
    const message = `Dear ${name}, your appointment with ${doctor.name} at ${clinicName} is confirmed for ${appointment.appointment_date} at ${appointment.appointment_time}. Token: #${appointment.token_number}`;
    const cfg = this.config();
    if (cfg.smsEnabled || cfg.whatsappEnabled) {
      this.logToDb(patient.id, cfg.whatsappEnabled ? "patient_whatsapp" : "patient_sms", message, "pending");
    } else {
      this.logToDb(patient.id, "patient_sms", message, "pending");
    }
  }
  sendDoctorAlert(doctor, appointment, patient) {
    const pname = `${patient.first_name} ${patient.last_name}`.trim();
    const message = `New patient ${pname} (Token #${appointment.token_number}) scheduled with you at ${appointment.appointment_time} today.`;
    this.logToDb(null, "doctor_sms", message, "pending");
  }
}
function hash(password, salt) {
  return crypto$1.scryptSync(password, salt, 32).toString("hex");
}
function createUser(db2, input) {
  const salt = crypto$1.randomBytes(16).toString("hex");
  const password_hash = hash(input.password, salt);
  const info = db2.prepare(
    "INSERT INTO users (username, password_hash, salt, role, display_name, doctor_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)"
  ).run(input.username.trim().toLowerCase(), password_hash, salt, input.role, input.display_name ?? null, input.doctor_id ?? null);
  const row = db2.prepare("SELECT id, username, role, display_name, doctor_id FROM users WHERE id=?").get(info.lastInsertRowid);
  return row;
}
function verifyLogin(db2, username, password) {
  const row = db2.prepare("SELECT * FROM users WHERE username=? AND is_active=1").get(username.trim().toLowerCase());
  if (!row) return null;
  const calc = hash(password, row.salt);
  if (!crypto$1.timingSafeEqual(Buffer.from(calc), Buffer.from(row.password_hash))) return null;
  db2.prepare('UPDATE users SET last_login_at = datetime("now") WHERE id=?').run(row.id);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    display_name: row.display_name,
    doctor_id: row.doctor_id,
    must_change_password: Boolean(row.must_change_password)
  };
}
function ensureDefaultAdmin(db2) {
  const count = db2.prepare("SELECT COUNT(*) as c FROM users").get();
  if (count.c === 0) {
    const u = createUser(db2, { username: "admin", password: "admin123", role: "admin", display_name: "Administrator" });
    db2.prepare("UPDATE users SET must_change_password=1 WHERE id=?").run(u.id);
  }
}
function changePassword(db2, userId, newPassword) {
  const salt = crypto$1.randomBytes(16).toString("hex");
  const password_hash = hash(newPassword, salt);
  db2.prepare("UPDATE users SET password_hash=?, salt=?, must_change_password=0 WHERE id=?").run(password_hash, salt, userId);
}
function listUsers(db2) {
  return db2.prepare("SELECT id, username, role, display_name, doctor_id, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC").all();
}
function updateUser(db2, id, patch) {
  const fields = [];
  const params = [];
  if (patch.role) {
    fields.push("role=?");
    params.push(patch.role);
  }
  if (patch.display_name !== void 0) {
    fields.push("display_name=?");
    params.push(patch.display_name);
  }
  if (patch.doctor_id !== void 0) {
    fields.push("doctor_id=?");
    params.push(patch.doctor_id);
  }
  if (patch.is_active !== void 0) {
    fields.push("is_active=?");
    params.push(patch.is_active);
  }
  if (fields.length === 0) return;
  params.push(id);
  db2.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id=?`).run(...params);
}
function logAudit(db2, user, action, entity, entity_id, details) {
  db2.prepare(
    "INSERT INTO audit_log (user_id, username, role, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run((user == null ? void 0 : user.id) ?? null, (user == null ? void 0 : user.username) ?? null, (user == null ? void 0 : user.role) ?? null, action, entity ?? null, entity_id ?? null, details ?? null);
}
function listAudit(db2, limit = 500) {
  return db2.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT ?").all(limit);
}
let _performBackupToRoot = null;
function runFullBackup(root, label = "backup") {
  if (!_performBackupToRoot) throw new Error("Backup service not yet initialized — call after registerIpc()");
  return _performBackupToRoot(root, label);
}
function isBackupServiceReady() {
  return _performBackupToRoot !== null;
}
function todayISO() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function pad(n, w) {
  return String(n).padStart(w, "0");
}
function generateUHID() {
  return nextUHID(getDb());
}
function generateBillNumber() {
  return nextBillNumber(getDb());
}
function hashAdminPassword(password) {
  const salt = crypto$1.randomBytes(16).toString("hex");
  const h = crypto$1.scryptSync(password, salt, 32).toString("hex");
  return `$scrypt$${salt}$${h}`;
}
function verifyAdminPassword(input, stored) {
  if (stored.startsWith("$scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const [, , salt, storedHash] = parts;
    try {
      const calc = crypto$1.scryptSync(input, salt, 32).toString("hex");
      return crypto$1.timingSafeEqual(Buffer.from(calc), Buffer.from(storedHash));
    } catch {
      return false;
    }
  }
  if (input.length !== stored.length) return false;
  const a = Buffer.alloc(stored.length);
  const b = Buffer.alloc(stored.length);
  Buffer.from(input).copy(a);
  Buffer.from(stored).copy(b);
  return crypto$1.timingSafeEqual(a, b);
}
const authFailures = /* @__PURE__ */ new Map();
function checkRateLimit(key) {
  const s = authFailures.get(key);
  return !s || Date.now() >= s.blockedUntil;
}
function recordAuthFailure(key) {
  const now = Date.now();
  const s = authFailures.get(key) ?? { count: 0, blockedUntil: 0 };
  if (now >= s.blockedUntil) s.count = 0;
  s.count++;
  const delays = [0, 0, 1e4, 3e4, 12e4, 3e5, 9e5];
  s.blockedUntil = now + (delays[Math.min(s.count, delays.length - 1)] ?? 9e5);
  authFailures.set(key, s);
}
function clearAuthFailures(key) {
  authFailures.delete(key);
}
function registerIpc() {
  ensureDefaultAdmin(getDb());
  electron.ipcMain.handle("auth:login", (_e, username, password) => {
    const key = `login:${(username || "").toLowerCase().slice(0, 64)}`;
    if (!checkRateLimit(key)) return null;
    const db2 = getDb();
    const user = verifyLogin(db2, username, password);
    if (user) {
      clearAuthFailures(key);
      logAudit(db2, user, "login");
      return user;
    }
    recordAuthFailure(key);
    return null;
  });
  electron.ipcMain.handle("auth:createUser", (_e, input) => {
    const db2 = getDb();
    const u = createUser(db2, input);
    logAudit(db2, null, "user_created", "users", u.id, `role=${input.role}`);
    return u;
  });
  electron.ipcMain.handle("auth:changePassword", (_e, userId, newPassword) => {
    const db2 = getDb();
    changePassword(db2, userId, newPassword);
    logAudit(db2, null, "password_changed", "users", userId);
    return true;
  });
  electron.ipcMain.handle("auth:listUsers", () => listUsers(getDb()));
  electron.ipcMain.handle("auth:updateUser", (_e, id, patch) => {
    const db2 = getDb();
    updateUser(db2, id, patch);
    logAudit(db2, null, "user_updated", "users", id, JSON.stringify(patch));
    return listUsers(db2);
  });
  electron.ipcMain.handle("auth:verifyAdminPassword", (_e, password) => {
    if (!checkRateLimit("admin_unlock")) return false;
    const db2 = getDb();
    const settings = getAllSettings(db2);
    const input = password || "";
    const stored = settings.admin_password || "1234";
    const ok = verifyAdminPassword(input, stored);
    if (ok) {
      clearAuthFailures("admin_unlock");
      if (!stored.startsWith("$scrypt$")) {
        saveSettings(db2, { admin_password: hashAdminPassword(input) });
      }
    } else {
      recordAuthFailure("admin_unlock");
    }
    logAudit(db2, null, ok ? "admin_unlock" : "admin_unlock_failed");
    return ok;
  });
  electron.ipcMain.handle("auth:isDefaultAdminPassword", () => {
    const settings = getAllSettings(getDb());
    const stored = (settings.admin_password || "").trim();
    return stored === "" || stored === "1234" || stored === "1918";
  });
  electron.ipcMain.handle("auth:changeAdminPassword", (_e, currentPassword, newPassword) => {
    const db2 = getDb();
    const settings = getAllSettings(db2);
    const stored = settings.admin_password || "1234";
    if (!verifyAdminPassword(currentPassword || "", stored)) {
      return { ok: false, error: "Current password incorrect" };
    }
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters" };
    }
    saveSettings(db2, { admin_password: hashAdminPassword(newPassword) });
    logAudit(db2, null, "admin_password_changed");
    return { ok: true };
  });
  electron.ipcMain.handle("audit:list", (_e, limit) => listAudit(getDb(), limit ?? 500));
  electron.ipcMain.handle("admin:resetAuditLog", (_e, confirmPhrase, adminPassword) => {
    if (confirmPhrase !== "iknowwhatiamdoing") {
      return { ok: false, error: "Confirmation phrase required" };
    }
    const db2 = getDb();
    const settings = getAllSettings(db2);
    const stored = settings.admin_password || "1234";
    if (!adminPassword || !verifyAdminPassword(adminPassword, stored)) {
      return { ok: false, error: "Admin password required" };
    }
    const count = db2.prepare("SELECT COUNT(*) as c FROM audit_log").get().c;
    db2.exec("DELETE FROM audit_log");
    logAudit(db2, null, "audit_log_reset", "audit_log", void 0, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });
  electron.ipcMain.handle("admin:resetNotificationLog", (_e, confirmPhrase) => {
    if (confirmPhrase !== "iknowwhatiamdoing") {
      return { ok: false, error: "Confirmation phrase required" };
    }
    const db2 = getDb();
    const count = db2.prepare("SELECT COUNT(*) as c FROM notification_log").get().c;
    db2.exec("DELETE FROM notification_log");
    logAudit(db2, null, "notification_log_reset", "notification_log", void 0, `Cleared ${count} entries`);
    return { ok: true, deleted: count };
  });
  const purgePatient = (db2, id) => {
    db2.prepare("DELETE FROM dispensing_register WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)").run(id);
    db2.prepare("DELETE FROM bills WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE patient_id = ?)").run(id);
    db2.prepare("DELETE FROM lab_orders WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM pharmacy_sale_items WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE patient_id = ?)").run(id);
    db2.prepare("DELETE FROM pharmacy_sales WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM ip_admissions WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM consultations WHERE patient_id = ?").run(id);
    db2.prepare("DELETE FROM patients WHERE id = ?").run(id);
  };
  electron.ipcMain.handle("admin:deletePatient", (_e, patientId) => {
    const db2 = getDb();
    const p = db2.prepare("SELECT uhid, first_name, last_name FROM patients WHERE id=?").get(patientId);
    if (!p) return { ok: false, error: "Patient not found" };
    const tx = db2.transaction(() => purgePatient(db2, patientId));
    try {
      tx();
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || "Delete failed" };
    }
    logAudit(db2, null, "patient_deleted", "patients", patientId, `${p.uhid} ${p.first_name} ${p.last_name}`);
    return { ok: true, patient: p };
  });
  electron.ipcMain.handle("admin:deleteAppointment", (_e, appointmentId) => {
    const db2 = getDb();
    const a = db2.prepare(
      `SELECT a.id, a.token_number, a.appointment_date, a.appointment_time,
                (p.first_name || ' ' || p.last_name) as patient_name, p.uhid
         FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=?`
    ).get(appointmentId);
    if (!a) return { ok: false, error: "Appointment not found" };
    const tx = db2.transaction(() => {
      db2.prepare("DELETE FROM dispensing_register WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)").run(appointmentId);
      db2.prepare("DELETE FROM bills WHERE appointment_id = ?").run(appointmentId);
      db2.prepare("DELETE FROM lab_order_items WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE appointment_id = ?)").run(appointmentId);
      db2.prepare("DELETE FROM lab_orders WHERE appointment_id = ?").run(appointmentId);
      db2.prepare("DELETE FROM pharmacy_sale_items WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE appointment_id = ?)").run(appointmentId);
      db2.prepare("DELETE FROM pharmacy_sales WHERE appointment_id = ?").run(appointmentId);
      db2.prepare("DELETE FROM appointments WHERE id = ?").run(appointmentId);
    });
    try {
      tx();
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || "Delete failed" };
    }
    logAudit(db2, null, "appointment_deleted", "appointments", appointmentId, `Token #${a.token_number} · ${a.uhid} ${a.patient_name} · ${a.appointment_date} ${a.appointment_time}`);
    return { ok: true, appointment: a };
  });
  electron.ipcMain.handle("admin:deletePatients", (_e, patientIds) => {
    const db2 = getDb();
    if (!Array.isArray(patientIds) || patientIds.length === 0) return { ok: true, deleted: 0 };
    const sel = db2.prepare("SELECT uhid, first_name, last_name FROM patients WHERE id=?");
    const tx = db2.transaction((ids) => {
      let count = 0;
      const audits = [];
      for (const id of ids) {
        const p = sel.get(id);
        if (!p) continue;
        purgePatient(db2, id);
        audits.push({ id, label: `${p.uhid} ${p.first_name} ${p.last_name}` });
        count++;
      }
      for (const a of audits) logAudit(db2, null, "patient_deleted", "patients", a.id, a.label);
      return count;
    });
    try {
      const deleted = tx(patientIds);
      return { ok: true, deleted };
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || "Bulk delete failed" };
    }
  });
  electron.ipcMain.handle("audit:log", (_e, user, action, entity, entity_id, details) => {
    logAudit(getDb(), user, action, entity, entity_id, details);
  });
  electron.ipcMain.handle("patients:search", (_e, q) => {
    const db2 = getDb();
    const like = `%${q.trim()}%`;
    if (!q.trim()) {
      return db2.prepare(
        "SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit FROM patients p ORDER BY created_at DESC LIMIT 50"
      ).all();
    }
    return db2.prepare(
      `SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit
         FROM patients p
         WHERE p.uhid LIKE ? OR p.phone LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ?
         ORDER BY created_at DESC LIMIT 50`
    ).all(like, like, like);
  });
  electron.ipcMain.handle("patients:get", (_e, id) => {
    return getDb().prepare("SELECT * FROM patients WHERE id=?").get(id);
  });
  electron.ipcMain.handle("patients:create", (_e, input) => {
    var _a, _b, _c, _d;
    const db2 = getDb();
    const uhid = generateUHID();
    const stmt = db2.prepare(
      `INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state, profession)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uhid,
      input.first_name.trim(),
      (input.last_name || "").trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      ((_a = input.place) == null ? void 0 : _a.trim()) || null,
      ((_b = input.district) == null ? void 0 : _b.trim()) || null,
      ((_c = input.state) == null ? void 0 : _c.trim()) || null,
      ((_d = input.profession) == null ? void 0 : _d.trim()) || null
    );
    return db2.prepare("SELECT * FROM patients WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("patients:update", (_e, id, input) => {
    var _a, _b, _c, _d;
    const db2 = getDb();
    db2.prepare(
      `UPDATE patients SET first_name=?, last_name=?, dob=?, gender=?, phone=?, email=?, address=?, blood_group=?, place=?, district=?, state=?, profession=? WHERE id=?`
    ).run(
      input.first_name.trim(),
      (input.last_name || "").trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      ((_a = input.place) == null ? void 0 : _a.trim()) || null,
      ((_b = input.district) == null ? void 0 : _b.trim()) || null,
      ((_c = input.state) == null ? void 0 : _c.trim()) || null,
      ((_d = input.profession) == null ? void 0 : _d.trim()) || null,
      id
    );
    return db2.prepare("SELECT * FROM patients WHERE id=?").get(id);
  });
  electron.ipcMain.handle("patients:knownPlaces", () => {
    const db2 = getDb();
    const places = db2.prepare("SELECT DISTINCT place FROM patients WHERE place IS NOT NULL AND place <> '' ORDER BY place").all();
    const districts = db2.prepare("SELECT DISTINCT district FROM patients WHERE district IS NOT NULL AND district <> '' ORDER BY district").all();
    return {
      places: places.map((r) => r.place),
      districts: districts.map((r) => r.district)
    };
  });
  electron.ipcMain.handle("patients:recentAppointments", (_e, patientId, limit = 5) => {
    return getDb().prepare(
      `SELECT a.*, d.name as doctor_name, d.specialty as doctor_specialty
         FROM appointments a JOIN doctors d ON d.id=a.doctor_id
         WHERE a.patient_id=? ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ?`
    ).all(patientId, limit);
  });
  electron.ipcMain.handle("doctors:list", (_e, activeOnly = true) => {
    const db2 = getDb();
    return activeOnly ? db2.prepare("SELECT * FROM doctors WHERE is_active=1 ORDER BY name").all() : db2.prepare("SELECT * FROM doctors ORDER BY is_active DESC, name").all();
  });
  electron.ipcMain.handle("doctors:get", (_e, id) => {
    return getDb().prepare("SELECT * FROM doctors WHERE id=?").get(id);
  });
  electron.ipcMain.handle("doctors:create", (_e, d) => {
    const db2 = getDb();
    const info = db2.prepare(
      "INSERT INTO doctors (name, specialty, phone, email, room_number, is_active, default_fee, signature, qualifications, registration_no, color, available_from, available_to, template_id, template_id_2, template_id_3, template_slot_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      d.name ?? "",
      d.specialty ?? "",
      d.phone ?? null,
      d.email ?? null,
      d.room_number ?? null,
      d.is_active ?? 1,
      d.default_fee ?? 500,
      d.signature ?? null,
      d.qualifications ?? null,
      d.registration_no ?? null,
      d.color ?? null,
      d.available_from || null,
      d.available_to || null,
      d.template_id ?? null,
      d.template_id_2 ?? null,
      d.template_id_3 ?? null,
      d.template_slot_names ?? null
    );
    return db2.prepare("SELECT * FROM doctors WHERE id=?").get(info.lastInsertRowid);
  });
  const countDoctorRefs = (db2, id) => {
    const c = (sql) => db2.prepare(sql).get(id).c;
    return {
      appointments: c("SELECT COUNT(*) as c FROM appointments WHERE doctor_id=?"),
      consultations: c("SELECT COUNT(*) as c FROM consultations WHERE doctor_id=?"),
      lab_orders: c("SELECT COUNT(*) as c FROM lab_orders WHERE doctor_id=?"),
      ip_admissions: c("SELECT COUNT(*) as c FROM ip_admissions WHERE admission_doctor_id=?"),
      dispensed: c("SELECT COUNT(*) as c FROM dispensing_register WHERE doctor_id=?"),
      user_accounts: c("SELECT COUNT(*) as c FROM users WHERE doctor_id=?")
    };
  };
  electron.ipcMain.handle("doctors:dependents", (_e, id) => {
    const db2 = getDb();
    const counts = countDoctorRefs(db2, id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total };
  });
  electron.ipcMain.handle("doctors:delete", (_e, id) => {
    const db2 = getDb();
    const doc = db2.prepare("SELECT name FROM doctors WHERE id=?").get(id);
    if (!doc) return { ok: false, error: "Doctor not found" };
    const counts = countDoctorRefs(db2, id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      try {
        db2.prepare("DELETE FROM doctors WHERE id=?").run(id);
        logAudit(db2, null, "doctor_deleted", "doctors", id, doc.name);
        return { ok: true, mode: "hard_deleted", doctorName: doc.name };
      } catch (e) {
        return { ok: false, error: (e == null ? void 0 : e.message) || String(e) };
      }
    }
    return {
      ok: false,
      mode: "has_records",
      counts,
      total,
      doctorName: doc.name,
      error: `Cannot permanently delete — Dr. ${doc.name} has ${total} historical record(s).`
    };
  });
  electron.ipcMain.handle("doctors:deactivate", (_e, id) => {
    const db2 = getDb();
    const doc = db2.prepare("SELECT name FROM doctors WHERE id=?").get(id);
    if (!doc) return { ok: false, error: "Doctor not found" };
    db2.prepare("UPDATE doctors SET is_active=0 WHERE id=?").run(id);
    logAudit(db2, null, "doctor_deactivated", "doctors", id, doc.name);
    return { ok: true, doctorName: doc.name };
  });
  electron.ipcMain.handle("doctors:update", (_e, id, d) => {
    const db2 = getDb();
    db2.prepare(
      "UPDATE doctors SET name=?, specialty=?, phone=?, email=?, room_number=?, is_active=?, default_fee=?, signature=?, qualifications=?, registration_no=?, color=?, available_from=?, available_to=?, template_id=?, template_id_2=?, template_id_3=?, template_slot_names=? WHERE id=?"
    ).run(
      d.name ?? "",
      d.specialty ?? "",
      d.phone ?? null,
      d.email ?? null,
      d.room_number ?? null,
      d.is_active ?? 1,
      d.default_fee ?? 500,
      d.signature ?? null,
      d.qualifications ?? null,
      d.registration_no ?? null,
      d.color ?? null,
      d.available_from || null,
      d.available_to || null,
      d.template_id ?? null,
      d.template_id_2 ?? null,
      d.template_id_3 ?? null,
      d.template_slot_names ?? null,
      id
    );
    return db2.prepare("SELECT * FROM doctors WHERE id=?").get(id);
  });
  electron.ipcMain.handle(
    "appointments:bookedSlots",
    (_e, doctorId, date) => {
      return getDb().prepare(
        "SELECT appointment_time FROM appointments WHERE doctor_id=? AND appointment_date=? AND status <> 'Cancelled'"
      ).all(doctorId, date);
    }
  );
  electron.ipcMain.handle("appointments:create", (_e, payload) => {
    const db2 = getDb();
    const docHours = db2.prepare("SELECT name, available_from, available_to FROM doctors WHERE id=?").get(payload.doctor_id);
    if ((docHours == null ? void 0 : docHours.available_from) && (docHours == null ? void 0 : docHours.available_to) && payload.appointment_time) {
      const t = payload.appointment_time;
      if (t < docHours.available_from || t > docHours.available_to) {
        throw new Error(
          `${docHours.name} is only available between ${docHours.available_from} and ${docHours.available_to}. The slot ${t} is outside that window.`
        );
      }
    }
    if (payload.appointment_time) {
      const clash = db2.prepare(
        "SELECT id, token_number FROM appointments WHERE doctor_id=? AND appointment_date=? AND appointment_time=? AND status <> 'Cancelled' LIMIT 1"
      ).get(payload.doctor_id, payload.appointment_date, payload.appointment_time);
      if (clash) {
        throw new Error(
          `That time slot (${payload.appointment_time}) is already booked for ${(docHours == null ? void 0 : docHours.name) || "this doctor"} (Token #${clash.token_number}). Pick a different time.`
        );
      }
    }
    const tokenRow = db2.prepare(
      "SELECT COALESCE(MAX(token_number), 0) as mx FROM appointments WHERE appointment_date=?"
    ).get(payload.appointment_date);
    const token = tokenRow.mx + 1;
    const patient = db2.prepare("SELECT uhid FROM patients WHERE id=?").get(payload.patient_id);
    if (!patient) {
      throw new Error(`Cannot book appointment: patient id ${payload.patient_id} was not found. The patient may have been deleted.`);
    }
    const visitNumber = nextVisitNumber(db2, payload.patient_id);
    const visitId = formatVisitId(patient.uhid, visitNumber);
    const info = db2.prepare(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, consultation_token, visit_number, visit_id, status, notes, patient_group, procedure_tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payload.patient_id,
      payload.doctor_id,
      payload.appointment_date,
      payload.appointment_time,
      token,
      visitId,
      visitNumber,
      visitId,
      payload.status ?? (getAllSettings(db2).queue_flow_enabled ? "Waiting" : "Done"),
      payload.notes ?? null,
      payload.patient_group ?? null,
      payload.procedure_tags ?? null
    );
    const created = db2.prepare(
      `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
    ).get(info.lastInsertRowid);
    const notif = new NotificationService(db2);
    const patientRow = db2.prepare("SELECT * FROM patients WHERE id=?").get(payload.patient_id);
    const doctor = db2.prepare("SELECT * FROM doctors WHERE id=?").get(payload.doctor_id);
    const settings = getAllSettings(db2);
    notif.sendAppointmentConfirmation(patientRow, created, doctor, settings.clinic_name);
    notif.sendDoctorAlert(doctor, created, patientRow);
    try {
      broadcastEvent("appointment:new", { id: created.id, doctor_id: created.doctor_id, token_number: created.token_number, patient_name: created.patient_name });
    } catch {
    }
    try {
      enqueueWaEvent(db2, "appointment_created", {
        patientId: payload.patient_id,
        phone: patientRow.phone,
        appointmentId: created.id,
        vars: {
          "1": `${patientRow.first_name} ${patientRow.last_name}`.trim(),
          "2": doctor.name,
          "3": payload.appointment_date,
          "4": payload.appointment_time ?? ""
        }
      });
    } catch {
    }
    return created;
  });
  electron.ipcMain.handle(
    "appointments:list",
    (_e, filter) => {
      const db2 = getDb();
      const conditions = [];
      const params = [];
      if (filter == null ? void 0 : filter.date) {
        conditions.push("a.appointment_date = ?");
        params.push(filter.date);
      }
      if (filter == null ? void 0 : filter.doctor_id) {
        conditions.push("a.doctor_id = ?");
        params.push(filter.doctor_id);
      }
      if (filter == null ? void 0 : filter.status) {
        conditions.push("a.status = ?");
        params.push(filter.status);
      }
      const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      return db2.prepare(
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
      ).all(...params);
    }
  );
  electron.ipcMain.handle("appointments:updateStatus", (_e, id, status, expectedVersion) => {
    const db2 = getDb();
    if (typeof expectedVersion === "number") {
      const info = db2.prepare(
        "UPDATE appointments SET status=?, row_version=row_version+1 WHERE id=? AND row_version=?"
      ).run(status, id, expectedVersion);
      if (info.changes === 0) {
        const current = db2.prepare("SELECT row_version, status FROM appointments WHERE id=?").get(id);
        if (!current) throw new Error("Appointment not found");
        const err = new Error(`Conflict — another station already changed this appointment to "${current.status}". Refresh and try again.`);
        err.code = "CONFLICT";
        err.currentVersion = current.row_version;
        err.currentStatus = current.status;
        throw err;
      }
    } else {
      db2.prepare("UPDATE appointments SET status=?, row_version=row_version+1 WHERE id=?").run(status, id);
    }
    const row = db2.prepare("SELECT * FROM appointments WHERE id=?").get(id);
    try {
      broadcastEvent("appointment:status", { id, status, doctor_id: row == null ? void 0 : row.doctor_id, row_version: row == null ? void 0 : row.row_version });
    } catch {
    }
    return row;
  });
  electron.ipcMain.handle("appointments:get", (_e, id) => {
    return getDb().prepare(
      `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
    ).get(id);
  });
  electron.ipcMain.handle(
    "bills:create",
    (_e, payload) => {
      const db2 = getDb();
      const subtotal = payload.items.reduce((s, it) => s + Number(it.amount || 0), 0);
      const discountValue = payload.discount_type === "percent" ? subtotal * payload.discount / 100 : payload.discount;
      const total = Math.max(0, subtotal - discountValue);
      const billNumber = generateBillNumber();
      const info = db2.prepare(
        `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, is_free_followup, is_relaxed_followup, followup_parent_appt_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        billNumber,
        payload.appointment_id,
        payload.patient_id,
        JSON.stringify(payload.items),
        subtotal,
        payload.discount,
        payload.discount_type,
        total,
        payload.payment_mode,
        (/* @__PURE__ */ new Date()).toISOString(),
        payload.is_free_followup ? 1 : 0,
        payload.is_relaxed_followup ? 1 : 0,
        payload.followup_parent_appt_id ?? null
      );
      if (payload.marks_registration_fee_paid) {
        db2.prepare("UPDATE patients SET registration_fee_paid=1, registration_fee_paid_at=date('now') WHERE id=?").run(payload.patient_id);
      }
      if (payload.appointment_id) {
        db2.prepare("UPDATE appointments SET status='Done' WHERE id=?").run(payload.appointment_id);
      }
      const billResult = db2.prepare(
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
      ).get(info.lastInsertRowid);
      try {
        if (billResult == null ? void 0 : billResult.patient_phone) {
          enqueueWaEvent(db2, "bill_generated", {
            patientId: payload.patient_id,
            phone: billResult.patient_phone,
            appointmentId: payload.appointment_id,
            vars: {
              "1": billResult.patient_name ?? "",
              "2": String(total),
              "3": payload.payment_mode
            }
          });
        }
      } catch {
      }
      return billResult;
    }
  );
  electron.ipcMain.handle("bills:list", (_e, filter) => {
    const db2 = getDb();
    const conditions = [];
    const params = [];
    if (filter == null ? void 0 : filter.q) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR b.bill_number LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like);
    }
    if (filter == null ? void 0 : filter.from) {
      conditions.push("date(b.created_at) >= ?");
      params.push(filter.from);
    }
    if (filter == null ? void 0 : filter.to) {
      conditions.push("date(b.created_at) <= ?");
      params.push(filter.to);
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    return db2.prepare(
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
    ).all(...params);
  });
  electron.ipcMain.handle("bills:get", (_e, id) => {
    return getDb().prepare(
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
    ).get(id);
  });
  electron.ipcMain.handle("misc:create", (_e, payload) => {
    var _a, _b;
    const db2 = getDb();
    if (!payload.patient_id) throw new Error("Patient is required");
    if (!((_a = payload.description) == null ? void 0 : _a.trim())) throw new Error("Service description is required");
    if (!(payload.amount >= 0)) throw new Error("Amount must be ≥ 0");
    const billNumber = generateBillNumber();
    const items = [{ description: payload.description.trim(), qty: 1, rate: payload.amount, amount: payload.amount }];
    const info = db2.prepare(
      `INSERT INTO bills
          (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at, bill_kind, notes)
         VALUES (?, NULL, ?, ?, ?, ?, 0, 'flat', ?, ?, ?, 'misc', ?)`
    ).run(
      billNumber,
      payload.patient_id,
      payload.doctor_id ?? null,
      JSON.stringify(items),
      payload.amount,
      payload.amount,
      payload.payment_mode,
      (/* @__PURE__ */ new Date()).toISOString(),
      ((_b = payload.notes) == null ? void 0 : _b.trim()) || null
    );
    return db2.prepare(
      `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN doctors d ON d.id=b.doctor_id
         WHERE b.id=?`
    ).get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("misc:list", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = ["b.bill_kind='misc'"];
    const params = [];
    if (filter.from) {
      conds.push("date(b.created_at) >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      conds.push("date(b.created_at) <= ?");
      params.push(filter.to);
    }
    if (filter.doctor_id) {
      conds.push("b.doctor_id = ?");
      params.push(filter.doctor_id);
    }
    if (filter.q) {
      conds.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR b.notes LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    return db2.prepare(
      `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN doctors d ON d.id=b.doctor_id
         WHERE ${conds.join(" AND ")}
         ORDER BY b.created_at DESC LIMIT 200`
    ).all(...params);
  });
  electron.ipcMain.handle("misc:trend", (_e, filter = {}) => {
    const db2 = getDb();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const from = filter.from || today.slice(0, 8) + "01";
    const to = filter.to || today;
    return db2.prepare(`
      SELECT date(b.created_at) as day,
             COUNT(*) as count,
             COALESCE(SUM(b.total),0) as revenue
      FROM bills b
      WHERE b.bill_kind='misc' AND date(b.created_at) BETWEEN ? AND ?
      GROUP BY day
      ORDER BY day ASC
    `).all(from, to);
  });
  electron.ipcMain.handle("misc:summary", (_e, filter = {}) => {
    const db2 = getDb();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const from = filter.from || today.slice(0, 8) + "01";
    const to = filter.to || today;
    const sc = (sql, ...p) => db2.prepare(sql).get(...p).c;
    const ss = (sql, ...p) => db2.prepare(sql).get(...p).t || 0;
    const count = sc(`SELECT COUNT(*) as c FROM bills WHERE bill_kind='misc' AND date(created_at) BETWEEN ? AND ?`, from, to);
    const revenue = ss(`SELECT COALESCE(SUM(total),0) as t FROM bills WHERE bill_kind='misc' AND date(created_at) BETWEEN ? AND ?`, from, to);
    const topServices = db2.prepare(`
      SELECT json_extract(j.value, '$.description') as service,
             COUNT(*) as count,
             COALESCE(SUM(json_extract(j.value, '$.amount')), 0) as revenue
      FROM bills b, json_each(b.items_json) j
      WHERE b.bill_kind='misc' AND date(b.created_at) BETWEEN ? AND ?
      GROUP BY service
      ORDER BY revenue DESC
      LIMIT 10
    `).all(from, to);
    const byDoctor = db2.prepare(`
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
  const addDays = (iso, days) => {
    const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  electron.ipcMain.handle("followup:checkEligibility", (_e, patientId, doctorId, checkDate) => {
    const db2 = getDb();
    const s = getAllSettings(db2);
    if (!s.followup_enabled) {
      return { enabled: false, eligible: false, relaxed_eligible: false, free_remaining: 0, total_free: 0, valid_till: null, parent_appt_id: null, parent_appt_date: null, reason: "disabled" };
    }
    const today = checkDate && /^\d{4}-\d{2}-\d{2}$/.test(checkDate) ? checkDate : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const paid = db2.prepare(`
      SELECT a.id as appt_id, a.appointment_date
      FROM bills b
      JOIN appointments a ON a.id = b.appointment_id
      WHERE b.patient_id = ?
        AND a.doctor_id = ?
        AND COALESCE(b.is_free_followup, 0) = 0
        AND COALESCE(b.is_relaxed_followup, 0) = 0
      ORDER BY a.appointment_date DESC, a.id DESC
      LIMIT 1
    `).get(patientId, doctorId);
    const base = {
      enabled: true,
      total_free: s.followup_free_visits,
      free_remaining: 0,
      valid_till: null,
      parent_appt_id: null,
      parent_appt_date: null
    };
    if (!paid) {
      return { ...base, eligible: false, relaxed_eligible: false, reason: "no_paid_visit" };
    }
    const validTill = addDays(paid.appointment_date, s.followup_window_days);
    const graceTill = addDays(paid.appointment_date, s.followup_window_days + s.followup_grace_days);
    const used = db2.prepare(`
      SELECT COUNT(*) as c FROM bills
      WHERE followup_parent_appt_id = ?
        AND (COALESCE(is_free_followup, 0) = 1 OR COALESCE(is_relaxed_followup, 0) = 1)
    `).get(paid.appt_id).c;
    const remaining = Math.max(0, s.followup_free_visits - used);
    const out = {
      ...base,
      free_remaining: remaining,
      valid_till: validTill,
      parent_appt_id: paid.appt_id,
      parent_appt_date: paid.appointment_date
    };
    if (today <= validTill && remaining > 0) {
      return { ...out, eligible: true, relaxed_eligible: false };
    }
    if (today <= graceTill && remaining > 0) {
      return { ...out, eligible: false, relaxed_eligible: true, reason: "window_expired" };
    }
    if (remaining <= 0) {
      return { ...out, eligible: false, relaxed_eligible: false, reason: "all_consumed" };
    }
    return { ...out, eligible: false, relaxed_eligible: false, reason: "window_expired" };
  });
  electron.ipcMain.handle("followup:summaryForAppointment", (_e, appointmentId) => {
    const db2 = getDb();
    const s = getAllSettings(db2);
    if (!s.followup_enabled) return { enabled: false, mode: "hidden" };
    const appt = db2.prepare(`
      SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, d.name as doctor_name
      FROM appointments a JOIN doctors d ON d.id=a.doctor_id
      WHERE a.id=?
    `).get(appointmentId);
    if (!appt) return { enabled: true, mode: "hidden" };
    const bill = db2.prepare(`SELECT * FROM bills WHERE appointment_id=? ORDER BY id DESC LIMIT 1`).get(appointmentId);
    if (bill && (bill.is_free_followup || bill.is_relaxed_followup)) {
      const parent = bill.followup_parent_appt_id ? db2.prepare(`SELECT appointment_date FROM appointments WHERE id=?`).get(bill.followup_parent_appt_id) : null;
      const anchorDate = (parent == null ? void 0 : parent.appointment_date) || appt.appointment_date;
      const validTill2 = addDays(anchorDate, s.followup_window_days);
      const used = db2.prepare(`
        SELECT COUNT(*) as c FROM bills
        WHERE followup_parent_appt_id = ?
          AND (COALESCE(is_free_followup, 0) = 1 OR COALESCE(is_relaxed_followup, 0) = 1)
      `).get(bill.followup_parent_appt_id ?? -1).c;
      const remainingAfter = Math.max(0, s.followup_free_visits - used);
      return {
        enabled: true,
        mode: bill.is_relaxed_followup ? "today_relaxed" : "today_free",
        doctor_name: appt.doctor_name,
        free_remaining: remainingAfter,
        valid_till: validTill2
      };
    }
    const validTill = addDays(appt.appointment_date, s.followup_window_days);
    return {
      enabled: true,
      mode: "today_paid",
      doctor_name: appt.doctor_name,
      free_remaining: s.followup_free_visits,
      valid_till: validTill
    };
  });
  const emrGet = (table) => (_e, patientId) => getDb().prepare(`SELECT * FROM ${table} WHERE patient_id=? ORDER BY id DESC`).all(patientId);
  const emrDelete = (table) => (_e, id) => {
    getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    return true;
  };
  electron.ipcMain.handle("emr:allergies", emrGet("patient_allergies"));
  electron.ipcMain.handle("emr:addAllergy", (_e, payload) => {
    const db2 = getDb();
    const info = db2.prepare("INSERT INTO patient_allergies (patient_id, allergen, reaction, severity) VALUES (?, ?, ?, ?)").run(payload.patient_id, payload.allergen, payload.reaction ?? null, payload.severity ?? null);
    return db2.prepare("SELECT * FROM patient_allergies WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("emr:deleteAllergy", emrDelete("patient_allergies"));
  electron.ipcMain.handle("emr:conditions", emrGet("patient_conditions"));
  electron.ipcMain.handle("emr:addCondition", (_e, payload) => {
    const db2 = getDb();
    const info = db2.prepare("INSERT INTO patient_conditions (patient_id, condition, since, notes, is_active) VALUES (?, ?, ?, ?, 1)").run(payload.patient_id, payload.condition, payload.since ?? null, payload.notes ?? null);
    return db2.prepare("SELECT * FROM patient_conditions WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("emr:deleteCondition", emrDelete("patient_conditions"));
  electron.ipcMain.handle("emr:family", emrGet("patient_family_history"));
  electron.ipcMain.handle("emr:addFamily", (_e, payload) => {
    const db2 = getDb();
    const info = db2.prepare("INSERT INTO patient_family_history (patient_id, relation, condition, notes) VALUES (?, ?, ?, ?)").run(payload.patient_id, payload.relation, payload.condition, payload.notes ?? null);
    return db2.prepare("SELECT * FROM patient_family_history WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("emr:deleteFamily", emrDelete("patient_family_history"));
  electron.ipcMain.handle("emr:immunizations", emrGet("patient_immunizations"));
  electron.ipcMain.handle("emr:addImmunization", (_e, payload) => {
    const db2 = getDb();
    const info = db2.prepare("INSERT INTO patient_immunizations (patient_id, vaccine, given_at, dose, notes) VALUES (?, ?, ?, ?, ?)").run(payload.patient_id, payload.vaccine, payload.given_at ?? null, payload.dose ?? null, payload.notes ?? null);
    return db2.prepare("SELECT * FROM patient_immunizations WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("emr:deleteImmunization", emrDelete("patient_immunizations"));
  electron.ipcMain.handle("emr:documents", emrGet("patient_documents"));
  electron.ipcMain.handle(
    "emr:addDocument",
    (_e, payload) => {
      const dir = path.join(electron.app.getPath("userData"), "documents", String(payload.patient_id));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = payload.file_name.replace(/[^\w.\-]/g, "_");
      const fileName = `${Date.now()}-${safeName}`;
      const filePath = path.join(dir, fileName);
      const buf = Buffer.from(payload.data_base64.split(",").pop() || "", "base64");
      fs.writeFileSync(filePath, buf);
      const db2 = getDb();
      const info = db2.prepare("INSERT INTO patient_documents (patient_id, file_name, file_type, file_path, size_bytes, note) VALUES (?, ?, ?, ?, ?, ?)").run(payload.patient_id, payload.file_name, payload.file_type, filePath, buf.byteLength, payload.note ?? null);
      return db2.prepare("SELECT * FROM patient_documents WHERE id=?").get(info.lastInsertRowid);
    }
  );
  electron.ipcMain.handle("emr:openDocument", (_e, id) => {
    const row = getDb().prepare("SELECT file_path FROM patient_documents WHERE id=?").get(id);
    if (!(row == null ? void 0 : row.file_path)) return;
    const SAFE_EXTS = /* @__PURE__ */ new Set([
      ".pdf",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".bmp",
      ".tiff",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".txt",
      ".rtf",
      ".odt",
      ".ods",
      ".csv"
    ]);
    const ext = path.extname(row.file_path).toLowerCase();
    if (!SAFE_EXTS.has(ext)) return;
    electron.shell.openPath(row.file_path);
  });
  electron.ipcMain.handle("emr:deleteDocument", (_e, id) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT file_path FROM patient_documents WHERE id=?").get(id);
    if ((row == null ? void 0 : row.file_path) && fs.existsSync(row.file_path)) {
      try {
        fs.unlinkSync(row.file_path);
      } catch {
      }
    }
    db2.prepare("DELETE FROM patient_documents WHERE id=?").run(id);
    return true;
  });
  const hydrateConsultation = (row) => row ? {
    ...row,
    vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
    extra_fields: row.extra_fields_json ? (() => {
      try {
        return JSON.parse(row.extra_fields_json);
      } catch {
        return {};
      }
    })() : {}
  } : null;
  electron.ipcMain.handle("consultations:getByAppointment", (_e, appointmentId) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT * FROM consultations WHERE appointment_id=?").get(appointmentId);
    return hydrateConsultation(row);
  });
  electron.ipcMain.handle(
    "consultations:save",
    (_e, payload) => {
      const db2 = getDb();
      const vitalsJson = payload.vitals ? JSON.stringify(payload.vitals) : null;
      const extraJson = payload.extra_fields ? JSON.stringify(payload.extra_fields) : null;
      const existing = db2.prepare("SELECT id FROM consultations WHERE appointment_id=?").get(payload.appointment_id);
      if (existing) {
        db2.prepare(
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
        db2.prepare(
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
      const row = db2.prepare("SELECT * FROM consultations WHERE appointment_id=?").get(payload.appointment_id);
      return hydrateConsultation(row);
    }
  );
  electron.ipcMain.handle("templates:list", () => {
    const db2 = getDb();
    const row = db2.prepare("SELECT value FROM settings WHERE key='slip_templates'").get();
    if (!(row == null ? void 0 : row.value)) return [];
    try {
      return JSON.parse(row.value);
    } catch {
      return [];
    }
  });
  electron.ipcMain.handle("templates:saveAll", (_e, templates) => {
    const db2 = getDb();
    const json = JSON.stringify(Array.isArray(templates) ? templates : []);
    db2.prepare("INSERT INTO settings (key, value) VALUES ('slip_templates', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
    return { ok: true };
  });
  electron.ipcMain.handle("rx:getByAppointment", (_e, appointmentId) => {
    return getDb().prepare("SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id").all(appointmentId);
  });
  electron.ipcMain.handle(
    "rx:saveAll",
    (_e, appointmentId, items) => {
      const db2 = getDb();
      const tx = db2.transaction(() => {
        db2.prepare("DELETE FROM prescription_items WHERE appointment_id=?").run(appointmentId);
        const ins = db2.prepare(
          "INSERT INTO prescription_items (appointment_id, drug_master_id, drug_name, dosage, frequency, duration, instructions, order_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        items.forEach((it, idx) => {
          var _a;
          if (!((_a = it.drug_name) == null ? void 0 : _a.trim())) return;
          ins.run(
            appointmentId,
            it.drug_master_id ?? null,
            it.drug_name.trim(),
            it.dosage ?? null,
            it.frequency ?? null,
            it.duration ?? null,
            it.instructions ?? null,
            idx
          );
        });
      });
      tx();
      try {
        const apptPt = db2.prepare(
          `SELECT p.id, p.phone, p.first_name, p.last_name FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=?`
        ).get(appointmentId);
        if (apptPt) enqueueWaEvent(db2, "prescription_generated", {
          patientId: apptPt.id,
          phone: apptPt.phone,
          appointmentId,
          vars: { "1": `${apptPt.first_name} ${apptPt.last_name}`.trim() }
        });
      } catch {
      }
      return db2.prepare("SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id").all(appointmentId);
    }
  );
  electron.ipcMain.handle("lab:listTests", (_e, activeOnly = true) => {
    const db2 = getDb();
    return activeOnly ? db2.prepare("SELECT * FROM lab_tests WHERE is_active=1 ORDER BY name").all() : db2.prepare("SELECT * FROM lab_tests ORDER BY is_active DESC, name").all();
  });
  electron.ipcMain.handle("lab:upsertTest", (_e, test) => {
    const db2 = getDb();
    if (test.id) {
      db2.prepare(
        "UPDATE lab_tests SET name=?, price=?, sample_type=?, ref_range=?, unit=?, is_active=? WHERE id=?"
      ).run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1, test.id);
      return db2.prepare("SELECT * FROM lab_tests WHERE id=?").get(test.id);
    }
    const info = db2.prepare("INSERT INTO lab_tests (name, price, sample_type, ref_range, unit, is_active) VALUES (?, ?, ?, ?, ?, ?)").run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1);
    return db2.prepare("SELECT * FROM lab_tests WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle(
    "lab:createOrder",
    (_e, payload) => {
      const db2 = getDb();
      const d = /* @__PURE__ */ new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const row = db2.prepare("SELECT COUNT(*) as c FROM lab_orders WHERE order_number LIKE ?").get(`LAB-${ymd}-%`);
      const orderNumber = `LAB-${ymd}-${pad(row.c + 1, 4)}`;
      const tx = db2.transaction(() => {
        const info = db2.prepare(
          "INSERT INTO lab_orders (order_number, appointment_id, patient_id, doctor_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(orderNumber, payload.appointment_id, payload.patient_id, payload.doctor_id, "ordered", payload.notes ?? null);
        const orderId = Number(info.lastInsertRowid);
        const insItem = db2.prepare(
          "INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, ref_range, unit) VALUES (?, ?, ?, ?, ?)"
        );
        for (const it of payload.items) {
          let range = null;
          let unit = null;
          if (it.lab_test_id) {
            const t = db2.prepare("SELECT ref_range, unit FROM lab_tests WHERE id=?").get(it.lab_test_id);
            range = (t == null ? void 0 : t.ref_range) ?? null;
            unit = (t == null ? void 0 : t.unit) ?? null;
          }
          insItem.run(orderId, it.lab_test_id ?? null, it.test_name, range, unit);
        }
        return orderId;
      });
      const id = tx();
      return db2.prepare("SELECT * FROM lab_orders WHERE id=?").get(id);
    }
  );
  electron.ipcMain.handle("lab:listOrders", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = [];
    const params = [];
    if (filter.status) {
      conds.push("o.status=?");
      params.push(filter.status);
    }
    if (filter.patient_id) {
      conds.push("o.patient_id=?");
      params.push(filter.patient_id);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return db2.prepare(
      `SELECT o.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name
         FROM lab_orders o
         JOIN patients p ON p.id=o.patient_id
         LEFT JOIN doctors d ON d.id=o.doctor_id
         ${where}
         ORDER BY o.ordered_at DESC LIMIT 200`
    ).all(...params);
  });
  electron.ipcMain.handle("lab:getOrderItems", (_e, orderId) => {
    return getDb().prepare("SELECT * FROM lab_order_items WHERE lab_order_id=?").all(orderId);
  });
  electron.ipcMain.handle("lab:updateOrderStatus", (_e, orderId, status) => {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const fields = { status };
    if (status === "sample_collected") fields.collected_at = now;
    if (status === "reported") fields.reported_at = now;
    const cols = Object.keys(fields).map((k) => `${k}=?`).join(", ");
    db2.prepare(`UPDATE lab_orders SET ${cols} WHERE id=?`).run(...Object.values(fields), orderId);
    if (status === "reported") {
      try {
        const labPt = db2.prepare(
          `SELECT p.id, p.phone, p.first_name, p.last_name FROM lab_orders lo JOIN patients p ON p.id=lo.patient_id WHERE lo.id=?`
        ).get(orderId);
        if (labPt) enqueueWaEvent(db2, "lab_report_ready", {
          patientId: labPt.id,
          phone: labPt.phone,
          vars: { "1": `${labPt.first_name} ${labPt.last_name}`.trim() }
        });
      } catch {
      }
    }
    return db2.prepare("SELECT * FROM lab_orders WHERE id=?").get(orderId);
  });
  electron.ipcMain.handle("lab:updateResults", (_e, orderId, items) => {
    const db2 = getDb();
    const upd = db2.prepare("UPDATE lab_order_items SET result=?, is_abnormal=? WHERE id=?");
    const tx = db2.transaction(() => {
      for (const it of items) upd.run(it.result, it.is_abnormal ?? 0, it.id);
    });
    tx();
    return db2.prepare("SELECT * FROM lab_order_items WHERE lab_order_id=?").all(orderId);
  });
  electron.ipcMain.handle("pharmacy:listDrugs", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = [];
    const params = [];
    if (filter.activeOnly !== false) conds.push("m.is_active=1");
    if (filter.q) {
      conds.push("(m.name LIKE ? OR m.generic_name LIKE ? OR m.barcode = ?)");
      const like = `%${filter.q}%`;
      params.push(like, like, filter.q);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return db2.prepare(`
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
  electron.ipcMain.handle("pharmacy:listBatches", (_e, drugMasterId) => {
    const db2 = getDb();
    return db2.prepare(`
      SELECT b.*, m.name as drug_name, m.schedule as schedule
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE b.drug_master_id=?
      ORDER BY date(b.expiry) ASC, b.received_at ASC
    `).all(drugMasterId);
  });
  electron.ipcMain.handle("pharmacy:upsertDrug", (_e, drug) => {
    const db2 = getDb();
    if (drug.id) {
      db2.prepare(`
        UPDATE drug_master SET
          name=?, generic_name=?, manufacturer=?, form=?, strength=?, pack_size=?,
          schedule=?, hsn_code=?, gst_rate=?, default_mrp=?, low_stock_threshold=?,
          barcode=?, is_active=?, notes=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        drug.name,
        drug.generic_name ?? null,
        drug.manufacturer ?? null,
        drug.form ?? null,
        drug.strength ?? null,
        drug.pack_size ?? null,
        drug.schedule ?? "OTC",
        drug.hsn_code ?? null,
        drug.gst_rate ?? 12,
        drug.default_mrp ?? drug.mrp ?? 0,
        drug.low_stock_threshold ?? 10,
        drug.barcode ?? null,
        drug.is_active ?? 1,
        drug.notes ?? null,
        drug.id
      );
      return db2.prepare("SELECT * FROM drug_master WHERE id=?").get(drug.id);
    }
    const info = db2.prepare(`
      INSERT INTO drug_master
        (name, generic_name, manufacturer, form, strength, pack_size, schedule,
         hsn_code, gst_rate, default_mrp, low_stock_threshold, barcode, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      drug.name,
      drug.generic_name ?? null,
      drug.manufacturer ?? null,
      drug.form ?? null,
      drug.strength ?? null,
      drug.pack_size ?? null,
      drug.schedule ?? "OTC",
      drug.hsn_code ?? null,
      drug.gst_rate ?? 12,
      drug.default_mrp ?? drug.mrp ?? 0,
      drug.low_stock_threshold ?? 10,
      drug.barcode ?? null,
      drug.is_active ?? 1,
      drug.notes ?? null
    );
    return db2.prepare("SELECT * FROM drug_master WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("pharmacy:upsertBatch", (_e, batch) => {
    const db2 = getDb();
    if (batch.id) {
      db2.prepare(`
        UPDATE drug_stock_batches SET
          batch_no=?, expiry=?, qty_received=?, qty_remaining=?, purchase_price=?,
          mrp=?, manufacturer_license_no=?, is_active=?
        WHERE id=?
      `).run(
        batch.batch_no,
        batch.expiry,
        batch.qty_received,
        batch.qty_remaining,
        batch.purchase_price ?? null,
        batch.mrp ?? 0,
        batch.manufacturer_license_no ?? null,
        batch.is_active ?? 1,
        batch.id
      );
      return db2.prepare("SELECT * FROM drug_stock_batches WHERE id=?").get(batch.id);
    }
    db2.prepare(`
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
      batch.drug_master_id,
      batch.batch_no,
      batch.expiry,
      batch.qty_received,
      batch.qty_remaining ?? batch.qty_received,
      batch.purchase_price ?? null,
      batch.mrp ?? 0,
      batch.manufacturer_license_no ?? null,
      batch.is_active ?? 1
    );
    return db2.prepare("SELECT * FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?").get(batch.drug_master_id, batch.batch_no);
  });
  electron.ipcMain.handle("pharmacy:bulkDeleteDrugs", (_e, ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: true, hardDeleted: 0, softDeleted: 0, results: [] };
    const db2 = getDb();
    const countRefs = (id) => {
      const c = (sql) => db2.prepare(sql).get(id).c;
      return {
        batches: c("SELECT COUNT(*) as c FROM drug_stock_batches WHERE drug_master_id=?"),
        rx: c("SELECT COUNT(*) as c FROM prescription_items WHERE drug_master_id=?"),
        sale_items: c("SELECT COUNT(*) as c FROM pharmacy_sale_items WHERE drug_master_id=?"),
        dispensed: c("SELECT COUNT(*) as c FROM dispensing_register WHERE drug_master_id=?"),
        purchase_lines: c("SELECT COUNT(*) as c FROM purchase_invoice_items WHERE drug_master_id=?")
      };
    };
    const results = [];
    let hardDeleted = 0;
    let softDeleted = 0;
    const tx = db2.transaction(() => {
      for (const id of ids) {
        const drug = db2.prepare("SELECT id, name FROM drug_master WHERE id=?").get(id);
        if (!drug) {
          results.push({ id, name: "(not found)", mode: "failed", error: "Drug not found" });
          continue;
        }
        const refs = countRefs(id);
        const total = refs.batches + refs.rx + refs.sale_items + refs.dispensed + refs.purchase_lines;
        if (total === 0) {
          try {
            db2.prepare("DELETE FROM drug_master WHERE id=?").run(id);
            logAudit(db2, null, "drug_deleted", "drug_master", id, drug.name);
            results.push({ id, name: drug.name, mode: "hard_deleted" });
            hardDeleted++;
          } catch (e) {
            results.push({ id, name: drug.name, mode: "failed", error: (e == null ? void 0 : e.message) || String(e), refs });
          }
        } else {
          db2.prepare("UPDATE drug_master SET is_active=0 WHERE id=?").run(id);
          logAudit(db2, null, "drug_deactivated", "drug_master", id, `${drug.name} (kept ${total} historical record(s))`);
          results.push({ id, name: drug.name, mode: "soft_deleted", refs });
          softDeleted++;
        }
      }
    });
    tx();
    return { ok: true, hardDeleted, softDeleted, results };
  });
  electron.ipcMain.handle("pharmacy:alerts", () => {
    const db2 = getDb();
    const lowStock = db2.prepare(`
      SELECT m.*, m.default_mrp as mrp,
        (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
          WHERE b.drug_master_id=m.id AND b.is_active=1) as stock_qty
      FROM drug_master m
      WHERE m.is_active=1
        AND (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM drug_stock_batches b
             WHERE b.drug_master_id=m.id AND b.is_active=1) <= m.low_stock_threshold
      ORDER BY stock_qty ASC LIMIT 50
    `).all();
    const expiringSoon = db2.prepare(`
      SELECT b.*, m.name as drug_name, m.schedule as schedule, m.default_mrp as mrp
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE b.is_active=1 AND b.qty_remaining > 0
        AND date(b.expiry) <= date('now', '+90 days')
      ORDER BY date(b.expiry) ASC LIMIT 50
    `).all();
    return { lowStock, expiringSoon };
  });
  electron.ipcMain.handle("pharmacy:pendingRx", () => {
    const db2 = getDb();
    return db2.prepare(
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
    ).all();
  });
  electron.ipcMain.handle("pharmacy:getAppointmentRx", (_e, appointmentId) => {
    return getDb().prepare("SELECT * FROM prescription_items WHERE appointment_id=?").all(appointmentId);
  });
  electron.ipcMain.handle(
    "pharmacy:sell",
    (_e, payload) => {
      const db2 = getDb();
      const d = /* @__PURE__ */ new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const row = db2.prepare("SELECT COUNT(*) as c FROM pharmacy_sales WHERE sale_number LIKE ?").get(`PHX-${ymd}-%`);
      const saleNumber = `PHX-${ymd}-${pad(row.c + 1, 4)}`;
      const subtotal = payload.items.reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0);
      const discount = Number(payload.discount ?? 0);
      const total = Math.max(0, subtotal - discount);
      let doctorId = null;
      let rxReference = null;
      if (payload.appointment_id) {
        const a = db2.prepare(
          `SELECT a.doctor_id, a.appointment_date, a.appointment_time, d.name as doctor_name
           FROM appointments a JOIN doctors d ON d.id=a.doctor_id WHERE a.id=?`
        ).get(payload.appointment_id);
        if (a) {
          doctorId = a.doctor_id;
          rxReference = `Rx ${a.appointment_date} ${a.appointment_time} · ${a.doctor_name}`;
        }
      }
      const tx = db2.transaction(() => {
        var _a;
        const info = db2.prepare(
          "INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode, sold_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          saleNumber,
          payload.patient_id ?? null,
          payload.appointment_id ?? null,
          subtotal,
          discount,
          total,
          payload.payment_mode ?? null,
          payload.sold_by ?? null
        );
        const saleId = Number(info.lastInsertRowid);
        const insSaleItem = db2.prepare(`
          INSERT INTO pharmacy_sale_items
            (sale_id, drug_id, drug_master_id, batch_id, drug_name, qty, rate, amount, gst_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insRegister = db2.prepare(`
          INSERT INTO dispensing_register
            (sale_item_id, sale_id, patient_id, doctor_id, drug_master_id, batch_id,
             batch_no, expiry, schedule, qty, rate, rx_reference, dispensed_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const decrementBatch = db2.prepare(
          "UPDATE drug_stock_batches SET qty_remaining = qty_remaining - ? WHERE id=?"
        );
        const fetchBatches = db2.prepare(`
          SELECT b.id, b.batch_no, b.expiry, b.qty_remaining, m.schedule
          FROM drug_stock_batches b
          JOIN drug_master m ON m.id=b.drug_master_id
          WHERE b.drug_master_id=? AND b.is_active=1 AND b.qty_remaining > 0
          ORDER BY date(b.expiry) ASC, b.received_at ASC
        `);
        for (const it of payload.items) {
          const masterId = it.drug_master_id ?? it.drug_id ?? null;
          const amount = Number(it.qty) * Number(it.rate);
          const batches = masterId ? fetchBatches.all(masterId) : [];
          const firstBatchId = ((_a = batches[0]) == null ? void 0 : _a.id) ?? null;
          const saleItemInfo = insSaleItem.run(
            saleId,
            masterId,
            masterId,
            firstBatchId,
            it.drug_name,
            it.qty,
            it.rate,
            amount,
            Number(it.gst_amount ?? 0)
          );
          const saleItemId = Number(saleItemInfo.lastInsertRowid);
          if (masterId) {
            let need = Number(it.qty);
            for (const b of batches) {
              if (need <= 0) break;
              const take = Math.min(need, b.qty_remaining);
              decrementBatch.run(take, b.id);
              insRegister.run(
                saleItemId,
                saleId,
                payload.patient_id ?? null,
                doctorId,
                masterId,
                b.id,
                b.batch_no,
                b.expiry,
                b.schedule || "OTC",
                take,
                it.rate,
                rxReference,
                payload.sold_by ?? null
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
      return db2.prepare("SELECT * FROM pharmacy_sales WHERE id=?").get(id);
    }
  );
  electron.ipcMain.handle("pharmacy:listSales", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = [];
    const params = [];
    if (filter.from) {
      conds.push("date(s.created_at) >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      conds.push("date(s.created_at) <= ?");
      params.push(filter.to);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return db2.prepare(
      `SELECT s.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid
         FROM pharmacy_sales s
         LEFT JOIN patients p ON p.id=s.patient_id
         ${where}
         ORDER BY s.created_at DESC LIMIT 300`
    ).all(...params);
  });
  electron.ipcMain.handle("pharmacy:recordCustomSale", (_e, payload) => {
    const db2 = getDb();
    const cleaned = (payload.items || []).map((it) => ({
      drug_name: (it.drug_name || "").trim(),
      qty: Number(it.qty || 0),
      rate: Number(it.rate || 0),
      amount: Number(it.amount ?? Number(it.qty || 0) * Number(it.rate || 0))
    })).filter((it) => it.drug_name || it.qty > 0 || it.rate > 0 || it.amount > 0);
    const total = Math.max(0, Number(payload.total_amount || 0));
    const subtotal = total;
    const dnow = /* @__PURE__ */ new Date();
    const ymd = `${dnow.getFullYear()}${pad(dnow.getMonth() + 1, 2)}${pad(dnow.getDate(), 2)}`;
    const seqRow = db2.prepare("SELECT COUNT(*) as c FROM pharmacy_sales WHERE sale_number LIKE ?").get(`PHX-${ymd}-%`);
    const saleNumber = `PHX-${ymd}-${pad(seqRow.c + 1, 4)}`;
    const tx = db2.transaction(() => {
      const info = db2.prepare(`
        INSERT INTO pharmacy_sales
          (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode, sold_by, created_at)
        VALUES (?, ?, NULL, ?, 0, ?, ?, ?, datetime('now'))
      `).run(
        saleNumber,
        payload.patient_id ?? null,
        subtotal,
        total,
        payload.payment_mode || "Cash",
        payload.notes || null
      );
      const saleId = Number(info.lastInsertRowid);
      const insItem = db2.prepare(`
        INSERT INTO pharmacy_sale_items
          (sale_id, drug_id, drug_name, qty, rate, amount)
        VALUES (?, NULL, ?, ?, ?, ?)
      `);
      if (cleaned.length === 0) {
        insItem.run(saleId, "(unspecified items)", 0, 0, total);
      } else {
        for (const it of cleaned) {
          insItem.run(saleId, it.drug_name || "(unnamed item)", it.qty, it.rate, it.amount);
        }
      }
      return saleId;
    });
    const id = tx();
    return db2.prepare(`
      SELECT s.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid
      FROM pharmacy_sales s LEFT JOIN patients p ON p.id=s.patient_id
      WHERE s.id=?
    `).get(id);
  });
  electron.ipcMain.handle("wholesalers:list", (_e, filter = {}) => {
    const db2 = getDb();
    const where = filter.activeOnly !== false ? "WHERE is_active=1" : "";
    return db2.prepare(`SELECT * FROM wholesalers ${where} ORDER BY name`).all();
  });
  electron.ipcMain.handle("wholesalers:upsert", (_e, w) => {
    const db2 = getDb();
    if (w.id) {
      db2.prepare(`
        UPDATE wholesalers SET
          name=?, contact_person=?, phone=?, email=?, address=?,
          drug_license_no=?, gstin=?, is_active=?, notes=?
        WHERE id=?
      `).run(
        w.name,
        w.contact_person ?? null,
        w.phone ?? null,
        w.email ?? null,
        w.address ?? null,
        w.drug_license_no,
        w.gstin ?? null,
        w.is_active ?? 1,
        w.notes ?? null,
        w.id
      );
      return db2.prepare("SELECT * FROM wholesalers WHERE id=?").get(w.id);
    }
    const info = db2.prepare(`
      INSERT INTO wholesalers
        (name, contact_person, phone, email, address, drug_license_no, gstin, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      w.name,
      w.contact_person ?? null,
      w.phone ?? null,
      w.email ?? null,
      w.address ?? null,
      w.drug_license_no,
      w.gstin ?? null,
      w.is_active ?? 1,
      w.notes ?? null
    );
    return db2.prepare("SELECT * FROM wholesalers WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("wholesalers:delete", (_e, id) => {
    getDb().prepare("UPDATE wholesalers SET is_active=0 WHERE id=?").run(id);
    return { ok: true };
  });
  electron.ipcMain.handle("purchase:list", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = [];
    const params = [];
    if (filter.from) {
      conds.push("date(pi.invoice_date) >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      conds.push("date(pi.invoice_date) <= ?");
      params.push(filter.to);
    }
    if (filter.wholesaler_id) {
      conds.push("pi.wholesaler_id = ?");
      params.push(filter.wholesaler_id);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return db2.prepare(`
      SELECT pi.*, w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      ${where}
      ORDER BY date(pi.invoice_date) DESC, pi.id DESC LIMIT 500
    `).all(...params);
  });
  electron.ipcMain.handle("purchase:get", (_e, id) => {
    const db2 = getDb();
    const header = db2.prepare(`
      SELECT pi.*, w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      WHERE pi.id=?
    `).get(id);
    if (!header) return null;
    const items = db2.prepare(`
      SELECT pii.*, m.name as drug_name, m.generic_name, m.form, m.strength
      FROM purchase_invoice_items pii
      JOIN drug_master m ON m.id=pii.drug_master_id
      WHERE pii.invoice_id=?
      ORDER BY pii.id
    `).all(id);
    return { ...header, items };
  });
  electron.ipcMain.handle("purchase:create", (_e, payload) => {
    const db2 = getDb();
    const tx = db2.transaction(() => {
      const info = db2.prepare(`
        INSERT INTO purchase_invoices
          (invoice_number, wholesaler_id, invoice_date, received_date,
           subtotal, cgst, sgst, igst, discount, total,
           payment_mode, payment_status, scan_path, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.invoice_number,
        payload.wholesaler_id,
        payload.invoice_date,
        payload.received_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        payload.subtotal ?? 0,
        payload.cgst ?? 0,
        payload.sgst ?? 0,
        payload.igst ?? 0,
        payload.discount ?? 0,
        payload.total ?? 0,
        payload.payment_mode ?? null,
        payload.payment_status ?? "unpaid",
        payload.scan_path ?? null,
        payload.notes ?? null
      );
      const invoiceId = Number(info.lastInsertRowid);
      const insLine = db2.prepare(`
        INSERT INTO purchase_invoice_items
          (invoice_id, drug_master_id, batch_no, expiry, qty_received, pack_qty,
           free_qty, purchase_price, mrp, gst_rate, manufacturer_license_no, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBatch = db2.prepare(`
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
      for (const it of payload.items || []) {
        const lineTotal = Number(it.line_total ?? Number(it.qty_received) * Number(it.purchase_price ?? 0));
        const lineInfo = insLine.run(
          invoiceId,
          it.drug_master_id,
          it.batch_no,
          it.expiry,
          Number(it.qty_received),
          it.pack_qty ?? null,
          Number(it.free_qty ?? 0),
          Number(it.purchase_price),
          Number(it.mrp),
          Number(it.gst_rate ?? 12),
          it.manufacturer_license_no ?? null,
          lineTotal
        );
        const lineId = Number(lineInfo.lastInsertRowid);
        const totalUnits = Number(it.qty_received) + Number(it.free_qty ?? 0);
        upsertBatch.run(
          it.drug_master_id,
          lineId,
          it.batch_no,
          it.expiry,
          totalUnits,
          totalUnits,
          it.purchase_price ?? null,
          it.mrp ?? 0,
          it.manufacturer_license_no ?? null
        );
      }
      return invoiceId;
    });
    const newId = tx();
    return db2.prepare("SELECT * FROM purchase_invoices WHERE id=?").get(newId);
  });
  electron.ipcMain.handle("purchase:attachScan", async (_e, invoiceId, fileDataUrl, ext) => {
    if (!invoiceId) return { ok: false, error: "Missing invoice id" };
    const userData = electron.app.getPath("userData");
    const dir = path.join(userData, "purchases");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeExt = (ext || "pdf").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "pdf";
    const fp = path.join(dir, `${invoiceId}.${safeExt}`);
    try {
      const base64 = fileDataUrl.replace(/^data:[^;]+;base64,/, "");
      fs.writeFileSync(fp, Buffer.from(base64, "base64"));
      getDb().prepare("UPDATE purchase_invoices SET scan_path=? WHERE id=?").run(fp, invoiceId);
      return { ok: true, path: fp };
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
    }
  });
  electron.ipcMain.handle("stock:register", (_e, filter = {}) => {
    const db2 = getDb();
    const conds = ["m.is_active=1"];
    if (filter.activeOnly !== false) conds.push("b.is_active=1");
    if (filter.includeExpired === false) conds.push("date(b.expiry) >= date('now')");
    return db2.prepare(`
      SELECT b.id, b.batch_no, b.expiry, b.qty_received, b.qty_remaining,
             b.purchase_price, b.mrp, b.manufacturer_license_no, b.received_at,
             m.id as drug_master_id, m.name as drug_name, m.generic_name,
             m.manufacturer, m.form, m.strength, m.schedule, m.hsn_code,
             CAST((julianday(b.expiry) - julianday('now')) AS INTEGER) as days_to_expiry
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id=b.drug_master_id
      WHERE ${conds.join(" AND ")}
      ORDER BY m.name, date(b.expiry)
    `).all();
  });
  electron.ipcMain.handle("purchase:register", (_e, filter) => {
    const db2 = getDb();
    const conds = ["date(pi.invoice_date) >= ?", "date(pi.invoice_date) <= ?"];
    const params = [filter.from, filter.to];
    if (filter.wholesaler_id) {
      conds.push("pi.wholesaler_id = ?");
      params.push(filter.wholesaler_id);
    }
    return db2.prepare(`
      SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.received_date,
             pi.subtotal, pi.cgst, pi.sgst, pi.igst, pi.discount, pi.total,
             pi.payment_mode, pi.payment_status, pi.notes,
             w.name as wholesaler_name, w.drug_license_no as wholesaler_license_no,
             w.gstin as wholesaler_gstin,
             (SELECT COUNT(*) FROM purchase_invoice_items pii WHERE pii.invoice_id=pi.id) as line_count
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id=pi.wholesaler_id
      WHERE ${conds.join(" AND ")}
      ORDER BY date(pi.invoice_date) ASC, pi.id ASC
    `).all(...params);
  });
  electron.ipcMain.handle("dispensing:register", (_e, filter) => {
    const db2 = getDb();
    const conds = ["date(dr.dispensed_at) >= ?", "date(dr.dispensed_at) <= ?"];
    const params = [filter.from, filter.to];
    if (filter.schedule) {
      conds.push("dr.schedule = ?");
      params.push(filter.schedule);
    }
    return db2.prepare(`
      SELECT dr.*,
        (p.first_name || ' ' || p.last_name) as patient_name,
        p.uhid as patient_uhid,
        m.name as drug_name,
        d.name as doctor_name
      FROM dispensing_register dr
      LEFT JOIN patients p ON p.id=dr.patient_id
      LEFT JOIN doctors d ON d.id=dr.doctor_id
      JOIN drug_master m ON m.id=dr.drug_master_id
      WHERE ${conds.join(" AND ")}
      ORDER BY dr.dispensed_at ASC
    `).all(...params);
  });
  electron.ipcMain.handle("ip:list", (_e, filter = {}) => {
    const db2 = getDb();
    const where = filter.status ? "WHERE a.status=?" : "";
    const params = filter.status ? [filter.status] : [];
    return db2.prepare(
      `SELECT a.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, p.phone as patient_phone, d.name as doctor_name
         FROM ip_admissions a
         JOIN patients p ON p.id=a.patient_id
         LEFT JOIN doctors d ON d.id=a.admission_doctor_id
         ${where}
         ORDER BY a.admitted_at DESC`
    ).all(...params);
  });
  electron.ipcMain.handle("ip:admit", (_e, payload) => {
    const db2 = getDb();
    const num = nextIpNumber(db2);
    const info = db2.prepare(
      "INSERT INTO ip_admissions (admission_number, patient_id, admission_doctor_id, bed_number, ward, admission_notes) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(num, payload.patient_id, payload.admission_doctor_id ?? null, payload.bed_number ?? null, payload.ward ?? null, payload.admission_notes ?? null);
    return db2.prepare("SELECT * FROM ip_admissions WHERE id=?").get(info.lastInsertRowid);
  });
  electron.ipcMain.handle("ip:discharge", (_e, id, payload) => {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (typeof payload === "string") {
      db2.prepare("UPDATE ip_admissions SET status='discharged', discharged_at=?, discharge_summary=? WHERE id=?").run(now, payload, id);
    } else {
      db2.prepare(`UPDATE ip_admissions SET
        status='discharged', discharged_at=?,
        discharge_diagnosis=?, condition_at_discharge=?,
        treatment_given=?, investigation_findings=?,
        operative_notes=?, discharge_medications_json=?,
        followup_plan=?, discharge_doctor_id=?,
        discharge_summary=?
        WHERE id=?`).run(
        now,
        payload.discharge_diagnosis ?? null,
        payload.condition_at_discharge ?? null,
        payload.treatment_given ?? null,
        payload.investigation_findings ?? null,
        payload.operative_notes ?? null,
        payload.discharge_medications_json ?? null,
        payload.followup_plan ?? null,
        payload.discharge_doctor_id ?? null,
        payload.discharge_summary ?? null,
        id
      );
    }
    return db2.prepare('SELECT a.*, (p.first_name||" "||p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name FROM ip_admissions a JOIN patients p ON p.id=a.patient_id LEFT JOIN doctors d ON d.id=a.admission_doctor_id WHERE a.id=?').get(id);
  });
  electron.ipcMain.handle("notifications:list", (_e, status) => {
    const db2 = getDb();
    const where = status ? "WHERE n.status = ?" : "";
    const params = status ? [status] : [];
    return db2.prepare(
      `SELECT n.*,
           (p.first_name || ' ' || p.last_name) as patient_name
         FROM notification_log n
         LEFT JOIN patients p ON p.id=n.patient_id
         ${where}
         ORDER BY n.created_at DESC LIMIT 500`
    ).all(...params);
  });
  electron.ipcMain.handle("settings:get", () => getAllSettings(getDb()));
  electron.ipcMain.handle("settings:save", (_e, patch) => {
    saveSettings(getDb(), patch);
    return getAllSettings(getDb());
  });
  const CLINICAL_TPL_KEY = "clinical_quick_templates";
  electron.ipcMain.handle("clinical-templates:list", () => {
    const db2 = getDb();
    const row = db2.prepare("SELECT value FROM settings WHERE key=?").get(CLINICAL_TPL_KEY);
    try {
      return row ? JSON.parse(row.value) : [];
    } catch {
      return [];
    }
  });
  electron.ipcMain.handle("clinical-templates:save", (_e, templates) => {
    const db2 = getDb();
    const json = JSON.stringify(templates);
    db2.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CLINICAL_TPL_KEY, json);
    return templates;
  });
  electron.ipcMain.handle("patients:log", (_e, filter) => {
    const db2 = getDb();
    const conditions = ["a.appointment_date >= ?", "a.appointment_date <= ?"];
    const params = [filter.from, filter.to];
    if (filter.doctor_id) {
      conditions.push("a.doctor_id = ?");
      params.push(filter.doctor_id);
    }
    if (filter.q && filter.q.trim()) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR p.phone LIKE ?)");
      const like = `%${filter.q.trim()}%`;
      params.push(like, like, like);
    }
    const where = "WHERE " + conditions.join(" AND ");
    const rows = db2.prepare(
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
    ).all(...params);
    const uniquePatients = new Set(rows.map((r) => r.patient_id)).size;
    const revenue = rows.reduce((s, r) => s + Number(r.bill_total || 0), 0);
    const byDate = /* @__PURE__ */ new Map();
    for (const r of rows) byDate.set(r.appointment_date, (byDate.get(r.appointment_date) || 0) + 1);
    const peakDay = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const daysCovered = byDate.size || 1;
    const avgPerDay = Math.round(rows.length / daysCovered * 10) / 10;
    const byDoctor = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const key = r.doctor_name;
      const cur = byDoctor.get(key) || { doctor: r.doctor_name, specialty: r.doctor_specialty, count: 0 };
      cur.count += 1;
      byDoctor.set(key, cur);
    }
    const byStatus = /* @__PURE__ */ new Map();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
    const patientFirstSeen = /* @__PURE__ */ new Map();
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
        byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count }))
      }
    };
  });
  electron.ipcMain.handle("reports:run", (_e, params) => {
    const db2 = getDb();
    const { kind, from, to } = params;
    const range = (col) => {
      const conds = [];
      const p = [];
      if (from) {
        conds.push(`date(${col}) >= ?`);
        p.push(from);
      }
      if (to) {
        conds.push(`date(${col}) <= ?`);
        p.push(to);
      }
      return { where: conds.length ? "WHERE " + conds.join(" AND ") : "", params: p };
    };
    if (kind === "daily_collection") {
      const r = range("b.created_at");
      return db2.prepare(
        `SELECT date(b.created_at) as day,
             COUNT(*) as bills,
             COALESCE(SUM(b.total), 0) as revenue,
             COALESCE(SUM(CASE WHEN b.payment_mode='Cash' THEN b.total ELSE 0 END), 0) as cash,
             COALESCE(SUM(CASE WHEN b.payment_mode='Card' THEN b.total ELSE 0 END), 0) as card,
             COALESCE(SUM(CASE WHEN b.payment_mode='UPI' THEN b.total ELSE 0 END), 0) as upi
           FROM bills b ${r.where} GROUP BY day ORDER BY day DESC`
      ).all(...r.params);
    }
    if (kind === "doctor_performance") {
      const r = range("a.appointment_date");
      return db2.prepare(
        `SELECT d.name as doctor, d.specialty,
             COUNT(a.id) as visits,
             COUNT(DISTINCT a.patient_id) as unique_patients,
             COALESCE(SUM(b.total), 0) as revenue
           FROM appointments a
           JOIN doctors d ON d.id=a.doctor_id
           LEFT JOIN bills b ON b.appointment_id=a.id
           ${r.where}
           GROUP BY d.id ORDER BY revenue DESC`
      ).all(...r.params);
    }
    if (kind === "top_diagnoses") {
      const r = range("a.appointment_date");
      return db2.prepare(
        `SELECT c.impression as diagnosis, COUNT(*) as count
           FROM consultations c
           JOIN appointments a ON a.id=c.appointment_id
           ${r.where}
           AND c.impression IS NOT NULL AND c.impression <> ''
           GROUP BY c.impression ORDER BY count DESC LIMIT 50`
      ).all(...r.params);
    }
    if (kind === "top_drugs") {
      const r = range("s.created_at");
      return db2.prepare(
        `SELECT si.drug_name as drug,
             SUM(si.qty) as qty_sold,
             COUNT(*) as sales,
             COALESCE(SUM(si.amount), 0) as revenue
           FROM pharmacy_sale_items si
           JOIN pharmacy_sales s ON s.id=si.sale_id
           ${r.where}
           GROUP BY si.drug_name ORDER BY revenue DESC LIMIT 50`
      ).all(...r.params);
    }
    if (kind === "new_patients") {
      const r = range("created_at");
      return db2.prepare(`SELECT date(created_at) as day, COUNT(*) as new_patients FROM patients ${r.where} GROUP BY day ORDER BY day DESC`).all(...r.params);
    }
    return [];
  });
  function copyDirRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const sp = path.join(src, entry.name);
      const dp = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDirRecursive(sp, dp);
      else fs.copyFileSync(sp, dp);
    }
  }
  const EXCEL_CELL_MAX = 32e3;
  function safeCellValue(v) {
    if (v === null || v === void 0) return "";
    if (typeof v === "string" && v.length > EXCEL_CELL_MAX) {
      return v.slice(0, EXCEL_CELL_MAX) + ` …[truncated, original ${v.length} chars]`;
    }
    return v;
  }
  function sanitizeRows(rows) {
    return rows.map((r) => {
      const out = {};
      for (const k of Object.keys(r)) out[k] = safeCellValue(r[k]);
      return out;
    });
  }
  function exportAllToXlsx(db2, destFile) {
    const EXPORTS = buildExportSpecs();
    const wb = XLSX__namespace.utils.book_new();
    const rowCounts = {};
    const sheets = [];
    for (const spec of EXPORTS) {
      try {
        const rawRows = db2.prepare(spec.sql).all();
        const rows = sanitizeRows(rawRows);
        const ws2 = XLSX__namespace.utils.json_to_sheet(rows.length ? rows : [{}]);
        const sheetName = spec.sheet.replace(/[\/\\?*\[\]]/g, "").slice(0, 31);
        XLSX__namespace.utils.book_append_sheet(wb, ws2, sheetName);
        rowCounts[sheetName] = rawRows.length;
        sheets.push(sheetName);
      } catch {
        rowCounts[spec.sheet] = -1;
      }
    }
    if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
    const buf = XLSX__namespace.write(wb, { bookType: "xlsx", type: "buffer" });
    fs.writeFileSync(destFile, buf);
    return { sheets, rowCounts };
  }
  function buildExportSpecs() {
    return [
      { sheet: "Patients", sql: `SELECT id, uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state, created_at FROM patients ORDER BY created_at DESC` },
      { sheet: "Doctors", sql: `SELECT id, name, specialty, qualifications, registration_no, phone, email, room_number, default_fee, is_active FROM doctors ORDER BY name` },
      { sheet: "Appointments", sql: `
        SELECT a.id, a.token_number, a.appointment_date, a.appointment_time, a.status, a.notes, a.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, d.specialty as doctor_specialty
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC, a.appointment_time DESC` },
      { sheet: "Consultations", sql: `
        SELECT c.id, c.appointment_id, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, c.history, c.vitals_json, c.examination, c.impression, c.advice, c.follow_up_date, c.created_at
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        ORDER BY c.created_at DESC` },
      { sheet: "Prescriptions", sql: `
        SELECT r.id, r.appointment_id, a.appointment_date, p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name, r.drug_name, r.dosage, r.frequency, r.duration, r.instructions
        FROM prescription_items r
        JOIN appointments a ON a.id = r.appointment_id
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        ORDER BY a.appointment_date DESC` },
      { sheet: "Bills", sql: `
        SELECT b.id, b.bill_number, b.total, b.subtotal, b.discount, b.discount_type, b.payment_mode,
               b.paid_at, b.created_at, b.items_json,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM bills b
        LEFT JOIN patients p ON p.id = b.patient_id
        LEFT JOIN appointments a ON a.id = b.appointment_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        ORDER BY b.created_at DESC` },
      { sheet: "Lab Orders", sql: `
        SELECT o.id, o.order_number, o.status, o.ordered_at, o.collected_at, o.reported_at, o.notes,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as doctor_name
        FROM lab_orders o
        JOIN patients p ON p.id = o.patient_id
        LEFT JOIN doctors d ON d.id = o.doctor_id
        ORDER BY o.ordered_at DESC` },
      { sheet: "Lab Results", sql: `
        SELECT oi.id, oi.lab_order_id, lo.order_number, oi.test_name, oi.result, oi.unit, oi.ref_range, oi.is_abnormal,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM lab_order_items oi
        JOIN lab_orders lo ON lo.id = oi.lab_order_id
        JOIN patients p ON p.id = lo.patient_id
        ORDER BY lo.ordered_at DESC` },
      { sheet: "Lab Test Catalog", sql: `SELECT * FROM lab_tests ORDER BY name` },
      { sheet: "Pharmacy Sales", sql: `
        SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.payment_mode, s.created_at,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name
        FROM pharmacy_sales s
        LEFT JOIN patients p ON p.id = s.patient_id
        ORDER BY s.created_at DESC` },
      { sheet: "Pharmacy Sale Items", sql: `
        SELECT si.id, si.sale_id, s.sale_number, s.created_at as sale_date,
               si.drug_name, si.qty, si.rate, si.amount
        FROM pharmacy_sale_items si
        JOIN pharmacy_sales s ON s.id = si.sale_id
        ORDER BY s.created_at DESC` },
      { sheet: "Pharmacy Inventory (legacy)", sql: `SELECT * FROM drug_inventory ORDER BY name` },
      { sheet: "Drug Master", sql: `
        SELECT id, name, generic_name, manufacturer, form, strength, pack_size,
               schedule, hsn_code, gst_rate, default_mrp, low_stock_threshold,
               barcode, is_active, notes, created_at
        FROM drug_master ORDER BY name
      ` },
      { sheet: "Drug Stock Batches", sql: `
        SELECT b.id, m.name as drug_name, b.batch_no, b.expiry,
               b.qty_received, b.qty_remaining, b.purchase_price, b.mrp,
               b.manufacturer_license_no, b.received_at, b.is_active
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
        ORDER BY m.name, date(b.expiry)
      ` },
      { sheet: "Wholesalers", sql: `
        SELECT id, name, contact_person, phone, email, address,
               drug_license_no, gstin, is_active, notes, created_at
        FROM wholesalers ORDER BY name
      ` },
      { sheet: "Purchase Invoices", sql: `
        SELECT pi.id, pi.invoice_number, w.name as wholesaler_name,
               w.drug_license_no as wholesaler_license_no,
               pi.invoice_date, pi.received_date, pi.subtotal, pi.cgst, pi.sgst, pi.igst,
               pi.discount, pi.total, pi.payment_mode, pi.payment_status,
               pi.scan_path, pi.notes, pi.created_at
        FROM purchase_invoices pi
        JOIN wholesalers w ON w.id=pi.wholesaler_id
        ORDER BY date(pi.invoice_date) DESC
      ` },
      { sheet: "Purchase Invoice Items", sql: `
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
      ` },
      { sheet: "Dispensing Register", sql: `
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
      ` },
      { sheet: "IP Admissions", sql: `
        SELECT a.id, a.admission_number, a.admitted_at, a.discharged_at, a.ward, a.bed_number,
               a.status, a.admission_notes, a.discharge_summary,
               p.uhid as patient_uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.name as admission_doctor
        FROM ip_admissions a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.admission_doctor_id
        ORDER BY a.admitted_at DESC` },
      { sheet: "EMR Allergies", sql: `
        SELECT a.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               a.allergen, a.reaction, a.severity, a.noted_at
        FROM patient_allergies a JOIN patients p ON p.id = a.patient_id` },
      { sheet: "EMR Conditions", sql: `
        SELECT c.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               c.condition, c.since, c.notes, c.is_active
        FROM patient_conditions c JOIN patients p ON p.id = c.patient_id` },
      { sheet: "EMR Family History", sql: `
        SELECT f.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               f.relation, f.condition, f.notes
        FROM patient_family_history f JOIN patients p ON p.id = f.patient_id` },
      { sheet: "EMR Immunizations", sql: `
        SELECT i.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               i.vaccine, i.given_at, i.dose, i.notes
        FROM patient_immunizations i JOIN patients p ON p.id = i.patient_id` },
      { sheet: "EMR Documents Index", sql: `
        SELECT d.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               d.file_name, d.file_type, d.size_bytes, d.note, d.uploaded_at, d.file_path
        FROM patient_documents d JOIN patients p ON p.id = d.patient_id
        ORDER BY d.uploaded_at DESC` },
      { sheet: "Notifications", sql: `
        SELECT n.id, p.uhid, (p.first_name || ' ' || p.last_name) as patient_name,
               n.type, n.message, n.status, n.sent_at, n.created_at
        FROM notification_log n LEFT JOIN patients p ON p.id = n.patient_id
        ORDER BY n.created_at DESC` },
      { sheet: "Audit Log", sql: `SELECT id, at, username, role, action, entity, entity_id, details FROM audit_log ORDER BY at DESC` },
      { sheet: "Users", sql: `SELECT id, username, role, display_name, doctor_id, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC` },
      { sheet: "Settings", sql: `SELECT key, value FROM settings WHERE key NOT IN ('admin_password', 'clinic_logo') ORDER BY key` }
    ];
  }
  function validateFolderPath(p) {
    if (!p) return null;
    if (/^https?:\/\//i.test(p.trim())) return "Backup folder is a web URL (http/https). You need a LOCAL folder path like G:\\My Drive\\CureDesk Backups — install Google Drive for Desktop and use the folder it creates.";
    if (p.includes("drive.google.com")) return "That is a Google Drive sharing link, not a folder on this PC. Install Google Drive for Desktop and point this at the synced folder (usually G:\\My Drive\\...).";
    return null;
  }
  function countFilesRec(dir) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countFilesRec(path.join(dir, e.name));
      else n += 1;
    }
    return n;
  }
  function retainLast(dir, n) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir).map((name) => ({ name, full: path.join(dir, name), t: fs.statSync(path.join(dir, name)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of items.slice(n)) {
      try {
        const st = fs.statSync(old.full);
        if (st.isDirectory()) fs.rmSync(old.full, { recursive: true, force: true });
        else fs.unlinkSync(old.full);
      } catch {
      }
    }
  }
  function dateParts(d = /* @__PURE__ */ new Date()) {
    const pad2 = (n) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    return { day, time };
  }
  async function performBackupToRoot(root, label = "backup") {
    const userData = electron.app.getPath("userData");
    const sqliteSrc = path.join(userData, "caredesk.sqlite");
    const docsSrc = path.join(userData, "documents");
    const { day, time } = dateParts();
    const folderName = label === "pre-restore" ? `pre-restore-${time}` : time;
    const bundleDir = path.join(root, "sqlite", day, folderName);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dbDest = path.join(bundleDir, "caredesk.sqlite");
    try {
      await getDb().backup(dbDest);
    } catch {
      fs.copyFileSync(sqliteSrc, dbDest);
    }
    if (fs.existsSync(docsSrc)) copyDirRecursive(docsSrc, path.join(bundleDir, "documents"));
    const documentCount = countFilesRec(docsSrc);
    const excelDayDir = path.join(root, "excel", day);
    fs.mkdirSync(excelDayDir, { recursive: true });
    const xlsxFile = path.join(excelDayDir, `${folderName}.xlsx`);
    const xlsx = exportAllToXlsx(getDb(), xlsxFile);
    const manifest = {
      app: "CureDesk HMS",
      version: electron.app.getVersion(),
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      kind: label,
      sqlite_path: dbDest,
      xlsx_path: xlsxFile,
      sqlite_size_bytes: fs.statSync(dbDest).size,
      xlsx_size_bytes: fs.statSync(xlsxFile).size,
      document_files: documentCount,
      sheets: xlsx.sheets,
      sheet_row_counts: xlsx.rowCounts,
      note: "If the app is unusable, open the .xlsx file in Excel or Google Sheets — every table is a sheet inside it."
    };
    fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const settings = getAllSettings(getDb());
    if (!settings.keep_all_backups) {
      retainLast(path.join(root, "sqlite", day), 10);
      retainLast(path.join(root, "excel", day), 10);
      retainLast(path.join(root, "sqlite"), 30);
      retainLast(path.join(root, "excel"), 30);
    }
    const totalBackups = fs.existsSync(path.join(root, "sqlite")) ? fs.readdirSync(path.join(root, "sqlite")).reduce((acc, dayDir) => {
      const p = path.join(root, "sqlite", dayDir);
      if (!fs.statSync(p).isDirectory()) return acc;
      return acc + fs.readdirSync(p).filter((x) => fs.statSync(path.join(p, x)).isDirectory()).length;
    }, 0) : 0;
    return { ok: true, bundleDir, xlsxFile, documentCount, totalBackups };
  }
  async function performBackup() {
    const s = getAllSettings(getDb());
    const invalid = validateFolderPath(s.backup_folder);
    if (invalid) throw new Error(invalid);
    const root = s.backup_folder || path.join(electron.app.getPath("userData"), "backups");
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const r = await performBackupToRoot(root, "backup");
    logAudit(getDb(), null, "backup_run", "backups", void 0, `${r.bundleDir} · ${r.documentCount} docs`);
    return { path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, totalBundles: r.totalBackups, documentCount: r.documentCount };
  }
  electron.ipcMain.handle("backup:now", async () => performBackup());
  _performBackupToRoot = performBackupToRoot;
  async function performBackupTo(targetDir) {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const r = await performBackupToRoot(targetDir, "backup");
    logAudit(getDb(), null, "backup_to_external", "backups", void 0, r.bundleDir);
    return { ok: true, path: r.bundleDir, bundleDir: r.bundleDir, xlsxFile: r.xlsxFile, documentCount: r.documentCount };
  }
  electron.ipcMain.handle("backup:nowTo", async (_e, targetDir) => {
    if (!targetDir) return { ok: false, error: "No folder selected" };
    const invalid = validateFolderPath(targetDir);
    if (invalid) return { ok: false, error: invalid };
    try {
      return await performBackupTo(targetDir);
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || "Failed" };
    }
  });
  electron.ipcMain.handle("dialog:pickFolder", async (_e, opts = {}) => {
    const win = electron.BrowserWindow.getFocusedWindow() || electron.BrowserWindow.getAllWindows()[0];
    const r = await electron.dialog.showOpenDialog(win, {
      title: opts.title || "Pick a folder",
      defaultPath: opts.defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });
  electron.ipcMain.handle("dialog:pickFile", async (_e, opts = {}) => {
    const win = electron.BrowserWindow.getFocusedWindow() || electron.BrowserWindow.getAllWindows()[0];
    const r = await electron.dialog.showOpenDialog(win, {
      title: opts.title || "Pick a file",
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      properties: ["openFile"]
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });
  const COUNT_TABLES = [
    "patients",
    "appointments",
    "bills",
    "prescription_items",
    "lab_orders",
    "lab_order_items",
    "pharmacy_sales",
    "pharmacy_sale_items",
    "ip_admissions",
    "consultations",
    // Pharmacy compliance v2 tables
    "drug_master",
    "drug_stock_batches",
    "wholesalers",
    "purchase_invoices",
    "purchase_invoice_items",
    "dispensing_register",
    // Legacy (kept as safety net during v0.2.x; remove in v0.3.0)
    "drug_inventory",
    "doctors",
    "users",
    "notification_log",
    "audit_log",
    "patient_documents",
    "patient_allergies",
    "patient_conditions"
  ];
  function countTablesIn(sqlitePath) {
    const db2 = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const counts = {};
      let totalRows = 0;
      for (const t of COUNT_TABLES) {
        try {
          const r = db2.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
          counts[t] = r.c;
          totalRows += r.c;
        } catch {
          counts[t] = null;
        }
      }
      return { counts, totalRows };
    } finally {
      db2.close();
    }
  }
  function parseBackupTimestamp(sourcePath, sqliteFilePath) {
    const m = sourcePath.replace(/\\/g, "/").match(/sqlite\/(\d{4}-\d{2}-\d{2})\/(\d{2})-(\d{2})-(\d{2})(?:\/|$)/);
    if (m) {
      const [, date, hh, mm, ss] = m;
      const local = /* @__PURE__ */ new Date(`${date}T${hh}:${mm}:${ss}`);
      if (!isNaN(local.getTime())) return local.toISOString();
    }
    try {
      const st = fs.statSync(sqliteFilePath);
      return st.mtime.toISOString();
    } catch {
      return null;
    }
  }
  function resolveSourceSqlite(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return { ok: false, error: "Source path does not exist" };
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      const cand = path.join(sourcePath, "caredesk.sqlite");
      if (!fs.existsSync(cand)) return { ok: false, error: "Folder does not contain caredesk.sqlite (not a valid CureDesk bundle)" };
      const docsDir = path.join(sourcePath, "documents");
      return { ok: true, sqlitePath: cand, docsDir: fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory() ? docsDir : null };
    }
    if (!sourcePath.toLowerCase().endsWith(".sqlite") && !sourcePath.toLowerCase().endsWith(".db")) {
      return { ok: false, error: "Pick a .sqlite file or a CureDesk bundle folder" };
    }
    return { ok: true, sqlitePath: sourcePath, docsDir: null };
  }
  electron.ipcMain.handle("backup:previewRestore", async (_e, sourcePath) => {
    try {
      const resolved = resolveSourceSqlite(sourcePath);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const backupTakenAt = parseBackupTimestamp(sourcePath, resolved.sqlitePath);
      let backup;
      try {
        backup = countTablesIn(resolved.sqlitePath);
      } catch (e) {
        return { ok: false, error: "Could not read backup database: " + ((e == null ? void 0 : e.message) || e) };
      }
      const userData = electron.app.getPath("userData");
      const currentDbPath = path.join(userData, "caredesk.sqlite");
      let current = { counts: {}, totalRows: 0 };
      try {
        const db2 = getDb();
        for (const t of COUNT_TABLES) {
          try {
            const r = db2.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
            current.counts[t] = r.c;
            current.totalRows += r.c;
          } catch {
            current.counts[t] = null;
          }
        }
      } catch {
      }
      let docsCount = null;
      if (resolved.docsDir) {
        try {
          docsCount = fs.readdirSync(resolved.docsDir).length;
        } catch {
          docsCount = null;
        }
      }
      return {
        ok: true,
        sourcePath,
        sqlitePath: resolved.sqlitePath,
        hasBundleDocs: !!resolved.docsDir,
        documentFileCount: docsCount,
        backupTakenAt,
        backup,
        current,
        currentDbPath
      };
    } catch (e) {
      return { ok: false, error: (e == null ? void 0 : e.message) || String(e) };
    }
  });
  electron.ipcMain.handle("backup:restore", async (_e, sourcePath, confirmPhrase) => {
    if (confirmPhrase !== "REPLACE ALL DATA") {
      return { ok: false, error: "Confirmation phrase required to proceed" };
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: "Source path does not exist" };
    }
    const stat = fs.statSync(sourcePath);
    let sourceSqlite;
    let sourceDocs = null;
    if (stat.isDirectory()) {
      const candidate = path.join(sourcePath, "caredesk.sqlite");
      if (!fs.existsSync(candidate)) {
        return { ok: false, error: "Folder does not contain caredesk.sqlite (not a valid CureDesk bundle)" };
      }
      sourceSqlite = candidate;
      const docsDir = path.join(sourcePath, "documents");
      if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) sourceDocs = docsDir;
    } else {
      if (!sourcePath.toLowerCase().endsWith(".sqlite")) {
        return { ok: false, error: "Pick a .sqlite file or a CureDesk bundle folder" };
      }
      sourceSqlite = sourcePath;
    }
    const userData = electron.app.getPath("userData");
    const currentDb = path.join(userData, "caredesk.sqlite");
    const currentDocs = path.join(userData, "documents");
    try {
      const s = getAllSettings(getDb());
      const safeDir = s.backup_folder || path.join(userData, "backups");
      if (!fs.existsSync(safeDir)) fs.mkdirSync(safeDir, { recursive: true });
      const r = await performBackupToRoot(safeDir, "pre-restore");
      logAudit(getDb(), null, "pre_restore_backup", "backups", void 0, r.bundleDir);
    } catch (e) {
      return { ok: false, error: "Could not make safety backup of current data: " + ((e == null ? void 0 : e.message) || e) };
    }
    closeDb();
    try {
      for (const sidecar of ["caredesk.sqlite-wal", "caredesk.sqlite-shm"]) {
        const p = path.join(userData, sidecar);
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
          }
        }
      }
      fs.copyFileSync(sourceSqlite, currentDb);
    } catch (e) {
      return { ok: false, error: "Failed to copy new database: " + ((e == null ? void 0 : e.message) || e) };
    }
    try {
      if (sourceDocs) {
        if (fs.existsSync(currentDocs)) fs.rmSync(currentDocs, { recursive: true, force: true });
        copyDirRecursive(sourceDocs, currentDocs);
      }
    } catch (e) {
      return { ok: false, error: "DB restored but documents copy failed: " + ((e == null ? void 0 : e.message) || e) };
    }
    logAudit(getDb(), null, "restore_completed", "backups", void 0, sourcePath);
    setTimeout(() => {
      electron.app.relaunch();
      electron.app.exit(0);
    }, 300);
    return { ok: true, restartIn: 1e3 };
  });
  electron.ipcMain.handle("backup:list", () => {
    const userData = electron.app.getPath("userData");
    const s = getAllSettings(getDb());
    const dir = s.backup_folder || path.join(userData, "backups");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.startsWith("caredesk-") && f.endsWith(".sqlite")).map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, path: p, size: st.size, mtime: st.mtime.toISOString() };
    }).sort((a, b) => b.mtime.localeCompare(a.mtime));
  });
  electron.ipcMain.handle("backup:open", () => {
    const s = getAllSettings(getDb());
    const dir = s.backup_folder || path.join(electron.app.getPath("userData"), "backups");
    electron.shell.openPath(dir);
  });
  function scanBackupStatus(dir) {
    if (!fs.existsSync(dir)) return { lastBackupAt: null, lastBackupName: null, totalBackups: 0, dir };
    const sqliteRoot = path.join(dir, "sqlite");
    let latestMtime = 0;
    let latestPath = null;
    let total = 0;
    if (fs.existsSync(sqliteRoot)) {
      for (const day of fs.readdirSync(sqliteRoot)) {
        const dayDir = path.join(sqliteRoot, day);
        try {
          if (!fs.statSync(dayDir).isDirectory()) continue;
        } catch {
          continue;
        }
        for (const time of fs.readdirSync(dayDir)) {
          const timeDir = path.join(dayDir, time);
          try {
            if (!fs.statSync(timeDir).isDirectory()) continue;
          } catch {
            continue;
          }
          const dbFile = path.join(timeDir, "caredesk.sqlite");
          if (fs.existsSync(dbFile)) {
            total++;
            const mt = fs.statSync(dbFile).mtimeMs;
            if (mt > latestMtime) {
              latestMtime = mt;
              latestPath = dbFile;
            }
          }
        }
      }
    }
    return {
      lastBackupAt: latestMtime ? new Date(latestMtime).toISOString() : null,
      lastBackupName: latestPath,
      totalBackups: total,
      dir
    };
  }
  electron.ipcMain.handle("backup:status", () => {
    const s = getAllSettings(getDb());
    const dir = s.backup_folder || path.join(electron.app.getPath("userData"), "backups");
    return scanBackupStatus(dir);
  });
  electron.ipcMain.handle("backup:quitAfter", async () => {
    const r = await performBackup();
    logAudit(getDb(), null, "backup_and_close", "backups", void 0, r.bundleDir);
    closeDb();
    setTimeout(() => electron.app.quit(), 250);
    return { ok: true, path: r.bundleDir };
  });
  electron.ipcMain.handle("analytics:overview", () => {
    const db2 = getDb();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";
    const sc = (sql, ...p) => db2.prepare(sql).get(...p).c;
    const ss = (sql, ...p) => db2.prepare(sql).get(...p).t || 0;
    const scSafe = (sql, ...p) => {
      try {
        return sc(sql, ...p);
      } catch {
        return 0;
      }
    };
    const ssSafe = (sql, ...p) => {
      try {
        return ss(sql, ...p);
      } catch {
        return 0;
      }
    };
    return {
      asOf: (/* @__PURE__ */ new Date()).toISOString(),
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
      // All defensive: a fresh-from-old-binary DB without the migration columns
      // returns 0 instead of throwing and breaking the whole Overview tab.
      freeFollowupsThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_free_followup,0)=1 AND date(created_at) >= ?
      `, monthStart),
      relaxedFollowupsThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills
        WHERE COALESCE(is_relaxed_followup,0)=1 AND date(created_at) >= ?
      `, monthStart),
      registrationFeesThisMonth: ssSafe(`
        SELECT COALESCE(SUM(rate),0) as t
        FROM bills b, json_each(b.items_json) j
        WHERE date(b.created_at) >= ?
          AND lower(json_extract(j.value, '$.description')) LIKE '%registration%'
      `, monthStart),
      registrationFeeCountThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM patients WHERE registration_fee_paid=1 AND date(registration_fee_paid_at) >= ?
      `, monthStart),
      servicesCountThisMonth: scSafe(`
        SELECT COUNT(*) as c FROM bills WHERE bill_kind='misc' AND date(created_at) >= ?
      `, monthStart),
      servicesRevenueThisMonth: ssSafe(`
        SELECT COALESCE(SUM(total),0) as t FROM bills WHERE bill_kind='misc' AND date(created_at) >= ?
      `, monthStart)
    };
  });
  electron.ipcMain.handle("analytics:followups", (_e, opts = {}) => {
    const db2 = getDb();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const from = opts.from || today.slice(0, 8) + "01";
    const to = opts.to || today;
    const sc = (sql, ...p) => db2.prepare(sql).get(...p).c;
    const ss = (sql, ...p) => db2.prepare(sql).get(...p).t || 0;
    const freeCount = sc(`
      SELECT COUNT(*) as c FROM bills
      WHERE COALESCE(is_free_followup,0)=1 AND date(created_at) BETWEEN ? AND ?
    `, from, to);
    const relaxedCount = sc(`
      SELECT COUNT(*) as c FROM bills
      WHERE COALESCE(is_relaxed_followup,0)=1 AND date(created_at) BETWEEN ? AND ?
    `, from, to);
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
      from,
      to,
      free_count: freeCount,
      relaxed_count: relaxedCount,
      total_waivers: freeCount + relaxedCount,
      revenue_forgone_free: forgoneFree,
      revenue_forgone_relaxed: forgoneRelaxed,
      revenue_forgone_total: forgoneFree + forgoneRelaxed
    };
  });
  electron.ipcMain.handle("analytics:demographics", () => {
    const db2 = getDb();
    const total = db2.prepare(`SELECT COUNT(*) as c FROM patients`).get().c;
    const revenueByGender = db2.prepare(`
      SELECT COALESCE(NULLIF(p.gender,''), '(unknown)') as label,
             COUNT(DISTINCT b.id) as bills,
             COALESCE(SUM(b.total), 0) as revenue
      FROM bills b JOIN patients p ON p.id = b.patient_id
      GROUP BY label ORDER BY revenue DESC
    `).all();
    const revenueByAge = db2.prepare(`
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
    const revenueByProfession = db2.prepare(`
      SELECT COALESCE(NULLIF(p.profession,''), '(unknown)') as label,
             COUNT(DISTINCT b.id) as bills,
             COALESCE(SUM(b.total), 0) as revenue
      FROM bills b JOIN patients p ON p.id = b.patient_id
      GROUP BY label ORDER BY revenue DESC LIMIT 20
    `).all();
    return {
      total,
      byGender: db2.prepare(`
        SELECT COALESCE(NULLIF(gender,''), '(unknown)') as gender, COUNT(*) as c
        FROM patients GROUP BY gender ORDER BY c DESC
      `).all(),
      revenueByGender,
      revenueByAge,
      revenueByProfession,
      byAgeGroup: db2.prepare(`
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
      byBloodGroup: db2.prepare(`
        SELECT COALESCE(NULLIF(blood_group,''), '(unknown)') as label, COUNT(*) as c
        FROM patients GROUP BY label ORDER BY c DESC
      `).all(),
      byProfession: db2.prepare(`
        SELECT COALESCE(NULLIF(profession,''), '(unknown)') as label, COUNT(*) as c
        FROM patients GROUP BY label ORDER BY c DESC LIMIT 20
      `).all(),
      newPatientsByMonth: db2.prepare(`
        SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as c
        FROM patients WHERE created_at >= date('now', '-12 months')
        GROUP BY month ORDER BY month
      `).all()
    };
  });
  electron.ipcMain.handle("analytics:retention", () => {
    const db2 = getDb();
    const rows = db2.prepare(`
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
    `).all();
    const compute = (windowDays, key) => {
      const eligible = rows.filter((r) => r.days_since_first >= windowDays);
      const returned = eligible.filter((r) => r[key] > 0);
      return {
        eligible: eligible.length,
        returned: returned.length,
        rate: eligible.length === 0 ? 0 : Math.round(returned.length / eligible.length * 1e3) / 10
      };
    };
    return {
      totalPatients: rows.length,
      window30: compute(30, "visits_30d"),
      window60: compute(60, "visits_60d"),
      window90: compute(90, "visits_90d")
    };
  });
  electron.ipcMain.handle("analytics:cohort", () => {
    const db2 = getDb();
    const rows = db2.prepare(`
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
    `).all();
    const byCohort = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!byCohort.has(r.cohort_month)) byCohort.set(r.cohort_month, []);
      byCohort.get(r.cohort_month).push(r);
    }
    const monthOffset = (a, b) => {
      const [ay, am] = a.split("-").map((x) => parseInt(x, 10));
      const [by, bm] = b.split("-").map((x) => parseInt(x, 10));
      return (by - ay) * 12 + (bm - am);
    };
    const cohorts = Array.from(byCohort.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cohort_month, items]) => {
      const retention = [];
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
  electron.ipcMain.handle("analytics:weekdayHourHeatmap", () => {
    const db2 = getDb();
    return db2.prepare(`
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
  electron.ipcMain.handle("analytics:pharmacyBasket", () => {
    const db2 = getDb();
    return db2.prepare(`
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
  electron.ipcMain.handle("analytics:pharmacyOverview", (_e, filter) => {
    const db2 = getDb();
    const sc = (sql, ...p) => db2.prepare(sql).get(...p).c;
    const ss = (sql, ...p) => db2.prepare(sql).get(...p).t || 0;
    return {
      totalDispensed: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE date(dispensed_at) BETWEEN ? AND ?`, filter.from, filter.to),
      scheduleHCount: sc(`SELECT COUNT(*) as c FROM dispensing_register WHERE date(dispensed_at) BETWEEN ? AND ? AND schedule IN ('H','H1')`, filter.from, filter.to),
      totalRevenue: ss(`SELECT COALESCE(SUM(total),0) as t FROM pharmacy_sales WHERE date(created_at) BETWEEN ? AND ?`, filter.from, filter.to),
      totalSales: sc(`SELECT COUNT(*) as c FROM pharmacy_sales WHERE date(created_at) BETWEEN ? AND ?`, filter.from, filter.to),
      topDrugs: db2.prepare(`
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
      salesMix: db2.prepare(`
        SELECT
          CASE WHEN appointment_id IS NULL THEN 'Counter Sale (walk-in)' ELSE 'Rx-driven (from doctor)' END as kind,
          COUNT(*) as count,
          COALESCE(SUM(total),0) as revenue
        FROM pharmacy_sales
        WHERE date(created_at) BETWEEN ? AND ?
        GROUP BY kind
      `).all(filter.from, filter.to),
      scheduleMix: db2.prepare(`
        SELECT schedule, COUNT(*) as count, SUM(qty) as units
        FROM dispensing_register
        WHERE date(dispensed_at) BETWEEN ? AND ?
        GROUP BY schedule
        ORDER BY count DESC
      `).all(filter.from, filter.to),
      lowStock: db2.prepare(`
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
      expiringSoon: db2.prepare(`
        SELECT m.name as drug_name, b.batch_no, b.expiry, b.qty_remaining,
               CAST((julianday(b.expiry) - julianday('now')) AS INTEGER) as days
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
        WHERE b.is_active=1 AND b.qty_remaining > 0
          AND date(b.expiry) BETWEEN date('now') AND date('now', '+90 days')
        ORDER BY date(b.expiry) ASC LIMIT 30
      `).all()
    };
  });
  electron.ipcMain.handle("origin:summary", (_e, filter) => {
    const db2 = getDb();
    const rows = db2.prepare(
      `SELECT a.patient_id,
                p.place, p.district, p.state,
                a.appointment_date
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.appointment_date >= ? AND a.appointment_date <= ?
           AND a.status <> 'Cancelled'`
    ).all(filter.from, filter.to);
    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const title = (s) => s.split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
    const byPlace = /* @__PURE__ */ new Map();
    const byDistrict = /* @__PURE__ */ new Map();
    const byState = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const placeKey = norm(r.place) || "__unknown__";
      const districtKey = norm(r.district) || "__unknown__";
      const stateKey = norm(r.state) || "__unknown__";
      const placeDisp = r.place ? title(norm(r.place)) : "Unknown";
      const districtDisp = r.district ? title(norm(r.district)) : "Unknown";
      const stateDisp = r.state ? title(norm(r.state)) : "Unknown";
      const p = byPlace.get(placeKey) || { display: placeDisp, visits: 0, patients: /* @__PURE__ */ new Set() };
      p.visits += 1;
      p.patients.add(r.patient_id);
      byPlace.set(placeKey, p);
      const d = byDistrict.get(districtKey) || { display: districtDisp, visits: 0, patients: /* @__PURE__ */ new Set() };
      d.visits += 1;
      d.patients.add(r.patient_id);
      byDistrict.set(districtKey, d);
      const s = byState.get(stateKey) || { display: stateDisp, visits: 0, patients: /* @__PURE__ */ new Set() };
      s.visits += 1;
      s.patients.add(r.patient_id);
      byState.set(stateKey, s);
    }
    const serialize = (m) => [...m.values()].map((v) => ({ name: v.display, visits: v.visits, patients: v.patients.size })).sort((a, b) => b.visits - a.visits);
    return {
      totalVisits: rows.length,
      uniquePatients: new Set(rows.map((r) => r.patient_id)).size,
      missingPlace: rows.filter((r) => !r.place).length,
      byPlace: serialize(byPlace),
      byDistrict: serialize(byDistrict),
      byState: serialize(byState)
    };
  });
  electron.ipcMain.handle("finance:summary", (_e, filter = {}) => {
    const db2 = getDb();
    const today = todayISO();
    const row = (sql, params = []) => db2.prepare(sql).get(...params);
    const all = (sql, params = []) => db2.prepare(sql).all(...params);
    const yesterday = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at)=date(?, '-1 day')", [today]);
    const todayTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at)=?", [today]);
    const weekTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-6 days')", [today]);
    const prevWeek = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-13 days') AND date(created_at) < date(?, '-6 days')", [today, today]);
    const monthTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', ?)", [today]);
    const prevMonth = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', date(?, 'start of month', '-1 day'))", [today]);
    const allTime = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills");
    const avg = row("SELECT COALESCE(AVG(total),0) as avg, COALESCE(MAX(total),0) as max FROM bills");
    const rangeFrom = filter.from || (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - 29);
      return d.toISOString().slice(0, 10);
    })();
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
    const byWeekday = all(
      `SELECT strftime('%w', created_at) as wd, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-89 days')
       GROUP BY wd ORDER BY wd`,
      [today]
    );
    const byHour = all(
      `SELECT strftime('%H', created_at) as hr, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-29 days')
       GROUP BY hr ORDER BY hr`,
      [today]
    );
    const topPatients = all(
      `SELECT p.id, (p.first_name || ' ' || p.last_name) as name, p.uhid, p.place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       GROUP BY p.id ORDER BY total DESC LIMIT 10`
    );
    const byPlace = all(
      `SELECT COALESCE(NULLIF(TRIM(p.place), ''), 'Unknown') as place,
              COALESCE(SUM(b.total),0) as total, COUNT(b.id) as bills
       FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE date(b.created_at) >= date(?, '-89 days')
       GROUP BY LOWER(TRIM(COALESCE(p.place,''))) ORDER BY total DESC LIMIT 15`,
      [today]
    );
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
        from: rangeFrom,
        to: rangeTo,
        bills: { total: rangeBills.t, count: rangeBills.c },
        pharma: { total: rangePharma.t, count: rangePharma.c }
      },
      compare30: {
        opd: { total: opd30.t, count: opd30.c },
        pharma: { total: pharma30.t, count: pharma30.c }
      },
      byDay,
      byWeek,
      byMonth,
      byMode,
      byDoctor,
      byWeekday,
      byHour,
      topPatients,
      byPlace
    };
  });
  electron.ipcMain.handle("stats:today", () => {
    const db2 = getDb();
    const date = todayISO();
    const total = db2.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=?").get(date);
    const waiting = db2.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Waiting'").get(date);
    const inprog = db2.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='In Progress'").get(date);
    const done = db2.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Done'").get(date);
    return { date, total: total.c, waiting: waiting.c, inprogress: inprog.c, done: done.c };
  });
}
const BASE = "https://graph.facebook.com/v21.0";
async function postJson(url, token, body) {
  var _a;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(((_a = json == null ? void 0 : json.error) == null ? void 0 : _a.message) ?? `HTTP ${res.status}`);
  return json;
}
async function getJson(url, token) {
  var _a;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(((_a = json == null ? void 0 : json.error) == null ? void 0 : _a.message) ?? `HTTP ${res.status}`);
  return json;
}
async function checkHealth(input) {
  try {
    const data = await getJson(
      `${BASE}/${input.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`,
      input.access_token
    );
    return {
      ok: true,
      display_name: data.verified_name ?? void 0,
      phone_number: data.display_phone_number ?? void 0,
      quality_rating: data.quality_rating ?? void 0
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function sendTemplate(phoneNumberId, accessToken, to, templateName, languageCode, components) {
  var _a, _b;
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components == null ? void 0 : components.length) ? { components } : {}
      }
    };
    const data = await postJson(`${BASE}/${phoneNumberId}/messages`, accessToken, payload);
    const wam_id = (_b = (_a = data == null ? void 0 : data.messages) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
    return { ok: true, wam_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function sendText(phoneNumberId, accessToken, to, body) {
  var _a, _b;
  try {
    const data = await postJson(`${BASE}/${phoneNumberId}/messages`, accessToken, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false }
    });
    const wam_id = (_b = (_a = data == null ? void 0 : data.messages) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
    return { ok: true, wam_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function listTemplates(wabaId, accessToken) {
  const data = await getJson(
    `${BASE}/${wabaId}/message_templates?fields=id,name,category,language,status,components`,
    accessToken
  );
  return (data == null ? void 0 : data.data) ?? [];
}
const metaApi = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  checkHealth,
  listTemplates,
  sendTemplate,
  sendText
}, Symbol.toStringTag, { value: "Module" }));
const MAX_ATTEMPTS = 3;
async function processQueue(db2) {
  const rows = db2.prepare(
    `SELECT q.id, q.account_id, q.to_phone, q.template_name, q.template_vars,
              q.attempts, a.phone_number_id, a.access_token_enc
       FROM wa_message_queue q
       JOIN wa_accounts a ON a.id = q.account_id
       WHERE q.status = 'pending'
         AND q.attempts < ?
         AND q.scheduled_at <= datetime('now')
         AND a.status = 'connected'
       ORDER BY q.scheduled_at
       LIMIT 20`
  ).all(MAX_ATTEMPTS);
  const updateStatus = db2.prepare(
    `UPDATE wa_message_queue SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = ? WHERE id = ?`
  );
  const logMessage = db2.prepare(
    `INSERT INTO wa_messages (account_id, wam_id, patient_id, direction, message_type, content, status, timestamp)
     SELECT account_id, ?, patient_id, 'outbound', 'template', ?, 'sent', datetime('now')
     FROM wa_message_queue WHERE id = ?`
  );
  for (const row of rows) {
    let vars = {};
    try {
      if (row.template_vars) vars = JSON.parse(row.template_vars);
    } catch {
    }
    const bodyParams = Object.entries(vars).filter(([k]) => !isNaN(Number(k))).sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => ({ type: "text", text: v }));
    const components = bodyParams.length ? [{ type: "body", parameters: bodyParams }] : void 0;
    const result = await sendTemplate(
      row.phone_number_id,
      row.access_token_enc,
      row.to_phone,
      row.template_name,
      vars.lang ?? "en",
      components
    );
    if (result.ok) {
      updateStatus.run("sent", null, (/* @__PURE__ */ new Date()).toISOString(), row.id);
      logMessage.run(result.wam_id ?? null, JSON.stringify({ template: row.template_name, vars }), row.id);
    } else {
      const isFinal = row.attempts + 1 >= MAX_ATTEMPTS;
      updateStatus.run(isFinal ? "failed" : "pending", result.error ?? null, null, row.id);
    }
  }
}
function obscure(token) {
  const key = "CureDesk-WA-v1";
  return Buffer.from(
    token.split("").map((c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length)).join(",")
  ).toString("base64");
}
function reveal(enc) {
  const key = "CureDesk-WA-v1";
  return Buffer.from(enc, "base64").toString().split(",").map((n, i) => String.fromCharCode(parseInt(n) ^ key.charCodeAt(i % key.length))).join("");
}
function registerWhatsAppIpc() {
  const db2 = () => getDb();
  electron.ipcMain.handle("wa:connect", async (_e, input) => {
    const health = await checkHealth({ phone_number_id: input.phone_number_id, access_token: input.access_token });
    if (!health.ok) return { ok: false, error: health.error };
    const token = obscure(input.access_token);
    const verifyToken = crypto.randomUUID();
    const d = db2();
    const existing = d.prepare(`SELECT id FROM wa_accounts WHERE phone_number_id = ?`).get(input.phone_number_id);
    if (existing) {
      d.prepare(
        `UPDATE wa_accounts SET waba_id=?, display_name=?, phone_number=?, access_token_enc=?,
         status='connected', last_health_check=datetime('now'), updated_at=datetime('now')
         WHERE phone_number_id=?`
      ).run(input.waba_id, input.display_name || health.display_name, input.phone_number || health.phone_number, token, input.phone_number_id);
      return { ok: true, id: existing.id };
    }
    const result = d.prepare(
      `INSERT INTO wa_accounts (phone_number_id, waba_id, display_name, phone_number, access_token_enc,
       webhook_verify_token, status, last_health_check)
       VALUES (?, ?, ?, ?, ?, ?, 'connected', datetime('now'))`
    ).run(input.phone_number_id, input.waba_id, input.display_name || health.display_name, input.phone_number || health.phone_number, token, verifyToken);
    return { ok: true, id: result.lastInsertRowid };
  });
  electron.ipcMain.handle("wa:health", async (_e, accountId) => {
    const acct = db2().prepare(`SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id = ?`).get(accountId);
    if (!acct) return { ok: false, error: "Account not found" };
    const result = await checkHealth({ phone_number_id: acct.phone_number_id, access_token: reveal(acct.access_token_enc) });
    if (result.ok) {
      db2().prepare(`UPDATE wa_accounts SET status='connected', last_health_check=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(accountId);
    } else {
      db2().prepare(`UPDATE wa_accounts SET status='error', updated_at=datetime('now') WHERE id=?`).run(accountId);
    }
    return result;
  });
  electron.ipcMain.handle("wa:disconnect", (_e, accountId) => {
    db2().prepare(`UPDATE wa_accounts SET status='disconnected', updated_at=datetime('now') WHERE id=?`).run(accountId);
    return { ok: true };
  });
  electron.ipcMain.handle("wa:account", (_e, accountId) => {
    return db2().prepare(`SELECT id, phone_number_id, waba_id, display_name, phone_number, webhook_verify_token, status, last_health_check, created_at, updated_at FROM wa_accounts WHERE id=?`).get(accountId);
  });
  electron.ipcMain.handle("wa:accounts", () => {
    return db2().prepare(`SELECT id, phone_number_id, waba_id, display_name, phone_number, webhook_verify_token, status, last_health_check, created_at, updated_at FROM wa_accounts ORDER BY id`).all();
  });
  electron.ipcMain.handle("wa:templates", (_e, accountId) => {
    const rows = db2().prepare(`SELECT * FROM wa_templates WHERE account_id=? ORDER BY name`).all(accountId);
    return rows.map((r) => ({ ...r, components: JSON.parse(r.components ?? "[]"), is_active: Boolean(r.is_active) }));
  });
  electron.ipcMain.handle("wa:syncTemplates", async (_e, accountId) => {
    const acct = db2().prepare(`SELECT waba_id, access_token_enc FROM wa_accounts WHERE id=?`).get(accountId);
    if (!acct) return { ok: false, error: "Account not found" };
    try {
      const templates = await listTemplates(acct.waba_id, reveal(acct.access_token_enc));
      const upsert = db2().prepare(
        `INSERT INTO wa_templates (account_id, name, category, language, status, components, meta_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, name) DO UPDATE SET
           category=excluded.category, language=excluded.language, status=excluded.status,
           components=excluded.components, meta_id=excluded.meta_id, updated_at=datetime('now')`
      );
      const tx = db2().transaction(() => {
        for (const t of templates) {
          upsert.run(accountId, t.name, t.category, t.language, t.status, JSON.stringify(t.components), t.id);
        }
      });
      tx();
      return { ok: true, synced: templates.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  electron.ipcMain.handle("wa:automationRules", (_e, accountId) => {
    return db2().prepare(`SELECT * FROM wa_automation_rules WHERE account_id=? ORDER BY trigger`).all(accountId);
  });
  electron.ipcMain.handle("wa:setRule", (_e, accountId, trigger, patch) => {
    const existing = db2().prepare(`SELECT id FROM wa_automation_rules WHERE account_id=? AND trigger=?`).get(accountId, trigger);
    if (existing) {
      const sets = Object.keys(patch).map((k) => `${k}=?`).join(", ");
      db2().prepare(`UPDATE wa_automation_rules SET ${sets} WHERE id=?`).run(...Object.values(patch), existing.id);
    } else {
      db2().prepare(
        `INSERT INTO wa_automation_rules (account_id, trigger, template_name, is_enabled, delay_minutes, extra_config)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(accountId, trigger, patch.template_name ?? "", patch.is_enabled ? 1 : 0, patch.delay_minutes ?? 0, patch.extra_config ? JSON.stringify(patch.extra_config) : null);
    }
    return { ok: true };
  });
  electron.ipcMain.handle("wa:queueStats", (_e, accountId) => {
    const d = db2();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const pending = d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='pending'`).get(accountId).c;
    const sent = d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='sent' AND date(sent_at)=?`).get(accountId, today).c;
    const failed = d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='failed' AND date(created_at)=?`).get(accountId, today).c;
    return { pending, sent_today: sent, failed_today: failed, total_today: sent + failed };
  });
  electron.ipcMain.handle("wa:queueSend", (_e, accountId, toPhone, templateName, vars, patientId, appointmentId) => {
    db2().prepare(
      `INSERT INTO wa_message_queue (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(accountId, toPhone, patientId ?? null, appointmentId ?? null, templateName, JSON.stringify(vars));
    return { ok: true };
  });
  electron.ipcMain.handle("wa:processQueue", async (_e, accountId) => {
    await processQueue(db2());
    return { ok: true };
  });
  electron.ipcMain.handle("wa:messages", (_e, accountId, conversationId, limit = 80) => {
    const rows = db2().prepare(
      `SELECT * FROM wa_messages WHERE account_id=? AND conversation_id=? ORDER BY timestamp ASC LIMIT ?`
    ).all(accountId, conversationId, limit);
    return rows;
  });
  electron.ipcMain.handle("wa:conversations", (_e, accountId, status = "open") => {
    return db2().prepare(
      `SELECT c.*,
              p.first_name || ' ' || p.last_name as patient_name,
              p.phone as patient_phone,
              (SELECT content FROM wa_messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_msg_content,
              (SELECT direction FROM wa_messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_msg_direction,
              (SELECT COUNT(*) FROM wa_messages WHERE conversation_id=c.id AND direction='inbound' AND status='delivered') as unread_count
       FROM wa_conversations c
       LEFT JOIN patients p ON p.id = c.patient_id
       WHERE c.account_id=? AND c.status=?
       ORDER BY c.last_message_at DESC`
    ).all(accountId, status);
  });
  electron.ipcMain.handle("wa:sendText", async (_e, accountId, conversationId, text) => {
    const d = db2();
    const acct = d.prepare(`SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id=?`).get(accountId);
    const conv = d.prepare(`SELECT phone FROM wa_conversations WHERE id=?`).get(conversationId);
    if (!acct || !conv) return { ok: false, error: "Account or conversation not found" };
    const { sendText: sendText2 } = await Promise.resolve().then(() => metaApi);
    const result = await sendText2(acct.phone_number_id, reveal(acct.access_token_enc), conv.phone, text);
    if (result.ok) {
      d.prepare(
        `INSERT INTO wa_messages (account_id, wam_id, conversation_id, direction, message_type, content, status, timestamp)
         VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', datetime('now'))`
      ).run(accountId, result.wam_id ?? null, conversationId, JSON.stringify({ text }));
      d.prepare(`UPDATE wa_conversations SET last_message_at=datetime('now') WHERE id=?`).run(conversationId);
    }
    return result;
  });
  electron.ipcMain.handle("wa:sendFeedbackRequest", async (_e, accountId, conversationId) => {
    const d = db2();
    const acct = d.prepare(`SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id=?`).get(accountId);
    const conv = d.prepare(
      `SELECT c.phone, p.first_name, p.last_name FROM wa_conversations c LEFT JOIN patients p ON p.id=c.patient_id WHERE c.id=?`
    ).get(conversationId);
    if (!acct || !conv) return { ok: false, error: "Account or conversation not found" };
    const get = (k) => {
      var _a;
      return ((_a = d.prepare(`SELECT value FROM settings WHERE key=?`).get(k)) == null ? void 0 : _a.value) ?? "";
    };
    const clinicName = get("clinic_name") || "our clinic";
    const reviewUrl = get("google_review_url");
    const patientName = [conv.first_name, conv.last_name].filter(Boolean).join(" ") || "there";
    const urlLine = reviewUrl ? `

⭐ Rate us on Google:
${reviewUrl}` : "";
    const body = `Hi ${patientName}! 😊 Thank you for visiting ${clinicName}. We hope your experience was great!

We'd love to hear your feedback — it helps us serve you better.${urlLine}`;
    const { sendText: sendText2 } = await Promise.resolve().then(() => metaApi);
    const result = await sendText2(acct.phone_number_id, reveal(acct.access_token_enc), conv.phone, body);
    if (result.ok) {
      d.prepare(
        `INSERT INTO wa_messages (account_id, wam_id, conversation_id, direction, message_type, content, status, timestamp)
         VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', datetime('now'))`
      ).run(accountId, result.wam_id ?? null, conversationId, JSON.stringify({ text: body }));
      d.prepare(`UPDATE wa_conversations SET last_message_at=datetime('now') WHERE id=?`).run(conversationId);
    }
    return result;
  });
  electron.ipcMain.handle("wa:resolveConversation", (_e, conversationId, status) => {
    db2().prepare(`UPDATE wa_conversations SET status=? WHERE id=?`).run(status, conversationId);
    return { ok: true };
  });
  electron.ipcMain.handle("wa:webhookToken", (_e, accountId) => {
    const acct = db2().prepare(`SELECT webhook_verify_token FROM wa_accounts WHERE id=?`).get(accountId);
    return (acct == null ? void 0 : acct.webhook_verify_token) ?? null;
  });
  electron.ipcMain.handle("wa:ingestWebhookEvents", (_e, accountId, events) => {
    const insert = db2().prepare(
      `INSERT INTO wa_webhook_events (account_id, event_type, payload, processed) VALUES (?, ?, ?, 0)`
    );
    const tx = db2().transaction(() => {
      for (const ev of events) {
        insert.run(accountId, ev.event_type, JSON.stringify(ev.payload));
      }
    });
    tx();
    processWebhookEvents(db2());
    return { ok: true, ingested: events.length };
  });
  electron.ipcMain.handle("wa:campaigns", (_e, accountId) => {
    return db2().prepare(
      `SELECT * FROM wa_campaigns WHERE account_id=? ORDER BY created_at DESC`
    ).all(accountId);
  });
  electron.ipcMain.handle("wa:campaignCreate", (_e, accountId, input) => {
    const result = db2().prepare(
      `INSERT INTO wa_campaigns (account_id, name, template_name, template_vars, segment, segment_config, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      accountId,
      input.name,
      input.template_name,
      input.template_vars ? JSON.stringify(input.template_vars) : null,
      input.segment,
      input.segment_config ? JSON.stringify(input.segment_config) : null,
      input.scheduled_at ?? null
    );
    return { ok: true, id: result.lastInsertRowid };
  });
  electron.ipcMain.handle("wa:campaignDelete", (_e, campaignId) => {
    db2().prepare(`DELETE FROM wa_campaigns WHERE id=? AND status='draft'`).run(campaignId);
    return { ok: true };
  });
  electron.ipcMain.handle("wa:campaignPreview", (_e, accountId, segment) => {
    return buildSegmentPatients(db2(), segment);
  });
  electron.ipcMain.handle("wa:campaignLaunch", async (_e, campaignId) => {
    const d = db2();
    const campaign = d.prepare(`SELECT * FROM wa_campaigns WHERE id=?`).get(campaignId);
    if (!campaign) return { ok: false, error: "Campaign not found" };
    if (campaign.status !== "draft") return { ok: false, error: "Campaign already launched" };
    const patients = buildSegmentPatients(d, campaign.segment);
    if (patients.length === 0) return { ok: false, error: "No patients match this segment" };
    const ins = d.prepare(
      `INSERT INTO wa_campaign_recipients (campaign_id, patient_id, phone, patient_name) VALUES (?,?,?,?)`
    );
    const tx = d.transaction(() => {
      for (const p of patients) ins.run(campaignId, p.id, normalizePhone$1(p.phone), p.name);
    });
    tx();
    d.prepare(
      `UPDATE wa_campaigns SET status='running', total_count=?, started_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(patients.length, campaignId);
    sendCampaignBatch(campaignId).catch((e) => console.error("[WA campaign]", e));
    return { ok: true, total: patients.length };
  });
  electron.ipcMain.handle("wa:campaignRecipients", (_e, campaignId) => {
    return db2().prepare(
      `SELECT * FROM wa_campaign_recipients WHERE campaign_id=? ORDER BY created_at DESC LIMIT 200`
    ).all(campaignId);
  });
  electron.ipcMain.handle("wa:analytics", (_e, accountId, from, to) => {
    const d = db2();
    const daily = d.prepare(
      `SELECT date(timestamp) as day,
              SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as sent,
              SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as received
       FROM wa_messages WHERE account_id=? AND date(timestamp) BETWEEN ? AND ?
       GROUP BY day ORDER BY day`
    ).all(accountId, from, to);
    const statusBreakdown = d.prepare(
      `SELECT status, COUNT(*) as count
       FROM wa_messages WHERE account_id=? AND direction='outbound'
         AND date(timestamp) BETWEEN ? AND ?
       GROUP BY status`
    ).all(accountId, from, to);
    const templates = d.prepare(
      `SELECT template_name, COUNT(*) as total,
              SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent
       FROM wa_message_queue WHERE account_id=? AND date(created_at) BETWEEN ? AND ?
       GROUP BY template_name ORDER BY total DESC LIMIT 10`
    ).all(accountId, from, to);
    const campaigns = d.prepare(
      `SELECT name, segment, status, total_count, sent_count, failed_count, created_at
       FROM wa_campaigns WHERE account_id=? AND date(created_at) BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 20`
    ).all(accountId, from, to);
    const automation = d.prepare(
      `SELECT r.trigger, COUNT(*) as total,
              SUM(CASE WHEN q.status='sent' THEN 1 ELSE 0 END) as sent
       FROM wa_automation_rules r
       LEFT JOIN wa_message_queue q ON q.account_id=r.account_id AND q.template_name=r.template_name
         AND date(q.created_at) BETWEEN ? AND ?
       WHERE r.account_id=? AND r.is_enabled=1
       GROUP BY r.trigger`
    ).all(from, to, accountId);
    const totals = d.prepare(
      `SELECT
         SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as total_sent,
         SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as total_received,
         SUM(CASE WHEN direction='outbound' AND status='read' THEN 1 ELSE 0 END) as total_read,
         SUM(CASE WHEN direction='outbound' AND status='delivered' THEN 1 ELSE 0 END) as total_delivered
       FROM wa_messages WHERE account_id=? AND date(timestamp) BETWEEN ? AND ?`
    ).get(accountId, from, to);
    return { daily, statusBreakdown, templates, campaigns, automation, totals };
  });
  electron.ipcMain.handle("wa:aiSuggest", async (_e, accountId, conversationId) => {
    var _a, _b, _c, _d;
    const d = db2();
    const apiKey = (((_a = d.prepare(`SELECT value FROM settings WHERE key='anthropic_api_key'`).get()) == null ? void 0 : _a.value) ?? "").trim();
    if (!apiKey) return { ok: false, error: "No Anthropic API key configured. Add it in Settings → Communication → AI Replies." };
    const clinicName = ((_b = d.prepare(`SELECT value FROM settings WHERE key='clinic_name'`).get()) == null ? void 0 : _b.value) ?? "the clinic";
    const msgs = d.prepare(
      `SELECT direction, content FROM wa_messages WHERE account_id=? AND conversation_id=? ORDER BY timestamp DESC LIMIT 10`
    ).all(accountId, conversationId);
    msgs.reverse();
    const thread = msgs.map((m) => {
      let text = "";
      try {
        const c = JSON.parse(m.content);
        text = typeof c.text === "string" ? c.text : c.template ? `[Template: ${c.template}]` : "";
      } catch {
        text = "";
      }
      return `${m.direction === "inbound" ? "Patient" : "Clinic"}: ${text}`;
    }).join("\n");
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: `You are a helpful medical receptionist at ${clinicName}. Write brief, professional WhatsApp replies in the same language the patient uses. Keep each reply under 40 words. Be warm but concise.`,
      messages: [{ role: "user", content: `WhatsApp conversation:
${thread}

Give exactly 3 short reply options on separate lines, each starting with "- ". No extra text.` }]
    });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Anthropic API error ${res.status}: ${err.slice(0, 200)}` };
    }
    const json = await res.json();
    const raw = ((_d = (_c = json.content) == null ? void 0 : _c[0]) == null ? void 0 : _d.text) ?? "";
    const suggestions = raw.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean).slice(0, 3);
    return { ok: true, suggestions };
  });
  electron.ipcMain.handle("wa:relayConfig", () => {
    const d = db2();
    const get = (k) => {
      var _a;
      return ((_a = d.prepare(`SELECT value FROM settings WHERE key=?`).get(k)) == null ? void 0 : _a.value) ?? "";
    };
    return { url: get("wa_relay_url"), secret: get("wa_relay_secret") };
  });
  electron.ipcMain.handle("wa:setRelayConfig", (_e, url, secret) => {
    const d = db2();
    const upsert = d.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    upsert.run("wa_relay_url", url);
    upsert.run("wa_relay_secret", secret);
    return { ok: true };
  });
}
function processWebhookEvents(db2) {
  const events = db2.prepare(
    `SELECT id, account_id, event_type, payload FROM wa_webhook_events WHERE processed=0 LIMIT 50`
  ).all();
  const markDone = db2.prepare(`UPDATE wa_webhook_events SET processed=1 WHERE id=?`);
  const updateMsgStatus = db2.prepare(
    `UPDATE wa_messages SET status=? WHERE wam_id=?`
  );
  for (const ev of events) {
    try {
      const payload = JSON.parse(ev.payload);
      if (ev.event_type === "message_status") {
        const wam_id = payload == null ? void 0 : payload.id;
        const status = payload == null ? void 0 : payload.status;
        if (wam_id && status) updateMsgStatus.run(status, wam_id);
      } else if (ev.event_type === "inbound_message") {
        handleInboundMessage(db2, ev.account_id, payload);
      }
    } catch (e) {
      console.error("[WA webhook] process error", e);
    }
    markDone.run(ev.id);
  }
}
function normalizePhone$1(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}
function buildSegmentPatients(db2, segment) {
  const base = `SELECT p.id, p.phone,
    (p.first_name || ' ' || p.last_name) as name
    FROM patients p`;
  const queries = {
    all: `${base} WHERE p.phone != '' ORDER BY p.id`,
    visited_last_30d: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-30 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    visited_last_90d: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-90 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    followup_due_7d: `${base}
      JOIN consultations c ON c.patient_id=p.id
      WHERE c.follow_up_date BETWEEN date('now') AND date('now', '+7 days')
        AND p.phone != ''
      GROUP BY p.id`,
    birthday_this_month: `${base}
      WHERE substr(p.dob, 6, 2) = strftime('%m', 'now')
        AND p.phone != ''`,
    no_visit_90d: `${base}
      WHERE p.id NOT IN (
        SELECT DISTINCT patient_id FROM appointments
        WHERE appointment_date >= date('now', '-90 days')
      ) AND p.phone != ''`,
    health_awareness: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-90 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    promotion: `${base} WHERE p.phone != '' ORDER BY p.id`,
    active_6m: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-180 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    pediatric: `${base}
      WHERE p.phone != '' AND p.dob IS NOT NULL
        AND (julianday('now') - julianday(p.dob)) / 365.25 < 18`,
    senior_citizens: `${base}
      WHERE p.phone != '' AND p.dob IS NOT NULL
        AND (julianday('now') - julianday(p.dob)) / 365.25 >= 60`,
    adults: `${base}
      WHERE p.phone != '' AND p.dob IS NOT NULL
        AND (julianday('now') - julianday(p.dob)) / 365.25 BETWEEN 18 AND 59`,
    vaccination_due: `${base}
      JOIN bills b ON b.patient_id = p.id
      WHERE b.bill_kind = 'misc' AND lower(b.items_json) LIKE '%vacc%'
        AND (julianday('now') - julianday(b.created_at)) BETWEEN 25 AND 35
        AND p.phone != ''
      GROUP BY p.id`
  };
  const sql = queries[segment] ?? queries.all;
  return db2.prepare(sql).all();
}
async function sendCampaignBatch(campaignId) {
  const d = getDb();
  const campaign = d.prepare(`SELECT * FROM wa_campaigns WHERE id=?`).get(campaignId);
  if (!campaign) return;
  const acct = d.prepare(
    `SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id=?`
  ).get(campaign.account_id);
  if (!acct) return;
  const { sendTemplate: sendTemplate2 } = await Promise.resolve().then(() => metaApi);
  let vars = {};
  try {
    if (campaign.template_vars) vars = JSON.parse(campaign.template_vars);
  } catch {
  }
  const bodyParams = Object.entries(vars).filter(([k]) => !isNaN(Number(k))).sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => ({ type: "text", text: v }));
  const components = bodyParams.length ? [{ type: "body", parameters: bodyParams }] : void 0;
  const pending = d.prepare(
    `SELECT * FROM wa_campaign_recipients WHERE campaign_id=? AND status='pending' LIMIT 500`
  ).all(campaignId);
  const updateRecip = d.prepare(
    `UPDATE wa_campaign_recipients SET status=?, wam_id=?, error=?, sent_at=? WHERE id=?`
  );
  const updateCampaign = d.prepare(
    `UPDATE wa_campaigns SET sent_count=sent_count+?, failed_count=failed_count+?, updated_at=datetime('now') WHERE id=?`
  );
  const BATCH = 10;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let batchSent = 0, batchFailed = 0;
    for (const r of batch) {
      const perVars = { ...vars };
      if (!perVars["1"] && r.patient_name) perVars["1"] = r.patient_name;
      const perParams = Object.entries(perVars).filter(([k]) => !isNaN(Number(k))).sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => ({ type: "text", text: v }));
      const perComps = perParams.length ? [{ type: "body", parameters: perParams }] : components;
      const result = await sendTemplate2(
        acct.phone_number_id,
        reveal(acct.access_token_enc),
        r.phone,
        campaign.template_name,
        vars.lang ?? "en",
        perComps
      );
      if (result.ok) {
        updateRecip.run("sent", result.wam_id ?? null, null, (/* @__PURE__ */ new Date()).toISOString(), r.id);
        batchSent++;
      } else {
        updateRecip.run("failed", null, result.error ?? "unknown", null, r.id);
        batchFailed++;
      }
    }
    updateCampaign.run(batchSent, batchFailed, campaignId);
    if (i + BATCH < pending.length) await new Promise((r) => setTimeout(r, 1e3));
  }
  const camp = d.prepare(`SELECT total_count, sent_count, failed_count FROM wa_campaigns WHERE id=?`).get(campaignId);
  if (camp && camp.sent_count + camp.failed_count >= camp.total_count) {
    d.prepare(`UPDATE wa_campaigns SET status='completed', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(campaignId);
  }
}
async function pollRelayServer() {
  const d = getDb();
  const get = (k) => {
    var _a;
    return ((_a = d.prepare(`SELECT value FROM settings WHERE key=?`).get(k)) == null ? void 0 : _a.value) ?? "";
  };
  const relayUrl = get("wa_relay_url");
  const secret = get("wa_relay_secret");
  if (!relayUrl) return;
  const accounts = d.prepare(`SELECT id, phone_number_id FROM wa_accounts WHERE status='connected'`).all();
  if (accounts.length === 0) return;
  for (const acct of accounts) {
    const lastSince = (() => {
      const row = d.prepare(`SELECT value FROM settings WHERE key=?`).get(`wa_relay_since_${acct.id}`);
      return parseInt((row == null ? void 0 : row.value) || "0", 10);
    })();
    try {
      const headers = { "Accept": "application/json" };
      if (secret) headers["x-poll-secret"] = secret;
      const res = await fetch(`${relayUrl}/poll/${acct.phone_number_id}?since=${lastSince}`, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.events.length > 0) {
        const insert = d.prepare(`INSERT INTO wa_webhook_events (account_id, event_type, payload, processed) VALUES (?,?,?,0)`);
        const tx = d.transaction(() => {
          for (const ev of data.events) insert.run(acct.id, ev.type, JSON.stringify(ev.payload));
        });
        tx();
        processWebhookEvents(d);
      }
      const maxTs = data.events.reduce((m, e) => Math.max(m, e.ts), lastSince);
      d.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(`wa_relay_since_${acct.id}`, String(maxTs));
    } catch (e) {
      console.warn("[WA relay poll]", acct.phone_number_id, e);
    }
  }
}
function handleInboundMessage(db2, accountId, msg) {
  const from = String(msg.from ?? "");
  if (!from) return;
  db2.prepare(
    `INSERT INTO wa_conversations (account_id, phone, status, last_message_at)
     VALUES (?, ?, 'open', datetime('now'))
     ON CONFLICT(account_id, phone) DO UPDATE SET last_message_at=datetime('now'), status='open'`
  ).run(accountId, from);
  const conv = db2.prepare(`SELECT id FROM wa_conversations WHERE account_id=? AND phone=?`).get(accountId, from);
  db2.prepare(
    `INSERT INTO wa_messages (account_id, wam_id, conversation_id, direction, message_type, content, status, timestamp)
     VALUES (?, ?, ?, 'inbound', ?, ?, 'delivered', datetime('now'))`
  ).run(
    accountId,
    msg.id ?? null,
    conv.id,
    msg.type ?? "text",
    JSON.stringify(msg)
  );
}
async function runScheduledCampaigns() {
  const d = getDb();
  const due = d.prepare(
    `SELECT id FROM wa_campaigns
     WHERE status = 'draft' AND scheduled_at IS NOT NULL
       AND datetime(scheduled_at) <= datetime('now')`
  ).all();
  for (const c of due) {
    try {
      await sendCampaignBatch(c.id);
    } catch (e) {
      console.warn("[WA scheduled campaign]", c.id, e);
    }
  }
}
function runAutomationScheduler(db2) {
  const rules = db2.prepare(
    `SELECT r.*, a.id as acct_id FROM wa_automation_rules r
       JOIN wa_accounts a ON a.id = r.account_id
       WHERE r.is_enabled = 1 AND a.status = 'connected'`
  ).all();
  for (const rule of rules) {
    try {
      switch (rule.trigger) {
        case "appointment_reminder_24h":
          enqueueReminders(db2, rule, 24 * 60, 26 * 60);
          break;
        case "appointment_reminder_1h":
          enqueueReminders(db2, rule, 60, 90);
          break;
        case "followup_reminder_3d":
          enqueueFollowupReminders(db2, rule);
          break;
        case "birthday_wish":
          enqueueBirthdayWishes(db2, rule);
          break;
        case "feedback_request":
          enqueueFeedbackRequests(db2, rule);
          break;
        case "vaccination_reminder":
          enqueueVaccinationReminders(db2, rule);
          break;
        default:
          break;
      }
    } catch (e) {
      console.error("[WA scheduler] rule", rule.trigger, "error:", e);
    }
  }
}
function alreadyQueued(db2, accountId, appointmentId, templateName) {
  const row = db2.prepare(
    `SELECT 1 FROM wa_message_queue
       WHERE account_id = ? AND appointment_id IS ? AND template_name = ?
         AND status IN ('pending', 'sent')
       LIMIT 1`
  ).get(accountId, appointmentId, templateName);
  return !!row;
}
function enqueueReminders(db2, rule, windowFromMin, windowToMin) {
  const rows = db2.prepare(
    `SELECT a.id as appointment_id, a.patient_id, p.phone, p.first_name, p.last_name,
              a.appointment_date, a.appointment_time, d.name as doctor_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       WHERE a.status NOT IN ('Cancelled', 'Completed')
         AND (julianday(a.appointment_date || ' ' || a.appointment_time) - julianday('now')) * 1440
             BETWEEN ? AND ?`
  ).all(windowFromMin, windowToMin);
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  for (const row of rows) {
    if (alreadyQueued(db2, rule.account_id, row.appointment_id, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      row.appointment_id,
      rule.template_name,
      JSON.stringify({
        "1": `${row.first_name} ${row.last_name}`.trim(),
        "2": row.doctor_name,
        "3": row.appointment_date,
        "4": row.appointment_time
      })
    );
  }
}
function enqueueFollowupReminders(db2, rule) {
  const rows = db2.prepare(
    `SELECT c.id, c.patient_id, c.follow_up_date, p.phone, p.first_name, p.last_name
       FROM consultations c
       JOIN patients p ON p.id = c.patient_id
       WHERE c.follow_up_date IS NOT NULL
         AND (julianday(c.follow_up_date) - julianday('now')) BETWEEN 2.5 AND 3.5`
  ).all();
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  for (const row of rows) {
    if (alreadyQueued(db2, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      rule.template_name,
      JSON.stringify({
        "1": `${row.first_name} ${row.last_name}`.trim(),
        "2": row.follow_up_date
      })
    );
  }
}
function enqueueBirthdayWishes(db2, rule) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(5, 10);
  const rows = db2.prepare(
    `SELECT id, phone, first_name, last_name FROM patients
       WHERE substr(dob, 6, 5) = ?`
  ).all(today);
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  for (const row of rows) {
    if (alreadyQueued(db2, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.id,
      rule.template_name,
      JSON.stringify({ "1": `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}
function enqueueFeedbackRequests(db2, rule) {
  const rows = db2.prepare(
    `SELECT a.id as appointment_id, a.patient_id, p.phone, p.first_name, p.last_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.status = 'Done'
         AND (julianday('now') - julianday(a.appointment_date || ' ' || a.appointment_time)) * 1440 BETWEEN 120 AND 240`
  ).all();
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  for (const row of rows) {
    if (alreadyQueued(db2, rule.account_id, row.appointment_id, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      row.appointment_id,
      rule.template_name,
      JSON.stringify({ "1": `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}
function enqueueVaccinationReminders(db2, rule) {
  const rows = db2.prepare(
    `SELECT DISTINCT p.id as patient_id, p.phone, p.first_name, p.last_name, b.id as bill_id
     FROM bills b
     JOIN patients p ON p.id = b.patient_id
     WHERE b.bill_kind = 'misc'
       AND (julianday('now') - julianday(b.created_at)) BETWEEN 27 AND 30
       AND lower(b.items_json) LIKE '%vacc%'`
  ).all();
  const insert = db2.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );
  for (const row of rows) {
    if (alreadyQueued(db2, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      rule.template_name,
      JSON.stringify({ "1": `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}
const UDP_PORT = 4322;
async function discoverServers(timeoutMs = 5e3) {
  return new Promise((resolve) => {
    const found = /* @__PURE__ */ new Map();
    let sock = null;
    try {
      sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }
    sock.on("error", () => {
      try {
        sock == null ? void 0 : sock.close();
      } catch {
      }
      resolve([]);
    });
    sock.on("message", (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if ((data == null ? void 0 : data.product) !== "CureDesk HMS") return;
        const ip = data.ip || rinfo.address;
        const port = Number(data.port) || 4321;
        const key = `${ip}:${port}`;
        found.set(key, { ip, port, version: data.version || "?", lastSeen: Date.now() });
      } catch {
      }
    });
    sock.bind(UDP_PORT, () => {
      try {
        sock.setBroadcast(true);
      } catch {
      }
    });
    setTimeout(() => {
      try {
        sock == null ? void 0 : sock.close();
      } catch {
      }
      resolve(Array.from(found.values()).sort((a, b) => a.ip.localeCompare(b.ip)));
    }, timeoutMs);
  });
}
async function pairWithCode(serverUrl, code) {
  try {
    const url = serverUrl.replace(/\/+$/, "") + "/api/pair";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return { ok: false, error: (json == null ? void 0 : json.error) || `HTTP ${res.status}` };
    }
    return { ok: true, secret: json.secret, port: json.port, version: json.version };
  } catch (err) {
    return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
  }
}
async function addWindowsFirewallRule(port) {
  if (process.platform !== "win32") return { ok: false, error: "Only supported on Windows" };
  return new Promise((resolve) => {
    const ruleName = `CureDesk HMS (port ${port})`;
    const cmd = `netsh advfirewall firewall show rule name="${ruleName}" >nul 2>&1 || netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`;
    node_child_process.exec(cmd, { windowsHide: true }, (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true });
    });
  });
}
const REQUEST_TIMEOUT_MS = 15e3;
const HEALTH_TIMEOUT_MS = 4e3;
const HEALTH_INTERVAL_MS = 1e4;
const BACKOFF = [5e3, 1e4, 2e4, 3e4, 6e4];
let installed = false;
let installedFor = null;
let lastError = null;
let lastSuccessAt = null;
let connState = "idle";
let consecutiveFailures = 0;
let lastLatencyMs = null;
let healthTimer = null;
let reconnectAttempts = 0;
let onStateChange = null;
function setClientStateListener(cb) {
  onStateChange = cb;
}
function emit() {
  try {
    onStateChange == null ? void 0 : onStateChange(networkClientStatus());
  } catch {
  }
}
function setState(next, err) {
  const changed = connState !== next || (err ?? null) !== lastError;
  connState = next;
  if (err !== void 0) lastError = err;
  if (changed) emit();
}
const SKIP_PROXY_CHANNELS = /* @__PURE__ */ new Set([
  // These are local-only — they configure / inspect the network client itself.
  "network:status",
  "network:applyMode",
  "network:probe",
  "network:joinCode",
  "network:regenJoinCode",
  "network:discover",
  "network:pair",
  "network:diagnose",
  "network:interfaces",
  "network:reconnect",
  "network:forget",
  // Backup IPCs touch the local filesystem of the calling PC.
  "backup:run",
  "backup:list",
  "backup:open",
  "backup:status",
  "backup:pickFolder",
  "backup:pickSqliteFile",
  "backup:previewBundle",
  "backup:previewSqlite",
  "backup:restoreBundle",
  "backup:restoreSqlite",
  // Updates and OS-level helpers run on the local PC.
  "updates:state",
  "updates:checkNow",
  "updates:installNow",
  "app:openExternal",
  "app:getClinicName",
  // NOTE: settings:get / settings:save are deliberately NOT skipped — they get
  // a custom split-routing proxy below (see STATION_LOCAL_KEYS).
  // Auth must run locally so the local user session works in client mode too.
  "auth:login",
  "auth:listUsers",
  "auth:createUser",
  "auth:changePassword",
  "auth:updateUser",
  "auth:verifyAdminPassword",
  "auth:isDefaultAdminPassword",
  "auth:changeAdminPassword"
]);
const STATION_LOCAL_KEYS = /* @__PURE__ */ new Set([
  "network_mode",
  "network_listen_port",
  "network_server_url",
  "network_secret",
  "network_bind_ip",
  "station_name",
  "backup_folder",
  "backup_reminder_time",
  "usb_reminder_weekday",
  "usb_reminder_time",
  "keep_all_backups",
  "auto_backup_enabled",
  "auto_backup_frequency",
  "auto_backup_time",
  "auto_launch",
  "minimize_to_tray",
  "start_minimized",
  "update_check_enabled",
  "update_check_time"
]);
async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
function isTransient(err) {
  const m = String((err == null ? void 0 : err.message) || err || "").toLowerCase();
  return (err == null ? void 0 : err.name) === "AbortError" || m.includes("fetch failed") || m.includes("econnrefused") || m.includes("econnreset") || m.includes("ehostunreach") || m.includes("enetunreach") || m.includes("etimedout") || m.includes("socket hang up");
}
function installNetworkClient(serverUrl, secret) {
  if (!serverUrl) return { ok: false, channels: 0, error: "serverUrl is empty" };
  const cleanUrl = serverUrl.replace(/\/+$/, "");
  if (installed && installedFor && installedFor.url === cleanUrl && installedFor.secret === secret) {
    return { ok: true, channels: ipcHandlers.size };
  }
  let proxied = 0;
  const callRemote = async (channel, args) => {
    const started = Date.now();
    const res = await fetchWithTimeout(`${cleanUrl}/ipc/${channel}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...secret ? { "Authorization": `Bearer ${secret}` } : {}
      },
      body: JSON.stringify({ args })
    }, REQUEST_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text || res.statusText}`);
    }
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Server error");
    lastLatencyMs = Date.now() - started;
    return json.result;
  };
  const localSettingsGet = ipcHandlers.get("settings:get");
  const localSettingsSave = ipcHandlers.get("settings:save");
  if (localSettingsGet && localSettingsSave) {
    try {
      electron.ipcMain.removeHandler("settings:get");
    } catch {
    }
    rawHandle("settings:get", async (e, ...args) => {
      const local = await localSettingsGet(e, ...args);
      try {
        const remote = await callRemote("settings:get", args);
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState("connected", null);
        const merged = { ...remote };
        for (const k of STATION_LOCAL_KEYS) {
          if (k in local) merged[k] = local[k];
        }
        return merged;
      } catch (err) {
        consecutiveFailures++;
        setState("offline", (err == null ? void 0 : err.message) || String(err));
        return local;
      }
    });
    proxied++;
    try {
      electron.ipcMain.removeHandler("settings:save");
    } catch {
    }
    rawHandle("settings:save", async (e, patch) => {
      const p = patch && typeof patch === "object" ? patch : {};
      const localPatch = {};
      const remotePatch = {};
      for (const [k, v] of Object.entries(p)) {
        if (STATION_LOCAL_KEYS.has(k)) localPatch[k] = v;
        else remotePatch[k] = v;
      }
      if (Object.keys(localPatch).length > 0) await localSettingsSave(e, localPatch);
      if (Object.keys(remotePatch).length > 0) {
        await callRemote("settings:save", [remotePatch]);
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState("connected", null);
      }
      return { ok: true };
    });
    proxied++;
  }
  for (const channel of ipcHandlers.keys()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    if (channel === "settings:get" || channel === "settings:save") continue;
    try {
      electron.ipcMain.removeHandler(channel);
    } catch {
    }
    rawHandle(channel, async (_e, ...args) => {
      const attempt = () => callRemote(channel, args);
      try {
        const result = await attempt();
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState("connected", null);
        return result;
      } catch (err) {
        if (isTransient(err)) {
          try {
            const result = await attempt();
            lastSuccessAt = Date.now();
            consecutiveFailures = 0;
            setState("connected", null);
            return result;
          } catch (err2) {
            consecutiveFailures++;
            const msg = (err2 == null ? void 0 : err2.name) === "AbortError" ? `Host did not respond within ${REQUEST_TIMEOUT_MS / 1e3}s` : (err2 == null ? void 0 : err2.message) || String(err2);
            setState("offline", msg);
            throw new Error(`${msg} — the clinic server at ${cleanUrl} is not reachable. Settings → Network Mode → Troubleshoot to diagnose, or switch this PC to Local mode.`);
          }
        }
        setState("degraded", (err == null ? void 0 : err.message) || String(err));
        throw err;
      }
    });
    proxied++;
  }
  installed = true;
  installedFor = { url: cleanUrl, secret };
  consecutiveFailures = 0;
  reconnectAttempts = 0;
  setState("connected", null);
  startHealthMonitor();
  return { ok: true, channels: proxied };
}
async function pingHost() {
  if (!installedFor) return { ok: false, ms: 0, error: "not installed" };
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${installedFor.url}/api/health`, {}, HEALTH_TIMEOUT_MS);
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    return (body == null ? void 0 : body.ok) === true ? { ok: true, ms } : { ok: false, ms, error: "Not a CureDesk server" };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: (e == null ? void 0 : e.name) === "AbortError" ? "Timed out" : (e == null ? void 0 : e.message) || String(e)
    };
  }
}
function stopHealthMonitor() {
  if (healthTimer) {
    clearTimeout(healthTimer);
    healthTimer = null;
  }
}
function scheduleHealth(delayMs) {
  stopHealthMonitor();
  healthTimer = setTimeout(runHealthCheck, delayMs);
}
async function runHealthCheck() {
  if (!installed || !installedFor) return;
  const r = await pingHost();
  if (r.ok) {
    lastLatencyMs = r.ms;
    lastSuccessAt = Date.now();
    consecutiveFailures = 0;
    reconnectAttempts = 0;
    setState("connected", null);
    scheduleHealth(HEALTH_INTERVAL_MS);
  } else {
    consecutiveFailures++;
    setState(consecutiveFailures >= 2 ? "offline" : "degraded", r.error || "Health check failed");
    const delay = BACKOFF[Math.min(reconnectAttempts, BACKOFF.length - 1)];
    reconnectAttempts++;
    scheduleHealth(delay);
  }
}
function startHealthMonitor() {
  stopHealthMonitor();
  scheduleHealth(HEALTH_INTERVAL_MS);
}
async function reconnectNow() {
  if (!installed || !installedFor) return { ok: false, error: "Not in Client mode" };
  reconnectAttempts = 0;
  const r = await pingHost();
  if (r.ok) {
    lastLatencyMs = r.ms;
    lastSuccessAt = Date.now();
    consecutiveFailures = 0;
    setState("connected", null);
    startHealthMonitor();
    return { ok: true, latencyMs: r.ms };
  }
  consecutiveFailures++;
  setState("offline", r.error || "Reconnect failed");
  startHealthMonitor();
  return { ok: false, error: r.error };
}
function uninstallNetworkClient() {
  stopHealthMonitor();
  for (const [channel, handler] of ipcHandlers.entries()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    try {
      electron.ipcMain.removeHandler(channel);
    } catch {
    }
    try {
      rawHandle(channel, handler);
    } catch {
    }
  }
  installed = false;
  installedFor = null;
  lastError = null;
  lastLatencyMs = null;
  consecutiveFailures = 0;
  reconnectAttempts = 0;
  setState("idle", null);
}
function networkClientStatus() {
  return {
    installed,
    serverUrl: (installedFor == null ? void 0 : installedFor.url) || "",
    state: connState,
    lastError,
    lastSuccessAt,
    latencyMs: lastLatencyMs,
    consecutiveFailures
  };
}
const splashHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CureDesk HMS</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      background: #0b1220;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
      -webkit-app-region: drag; /* lets the user drag the window even though it's frameless */
    }

    /* Soft animated radial gradient background */
    body::before {
      content: '';
      position: absolute; inset: -50%;
      background:
        radial-gradient(circle at 30% 30%, rgba(59,130,246,0.18) 0%, transparent 35%),
        radial-gradient(circle at 70% 60%, rgba(99,102,241,0.16) 0%, transparent 40%),
        radial-gradient(circle at 50% 90%, rgba(236,72,153,0.10) 0%, transparent 40%);
      animation: drift 14s ease-in-out infinite alternate;
      z-index: 0;
    }
    @keyframes drift {
      0%   { transform: translate(0, 0) rotate(0deg); }
      100% { transform: translate(-40px, 30px) rotate(8deg); }
    }

    .stage {
      position: relative; z-index: 1;
      width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 28px;
    }

    /* Logo: a stylized heart/cross icon that breathes */
    .logo-wrap {
      width: 96px; height: 96px;
      border-radius: 22px;
      background: linear-gradient(135deg, #1d4ed8 0%, #4f46e5 50%, #7c3aed 100%);
      display: flex; align-items: center; justify-content: center;
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.05),
        0 12px 40px rgba(99,102,241,0.45),
        0 0 80px rgba(99,102,241,0.25);
      animation: breathe 2.4s ease-in-out infinite;
      position: relative;
    }
    @keyframes breathe {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 12px 40px rgba(99,102,241,0.45), 0 0 80px rgba(99,102,241,0.25); }
      50%      { transform: scale(1.06); box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 18px 60px rgba(99,102,241,0.65), 0 0 110px rgba(99,102,241,0.4); }
    }

    /* Pulse ring around the logo */
    .logo-wrap::before, .logo-wrap::after {
      content: '';
      position: absolute; inset: -8px;
      border-radius: 26px;
      border: 2px solid rgba(99,102,241,0.4);
      animation: pulse 2.4s ease-out infinite;
      opacity: 0;
    }
    .logo-wrap::after { animation-delay: 1.2s; }
    @keyframes pulse {
      0%   { transform: scale(0.95); opacity: 0.55; }
      80%  { transform: scale(1.4); opacity: 0; }
      100% { transform: scale(1.4); opacity: 0; }
    }

    .logo-svg { width: 56px; height: 56px; color: #ffffff; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); }

    .title {
      font-size: 28px; font-weight: 800; letter-spacing: 0.5px;
      text-align: center;
      background: linear-gradient(120deg, #e0e7ff, #ffffff 50%, #c7d2fe);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: fade-up 0.8s ease-out 0.2s both;
    }
    .subtitle {
      font-size: 12px; color: #94a3b8; letter-spacing: 1.5px; text-transform: uppercase;
      animation: fade-up 0.8s ease-out 0.45s both;
    }
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Indeterminate loading bar */
    .bar {
      width: 220px; height: 4px;
      background: rgba(148,163,184,0.15);
      border-radius: 999px;
      overflow: hidden;
      margin-top: 6px;
      animation: fade-up 0.8s ease-out 0.7s both;
    }
    .bar > span {
      display: block;
      height: 100%; width: 40%;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, #6366f1, #ec4899, transparent);
      animation: slide 1.4s ease-in-out infinite;
    }
    @keyframes slide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }

    .status {
      font-size: 11px; color: #64748b; letter-spacing: 0.5px;
      animation: fade-up 0.8s ease-out 0.95s both;
    }
    .footer {
      position: absolute; bottom: 14px; left: 0; right: 0;
      text-align: center;
      font-size: 10px; color: #475569; letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="logo-wrap">
      <!-- CureDesk plus + dot logo -->
      <svg class="logo-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
        <circle cx="18.5" cy="18.5" r="2" fill="currentColor" stroke="none" />
      </svg>
    </div>
    <div>
      <div class="title">CureDesk HMS</div>
      <div class="subtitle">Modern OPD management</div>
    </div>
    <div class="bar"><span></span></div>
    <div class="status" id="status">Starting up…</div>
  </div>
  <div class="footer">Loading database, drug master, doctor profiles…</div>

  <script>
    // Cycle through helpful status messages while the main process spins up.
    const STATUSES = [
      'Starting up…',
      'Opening database…',
      'Running migrations…',
      'Loading clinic settings…',
      'Almost there…',
    ];
    const el = document.getElementById('status');
    let i = 0;
    setInterval(() => { i = (i + 1) % STATUSES.length; if (el) el.textContent = STATUSES[i]; }, 900);
  <\/script>
</body>
</html>
`;
const GITHUB_REPO = "mulgundsunil1918/mmcopd";
let updateState = "idle";
let updateInfo = {};
function isNewer(a, b) {
  const norm = (v) => v.replace(/^v/i, "").split(".").map((p) => parseInt(p, 10) || 0);
  const [aa, bb] = [norm(a), norm(b)];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0, y = bb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
async function checkGitHubReleaseNow() {
  updateState = "checking";
  updateInfo = { ...updateInfo, error: void 0 };
  mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("updates:state", { state: updateState, ...updateInfo });
  const currentVersion = electron.app.getVersion();
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "CureDesk-HMS-UpdateCheck" }
    });
    if (res.status === 404) {
      updateState = "uptodate";
      updateInfo = {
        currentVersion,
        latestVersion: currentVersion,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        checkedAt
      };
      const payload2 = { state: updateState, ...updateInfo };
      mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("updates:state", payload2);
      return payload2;
    }
    if (!res.ok) throw new Error(`Update server ${res.status}: ${res.statusText}`);
    const json = await res.json();
    const tag = (json.tag_name || "").toString();
    const latest = tag.replace(/^v/i, "");
    const asset = (json.assets || []).find(
      (a) => typeof (a == null ? void 0 : a.name) === "string" && /setup.*\.exe$/i.test(a.name)
    );
    const downloadUrl = (asset == null ? void 0 : asset.browser_download_url) || json.html_url;
    if (latest && isNewer(latest, currentVersion)) {
      updateState = "available";
      updateInfo = {
        currentVersion,
        latestVersion: latest,
        releaseNotes: json.body || "",
        releaseUrl: json.html_url,
        downloadUrl,
        checkedAt
      };
    } else {
      updateState = "uptodate";
      updateInfo = {
        currentVersion,
        latestVersion: latest || currentVersion,
        releaseUrl: json.html_url,
        downloadUrl,
        checkedAt
      };
    }
  } catch (err) {
    updateState = "error";
    updateInfo = { ...updateInfo, currentVersion, error: (err == null ? void 0 : err.message) || String(err) };
  }
  const payload = { state: updateState, ...updateInfo };
  mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("updates:state", payload);
  return payload;
}
function openDownloadPage() {
  const url = updateInfo.downloadUrl || updateInfo.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`;
  electron.shell.openExternal(url);
}
async function applyNetworkMode() {
  const s = getAllSettings(getDb());
  setPreferredIp(s.network_bind_ip || "");
  if (s.network_mode === "server") {
    uninstallNetworkClient();
    const port = s.network_listen_port || 4321;
    let secret = s.network_secret || "";
    if (!secret) {
      secret = crypto$1.randomBytes(32).toString("hex");
      saveSettings(getDb(), { network_secret: secret });
    }
    const result = await startNetworkServer(port, secret, electron.app.getVersion());
    if (result.ok) {
      console.log(`[network] Server listening on port ${result.port}`);
      addWindowsFirewallRule(port).catch(() => {
      });
    } else {
      console.warn(`[network] Failed to start server: ${result.error}`);
    }
  } else if (s.network_mode === "client") {
    await stopNetworkServer();
    const r = installNetworkClient(s.network_server_url, s.network_secret || "");
    if (r.ok) {
      console.log(`[network] Client installed — proxying ${r.channels} channels to ${s.network_server_url}`);
    } else {
      console.warn(`[network] Client install failed: ${r.error}`);
    }
  } else {
    await stopNetworkServer();
    uninstallNetworkClient();
  }
}
if (process.platform === "win32") {
  const gotLock = electron.app.requestSingleInstanceLock();
  if (!gotLock) electron.app.quit();
}
let mainWindowRef = null;
let trayRef = null;
let allowQuit = false;
const FALLBACK_TRAY_ICON_B64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR42u3OsQ2AMAxE0RtAgZ4FsgFTwACMABuwQiqWoaIK8h+gIE5HRPm+bF8gIqJ/jACMAQzPArwBHIBvAR4ANwAVgF6AEj0KcvkCAJyJB1RsBUVNAAAAAElFTkSuQmCC";
function makeTrayIcon() {
  try {
    const s = getAllSettings(getDb());
    if (s.clinic_logo && s.clinic_logo.startsWith("data:image/")) {
      const img = electron.nativeImage.createFromDataURL(s.clinic_logo);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  } catch {
  }
  return electron.nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_ICON_B64, "base64"));
}
function showWindow() {
  if (!mainWindowRef) return;
  if (mainWindowRef.isMinimized()) mainWindowRef.restore();
  mainWindowRef.show();
  mainWindowRef.focus();
}
function refreshTrayMenu() {
  if (!trayRef) return;
  const s = getAllSettings(getDb());
  const menu = electron.Menu.buildFromTemplate([
    { label: `CureDesk HMS — ${s.clinic_name || "Clinic"}`, enabled: false },
    { type: "separator" },
    { label: "Open dashboard", click: () => showWindow() },
    {
      label: "Backup now…",
      click: () => {
        showWindow();
        mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:openBackupModal");
      }
    },
    { type: "separator" },
    {
      label: "Quit (with backup)",
      click: () => {
        showWindow();
        mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:closeRequested");
      }
    },
    {
      label: "Quit immediately",
      click: () => {
        allowQuit = true;
        electron.app.quit();
      }
    }
  ]);
  trayRef.setContextMenu(menu);
  trayRef.setToolTip(`${s.clinic_name || "CureDesk HMS"} — running in background`);
}
function ensureTray() {
  if (trayRef) {
    refreshTrayMenu();
    return;
  }
  try {
    trayRef = new electron.Tray(makeTrayIcon());
    trayRef.on("click", () => showWindow());
    trayRef.on("double-click", () => showWindow());
    refreshTrayMenu();
  } catch (e) {
    console.warn("Tray init failed:", e);
  }
}
function applyAutoLaunch(enabled, startMinimized) {
  try {
    if (process.platform !== "win32" && process.platform !== "darwin") {
      return { ok: false, reason: `Auto-launch is only supported on Windows and macOS (running on ${process.platform}).` };
    }
    if (!electron.app.isPackaged) {
      return { ok: false, reason: "Auto-launch only takes effect in installed builds — running in dev mode (npm start) does NOT register with Windows. After installing the .exe, this will work." };
    }
    const exePath = electron.app.getPath("exe");
    electron.app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: startMinimized,
      path: exePath,
      args: startMinimized ? ["--hidden"] : []
    });
    const actual = electron.app.getLoginItemSettings({ path: exePath });
    return { ok: true, registered: actual.openAtLogin, exePath };
  } catch (e) {
    return { ok: false, reason: (e == null ? void 0 : e.message) || String(e) };
  }
}
function readAutoLaunchStatus() {
  const supported = process.platform === "win32" || process.platform === "darwin";
  if (!supported) return { supported: false, isPackaged: electron.app.isPackaged, registered: false, exePath: null, reason: `Not supported on ${process.platform}` };
  if (!electron.app.isPackaged) return { supported: true, isPackaged: false, registered: false, exePath: null, reason: "Dev mode — registry write skipped. Install the .exe to enable auto-launch." };
  try {
    const exePath = electron.app.getPath("exe");
    const actual = electron.app.getLoginItemSettings({ path: exePath });
    return { supported: true, isPackaged: true, registered: actual.openAtLogin, exePath };
  } catch (e) {
    return { supported: true, isPackaged: true, registered: false, exePath: null, reason: (e == null ? void 0 : e.message) || String(e) };
  }
}
let splashRef = null;
function showSplash() {
  if (!electron.app.isPackaged) return;
  if (splashRef && !splashRef.isDestroyed()) return;
  try {
    splashRef = new electron.BrowserWindow({
      width: 480,
      height: 360,
      frame: false,
      transparent: false,
      backgroundColor: "#0b1220",
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    splashRef.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHtml));
    splashRef.once("ready-to-show", () => splashRef == null ? void 0 : splashRef.show());
  } catch (e) {
    console.warn("Splash window failed:", e);
    splashRef = null;
  }
}
function closeSplash() {
  if (splashRef && !splashRef.isDestroyed()) {
    try {
      splashRef.close();
    } catch {
    }
  }
  splashRef = null;
}
function createWindow() {
  const settings = getAllSettings(getDb());
  const startedHidden = process.argv.includes("--hidden") && settings.start_minimized;
  const mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: settings.clinic_name || "CureDesk HMS",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindowRef = mainWindow;
  setClientStateListener((s) => {
    try {
      mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("network:state", s);
    } catch {
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media" || permission === "mediaKeySystem") {
      return callback(true);
    }
    callback(false);
  });
  mainWindow.once("ready-to-show", () => {
    closeSplash();
    if (!startedHidden) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  mainWindow.on("close", (e) => {
    if (allowQuit) return;
    const s = getAllSettings(getDb());
    if (s.minimize_to_tray) {
      e.preventDefault();
      mainWindow.hide();
      try {
        trayRef == null ? void 0 : trayRef.displayBalloon({
          title: "CureDesk HMS",
          content: "Still running in the background. Click the tray icon to reopen."
        });
      } catch {
      }
      return;
    }
    e.preventDefault();
    mainWindow.webContents.send("app:closeRequested");
  });
  electron.ipcMain.handle("app:getClinicName", () => getAllSettings(getDb()).clinic_name);
  electron.ipcMain.handle("app:forceQuit", () => {
    allowQuit = true;
    setTimeout(() => electron.app.quit(), 50);
  });
  electron.ipcMain.handle("app:setAutoLaunch", (_e, enabled, startMinimized) => {
    return applyAutoLaunch(enabled, startMinimized);
  });
  electron.ipcMain.handle("app:getAutoLaunchStatus", () => readAutoLaunchStatus());
  electron.ipcMain.handle("app:refreshTray", () => refreshTrayMenu());
  electron.ipcMain.handle("app:openExternal", async (_e, url) => {
    try {
      if (typeof url !== "string") return { ok: false, error: "Invalid URL" };
      const lower = url.toLowerCase();
      const ok = lower.startsWith("https://wa.me/") || lower.startsWith("https://api.whatsapp.com/") || lower.startsWith("tel:") || lower.startsWith("mailto:") || lower.startsWith("https://www.google.com/maps") || lower.startsWith("https://maps.google.com/") || lower.startsWith("https://bridgr.co.in/");
      if (!ok) return { ok: false, error: "URL not allowed" };
      await electron.shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
    }
  });
  electron.ipcMain.handle("updates:state", () => ({
    state: updateState,
    appVersion: electron.app.getVersion(),
    isPackaged: electron.app.isPackaged,
    ...updateInfo
  }));
  electron.ipcMain.handle("updates:checkNow", async () => {
    const result = await checkGitHubReleaseNow();
    return { ok: true, isPackaged: electron.app.isPackaged, ...result };
  });
  electron.ipcMain.handle("updates:installNow", () => {
    openDownloadPage();
    return { ok: true };
  });
  electron.ipcMain.handle("admin:hardResetAndRestart", async () => {
    try {
      const userData = electron.app.getPath("userData");
      const marker = getResetMarkerPath();
      try {
        fs.mkdirSync(path.dirname(marker), { recursive: true });
      } catch {
      }
      fs.writeFileSync(marker, userData, "utf8");
      try {
        closeDb();
      } catch {
      }
      allowQuit = true;
      electron.app.relaunch();
      electron.app.exit(0);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
    }
  });
  electron.ipcMain.handle("network:status", () => {
    const s = getAllSettings(getDb());
    return {
      mode: s.network_mode,
      listenPort: s.network_listen_port,
      serverUrl: s.network_server_url,
      hasSecret: !!s.network_secret,
      ...networkServerStatus(),
      appVersion: electron.app.getVersion(),
      client: networkClientStatus()
    };
  });
  electron.ipcMain.handle("network:applyMode", async () => {
    await applyNetworkMode();
    return { ok: true, ...networkServerStatus() };
  });
  electron.ipcMain.handle("network:probe", async (_e, payload) => {
    try {
      const u = (payload.url || "").replace(/\/+$/, "");
      const headers = { "Accept": "application/json" };
      if (payload.secret) headers["Authorization"] = `Bearer ${payload.secret}`;
      const res = await fetch(`${u}/api/health`, { headers });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      return { ok: true, info: json };
    } catch (err) {
      return { ok: false, error: (err == null ? void 0 : err.message) || String(err) };
    }
  });
  electron.ipcMain.handle("network:joinCode", () => {
    var _a, _b;
    return {
      code: ((_a = getJoinCode()) == null ? void 0 : _a.code) ?? null,
      expiresAt: ((_b = getJoinCode()) == null ? void 0 : _b.expiresAt) ?? null,
      lanIp: getLocalLanIP(),
      port: networkServerStatus().port
    };
  });
  electron.ipcMain.handle("network:regenJoinCode", () => {
    const s = getAllSettings(getDb());
    if (s.network_mode !== "server") return { ok: false, error: "Not in Server mode" };
    const port = s.network_listen_port || 4321;
    const fresh = regenerateJoinCode(s.network_secret || "", port);
    return { ok: true, ...fresh };
  });
  electron.ipcMain.handle("network:discover", async (_e, opts = {}) => {
    const list = await discoverServers(opts.timeoutMs ?? 5e3);
    return list;
  });
  electron.ipcMain.handle("network:pair", async (_e, payload) => {
    return pairWithCode(payload.url, payload.code);
  });
  electron.ipcMain.handle("network:interfaces", () => ({
    interfaces: listNetworkInterfaces(),
    active: getLocalLanIP(),
    pinned: getAllSettings(getDb()).network_bind_ip || ""
  }));
  electron.ipcMain.handle("network:diagnose", async (_e, payload) => {
    const s = getAllSettings(getDb());
    const url = (payload == null ? void 0 : payload.url) ?? s.network_server_url ?? "";
    const secret = (payload == null ? void 0 : payload.secret) ?? s.network_secret ?? "";
    return runDiagnostics(url, secret);
  });
  electron.ipcMain.handle("network:reconnect", async () => {
    const s = getAllSettings(getDb());
    if (s.network_mode === "client") return reconnectNow();
    if (s.network_mode === "server") {
      await applyNetworkMode();
      return { ok: networkServerStatus().running };
    }
    return { ok: false, error: "Not in Server or Client mode" };
  });
  electron.ipcMain.handle("network:forget", async () => {
    uninstallNetworkClient();
    saveSettings(getDb(), {
      network_mode: "local",
      network_server_url: "",
      network_secret: ""
    });
    await applyNetworkMode();
    return { ok: true };
  });
}
function latestBackupMtime(rootDir) {
  const sqliteRoot = path.join(rootDir, "sqlite");
  if (!fs.existsSync(sqliteRoot)) return 0;
  let latest = 0;
  for (const day of fs.readdirSync(sqliteRoot)) {
    const dayDir = path.join(sqliteRoot, day);
    try {
      if (!fs.statSync(dayDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const time of fs.readdirSync(dayDir)) {
      const dbFile = path.join(dayDir, time, "caredesk.sqlite");
      if (fs.existsSync(dbFile)) {
        const mt = fs.statSync(dbFile).mtimeMs;
        if (mt > latest) latest = mt;
      }
    }
  }
  return latest;
}
const FREQUENCY_HOURS = {
  hourly: 1,
  every_3_hours: 3,
  every_6_hours: 6,
  twice_daily: 12,
  daily: 24
};
async function runScheduledBackup(reason) {
  try {
    const db2 = getDb();
    const s = getAllSettings(db2);
    if (!s.auto_backup_enabled) return;
    const userData = electron.app.getPath("userData");
    const dir = s.backup_folder || path.join(userData, "backups");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const isWallClockMode = s.auto_backup_frequency === "daily" || s.auto_backup_frequency === "twice_daily";
    const intervalHours = FREQUENCY_HOURS[s.auto_backup_frequency] || 24;
    const intervalMs = intervalHours * 3600 * 1e3;
    const latestMs = latestBackupMtime(dir);
    if (isWallClockMode) {
      const [hh, mm] = (s.auto_backup_time || "13:00").split(":").map((x) => parseInt(x, 10));
      const target = /* @__PURE__ */ new Date();
      target.setHours(hh, mm, 0, 0);
      const target2 = new Date(target.getTime() + 12 * 3600 * 1e3);
      const validTimes = s.auto_backup_frequency === "twice_daily" ? [target, target2] : [target];
      const dueByTime = validTimes.some((t) => Date.now() >= t.getTime() && (!latestMs || latestMs < t.getTime()));
      if (!dueByTime) return;
    } else {
      const dueByInterval = !latestMs || Date.now() - latestMs >= intervalMs;
      if (!dueByInterval) return;
    }
    if (isBackupServiceReady()) {
      try {
        await runFullBackup(dir, "backup");
        mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:autoBackupRan", { at: (/* @__PURE__ */ new Date()).toISOString(), reason });
        return;
      } catch (e) {
        console.error("Full auto-backup failed, falling back to sqlite-only:", e);
      }
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    const now = /* @__PURE__ */ new Date();
    const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
    const bundleDir = path.join(dir, "sqlite", day, time);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dest = path.join(bundleDir, "caredesk.sqlite");
    try {
      await db2.backup(dest);
    } catch {
      fs.copyFileSync(path.join(userData, "caredesk.sqlite"), dest);
    }
    mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:autoBackupRan", { at: (/* @__PURE__ */ new Date()).toISOString(), reason });
  } catch (e) {
    console.error("Scheduled backup failed:", e);
  }
}
async function runAutoBackupIfDue() {
  return runScheduledBackup("startup");
}
let lastNotifiedDailyKey = "";
let lastNotifiedUsbKey = "";
function fireOsNotification(title, body, channel) {
  if (electron.Notification.isSupported()) {
    const n = new electron.Notification({ title, body, urgency: "critical" });
    n.on("click", () => {
      showWindow();
      if (channel === "usb") mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:usbReminderTick");
      else mainWindowRef == null ? void 0 : mainWindowRef.webContents.send("app:closeRequested");
    });
    n.show();
  }
  if (mainWindowRef) {
    if (mainWindowRef.isVisible()) mainWindowRef.flashFrame(true);
    if (channel === "usb") mainWindowRef.webContents.send("app:usbReminderTick");
    else mainWindowRef.webContents.send("app:reminderTick", { reminder: "" });
  }
}
let lastUpdateCheckKey = "";
function tickReminder() {
  try {
    const s = getAllSettings(getDb());
    const now = /* @__PURE__ */ new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const dateKey2 = now.toISOString().slice(0, 10);
    const reminder = s.backup_reminder_time || "21:00";
    const dailyKey = dateKey2 + "@" + reminder;
    if (hhmm === reminder && lastNotifiedDailyKey !== dailyKey) {
      lastNotifiedDailyKey = dailyKey;
      fireOsNotification("CureDesk HMS — Time to backup & close", `It's ${reminder}. Click to open backup screen.`, "daily");
    }
    const usbWeekday = Number.isFinite(s.usb_reminder_weekday) ? s.usb_reminder_weekday : 1;
    const usbTime = s.usb_reminder_time || "09:30";
    const usbKey = dateKey2 + "@usb@" + usbTime;
    if (now.getDay() === usbWeekday && hhmm === usbTime && lastNotifiedUsbKey !== usbKey) {
      lastNotifiedUsbKey = usbKey;
      fireOsNotification(
        "CureDesk HMS — Weekly USB backup",
        "Plug in your USB drive and take this week's physical backup. Click to open.",
        "usb"
      );
    }
    if (s.update_check_enabled !== false) {
      const updateTime = s.update_check_time || "10:30";
      const updateKey = dateKey2 + "@upd@" + updateTime;
      if (hhmm === updateTime && lastUpdateCheckKey !== updateKey) {
        lastUpdateCheckKey = updateKey;
        checkGitHubReleaseNow().catch(() => {
        });
      }
    }
  } catch (e) {
    console.warn("Reminder tick failed:", e);
  }
}
function getResetMarkerPath() {
  const tmp = require("node:os").tmpdir();
  const tag = require("node:crypto").createHash("md5").update(electron.app.getPath("userData")).digest("hex").slice(0, 12);
  return path.join(tmp, `curedesk-reset-${tag}.flag`);
}
function consumeResetMarkerIfPresent() {
  try {
    const marker = getResetMarkerPath();
    if (!fs.existsSync(marker)) return;
    const target = fs.readFileSync(marker, "utf8").trim();
    if (target && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[reset] Wiped ${target}`);
    }
    try {
      fs.unlinkSync(marker);
    } catch {
    }
  } catch (err) {
    console.warn("[reset] consumeResetMarkerIfPresent failed:", err);
  }
}
electron.app.whenReady().then(async () => {
  consumeResetMarkerIfPresent();
  showSplash();
  getDb();
  installIpcRegistry();
  registerIpc();
  registerWhatsAppIpc();
  await applyNetworkMode().catch((e) => console.warn("Network server boot failed:", e));
  createWindow();
  ensureTray();
  const s0 = getAllSettings(getDb());
  applyAutoLaunch(s0.auto_launch, s0.start_minimized);
  await runAutoBackupIfDue();
  setInterval(() => runScheduledBackup("tick"), 5 * 60 * 1e3);
  setInterval(tickReminder, 3e4);
  tickReminder();
  const waWorker = () => {
    const d = getDb();
    processQueue(d).catch((e) => console.warn("[WA queue]", e));
    runAutomationScheduler(d);
    pollRelayServer().catch((e) => console.warn("[WA relay]", e));
    runScheduledCampaigns().catch((e) => console.warn("[WA scheduled]", e));
  };
  setInterval(waWorker, 6e4);
  waWorker();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
});
electron.app.on("before-quit", () => {
  allowQuit = true;
  closeDb();
  trayRef == null ? void 0 : trayRef.destroy();
});
