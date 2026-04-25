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
  addColumnIfMissing(db, 'patients', 'place', 'TEXT');
  addColumnIfMissing(db, 'patients', 'district', 'TEXT');
  addColumnIfMissing(db, 'patients', 'state', 'TEXT');
  addColumnIfMissing(db, 'appointments', 'consultation_token', 'TEXT');
  addColumnIfMissing(db, 'patients', 'profession', 'TEXT');

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
  if (currentVersion < SCHEMA_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
    ).run(String(SCHEMA_VERSION));
  }
}
