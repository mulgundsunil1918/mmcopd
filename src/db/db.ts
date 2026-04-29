import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations';
import { seedIfEmpty } from './seed';
import { SCHEMA_VERSION } from './schema';

let db: Database.Database | null = null;

/**
 * Pre-migration safety snapshot — when an upgrade introduces a schema bump,
 * copy the current SQLite file (and WAL/SHM) into a dated subfolder under
 * userData/backups/pre-migration/ BEFORE we open it for writing.
 *
 * This is belt-and-suspenders on top of the transactional migration: even if
 * the migration succeeds, the user has a known-good copy of the previous
 * version's data they can roll back to manually.
 */
function preMigrationSnapshotIfNeeded(userData: string, dbPath: string) {
  if (!fs.existsSync(dbPath)) return; // fresh install, nothing to back up

  let storedVersion = 0;
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = probe
        .prepare("SELECT value FROM schema_meta WHERE key='version'")
        .get() as { value: string } | undefined;
      storedVersion = row ? parseInt(row.value, 10) : 0;
    } catch {
      // schema_meta missing → very old install, treat as v0 → needs backup
      storedVersion = 0;
    } finally {
      probe.close();
    }
  } catch {
    // Probe failed entirely (corrupt/locked DB?). Skip rather than crash;
    // user can still use Settings → Backup → Backup Now manually after launch.
    return;
  }

  if (storedVersion >= SCHEMA_VERSION) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(userData, 'backups', 'pre-migration', `v${storedVersion}-to-v${SCHEMA_VERSION}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const sidecar of ['caredesk.sqlite', 'caredesk.sqlite-wal', 'caredesk.sqlite-shm']) {
    const src = path.join(userData, sidecar);
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, path.join(dir, sidecar)); } catch { /* best-effort */ }
    }
  }
  // Drop a small text file with the upgrade context so the user knows what
  // this folder is for if they stumble onto it later.
  try {
    fs.writeFileSync(
      path.join(dir, 'README.txt'),
      `CureDesk HMS — pre-migration snapshot.\n` +
      `\n` +
      `Taken automatically just before upgrading the database schema from\n` +
      `v${storedVersion} to v${SCHEMA_VERSION} on ${stamp}.\n` +
      `\n` +
      `If something is wrong with the upgraded database, you can roll back by\n` +
      `closing the app and copying caredesk.sqlite from this folder back into\n` +
      `the app's userData folder (the .sqlite file lives next to this folder's\n` +
      `parent — usually %APPDATA%\\CureDesk HMS\\).\n`
    );
  } catch { /* ignore */ }
}

export function getDb(): Database.Database {
  if (db) return db;
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'caredesk.sqlite');

  // Take a pre-migration snapshot BEFORE opening the DB for writing.
  preMigrationSnapshotIfNeeded(userData, dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedIfEmpty(db);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
