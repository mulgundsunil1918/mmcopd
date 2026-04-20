import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations';
import { seedIfEmpty } from './seed';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'caredesk.sqlite');
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
