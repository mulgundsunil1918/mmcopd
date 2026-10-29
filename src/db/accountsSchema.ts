import type Database from 'better-sqlite3';
import { DEFAULT_CATEGORIES } from '../lib/accountsRules';

/**
 * Accounts tables (1.0.2): staff, expense heads, vouchers, the days a doctor/referrer payment settled, and attendance.
 *
 * Every table is created IF NOT EXISTS, so an update only ADDS them — an older database simply gains empty tables and nothing it already holds changes.
 * They live in the same database file, so every backup and restore carries them; the Excel export has a sheet for each (guard test: backup-sheets).
 */
export function ensureAccountsSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS acct_staff (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      job             TEXT,
      phone           TEXT,
      monthly_salary  REAL NOT NULL DEFAULT 0,
      keep_attendance INTEGER NOT NULL DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      joined_on       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS acct_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      is_active  INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS acct_vouchers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_no      TEXT NOT NULL UNIQUE,
      voucher_type    TEXT NOT NULL,
      voucher_date    TEXT NOT NULL,
      payee_kind      TEXT NOT NULL DEFAULT 'other',
      payee_ref       TEXT,
      payee_name      TEXT NOT NULL,
      category        TEXT,
      description     TEXT,
      gross_amount    REAL NOT NULL,
      deduction_amount REAL NOT NULL DEFAULT 0,
      deduction_kind  TEXT,
      deduction_label TEXT,
      net_amount      REAL NOT NULL,
      pay_mode        TEXT NOT NULL,
      pay_reference   TEXT,
      period_from     TEXT,
      period_to       TEXT,
      raised_by       TEXT,
      raised_role     TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      cancelled_at    TEXT,
      cancelled_by    TEXT,
      cancel_reason   TEXT,
      client_ref      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_acct_vouchers_date ON acct_vouchers(voucher_date);
    CREATE INDEX IF NOT EXISTS idx_acct_vouchers_payee ON acct_vouchers(payee_kind, payee_ref);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_voucher_ref ON acct_vouchers(client_ref) WHERE client_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS acct_voucher_days (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id   INTEGER NOT NULL REFERENCES acct_vouchers(id) ON DELETE CASCADE,
      payee_kind   TEXT NOT NULL,
      payee_ref    TEXT NOT NULL,
      day          TEXT NOT NULL,
      amount       REAL NOT NULL,
      earned_then  REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_acct_voucher_days_payee ON acct_voucher_days(payee_kind, payee_ref, day);

    CREATE TABLE IF NOT EXISTS acct_attendance (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES acct_staff(id) ON DELETE CASCADE,
      day      TEXT NOT NULL,
      status   TEXT NOT NULL,
      note     TEXT,
      UNIQUE (staff_id, day)
    );
  `);
  // The expense heads a new clinic starts with — only once, so a head the clinic deleted never comes back.
  const flag = db.prepare("SELECT 1 FROM settings WHERE key='acct_categories_seeded'").get();
  if (!flag) {
    const ins = db.prepare('INSERT OR IGNORE INTO acct_categories (name, sort_order) VALUES (?, ?)');
    DEFAULT_CATEGORIES.forEach((n, i) => ins.run(n, i));
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('acct_categories_seeded', '1')").run();
  }
}
