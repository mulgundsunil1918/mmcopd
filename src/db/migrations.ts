import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createSchema, SCHEMA_VERSION } from './schema';
import { DEFAULT_SLIP_TEMPLATES } from './slip-templates';

/** The factory password created by ensureDefaultAdmin() on a fresh install. */
const FACTORY_PASSWORD = 'admin123';

/**
 * Flag every account still using the factory password so the forced-change
 * screen fires on EXISTING installs too.
 *
 * ensureDefaultAdmin() only sets must_change_password on a brand-new database
 * (user count === 0). Without this backfill, a clinic that has been running
 * since before the flag existed keeps admin/admin123 forever and never sees
 * the prompt. Re-running is harmless: once the password changes the hash stops
 * matching and the account is left alone.
 */
function flagFactoryPasswordUsers(db: Database.Database) {
  let rows: { id: number; salt: string; password_hash: string }[];
  try {
    rows = db.prepare('SELECT id, salt, password_hash FROM users').all() as any;
  } catch { return; }
  const upd = db.prepare('UPDATE users SET must_change_password=1 WHERE id=?');
  for (const r of rows) {
    if (!r.salt || !r.password_hash) continue;
    try {
      const calc = crypto.scryptSync(FACTORY_PASSWORD, r.salt, 32).toString('hex');
      if (calc === r.password_hash) upd.run(r.id);
    } catch { /* ignore a single malformed row */ }
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/**
 * Make bills.patient_id nullable so a walk-in / quick custom bill can be raised
 * with just a typed name and no patient record.
 *
 * The original column is `patient_id INTEGER NOT NULL`, which rejects such a
 * bill. SQLite cannot drop a NOT NULL in place, so the table is rebuilt via the
 * official 12-step procedure — but the new CREATE is derived from the LIVE
 * schema (sqlite_master), not hand-written, so no column, default or added
 * migration field can be missed.
 *
 * Safety:
 *   - Idempotent: returns immediately if patient_id is already nullable.
 *   - Runs inside a transaction with foreign keys deferred, and a
 *     foreign_key_check afterwards; any failure rolls the whole thing back so
 *     the live bills table is never left half-migrated.
 *   - bills is referenced by bill_items, bill_payments, tpa_claims and
 *     ip_admissions; ids are preserved by the copy, so those references stay
 *     valid.
 */
function makeBillPatientNullable(db: Database.Database) {
  let cols: { name: string; notnull: number }[];
  try {
    cols = db.prepare('PRAGMA table_info(bills)').all() as any;
  } catch {
    return; // bills table absent on a brand-new DB — createSchema already made it nullable-free? no-op.
  }
  const pid = cols.find((c) => c.name === 'patient_id');
  if (!pid || pid.notnull === 0) return; // already nullable, nothing to do

  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bills'").get() as { sql: string } | undefined;
  if (!row?.sql) throw new Error('Cannot make bills.patient_id nullable: could not read the bills table definition.');

  // Derive the new CREATE from the live one: rename target, and drop NOT NULL
  // from patient_id only. Match the exact column declaration.
  let newSql = row.sql.replace(/CREATE TABLE\s+"?bills"?/i, 'CREATE TABLE bills_new');
  const before = newSql;
  newSql = newSql.replace(/(\bpatient_id\s+INTEGER)\s+NOT\s+NULL/i, '$1');
  if (newSql === before) {
    throw new Error('Cannot make bills.patient_id nullable: did not find "patient_id INTEGER NOT NULL" in the table definition.');
  }

  const fkWasOn = (db.pragma('foreign_keys', { simple: true }) as unknown) === 1;
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    db.exec(newSql);
    db.exec('INSERT INTO bills_new SELECT * FROM bills');
    const oldCount = (db.prepare('SELECT COUNT(*) AS c FROM bills').get() as { c: number }).c;
    const newCount = (db.prepare('SELECT COUNT(*) AS c FROM bills_new').get() as { c: number }).c;
    if (oldCount !== newCount) {
      throw new Error(`Row count mismatch during bills rebuild: ${oldCount} → ${newCount}. Aborting.`);
    }
    db.exec('DROP TABLE bills');
    db.exec('ALTER TABLE bills_new RENAME TO bills');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at)');
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`Foreign-key check failed after bills rebuild (${violations.length} issues). Aborting — no changes applied.`);
    }
  });
  try {
    tx();
  } catch (err: any) {
    if (fkWasOn) db.pragma('foreign_keys = ON');
    throw new Error(`Making bills.patient_id nullable failed: ${err?.message || String(err)}. The bills table is unchanged.`);
  }
  if (fkWasOn) db.pragma('foreign_keys = ON');
}

/**
 * Restore bill totals that were zeroed by the preview/print path.
 *
 * The defect: `misc:create` and `bills:create` wrote their lines only into
 * `bills.items_json`, never into `bill_items`. Opening or printing such a bill
 * called `recalcBill()`, which derives the totals from `bill_items` — found none
 * — and then PERSISTED subtotal/total as 0. A ₹400 dressing charge became a ₹0
 * invoice in front of the patient and a ₹0 row in the database.
 *
 * `migrateBillItemsFromJson` (above) later creates the missing line rows from
 * items_json, but it never touches `bills.subtotal`/`total`, so the zero stayed
 * put — and every figure reading `bills.total` (Accounts, Billing History,
 * misc:summary, analytics) kept under-reporting that revenue for good.
 *
 * This runs AFTER that backfill, so the lines exist by the time we re-add them
 * up. It only repairs a bill whose stored total is zero while its lines clearly
 * are not — a genuinely free visit has no lines, or lines that sum to zero, and
 * is left alone. Idempotent: once repaired, the total is no longer zero and the
 * row stops matching.
 */
function repairZeroedBillTotals(db: Database.Database) {
  let rows: { id: number; discount: number; discount_type: string; line_total: number }[];
  try {
    rows = db.prepare(
      `SELECT b.id,
              COALESCE(b.discount, 0)            AS discount,
              COALESCE(b.discount_type, 'flat')  AS discount_type,
              COALESCE(SUM(bi.amount), 0)        AS line_total
         FROM bills b
         JOIN bill_items bi ON bi.bill_id = b.id
        WHERE COALESCE(b.total, 0) = 0
          AND b.cancelled_at IS NULL
        GROUP BY b.id
       HAVING COALESCE(SUM(bi.amount), 0) > 0`
    ).all() as any;
  } catch {
    return;   // pre-existing install without bill_items yet — nothing to repair
  }
  if (rows.length === 0) return;

  const upd = db.prepare('UPDATE bills SET subtotal=?, total=? WHERE id=?');
  let repaired = 0;
  let recovered = 0;
  db.transaction(() => {
    for (const r of rows) {
      const subtotal = Math.round(Number(r.line_total) * 100) / 100;
      const disc = Number(r.discount) || 0;
      const off = r.discount_type === 'percent' ? (subtotal * disc) / 100 : disc;
      const total = Math.max(0, Math.round((subtotal - off) * 100) / 100);
      if (total <= 0) continue;                    // a full-discount bill really is zero
      upd.run(subtotal, total, r.id);
      repaired++;
      recovered += total;
    }
    if (repaired > 0) {
      db.prepare(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES (NULL, 'bills_zero_total_repaired', 'bills', NULL, ?)`
      ).run(`Restored ${repaired} bill total(s) worth ${recovered.toFixed(2)} that had been zeroed by the bill-preview recalculation.`);
    }
  })();
}

/**
 * Copy existing bills.items_json into real bill_items rows.
 *
 * items_json stays untouched as a fallback, so this migration is non-destructive
 * and can be re-run. Only bills that have no rows yet are converted, so a bill
 * whose lines have since been edited is never overwritten.
 *
 * Historic lines are marked exempt with no tax: they were raised before GST
 * support existed, and inventing tax on a bill already given to a patient would
 * misstate what was actually charged.
 */
function migrateBillItemsFromJson(db: Database.Database) {
  let bills: { id: number; items_json: string }[];
  try {
    bills = db
      .prepare(
        `SELECT b.id, b.items_json FROM bills b
         WHERE b.items_json IS NOT NULL AND b.items_json != ''
           AND NOT EXISTS (SELECT 1 FROM bill_items bi WHERE bi.bill_id = b.id)`
      )
      .all() as any;
  } catch (err: any) {
    throw new Error(`Bill-item migration could not read bills: ${err?.message || String(err)}`);
  }
  if (bills.length === 0) return;

  const ins = db.prepare(
    `INSERT INTO bill_items (bill_id, description, qty, rate, amount, is_taxable, gst_rate, source)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'migrated')`
  );

  let converted = 0;
  const skipped: number[] = [];
  const tx = db.transaction(() => {
    for (const b of bills) {
      let items: any[];
      try {
        const parsed = JSON.parse(b.items_json);
        if (!Array.isArray(parsed)) { skipped.push(b.id); continue; }
        items = parsed;
      } catch {
        // Malformed JSON — leave items_json in place and carry on rather than
        // aborting the whole migration for one bad row.
        skipped.push(b.id);
        continue;
      }
      for (const it of items) {
        const amount = Number(it?.amount ?? 0) || 0;
        const qty = Number(it?.qty ?? 1) || 1;
        ins.run(
          b.id,
          String(it?.label ?? it?.description ?? it?.name ?? 'Item'),
          qty,
          Number(it?.rate ?? (qty ? amount / qty : amount)) || 0,
          amount
        );
      }
      converted++;
    }
  });

  try {
    tx();
  } catch (err: any) {
    throw new Error(
      `Bill-item migration failed after converting ${converted} of ${bills.length} bills: ${err?.message || String(err)}. ` +
      `No changes were applied; bills.items_json is untouched.`
    );
  }
  if (skipped.length > 0) {
    console.warn(
      `[migration] ${skipped.length} bill(s) had unreadable items_json and were left as-is: ids ${skipped.join(', ')}`
    );
  }
}

/**
 * Seed a starting set of charge heads so a new clinic has something to bill
 * against on day one. Every field is editable in Settings, and nothing is
 * re-inserted once a clinic has its own — this only runs on an empty table.
 *
 * Defaults are GST-exempt because clinical services are exempt in India;
 * medicines are the taxable case and carry their own rate from the drug master.
 */
function seedDefaultChargeHeads(db: Database.Database) {
  let count = 0;
  try {
    count = (db.prepare('SELECT COUNT(*) AS c FROM charge_heads').get() as { c: number }).c;
  } catch (err: any) {
    throw new Error(`Could not read charge_heads: ${err?.message || String(err)}`);
  }
  if (count > 0) return;

  const rows: [string, string, string, number, string][] = [
    // name, category, colour, applies_to, ...
    ['Consultation',        'doctor',    '#7c3aed', 0, 'both'],
    ['Follow-up Visit',     'doctor',    '#8b5cf6', 0, 'both'],
    ['Daily Visit Charge',  'doctor',    '#a78bfa', 0, 'ipd'],
    ['Bed Charge',          'bed',       '#2563eb', 0, 'ipd'],
    ['Nursing Charge',      'nursing',   '#0d9488', 0, 'ipd'],
    ['Procedure',           'procedure', '#db2777', 0, 'both'],
    ['Laboratory',          'lab',       '#d97706', 0, 'both'],
    ['Pharmacy',            'pharmacy',  '#059669', 0, 'both'],
    ['Oxygen',              'other',     '#0891b2', 0, 'ipd'],
    ['Registration Fee',    'other',     '#64748b', 0, 'opd'],
    ['Admission Charge',    'other',     '#475569', 0, 'ipd'],
  ];
  const ins = db.prepare(
    `INSERT INTO charge_heads (name, category, colour, default_rate, is_taxable, gst_rate, applies_to, sort_order)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
  );
  const tx = db.transaction(() => {
    rows.forEach((r, i) => ins.run(r[0], r[1], r[2], r[3], r[4], i));
  });
  try {
    tx();
  } catch (err: any) {
    throw new Error(`Could not seed default charge heads: ${err?.message || String(err)}`);
  }
}

/**
 * Give every existing appointment its per-patient visit number and printable
 * visit id, in chronological order.
 *
 * Only fills rows where visit_number is NULL, so it is safe to re-run and never
 * renumbers a visit that already has one (renumbering would change an
 * identifier a patient may already be holding on a printed slip).
 */
function backfillVisitNumbers(db: Database.Database) {
  let pending = 0;
  try {
    pending = (db.prepare('SELECT COUNT(*) AS c FROM appointments WHERE visit_number IS NULL').get() as { c: number }).c;
  } catch (err: any) {
    throw new Error(`Visit-number backfill could not read appointments: ${err?.message || String(err)}`);
  }
  if (pending === 0) return;

  // Only unnumbered rows. Renumbering an appointment that already has a visit
  // id would change an identifier the patient may be holding on a printed slip
  // or in a WhatsApp message.
  const rows = db
    .prepare(
      `SELECT a.id, a.patient_id, p.uhid
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.visit_number IS NULL
       ORDER BY a.patient_id, a.appointment_date, a.appointment_time, a.id`
    )
    .all() as { id: number; patient_id: number; uhid: string | null }[];

  // Continue each patient's sequence after their highest existing number, so a
  // partial backfill (e.g. rows merged in from an older backup) appends rather
  // than colliding with numbers already issued.
  const perPatient = new Map<number, number>();
  for (const r of db
    .prepare(
      `SELECT patient_id, COALESCE(MAX(visit_number), 0) AS mx
       FROM appointments WHERE visit_number IS NOT NULL GROUP BY patient_id`
    )
    .all() as { patient_id: number; mx: number }[]) {
    perPatient.set(r.patient_id, r.mx);
  }

  const upd = db.prepare('UPDATE appointments SET visit_number=?, visit_id=? WHERE id=?');

  const tx = db.transaction(() => {
    for (const r of rows) {
      const n = (perPatient.get(r.patient_id) ?? 0) + 1;
      perPatient.set(r.patient_id, n);
      upd.run(n, r.uhid ? `${r.uhid}/V${n}` : null, r.id);
    }
  });

  try {
    tx();
  } catch (err: any) {
    throw new Error(
      `Visit-number backfill failed while numbering ${rows.length} appointments: ${err?.message || String(err)}. ` +
      `No changes were applied (the backfill runs in a transaction).`
    );
  }
}

/**
 * Seed the counters table from identifiers that already exist.
 *
 * Runs before any new ID is allocated. Each counter is set to the HIGHEST
 * number already present in that series, so the next allocation continues past
 * live records instead of colliding with them.
 *
 * Uses MAX of the numeric suffix, never COUNT — a clinic that has deleted
 * records has fewer rows than its highest number, and seeding from COUNT would
 * immediately reissue an existing identifier.
 *
 * Idempotent: re-running only ever raises a counter, never lowers it, so a
 * counter that has already advanced past the stored data is left alone.
 */
function seedCountersFromExistingData(db: Database.Database) {
  const raise = db.prepare(
    `INSERT INTO counters (scope, next_value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET
       next_value = MAX(next_value, excluded.next_value),
       updated_at = datetime('now')`
  );

  /** Highest integer found in `col` after stripping everything but the trailing digits. */
  const maxSuffix = (table: string, col: string, like: string): number => {
    try {
      const row = db
        .prepare(
          `SELECT MAX(CAST(replace(substr(${col}, length(${col}) - 3), '-', '') AS INTEGER)) AS mx
           FROM ${table} WHERE ${col} LIKE ?`
        )
        .get(like) as { mx: number | null } | undefined;
      return row?.mx ?? 0;
    } catch {
      // Table may not exist yet on a brand-new database — nothing to seed.
      return 0;
    }
  };

  // --- UHID: PT-YYYYMMDD-NNNN, one counter per day ---
  try {
    const days = db
      .prepare(`SELECT DISTINCT substr(uhid, 4, 8) AS day FROM patients WHERE uhid LIKE 'PT-%'`)
      .all() as { day: string }[];
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`uhid:${day}`, maxSuffix('patients', 'uhid', `PT-${day}-%`));
    }
  } catch { /* patients table absent on a fresh DB */ }

  // --- Legacy date-based bill and admission numbers ---
  // Old format was INV-YYYYMMDD-NNNN / IP-YYYYMMDD-NNNN. Those series are
  // retired in favour of the financial-year series, but their counters are
  // still seeded so that if a clinic's settings keep the old format, numbering
  // resumes correctly rather than restarting at 1.
  try {
    const days = db
      .prepare(`SELECT DISTINCT substr(bill_number, 5, 8) AS day FROM bills WHERE bill_number LIKE 'INV-%'`)
      .all() as { day: string }[];
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`bill-legacy:${day}`, maxSuffix('bills', 'bill_number', `INV-${day}-%`));
    }
  } catch { /* bills table absent */ }

  /**
   * Lab and pharmacy series moved off COUNT(*)+1 onto the atomic counter.
   *
   * Seed each day's counter past the highest number already issued, or an
   * existing clinic would restart at 0001 and collide with its own history on
   * the first order of the day. Each series walks ITS OWN table — nesting these
   * under the admissions loop (as they briefly were) meant a clinic with lab
   * orders but no in-patients got no seeding at all.
   */
  try {
    const days = db
      .prepare(`SELECT DISTINCT substr(order_number, 5, 8) AS day FROM lab_orders WHERE order_number LIKE 'LAB-%'`)
      .all() as { day: string }[];
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`lab:${day}`, maxSuffix('lab_orders', 'order_number', `LAB-${day}-%`));
    }
  } catch { /* lab_orders absent */ }

  try {
    const days = db
      .prepare(`SELECT DISTINCT substr(sale_number, 5, 8) AS day FROM pharmacy_sales WHERE sale_number LIKE 'PHX-%'`)
      .all() as { day: string }[];
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`sale:${day}`, maxSuffix('pharmacy_sales', 'sale_number', `PHX-${day}-%`));
    }
  } catch { /* pharmacy_sales absent */ }

  try {
    const days = db
      .prepare(`SELECT DISTINCT substr(admission_number, 4, 8) AS day FROM ip_admissions WHERE admission_number LIKE 'IP-%'`)
      .all() as { day: string }[];
    for (const { day } of days) {
      if (!/^\d{8}$/.test(day)) continue;
      raise.run(`ip-legacy:${day}`, maxSuffix('ip_admissions', 'admission_number', `IP-${day}-%`));
    }
  } catch { /* ip_admissions table absent */ }

  // --- Financial-year series already in use (re-runs of this migration) ---
  const seedFySeries = (table: string, col: string, prefix: string, scopePrefix: string) => {
    try {
      const rows = db
        .prepare(`SELECT ${col} AS v FROM ${table} WHERE ${col} LIKE '${prefix}/%'`)
        .all() as { v: string }[];
      const best = new Map<string, number>();
      for (const { v } of rows) {
        const m = /^([A-Za-z]+)\/(\d{4}-\d{2})\/(\d+)$/.exec(v);
        if (!m) continue;
        const scope = `${scopePrefix}:${m[1]}:${m[2]}`;
        const n = parseInt(m[3], 10);
        if (Number.isFinite(n)) best.set(scope, Math.max(best.get(scope) ?? 0, n));
      }
      for (const [scope, n] of best) raise.run(scope, n);
    } catch { /* table absent */ }
  };
  seedFySeries('bills', 'bill_number', 'INV', 'bill');
  seedFySeries('ip_admissions', 'admission_number', 'IP', 'ip');

  // --- Per-patient visit numbers ---
  try {
    const rows = db
      .prepare(`SELECT patient_id, COUNT(*) AS c FROM appointments GROUP BY patient_id`)
      .all() as { patient_id: number; c: number }[];
    for (const r of rows) raise.run(`visit:${r.patient_id}`, r.c);
  } catch { /* appointments table absent */ }
}

/**
 * Delete any settings value corrupted with the Unicode replacement character
 * (U+FFFD, "�"). An earlier build stored mojibake emojis in text like the
 * WhatsApp template; because a stored value overrides the code default, the
 * corruption survived every upgrade and WhatsApp showed "�" instead of 🙏/📅.
 * Removing the row lets the clean built-in default take over. Only touches rows
 * that actually contain "�", so a user's genuine customisation is never lost.
 */
function repairMojibakeSettings(db: Database.Database) {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const del = db.prepare('DELETE FROM settings WHERE key=?');
    for (const r of rows) {
      if (typeof r.value === 'string' && r.value.includes('�')) del.run(r.key);
    }
  } catch { /* settings table absent on a very old db */ }
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
  // Rich, re-editable discharge summary (structured fields + named sections) held as
  // JSON alongside the plain-text discharge_summary the print/legacy flows read.
  addColumnIfMissing(db, 'ip_admissions', 'discharge_summary_json', 'TEXT');
  // Manufacture date on every stock batch (drug strips print MFG + EXP). Stored as
  // YYYY-MM. Expiry was already captured; manufacture completes the compliance pair.
  addColumnIfMissing(db, 'drug_stock_batches', 'manufacture_date', 'TEXT');
  addColumnIfMissing(db, 'purchase_invoice_items', 'manufacture_date', 'TEXT');
  // Lab tests get a category (pathology / radiology) so the catalog can be grouped
  // and filtered; existing rows default to pathology.
  addColumnIfMissing(db, 'lab_tests', 'category', "TEXT NOT NULL DEFAULT 'pathology'");

  // users.doctor_id was added to the schema after some installs already created the users
  // table — add it to existing DBs so doctor-linked logins (and FK ref counts) work.
  addColumnIfMissing(db, 'users', 'doctor_id', 'INTEGER REFERENCES doctors(id)');
  addColumnIfMissing(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  flagFactoryPasswordUsers(db);

  // ===== Identifiers =====
  // visit_number is that patient's nth OPD visit (1, 2, 3...). visit_id is the
  // printable form, UHID/V{n}. The old code had two conflicting "Visit ID"s:
  // consultation_token held a non-unique label (3 letters of the name + 2 phone
  // digits + day of month) while the WhatsApp message showed UHID/V{global row
  // id}. A patient quoting one could not be matched against the other.
  addColumnIfMissing(db, 'appointments', 'visit_number', 'INTEGER');
  addColumnIfMissing(db, 'appointments', 'visit_id', 'TEXT');
  backfillVisitNumbers(db);
  seedCountersFromExistingData(db);

  // ===== IPD =====
  // bed_id replaces the old free-text bed_number/ward, which could not stop two
  // patients being placed in the same bed. bed_number/ward are left in place so
  // existing records stay readable.
  addColumnIfMissing(db, 'ip_admissions', 'bed_id', 'INTEGER REFERENCES beds(id)');
  addColumnIfMissing(db, 'ip_admissions', 'ward_id', 'INTEGER REFERENCES wards(id)');
  addColumnIfMissing(db, 'ip_admissions', 'admission_type', "TEXT NOT NULL DEFAULT 'planned'");
  addColumnIfMissing(db, 'ip_admissions', 'provisional_diagnosis', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'attendant_name', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'attendant_phone', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'attendant_relation', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'is_mlc', 'INTEGER NOT NULL DEFAULT 0');
  // Outcome is separate from status so analytics can group by how a stay ended
  // (discharged / lama / dama / death / referred / absconded) while status stays
  // the simple admitted-or-not flag the existing screens rely on.
  addColumnIfMissing(db, 'ip_admissions', 'outcome', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'outcome_notes', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'death_at', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'death_cause', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'referred_to', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'risk_explained_by', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'bill_id', 'INTEGER REFERENCES bills(id)');

  // Existing rows were only ever 'admitted' or 'discharged'; give the finished
  // ones the matching outcome so analytics has no blank bucket.
  try {
    db.prepare("UPDATE ip_admissions SET outcome='discharged' WHERE outcome IS NULL AND status='discharged'").run();
  } catch (err: any) {
    throw new Error(`Failed to backfill IPD outcomes: ${err?.message || String(err)}`);
  }

  // THE occupancy guarantee: one bed can hold at most one live admission.
  // Enforced by the database, not the UI, so two stations admitting at the same
  // moment cannot both take the same bed.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_single_active_admission
             ON ip_admissions(bed_id) WHERE bed_id IS NOT NULL AND status='admitted'`);
  } catch (err: any) {
    throw new Error(
      `Could not create the bed-occupancy constraint: ${err?.message || String(err)}. ` +
      `This usually means two live admissions already share a bed_id — resolve those rows, then restart.`
    );
  }

  // ===== Billing =====
  addColumnIfMissing(db, 'bills', 'admission_id', 'INTEGER REFERENCES ip_admissions(id)');
  addColumnIfMissing(db, 'bills', 'status', "TEXT NOT NULL DEFAULT 'paid'");
  addColumnIfMissing(db, 'bills', 'bill_type', "TEXT NOT NULL DEFAULT 'opd_consult'");
  addColumnIfMissing(db, 'bills', 'taxable_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'exempt_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'cgst_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'sgst_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'round_off', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'amount_paid', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'advance_adjusted', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'discount_reason', 'TEXT');
  addColumnIfMissing(db, 'bills', 'discount_by', 'TEXT');
  addColumnIfMissing(db, 'bills', 'cancelled_at', 'TEXT');
  addColumnIfMissing(db, 'bills', 'cancelled_by', 'TEXT');
  addColumnIfMissing(db, 'bills', 'cancel_reason', 'TEXT');
  addColumnIfMissing(db, 'bills', 'is_tax_invoice', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'bills', 'tpa_claim_id', 'INTEGER REFERENCES tpa_claims(id)');

  makeBillPatientNullable(db);
  migrateBillItemsFromJson(db);
  repairZeroedBillTotals(db);   // undo totals zeroed by the preview path (see above)
  repairMojibakeSettings(db);   // drop "�"-corrupted values so clean defaults return
  seedDefaultChargeHeads(db);

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
  // Existing clinics keep the original Kannada second-language on printed OPD slips.
  setSettingIfEmpty(db, 'print_patient_language', 'kn');
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
  // v2+ — each doctor can have up to 3 named template slots (New Patient / Follow-up / Procedure).
  addColumnIfMissing(db, 'doctors', 'template_id_2', 'INTEGER');
  addColumnIfMissing(db, 'doctors', 'template_id_3', 'INTEGER');
  addColumnIfMissing(db, 'doctors', 'template_slot_names', 'TEXT');
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

  // IPD discharge — structured fields replacing the single free-text column
  addColumnIfMissing(db, 'ip_admissions', 'discharge_diagnosis', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'condition_at_discharge', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'treatment_given', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'investigation_findings', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'operative_notes', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'discharge_medications_json', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'followup_plan', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'discharge_doctor_id', 'INTEGER REFERENCES doctors(id)');

  // Discharge approval workflow: request → final bill → approve → discharged.
  // 'none' = still admitted, no discharge asked for yet.
  addColumnIfMissing(db, 'ip_admissions', 'discharge_status', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(db, 'ip_admissions', 'discharge_requested_at', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'discharge_requested_by', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'discharge_approved_at', 'TEXT');
  addColumnIfMissing(db, 'ip_admissions', 'discharge_approved_by', 'TEXT');
  // Set when a clinic discharges with money still outstanding — reason is required
  // and audit-logged, so an unpaid discharge is always traceable.
  addColumnIfMissing(db, 'ip_admissions', 'discharge_override_reason', 'TEXT');
  // Bill freeze: set when the final bill is locked at discharge.
  addColumnIfMissing(db, 'bills', 'finalized_at', 'TEXT');
  addColumnIfMissing(db, 'bills', 'finalized_by', 'TEXT');

  /**
   * GST on pharmacy sales.
   *
   * Medicines are taxable in India (5/12/18%) while clinical services are
   * exempt, so a pharmacy receipt is the one place in a clinic that genuinely
   * needs a tax breakdown — and pharmacy_sales had no tax columns at all. The
   * rate lives on drug_master; these hold what was actually charged, so a
   * reprint years later shows the tax as it was on the day.
   */
  addColumnIfMissing(db, 'pharmacy_sales', 'taxable_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sales', 'exempt_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sales', 'cgst_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sales', 'sgst_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sales', 'is_tax_invoice', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'gst_rate', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'cgst', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'sgst', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'pharmacy_sale_items', 'hsn_sac', 'TEXT');

  // Appointment patient groups + procedure tags
  addColumnIfMissing(db, 'appointments', 'patient_group', 'TEXT');
  addColumnIfMissing(db, 'appointments', 'procedure_tags', 'TEXT');

  /**
   * Real link from a lab bill back to its order.
   *
   * The auto-raised lab bill only ever recorded the order in free text
   * ("Lab order LAB-20260816-0001"). That was enough to read, but not to act
   * on: to re-price a bill when the lab adds or drops a test you have to find
   * it reliably, and matching on a notes string breaks the moment anyone edits
   * the note. Backfilled from those notes so existing bills keep working.
   */
  addColumnIfMissing(db, 'bills', 'lab_order_id', 'INTEGER REFERENCES lab_orders(id)');
  try {
    db.exec(`
      UPDATE bills
         SET lab_order_id = (SELECT o.id FROM lab_orders o
                              WHERE bills.notes = 'Lab order ' || o.order_number)
       WHERE lab_order_id IS NULL
         AND notes LIKE 'Lab order %'
    `);
  } catch { /* pre-existing installs without lab_orders yet — nothing to backfill */ }
  db.exec('CREATE INDEX IF NOT EXISTS idx_bills_lab_order ON bills(lab_order_id);');

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
