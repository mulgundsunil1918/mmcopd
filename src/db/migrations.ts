import type Database from 'better-sqlite3';
import { createSchema, SCHEMA_VERSION } from './schema';

export function runMigrations(db: Database.Database) {
  createSchema(db);
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
