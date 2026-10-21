/**
 * Cancel a wrongly raised bill — and give back whatever was received on it.
 *
 * The app used to have no way to do this at all: a bill raised for the wrong patient (or a visit that never happened) could
 * only be left standing, and the radiology screen even told staff to "refund or adjust it from Billing" — where nothing of
 * the kind existed. A cancelled bill is not revenue, is never "owed", and takes no more payments (all of that was already
 * true of a cancelled bill; this is the way to make one).
 *
 * Money received is never erased. Whatever the bill had taken is first written down as ordinary payment rows (so the day it
 * came in still shows it), then a matching NEGATIVE row is written on the day of the refund. Over time the two cancel out, the
 * till reads true on both days, and the whole story is in the audit log.
 *
 * An in-patient bill is not cancelled here: it belongs to an admission and is closed at discharge.
 */
import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { getDb } from '../db/db';
import { requireRole, actor } from './ipc';
import { logAudit } from './auth';
import { broadcastEvent } from './network-server';
import { money } from './billing-engine';

export function cancelBill(
  db: Database.Database, billId: number, reason: string, opts: { by?: string | null; refundMode?: string | null } = {},
): { bill_number: string; refunded: number } {
  const bill = db.prepare(
    `SELECT id, bill_number, status, cancelled_at, admission_id, bill_type, amount_paid, payment_mode, created_at, finalized_at
       FROM bills WHERE id=?`
  ).get(billId) as any;
  if (!bill) throw new Error(`Bill #${billId} was not found.`);
  if (bill.status === 'cancelled' || bill.cancelled_at) throw new Error(`${bill.bill_number} is already cancelled.`);
  if (bill.admission_id != null || bill.bill_type === 'ipd') {
    throw new Error(`${bill.bill_number} is an in-patient bill. It is closed at discharge; to take a charge off it, remove the line or give a discount.`);
  }
  const why = String(reason ?? '').trim();
  if (why.length < 3) throw new Error('Say why the bill is being cancelled (a few words).');

  let refunded = 0;
  db.transaction(() => {
    const rows = (db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM bill_payments WHERE bill_id=?').get(billId) as any).s as number;
    const received = money(Math.max(rows, Number(bill.amount_paid) || 0));
    if (received > 0.004) {
      // Money taken when the bill was raised has no payment row: write it down first, dated when it came in.
      const atBilling = money(received - rows);
      if (atBilling > 0.004) {
        db.prepare('INSERT INTO bill_payments (bill_id, amount, payment_mode, received_at, received_by) VALUES (?,?,?,?,?)')
          .run(billId, atBilling, bill.payment_mode && bill.payment_mode !== 'Pending' ? bill.payment_mode : 'Cash', bill.created_at, 'at billing');
      }
      const mode = String(opts.refundMode || '').trim()
        || ((db.prepare('SELECT payment_mode AS m FROM bill_payments WHERE bill_id=? AND amount > 0 ORDER BY id DESC LIMIT 1').get(billId) as any)?.m ?? 'Cash');
      db.prepare('INSERT INTO bill_payments (bill_id, amount, payment_mode, received_by, reference) VALUES (?,?,?,?,?)')
        .run(billId, -received, mode, opts.by ?? null, `Refund — cancelled: ${why.slice(0, 80)}`);
      refunded = received;
    }
    db.prepare("UPDATE bills SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=?, amount_paid=0 WHERE id=?")
      .run(new Date().toISOString(), opts.by ?? null, why.slice(0, 200), billId);
  })();
  return { bill_number: bill.bill_number, refunded };
}

export function registerBillCancelIpc() {
  ipcMain.handle('bill:cancel', (_e, billId: number, reason: string, refundMode?: string | null) => {
    // Cancelling a bill (and refunding it) is a manager's decision. Admin is always allowed by requireRole.
    requireRole(['manager'], 'cancel a bill');
    try {
      const by = actor()?.username ?? null;
      const r = cancelBill(getDb(), Number(billId), reason, { by, refundMode });
      logAudit(getDb(), actor(), 'bill_cancelled', 'bills', Number(billId), `${r.bill_number} · ${String(reason).slice(0, 80)}${r.refunded ? ` · refunded ₹${r.refunded}` : ''}`);
      broadcastEvent('bill:updated', { billId: Number(billId) });
      return { ok: true as const, ...r };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not cancel the bill.' };
    }
  });
}
