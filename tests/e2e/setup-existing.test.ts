// A clinic that is ALREADY set up and is only being updated must never be put through the first-run setup guide —
// even one with no patients yet. Two ways in: it has a name (or a backup folder / its own logins) when the guide first looks,
// or its database is an older one being brought up to date (the migration notes it before anything else can look).
import './electron-stub';
import { userData } from './electron-stub';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ok, eq, section, finish } from './lib';

// An "old" database: the current schema stepped back to version 7, EMPTY apart from the clinic's name (no patients, no doctors).
{
  const d = new Database(path.join(userData, 'caredesk.sqlite'));
  d.pragma('journal_mode = WAL'); d.pragma('foreign_keys = ON');
  runMigrations(d);
  d.exec("DELETE FROM settings WHERE key='setup_wizard'");
  d.prepare("UPDATE schema_meta SET value='7' WHERE key='version'").run();
  d.close();
}

(async () => {
  const { boot, call, getDb } = await import('./harness');
  section('an empty clinic database from an older version, brought up to date');
  boot();
  const db = getDb();
  const note = db.prepare("SELECT value v FROM settings WHERE key='setup_wizard'").get() as any;
  ok(!!note && JSON.parse(note.v).origin === 'existing-clinic', 'the update itself notes "existing clinic" (before anything else can look)');
  const st = await call('setup:status');
  eq(st.show, false, 'the setup guide is NOT shown after an update');
  eq(st.existing_clinic, true, '…the clinic is recorded as already set up');

  section('a clinic that has only a name when the guide first looks');
  db.prepare("DELETE FROM settings WHERE key='setup_wizard'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('clinic_name','Already Set Up Clinic') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  eq((await call('setup:status')).show, false, 'a clinic with a name and nothing else is not shown the guide');
  db.prepare("DELETE FROM settings WHERE key='setup_wizard'").run();
  db.prepare("UPDATE settings SET value='' WHERE key='clinic_name'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('backup_folder','/tmp/some-folder') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  eq((await call('setup:status')).show, false, '…nor one that has chosen its backup folder');
  db.prepare("DELETE FROM settings WHERE key='setup_wizard'").run();
  db.prepare("UPDATE settings SET value='' WHERE key='backup_folder'").run();
  db.prepare("INSERT INTO users (username, password_hash, salt, role) VALUES ('rita','x','y','receptionist')").run();
  eq((await call('setup:status')).show, false, '…nor one that already has staff logins');
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
