/**
 * Patient billing portal — one patient, every rupee: what has been billed and paid, what is still to collect,
 * and what could be billed but has not been yet. Also the clinic-wide "receivables" figure Accounts and
 * Analytics show, computed by the SAME rule so the two can never disagree.
 *
 * Plain functions over a better-sqlite3 handle (no Electron, no IPC) so every figure can be tested on a real
 * database. main/billing-portal-ipc.ts exposes them to the app.
 *
 * Money rules (the same ones the rest of the app uses):
 *   - A bill's amount due is total − what was paid. For an in-patient bill the patient's advance deposits also
 *     count as paid: while the stay is running, up to what the bill still needs; after discharge approval, the
 *     amount the approval recorded as adjusted into the bill (bills.advance_adjusted).
 *   - A cancelled bill is shown, but is not revenue and is never "due".
 *   - Counter pharmacy sales (under this patient) are paid at the counter — or, when the clinic allows medicines on
 *     credit, only in part, and the rest is due like any bill. Medicines dispensed on a ward (or charged to the
 *     in-patient bill) are already lines on that bill, so they are NOT listed again here.
 *   - "Can be billed" = something real that has no live bill: a visit without a consultation bill, a lab or
 *     radiology order whose tests have prices but no bill, a prescription not yet dispensed. Nothing is invented.
 */

import type Database from 'better-sqlite3';
import { fromPaise, r2, toPaise } from '../lib/pharmacyMath';
import { raiseLabBill } from './lab-billing';
import type {
  Collections, DailyCollectionRow, OrderBillResult, OutstandingBill, PatientPortal, PortalKind, PortalLine, PortalStatus, PortalTodo,
  DiscountRow, DiscountsGiven, ManualPharmacy, Receivables, UnbilledItem, UnbilledWork,
} from '../lib/billingPortal';
import * as rad from './radiology';

const shorten = (s: string | null | undefined, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const KIND_TITLE: Record<PortalKind, string> = {
  consultation: 'Consultation', lab: 'Laboratory', radiology: 'Radiology', service: 'Service',
  pharmacy: 'Pharmacy (on credit)', pharmacy_manual: 'Pharmacy bill (hand-typed)', ipd: 'In-patient bill',
};

export function kindOfBill(b: { bill_type: string | null; bill_kind: string | null; admission_id: number | null }): PortalKind {
  if (b.admission_id || b.bill_type === 'ipd') return 'ipd';
  switch (b.bill_type) {
    case 'lab': return 'lab';
    case 'radiology': return 'radiology';
    case 'pharmacy': return 'pharmacy_manual';      // a hand-typed pharmacy bill: no stock, cost or profit behind it
    case 'opd_consult': return b.bill_kind === 'misc' ? 'service' : 'consultation';
    default: return 'service';        // misc, custom, anything a clinic invents
  }
}

/** What a bill row needs to be priced: the columns every query below selects. */
interface BillMoneyRow {
  total: number; amount_paid: number; advance_adjusted: number; finalized_at: string | null;
  admission_id: number | null; bill_type: string | null; adv_spare: number;
}

/**
 * SQL for the one number only in-patient bills need: the deposits of this admission that no refund or discharge
 * adjustment has used up. (Standalone bills never carry an admission, so there is exactly one bill per admission.)
 */
export const ADV_SPARE_SQL = `
  CASE WHEN b.admission_id IS NOT NULL
       THEN (SELECT COALESCE(SUM(adv.amount - adv.adjusted_amount - adv.refunded_amount), 0)
               FROM advances adv WHERE adv.admission_id = b.admission_id)
       ELSE 0 END`;

/**
 * One bill's money position, in paise.
 *   advance  — in-patient deposits counted towards this bill
 *   due      — still to collect (never negative)
 *   consumed — deposit the stay has used that discharge approval has not recorded (so it is not also "credit")
 *
 * In-patient: the deposit pays the bill. Discharge approval records how much it used (bills.advance_adjusted); whatever
 * the bill still needs beyond that is met from deposits not yet used or refunded. For a bill approved by this version
 * that second part is always 0 (approval uses up what it can), so it only matters while the stay is running — and for
 * a stay discharged by an older version that never recorded the deposit it used, which would otherwise read as owing
 * the whole deposit.
 */
export function billPosition(r: BillMoneyRow) {
  const totalP = toPaise(r.total);
  const paidP = toPaise(r.amount_paid);
  const inPatient = !!r.admission_id || r.bill_type === 'ipd';
  let advanceP = 0;
  let consumedP = 0;
  if (inPatient) {
    const adjustedP = r.finalized_at ? Math.max(0, toPaise(r.advance_adjusted)) : 0;
    const stillNeedsP = Math.max(0, totalP - paidP - adjustedP);
    consumedP = Math.min(Math.max(0, toPaise(r.adv_spare)), stillNeedsP);
    advanceP = adjustedP + consumedP;
  }
  return { totalP, paidP, advanceP, consumedP, dueP: Math.max(0, totalP - paidP - advanceP) };
}

function statusOf(totalP: number, receivedP: number, cancelled: boolean): PortalStatus {
  if (cancelled) return 'cancelled';
  if (totalP - receivedP <= 0) return 'paid';
  return receivedP > 0 ? 'part_paid' : 'unpaid';
}

export function patientPortal(db: Database.Database, patientId: number): PatientPortal {
  const p = db.prepare(
    `SELECT id, uhid, first_name, last_name, phone, dob, gender, address FROM patients WHERE id = ?`,
  ).get(Number(patientId)) as any;
  if (!p) throw new Error('That patient was not found. Pick the patient again.');

  const history: PortalLine[] = [];
  let consumedAllP = 0;

  // ---- bills (every department, in-patient included) ----
  const bills = db.prepare(`
    SELECT b.id, b.bill_number, b.created_at, b.total, b.amount_paid, b.advance_adjusted, b.payment_mode, b.status, b.cancelled_at,
           b.bill_type, b.bill_kind, b.admission_id, b.is_free_followup, b.is_relaxed_followup, b.finalized_at,
           COALESCE(d1.name, d2.name) AS doctor_name,
           (SELECT group_concat(bi.description, ' · ') FROM bill_items bi WHERE bi.bill_id = b.id) AS lines_text,
           ${ADV_SPARE_SQL} AS adv_spare,
           a.admission_number, a.status AS admission_status
      FROM bills b
      LEFT JOIN doctors d1 ON d1.id = b.doctor_id
      LEFT JOIN appointments ap ON ap.id = b.appointment_id
      LEFT JOIN doctors d2 ON d2.id = ap.doctor_id
      LEFT JOIN ip_admissions a ON a.id = b.admission_id
     WHERE b.patient_id = ?
     ORDER BY b.created_at DESC, b.id DESC
  `).all(p.id) as any[];

  for (const b of bills) {
    const kind = kindOfBill(b);
    const cancelled = b.status === 'cancelled' || !!b.cancelled_at;
    const pos = billPosition(b);
    if (!cancelled) consumedAllP += pos.consumedP;
    const receivedP = pos.paidP + pos.advanceP;
    const free = Number(b.is_free_followup) === 1 || Number(b.is_relaxed_followup) === 1;
    const running = kind === 'ipd' && b.admission_status === 'admitted';
    history.push({
      key: `bill:${b.id}`,
      source: 'bill',
      kind,
      number: b.bill_number,
      date: b.created_at,
      title: kind === 'ipd' && b.admission_number ? `In-patient bill · ${b.admission_number}` : KIND_TITLE[kind],
      detail: [shorten(b.lines_text), free ? 'free follow-up' : '', running ? 'still admitted — charges are still being added' : '']
        .filter(Boolean).join(' · '),
      doctor_name: b.doctor_name ?? null,
      total: fromPaise(pos.totalP),
      paid: fromPaise(pos.paidP),
      advance: fromPaise(pos.advanceP),
      due: cancelled ? 0 : fromPaise(pos.dueP),
      status: statusOf(pos.totalP, receivedP, cancelled),
      payment_mode: b.payment_mode ?? null,
      bill_id: b.id,
      sale_id: null,
      admission_id: b.admission_id ?? null,
      running,
      counter_sale: false,
    });
  }

  // ---- counter pharmacy sales under this patient (ward-dispensed ones are on the in-patient bill) ----
  const sales = db.prepare(`
    SELECT s.id, s.sale_number, s.created_at, s.total, s.payment_mode, s.on_credit, COALESCE(s.amount_paid, s.total) AS received,
           (SELECT group_concat(si.drug_name || ' ×' || si.qty, ' · ') FROM pharmacy_sale_items si WHERE si.sale_id = s.id) AS items
      FROM pharmacy_sales s
     WHERE s.patient_id = ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
     ORDER BY s.created_at DESC, s.id DESC
  `).all(p.id) as any[];
  for (const s of sales) {
    // An ordinary sale is paid at the counter; one made on credit may still owe (all or part of it).
    const saleTotalP = toPaise(s.total);
    const saleReceivedP = Math.min(saleTotalP, Math.max(0, toPaise(s.received)));
    history.push({
      key: `sale:${s.id}`,
      source: 'pharmacy_sale',
      kind: 'pharmacy',
      number: s.sale_number,
      date: s.created_at,
      title: 'Pharmacy',
      detail: [shorten(s.items), s.on_credit ? 'sold on credit' : ''].filter(Boolean).join(' · '),
      doctor_name: null,
      total: fromPaise(saleTotalP),
      paid: fromPaise(saleReceivedP),
      advance: 0,
      due: fromPaise(saleTotalP - saleReceivedP),
      status: statusOf(saleTotalP, saleReceivedP, false),
      payment_mode: s.payment_mode ?? null,
      bill_id: null,
      sale_id: s.id,
      admission_id: null,
      running: false,
      counter_sale: true,
    });
  }
  history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // ---- what can be billed / collected now ----
  const todo: PortalTodo[] = [];

  for (const h of history) {
    if (h.status === 'cancelled' || h.due <= 0) continue;
    const have = fromPaise(toPaise(h.paid) + toPaise(h.advance));
    todo.push({
      key: `due:${h.key}`, kind: h.running ? 'ipd_running' : 'bill_due',
      title: h.running ? `${h.title} — running` : `${h.title} · ${h.number}`,
      detail: h.running
        ? `Bill so far ${h.total.toFixed(2)}, received ${have.toFixed(2)}${h.advance > 0 ? ' (advance counted)' : ''}`
        : `${h.status === 'part_paid' ? 'Part-paid' : 'Not paid yet'} — billed ${h.total.toFixed(2)}, received ${have.toFixed(2)}`,
      date: h.date, date_is_local: false, amount: null, due: h.due,
      appointment_id: null, order_id: null, bill_id: h.bill_id, sale_id: h.sale_id, admission_id: h.admission_id,
    });
  }

  // A visit with no consultation bill. (A Quick-Bill consultation is not linked to a visit, so one raised for this
  // patient on the same day also counts — otherwise the portal would tell the desk to bill a visit twice.)
  const unbilledVisits = db.prepare(`
    SELECT a.id, a.appointment_date, a.appointment_time, a.token_number, a.status, d.name AS doctor_name, d.default_fee
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id
     WHERE a.patient_id = ? AND a.status <> 'Cancelled'
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.appointment_id = a.id AND b.bill_type = 'opd_consult'
                         AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM bills b2 WHERE b2.patient_id = a.patient_id AND b2.appointment_id IS NULL AND b2.bill_type = 'opd_consult'
                         AND COALESCE(b2.status, '') <> 'cancelled' AND b2.cancelled_at IS NULL
                         AND date(b2.created_at, 'localtime') = a.appointment_date)
       AND (a.status = 'Send to Billing' OR a.appointment_date >= date('now', 'localtime', '-60 days'))
     ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 20
  `).all(p.id) as any[];
  for (const v of unbilledVisits) {
    todo.push({
      key: `visit:${v.id}`, kind: 'consultation_unbilled',
      title: `Consultation not billed — ${v.doctor_name}`,
      detail: `Token #${v.token_number}${v.appointment_time ? ` · ${v.appointment_time}` : ''} · ${v.status}`,
      date: v.appointment_date, date_is_local: true, amount: r2(v.default_fee), due: null,
      appointment_id: v.id, order_id: null, bill_id: null, sale_id: null, admission_id: null,
    });
  }

  const labOrders = db.prepare(`
    SELECT o.id, o.order_number, o.ordered_at,
           (SELECT group_concat(i.test_name, ' · ') FROM lab_order_items i WHERE i.lab_order_id = o.id) AS tests,
           COALESCE((SELECT SUM(t.price) FROM lab_order_items i JOIN lab_tests t ON t.id = i.lab_test_id WHERE i.lab_order_id = o.id), 0) AS price
      FROM lab_orders o
     WHERE o.patient_id = ? AND o.status <> 'cancelled'
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.lab_order_id = o.id AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
     ORDER BY o.ordered_at DESC LIMIT 20
  `).all(p.id) as any[];
  for (const o of labOrders) {
    if (!(Number(o.price) > 0)) continue;            // an order whose tests have no price has nothing to charge
    todo.push({
      key: `lab:${o.id}`, kind: 'lab_unbilled', title: `Lab order ${o.order_number} not billed`, detail: shorten(o.tests),
      date: o.ordered_at, date_is_local: false, amount: r2(o.price), due: null,
      appointment_id: null, order_id: o.id, bill_id: null, sale_id: null, admission_id: null,
    });
  }

  const radOrders = db.prepare(`
    SELECT o.id, o.order_number, o.ordered_at,
           (SELECT group_concat(i.test_name, ' · ') FROM radiology_order_items i WHERE i.order_id = o.id) AS tests,
           COALESCE((SELECT SUM(i.price) FROM radiology_order_items i WHERE i.order_id = o.id), 0) AS price
      FROM radiology_orders o
     WHERE o.patient_id = ? AND o.status <> 'cancelled'
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.radiology_order_id = o.id AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
     ORDER BY o.ordered_at DESC LIMIT 20
  `).all(p.id) as any[];
  for (const o of radOrders) {
    if (!(Number(o.price) > 0)) continue;
    todo.push({
      key: `rad:${o.id}`, kind: 'radiology_unbilled', title: `Radiology order ${o.order_number} not billed`, detail: shorten(o.tests),
      date: o.ordered_at, date_is_local: false, amount: r2(o.price), due: null,
      appointment_id: null, order_id: o.id, bill_id: null, sale_id: null, admission_id: null,
    });
  }

  // A prescription not yet dispensed (same 7-day window the pharmacy's own "pending prescriptions" list uses).
  const rx = db.prepare(`
    SELECT a.id, a.appointment_date, d.name AS doctor_name,
           (SELECT COUNT(*) FROM prescription_items WHERE appointment_id = a.id) AS rx_count
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id
     WHERE a.patient_id = ?
       AND a.id IN (SELECT DISTINCT appointment_id FROM prescription_items)
       AND a.id NOT IN (SELECT COALESCE(appointment_id, 0) FROM pharmacy_sales)
       AND a.appointment_date >= date('now', 'localtime', '-7 days')
     ORDER BY a.appointment_date DESC LIMIT 10
  `).all(p.id) as any[];
  for (const r of rx) {
    todo.push({
      key: `rx:${r.id}`, kind: 'rx_pending', title: `Prescription not dispensed — ${r.doctor_name}`,
      detail: `${r.rx_count} medicine${r.rx_count === 1 ? '' : 's'} prescribed; sell them from the Pharmacy counter`,
      date: r.appointment_date, date_is_local: true, amount: null, due: null,
      appointment_id: r.id, order_id: null, bill_id: null, sale_id: null, admission_id: null,
    });
  }

  // ---- totals (cancelled bills are not money) ----
  const live = history.filter((h) => h.status !== 'cancelled');
  const sum = (f: (h: PortalLine) => number) => fromPaise(live.reduce((a, h) => a + toPaise(f(h)), 0));
  // Deposits not yet used up by a refund or a discharge adjustment, less what a still-running bill is using right now.
  const held = db.prepare(
    `SELECT COALESCE(SUM(amount - adjusted_amount - refunded_amount), 0) AS c FROM advances WHERE patient_id = ?`,
  ).get(p.id) as { c: number };
  const creditP = Math.max(0, toPaise(held.c) - consumedAllP);

  return {
    patient: {
      id: p.id, uhid: p.uhid, name: `${p.first_name} ${p.last_name}`.trim(), phone: p.phone ?? null,
      dob: p.dob ?? null, gender: p.gender ?? null, address: p.address ?? null,
    },
    summary: {
      billed: sum((h) => h.total),
      received: sum((h) => h.paid + h.advance),
      outstanding: sum((h) => h.due),
      credit_held: fromPaise(creditP),
      bills: live.filter((h) => h.source === 'bill').length,
      pharmacy_sales: live.filter((h) => h.source === 'pharmacy_sale').length,
      to_bill_count: todo.filter((t) => t.kind !== 'bill_due' && t.kind !== 'ipd_running').length,
    },
    todo,
    history,
  };
}

// ---------------------------------------------------------------------------------------------
// Billing an order that has no bill
// ---------------------------------------------------------------------------------------------

/**
 * Raise the bill for a lab or radiology order that has none (auto-billing switched off, or the order predates it).
 * Linked to the order, so it leaves the "can be billed" list and reprices with the order like any other order bill.
 *
 * Quick Bill raises lab/radiology bills that are not linked to an order. If this patient already has such a bill
 * around the order's date the desk is asked to confirm first, so the same tests are not charged twice.
 */
export function billOrder(
  db: Database.Database,
  kind: 'lab' | 'radiology',
  orderId: number,
  opts: { force?: boolean; invoicePrefix?: string } = {},
): OrderBillResult {
  try {
    const table = kind === 'lab' ? 'lab_orders' : 'radiology_orders';
    const link = kind === 'lab' ? 'lab_order_id' : 'radiology_order_id';
    const o = db.prepare(`SELECT id, order_number, patient_id, status, ordered_at FROM ${table} WHERE id = ?`).get(Number(orderId)) as any;
    if (!o) return { ok: false, error: 'That order no longer exists — refresh the screen.' };
    if (o.status === 'cancelled') return { ok: false, error: `Order ${o.order_number} was cancelled, so there is nothing to bill.` };
    const have = db.prepare(
      `SELECT bill_number FROM bills WHERE ${link} = ? AND COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL`,
    ).get(o.id) as { bill_number: string } | undefined;
    if (have) return { ok: false, error: `Order ${o.order_number} is already billed (${have.bill_number}).` };

    // Nothing to charge? Say so first — a hand-made bill nearby is beside the point then.
    const priced = kind === 'lab'
      ? db.prepare('SELECT COUNT(*) AS c FROM lab_order_items i JOIN lab_tests t ON t.id = i.lab_test_id WHERE i.lab_order_id = ? AND t.price > 0').get(o.id) as { c: number }
      : db.prepare('SELECT COUNT(*) AS c FROM radiology_order_items WHERE order_id = ? AND price > 0').get(o.id) as { c: number };
    if (!priced.c) {
      return kind === 'lab'
        ? { ok: false, error: `None of the tests on ${o.order_number} has a price. Set prices in Laboratory → Tests, or use Quick Bill to charge by hand.` }
        : { ok: false, error: `None of the scans on ${o.order_number} has a price. Set prices in Radiology → Tests, or use Quick Bill to charge by hand.` };
    }

    if (!opts.force) {
      const near = db.prepare(
        `SELECT bill_number, total FROM bills
          WHERE patient_id = ? AND bill_type = ? AND ${link} IS NULL
            AND COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL
            AND date(created_at, 'localtime') BETWEEN date(?, 'localtime', '-1 day') AND date(?, 'localtime', '+1 day')
          ORDER BY id DESC LIMIT 1`,
      ).get(o.patient_id, kind, o.ordered_at, o.ordered_at) as { bill_number: string; total: number } | undefined;
      if (near) {
        return {
          ok: false, needs_confirm: true,
          error: `${near.bill_number} (₹${Number(near.total).toFixed(2)}) is already a ${kind === 'lab' ? 'lab' : 'radiology'} bill for this patient around that date, raised by hand. ` +
            `If it covers these tests, do not bill again.`,
        };
      }
    }

    if (kind === 'lab') {
      const b = raiseLabBill(db, o.id);
      return { ok: true, bill_id: b.id, bill_number: b.bill_number, total: b.total };
    }
    db.transaction(() => rad.syncBill(db, o.id, { autoBill: true, invoicePrefix: opts.invoicePrefix || 'INV' }))();
    const bill = db.prepare('SELECT id, bill_number, total FROM bills WHERE radiology_order_id = ? ORDER BY id DESC').get(o.id) as any;
    if (!bill) return { ok: false, error: 'The bill could not be raised. Try again, or use Quick Bill.' };
    return { ok: true, bill_id: bill.id, bill_number: bill.bill_number, total: r2(bill.total) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not raise the bill.' };
  }
}

// ---------------------------------------------------------------------------------------------
// Receivables — money still to collect, across every patient
// ---------------------------------------------------------------------------------------------

/** Every bill that still has money to collect, oldest first — one rule (`billPosition`) for every screen and report. */
export function outstandingBills(db: Database.Database): OutstandingBill[] {
  const rows = db.prepare(`
    SELECT b.id, b.bill_number, b.patient_id, b.bill_type, b.bill_kind, b.admission_id, b.total, b.amount_paid, b.advance_adjusted,
           b.finalized_at, b.created_at, b.notes, (p.first_name || ' ' || p.last_name) AS name, p.uhid,
           ${ADV_SPARE_SQL} AS adv_spare,
           CAST(julianday(date('now', 'localtime')) - julianday(date(b.created_at, 'localtime')) AS INTEGER) AS age_days
      FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
     WHERE COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL
       -- Only a bill that can owe something is read: an in-patient bill (its advance is worked out below) or one whose
       -- payments fall short of its total. Almost every bill in a busy clinic is fully paid, so this keeps the scan small.
       AND (b.admission_id IS NOT NULL OR b.bill_type = 'ipd' OR b.total - b.amount_paid > 0.004)
  `).all() as any[];
  const out: OutstandingBill[] = [];
  for (const r of rows) {
    const pos = billPosition(r);
    if (pos.dueP <= 0) continue;
    // A walk-in bill has no patient: the name typed for it is in the notes ("Name: …").
    const typed = !r.patient_id && typeof r.notes === 'string' && r.notes.startsWith('Name: ') ? r.notes.slice(6).trim() : null;
    out.push({
      source: 'bill', bill_id: r.id, sale_id: null, bill_number: r.bill_number, patient_id: r.patient_id ?? null,
      name: r.name?.trim() || typed || 'Walk-in', uhid: r.uhid ?? null, kind: kindOfBill(r), created_at: r.created_at,
      total: fromPaise(pos.totalP), paid: fromPaise(pos.paidP), advance: fromPaise(pos.advanceP), due: fromPaise(pos.dueP),
      age_days: Math.max(0, Number(r.age_days) || 0),
    });
  }

  // Medicines sold on credit that still owe money. (An ordinary sale is paid at the counter, and one charged on an
  // in-patient bill is part of that bill — neither can owe anything here.)
  const credit = db.prepare(`
    SELECT s.id, s.sale_number, s.patient_id, s.created_at, s.total, COALESCE(s.amount_paid, s.total) AS received,
           (p.first_name || ' ' || p.last_name) AS name, p.uhid,
           CAST(julianday(date('now', 'localtime')) - julianday(date(s.created_at, 'localtime')) AS INTEGER) AS age_days
      FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id
     WHERE s.on_credit = 1 AND COALESCE(s.payment_mode, '') <> 'IPD-bill' AND s.total - COALESCE(s.amount_paid, s.total) > 0.004
  `).all() as any[];
  for (const r of credit) {
    const totalP = toPaise(r.total), paidP = Math.min(totalP, toPaise(r.received));
    if (totalP - paidP <= 0) continue;
    out.push({
      source: 'pharmacy_sale', bill_id: 0, sale_id: r.id, bill_number: r.sale_number, patient_id: r.patient_id ?? null,
      name: r.name?.trim() || 'Walk-in', uhid: r.uhid ?? null, kind: 'pharmacy', created_at: r.created_at,
      total: fromPaise(totalP), paid: fromPaise(paidP), advance: 0, due: fromPaise(totalP - paidP),
      age_days: Math.max(0, Number(r.age_days) || 0),
    });
  }
  // Oldest first (sorted here, not in SQL: an ORDER BY on the date makes SQLite walk the whole table by that index).
  return out.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.bill_id - b.bill_id) || ((a.sale_id ?? 0) - (b.sale_id ?? 0))));
}

export function receivables(db: Database.Database, opts: { limit?: number } = {}): Receivables {
  const bucket = [
    { label: '0–7 days', max: 7, bills: 0, dueP: 0 },
    { label: '8–30 days', max: 30, bills: 0, dueP: 0 },
    { label: '31–90 days', max: 90, bills: 0, dueP: 0 },
    { label: 'Over 90 days', max: Infinity, bills: 0, dueP: 0 },
  ];
  const byKind = new Map<PortalKind, { bills: number; dueP: number }>();
  const byPatient = new Map<string, { patient_id: number | null; name: string; uhid: string | null; bills: number; dueP: number; oldest: number }>();
  let totalP = 0;
  const list = outstandingBills(db);
  for (const r of list) {
    const dueP = toPaise(r.due);
    totalP += dueP;
    const k = byKind.get(r.kind) ?? { bills: 0, dueP: 0 }; k.bills++; k.dueP += dueP; byKind.set(r.kind, k);
    const key = r.patient_id ? String(r.patient_id) : `name:${r.name}`;
    const pt = byPatient.get(key) ?? { patient_id: r.patient_id, name: r.name, uhid: r.uhid, bills: 0, dueP: 0, oldest: 0 };
    pt.bills++; pt.dueP += dueP; pt.oldest = Math.max(pt.oldest, r.age_days); byPatient.set(key, pt);
    const b = bucket.find((x) => r.age_days <= x.max)!; b.bills++; b.dueP += dueP;
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 200);
  return {
    total_due: fromPaise(totalP),
    bills_due: list.length,
    patients_due: byPatient.size,
    by_kind: [...byKind.entries()].map(([kind, v]) => ({ kind, label: KIND_TITLE[kind], bills: v.bills, due: fromPaise(v.dueP) }))
      .sort((a, b) => b.due - a.due),
    by_patient: [...byPatient.values()].sort((a, b) => b.dueP - a.dueP).slice(0, limit)
      .map((v) => ({ patient_id: v.patient_id, name: v.name, uhid: v.uhid, bills: v.bills, due: fromPaise(v.dueP), oldest_days: v.oldest })),
    aging: bucket.map((b) => ({ label: b.label, bills: b.bills, due: fromPaise(b.dueP) })),
  };
}

/** Clinic-wide money still to collect — the figure Accounts shows as "Outstanding". Same rule as `receivables`. */
export function outstandingTotal(db: Database.Database): number {
  return fromPaise(outstandingBills(db).reduce((a, r) => a + toPaise(r.due), 0));
}

// ---------------------------------------------------------------------------------------------
// Collections — money received in a period, from every way the app takes it
// ---------------------------------------------------------------------------------------------

/**
 * UTC bounds that surely contain every moment whose LOCAL calendar day is in [from, to] (no time zone is more than
 * 14 hours from UTC). Stored timestamps are UTC, so an index on the column can narrow a scan to these bounds before the
 * exact local-day test (`date(col, 'localtime') BETWEEN …`) runs — the bounds only prune, they never decide.
 */
export function utcSlack(from: string, to: string): { lo: string; hi: string } {
  const shift = (iso: string, days: number): string | null => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.toISOString().slice(0, 10)} 00:00:00`;
  };
  return { lo: shift(from, -1) ?? '0000-01-01 00:00:00', hi: shift(to, 2) ?? '9999-12-31 00:00:00' };
}

/**
 * Everything received between two local calendar days.
 *
 * The app records payment in two ways: a payment row (`bill_payments`, written when a payment is taken against a
 * bill) and, for a bill paid in full when it is raised, just `bills.amount_paid` with no row. Counting only the rows
 * left every counter-paid bill and every pharmacy sale out of "collected". Each rupee is counted once here: a bill's
 * rows are counted on the day received, and only the part of `amount_paid` that has no row is counted on the bill's day.
 */
export function collections(db: Database.Database, from: string, to: string): Collections {
  from = String(from ?? ''); to = String(to ?? '');          // a missing date matches nothing; it must not be a raw database error
  const slack = utcSlack(from, to);
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'Unspecified') AS mode, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
       FROM bill_payments WHERE received_at >= ? AND received_at < ? AND date(received_at, 'localtime') BETWEEN ? AND ? GROUP BY mode`,
  ).all(slack.lo, slack.hi, from, to) as { mode: string; n: number; amt: number }[];
  const atBilling = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'Unspecified') AS mode, COUNT(*) AS n, COALESCE(SUM(rem), 0) AS amt FROM (
       SELECT b.payment_mode, b.amount_paid - COALESCE(p.s, 0) AS rem
         FROM bills b LEFT JOIN (SELECT bill_id, SUM(amount) AS s FROM bill_payments GROUP BY bill_id) p ON p.bill_id = b.id
        WHERE b.created_at >= ? AND b.created_at < ?
          AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL
          AND date(b.created_at, 'localtime') BETWEEN ? AND ?
     ) WHERE rem > 0.004 GROUP BY mode`,
  ).all(slack.lo, slack.hi, from, to) as { mode: string; n: number; amt: number }[];
  // Pharmacy: what was taken when the sale was made (an ordinary sale: all of it; on credit: only what was paid then) …
  const pharm = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'Unspecified') AS mode, COUNT(*) AS n, COALESCE(SUM(rem), 0) AS amt FROM (
       SELECT s.payment_mode, COALESCE(s.amount_paid, s.total) - COALESCE(p.s, 0) AS rem
         FROM pharmacy_sales s LEFT JOIN (SELECT sale_id, SUM(amount) AS s FROM pharmacy_sale_payments GROUP BY sale_id) p ON p.sale_id = s.id
        WHERE s.created_at >= ? AND s.created_at < ? AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
          AND date(s.created_at, 'localtime') BETWEEN ? AND ?
     ) WHERE rem > 0.004 GROUP BY mode`,
  ).all(slack.lo, slack.hi, from, to) as { mode: string; n: number; amt: number }[];
  // … and what was paid later against a sale made on credit, on the day it was paid.
  const pharmLater = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'Unspecified') AS mode, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
       FROM pharmacy_sale_payments WHERE received_at >= ? AND received_at < ? AND date(received_at, 'localtime') BETWEEN ? AND ? GROUP BY mode`,
  ).all(slack.lo, slack.hi, from, to) as { mode: string; n: number; amt: number }[];

  const merged = new Map<string, { n: number; p: number }>();
  const add = (list: { mode: string; n: number; amt: number }[]) => {
    for (const r of list) {
      const m = merged.get(r.mode) ?? { n: 0, p: 0 };
      m.n += r.n; m.p += toPaise(r.amt); merged.set(r.mode, m);
    }
  };
  add(rows); add(atBilling); add(pharm); add(pharmLater);
  const sumP = (list: { amt: number }[]) => list.reduce((a, r) => a + toPaise(r.amt), 0);
  const by_mode = [...merged.entries()]
    .map(([payment_mode, v]) => ({ payment_mode, count: v.n, total: fromPaise(v.p) }))
    .sort((a, b) => b.total - a.total);
  return {
    by_mode,
    total: fromPaise(by_mode.reduce((a, m) => a + toPaise(m.total), 0)),
    by_source: {
      bill_payments: fromPaise(sumP(rows)),
      paid_at_billing: fromPaise(sumP(atBilling)),
      pharmacy_counter: fromPaise(sumP(pharm)),
      pharmacy_credit_payments: fromPaise(sumP(pharmLater)),
    },
  };
}

/**
 * Day-by-day collection for the Reports page. The original columns (bills, revenue, cash, card, upi) keep their
 * meaning; `pharmacy_sales`, `pharmacy` and `received` are added so the report no longer leaves the pharmacy counter
 * out, and so "received" counts payments taken later against a bill on the day they were taken.
 */
export function dailyCollection(db: Database.Database, from?: string, to?: string): DailyCollectionRow[] {
  // The exact test is the local-day one; the UTC bounds in front of it only let the index skip rows far outside the range.
  const slack = utcSlack(from ?? '', to ?? '');
  const range = (col: string) => {
    const conds: string[] = []; const params: string[] = [];
    if (from) { conds.push(`${col} >= ?`); params.push(slack.lo); conds.push(`date(${col}, 'localtime') >= ?`); params.push(from); }
    if (to) { conds.push(`${col} < ?`); params.push(slack.hi); conds.push(`date(${col}, 'localtime') <= ?`); params.push(to); }
    return { and: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
  };
  type Acc = { bills: number; revenueP: number; cashP: number; cardP: number; upiP: number; phN: number; phP: number; recP: number };
  const days = new Map<string, Acc>();
  const at = (day: string): Acc => {
    let a = days.get(day);
    if (!a) { a = { bills: 0, revenueP: 0, cashP: 0, cardP: 0, upiP: 0, phN: 0, phP: 0, recP: 0 }; days.set(day, a); }
    return a;
  };

  const b = range('b.created_at');
  const billRows = db.prepare(
    `SELECT date(b.created_at, 'localtime') AS day, COUNT(*) AS n, COALESCE(SUM(b.total), 0) AS revenue,
            COALESCE(SUM(CASE WHEN b.payment_mode = 'Cash' THEN b.total ELSE 0 END), 0) AS cash,
            COALESCE(SUM(CASE WHEN b.payment_mode = 'Card' THEN b.total ELSE 0 END), 0) AS card,
            COALESCE(SUM(CASE WHEN b.payment_mode = 'UPI' THEN b.total ELSE 0 END), 0) AS upi
       FROM bills b WHERE COALESCE(b.status, '') <> 'cancelled'${b.and} GROUP BY day`,
  ).all(...b.params) as any[];
  for (const r of billRows) {
    const a = at(r.day); a.bills += r.n; a.revenueP += toPaise(r.revenue); a.cashP += toPaise(r.cash); a.cardP += toPaise(r.card); a.upiP += toPaise(r.upi);
  }

  // Pharmacy: `pharmacy` is what was sold that day; what was RECEIVED is what was taken when the sale was made (all of
  // it for an ordinary sale, only what was paid then for one on credit) …
  const s = range('s.created_at');
  const pharmRows = db.prepare(
    `SELECT date(s.created_at, 'localtime') AS day, COUNT(*) AS n, COALESCE(SUM(s.total), 0) AS t,
            COALESCE(SUM(MAX(COALESCE(s.amount_paid, s.total) - COALESCE(pp.s, 0), 0)), 0) AS at_sale
       FROM pharmacy_sales s LEFT JOIN (SELECT sale_id, SUM(amount) AS s FROM pharmacy_sale_payments GROUP BY sale_id) pp ON pp.sale_id = s.id
      WHERE COALESCE(s.payment_mode, '') <> 'IPD-bill'${s.and} GROUP BY day`,
  ).all(...s.params) as any[];
  for (const r of pharmRows) { const a = at(r.day); a.phN += r.n; a.phP += toPaise(r.t); a.recP += toPaise(r.at_sale); }
  // … plus payments taken later against sales made on credit, on the day each was taken.
  const sp = range('received_at');
  const pharmLater = db.prepare(
    `SELECT date(received_at, 'localtime') AS day, COALESCE(SUM(amount), 0) AS t FROM pharmacy_sale_payments WHERE 1=1${sp.and} GROUP BY day`,
  ).all(...sp.params) as any[];
  for (const r of pharmLater) at(r.day).recP += toPaise(r.t);

  const p = range('received_at');
  const payRows = db.prepare(
    `SELECT date(received_at, 'localtime') AS day, COALESCE(SUM(amount), 0) AS t FROM bill_payments WHERE 1=1${p.and} GROUP BY day`,
  ).all(...p.params) as any[];
  for (const r of payRows) at(r.day).recP += toPaise(r.t);

  const c = range('b.created_at');
  const atBilling = db.prepare(
    `SELECT day, COALESCE(SUM(rem), 0) AS t FROM (
       SELECT date(b.created_at, 'localtime') AS day, b.amount_paid - COALESCE(p.s, 0) AS rem
         FROM bills b LEFT JOIN (SELECT bill_id, SUM(amount) AS s FROM bill_payments GROUP BY bill_id) p ON p.bill_id = b.id
        WHERE COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL${c.and}
     ) WHERE rem > 0.004 GROUP BY day`,
  ).all(...c.params) as any[];
  for (const r of atBilling) at(r.day).recP += toPaise(r.t);

  return [...days.entries()]
    .sort((x, y) => (x[0] < y[0] ? 1 : x[0] > y[0] ? -1 : 0))
    .map(([day, a]) => ({
      day, bills: a.bills, revenue: fromPaise(a.revenueP), cash: fromPaise(a.cashP), card: fromPaise(a.cardP), upi: fromPaise(a.upiP),
      pharmacy_sales: a.phN, pharmacy: fromPaise(a.phP), received: fromPaise(a.recP),
    }));
}

// ---------------------------------------------------------------------------------------------
// Work with no bill — the clinic-wide version of the portal's "can be billed" list
// ---------------------------------------------------------------------------------------------

/**
 * Lab orders and scans with priced tests but no live bill, and recent visits with no consultation bill — what the
 * clinic could still charge for. Same tests the patient portal applies (a Quick-Bill consultation on the same day
 * counts as billing the visit; an order whose tests have no price has nothing to charge), over the last `days` days.
 */
export function unbilledWork(db: Database.Database, opts: { days?: number; limit?: number } = {}): UnbilledWork {
  const days = Math.min(Math.max(Math.floor(Number(opts.days) || 60), 1), 3650);
  const limit = Math.min(Math.max(Math.floor(Number(opts.limit) || 25), 1), 200);
  const since = `-${days} days`;
  const items: UnbilledItem[] = [];

  const lab = db.prepare(`
    SELECT o.id, o.patient_id, o.order_number, o.ordered_at, (p.first_name || ' ' || p.last_name) AS name, p.uhid,
           (SELECT group_concat(i.test_name, ' · ') FROM lab_order_items i WHERE i.lab_order_id = o.id) AS tests,
           COALESCE((SELECT SUM(t.price) FROM lab_order_items i JOIN lab_tests t ON t.id = i.lab_test_id WHERE i.lab_order_id = o.id), 0) AS price
      FROM lab_orders o JOIN patients p ON p.id = o.patient_id
     WHERE o.status <> 'cancelled' AND date(o.ordered_at, 'localtime') >= date('now', 'localtime', ?)
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.lab_order_id = o.id AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
  `).all(since) as any[];
  let labP = 0, labN = 0;
  for (const o of lab) {
    if (!(Number(o.price) > 0)) continue;
    labN++; labP += toPaise(o.price);
    items.push({ kind: 'lab', patient_id: o.patient_id, name: o.name, uhid: o.uhid, title: `Lab ${o.order_number} · ${shorten(o.tests, 80)}`, date: o.ordered_at, date_is_local: false, amount: r2(o.price) });
  }

  const rad = db.prepare(`
    SELECT o.id, o.patient_id, o.order_number, o.ordered_at, (p.first_name || ' ' || p.last_name) AS name, p.uhid,
           (SELECT group_concat(i.test_name, ' · ') FROM radiology_order_items i WHERE i.order_id = o.id) AS tests,
           COALESCE((SELECT SUM(i.price) FROM radiology_order_items i WHERE i.order_id = o.id), 0) AS price
      FROM radiology_orders o JOIN patients p ON p.id = o.patient_id
     WHERE o.status <> 'cancelled' AND date(o.ordered_at, 'localtime') >= date('now', 'localtime', ?)
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.radiology_order_id = o.id AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
  `).all(since) as any[];
  let radP = 0, radN = 0;
  for (const o of rad) {
    if (!(Number(o.price) > 0)) continue;
    radN++; radP += toPaise(o.price);
    items.push({ kind: 'radiology', patient_id: o.patient_id, name: o.name, uhid: o.uhid, title: `Radiology ${o.order_number} · ${shorten(o.tests, 80)}`, date: o.ordered_at, date_is_local: false, amount: r2(o.price) });
  }

  const visits = db.prepare(`
    SELECT a.id, a.patient_id, a.appointment_date, a.token_number, (p.first_name || ' ' || p.last_name) AS name, p.uhid,
           d.name AS doctor_name, d.default_fee
      FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
     WHERE a.status <> 'Cancelled' AND a.appointment_date >= date('now', 'localtime', ?) AND a.appointment_date <= date('now', 'localtime')
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.appointment_id = a.id AND b.bill_type = 'opd_consult'
                         AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM bills b2 WHERE b2.patient_id = a.patient_id AND b2.appointment_id IS NULL AND b2.bill_type = 'opd_consult'
                         AND COALESCE(b2.status, '') <> 'cancelled' AND b2.cancelled_at IS NULL
                         AND date(b2.created_at, 'localtime') = a.appointment_date)
  `).all(since) as any[];
  let visP = 0;
  for (const v of visits) {
    visP += toPaise(v.default_fee);
    items.push({ kind: 'visit', patient_id: v.patient_id, name: v.name, uhid: v.uhid, title: `Visit with ${v.doctor_name} · token #${v.token_number}`, date: v.appointment_date, date_is_local: true, amount: r2(v.default_fee) });
  }

  // Biggest first; for equal amounts the older one.
  items.sort((a, b) => (b.amount - a.amount) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    days,
    lab: { orders: labN, value: fromPaise(labP) },
    radiology: { orders: radN, value: fromPaise(radP) },
    visits: { count: visits.length, value: fromPaise(visP) },
    total_value: fromPaise(labP + radP + visP),
    items: items.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------------------------
// Discounts — who was given how much off
// ---------------------------------------------------------------------------------------------

/** Value of a bill's discount: a percentage is taken of the subtotal; a flat amount is capped at the subtotal. */
function discountValueP(subtotal: number, discount: number, type: string | null): number {
  const subP = toPaise(subtotal);
  const dP = type === 'percent' ? Math.round((subP * (Number(discount) || 0)) / 100) : toPaise(discount);
  return Math.max(0, Math.min(dP, subP));
}

/**
 * Discounts given between two local calendar days (cancelled bills left out; ward-dispensed medicines are discounted on
 * the in-patient bill, not as a sale). The largest are listed with the reason and who gave them, where recorded.
 */
export function discountsGiven(db: Database.Database, from: string, to: string, limit = 10): DiscountsGiven {
  from = String(from ?? ''); to = String(to ?? '');          // a missing date matches nothing; it must not be a raw database error
  const slack = utcSlack(from, to);
  const bills = db.prepare(`
    SELECT b.bill_number, b.created_at, b.subtotal, b.discount, b.discount_type, b.discount_reason, b.discount_by,
           COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''), CASE WHEN b.notes LIKE 'Name: %' THEN substr(b.notes, 7) END, 'Walk-in') AS patient, p.uhid
      FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
     WHERE COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL AND b.discount > 0
       AND b.created_at >= ? AND b.created_at < ? AND date(b.created_at, 'localtime') BETWEEN ? AND ?
  `).all(slack.lo, slack.hi, from, to) as any[];
  const sales = db.prepare(`
    SELECT s.sale_number, s.created_at, s.subtotal, s.discount, s.sold_by,
           COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''), s.customer_name, 'Walk-in') AS patient, p.uhid
      FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id
     WHERE s.discount > 0 AND COALESCE(s.payment_mode, '') <> 'IPD-bill'
       AND s.created_at >= ? AND s.created_at < ? AND date(s.created_at, 'localtime') BETWEEN ? AND ?
  `).all(slack.lo, slack.hi, from, to) as any[];

  const rows: DiscountRow[] = [];
  let billP = 0, saleP = 0;
  for (const b of bills) {
    const v = discountValueP(b.subtotal, b.discount, b.discount_type);
    if (v <= 0) continue;
    billP += v;
    rows.push({ kind: 'bill', number: b.bill_number, date: b.created_at, patient: b.patient, uhid: b.uhid ?? null, amount: fromPaise(v), reason: b.discount_reason ?? null, by: b.discount_by ?? null });
  }
  for (const x of sales) {
    const v = Math.max(0, Math.min(toPaise(x.discount), toPaise(x.subtotal)));
    if (v <= 0) continue;
    saleP += v;
    rows.push({ kind: 'pharmacy', number: x.sale_number, date: x.created_at, patient: x.patient, uhid: x.uhid ?? null, amount: fromPaise(v), reason: null, by: x.sold_by ?? null });
  }
  const gross = db.prepare(`
    SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM bills WHERE COALESCE(status, '') <> 'cancelled' AND cancelled_at IS NULL
              AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime') BETWEEN ? AND ?) AS b,
           (SELECT COALESCE(SUM(subtotal), 0) FROM pharmacy_sales WHERE COALESCE(payment_mode, '') <> 'IPD-bill'
              AND created_at >= ? AND created_at < ? AND date(created_at, 'localtime') BETWEEN ? AND ?) AS s
  `).get(slack.lo, slack.hi, from, to, slack.lo, slack.hi, from, to) as { b: number; s: number };
  const grossP = toPaise(gross.b) + toPaise(gross.s);
  rows.sort((a, b) => (b.amount - a.amount) || (a.date < b.date ? 1 : -1));
  return {
    bills: { count: bills.length, value: fromPaise(billP) },
    pharmacy: { count: sales.length, value: fromPaise(saleP) },
    total_value: fromPaise(billP + saleP),
    pct_of_gross: grossP > 0 ? Math.round(((billP + saleP) / grossP) * 1000) / 10 : null,
    largest: rows.slice(0, Math.min(Math.max(Math.floor(limit) || 10, 1), 100)),
  };
}

/**
 * The hand-typed pharmacy bills (Quick Bill → Pharmacy) of a period, on their own. They never touched stock, so they
 * have no cost and no profit and are kept out of every stock-based pharmacy figure; this is the only place they are
 * analysed. Same money rule as every other flat bill: paid = what was received (never above the total), due = the rest.
 */
export function manualPharmacy(db: Database.Database, from: string, to: string): ManualPharmacy {
  const slack = utcSlack(from, to);
  const rows = db.prepare(`
    SELECT b.bill_number, b.created_at, b.total, b.discount, b.discount_type, b.subtotal, b.payment_mode, b.amount_paid, b.notes, b.patient_id,
           (p.first_name || ' ' || p.last_name) AS name, date(b.created_at, 'localtime') AS day
      FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
     WHERE b.bill_type = 'pharmacy' AND b.admission_id IS NULL AND COALESCE(b.status, '') <> 'cancelled' AND b.cancelled_at IS NULL
       AND b.created_at >= ? AND b.created_at < ? AND date(b.created_at, 'localtime') BETWEEN ? AND ?
  `).all(slack.lo, slack.hi, from, to) as any[];

  let billedP = 0, discountP = 0, paidP = 0;
  const mode = new Map<string, { count: number; totalP: number }>();
  const day = new Map<string, { bills: number; totalP: number }>();
  const cust = { patient: { count: 0, totalP: 0 }, 'walk-in': { count: 0, totalP: 0 } };
  const list = rows.map((r) => {
    const totalP = toPaise(r.total);
    const received = Math.min(totalP, Math.max(0, toPaise(r.amount_paid)));
    const dp = r.discount_type === 'percent' ? Math.round(toPaise(r.subtotal) * (Number(r.discount) || 0) / 100) : toPaise(r.discount);
    billedP += totalP; paidP += received; discountP += Math.max(0, Math.min(dp, toPaise(r.subtotal)));
    const m = mode.get(r.payment_mode || '—') ?? { count: 0, totalP: 0 }; m.count++; m.totalP += totalP; mode.set(r.payment_mode || '—', m);
    const d = day.get(r.day) ?? { bills: 0, totalP: 0 }; d.bills++; d.totalP += totalP; day.set(r.day, d);
    const c = r.patient_id ? cust.patient : cust['walk-in']; c.count++; c.totalP += totalP;
    const typed = !r.patient_id && typeof r.notes === 'string' && r.notes.startsWith('Name: ') ? r.notes.slice(6).trim() : null;
    return {
      bill_number: r.bill_number as string, created_at: r.created_at as string, name: (r.name?.trim() || typed || 'Walk-in') as string,
      total: fromPaise(totalP), due: fromPaise(totalP - received), payment_mode: (r.payment_mode ?? null) as string | null,
    };
  });
  const owedNowP = outstandingBills(db).filter((o) => o.kind === 'pharmacy_manual').reduce((a, o) => a + toPaise(o.due), 0);
  return {
    from, to, bills: rows.length, billed: fromPaise(billedP), discount: fromPaise(discountP),
    collected: fromPaise(paidP), still_owed: fromPaise(billedP - paidP), owed_now: fromPaise(owedNowP),
    by_mode: [...mode.entries()].map(([k, v]) => ({ mode: k, count: v.count, total: fromPaise(v.totalP) })).sort((a, b) => b.total - a.total),
    by_day: [...day.entries()].map(([k, v]) => ({ day: k, bills: v.bills, total: fromPaise(v.totalP) })).sort((a, b) => (a.day < b.day ? -1 : 1)),
    by_customer: (['patient', 'walk-in'] as const).filter((k) => cust[k].count > 0).map((k) => ({ kind: k, count: cust[k].count, total: fromPaise(cust[k].totalP) })),
    largest: list.sort((a, b) => b.total - a.total).slice(0, 10),
  };
}
