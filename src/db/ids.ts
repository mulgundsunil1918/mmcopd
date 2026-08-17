/**
 * Central ID allocation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every identifier used to be generated as `COUNT(*) + 1` over rows matching a
 * prefix. That is broken in a way that is easy to hit in production:
 *
 *   1. Create INV-20260803-0001, -0002, -0003
 *   2. Delete -0002 (the app does this via admin:deletePatient and
 *      admin:deleteAppointment, which purge a patient's bills)
 *   3. COUNT(*) is now 2, so the next bill generates -0003
 *   4. -0003 already exists -> UNIQUE constraint failed, billing crashes
 *
 * A counter never decrements, so a deleted record can never cause a reused
 * number. It is also a single atomic UPSERT, which keeps it correct if the same
 * database file is ever opened by more than one process (a second app instance,
 * or a database sitting on a shared drive).
 *
 * Numbers are deliberately NOT reused. A gap in an invoice series is normal and
 * expected; a duplicate is a compliance problem.
 */

import type Database from 'better-sqlite3';

export interface AllocatedId {
  value: number;
  scope: string;
}

/**
 * Indian financial year for a date: 1 April - 31 March.
 * 2026-08-03 -> "2026-27",  2027-02-11 -> "2026-27"
 */
export function financialYear(date: Date = new Date()): string {
  const y = date.getFullYear();
  // getMonth() is 0-based, so 3 === April.
  const startYear = date.getMonth() >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

/** YYYYMMDD in local time — used for per-day scopes such as UHID. */
export function dateKey(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

/**
 * Atomically reserve the next number in `scope` and return it.
 *
 * One statement, so there is no read-then-write window for anything to slip
 * into. Throws with the scope named if the database rejects it, rather than
 * returning a silent 0 that would collide downstream.
 */
export function allocate(db: Database.Database, scope: string): number {
  if (!scope || typeof scope !== 'string') {
    throw new Error(`ID allocation failed: scope must be a non-empty string, received ${JSON.stringify(scope)}`);
  }
  let row: { next_value: number } | undefined;
  try {
    row = db
      .prepare(
        `INSERT INTO counters (scope, next_value, updated_at)
         VALUES (?, 1, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET
           next_value = next_value + 1,
           updated_at = datetime('now')
         RETURNING next_value`
      )
      .get(scope) as { next_value: number } | undefined;
  } catch (err: any) {
    throw new Error(
      `ID allocation failed for scope "${scope}": ${err?.message || String(err)}. ` +
      `The counters table may be missing — check that migrations ran.`
    );
  }
  if (!row || typeof row.next_value !== 'number') {
    throw new Error(
      `ID allocation for scope "${scope}" returned no value. ` +
      `This usually means the counters table exists but RETURNING is unsupported by this SQLite build.`
    );
  }
  return row.next_value;
}

/** Peek at the next number without consuming it (for previews). */
export function peek(db: Database.Database, scope: string): number {
  const row = db.prepare('SELECT next_value FROM counters WHERE scope=?').get(scope) as
    | { next_value: number }
    | undefined;
  return (row?.next_value ?? 0) + 1;
}

// ===== Concrete identifiers =====

/**
 * Permanent patient identity, and the OP identifier.
 * PT-20260803-0042 — per-day series, format unchanged so existing UHIDs stay valid.
 */
export function nextUHID(db: Database.Database, when: Date = new Date()): string {
  const day = dateKey(when);
  const n = allocate(db, `uhid:${day}`);
  return `PT-${day}-${String(n).padStart(4, '0')}`;
}

/**
 * Invoice number on a financial-year series: INV/2026-27/0231.
 * GST expects a sequential series that restarts each financial year.
 * `prefix` is configurable per clinic (Settings -> GST & Invoicing).
 */
export function nextBillNumber(db: Database.Database, prefix = 'INV', when: Date = new Date()): string {
  const fy = financialYear(when);
  const n = allocate(db, `bill:${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}

/** Admission number, separate series from the patient's UHID: IP/2026-27/0007. */
export function nextIpNumber(db: Database.Database, prefix = 'IP', when: Date = new Date()): string {
  const fy = financialYear(when);
  const n = allocate(db, `ip:${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}

/**
 * That patient's nth OPD visit — 1, 2, 3...
 *
 * Scoped per patient so "V3" genuinely means their third visit. The old code
 * put the global appointment row id in the WhatsApp message, so "V42" meant the
 * clinic's 42nd appointment ever, which reads as a visit count but is not one.
 */
/**
 * Lab order number: LAB-YYYYMMDD-0001.
 *
 * Previously COUNT(*)+1 over the day's rows. Delete one order and the next one
 * reuses a number that already exists — and order_number is UNIQUE, so the
 * insert throws and NO further lab order can be raised for the rest of that day.
 * The counter never goes backwards, so a deletion cannot cause a collision.
 */
export function nextLabOrderNumber(db: Database.Database, when: Date = new Date()): string {
  const day = dateKey(when);
  return `LAB-${day}-${String(allocate(db, `lab:${day}`)).padStart(4, '0')}`;
}

/** Pharmacy sale number: PHX-YYYYMMDD-0001. Same collision story as lab orders. */
export function nextSaleNumber(db: Database.Database, when: Date = new Date()): string {
  const day = dateKey(when);
  return `PHX-${day}-${String(allocate(db, `sale:${day}`)).padStart(4, '0')}`;
}

export function nextVisitNumber(db: Database.Database, patientId: number): number {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error(`Visit number allocation failed: patientId must be a positive integer, received ${JSON.stringify(patientId)}`);
  }
  return allocate(db, `visit:${patientId}`);
}

/** Display form of a visit: PT-20260803-0042/V3 */
export function formatVisitId(uhid: string, visitNumber: number): string {
  if (!uhid) return '';
  return `${uhid}/V${visitNumber}`;
}
