import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 4;

export function createSchema(db: Database.Database) {
  db.exec(`
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
      -- Nullable so a walk-in / quick custom bill can be raised with just a
      -- typed name and no patient record.
      patient_id INTEGER REFERENCES patients(id),
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

    -- =====================================================================
    -- IN-PATIENT (IPD)
    -- =====================================================================

    -- Wards are configured per clinic in Settings. Rates drive the daily
    -- auto-accrual of bed and nursing charges onto the running IPD bill.
    CREATE TABLE IF NOT EXISTS wards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL UNIQUE,
      ward_type       TEXT NOT NULL DEFAULT 'general',
      per_day_rate    REAL NOT NULL DEFAULT 0,
      nursing_per_day REAL NOT NULL DEFAULT 0,
      colour          TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- status drives the colour-coded bed map.
    CREATE TABLE IF NOT EXISTS beds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ward_id     INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
      bed_number  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'free'
                    CHECK (status IN ('free','occupied','reserved','cleaning','blocked')),
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ward_id, bed_number)
    );
    CREATE INDEX IF NOT EXISTS idx_beds_ward ON beds(ward_id, status);

    -- Every bed move. A same-day move is billed at the higher of the two ward
    -- rates (clinic-configurable), so the history is needed to compute charges.
    CREATE TABLE IF NOT EXISTS bed_transfers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id  INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      from_bed_id   INTEGER REFERENCES beds(id),
      to_bed_id     INTEGER NOT NULL REFERENCES beds(id),
      reason        TEXT,
      transferred_at TEXT NOT NULL DEFAULT (datetime('now')),
      transferred_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bed_transfers_adm ON bed_transfers(admission_id, transferred_at);

    -- Doctor round notes.
    CREATE TABLE IF NOT EXISTS ip_progress_notes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      doctor_id    INTEGER REFERENCES doctors(id),
      note         TEXT NOT NULL,
      noted_at     TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_notes_adm ON ip_progress_notes(admission_id, noted_at);

    -- Observation chart. Nulls allowed so a nurse can record only what was taken.
    CREATE TABLE IF NOT EXISTS ip_vitals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      temperature  REAL,
      pulse        INTEGER,
      respiration  INTEGER,
      bp_systolic  INTEGER,
      bp_diastolic INTEGER,
      spo2         INTEGER,
      pain_score   INTEGER,
      notes        TEXT,
      recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_vitals_adm ON ip_vitals(admission_id, recorded_at);

    -- What the doctor prescribed for the stay.
    CREATE TABLE IF NOT EXISTS ip_medication_orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id   INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      drug_master_id INTEGER REFERENCES drug_master(id),
      drug_name      TEXT NOT NULL,
      dose           TEXT,
      route          TEXT,
      frequency      TEXT,
      instructions   TEXT,
      start_at       TEXT NOT NULL DEFAULT (datetime('now')),
      stop_at        TEXT,
      status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','stopped','completed')),
      ordered_by_doctor_id INTEGER REFERENCES doctors(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ip_medord_adm ON ip_medication_orders(admission_id, status);

    -- Medication administration record. A 'given' row depletes pharmacy stock
    -- from the FEFO batch and posts the charge, all in one transaction.
    CREATE TABLE IF NOT EXISTS ip_medication_admin (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      INTEGER NOT NULL REFERENCES ip_medication_orders(id) ON DELETE CASCADE,
      admission_id  INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'given'
                      CHECK (status IN ('given','refused','omitted','held')),
      reason        TEXT,
      qty           REAL NOT NULL DEFAULT 0,
      batch_id      INTEGER REFERENCES drug_stock_batches(id),
      bill_item_id  INTEGER,
      administered_at TEXT NOT NULL DEFAULT (datetime('now')),
      administered_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_medadmin_adm ON ip_medication_admin(admission_id, administered_at);

    CREATE TABLE IF NOT EXISTS ip_intake_output (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL CHECK (kind IN ('intake','output')),
      route        TEXT,
      volume_ml    REAL NOT NULL DEFAULT 0,
      notes        TEXT,
      recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_io_adm ON ip_intake_output(admission_id, recorded_at);

    CREATE TABLE IF NOT EXISTS ip_nursing_notes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      note         TEXT NOT NULL,
      shift        TEXT,
      noted_at     TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by  TEXT,
      countersigned_by TEXT,
      countersigned_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_nursing_adm ON ip_nursing_notes(admission_id, noted_at);

    CREATE TABLE IF NOT EXISTS ip_diet_orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      diet_type    TEXT NOT NULL,
      instructions TEXT,
      start_at     TEXT NOT NULL DEFAULT (datetime('now')),
      stop_at      TEXT,
      ordered_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_diet_adm ON ip_diet_orders(admission_id);

    -- Referral to another consultant during the stay. Their visit fee bills
    -- against their own doctor rate.
    CREATE TABLE IF NOT EXISTS ip_cross_consultations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      doctor_id    INTEGER NOT NULL REFERENCES doctors(id),
      reason       TEXT,
      status       TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','seen','declined')),
      opinion      TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ip_xconsult_adm ON ip_cross_consultations(admission_id, status);

    -- =====================================================================
    -- MEDICO-LEGAL REGISTER
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS mlc_register (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id    INTEGER REFERENCES ip_admissions(id) ON DELETE SET NULL,
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      mlc_number      TEXT,
      police_station  TEXT,
      intimated_at    TEXT,
      intimated_by    TEXT,
      brought_by      TEXT,
      brought_by_phone TEXT,
      incident_type   TEXT,
      incident_at     TEXT,
      incident_place  TEXT,
      injury_description TEXT,
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mlc_admission ON mlc_register(admission_id);

    CREATE TABLE IF NOT EXISTS mlc_correspondence (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      mlc_id      INTEGER NOT NULL REFERENCES mlc_register(id) ON DELETE CASCADE,
      direction   TEXT NOT NULL CHECK (direction IN ('sent','received')),
      summary     TEXT NOT NULL,
      reference_no TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mlc_corr ON mlc_correspondence(mlc_id, occurred_at);

    CREATE TABLE IF NOT EXISTS body_release (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_id  INTEGER NOT NULL REFERENCES ip_admissions(id) ON DELETE CASCADE,
      released_to   TEXT NOT NULL,
      relation      TEXT,
      id_proof_type TEXT,
      id_proof_no   TEXT,
      contact_phone TEXT,
      released_at   TEXT NOT NULL DEFAULT (datetime('now')),
      released_by   TEXT,
      notes         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_body_release_adm ON body_release(admission_id);

    -- =====================================================================
    -- BILLING
    -- =====================================================================

    -- Chargeable items a clinic can bill. Fully configurable per clinic, with a
    -- colour used on the bill preview so staff can see where money is going.
    CREATE TABLE IF NOT EXISTS charge_heads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'other',
      colour       TEXT,
      default_rate REAL NOT NULL DEFAULT 0,
      hsn_sac      TEXT,
      gst_rate     REAL NOT NULL DEFAULT 0,
      is_taxable   INTEGER NOT NULL DEFAULT 0,
      applies_to   TEXT NOT NULL DEFAULT 'both'
                     CHECK (applies_to IN ('opd','ipd','both')),
      sort_order   INTEGER NOT NULL DEFAULT 0,
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (name, category)
    );

    -- Real line-item rows, replacing bills.items_json. GST returns need
    -- line-level HSN and tax, which a JSON blob cannot be reported on.
    CREATE TABLE IF NOT EXISTS bill_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id        INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      charge_head_id INTEGER REFERENCES charge_heads(id),
      description    TEXT NOT NULL,
      qty            REAL NOT NULL DEFAULT 1,
      rate           REAL NOT NULL DEFAULT 0,
      amount         REAL NOT NULL DEFAULT 0,
      hsn_sac        TEXT,
      gst_rate       REAL NOT NULL DEFAULT 0,
      is_taxable     INTEGER NOT NULL DEFAULT 0,
      cgst           REAL NOT NULL DEFAULT 0,
      sgst           REAL NOT NULL DEFAULT 0,
      -- Where the line came from, so a charge can be traced back and so
      -- auto-accrual does not post the same day's bed charge twice.
      source         TEXT NOT NULL DEFAULT 'manual',
      source_ref_id  INTEGER,
      accrual_date   TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      created_by     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);
    -- Stops a restarted scheduler from double-posting the same day's accrual.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_items_accrual_once
      ON bill_items(bill_id, source, source_ref_id, accrual_date)
      WHERE accrual_date IS NOT NULL;

    -- Money received against a bill. Supports part payments.
    CREATE TABLE IF NOT EXISTS bill_payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id      INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      amount       REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      reference    TEXT,
      received_at  TEXT NOT NULL DEFAULT (datetime('now')),
      received_by  TEXT,
      notes        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

    -- Deposits taken at admission, adjusted against the final bill. Refunds
    -- matter most on LAMA and death, where money is usually owed back.
    CREATE TABLE IF NOT EXISTS advances (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id    INTEGER NOT NULL REFERENCES patients(id),
      admission_id  INTEGER REFERENCES ip_admissions(id) ON DELETE SET NULL,
      receipt_no    TEXT,
      amount        REAL NOT NULL,
      payment_mode  TEXT NOT NULL,
      received_at   TEXT NOT NULL DEFAULT (datetime('now')),
      received_by   TEXT,
      adjusted_amount REAL NOT NULL DEFAULT 0,
      refunded_amount REAL NOT NULL DEFAULT 0,
      refunded_at   TEXT,
      refunded_by   TEXT,
      refund_reason TEXT,
      notes         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_advances_patient ON advances(patient_id);
    CREATE INDEX IF NOT EXISTS idx_advances_admission ON advances(admission_id);

    -- =====================================================================
    -- TPA / INSURANCE
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS tpa_master (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      code          TEXT,
      contact_person TEXT,
      phone         TEXT,
      email         TEXT,
      address       TEXT,
      notes         TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tpa_claims (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tpa_id         INTEGER NOT NULL REFERENCES tpa_master(id),
      patient_id     INTEGER NOT NULL REFERENCES patients(id),
      admission_id   INTEGER REFERENCES ip_admissions(id) ON DELETE SET NULL,
      bill_id        INTEGER REFERENCES bills(id) ON DELETE SET NULL,
      policy_no      TEXT,
      insurer_name   TEXT,
      preauth_no     TEXT,
      preauth_amount REAL NOT NULL DEFAULT 0,
      preauth_status TEXT NOT NULL DEFAULT 'pending'
                       CHECK (preauth_status IN ('pending','approved','rejected','not_required')),
      claimed_amount REAL NOT NULL DEFAULT 0,
      approved_amount REAL NOT NULL DEFAULT 0,
      settled_amount REAL NOT NULL DEFAULT 0,
      copay_amount   REAL NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','preauth_sent','preauth_approved','submitted','queried','approved','settled','rejected','closed')),
      submitted_at   TEXT,
      settled_at     TEXT,
      notes          TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tpa_claims_status ON tpa_claims(status);
    CREATE INDEX IF NOT EXISTS idx_tpa_claims_admission ON tpa_claims(admission_id);

    -- Saveable discharge-summary templates, scoped to a department and/or a
    -- doctor, so a summary is one click. content_json holds the prefilled
    -- fields (diagnosis, treatment, advice, …); the discharge form merges them.
    CREATE TABLE IF NOT EXISTS discharge_templates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      department   TEXT,
      doctor_id    INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
      content_json TEXT NOT NULL DEFAULT '{}',
      is_active    INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_discharge_tpl_dept ON discharge_templates(department, doctor_id);

    -- Doctor raises an admission request from OPD; reception approves it and
    -- picks the ward/bed. Keeps admission authority with reception while letting
    -- the doctor initiate.
    CREATE TABLE IF NOT EXISTS admission_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id    INTEGER NOT NULL REFERENCES patients(id),
      doctor_id     INTEGER REFERENCES doctors(id),
      requested_by  TEXT,
      provisional_diagnosis TEXT,
      suggested_ward_id INTEGER REFERENCES wards(id),
      urgency       TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','emergency')),
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
      requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at    TEXT,
      decided_by    TEXT,
      decision_note TEXT,
      admission_id  INTEGER REFERENCES ip_admissions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_adm_req_status ON admission_requests(status, requested_at);

    -- =====================================================================
    -- PEDIATRICS
    -- =====================================================================

    -- One growth measurement occasion for a child. z-scores/centiles are stored
    -- as recorded so a historic chart does not shift if the reference changes.
    CREATE TABLE IF NOT EXISTS peds_growth_measurements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      measured_on  TEXT NOT NULL DEFAULT (date('now')),
      age_days     INTEGER,
      weight_kg    REAL,
      height_cm    REAL,
      head_circ_cm REAL,
      bmi          REAL,
      wfa_z REAL, lhfa_z REAL, hcfa_z REAL, bfa_z REAL,
      wfa_c REAL, lhfa_c REAL, hcfa_c REAL, bfa_c REAL,
      notes        TEXT,
      recorded_by  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_peds_growth_patient ON peds_growth_measurements(patient_id, measured_on);

    -- Immunisation diary. One row per scheduled dose per child, updated when given.
    CREATE TABLE IF NOT EXISTS peds_vaccine_records (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      vaccine      TEXT NOT NULL,
      schedule_age TEXT,
      due_date     TEXT,
      given_date   TEXT,
      status       TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','given','overdue','skipped')),
      dose         TEXT,
      route        TEXT,
      site         TEXT,
      brand        TEXT,
      batch_no     TEXT,
      notes        TEXT,
      recorded_by  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_peds_vax_patient ON peds_vaccine_records(patient_id, due_date);

    CREATE TABLE IF NOT EXISTS tpa_claim_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id   INTEGER NOT NULL REFERENCES tpa_claims(id) ON DELETE CASCADE,
      event      TEXT NOT NULL,
      detail     TEXT,
      amount     REAL,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tpa_events_claim ON tpa_claim_events(claim_id, occurred_at);
  `);
}
