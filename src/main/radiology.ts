/**
 * Radiology — its own department, separate from Laboratory.
 *
 * Plain functions over a better-sqlite3 handle (no Electron, no IPC) so the whole
 * behaviour — ordering, billing, reporting — can be exercised against a real database in
 * a test. main/radiology-ipc.ts is the thin layer that exposes these to the app.
 *
 * What a radiology order is:
 *   ordered  → the scan is booked and (usually) billed
 *   done     → the scan has been performed
 *   reported → the radiologist's findings + impression are written and the report is ready
 *   cancelled
 * Unlike a lab order there is no sample step, and the result is free text (findings and an
 * impression), not a value against a reference range.
 *
 * Every order raises its own bill (bill_kind / bill_type = 'radiology', linked by
 * bills.radiology_order_id) with real bill_items rows — so it prints through the standard
 * bill, shows in Billing and Accounts, takes payment through the same path as any bill, and
 * lands in Analytics as its own revenue line.
 *
 * Error policy: every failure throws an Error whose message says what was being attempted
 * and what to do about it. The IPC layer returns that text to the screen unchanged.
 */

import type Database from 'better-sqlite3';
import { nextRadiologyOrderNumber, nextBillNumber } from '../db/ids';
import { clinicalLineTax } from './gst';
import { recalcBill } from './bill-totals';
import {
  RADIOLOGY_CATALOG, RADIOLOGY_KNOWN_PRICES, modalityOf, RADIOLOGY_MODALITIES,
} from '../data/radiology-catalog';
import type { RadiologyStatus } from '../types';

export const RADIOLOGY_STATUSES: RadiologyStatus[] = ['ordered', 'done', 'reported', 'cancelled'];

export interface RadiologyDeps {
  /** Raise an unpaid bill automatically when a priced scan is ordered. */
  autoBill: boolean;
  /** Invoice series prefix from Settings → GST & Invoicing. */
  invoicePrefix: string;
  /** Optional audit trail hook (the IPC layer wires this to the app's audit log). */
  audit?: (action: string, orderId: number, detail: unknown) => void;
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: unknown) => clean(v) || null;
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function listTests(db: Database.Database, activeOnly = true) {
  return db
    .prepare(`SELECT * FROM radiology_tests ${activeOnly ? 'WHERE is_active=1' : ''} ORDER BY name COLLATE NOCASE`)
    .all();
}

export function upsertTest(
  db: Database.Database,
  t: { id?: number; name?: string; modality?: string; price?: number; is_active?: number },
) {
  const name = clean(t.name);
  if (!name) throw new Error('Test name is required — type what the scan is called, e.g. "X-Ray Chest PA View".');
  const modality = (RADIOLOGY_MODALITIES as readonly string[]).includes(String(t.modality))
    ? String(t.modality)
    : modalityOf(name);
  const price = Math.max(0, money(t.price));
  const active = t.is_active === 0 ? 0 : 1;
  try {
    if (t.id) {
      const info = db
        .prepare('UPDATE radiology_tests SET name=?, modality=?, price=?, is_active=? WHERE id=?')
        .run(name, modality, price, active, t.id);
      if (!info.changes) throw new Error(`Radiology test #${t.id} no longer exists — refresh the list.`);
      return db.prepare('SELECT * FROM radiology_tests WHERE id=?').get(t.id);
    }
    const info = db
      .prepare('INSERT INTO radiology_tests (name, modality, price, is_active) VALUES (?, ?, ?, ?)')
      .run(name, modality, price, active);
    return db.prepare('SELECT * FROM radiology_tests WHERE id=?').get(info.lastInsertRowid);
  } catch (e: any) {
    if (/UNIQUE/i.test(e?.message || '')) throw new Error(`A radiology test called “${name}” already exists.`);
    throw e;
  }
}

/** Delete tests; one that was ever ordered is deactivated instead so past bills/reports keep their names. */
export function bulkDeleteTests(db: Database.Database, ids: number[]) {
  let deleted = 0;
  let deactivated = 0;
  const used = db.prepare('SELECT 1 FROM radiology_order_items WHERE test_id=? LIMIT 1');
  const del = db.prepare('DELETE FROM radiology_tests WHERE id=?');
  const off = db.prepare('UPDATE radiology_tests SET is_active=0 WHERE id=?');
  db.transaction(() => {
    for (const id of ids || []) {
      if (used.get(id)) { off.run(id); deactivated++; } else { deleted += del.run(id).changes; }
    }
  })();
  return { deleted, deactivated };
}

export function loadStandardCatalog(db: Database.Database) {
  const ins = db.prepare('INSERT OR IGNORE INTO radiology_tests (name, modality, price, is_active) VALUES (?, ?, ?, 1)');
  let added = 0;
  db.transaction(() => {
    for (const t of RADIOLOGY_CATALOG) {
      added += ins.run(t.name, t.modality, RADIOLOGY_KNOWN_PRICES[t.name.toLowerCase()] ?? 0).changes;
    }
  })();
  return { added, total: RADIOLOGY_CATALOG.length };
}

// ---------------------------------------------------------------------------
// Reading orders
// ---------------------------------------------------------------------------

const ORDER_SELECT = `
  SELECT o.*,
         (p.first_name || ' ' || p.last_name) AS patient_name,
         p.uhid AS patient_uhid, p.dob AS patient_dob, p.gender AS patient_gender, p.phone AS patient_phone,
         d.name AS doctor_name,
         (SELECT group_concat(i.test_name, char(31)) FROM radiology_order_items i WHERE i.order_id = o.id) AS test_names,
         COALESCE((SELECT SUM(i.price) FROM radiology_order_items i WHERE i.order_id = o.id), 0) AS total,
         b.id AS bill_id, b.bill_number AS bill_number, b.total AS bill_total,
         b.amount_paid AS bill_paid, b.status AS bill_status
    FROM radiology_orders o
    JOIN patients p ON p.id = o.patient_id
    LEFT JOIN doctors d ON d.id = o.doctor_id
    LEFT JOIN bills b ON b.radiology_order_id = o.id`;

export interface ListFilter {
  status?: string;
  patient_id?: number;
  window?: string;
  sort?: string;
  q?: string;
  limit?: number;
}

export function listOrders(db: Database.Database, f: ListFilter = {}) {
  const conds: string[] = [];
  const params: any[] = [];
  // 'open' = work still to do (booked or performed, not yet reported / cancelled).
  if (f.status === 'open') conds.push("o.status IN ('ordered','done')");
  else if (f.status) { conds.push('o.status = ?'); params.push(f.status); }
  if (f.patient_id) { conds.push('o.patient_id = ?'); params.push(f.patient_id); }
  const q = clean(f.q);
  if (q) {
    conds.push(`(p.first_name || ' ' || p.last_name LIKE ? OR p.uhid LIKE ? OR p.phone LIKE ? OR o.order_number LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  // Time window on the order date (skipped when looking up one patient's history).
  if (!f.patient_id) {
    const DAYS: Record<string, number> = { today: 1, week: 7, month: 31, quarter: 92 };
    const days = f.window ? DAYS[f.window] : undefined; // 'all' / undefined → no limit
    if (days) conds.push(`date(o.ordered_at, 'localtime') >= date('now', 'localtime', '-${days - 1} days')`);
  }
  const ORDER: Record<string, string> = {
    recent: 'o.ordered_at DESC, o.id DESC',
    name: "lower(p.first_name || ' ' || p.last_name) ASC",
    status: 'o.status ASC, o.ordered_at DESC',
  };
  const orderBy = ORDER[f.sort || ''] || ORDER.recent;
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(f.limit) || 300, 1), 1000);
  return db.prepare(`${ORDER_SELECT} ${where} ORDER BY ${orderBy} LIMIT ${limit}`).all(...params);
}

export function getOrder(db: Database.Database, id: number) {
  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as any;
  if (!order) return null;
  const items = db.prepare('SELECT * FROM radiology_order_items WHERE order_id = ? ORDER BY id').all(id);
  return { ...order, items };
}

function mustGetOrder(db: Database.Database, id: number) {
  const o = getOrder(db, id);
  if (!o) throw new Error(`Radiology order #${id} no longer exists — it may have been deleted. Refresh the list.`);
  return o;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

function radiologyChargeHead(db: Database.Database): number | null {
  const r = db.prepare("SELECT id FROM charge_heads WHERE category='radiology' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  return r ? r.id : null;
}

interface PricedLine { id: number; test_name: string; price: number }

/** Write the bill's real line rows (and the legacy items_json) from the order's priced scans. */
function writeBillLines(db: Database.Database, billId: number, lines: PricedLine[]) {
  const head = radiologyChargeHead(db);
  const tax = clinicalLineTax(db, head);
  db.prepare("DELETE FROM bill_items WHERE bill_id=? AND source='radiology'").run(billId);
  const ins = db.prepare(
    `INSERT INTO bill_items
       (bill_id, charge_head_id, description, qty, rate, amount, is_taxable, gst_rate, hsn_sac, source, source_ref_id)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'radiology', ?)`,
  );
  for (const l of lines) {
    ins.run(billId, head, l.test_name, money(l.price), money(l.price), tax.is_taxable ? 1 : 0, tax.gst_rate, tax.hsn_sac, l.id);
  }
  // Total the bill with the shared engine (discount, tax, round-off) so what is shown and collected never changes on a later look.
  recalcBill(db, billId, { force: true });
  return JSON.stringify(lines.map((l) => ({ description: l.test_name, qty: 1, rate: money(l.price), amount: money(l.price) })));
}

function createBill(db: Database.Database, orderId: number, deps: RadiologyDeps): { id: number; bill_number: string; total: number } | null {
  const o = db.prepare('SELECT * FROM radiology_orders WHERE id=?').get(orderId) as any;
  const lines = (db.prepare('SELECT id, test_name, price FROM radiology_order_items WHERE order_id=? ORDER BY id').all(orderId) as PricedLine[])
    .filter((l) => Number(l.price) > 0);
  if (!lines.length) return null;
  const total = money(lines.reduce((s, l) => s + Number(l.price), 0));
  const billNumber = nextBillNumber(db, deps.invoicePrefix || 'INV');
  const info = db.prepare(
    `INSERT INTO bills
       (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type,
        total, payment_mode, bill_kind, bill_type, amount_paid, notes, radiology_order_id, status)
     VALUES (?, ?, ?, ?, '[]', ?, 0, 'flat', ?, 'Pending', 'radiology', 'radiology', 0, ?, ?, 'unpaid')`,
  ).run(billNumber, o.appointment_id, o.patient_id, o.doctor_id ?? null, total, total, `Radiology order ${o.order_number}`, orderId);
  const billId = Number(info.lastInsertRowid);
  db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(writeBillLines(db, billId, lines), billId);
  return { id: billId, bill_number: billNumber, total: Number((db.prepare('SELECT total FROM bills WHERE id=?').get(billId) as any).total) };
}

/**
 * Bring the order's bill in line with its CURRENT scans (called after a scan is added or
 * removed). Returns a plain-English note so the screen can say exactly what happened to the
 * money. A bill that already took a payment, was cancelled or frozen is a settled record and
 * is never rewritten here — the caller is told it needs a manual adjustment.
 */
export function syncBill(db: Database.Database, orderId: number, deps: RadiologyDeps): { billChanged: boolean; note: string; total?: number } {
  const bill = db.prepare('SELECT * FROM bills WHERE radiology_order_id=?').get(orderId) as any;
  const lines = (db.prepare('SELECT id, test_name, price FROM radiology_order_items WHERE order_id=? ORDER BY id').all(orderId) as PricedLine[])
    .filter((l) => Number(l.price) > 0);
  const total = money(lines.reduce((s, l) => s + Number(l.price), 0));

  if (!bill) {
    if (!lines.length) return { billChanged: false, note: 'No bill — none of these scans has a price set.' };
    if (!deps.autoBill) return { billChanged: false, note: 'No bill raised — auto-billing for radiology is switched off.' };
    const b = createBill(db, orderId, deps);
    return b ? { billChanged: true, total: b.total, note: `Bill ${b.bill_number} raised — ₹${b.total.toFixed(2)}.` } : { billChanged: false, note: 'No bill raised.' };
  }

  const settled = Number(bill.amount_paid) > 0 || !!bill.paid_at || !!bill.cancelled_at || !!bill.finalized_at;
  if (settled) {
    return {
      billChanged: false,
      note: `Bill ${bill.bill_number} is already settled, so it was left untouched. The scan list changed — adjust or re-issue that bill manually.`,
    };
  }
  const itemsJson = writeBillLines(db, bill.id, lines);
  db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(itemsJson, bill.id);
  const newTotal = Number((db.prepare('SELECT total FROM bills WHERE id=?').get(bill.id) as any).total);
  return { billChanged: true, total: newTotal, note: `Bill ${bill.bill_number} updated — now ₹${newTotal.toFixed(2)}.` };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export interface ItemInput { test_id?: number | null; test_name?: string; price?: number | null }

interface ResolvedItem { test_id: number | null; test_name: string; modality: string; price: number }

function resolveItems(db: Database.Database, items: ItemInput[] | undefined): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  const seen = new Set<string>();
  for (const it of items || []) {
    let name = clean(it?.test_name);
    let modality = '';
    let price = it?.price != null && Number(it.price) >= 0 ? money(it.price) : null;
    let testId: number | null = null;
    if (it?.test_id) {
      const t = db.prepare('SELECT id, name, modality, price FROM radiology_tests WHERE id=?').get(it.test_id) as any;
      if (!t) throw new Error(`Radiology test #${it.test_id} is no longer in the catalogue — refresh and pick it again.`);
      testId = t.id; name = name || t.name; modality = t.modality;
      if (price === null) price = money(t.price);
    }
    if (!name) continue;
    if (!modality) modality = modalityOf(name);
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // the same scan twice on one order is a slip, not a request
    seen.add(key);
    out.push({ test_id: testId, test_name: name, modality, price: price ?? 0 });
  }
  return out;
}

export interface CreateOrderInput {
  patient_id: number;
  appointment_id?: number | null;
  doctor_id?: number | null;
  referred_by?: string | null;
  clinical_info?: string | null;
  notes?: string | null;
  items: ItemInput[];
}

export function createOrder(db: Database.Database, p: CreateOrderInput, deps: RadiologyDeps) {
  const patient = db.prepare('SELECT id FROM patients WHERE id=?').get(p.patient_id);
  if (!patient) throw new Error('Pick the patient for this radiology request — that patient was not found.');
  const items = resolveItems(db, p.items);
  if (!items.length) throw new Error('Pick at least one scan or test to order.');

  // The same request sent twice (a double-click, a retry after a lost reply) is ONE order and ONE bill: an identical
  // scan list for the same patient and visit, raised in the last two minutes and not yet started, is the same request.
  {
    const wanted = items.map((i) => i.test_name.trim().toLowerCase()).sort().join('|');
    const recent = db.prepare(
      `SELECT id FROM radiology_orders
        WHERE patient_id = ? AND appointment_id IS ? AND status = 'ordered'
          AND ordered_at >= datetime('now', '-120 seconds')
        ORDER BY id DESC`,
    ).all(p.patient_id, p.appointment_id ?? null) as { id: number }[];
    for (const r of recent) {
      const have = (db.prepare('SELECT test_name FROM radiology_order_items WHERE order_id=?').all(r.id) as { test_name: string }[])
        .map((i) => i.test_name.trim().toLowerCase()).sort().join('|');
      if (have === wanted) return mustGetOrder(db, r.id);
    }
  }

  let orderId = 0;
  db.transaction(() => {
    // A booking can carry who referred the patient and which doctor saw them; a request
    // raised from the appointment inherits both so nobody has to type them twice.
    let referredBy = orNull(p.referred_by);
    let doctorId = p.doctor_id ?? null;
    if (p.appointment_id) {
      const a = db.prepare('SELECT doctor_id, referred_by FROM appointments WHERE id=?').get(p.appointment_id) as any;
      if (a) {
        if (referredBy === null) referredBy = orNull(a.referred_by);
        if (doctorId === null) doctorId = a.doctor_id ?? null;
      }
    }
    const orderNumber = nextRadiologyOrderNumber(db);
    const info = db.prepare(
      `INSERT INTO radiology_orders
         (order_number, appointment_id, patient_id, doctor_id, referred_by, clinical_info, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'ordered', ?)`,
    ).run(orderNumber, p.appointment_id ?? null, p.patient_id, doctorId, referredBy, orNull(p.clinical_info), orNull(p.notes));
    orderId = Number(info.lastInsertRowid);

    const ins = db.prepare(
      'INSERT INTO radiology_order_items (order_id, test_id, test_name, modality, price) VALUES (?, ?, ?, ?, ?)',
    );
    for (const it of items) ins.run(orderId, it.test_id, it.test_name, it.modality, it.price);

    if (deps.autoBill) createBill(db, orderId, deps);
    deps.audit?.('radiology_order_created', orderId, { order_number: orderNumber, tests: items.map((i) => i.test_name) });
  })();
  return mustGetOrder(db, orderId);
}

export function addItems(db: Database.Database, orderId: number, items: ItemInput[], deps: RadiologyDeps) {
  const order = mustGetOrder(db, orderId);
  if (order.status === 'cancelled') throw new Error('This order was cancelled. Raise a new radiology request instead of adding to it.');
  if (order.status === 'reported') throw new Error('A report has already been issued for this order. Raise a new request for the extra scan.');
  const have = new Set((order.items as any[]).map((i) => String(i.test_name).toLowerCase()));
  const fresh = resolveItems(db, items).filter((i) => !have.has(i.test_name.toLowerCase()));
  if (!fresh.length) throw new Error('Pick at least one scan that is not already on this order.');

  let res!: ReturnType<typeof syncBill>;
  db.transaction(() => {
    const ins = db.prepare('INSERT INTO radiology_order_items (order_id, test_id, test_name, modality, price) VALUES (?, ?, ?, ?, ?)');
    for (const it of fresh) ins.run(orderId, it.test_id, it.test_name, it.modality, it.price);
    res = syncBill(db, orderId, deps);
    deps.audit?.('radiology_items_added', orderId, { added: fresh.map((f) => f.test_name), bill: res.note });
  })();
  return { added: fresh.length, ...res, order: mustGetOrder(db, orderId) };
}

export function removeItem(db: Database.Database, orderId: number, itemId: number, deps: RadiologyDeps) {
  const order = mustGetOrder(db, orderId);
  if (order.status === 'cancelled') throw new Error('This order is cancelled.');
  const item = db.prepare('SELECT * FROM radiology_order_items WHERE id=? AND order_id=?').get(itemId, orderId) as any;
  if (!item) throw new Error('That scan is no longer on this order.');
  // A written report is clinical evidence — deleting the line would delete it with it.
  if (clean(item.findings) || clean(item.impression)) {
    throw new Error(`“${item.test_name}” already has a report written, so it cannot be removed. Clear the report text first if it was entered by mistake.`);
  }
  if ((order.items as any[]).length <= 1) throw new Error('An order must keep at least one scan. Cancel the whole order instead.');

  let res!: ReturnType<typeof syncBill>;
  db.transaction(() => {
    db.prepare('DELETE FROM radiology_order_items WHERE id=?').run(itemId);
    res = syncBill(db, orderId, deps);
    deps.audit?.('radiology_item_removed', orderId, { removed: item.test_name, bill: res.note });
  })();
  return { ...res, order: mustGetOrder(db, orderId) };
}

// ---------------------------------------------------------------------------
// Doing the scan and reporting it
// ---------------------------------------------------------------------------

export function updateStatus(db: Database.Database, orderId: number, status: string) {
  if (!RADIOLOGY_STATUSES.includes(status as RadiologyStatus)) {
    throw new Error(`“${status}” is not a radiology status. Use ordered, done, reported or cancelled.`);
  }
  if (status === 'cancelled') throw new Error('Use Cancel order to cancel — it also deals with the bill.');
  const order = mustGetOrder(db, orderId);
  if (order.status === 'cancelled') throw new Error('This order is cancelled and cannot be moved on.');
  const now = nowIso();
  if (status === 'ordered') {
    db.prepare("UPDATE radiology_orders SET status='ordered', performed_at=NULL, reported_at=NULL WHERE id=?").run(orderId);
  } else if (status === 'done') {
    db.prepare("UPDATE radiology_orders SET status='done', performed_at=COALESCE(performed_at, ?), reported_at=NULL WHERE id=?").run(now, orderId);
  } else {
    db.prepare("UPDATE radiology_orders SET status='reported', performed_at=COALESCE(performed_at, ?), reported_at=? WHERE id=?").run(now, now, orderId);
  }
  return mustGetOrder(db, orderId);
}

export interface ReportItemInput { id: number; findings?: string | null; impression?: string | null; is_abnormal?: number }

/**
 * Save the radiologist's words. `finalize` marks the report ready (status → reported, stamps
 * who and when). Saving without it keeps a draft — the status does not move.
 */
export function saveReport(
  db: Database.Database,
  orderId: number,
  items: ReportItemInput[],
  opts: { reportedBy?: string | null; finalize?: boolean },
) {
  const order = mustGetOrder(db, orderId);
  if (order.status === 'cancelled') throw new Error('This order is cancelled — there is nothing to report.');

  db.transaction(() => {
    // Scoped by order id: a stale draft from another patient's order can never overwrite this one,
    // and only the fields actually supplied are written.
    const upd = db.prepare('UPDATE radiology_order_items SET findings=COALESCE(?, findings), impression=COALESCE(?, impression), is_abnormal=COALESCE(?, is_abnormal) WHERE id=? AND order_id=?');
    for (const it of items || []) {
      upd.run(
        it.findings === undefined ? null : (it.findings ?? ''),
        it.impression === undefined ? null : (it.impression ?? ''),
        it.is_abnormal === undefined ? null : (it.is_abnormal ? 1 : 0),
        it.id, orderId,
      );
    }
    if (opts.finalize) {
      const has = (db.prepare(
        "SELECT COUNT(*) AS c FROM radiology_order_items WHERE order_id=? AND (TRIM(COALESCE(findings,''))<>'' OR TRIM(COALESCE(impression,''))<>'')",
      ).get(orderId) as { c: number }).c;
      if (!has) throw new Error('Write the findings or the impression before marking the report ready.');
      const now = nowIso();
      db.prepare(
        "UPDATE radiology_orders SET status='reported', reported_at=?, performed_at=COALESCE(performed_at, ?), reported_by=COALESCE(?, reported_by) WHERE id=?",
      ).run(now, now, orNull(opts.reportedBy), orderId);
    } else if (opts.reportedBy !== undefined && orNull(opts.reportedBy)) {
      db.prepare('UPDATE radiology_orders SET reported_by=? WHERE id=?').run(orNull(opts.reportedBy), orderId);
    }
  })();
  return mustGetOrder(db, orderId);
}

/** Cancel an order that has not been reported. An unpaid bill is cancelled with it; a paid one is left for Billing to refund. */
export function cancelOrder(db: Database.Database, orderId: number, reason: string | null, by: string | null, deps: RadiologyDeps) {
  const order = mustGetOrder(db, orderId);
  if (order.status === 'cancelled') return { note: 'Already cancelled.', order };
  if (order.status === 'reported') throw new Error('A report has already been issued, so this order cannot be cancelled.');

  let note = 'Order cancelled.';
  db.transaction(() => {
    db.prepare("UPDATE radiology_orders SET status='cancelled' WHERE id=?").run(orderId);
    const bill = db.prepare('SELECT * FROM bills WHERE radiology_order_id=?').get(orderId) as any;
    if (bill) {
      const settled = Number(bill.amount_paid) > 0 || !!bill.paid_at || !!bill.finalized_at;
      if (settled) {
        note = `Order cancelled. Bill ${bill.bill_number} had already been paid — refund or adjust it from Billing.`;
      } else if (!bill.cancelled_at) {
        db.prepare("UPDATE bills SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE id=?")
          .run(nowIso(), by, orNull(reason) ?? 'Radiology order cancelled', bill.id);
        note = `Order cancelled and bill ${bill.bill_number} cancelled with it.`;
      }
    }
    deps.audit?.('radiology_order_cancelled', orderId, { reason: orNull(reason), note });
  })();
  return { note, order: mustGetOrder(db, orderId) };
}

// ---------------------------------------------------------------------------
// Cleanup used when a patient / appointment is deleted
// ---------------------------------------------------------------------------

/** Remove radiology orders (and their bills' link) for a patient — called from the patient delete path. */
export function deleteOrdersForPatient(db: Database.Database, patientId: number) {
  db.prepare('UPDATE bills SET radiology_order_id=NULL WHERE radiology_order_id IN (SELECT id FROM radiology_orders WHERE patient_id=?)').run(patientId);
  db.prepare('DELETE FROM radiology_order_items WHERE order_id IN (SELECT id FROM radiology_orders WHERE patient_id=?)').run(patientId);
  db.prepare('DELETE FROM radiology_orders WHERE patient_id=?').run(patientId);
}

export function deleteOrdersForAppointment(db: Database.Database, appointmentId: number) {
  db.prepare('UPDATE bills SET radiology_order_id=NULL WHERE radiology_order_id IN (SELECT id FROM radiology_orders WHERE appointment_id=?)').run(appointmentId);
  db.prepare('DELETE FROM radiology_order_items WHERE order_id IN (SELECT id FROM radiology_orders WHERE appointment_id=?)').run(appointmentId);
  db.prepare('DELETE FROM radiology_orders WHERE appointment_id=?').run(appointmentId);
}
