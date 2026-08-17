/**
 * IPD and billing IPC handlers.
 *
 * Deliberately a separate module rather than more lines in main/ipc.ts, which
 * is already ~3.7k lines covering every domain.
 *
 * Error policy (per project instruction): every failure returns a specific,
 * actionable message naming what was being attempted and why it failed. No
 * silent catch, no blank result — a clinic hitting a problem at the counter
 * should be able to read the message and know what to do.
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { getDb } from '../db/db';
import { requireRole, actor } from './ipc';
import { getAllSettings } from '../db/settings';
import { logAudit } from './auth';
import { broadcastEvent } from './network-server';
import { computeBill, money, discountCapForRole, type BillLineInput, transferDayRate } from './billing-engine';
import { nextIpNumber, nextBillNumber } from '../db/ids';
import { requireModule } from './licensing/enforce';

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

const fail = (error: string): Err => ({ ok: false, error });

/** Narrow a value to a positive integer id, or explain precisely what arrived. */
function requireId(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive whole number, received ${JSON.stringify(value)}.`);
  }
  return n;
}

function requireText(value: unknown, label: string, max = 500): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`${label} is required and cannot be blank.`);
  if (s.length > max) throw new Error(`${label} is too long (${s.length} characters, maximum ${max}).`);
  return s;
}

/** Today in local time as YYYY-MM-DD — the accrual key. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// =====================================================================
// Bill helpers
// =====================================================================

/**
 * The open bill for an admission, created on first use.
 *
 * An IPD stay accrues onto ONE bill until discharge, so charges from the ward,
 * pharmacy and lab all land in the same place and can be previewed at any time.
 */
function getOrCreateAdmissionBill(db: Database.Database, admissionId: number): number {
  const adm = db
    .prepare('SELECT id, patient_id, bill_id FROM ip_admissions WHERE id=?')
    .get(admissionId) as { id: number; patient_id: number; bill_id: number | null } | undefined;
  if (!adm) {
    throw new Error(`Admission #${admissionId} was not found. It may have been deleted.`);
  }
  if (adm.bill_id) {
    const exists = db.prepare('SELECT id FROM bills WHERE id=?').get(adm.bill_id);
    if (exists) return adm.bill_id;
    // Bill row vanished (older purge path); fall through and make a new one.
  }

  const s = getAllSettings(db);
  const billNumber = nextBillNumber(db, s.invoice_prefix || 'INV');
  const info = db
    .prepare(
      `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal,
                          discount, discount_type, total, payment_mode, status, bill_type, admission_id)
       VALUES (?, NULL, ?, '[]', 0, 0, 'flat', 0, 'Pending', 'open', 'ipd', ?)`
    )
    .run(billNumber, adm.patient_id, admissionId);
  const billId = Number(info.lastInsertRowid);
  db.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(billId, admissionId);
  return billId;
}

/**
 * Post the automatic per-day stay charges (bed + nursing) onto an admission's
 * running bill, one line per calendar day from the admission date up to today
 * (or the discharge date, whichever is earlier).
 *
 * Safe to call as often as you like: each line carries source='bed'/'nursing'
 * plus its accrual_date, and a partial UNIQUE index guarantees the same day can
 * never be posted twice — so opening the bill, restarting the app, or running
 * the scheduler all converge on the same result.
 *
 * Rates come from the admission's ward (per_day_rate / nursing_per_day). Once a
 * line exists staff can edit or delete it like any other; we never rewrite a day
 * that's already posted. Nothing is charged for a ward whose rate is 0.
 */
export function accrueStayCharges(db: Database.Database, admissionId: number, by?: string): { added: number; days: number } {
  const adm = db.prepare(
    `SELECT a.id, a.admitted_at, a.discharged_at, a.status, a.bill_id, a.ward_id, a.ward,
            w.per_day_rate, w.nursing_per_day, w.name AS ward_name
       FROM ip_admissions a LEFT JOIN wards w ON w.id = a.ward_id
      WHERE a.id=?`
  ).get(admissionId) as any;
  if (!adm) return { added: 0, days: 0 };

  /**
   * Honour the clinic's own switches.
   *
   * Settings → Billing & IPD offers "Charge the bed rate automatically each day"
   * and the same for nursing, but nothing ever read them: a clinic that turned
   * bed accrual off still got a bed line posted every night, and had to delete it
   * by hand each morning. A rate of zero here means "do not post this one".
   */
  const s0 = getAllSettings(db);
  const visitFeesOn = s0.ipd_auto_accrue_doctor_visit !== false;
  const visitMode = (s0.ipd_doctor_visit_mode as string) || 'per_consultant';
  const bedRate = s0.ipd_auto_accrue_bed === false ? 0 : Number(adm.per_day_rate || 0);
  const nurseRate = s0.ipd_auto_accrue_nursing === false ? 0 : Number(adm.nursing_per_day || 0);
  if (bedRate <= 0 && nurseRate <= 0 && !visitFeesOn) return { added: 0, days: 0 };   // nothing to post

  const billId = getOrCreateAdmissionBill(db, admissionId);
  /**
   * Count bed-days in the CLINIC'S calendar, not in UTC.
   *
   * This previously mixed the two: the start was local midnight parsed from a
   * UTC-sliced date, the end came from `toISOString()` (UTC), and every line was
   * labelled with a UTC date. In IST that meant a patient admitted at 01:00 was
   * stored as the previous UTC day, so by mid-morning the loop had already run
   * twice — an extra bed charge and an extra nursing charge on day one — and
   * every posted line was dated a day earlier than the day it was actually for.
   *
   * Now: convert the stored instant to the local day, then step whole local days.
   */
  const startInstant = parseDbTimestamp(adm.admitted_at);
  const endInstant = adm.discharged_at ? parseDbTimestamp(adm.discharged_at) : new Date();
  if (isNaN(startInstant.getTime()) || isNaN(endInstant.getTime())) return { added: 0, days: 0 };
  const startDay = new Date(startInstant.getFullYear(), startInstant.getMonth(), startInstant.getDate());
  const endDay = new Date(endInstant.getFullYear(), endInstant.getMonth(), endInstant.getDate());
  if (endDay < startDay) return { added: 0, days: 0 };

  // Days already posted, so we only fill the gaps.
  const existing = new Set(
    (db.prepare(
      // doctor_visit keys include the doctor id, so two consultants on the same
      // day are tracked separately rather than one blocking the other.
      `SELECT source || '|' || accrual_date ||
              CASE WHEN source='doctor_visit' THEN '|' || COALESCE(source_ref_id,0) ELSE '' END AS k
         FROM bill_items
        WHERE bill_id=? AND accrual_date IS NOT NULL AND source IN ('bed','nursing','doctor_visit')`
    ).all(billId) as { k: string }[]).map((r) => r.k)
  );

  const wardLabel = adm.ward_name || adm.ward || 'Ward';
  let added = 0, days = 0;
  // Step by calendar day (not +86,400,000 ms) so a DST shift cannot skip or
  // duplicate a day in clinics that observe one.
  for (let cur = new Date(startDay); cur <= endDay; cur.setDate(cur.getDate() + 1)) {
    const day = localDayString(cur);
    days++;
    // NOTE: source_ref_id must be a non-NULL sentinel (0). SQLite treats NULLs as
    // distinct inside a UNIQUE index, so leaving it NULL would silently disable
    // idx_bill_items_accrual_once and let the same day post twice.
    /**
     * Daily doctor visit fee.
     *
     * Settings offers "Charge doctor visit fees automatically each day" and a
     * mode (every doctor who wrote a note that day / only the admitting doctor),
     * but nothing implemented it — the switch and the dropdown did nothing at
     * all. Charged per doctor per day at that doctor's own fee, keyed by
     * source_ref_id = doctor id so two consultants on the same day are two
     * distinct lines and the unique accrual index still stops repeats.
     */
    if (visitFeesOn) {
      const visitors = visitMode === 'primary_only'
        ? (adm.admission_doctor_id ? [{ doctor_id: adm.admission_doctor_id }] : [])
        : (db.prepare(
            `SELECT DISTINCT doctor_id FROM ip_progress_notes
              WHERE admission_id=? AND doctor_id IS NOT NULL AND date(noted_at)=?`
          ).all(admissionId, day) as { doctor_id: number }[]);
      for (const v of visitors) {
        if (!v.doctor_id) continue;
        const doc = db.prepare('SELECT name, default_fee FROM doctors WHERE id=?').get(v.doctor_id) as any;
        const fee = Number(doc?.default_fee) || 0;
        if (fee <= 0) continue;
        if (existing.has(`doctor_visit|${day}|${v.doctor_id}`)) continue;
        try {
          addLine(db, billId, {
            description: `Doctor visit — ${doc?.name || 'Consultant'} (${day})`,
            qty: 1, rate: fee, amount: fee,
            source: 'doctor_visit', source_ref_id: v.doctor_id, accrual_date: day,
            is_taxable: false, gst_rate: 0,
          }, by);
          added++;
        } catch { /* unique index already has this doctor-day */ }
      }
    }

    if (bedRate > 0 && !existing.has(`bed|${day}`)) {
      try {
        addLine(db, billId, { description: `Bed charge — ${wardLabel} (${day})`, qty: 1, rate: bedRate, source: 'bed', source_ref_id: 0, accrual_date: day }, by || 'auto');
        added++;
      } catch { /* unique index caught a race — fine */ }
    }
    if (nurseRate > 0 && !existing.has(`nursing|${day}`)) {
      try {
        addLine(db, billId, { description: `Nursing charge — ${wardLabel} (${day})`, qty: 1, rate: nurseRate, source: 'nursing', source_ref_id: 0, accrual_date: day }, by || 'auto');
        added++;
      } catch { /* ignore */ }
    }
  }
  if (added) recalcBill(db, billId);
  return { added, days };
}

/**
 * Read a timestamp written by either SQLite or JavaScript, as UTC.
 *
 * SQLite's `datetime('now')` yields "2026-08-15 19:30:00" with no zone marker —
 * and JavaScript parses that as LOCAL time, which is wrong: SQLite wrote UTC.
 * Code elsewhere stores `new Date().toISOString()`, which is explicit UTC. Both
 * shapes reach these tables, so normalise before doing any date arithmetic.
 */
function parseDbTimestamp(v: string): Date {
  const raw = String(v || '').trim();
  if (!raw) return new Date(NaN);
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw);           // already zoned
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + 'T00:00:00Z'); // bare date
  return new Date(raw.replace(' ', 'T') + 'Z');                             // SQLite UTC
}

/** The clinic's own calendar day for an instant — "what date is it here". */
function localDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Post the day's bed / nursing / doctor-visit charges for every admitted patient.
 *
 * Settings has always offered a "time the daily charges post" (default 00:05),
 * but nothing ever ran on a schedule: charges only appeared when a human opened
 * that patient's bill. So a ward with no visitors that morning had no charges
 * posted, and the Billing list showed yesterday's total. The accrual is
 * idempotent — the unique accrual index makes a repeat a no-op — so running it
 * on a timer is safe, and a missed day is simply filled in on the next run.
 */
export function runDailyAccrual(): { admissions: number; added: number } {
  const d = getDb();
  let admissions = 0, added = 0;
  try {
    for (const r of d.prepare("SELECT id FROM ip_admissions WHERE status='admitted'").all() as { id: number }[]) {
      admissions++;
      try { added += accrueStayCharges(d, r.id, 'auto').added; }
      catch { /* one bad admission must not stop the rest */ }
    }
  } catch { /* IPD not in use on this install */ }
  return { admissions, added };
}

/** Money picture for an admission: bill total vs advances + payments = balance. */
function dischargeFinancials(db: Database.Database, admissionId: number) {
  const billId = getOrCreateAdmissionBill(db, admissionId);
  const totals = recalcBill(db, billId);
  const adv = db.prepare(
    'SELECT COALESCE(SUM(amount - refunded_amount), 0) AS a FROM advances WHERE admission_id=?'
  ).get(admissionId) as { a: number };
  const paid = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS p FROM bill_payments WHERE bill_id=?'
  ).get(billId) as { p: number };
  const total = money(totals.total);
  const advance = money(adv.a);
  const amountPaid = money(paid.p);
  return { billId, total, advanceAvailable: advance, amountPaid, balanceDue: money(total - advance - amountPaid) };
}

/** Recompute and persist a bill's totals from its current lines. */
function recalcBill(db: Database.Database, billId: number) {
  const bill = db
    .prepare('SELECT id, discount, discount_type, status FROM bills WHERE id=?')
    .get(billId) as { id: number; discount: number; discount_type: 'flat' | 'percent'; status: string } | undefined;
  if (!bill) throw new Error(`Cannot recalculate: bill #${billId} was not found.`);

  const rows = db
    .prepare('SELECT id, description, qty, rate, amount, gst_rate, is_taxable FROM bill_items WHERE bill_id=? ORDER BY id')
    .all(billId) as any[];

  /**
   * A bill with no line ROWS is not a bill worth zero.
   *
   * Services (`misc:create`) and Quick Bill (`bills:create`) store their lines in
   * `bills.items_json` and never insert `bill_items`. Recalculating from an empty
   * `bill_items` produced 0/0 — and the UPDATE below then WROTE that back, so
   * merely opening or printing such a bill destroyed its amount: the patient got
   * a ₹0.00 invoice and the row under-reported revenue for ever after.
   *
   * When there are no lines to add up, there is nothing to recalculate. Return
   * what is stored instead of overwriting it with zero. (`items_json` bills are
   * converted to real rows by migrateBillItemsFromJson at startup; until then
   * their stored totals are the truth.)
   */
  if (rows.length === 0) {
    const stored = db
      .prepare('SELECT subtotal, total, taxable_total, exempt_total, cgst_total, sgst_total, round_off, is_tax_invoice FROM bills WHERE id=?')
      .get(billId) as any;
    return {
      lines: [],
      subtotal: Number(stored?.subtotal) || 0,
      total: Number(stored?.total) || 0,
      taxableTotal: Number(stored?.taxable_total) || 0,
      exemptTotal: Number(stored?.exempt_total) || 0,
      cgstTotal: Number(stored?.cgst_total) || 0,
      sgstTotal: Number(stored?.sgst_total) || 0,
      roundOff: Number(stored?.round_off) || 0,
      isTaxInvoice: !!stored?.is_tax_invoice,
      discountValue: Number(bill.discount) || 0,
      grossTotal: Number(stored?.total) || 0,
    };
  }

  const s = getAllSettings(db);
  const totals = computeBill(
    rows.map((r) => ({
      description: r.description,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      gst_rate: r.gst_rate,
      is_taxable: !!r.is_taxable,
    })),
    {
      discount: bill.discount,
      discount_type: bill.discount_type,
      // A composition dealer pays GST from its own margin and may NOT collect it
      // from the patient or issue a tax invoice — so tax is forced off for them
      // regardless of the per-line rates.
      gstEnabled: s.gst_enabled && s.gst_registration_type !== 'composition',
      roundOff: s.bill_round_off,
    }
  );

  // Persist the per-line tax split so the printed invoice matches to the paisa.
  const updLine = db.prepare('UPDATE bill_items SET cgst=?, sgst=? WHERE id=?');
  totals.lines.forEach((l, i) => updLine.run(l.cgst, l.sgst, rows[i].id));

  db.prepare(
    `UPDATE bills SET subtotal=?, total=?, taxable_total=?, exempt_total=?,
       cgst_total=?, sgst_total=?, round_off=?, is_tax_invoice=? WHERE id=?`
  ).run(
    totals.subtotal, totals.total, totals.taxableTotal, totals.exemptTotal,
    totals.cgstTotal, totals.sgstTotal, totals.roundOff, totals.isTaxInvoice ? 1 : 0, billId
  );

  return totals;
}

function addLine(db: Database.Database, billId: number, line: BillLineInput, by?: string): number {
  const amount = money(line.amount !== undefined ? line.amount : (line.qty || 1) * (line.rate || 0));
  try {
    const info = db
      .prepare(
        `INSERT INTO bill_items (bill_id, charge_head_id, description, qty, rate, amount,
                                 hsn_sac, gst_rate, is_taxable, source, source_ref_id, accrual_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        billId, line.charge_head_id ?? null, line.description,
        line.qty ?? 1, line.rate ?? 0, amount,
        line.hsn_sac ?? null, line.gst_rate ?? 0, line.is_taxable ? 1 : 0,
        line.source ?? 'manual', line.source_ref_id ?? null, line.accrual_date ?? null, by ?? null
      );
    return Number(info.lastInsertRowid);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('idx_bill_items_accrual_once')) {
      // The partial unique index caught a repeat post — expected, not an error.
      throw new Error(
        `"${line.description}" has already been charged for ${line.accrual_date}. ` +
        `Automatic charges post once per day; edit the existing line instead of adding another.`
      );
    }
    throw new Error(`Could not add "${line.description}" to bill #${billId}: ${msg}`);
  }
}

// =====================================================================

export function registerIpdBillingIpc() {
  const db = () => getDb();

  // ---------- Wards ----------
  ipcMain.handle('wards:list', (_e, includeInactive = false) => {
    const where = includeInactive ? '' : 'WHERE w.is_active=1';
    return db()
      .prepare(
        `SELECT w.*,
                (SELECT COUNT(*) FROM beds b WHERE b.ward_id=w.id AND b.is_active=1) AS bed_count,
                (SELECT COUNT(*) FROM beds b WHERE b.ward_id=w.id AND b.is_active=1 AND b.status='occupied') AS occupied_count
         FROM wards w ${where} ORDER BY w.sort_order, w.name`
      )
      .all();
  });

  ipcMain.handle('wards:save', (_e, input: any) => {
    try {
      const name = requireText(input?.name, 'Ward name', 60);
      const rate = Number(input?.per_day_rate ?? 0);
      if (!Number.isFinite(rate) || rate < 0) {
        return fail(`Bed charge per day must be zero or more, received ${JSON.stringify(input?.per_day_rate)}.`);
      }
      const d = db();
      if (input?.id) {
        const id = requireId(input.id, 'Ward id');
        d.prepare(
          `UPDATE wards SET name=?, ward_type=?, per_day_rate=?, nursing_per_day=?, colour=?, sort_order=?, is_active=? WHERE id=?`
        ).run(name, input.ward_type ?? 'general', rate, Number(input.nursing_per_day ?? 0),
              input.colour ?? null, Number(input.sort_order ?? 0), input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO wards (name, ward_type, per_day_rate, nursing_per_day, colour, sort_order) VALUES (?,?,?,?,?,?)`
      ).run(name, input.ward_type ?? 'general', rate, Number(input.nursing_per_day ?? 0),
            input.colour ?? null, Number(input.sort_order ?? 0));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE') && msg.includes('wards.name')) {
        return fail(`A ward named "${input?.name}" already exists. Ward names must be unique.`);
      }
      return fail(`Could not save ward: ${msg}`);
    }
  });

  ipcMain.handle('wards:delete', (_e, wardId: number) => {
    try {
      const id = requireId(wardId, 'Ward id');
      const live = (db().prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions a JOIN beds b ON b.id=a.bed_id
         WHERE b.ward_id=? AND a.status='admitted'`
      ).get(id) as { c: number }).c;
      if (live > 0) {
        return fail(`Cannot delete this ward: ${live} patient(s) are still admitted in it. Discharge or transfer them first.`);
      }
      db().prepare('UPDATE wards SET is_active=0 WHERE id=?').run(id);
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not delete ward: ${err?.message || String(err)}`);
    }
  });

  // ---------- Beds ----------
  /** Colour-coded ward map: every bed with its current occupant, if any. */
  ipcMain.handle('beds:map', () => {
    return db()
      .prepare(
        `SELECT b.id, b.ward_id, b.bed_number, b.status, b.notes,
                w.name AS ward_name, w.ward_type, w.colour AS ward_colour, w.per_day_rate,
                a.id AS admission_id, a.admission_number, a.admitted_at,
                (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid,
                d.name AS doctor_name
         FROM beds b
         JOIN wards w ON w.id = b.ward_id
         LEFT JOIN ip_admissions a ON a.bed_id = b.id AND a.status='admitted'
         LEFT JOIN patients p ON p.id = a.patient_id
         LEFT JOIN doctors d ON d.id = a.admission_doctor_id
         WHERE b.is_active=1 AND w.is_active=1
         ORDER BY w.sort_order, w.name, b.bed_number`
      )
      .all();
  });

  ipcMain.handle('beds:save', (_e, input: any) => {
    try {
      const wardId = requireId(input?.ward_id, 'Ward');
      const bedNumber = requireText(input?.bed_number, 'Bed number', 20);
      const d = db();
      if (!d.prepare('SELECT id FROM wards WHERE id=?').get(wardId)) {
        return fail(`Ward #${wardId} was not found. Create the ward before adding beds to it.`);
      }
      if (input?.id) {
        const id = requireId(input.id, 'Bed id');
        d.prepare('UPDATE beds SET ward_id=?, bed_number=?, notes=?, is_active=? WHERE id=?')
          .run(wardId, bedNumber, input.notes ?? null, input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare('INSERT INTO beds (ward_id, bed_number, notes) VALUES (?,?,?)')
        .run(wardId, bedNumber, input.notes ?? null);
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE')) {
        return fail(`Bed "${input?.bed_number}" already exists in this ward. Bed numbers must be unique within a ward.`);
      }
      return fail(`Could not save bed: ${msg}`);
    }
  });

  /** free / occupied / reserved / cleaning / blocked — drives the map colours. */
  ipcMain.handle('beds:setStatus', (_e, bedId: number, status: string) => {
    const allowed = ['free', 'occupied', 'reserved', 'cleaning', 'blocked'];
    try {
      const id = requireId(bedId, 'Bed id');
      if (!allowed.includes(status)) {
        return fail(`"${status}" is not a valid bed status. Use one of: ${allowed.join(', ')}.`);
      }
      const d = db();
      const occupied = d.prepare(`SELECT id FROM ip_admissions WHERE bed_id=? AND status='admitted'`).get(id);
      if (occupied && status !== 'occupied') {
        return fail(`This bed has a patient in it and cannot be marked "${status}". Discharge or transfer the patient first.`);
      }
      d.prepare('UPDATE beds SET status=? WHERE id=?').run(status, id);
      broadcastEvent('ip:bedStatus', { bedId: id, status });
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not change bed status: ${err?.message || String(err)}`);
    }
  });

  /** Every bed in one ward, with its live occupant (if any) — for the ward's bed list. */
  ipcMain.handle('beds:list', (_e, wardId: number) => {
    const id = requireId(wardId, 'Ward');
    return db()
      .prepare(
        `SELECT b.id, b.ward_id, b.bed_number, b.status, b.notes, b.is_active,
                a.id AS admission_id, a.admission_number,
                (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid
         FROM beds b
         LEFT JOIN ip_admissions a ON a.bed_id = b.id AND a.status='admitted'
         LEFT JOIN patients p ON p.id = a.patient_id
         WHERE b.ward_id=?
         ORDER BY b.is_active DESC, b.bed_number`
      )
      .all(id);
  });

  /**
   * Remove a bed. Refuses if a patient currently occupies it. A bed that was ever
   * used (has admission history) is soft-removed to preserve that history; a bed
   * that has never been used is deleted outright, so typos vanish cleanly.
   */
  ipcMain.handle('beds:remove', (_e, bedId: number) => {
    try {
      const id = requireId(bedId, 'Bed id');
      const d = db();
      const bed: any = d.prepare('SELECT id, bed_number FROM beds WHERE id=?').get(id);
      if (!bed) return fail('That bed no longer exists.');
      const occupied = d.prepare(`SELECT id FROM ip_admissions WHERE bed_id=? AND status='admitted'`).get(id);
      if (occupied) return fail(`Bed "${bed.bed_number}" has a patient in it. Discharge or transfer the patient before removing the bed.`);
      const everUsed = d.prepare('SELECT 1 FROM ip_admissions WHERE bed_id=? LIMIT 1').get(id);
      if (everUsed) {
        d.prepare('UPDATE beds SET is_active=0, status=\'blocked\' WHERE id=?').run(id);
      } else {
        d.prepare('DELETE FROM beds WHERE id=?').run(id);
      }
      broadcastEvent('ip:bedStatus', { bedId: id, status: 'removed' });
      return { ok: true, soft: !!everUsed };
    } catch (err: any) {
      return fail(`Could not remove the bed: ${err?.message || String(err)}`);
    }
  });

  // ---------- Charge heads ----------
  ipcMain.handle('chargeHeads:list', (_e, appliesTo?: 'opd' | 'ipd') => {
    const where = appliesTo ? `WHERE is_active=1 AND applies_to IN (?, 'both')` : 'WHERE is_active=1';
    const params = appliesTo ? [appliesTo] : [];
    return db().prepare(`SELECT * FROM charge_heads ${where} ORDER BY sort_order, name`).all(...params);
  });

  ipcMain.handle('chargeHeads:save', (_e, input: any) => {
    try {
      const name = requireText(input?.name, 'Charge name', 80);
      const rate = Number(input?.default_rate ?? 0);
      if (!Number.isFinite(rate) || rate < 0) {
        return fail(`Default rate must be zero or more, received ${JSON.stringify(input?.default_rate)}.`);
      }
      const gst = Number(input?.gst_rate ?? 0);
      if (!Number.isFinite(gst) || gst < 0 || gst > 28) {
        return fail(`GST rate must be between 0 and 28 percent, received ${JSON.stringify(input?.gst_rate)}.`);
      }
      const d = db();
      if (input?.id) {
        const id = requireId(input.id, 'Charge head id');
        d.prepare(
          `UPDATE charge_heads SET name=?, category=?, colour=?, default_rate=?, hsn_sac=?,
             gst_rate=?, is_taxable=?, applies_to=?, sort_order=?, is_active=? WHERE id=?`
        ).run(name, input.category ?? 'other', input.colour ?? null, rate, input.hsn_sac ?? null,
              gst, input.is_taxable ? 1 : 0, input.applies_to ?? 'both',
              Number(input.sort_order ?? 0), input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO charge_heads (name, category, colour, default_rate, hsn_sac, gst_rate, is_taxable, applies_to, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(name, input.category ?? 'other', input.colour ?? null, rate, input.hsn_sac ?? null,
            gst, input.is_taxable ? 1 : 0, input.applies_to ?? 'both', Number(input.sort_order ?? 0));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE')) {
        return fail(`A charge named "${input?.name}" already exists in category "${input?.category ?? 'other'}".`);
      }
      return fail(`Could not save charge head: ${msg}`);
    }
  });

  // ---------- Admission ----------
  ipcMain.handle('ip:admitV2', (_e, input: any) => {
    requireModule('ipd', 'In-Patient (IPD)');
    const d = db();
    try {
      const patientId = requireId(input?.patient_id, 'Patient');
      const bedId = requireId(input?.bed_id, 'Bed');

      if (!d.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) {
        return fail(`Patient #${patientId} was not found. They may have been deleted.`);
      }
      const bed = d.prepare(
        'SELECT b.id, b.status, b.bed_number, w.id AS ward_id, w.name AS ward_name FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?'
      ).get(bedId) as any;
      if (!bed) return fail(`Bed #${bedId} was not found.`);
      if (bed.status === 'blocked' || bed.status === 'cleaning') {
        return fail(`Bed ${bed.ward_name} / ${bed.bed_number} is marked "${bed.status}" and cannot take a patient yet.`);
      }

      const openAdm = d.prepare(`SELECT admission_number FROM ip_admissions WHERE patient_id=? AND status='admitted'`).get(patientId) as any;
      if (openAdm) {
        return fail(`This patient is already admitted under ${openAdm.admission_number}. Discharge that admission before admitting again.`);
      }

      const s = getAllSettings(d);
      let admissionId = 0;
      let admissionNumber = '';

      const tx = d.transaction(() => {
        admissionNumber = nextIpNumber(d, s.ip_number_prefix || 'IP');
        const info = d.prepare(
          `INSERT INTO ip_admissions
             (admission_number, patient_id, admission_doctor_id, bed_id, ward_id, ward, bed_number,
              admission_type, provisional_diagnosis, attendant_name, attendant_phone, attendant_relation,
              is_mlc, admission_notes, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'admitted')`
        ).run(
          admissionNumber, patientId, input.admission_doctor_id ?? null, bedId, bed.ward_id,
          bed.ward_name, bed.bed_number, input.admission_type ?? 'planned',
          input.provisional_diagnosis ?? null, input.attendant_name ?? null,
          input.attendant_phone ?? null, input.attendant_relation ?? null,
          input.is_mlc ? 1 : 0, input.admission_notes ?? null
        );
        admissionId = Number(info.lastInsertRowid);
        d.prepare(`UPDATE beds SET status='occupied' WHERE id=?`).run(bedId);

        if (input.is_mlc) {
          d.prepare(
            `INSERT INTO mlc_register (admission_id, patient_id, police_station, brought_by, brought_by_phone,
                                       incident_type, incident_at, incident_place, injury_description)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).run(admissionId, patientId, input.mlc?.police_station ?? null, input.mlc?.brought_by ?? null,
                input.mlc?.brought_by_phone ?? null, input.mlc?.incident_type ?? null,
                input.mlc?.incident_at ?? null, input.mlc?.incident_place ?? null,
                input.mlc?.injury_description ?? null);
        }

        const advance = Number(input.advance_amount ?? 0);
        if (advance > 0) {
          if (!s.ipd_advance_enabled) {
            throw new Error('Advance collection is switched off in Settings → IPD, but an advance amount was supplied.');
          }
          d.prepare(
            `INSERT INTO advances (patient_id, admission_id, amount, payment_mode, received_by, notes)
             VALUES (?,?,?,?,?,?)`
          ).run(patientId, admissionId, advance, input.advance_mode ?? 'Cash',
                input.performed_by ?? null, 'Collected at admission');
        }

        getOrCreateAdmissionBill(d, admissionId);

        // The patient is now admitted, so ANY pending admission request for them is
        // fulfilled — whether reception approved a request or admitted directly. This
        // stops a stale request lingering (and re-asking for a bed) after a manual admit.
        d.prepare(
          `UPDATE admission_requests SET status='approved', decided_at=datetime('now'),
                  decided_by=COALESCE(?, decided_by), admission_id=?
           WHERE patient_id=? AND status='pending'`
        ).run(input.performed_by ?? null, admissionId, patientId);
      });

      tx();
      logAudit(d, actor(), 'ip_admitted', 'ip_admissions', admissionId,
        `${admissionNumber} → ${bed.ward_name}/${bed.bed_number}`);
      broadcastEvent('ip:admitted', { admissionId, bedId });
      return { ok: true, id: admissionId, admission_number: admissionNumber };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('idx_bed_single_active_admission')) {
        return fail(`That bed was taken by another station a moment ago. Refresh the ward map and pick a free bed.`);
      }
      return fail(`Admission failed: ${msg}`);
    }
  });

  // ---------- Transfer ----------
  ipcMain.handle('ip:transfer', (_e, admissionId: number, toBedId: number, reason?: string, by?: string) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const bid = requireId(toBedId, 'Destination bed');
      const adm = d.prepare('SELECT id, bed_id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') {
        return fail(`${adm.admission_number} is no longer admitted (status "${adm.status}"), so the patient cannot be transferred.`);
      }
      if (adm.bed_id === bid) return fail('The patient is already in that bed.');

      const bed = d.prepare(
        'SELECT b.id, b.status, b.bed_number, w.id AS ward_id, w.name AS ward_name FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?'
      ).get(bid) as any;
      if (!bed) return fail(`Destination bed #${bid} was not found.`);
      if (bed.status !== 'free' && bed.status !== 'reserved') {
        return fail(`Bed ${bed.ward_name} / ${bed.bed_number} is "${bed.status}" and is not available.`);
      }

      const tx = d.transaction(() => {
        d.prepare(
          `INSERT INTO bed_transfers (admission_id, from_bed_id, to_bed_id, reason, transferred_by) VALUES (?,?,?,?,?)`
        ).run(aid, adm.bed_id, bid, reason ?? null, by ?? null);
        if (adm.bed_id) d.prepare(`UPDATE beds SET status='cleaning' WHERE id=?`).run(adm.bed_id);
        d.prepare(`UPDATE beds SET status='occupied' WHERE id=?`).run(bid);
        /**
         * Post every day up to now at the OLD ward's rate before the move.
         *
         * accrueStayCharges prices back-filled days from the admission's CURRENT
         * ward. Without this, moving a patient from a ₹500 general bed to a
         * ₹2,000 ICU bed silently re-priced their earlier unposted days at ICU
         * rates — the family is billed ICU for nights spent in the general ward.
         */
        try { accrueStayCharges(d, aid); } catch { /* never block the transfer */ }

        /**
         * Re-price TODAY's bed line using the clinic's transfer rule.
         *
         * Settings asks "if a patient moves ward mid-day, charge…" (higher /
         * pro-rata / both) and transferDayRate() implements all three — but
         * nothing ever called it, so the answer was ignored and the day was
         * simply billed at whichever ward the accrual happened to see.
         */
        try {
          const sT = getAllSettings(d);
          const oldRate = Number(adm.per_day_rate || 0);
          const newRate = Number(bed.per_day_rate ?? 0);
          if (oldRate > 0 || newRate > 0) {
            const today = new Date();
            const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const line = d.prepare(
              `SELECT bi.id FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
                WHERE b.admission_id=? AND bi.source='bed' AND bi.accrual_date=?`
            ).get(aid, dayKey) as { id: number } | undefined;
            if (line) {
              const rate = transferDayRate([oldRate, newRate], (sT.ipd_transfer_charge_rule as any) || 'higher');
              d.prepare('UPDATE bill_items SET rate=?, amount=? WHERE id=?').run(rate, rate, line.id);
            }
          }
        } catch { /* pricing nicety — never block the move itself */ }
        d.prepare('UPDATE ip_admissions SET bed_id=?, ward_id=?, ward=?, bed_number=? WHERE id=?')
          .run(bid, bed.ward_id, bed.ward_name, bed.bed_number, aid);
      });
      tx();

      logAudit(d, actor(), 'ip_transferred', 'ip_admissions', aid, `→ ${bed.ward_name}/${bed.bed_number}`);
      broadcastEvent('ip:transferred', { admissionId: aid, toBedId: bid });
      return { ok: true };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('idx_bed_single_active_admission')) {
        return fail('That bed was taken by another station a moment ago. Refresh the ward map and pick another.');
      }
      return fail(`Transfer failed: ${msg}`);
    }
  });

  // ---------- Discharge ----------
  const OUTCOMES = ['discharged', 'lama', 'dama', 'death', 'referred', 'absconded'];

  ipcMain.handle('ip:dischargeV2', (_e, admissionId: number, input: any) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const outcome = String(input?.outcome ?? '');
      if (!OUTCOMES.includes(outcome)) {
        return fail(`"${outcome}" is not a valid outcome. Use one of: ${OUTCOMES.join(', ')}.`);
      }
      const adm = d.prepare('SELECT id, bed_id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') {
        return fail(`${adm.admission_number} is already closed (status "${adm.status}").`);
      }
      if (outcome === 'death' && !input?.death_at) {
        return fail('Date and time of death are required when recording a death.');
      }
      if ((outcome === 'lama' || outcome === 'dama') && !input?.outcome_notes) {
        return fail('A reason is required for LAMA and DAMA, since the patient is leaving against medical advice.');
      }
      if (outcome === 'referred' && !input?.referred_to) {
        return fail('Please record which hospital or facility the patient is being referred to.');
      }

      const now = new Date().toISOString();
      const tx = d.transaction(() => {
        d.prepare(
          `UPDATE ip_admissions SET status='discharged', outcome=?, outcome_notes=?, discharged_at=?,
             death_at=?, death_cause=?, referred_to=?, risk_explained_by=?,
             discharge_diagnosis=?, condition_at_discharge=?, treatment_given=?,
             investigation_findings=?, operative_notes=?, discharge_medications_json=?,
             followup_plan=?, discharge_doctor_id=?, discharge_summary=?
           WHERE id=?`
        ).run(
          outcome, input.outcome_notes ?? null, now,
          input.death_at ?? null, input.death_cause ?? null, input.referred_to ?? null,
          input.risk_explained_by ?? null, input.discharge_diagnosis ?? null,
          input.condition_at_discharge ?? null, input.treatment_given ?? null,
          input.investigation_findings ?? null, input.operative_notes ?? null,
          input.discharge_medications_json ?? null, input.followup_plan ?? null,
          input.discharge_doctor_id ?? null, input.discharge_summary ?? null, aid
        );
        // Free the bed in the same transaction, so an outcome can never leave a
        // bed marked occupied with nobody in it.
        if (adm.bed_id) d.prepare(`UPDATE beds SET status='cleaning' WHERE id=?`).run(adm.bed_id);
      });
      tx();

      logAudit(d, actor(), 'ip_discharged', 'ip_admissions', aid, `${adm.admission_number} · ${outcome}`);
      broadcastEvent('ip:discharged', { admissionId: aid, outcome });
      return { ok: true, outcome };
    } catch (err: any) {
      return fail(`Discharge failed: ${err?.message || String(err)}`);
    }
  });

  /**
   * All admission bills for the Billing section's IPD tab — current admissions
   * (running bills) and discharged ones, with the money picture per row so
   * reception can spot unpaid balances at a glance.
   */
  ipcMain.handle('bill:admissionList', (_e, filter: { status?: 'admitted' | 'discharged' | 'all'; q?: string } = {}) => {
    const d = db();
    try {
      /**
       * Bring every running bill up to date first.
       *
       * The list reads bills.total, but bed and nursing charges are only posted
       * when someone opens that patient's bill. So the Billing list showed a
       * total from whenever the bill was last viewed, disagreeing with the
       * workspace the moment you clicked in — and the day's accrual was invisible
       * until somebody happened to look. accrueStayCharges is idempotent (the
       * unique accrual index makes a repeat a no-op), so this is safe to run here.
       */
      try {
        for (const r of d.prepare("SELECT id FROM ip_admissions WHERE status='admitted'").all() as { id: number }[]) {
          try { accrueStayCharges(d, r.id); } catch { /* never let one admission break the list */ }
        }
      } catch { /* ignore — listing must work even if accrual cannot */ }
      const want = filter.status || 'all';
      const conds: string[] = [];
      const params: any[] = [];
      if (want === 'admitted') conds.push("a.status='admitted'");
      if (want === 'discharged') conds.push("a.status='discharged'");
      if (filter.q) {
        conds.push(`((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR a.admission_number LIKE ?)`);
        const like = `%${filter.q}%`;
        params.push(like, like, like);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = d.prepare(
        `SELECT a.id AS admission_id, a.admission_number, a.status, a.ward, a.bed_number,
                a.admitted_at, a.discharged_at, a.discharge_status, a.bill_id,
                (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid,
                COALESCE(b.total, 0) AS total,
                COALESCE((SELECT SUM(amount) FROM bill_payments WHERE bill_id = a.bill_id), 0) AS paid,
                COALESCE((SELECT SUM(amount - refunded_amount) FROM advances WHERE admission_id = a.id), 0) AS advance,
                dr.name AS doctor_name
           FROM ip_admissions a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN bills b ON b.id = a.bill_id
           LEFT JOIN doctors dr ON dr.id = a.admission_doctor_id
           ${where}
          ORDER BY (a.status='admitted') DESC, COALESCE(a.discharged_at, a.admitted_at) DESC
          LIMIT 500`
      ).all(...params) as any[];
      return rows.map((r) => {
        const balance = money(Number(r.total) - Number(r.paid) - Number(r.advance));
        const days = Math.max(1, Math.ceil(
          ((r.discharged_at ? new Date(r.discharged_at).getTime() : Date.now()) - new Date(r.admitted_at).getTime()) / 86_400_000
        ));
        return { ...r, total: money(r.total), paid: money(r.paid), advance: money(r.advance), balance, days };
      });
    } catch {
      return [];
    }
  });

  // ---------- Discharge workflow: request → final bill → approve ----------
  /**
   * Step 1 — the doctor completes the discharge summary and REQUESTS discharge.
   * This saves every clinical field but does NOT discharge the patient or free
   * the bed: the patient stays admitted until someone approves. Billing can now
   * review the final bill knowing no more charges are coming.
   */
  ipcMain.handle('ip:requestDischarge', (_e, admissionId: number, input: any, by?: string) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const outcome = String(input?.outcome ?? '');
      if (!OUTCOMES.includes(outcome)) {
        return fail(`"${outcome}" is not a valid outcome. Use one of: ${OUTCOMES.join(', ')}.`);
      }
      const adm = d.prepare('SELECT id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') return fail(`${adm.admission_number} is already closed.`);
      if (outcome === 'death' && !input?.death_at) return fail('Date and time of death are required when recording a death.');
      if ((outcome === 'lama' || outcome === 'dama') && !input?.outcome_notes) return fail('A reason is required for LAMA and DAMA.');
      if (outcome === 'referred' && !input?.referred_to) return fail('Please record which hospital the patient is referred to.');

      const now = new Date().toISOString();
      d.prepare(
        `UPDATE ip_admissions SET outcome=?, outcome_notes=?,
           death_at=?, death_cause=?, referred_to=?, risk_explained_by=?,
           discharge_diagnosis=?, condition_at_discharge=?, treatment_given=?,
           investigation_findings=?, operative_notes=?, discharge_medications_json=?,
           followup_plan=?, discharge_doctor_id=?, discharge_summary=?,
           discharge_status='requested', discharge_requested_at=?, discharge_requested_by=?
         WHERE id=?`
      ).run(
        outcome, input.outcome_notes ?? null,
        input.death_at ?? null, input.death_cause ?? null, input.referred_to ?? null,
        input.risk_explained_by ?? null, input.discharge_diagnosis ?? null,
        input.condition_at_discharge ?? null, input.treatment_given ?? null,
        input.investigation_findings ?? null, input.operative_notes ?? null,
        input.discharge_medications_json ?? null, input.followup_plan ?? null,
        input.discharge_doctor_id ?? null, input.discharge_summary ?? null,
        now, by ?? null, aid
      );
      // Final accrual so the bill under review covers the whole stay.
      try { accrueStayCharges(d, aid, by); } catch { /* ignore */ }
      logAudit(d, actor(), 'ip_discharge_requested', 'ip_admissions', aid, `${adm.admission_number} · ${outcome}`);
      broadcastEvent('ip:dischargeRequested', { admissionId: aid });
      return { ok: true as const, ...dischargeFinancials(d, aid) };
    } catch (err: any) {
      return fail(`Could not request discharge: ${err?.message || String(err)}`);
    }
  });

  /** Undo a discharge request (patient staying longer). Clears the flag only. */
  ipcMain.handle('ip:cancelDischargeRequest', (_e, admissionId: number, by?: string) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      d.prepare(
        `UPDATE ip_admissions SET discharge_status='none', discharge_requested_at=NULL, discharge_requested_by=NULL WHERE id=?`
      ).run(aid);
      logAudit(d, actor(), 'ip_discharge_request_cancelled', 'ip_admissions', aid, by || '');
      broadcastEvent('ip:dischargeRequested', { admissionId: aid });
      return { ok: true as const };
    } catch (err: any) {
      return fail(`Could not cancel the discharge request: ${err?.message || String(err)}`);
    }
  });

  /**
   * Step 2 — an authorised user APPROVES and the patient is actually discharged:
   * the bill is frozen, the admission closed and the bed freed. If money is still
   * outstanding the caller must pass an override_reason; that reason is stored and
   * audit-logged so an unpaid discharge is always traceable.
   */
  ipcMain.handle('ip:approveDischarge', (_e, admissionId: number, input: any) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const by = String(input?.by || '').trim() || null;
      const override = String(input?.override_reason || '').trim();
      const adm = d.prepare(
        'SELECT id, status, bed_id, bill_id, admission_number, outcome, discharge_status FROM ip_admissions WHERE id=?'
      ).get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') return fail(`${adm.admission_number} is already closed.`);
      if (adm.discharge_status !== 'requested') {
        return fail('Discharge has not been requested yet. The doctor must complete the discharge summary first.');
      }

      try { accrueStayCharges(d, aid, by || undefined); } catch { /* ignore */ }
      const fin = dischargeFinancials(d, aid);
      if (fin.balanceDue > 0.5 && !override) {
        return {
          ok: false as const, needsOverride: true as const, ...fin,
          error: `₹${fin.balanceDue.toLocaleString('en-IN')} is still outstanding. Collect the payment, or approve with a written reason.`,
        };
      }

      const now = new Date().toISOString();
      const tx = d.transaction(() => {
        d.prepare(
          `UPDATE ip_admissions SET status='discharged', discharged_at=?,
             discharge_status='approved', discharge_approved_at=?, discharge_approved_by=?,
             discharge_override_reason=?
           WHERE id=?`
        ).run(now, now, by, override || null, aid);
        if (adm.bed_id) d.prepare(`UPDATE beds SET status='cleaning' WHERE id=?`).run(adm.bed_id);
        /**
         * Record how much of the advance this bill actually consumed.
         *
         * `advances.adjusted_amount` and `bills.advance_adjusted` were READ in
         * three money calculations and written nowhere, so after discharge:
         *   - analytics reported the whole bill as still due, because it
         *     subtracts advance_adjusted (which stayed 0);
         *   - the deposit still showed as held against the clinic; and worst,
         *   - advances:refund computed `available = amount − adjusted − refunded`
         *     and so let the FULL advance be paid out a second time, even though
         *     it had already settled the bill.
         *
         * Allocated oldest receipt first, capped at what each still has spare, so
         * re-running can never over-allocate.
         */
        const consumed = money(Math.max(0, Math.min(fin.advanceAvailable, fin.total - fin.amountPaid)));
        if (consumed > 0) {
          let left = consumed;
          const receipts = d.prepare(
            `SELECT id, amount, adjusted_amount, refunded_amount FROM advances
              WHERE admission_id=? ORDER BY id`
          ).all(aid) as any[];
          const bump = d.prepare('UPDATE advances SET adjusted_amount = adjusted_amount + ? WHERE id=?');
          for (const r of receipts) {
            if (left <= 0) break;
            const spare = money(Number(r.amount) - Number(r.adjusted_amount) - Number(r.refunded_amount));
            if (spare <= 0) continue;
            const take = money(Math.min(spare, left));
            bump.run(take, r.id);
            left = money(left - take);
          }
        }
        if (adm.bill_id) {
          d.prepare(`UPDATE bills SET finalized_at=?, finalized_by=?, status=?, advance_adjusted=? WHERE id=?`)
            .run(now, by, fin.balanceDue > 0.5 ? 'open' : 'paid', consumed, adm.bill_id);
        }
      });
      tx();

      logAudit(d, actor(), 'ip_discharge_approved', 'ip_admissions', aid,
        `${adm.admission_number} · by ${by || '—'}${override ? ` · OVERRIDE (balance ₹${fin.balanceDue}): ${override}` : ''}`);
      broadcastEvent('ip:discharged', { admissionId: aid, outcome: adm.outcome });
      return { ok: true as const, ...fin, overridden: !!override };
    } catch (err: any) {
      return fail(`Could not approve the discharge: ${err?.message || String(err)}`);
    }
  });

  // ---------- Clinical records ----------
  const clinical: [string, string, string[]][] = [
    ['ip:vitals', 'ip_vitals', ['temperature', 'pulse', 'respiration', 'bp_systolic', 'bp_diastolic', 'spo2', 'pain_score', 'notes', 'recorded_by']],
    ['ip:progressNote', 'ip_progress_notes', ['doctor_id', 'note', 'recorded_by']],
    ['ip:nursingNote', 'ip_nursing_notes', ['note', 'shift', 'recorded_by']],
    ['ip:intakeOutput', 'ip_intake_output', ['kind', 'route', 'volume_ml', 'notes', 'recorded_by']],
    ['ip:dietOrder', 'ip_diet_orders', ['diet_type', 'instructions', 'ordered_by']],
  ];

  for (const [channel, table, fields] of clinical) {
    ipcMain.handle(`${channel}:list`, (_e, admissionId: number) => {
      try {
        const aid = requireId(admissionId, 'Admission');
        return db().prepare(`SELECT * FROM ${table} WHERE admission_id=? ORDER BY id DESC LIMIT 500`).all(aid);
      } catch (err: any) {
        throw new Error(`Could not load ${table.replace('ip_', '').replace('_', ' ')}: ${err?.message || String(err)}`);
      }
    });

    ipcMain.handle(`${channel}:add`, (_e, admissionId: number, input: any) => {
      const d = db();
      try {
        const aid = requireId(admissionId, 'Admission');
        const adm = d.prepare('SELECT id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
        if (!adm) return fail(`Admission #${aid} was not found.`);
        if (adm.status !== 'admitted') {
          return fail(`${adm.admission_number} is discharged — clinical entries can only be added while the patient is admitted.`);
        }
        const cols = fields.filter((f) => input?.[f] !== undefined && input?.[f] !== null);
        if (cols.length === 0) {
          return fail(`Nothing to save — provide at least one of: ${fields.join(', ')}.`);
        }
        const info = d.prepare(
          `INSERT INTO ${table} (admission_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
        ).run(aid, ...cols.map((c) => input[c]));
        broadcastEvent('ip:clinicalUpdated', { admissionId: aid, table });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.includes('CHECK constraint failed')) {
          return fail(`One of the values is not allowed for this record type: ${msg}`);
        }
        return fail(`Could not save the entry: ${msg}`);
      }
    });
  }

  // ---------- Standalone bills (OPD consult, pharmacy, lab, custom) ----------
  /**
   * Create a one-off bill not tied to an admission. Covers:
   *   - OPD consultation      (bill_type 'opd_consult')
   *   - Pharmacy dispense      ('pharmacy')
   *   - Lab                    ('lab')
   *   - Quick custom bill      ('custom') — just a name, a reason and an amount
   *
   * patient_id is optional: a custom bill can carry only a typed name, so a
   * walk-in with no record can still be billed and given a printout.
   */
  ipcMain.handle('bill:createStandalone', (_e, input: any) => {
    const d = db();
    try {
      const items: any[] = Array.isArray(input?.items) ? input.items : [];
      if (items.length === 0) {
        return fail('Add at least one line to the bill before saving.');
      }
      for (const it of items) {
        if (!it?.description || String(it.description).trim() === '') {
          return fail('Every line needs a description.');
        }
        const amt = Number(it.amount ?? (Number(it.qty ?? 1) * Number(it.rate ?? 0)));
        if (!Number.isFinite(amt) || amt < 0) {
          return fail(`"${it.description}" has an invalid amount.`);
        }
      }

      let patientId: number | null = null;
      if (input?.patient_id) {
        patientId = requireId(input.patient_id, 'Patient');
        if (!d.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) {
          return fail(`Patient #${patientId} was not found.`);
        }
      }
      const nameOverride = (input?.patient_name || '').trim();
      if (!patientId && !nameOverride) {
        return fail('Enter a patient name, or pick a registered patient.');
      }

      const billType = ['opd_consult', 'pharmacy', 'lab', 'custom', 'misc'].includes(input?.bill_type) ? input.bill_type : 'custom';
      const s = getAllSettings(d);

      let billId = 0;
      let billNumber = '';
      const tx = d.transaction(() => {
        billNumber = nextBillNumber(d, s.invoice_prefix || 'INV');
        const info = d.prepare(
          `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal,
                              discount, discount_type, total, payment_mode, status, bill_type, notes)
           VALUES (?, NULL, ?, '[]', 0, ?, ?, 0, ?, 'open', ?, ?)`
        ).run(
          billNumber,
          patientId,
          Number(input?.discount ?? 0),
          input?.discount_type === 'percent' ? 'percent' : 'flat',
          input?.payment_mode || 'Cash',
          billType,
          nameOverride && !patientId ? `Name: ${nameOverride}` : (input?.reason || null)
        );
        billId = Number(info.lastInsertRowid);
        for (const it of items) {
          addLine(d, billId, {
            charge_head_id: it.charge_head_id ?? null,
            description: String(it.description).trim(),
            qty: Number(it.qty ?? 1),
            rate: Number(it.rate ?? (Number(it.amount ?? 0) / Number(it.qty ?? 1))),
            amount: it.amount !== undefined ? Number(it.amount) : undefined,
            hsn_sac: it.hsn_sac ?? null,
            gst_rate: Number(it.gst_rate ?? 0),
            is_taxable: !!it.is_taxable,
            source: billType,
          }, input?.performed_by);
        }
      });
      tx();
      recalcBill(d, billId);

      // If it's paid at the counter, record the payment and settle it.
      if (input?.paid_now) {
        const total = (d.prepare('SELECT total FROM bills WHERE id=?').get(billId) as any).total;
        d.prepare('INSERT INTO bill_payments (bill_id, amount, payment_mode, received_by) VALUES (?,?,?,?)')
          .run(billId, total, input?.payment_mode || 'Cash', input?.performed_by ?? null);
        d.prepare("UPDATE bills SET amount_paid=?, status='paid', paid_at=? WHERE id=?")
          .run(total, new Date().toISOString(), billId);
      }

      logAudit(d, actor(), 'bill_created', 'bills', billId, `${billNumber} · ${billType}${nameOverride ? ' · ' + nameOverride : ''}`);
      broadcastEvent('bill:created', { billId });
      return { ok: true, id: billId, bill_number: billNumber, patient_name_override: nameOverride || null };
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
  });

  /** Preview any bill by id (for print / reprint), with patient details joined. */
  ipcMain.handle('bill:previewById', (_e, billId: number) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      if (!d.prepare('SELECT id FROM bills WHERE id=?').get(bid)) return fail(`Bill #${bid} was not found.`);
      const totals = recalcBill(d, bid);
      const items = d.prepare(
        `SELECT bi.*, ch.name AS charge_head_name, ch.category, ch.colour
         FROM bill_items bi LEFT JOIN charge_heads ch ON ch.id = bi.charge_head_id
         WHERE bi.bill_id=? ORDER BY bi.id`
      ).all(bid);
      const bill = d.prepare(
        `SELECT b.*,
                COALESCE((p.first_name || ' ' || p.last_name), '') AS patient_name,
                p.uhid AS patient_uhid, p.phone AS patient_phone,
                p.gender AS patient_gender, p.dob AS patient_dob, p.address AS patient_address
         FROM bills b LEFT JOIN patients p ON p.id = b.patient_id WHERE b.id=?`
      ).get(bid) as any;
      // Custom bill with only a typed name — recover it from notes.
      if ((!bill.patient_name || bill.patient_name.trim() === '') && bill.notes?.startsWith('Name: ')) {
        bill.patient_name = bill.notes.slice(6);
      }
      return { ok: true, bill, items, totals };
    } catch (err: any) {
      return fail(`Could not load the bill: ${err?.message || String(err)}`);
    }
  });

  /** Recent bills for the register / reprint list. */
  ipcMain.handle('bill:recent', (_e, limit = 50) => {
    const d = db();
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return d.prepare(
      `SELECT b.id, b.bill_number, b.bill_type, b.total, b.status, b.created_at, b.notes,
              COALESCE((p.first_name || ' ' || p.last_name), '') AS patient_name, p.uhid AS patient_uhid
       FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
       ORDER BY b.id DESC LIMIT ?`
    ).all(n);
  });

  // ---------- Bill: preview / add / finalise ----------
  /** Running bill for an admission — "what's the bill till now". */
  ipcMain.handle('bill:previewAdmission', (_e, admissionId: number) => {
    // Money is reception / ward-in-charge / manager / admin work. Hiding the
    // panel in the renderer is presentation; this is the actual gate, so a
    // signed-in nurse or doctor cannot reach the amount by any other route.
    // No-op when the clinic runs without logins — there is no identity to check.
    requireRole(['receptionist', 'ward_incharge', 'manager'], 'view the bill');
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const billId = getOrCreateAdmissionBill(d, aid);
      // Bring per-day bed/nursing charges up to date before showing the bill, so
      // the running total always reflects the stay so far. No-op once posted.
      try { accrueStayCharges(d, aid); } catch { /* never block the preview */ }
      const totals = recalcBill(d, billId);
      const items = d.prepare(
        `SELECT bi.*, ch.name AS charge_head_name, ch.category, ch.colour
         FROM bill_items bi LEFT JOIN charge_heads ch ON ch.id = bi.charge_head_id
         WHERE bi.bill_id=? ORDER BY bi.id`
      ).all(billId);
      const advances = d.prepare(
        'SELECT COALESCE(SUM(amount - refunded_amount), 0) AS a FROM advances WHERE admission_id=?'
      ).get(aid) as { a: number };
      const paid = d.prepare(
        'SELECT COALESCE(SUM(amount), 0) AS p FROM bill_payments WHERE bill_id=?'
      ).get(billId) as { p: number };
      // Join the patient and admission so the bill and its printout can show
      // who it is for — the bills row alone has no name, which is why the print
      // showed "Patient: —".
      const bill = d.prepare(
        `SELECT b.*,
                (p.first_name || ' ' || p.last_name) AS patient_name,
                p.uhid AS patient_uhid, p.phone AS patient_phone,
                p.gender AS patient_gender, p.dob AS patient_dob,
                p.address AS patient_address,
                a.admission_number, a.admitted_at, a.ward, a.bed_number,
                dr.name AS doctor_name
         FROM bills b
         JOIN patients p ON p.id = b.patient_id
         LEFT JOIN ip_admissions a ON a.id = b.admission_id
         LEFT JOIN doctors dr ON dr.id = a.admission_doctor_id
         WHERE b.id=?`
      ).get(billId);
      return {
        ok: true, bill, items, totals,
        advanceAvailable: money(advances.a),
        amountPaid: money(paid.p),
        balanceDue: money(totals.total - advances.a - paid.p),
      };
    } catch (err: any) {
      return fail(`Could not build the bill preview: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('bill:addItem', (_e, billId: number, line: any, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const bill = d.prepare('SELECT id, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'cancelled') return fail('This bill has been cancelled and cannot be changed.');
      if (bill.status === 'paid') {
        return fail('This bill is already settled. Raise a new bill, or cancel this one and re-issue it.');
      }
      requireText(line?.description, 'Item description', 200);
      const id = addLine(d, bid, line, by);
      const totals = recalcBill(d, bid);
      broadcastEvent('bill:updated', { billId: bid });
      return { ok: true, id, totals };
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
  });

  ipcMain.handle('bill:removeItem', (_e, itemId: number) => {
    const d = db();
    try {
      const iid = requireId(itemId, 'Bill item');
      const row = d.prepare('SELECT bill_id FROM bill_items WHERE id=?').get(iid) as any;
      if (!row) return fail(`Bill line #${iid} was not found — it may already have been removed.`);
      const bill = d.prepare('SELECT status FROM bills WHERE id=?').get(row.bill_id) as any;
      if (bill?.status === 'paid' || bill?.status === 'cancelled') {
        return fail(`Cannot change a bill that is "${bill.status}".`);
      }
      d.prepare('DELETE FROM bill_items WHERE id=?').run(iid);
      const totals = recalcBill(d, row.bill_id);
      broadcastEvent('bill:updated', { billId: row.bill_id });
      return { ok: true, totals };
    } catch (err: any) {
      return fail(`Could not remove the line: ${err?.message || String(err)}`);
    }
  });

  /** Apply a discount, enforcing the per-role cap from Settings. */
  ipcMain.handle('bill:setDiscount', (_e, billId: number, discount: number, type: 'flat' | 'percent', role: string, reason?: string, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const s = getAllSettings(d);
      const amount = Number(discount);
      if (!Number.isFinite(amount) || amount < 0) {
        return fail(`Discount must be zero or more, received ${JSON.stringify(discount)}.`);
      }
      if (s.discount_require_reason && amount > 0 && !reason) {
        return fail('A reason is required for every discount. Settings → Billing → Discounts controls this.');
      }
      const bill = d.prepare('SELECT id, subtotal, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'paid' || bill.status === 'cancelled') {
        return fail(`Cannot discount a bill that is "${bill.status}".`);
      }

      /**
       * Derive the role from the SESSION, never from the caller's argument.
       *
       * The cap is the only thing standing between a receptionist and a 100%
       * discount, and it was being checked against a role string the renderer
       * passed in — so the check enforced whatever the caller claimed to be.
       * With logins on, the main process knows who this is; use that. Without
       * logins there is no identity to appeal to, so the supplied role stands
       * (and requireRole is a no-op by the same reasoning).
       */
      requireRole(['receptionist', 'ward_incharge', 'manager'], 'apply a discount');
      const effectiveRole = actor()?.role ?? role;
      const cap = discountCapForRole(s.discount_caps_json, effectiveRole);
      const asPercent = type === 'percent' ? amount : (bill.subtotal > 0 ? (amount / bill.subtotal) * 100 : 0);
      if (asPercent > cap) {
        return fail(
          `This discount is ${asPercent.toFixed(1)}% but the "${effectiveRole}" role is limited to ${cap}%. ` +
          `Ask an administrator, or raise the limit in Settings → Billing → Discounts.`
        );
      }

      d.prepare('UPDATE bills SET discount=?, discount_type=?, discount_reason=?, discount_by=? WHERE id=?')
        .run(amount, type, reason ?? null, by ?? null, bid);
      const totals = recalcBill(d, bid);
      logAudit(d, actor(), 'bill_discounted', 'bills', bid, `${amount} ${type} by ${role}${reason ? ' · ' + reason : ''}`);
      return { ok: true, totals };
    } catch (err: any) {
      return fail(`Could not apply the discount: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('bill:pay', (_e, billId: number, amount: number, mode: string, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return fail(`Payment amount must be greater than zero, received ${JSON.stringify(amount)}.`);
      }
      const bill = d.prepare('SELECT id, total, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'cancelled') return fail('This bill has been cancelled and cannot take a payment.');

      const tx = d.transaction(() => {
        d.prepare('INSERT INTO bill_payments (bill_id, amount, payment_mode, received_by) VALUES (?,?,?,?)')
          .run(bid, amt, mode || 'Cash', by ?? null);
        const paid = (d.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM bill_payments WHERE bill_id=?').get(bid) as any).p;
        const adv = (d.prepare('SELECT COALESCE(SUM(amount - refunded_amount),0) AS a FROM advances WHERE admission_id=(SELECT admission_id FROM bills WHERE id=?)').get(bid) as any).a || 0;
        const settled = paid + adv >= bill.total - 0.01;
        d.prepare('UPDATE bills SET amount_paid=?, status=?, paid_at=COALESCE(paid_at, ?) WHERE id=?')
          .run(money(paid), settled ? 'paid' : 'part_paid', new Date().toISOString(), bid);
      });
      tx();
      broadcastEvent('bill:updated', { billId: bid });
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not record the payment: ${err?.message || String(err)}`);
    }
  });

  // ---------- TPA / Insurance ----------
  ipcMain.handle('tpa:insurers', (_e, includeInactive = false) => {
    const where = includeInactive ? '' : 'WHERE is_active=1';
    return db().prepare(`SELECT * FROM tpa_master ${where} ORDER BY name`).all();
  });

  ipcMain.handle('tpa:insurerSave', (_e, input: any) => {
    const d = db();
    try {
      const name = requireText(input?.name, 'Insurer name', 100);
      if (input?.id) {
        const id = requireId(input.id, 'Insurer id');
        d.prepare('UPDATE tpa_master SET name=?, code=?, contact_person=?, phone=?, email=?, address=?, is_active=? WHERE id=?')
          .run(name, input.code ?? null, input.contact_person ?? null, input.phone ?? null, input.email ?? null, input.address ?? null, input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare('INSERT INTO tpa_master (name, code, contact_person, phone, email, address) VALUES (?,?,?,?,?,?)')
        .run(name, input.code ?? null, input.contact_person ?? null, input.phone ?? null, input.email ?? null, input.address ?? null);
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE')) return fail(`An insurer named "${input?.name}" already exists.`);
      return fail(`Could not save the insurer: ${msg}`);
    }
  });

  ipcMain.handle('tpa:claims', (_e, status?: string) => {
    const where = status ? 'WHERE c.status=?' : '';
    const params = status ? [status] : [];
    return db().prepare(
      `SELECT c.*, t.name AS insurer_name_master, (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid,
              a.admission_number, b.bill_number
       FROM tpa_claims c
       JOIN tpa_master t ON t.id=c.tpa_id
       JOIN patients p ON p.id=c.patient_id
       LEFT JOIN ip_admissions a ON a.id=c.admission_id
       LEFT JOIN bills b ON b.id=c.bill_id
       ${where} ORDER BY c.created_at DESC`
    ).all(...params);
  });

  ipcMain.handle('tpa:claimSave', (_e, input: any) => {
    const d = db();
    try {
      const tpaId = requireId(input?.tpa_id, 'Insurer');
      const patientId = requireId(input?.patient_id, 'Patient');
      if (input?.id) {
        const id = requireId(input.id, 'Claim id');
        d.prepare(
          `UPDATE tpa_claims SET tpa_id=?, policy_no=?, preauth_no=?, preauth_amount=?, claimed_amount=?, approved_amount=?, settled_amount=?, copay_amount=?, admission_id=?, bill_id=?, notes=? WHERE id=?`
        ).run(tpaId, input.policy_no ?? null, input.preauth_no ?? null, Number(input.preauth_amount ?? 0),
              Number(input.claimed_amount ?? 0), Number(input.approved_amount ?? 0), Number(input.settled_amount ?? 0),
              Number(input.copay_amount ?? 0), input.admission_id ?? null, input.bill_id ?? null, input.notes ?? null, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO tpa_claims (tpa_id, patient_id, admission_id, bill_id, policy_no, preauth_no, preauth_amount, claimed_amount, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(tpaId, patientId, input.admission_id ?? null, input.bill_id ?? null, input.policy_no ?? null,
            input.preauth_no ?? null, Number(input.preauth_amount ?? 0), Number(input.claimed_amount ?? 0), input.notes ?? null);
      const cid = Number(info.lastInsertRowid);
      d.prepare('INSERT INTO tpa_claim_events (claim_id, event, detail) VALUES (?,?,?)').run(cid, 'created', 'Claim opened');
      return { ok: true, id: cid };
    } catch (err: any) {
      return fail(`Could not save the claim: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('tpa:claimStatus', (_e, claimId: number, status: string, amount?: number, note?: string, by?: string) => {
    const d = db();
    const ALLOWED = ['draft', 'preauth_sent', 'preauth_approved', 'submitted', 'queried', 'approved', 'settled', 'rejected', 'closed'];
    try {
      const id = requireId(claimId, 'Claim');
      if (!ALLOWED.includes(status)) return fail(`"${status}" is not a valid claim status.`);
      const c = d.prepare('SELECT id FROM tpa_claims WHERE id=?').get(id);
      if (!c) return fail(`Claim #${id} was not found.`);
      const tx = d.transaction(() => {
        d.prepare('UPDATE tpa_claims SET status=?, submitted_at=CASE WHEN ?=\'submitted\' THEN datetime(\'now\') ELSE submitted_at END, settled_at=CASE WHEN ?=\'settled\' THEN datetime(\'now\') ELSE settled_at END WHERE id=?')
          .run(status, status, status, id);
        if (status === 'approved' && amount != null) d.prepare('UPDATE tpa_claims SET approved_amount=? WHERE id=?').run(Number(amount), id);
        if (status === 'settled' && amount != null) d.prepare('UPDATE tpa_claims SET settled_amount=? WHERE id=?').run(Number(amount), id);
        d.prepare('INSERT INTO tpa_claim_events (claim_id, event, detail, amount, recorded_by) VALUES (?,?,?,?,?)')
          .run(id, status, note ?? null, amount != null ? Number(amount) : null, by ?? null);
      });
      tx();
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not update the claim: ${err?.message || String(err)}`);
    }
  });

  // ---------- Medication orders + administration (MAR) ----------
  ipcMain.handle('ip:medOrders', (_e, admissionId: number) => {
    const id = requireId(admissionId, 'Admission');
    return db().prepare(
      `SELECT o.*, dr.name AS ordered_by_name,
              (SELECT COUNT(*) FROM ip_medication_admin a WHERE a.order_id=o.id AND a.status='given') AS given_count
       FROM ip_medication_orders o LEFT JOIN doctors dr ON dr.id=o.ordered_by_doctor_id
       WHERE o.admission_id=? ORDER BY o.status='active' DESC, o.id DESC`
    ).all(id);
  });

  ipcMain.handle('ip:medOrderAdd', (_e, admissionId: number, input: any) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const adm = d.prepare('SELECT status FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') return fail('Medication orders can only be added while the patient is admitted.');
      const drugName = requireText(input?.drug_name, 'Drug name', 120);
      const info = d.prepare(
        `INSERT INTO ip_medication_orders (admission_id, drug_master_id, drug_name, dose, route, frequency, instructions, ordered_by_doctor_id)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(aid, input.drug_master_id ?? null, drugName, input.dose ?? null, input.route ?? null,
            input.frequency ?? null, input.instructions ?? null, input.ordered_by_doctor_id ?? null);
      broadcastEvent('ip:medUpdated', { admissionId: aid });
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not add the medication order: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('ip:medOrderStop', (_e, orderId: number) => {
    try {
      db().prepare("UPDATE ip_medication_orders SET status='stopped', stop_at=datetime('now') WHERE id=?").run(requireId(orderId, 'Order'));
      return { ok: true };
    } catch (err: any) { return fail(`Could not stop the order: ${err?.message || String(err)}`); }
  });

  ipcMain.handle('ip:medAdminList', (_e, admissionId: number) => {
    const id = requireId(admissionId, 'Admission');
    return db().prepare(
      `SELECT a.*, o.drug_name, o.dose, o.route FROM ip_medication_admin a
       JOIN ip_medication_orders o ON o.id=a.order_id
       WHERE a.admission_id=? ORDER BY a.administered_at DESC LIMIT 500`
    ).all(id);
  });

  /**
   * Record an administration. A 'given' dose, when the drug is a stocked item
   * and a quantity is supplied, pulls from the FEFO batch, reduces pharmacy
   * stock, writes the Schedule-H dispensing register, and posts the charge to
   * the running IPD bill — all in one transaction. Refused/omitted/held record
   * only the event.
   */
  ipcMain.handle('ip:medAdminGive', (_e, orderId: number, input: any) => {
    const d = db();
    try {
      const oid = requireId(orderId, 'Order');
      const order = d.prepare('SELECT * FROM ip_medication_orders WHERE id=?').get(oid) as any;
      if (!order) return fail(`Medication order #${oid} was not found.`);
      const status = ['given', 'refused', 'omitted', 'held'].includes(input?.status) ? input.status : 'given';
      const qty = Number(input?.qty ?? 0);

      let batchId: number | null = null;
      let billItemId: number | null = null;

      const tx = d.transaction(() => {
        // Stock depletion + billing only for a 'given' dose of a stocked drug.
        if (status === 'given' && order.drug_master_id && qty > 0) {
          const batches = d.prepare(
            `SELECT b.id, b.batch_no, b.expiry, b.qty_remaining, b.mrp, m.schedule, m.gst_rate
             FROM drug_stock_batches b JOIN drug_master m ON m.id=b.drug_master_id
             WHERE b.drug_master_id=? AND b.is_active=1 AND b.qty_remaining>0
             ORDER BY date(b.expiry) ASC, b.received_at ASC`
          ).all(order.drug_master_id) as any[];
          const total = batches.reduce((s, b) => s + b.qty_remaining, 0);
          if (total < qty) {
            throw new Error(`Only ${total} unit(s) of ${order.drug_name} in stock, but ${qty} requested. Add stock in Pharmacy, or record without stock by leaving quantity 0.`);
          }
          const rate = batches[0]?.mrp ?? 0;
          const patientId = (d.prepare('SELECT patient_id FROM ip_admissions WHERE id=?').get(order.admission_id) as any)?.patient_id ?? null;

          // A dispensed medicine IS a sale — create the pharmacy_sale + sale_item
          // so the Schedule-H dispensing register (whose sale_item_id / sale_id
          // are NOT NULL) stays consistent with counter dispensing.
          const saleNo = `IPD-${order.admission_id}-${Date.now()}`;
          const sale = d.prepare(
            `INSERT INTO pharmacy_sales (sale_number, patient_id, subtotal, discount, total, payment_mode, sold_by)
             VALUES (?,?,?,0,?,?,?)`
          ).run(saleNo, patientId, rate * qty, rate * qty, 'IPD-bill', input?.administered_by ?? null);
          const saleId = Number(sale.lastInsertRowid);
          // drug_master_id — NOT the legacy drug_id column, which FKs the old
          // drug_inventory table and would fail for any catalogue drug.
          const saleItem = d.prepare(
            `INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, drug_name, qty, rate, amount) VALUES (?,?,?,?,?,?)`
          ).run(saleId, order.drug_master_id, `${order.drug_name}${order.dose ? ' ' + order.dose : ''}`, qty, rate, rate * qty);
          const saleItemId = Number(saleItem.lastInsertRowid);

          let need = qty;
          for (const b of batches) {
            if (need <= 0) break;
            const take = Math.min(need, b.qty_remaining);
            d.prepare('UPDATE drug_stock_batches SET qty_remaining=qty_remaining-? WHERE id=?').run(take, b.id);
            d.prepare(
              `INSERT INTO dispensing_register (sale_item_id, sale_id, patient_id, doctor_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate, rx_reference, dispensed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(saleItemId, saleId, patientId, order.ordered_by_doctor_id ?? null, order.drug_master_id, b.id, b.batch_no, b.expiry, b.schedule || 'OTC', take, b.mrp, `IPD-MAR#${oid}`, input?.administered_by ?? null);
            batchId = b.id;
            need -= take;
          }

          // Post to the running IPD bill.
          const billId = getOrCreateAdmissionBill(d, order.admission_id);
          const s = getAllSettings(d);
          billItemId = addLine(d, billId, {
            description: `${order.drug_name}${order.dose ? ' ' + order.dose : ''} × ${qty}`,
            qty, rate, amount: rate * qty,
            gst_rate: s.gst_enabled ? (batches[0]?.gst_rate ?? 0) : 0,
            is_taxable: s.gst_enabled && (batches[0]?.gst_rate ?? 0) > 0,
            source: 'ipd_medication', source_ref_id: oid,
          }, input?.administered_by);
          recalcBill(d, billId);
        }

        d.prepare(
          `INSERT INTO ip_medication_admin (order_id, admission_id, status, reason, qty, batch_id, bill_item_id, administered_by)
           VALUES (?,?,?,?,?,?,?,?)`
        ).run(oid, order.admission_id, status, input?.reason ?? null, qty, batchId, billItemId, input?.administered_by ?? null);
      });
      tx();
      broadcastEvent('ip:medUpdated', { admissionId: order.admission_id });
      broadcastEvent('bill:updated', { billId: null });
      return { ok: true, billed: billItemId !== null };
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
  });

  // ---------- Cross-consultation ----------
  ipcMain.handle('ip:xconsults', (_e, admissionId: number) => {
    const id = requireId(admissionId, 'Admission');
    return db().prepare(
      `SELECT x.*, dr.name AS doctor_name FROM ip_cross_consultations x
       LEFT JOIN doctors dr ON dr.id=x.doctor_id WHERE x.admission_id=? ORDER BY x.id DESC`
    ).all(id);
  });

  ipcMain.handle('ip:xconsultAdd', (_e, admissionId: number, doctorId: number, reason?: string) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const did = requireId(doctorId, 'Doctor');
      d.prepare('INSERT INTO ip_cross_consultations (admission_id, doctor_id, reason) VALUES (?,?,?)').run(aid, did, reason ?? null);
      broadcastEvent('ip:clinicalUpdated', { admissionId: aid });
      return { ok: true };
    } catch (err: any) { return fail(`Could not request the consultation: ${err?.message || String(err)}`); }
  });

  ipcMain.handle('ip:xconsultRespond', (_e, id: number, opinion: string, by?: string) => {
    const d = db();
    try {
      const xid = requireId(id, 'Consultation');
      d.prepare("UPDATE ip_cross_consultations SET status='seen', opinion=?, responded_at=datetime('now') WHERE id=?").run(opinion ?? null, xid);
      return { ok: true };
    } catch (err: any) { return fail(`Could not save the opinion: ${err?.message || String(err)}`); }
  });

  // ---------- Discharge-summary templates ----------
  ipcMain.handle('dischargeTemplates:list', (_e, filter: any = {}) => {
    try {
      const d = db();
      // Every column is table-qualified: discharge_templates and doctors BOTH have
      // an is_active column, so a bare `is_active` is ambiguous once they're joined.
      const where: string[] = ['t.is_active=1'];
      const params: any[] = [];
      if (filter?.department) { where.push('(t.department IS NULL OR t.department=?)'); params.push(filter.department); }
      if (filter?.doctor_id) { where.push('(t.doctor_id IS NULL OR t.doctor_id=?)'); params.push(filter.doctor_id); }
      return d.prepare(
        `SELECT t.*, dr.name AS doctor_name FROM discharge_templates t
         LEFT JOIN doctors dr ON dr.id = t.doctor_id
         WHERE ${where.join(' AND ')} ORDER BY t.sort_order, t.name`
      ).all(...params);
    } catch (err: any) {
      // Re-throw (not return) so the renderer's query lands in its error state and
      // shows the message — this list must resolve to an array on success.
      throw new Error(`Could not load discharge templates: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('dischargeTemplates:save', (_e, input: any) => {
    const d = db();
    try {
      const name = requireText(input?.name, 'Template name', 80);
      let content = '{}';
      try { content = JSON.stringify(input?.content ?? {}); } catch { return fail('The template content could not be saved (invalid data).'); }
      if (input?.id) {
        const id = requireId(input.id, 'Template id');
        d.prepare(
          `UPDATE discharge_templates SET name=?, department=?, doctor_id=?, content_json=?, sort_order=?, is_active=?, updated_at=datetime('now') WHERE id=?`
        ).run(name, input.department ?? null, input.doctor_id ?? null, content, Number(input.sort_order ?? 0), input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO discharge_templates (name, department, doctor_id, content_json, sort_order) VALUES (?,?,?,?,?)`
      ).run(name, input.department ?? null, input.doctor_id ?? null, content, Number(input.sort_order ?? 0));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not save the template: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('dischargeTemplates:delete', (_e, id: number) => {
    try {
      db().prepare('UPDATE discharge_templates SET is_active=0 WHERE id=?').run(requireId(id, 'Template id'));
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not delete the template: ${err?.message || String(err)}`);
    }
  });

  // ---------- Admission requests (doctor → reception) ----------
  ipcMain.handle('ip:requestAdmission', (_e, input: any) => {
    const d = db();
    try {
      const patientId = requireId(input?.patient_id, 'Patient');
      if (!d.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) {
        return fail(`Patient #${patientId} was not found.`);
      }
      // Block a duplicate open request for the same patient.
      const existing = d.prepare(`SELECT id FROM admission_requests WHERE patient_id=? AND status='pending'`).get(patientId);
      if (existing) return fail('There is already a pending admission request for this patient.');

      const info = d.prepare(
        `INSERT INTO admission_requests (patient_id, doctor_id, requested_by, provisional_diagnosis, suggested_ward_id, urgency, notes)
         VALUES (?,?,?,?,?,?,?)`
      ).run(
        patientId, input.doctor_id ?? null, input.requested_by ?? null,
        input.provisional_diagnosis ?? null, input.suggested_ward_id ?? null,
        ['routine', 'urgent', 'emergency'].includes(input.urgency) ? input.urgency : 'routine',
        input.notes ?? null
      );
      logAudit(d, actor(), 'admission_requested', 'admission_requests', Number(info.lastInsertRowid));
      broadcastEvent('ip:admissionRequested', { id: Number(info.lastInsertRowid), patientId });
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not raise the admission request: ${err?.message || String(err)}`);
    }
  });

  /**
   * Save (or update) a rich discharge summary WITHOUT discharging the patient — for
   * the dedicated Discharge Summary builder. Stores the structured JSON plus a
   * composed plain-text copy in discharge_summary so print/legacy flows keep working.
   */
  ipcMain.handle('ip:saveDischargeSummary', (_e, admissionId: number, payload: any) => {
    try {
      const id = requireId(admissionId, 'Admission');
      const d = db();
      if (!d.prepare('SELECT id FROM ip_admissions WHERE id=?').get(id)) return fail('That admission was not found.');
      const sections = Array.isArray(payload?.sections)
        ? payload.sections.filter((s: any) => s && (s.label || s.body)).map((s: any) => ({ label: String(s.label ?? ''), body: String(s.body ?? '') }))
        : [];
      const json = JSON.stringify({
        diagnosis: payload?.diagnosis ?? '', condition: payload?.condition ?? '',
        followup: payload?.followup ?? '', doctor_id: payload?.doctor_id ?? null, sections,
      });
      // Compose a readable plain-text version for the existing discharge_summary column.
      const lines: string[] = [];
      if (payload?.diagnosis) lines.push(`Discharge Diagnosis:\n${payload.diagnosis}`);
      if (payload?.condition) lines.push(`Condition at Discharge:\n${payload.condition}`);
      for (const s of sections) if (s.body.trim()) lines.push(`${s.label}:\n${s.body}`);
      if (payload?.followup) lines.push(`Follow-up / Advice:\n${payload.followup}`);
      const plain = lines.join('\n\n');
      d.prepare('UPDATE ip_admissions SET discharge_summary=?, discharge_summary_json=? WHERE id=?').run(plain, json, id);
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not save the discharge summary: ${err?.message || String(err)}`);
    }
  });

  // ---------- Print Jobs inbox (doctor → reception to print) ----------
  ipcMain.handle('printJobs:create', (_e, input: any) => {
    try {
      const kind = requireText(input?.kind, 'Kind', 40);
      const title = requireText(input?.title, 'Title', 200);
      const d = db();
      const info = d.prepare(
        `INSERT INTO print_jobs (kind, title, patient_id, patient_name, payload_json, created_by)
         VALUES (?,?,?,?,?,?)`
      ).run(kind, title, input?.patient_id ?? null, input?.patient_name ?? null,
            JSON.stringify(input?.payload ?? {}), input?.created_by ?? null);
      broadcastEvent('printJobs:changed', {});
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not send to reception: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('printJobs:list', (_e, status = 'pending') => {
    return db().prepare(`SELECT * FROM print_jobs WHERE status=? ORDER BY created_at DESC`).all(status);
  });

  ipcMain.handle('printJobs:pendingCount', () => {
    const r = db().prepare(`SELECT COUNT(*) AS c FROM print_jobs WHERE status='pending'`).get() as { c: number };
    return r.c;
  });

  ipcMain.handle('printJobs:markPrinted', (_e, id: number, by?: string) => {
    try {
      db().prepare(`UPDATE print_jobs SET status='printed', printed_by=?, printed_at=datetime('now') WHERE id=?`)
        .run(by ?? null, requireId(id, 'Print job'));
      broadcastEvent('printJobs:changed', {});
      return { ok: true };
    } catch (err: any) { return fail(`Could not update: ${err?.message || String(err)}`); }
  });

  ipcMain.handle('printJobs:cancel', (_e, id: number) => {
    try {
      db().prepare(`UPDATE print_jobs SET status='cancelled' WHERE id=?`).run(requireId(id, 'Print job'));
      broadcastEvent('printJobs:changed', {});
      return { ok: true };
    } catch (err: any) { return fail(`Could not cancel: ${err?.message || String(err)}`); }
  });

  ipcMain.handle('ip:admissionRequests', (_e, status = 'pending') => {
    // When listing PENDING requests, hide any whose patient is already admitted — a
    // request that's been fulfilled by a manual admit should not linger in the queue.
    const hideAdmitted = status === 'pending'
      ? `AND NOT EXISTS (SELECT 1 FROM ip_admissions a WHERE a.patient_id = r.patient_id AND a.status='admitted')`
      : '';
    return db().prepare(
      `SELECT r.*, (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid, p.phone AS patient_phone,
              p.dob AS patient_dob, p.gender AS patient_gender,
              dr.name AS doctor_name, w.name AS suggested_ward_name
       FROM admission_requests r
       JOIN patients p ON p.id = r.patient_id
       LEFT JOIN doctors dr ON dr.id = r.doctor_id
       LEFT JOIN wards w ON w.id = r.suggested_ward_id
       WHERE r.status = ? ${hideAdmitted} ORDER BY
         CASE r.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, r.requested_at`
    ).all(status);
  });

  ipcMain.handle('ip:rejectAdmissionRequest', (_e, requestId: number, reason?: string, by?: string) => {
    const d = db();
    try {
      const id = requireId(requestId, 'Request');
      const r = d.prepare('SELECT status FROM admission_requests WHERE id=?').get(id) as any;
      if (!r) return fail(`Admission request #${id} was not found.`);
      if (r.status !== 'pending') return fail(`This request is already ${r.status}.`);
      d.prepare(`UPDATE admission_requests SET status='rejected', decided_at=datetime('now'), decided_by=?, decision_note=? WHERE id=?`)
        .run(by ?? null, reason ?? null, id);
      broadcastEvent('ip:admissionRequestDecided', { id, status: 'rejected' });
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not reject the request: ${err?.message || String(err)}`);
    }
  });

  // ---------- Analytics ----------
  /**
   * IPD and billing metrics for a date range. IPD had zero analytics before;
   * this powers the new dashboard section.
   */
  ipcMain.handle('analytics:ipd', (_e, from: string, to: string) => {
    const d = db();
    try {
      const range = [from, to];

      const occupancy = d.prepare(
        `SELECT
           (SELECT COUNT(*) FROM beds WHERE is_active=1) AS total_beds,
           (SELECT COUNT(*) FROM beds WHERE is_active=1 AND status='occupied') AS occupied_beds`
      ).get() as { total_beds: number; occupied_beds: number };

      const admissions = d.prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions WHERE date(admitted_at) BETWEEN ? AND ?`
      ).get(...range) as { c: number };

      const discharges = d.prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions WHERE discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?`
      ).get(...range) as { c: number };

      // Average length of stay for admissions discharged in range, in days.
      const alos = d.prepare(
        `SELECT AVG(julianday(discharged_at) - julianday(admitted_at)) AS d
         FROM ip_admissions WHERE discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?`
      ).get(...range) as { d: number | null };

      // Outcome mix — the LAMA/DAMA/death breakdown for quality indicators.
      const outcomes = d.prepare(
        `SELECT COALESCE(outcome, 'in_progress') AS outcome, COUNT(*) AS count
         FROM ip_admissions
         WHERE (discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?)
            OR (discharged_at IS NULL AND date(admitted_at) BETWEEN ? AND ?)
         GROUP BY outcome`
      ).all(from, to, from, to) as { outcome: string; count: number }[];

      const totalClosed = outcomes.filter((o) => o.outcome !== 'in_progress').reduce((s, o) => s + o.count, 0);
      const deaths = outcomes.find((o) => o.outcome === 'death')?.count ?? 0;
      const lamas = (outcomes.find((o) => o.outcome === 'lama')?.count ?? 0) + (outcomes.find((o) => o.outcome === 'dama')?.count ?? 0);

      const byDoctor = d.prepare(
        `SELECT COALESCE(dr.name, 'Unassigned') AS doctor, COUNT(*) AS admissions,
                AVG(CASE WHEN a.discharged_at IS NOT NULL THEN julianday(a.discharged_at) - julianday(a.admitted_at) END) AS alos
         FROM ip_admissions a LEFT JOIN doctors dr ON dr.id = a.admission_doctor_id
         WHERE date(a.admitted_at) BETWEEN ? AND ?
         GROUP BY a.admission_doctor_id ORDER BY admissions DESC`
      ).all(...range) as any[];

      // Ward-wise finance: admissions attributed to a ward, with the billing on
      // those admissions (revenue / collected / outstanding) and advances held.
      // Bills and advances are pre-aggregated per admission so multiple bills on
      // one admission don't double-count when summed up to the ward.
      const byWardRaw = d.prepare(
        `SELECT COALESCE(w.name, a.ward, 'Unknown') AS ward,
                w.colour AS colour,
                COUNT(DISTINCT a.id) AS admissions,
                SUM(CASE WHEN a.status = 'admitted' THEN 1 ELSE 0 END) AS active,
                AVG(CASE WHEN a.discharged_at IS NOT NULL THEN julianday(a.discharged_at) - julianday(a.admitted_at) END) AS alos,
                COALESCE(SUM(bill.total), 0) AS revenue,
                COALESCE(SUM(bill.paid), 0) AS collected,
                COALESCE(SUM(adv.advance), 0) AS advance
         FROM ip_admissions a
         LEFT JOIN wards w ON w.id = a.ward_id
         LEFT JOIN (SELECT admission_id, SUM(total) AS total, SUM(IFNULL(amount_paid, 0)) AS paid
                    FROM bills WHERE status IS NULL OR status <> 'cancelled' GROUP BY admission_id) bill ON bill.admission_id = a.id
         LEFT JOIN (SELECT admission_id, SUM(amount - refunded_amount) AS advance FROM advances GROUP BY admission_id) adv ON adv.admission_id = a.id
         WHERE date(a.admitted_at) BETWEEN ? AND ?
         GROUP BY ward ORDER BY revenue DESC`
      ).all(...range) as any[];
      const byWard = byWardRaw.map((r) => ({
        ward: r.ward,
        colour: r.colour || null,
        admissions: r.admissions,
        active: r.active,
        alos: r.alos ? Math.round(r.alos * 10) / 10 : 0,
        revenue: money(r.revenue),
        collected: money(r.collected),
        outstanding: money((r.revenue || 0) - (r.collected || 0)),
        advance: money(r.advance),
        revPerAdm: r.admissions ? money(r.revenue / r.admissions) : 0,
      }));

      const revenue = d.prepare(
        `SELECT COALESCE(SUM(total), 0) AS total FROM bills
         WHERE bill_type='ipd' AND status != 'cancelled' AND date(created_at) BETWEEN ? AND ?`
      ).get(...range) as { total: number };

      return {
        ok: true,
        occupancyPct: occupancy.total_beds ? Math.round((occupancy.occupied_beds / occupancy.total_beds) * 100) : 0,
        totalBeds: occupancy.total_beds,
        occupiedBeds: occupancy.occupied_beds,
        admissions: admissions.c,
        discharges: discharges.c,
        alosDays: alos.d ? Math.round(alos.d * 10) / 10 : 0,
        outcomes,
        mortalityRate: totalClosed ? Math.round((deaths / totalClosed) * 1000) / 10 : 0,
        lamaRate: totalClosed ? Math.round((lamas / totalClosed) * 1000) / 10 : 0,
        byDoctor,
        byWard,
        ipdRevenue: money(revenue.total),
      };
    } catch (err: any) {
      return fail(`Could not build IPD analytics: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('analytics:billing', (_e, from: string, to: string) => {
    const d = db();
    try {
      const range = [from, to];

      const collections = d.prepare(
        `SELECT payment_mode, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM bill_payments WHERE date(received_at) BETWEEN ? AND ? GROUP BY payment_mode`
      ).all(...range) as any[];

      const outstanding = d.prepare(
        /**
         * Driven by money owed, not by a status whitelist.
         *
         * The whitelist missed every bill left at the column's default status —
         * which is most lab and OPD bills — and included 'finalised', a value
         * nothing ever writes (the code spells it 'paid'). Outstanding therefore
         * under-reported real debt while listing settled bills as owing.
         */
        `SELECT COALESCE(SUM(total - amount_paid - advance_adjusted), 0) AS due
           FROM bills
          WHERE COALESCE(status,'') <> 'cancelled'
            AND cancelled_at IS NULL
            AND paid_at IS NULL
            AND (total - amount_paid - advance_adjusted) > 0.5`
      ).get() as { due: number };

      const gst = d.prepare(
        `SELECT COALESCE(SUM(cgst_total), 0) AS cgst, COALESCE(SUM(sgst_total), 0) AS sgst,
                COALESCE(SUM(taxable_total), 0) AS taxable, COALESCE(SUM(exempt_total), 0) AS exempt
         FROM bills WHERE is_tax_invoice=1 AND status != 'cancelled' AND date(created_at) BETWEEN ? AND ?`
      ).get(...range) as any;

      // Section-wise revenue from the charge-head category on each line.
      const bySection = d.prepare(
        `SELECT COALESCE(ch.category, 'other') AS category, COALESCE(SUM(bi.amount), 0) AS total
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
         LEFT JOIN charge_heads ch ON ch.id = bi.charge_head_id
         WHERE b.status != 'cancelled' AND date(b.created_at) BETWEEN ? AND ?
         GROUP BY ch.category ORDER BY total DESC`
      ).all(...range) as any[];

      // Patient advances / deposits — money held on account, net of what's been
      // adjusted into bills or refunded, so it reads as a real liability.
      const adv = d.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS collected,
                COALESCE(SUM(adjusted_amount), 0) AS adjusted,
                COALESCE(SUM(refunded_amount), 0) AS refunded
         FROM advances`
      ).get() as any;

      // TPA / insurance claims — the cashless pipeline by value and how much is
      // still outstanding with insurers (submitted-but-not-yet-settled).
      const tpaTotals = d.prepare(
        `SELECT COALESCE(SUM(claimed_amount), 0) AS claimed,
                COALESCE(SUM(approved_amount), 0) AS approved,
                COALESCE(SUM(settled_amount), 0) AS settled,
                COALESCE(SUM(CASE WHEN status IN ('submitted','queried','approved','preauth_approved','preauth_sent')
                                  THEN claimed_amount ELSE 0 END), 0) AS in_pipeline
         FROM tpa_claims WHERE status != 'rejected'`
      ).get() as any;
      const tpaByStatus = d.prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(claimed_amount), 0) AS total
         FROM tpa_claims GROUP BY status ORDER BY total DESC`
      ).all() as any[];

      return {
        ok: true,
        collections,
        totalCollected: money(collections.reduce((s, c) => s + c.total, 0)),
        outstanding: money(outstanding.due),
        gst: { cgst: money(gst.cgst), sgst: money(gst.sgst), total: money(gst.cgst + gst.sgst), taxable: money(gst.taxable), exempt: money(gst.exempt) },
        bySection,
        advances: {
          held: money((adv.collected || 0) - (adv.adjusted || 0) - (adv.refunded || 0)),
          collected: money(adv.collected), adjusted: money(adv.adjusted), refunded: money(adv.refunded),
        },
        tpa: {
          claimed: money(tpaTotals.claimed), approved: money(tpaTotals.approved),
          settled: money(tpaTotals.settled), inPipeline: money(tpaTotals.in_pipeline),
          byStatus: tpaByStatus,
        },
      };
    } catch (err: any) {
      return fail(`Could not build billing analytics: ${err?.message || String(err)}`);
    }
  });

  // ---------- Advances ----------
  /**
   * The advance receipts on one admission, with what is still refundable.
   *
   * advances:refund existed but nothing could call it usefully: there was no way
   * to discover an advance's id, so the app told staff money was owed back and
   * gave them no means to return it. This is the missing half.
   */
  ipcMain.handle('advances:list', (_e, admissionId: number) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const rows = d.prepare(
        `SELECT id, amount, adjusted_amount, refunded_amount, mode, received_by, created_at,
                (amount - adjusted_amount - refunded_amount) AS refundable
           FROM advances WHERE admission_id=? ORDER BY id`
      ).all(aid);
      return { ok: true as const, rows };
    } catch (err: any) {
      return { ok: false as const, error: err?.message || String(err), rows: [] };
    }
  });

  ipcMain.handle('advances:refund', (_e, advanceId: number, amount: number, reason: string, by?: string) => {
    const d = db();
    try {
      const id = requireId(advanceId, 'Advance');
      const amt = Number(amount);
      const adv = d.prepare('SELECT id, amount, adjusted_amount, refunded_amount FROM advances WHERE id=?').get(id) as any;
      if (!adv) return fail(`Advance receipt #${id} was not found.`);
      const available = money(adv.amount - adv.adjusted_amount - adv.refunded_amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return fail(`Refund amount must be greater than zero, received ${JSON.stringify(amount)}.`);
      }
      if (amt > available) {
        return fail(`Only ₹${available} is available to refund on this receipt (₹${adv.adjusted_amount} already adjusted against the bill, ₹${adv.refunded_amount} already refunded).`);
      }
      if (!reason) return fail('Please record why the advance is being refunded.');

      d.prepare('UPDATE advances SET refunded_amount=refunded_amount+?, refunded_at=?, refunded_by=?, refund_reason=? WHERE id=?')
        .run(amt, new Date().toISOString(), by ?? null, reason, id);
      logAudit(d, actor(), 'advance_refunded', 'advances', id, `₹${amt} · ${reason}`);
      return { ok: true, refunded: amt, remaining: money(available - amt) };
    } catch (err: any) {
      return fail(`Could not process the refund: ${err?.message || String(err)}`);
    }
  });
}
