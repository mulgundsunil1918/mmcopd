/**
 * Lab bills — the line rows a lab order's bill carries, and raising that bill on demand.
 *
 * Shared by the Laboratory screens (main/ipc.ts raises the bill when a priced order is placed) and by the
 * Billing patient portal (which can raise the bill for an order that has none — auto-billing switched off).
 * Plain functions over a better-sqlite3 handle.
 */

import type Database from 'better-sqlite3';
import { nextBillNumber } from '../db/ids';
import { clinicalLineTax } from './gst';
import { recalcBill } from './bill-totals';
import { getAllSettings } from '../db/settings';

/**
 * Write a lab bill's real line rows (and the legacy items_json) from the order's priced tests — the same
 * thing radiology does. Lab bills used to carry items_json only, so printing one showed an empty table
 * until the app was next restarted, and a test added later was silently dropped from the total the next
 * time the bill was previewed. Replaces the lines the lab order owns (and ones migrated from items_json).
 */
export function writeLabBillLines(
  db: Database.Database,
  billId: number,
  lines: { id: number | null; description: string; rate: number }[],
): string {
  const tax = clinicalLineTax(db, null);
  db.prepare("DELETE FROM bill_items WHERE bill_id=? AND source IN ('lab', 'migrated')").run(billId);
  const ins = db.prepare(
    `INSERT INTO bill_items (bill_id, description, qty, rate, amount, is_taxable, gst_rate, hsn_sac, source, source_ref_id)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'lab', ?)`,
  );
  for (const l of lines) ins.run(billId, l.description, l.rate, l.rate, tax.is_taxable ? 1 : 0, tax.gst_rate, tax.hsn_sac, l.id);
  // Total the bill with the shared engine (discount, tax, round-off) so what is shown and collected never changes on a later look.
  recalcBill(db, billId, { force: true });
  return JSON.stringify(lines.map((l) => ({ description: l.description, qty: 1, rate: l.rate, amount: l.rate })));
}

/**
 * Raise the (unpaid) bill for a lab order from its tests' current prices, whatever the auto-billing setting says —
 * the caller is a person who asked for it. A test with no price is deliberately not billed. Refuses an order
 * that is already billed or has nothing priced, with a message that says what to do.
 */
export function raiseLabBill(db: Database.Database, orderId: number): { id: number; bill_number: string; total: number } {
  const o = db.prepare('SELECT * FROM lab_orders WHERE id=?').get(orderId) as any;
  if (!o) throw new Error('That lab order no longer exists — refresh and try again.');
  const have = db.prepare("SELECT bill_number FROM bills WHERE lab_order_id=? AND COALESCE(status,'') <> 'cancelled'").get(orderId) as { bill_number: string } | undefined;
  if (have) throw new Error(`Lab order ${o.order_number} is already billed (${have.bill_number}).`);

  const rows = db.prepare(
    `SELECT i.id, i.test_name, COALESCE(t.price, 0) AS price
       FROM lab_order_items i LEFT JOIN lab_tests t ON t.id = i.lab_test_id
      WHERE i.lab_order_id = ? ORDER BY i.id`,
  ).all(orderId) as { id: number; test_name: string; price: number }[];
  const priced = rows.filter((r) => Number(r.price) > 0).map((r) => ({ id: r.id, description: r.test_name, rate: Number(r.price) }));
  if (!priced.length) {
    throw new Error(`None of the tests on ${o.order_number} has a price. Set prices in Laboratory → Tests, or use Quick Bill to charge by hand.`);
  }
  const total = priced.reduce((s, r) => s + r.rate, 0);
  const billNumber = nextBillNumber(db, (getAllSettings(db).invoice_prefix || 'INV').trim() || 'INV');
  return db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO bills
         (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type,
          total, payment_mode, bill_kind, bill_type, amount_paid, notes, lab_order_id, status)
       VALUES (?, ?, ?, ?, '[]', ?, 0, 'flat', ?, 'Pending', 'lab', 'lab', 0, ?, ?, 'unpaid')`,
    ).run(billNumber, o.appointment_id, o.patient_id, o.doctor_id ?? null, total, total, `Lab order ${o.order_number}`, orderId);
    const billId = Number(info.lastInsertRowid);
    db.prepare('UPDATE bills SET items_json=? WHERE id=?').run(writeLabBillLines(db, billId, priced), billId);
    return { id: billId, bill_number: billNumber, total: Number((db.prepare('SELECT total FROM bills WHERE id=?').get(billId) as any).total) };
  })();
}
