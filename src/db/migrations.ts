import type Database from 'better-sqlite3';
import { createSchema, SCHEMA_VERSION } from './schema';

function addColumnIfMissing(db: Database.Database, table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/** Fill a setting only if it is currently missing OR empty. Never overwrites a user's value. */
function setSettingIfEmpty(db: Database.Database, key: string, value: string) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  const current = row?.value ?? '';
  if (current.trim().length === 0) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
}

export function runMigrations(db: Database.Database) {
  createSchema(db);
  addColumnIfMissing(db, 'doctors', 'signature', 'TEXT');
  addColumnIfMissing(db, 'doctors', 'qualifications', 'TEXT');
  addColumnIfMissing(db, 'doctors', 'registration_no', 'TEXT');
  addColumnIfMissing(db, 'doctors', 'color', 'TEXT');
  // Optional consulting-window per doctor (HH:MM strings, empty = always available).
  addColumnIfMissing(db, 'doctors', 'available_from', 'TEXT');
  addColumnIfMissing(db, 'doctors', 'available_to', 'TEXT');
  addColumnIfMissing(db, 'patients', 'place', 'TEXT');
  addColumnIfMissing(db, 'patients', 'district', 'TEXT');
  addColumnIfMissing(db, 'patients', 'state', 'TEXT');
  addColumnIfMissing(db, 'appointments', 'consultation_token', 'TEXT');
  addColumnIfMissing(db, 'patients', 'profession', 'TEXT');

  // users.doctor_id was added to the schema after some installs already created the users
  // table — add it to existing DBs so doctor-linked logins (and FK ref counts) work.
  addColumnIfMissing(db, 'users', 'doctor_id', 'INTEGER REFERENCES doctors(id)');

  // Free follow-up policy: every paid visit grants N free follow-up visits within X days
  // with the same doctor. We tag the bill with a flag + the paid "anchor" appointment so
  // analytics can compute remaining entitlement and revenue forgone.
  addColumnIfMissing(db, 'bills', 'is_free_followup', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'followup_parent_appt_id', 'INTEGER REFERENCES appointments(id)');
  // Default rules: enabled, 7-day window, 2 free visits per paid anchor. All overridable in Settings.
  // Grace days = extra window beyond the strict cutoff where the receptionist can
  // MANUALLY grant a courtesy free visit (e.g. patient arrived 1 day late). These
  // get logged separately as "relaxed" follow-ups for honest analytics.
  setSettingIfEmpty(db, 'followup_enabled', 'true');
  setSettingIfEmpty(db, 'followup_window_days', '7');
  setSettingIfEmpty(db, 'followup_free_visits', '2');
  setSettingIfEmpty(db, 'followup_grace_days', '2');
  addColumnIfMissing(db, 'bills', 'is_relaxed_followup', 'INTEGER NOT NULL DEFAULT 0');

  // Registration fee: a one-time charge per patient. Receptionist can collect it
  // at the moment of patient creation OR defer to the first appointment booking.
  // The two flag columns let us bill it as a separate line item AND know whether
  // the patient still owes it.
  addColumnIfMissing(db, 'patients', 'registration_fee_paid', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'patients', 'registration_fee_paid_at', 'TEXT');
  setSettingIfEmpty(db, 'registration_fee_enabled', 'true');
  setSettingIfEmpty(db, 'registration_fee_amount', '100');
  // Default timing: ask each time. Other values: 'at_registration', 'at_first_appointment'.
  setSettingIfEmpty(db, 'registration_fee_default_timing', 'ask');

  // Miscellaneous charges (procedures, vaccinations, nebulizations, etc.) — bills
  // not tied to an appointment. doctor_id lets analytics attribute revenue to the
  // performing doctor; notes captures the receptionist's free-text comment;
  // bill_kind = 'misc' marks rows so analytics + patient log can group them.
  addColumnIfMissing(db, 'bills', 'doctor_id', 'INTEGER REFERENCES doctors(id)');
  addColumnIfMissing(db, 'bills', 'notes', 'TEXT');
  addColumnIfMissing(db, 'bills', 'bill_kind', "TEXT NOT NULL DEFAULT 'opd'");

  // Phase A pharmacy-compliance link columns. drug_master / drug_stock_batches
  // tables are created in createSchema(); these FK columns extend existing tables.
  addColumnIfMissing(db, 'prescription_items', 'drug_master_id', 'INTEGER REFERENCES drug_master(id)');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'drug_master_id', 'INTEGER REFERENCES drug_master(id)');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'batch_id', 'INTEGER REFERENCES drug_stock_batches(id)');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'gst_amount', 'REAL DEFAULT 0');

  // One-time: clear the old hard-coded known_villages so the new bundled list (places.ts) takes over.
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='known_villages'").get() as { value: string } | undefined;
    if (row && row.value === 'Mulgund, Gadag, Lakshmeshwar, Shirahatti, Naregal, Rona, Ron, Hulkoti, Koppal, Hubli, Dharwad') {
      db.prepare("UPDATE settings SET value='' WHERE key='known_villages'").run();
    }
  } catch { /* ignore */ }
  // Pre-fill clinic contact details so WhatsApp template placeholders are not blank
  // out of the box. Skipped automatically if the user has already entered values.
  setSettingIfEmpty(db, 'clinic_phone', '9019263206');
  setSettingIfEmpty(db, 'clinic_address', '1st Floor, Arihant Plaza, Rotary Circle, Gadag - 582 101');

  // Indexes that depend on the migrated columns — create AFTER column migrations.
  db.exec('CREATE INDEX IF NOT EXISTS idx_patients_place ON patients(place, district);');
  const current = db
    .prepare("SELECT value FROM schema_meta WHERE key='version'")
    .get() as { value: string } | undefined;
  const currentVersion = current ? parseInt(current.value, 10) : 0;

  // ============================================================
  // v1 → v2: pharmacy compliance migration
  //   1. Copy each drug_inventory row into drug_master + one drug_stock_batches row.
  //   2. Backfill drug_master_id on existing prescription_items + pharmacy_sale_items by name.
  //   3. Re-map old AppMode keys (reception_doctor_lab → reception_pharmacy_doctor_lab; reception_doctor_lab_ip → full).
  //   4. drug_inventory table is INTENTIONALLY KEPT as a safety net — drop in v3 only.
  // ============================================================
  if (currentVersion < 2) {
    migrateV1toV2(db);
  }

  if (currentVersion < SCHEMA_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
    ).run(String(SCHEMA_VERSION));
  }
}

function migrateV1toV2(db: Database.Database) {
  // Detect whether the legacy drug_inventory table exists at all (fresh installs won't have it).
  const hasLegacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drug_inventory'")
    .get();

  const tx = db.transaction(() => {
    if (hasLegacy) {
      const legacy = db.prepare('SELECT * FROM drug_inventory').all() as any[];
      if (legacy.length > 0) {
        const insMaster = db.prepare(`
          INSERT INTO drug_master
            (name, generic_name, form, strength, schedule, default_mrp, low_stock_threshold, is_active)
          VALUES (?, ?, ?, ?, 'OTC', ?, ?, ?)
        `);
        const insBatch = db.prepare(`
          INSERT OR IGNORE INTO drug_stock_batches
            (drug_master_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, mrp, received_at, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), 1)
        `);
        // Skip rows whose name already exists in drug_master (idempotent re-runs).
        const existsByName = db.prepare('SELECT id FROM drug_master WHERE LOWER(name)=LOWER(?) LIMIT 1');
        for (const d of legacy) {
          const already = existsByName.get(d.name) as { id: number } | undefined;
          let masterId: number;
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
          const batchNo = (d.batch && String(d.batch).trim()) || 'LEGACY';
          const expiry = d.expiry || '2099-12-31';
          insBatch.run(masterId, batchNo, expiry, d.stock_qty ?? 0, d.stock_qty ?? 0, d.purchase_price, d.mrp ?? 0);
        }
      }
    }

    // Backfill FK columns by case-insensitive name match against drug_master.
    db.exec(`
      UPDATE prescription_items SET drug_master_id = (
        SELECT id FROM drug_master WHERE LOWER(drug_master.name) = LOWER(prescription_items.drug_name) LIMIT 1
      ) WHERE drug_master_id IS NULL
    `);
    db.exec(`
      UPDATE pharmacy_sale_items SET drug_master_id = (
        SELECT id FROM drug_master WHERE LOWER(drug_master.name) = LOWER(pharmacy_sale_items.drug_name) LIMIT 1
      ) WHERE drug_master_id IS NULL
    `);

    // Re-map app_mode for the new 6-mode ladder. We keep 'reception' and
    // 'reception_doctor' unchanged, but old lab/ip modes get bumped.
    const remapMode = db.prepare(`
      UPDATE settings SET value = ?
      WHERE key = 'app_mode' AND value = ?
    `);
    remapMode.run('reception_pharmacy_doctor_lab', 'reception_doctor_lab');
    remapMode.run('full', 'reception_doctor_lab_ip');
  });
  tx();
}
