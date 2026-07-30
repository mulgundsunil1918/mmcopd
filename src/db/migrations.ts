import type Database from 'better-sqlite3';
import { createSchema, SCHEMA_VERSION } from './schema';
import { DEFAULT_SLIP_TEMPLATES } from './slip-templates';

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
  // Customizable list of misc-charge service categories. Stored as a single
  // comma-separated string so it can flow through the existing key-value
  // settings table without schema work.
  setSettingIfEmpty(db, 'misc_services', 'Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other');

  // Network mode (multi-station). Default 'local' on every fresh install — admin
  // opts in via Settings → System → Network Mode after physically setting up
  // the LAN topology + server PC.
  setSettingIfEmpty(db, 'network_mode', 'local');
  setSettingIfEmpty(db, 'network_listen_port', '4321');
  setSettingIfEmpty(db, 'network_server_url', '');
  setSettingIfEmpty(db, 'network_secret', '');
  setSettingIfEmpty(db, 'station_name', '');

  // Factory default admin password changed 1918 → 1234. Migrate ONLY installs
  // still sitting on the old factory default (i.e. the admin never changed it).
  // Custom passwords are never touched.
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get() as { value: string } | undefined;
    if (row && row.value === '1918') {
      db.prepare("UPDATE settings SET value='1234' WHERE key='admin_password'").run();
    }
  } catch { /* ignore */ }

  // Optimistic-lock row version for tables most likely to see concurrent edits
  // across stations (reception books while doctor changes status, etc.). Default 1
  // means existing rows behave like fresh ones; every UPDATE bumps it server-side
  // and CAS-checks the caller's last-seen value to spot conflicts.
  addColumnIfMissing(db, 'appointments', 'row_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'consultations', 'row_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'patients', 'row_version', 'INTEGER NOT NULL DEFAULT 1');

  // Per-specialty OPD-slip body templates. Each doctor picks one (doctors.template_id).
  // The templates themselves live as JSON in the settings table so the user can edit
  // / add / remove without a schema migration. Custom field values are stored on each
  // consultation in extra_fields_json. The "header / vitals / signature / follow-up"
  // wrappers on the printed slip are unchanged — only the body sections are template-driven.
  addColumnIfMissing(db, 'doctors', 'template_id', 'INTEGER');
  addColumnIfMissing(db, 'consultations', 'extra_fields_json', 'TEXT');
  setSettingIfEmpty(db, 'slip_templates', JSON.stringify(DEFAULT_SLIP_TEMPLATES));

  // Merge any newly-seeded default templates (e.g. ENT, General Medicine) into
  // existing installs WITHOUT clobbering user customizations. Identity is by
  // name (case-insensitive). Doesn't touch templates the user has edited or
  // renamed — only appends ones that aren't there yet.
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='slip_templates'").get() as { value: string } | undefined;
    if (row?.value) {
      const current = JSON.parse(row.value) as Array<{ id: number; name: string }>;
      const haveNames = new Set(current.map((t) => (t.name || '').toLowerCase()));
      const additions = DEFAULT_SLIP_TEMPLATES.filter((t) => !haveNames.has(t.name.toLowerCase()));
      if (additions.length > 0) {
        const maxId = current.reduce((mx, t) => Math.max(mx, t.id || 0), 0);
        const merged = [...current];
        for (let i = 0; i < additions.length; i++) {
          merged.push({ ...additions[i], id: maxId + i + 1 });
        }
        db.prepare("UPDATE settings SET value=? WHERE key='slip_templates'").run(JSON.stringify(merged));
      }
    }
  } catch { /* ignore — corrupt JSON or missing key, fresh install path handles it */ }

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
  // (no clinic-specific prefills — admin enters via Settings → Clinic on first run)

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

  if (currentVersion < 3) {
    migrateV2toV3(db);
  }

  if (currentVersion < 4) {
    migrateV3toV4(db);
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

// ============================================================
// v2 → v3: WhatsApp Communication Platform — Phase 1
//   Adds 7 tables: wa_accounts, wa_templates, wa_automation_rules,
//   wa_message_queue, wa_messages, wa_conversations, wa_webhook_events
// ============================================================
function migrateV2toV3(db: Database.Database) {
  db.exec(`
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

// ============================================================
// v3 → v4: WhatsApp Campaigns (broadcast to patient segments)
// ============================================================
function migrateV3toV4(db: Database.Database) {
  db.exec(`
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
