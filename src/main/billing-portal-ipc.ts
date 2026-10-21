/**
 * Billing portal IPC — the thin layer between the Billing screen and main/billing-portal.ts.
 *
 * Reads (`billing:patientPortal`, `analytics:receivables`) need nothing but the database. The one write —
 * raising the bill for a lab or radiology order that has none — checks the licence module and the role, writes
 * an audit line, and tells the other stations so their lists refresh.
 *
 * Collecting money against a bill is NOT here: it is the existing `bill:pay` (one rule, one place, with its
 * over-payment guard and its repeat-click protection).
 */

import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { getAllSettings } from '../db/settings';
import { requireRole, actor } from './ipc';
import { logAudit } from './auth';
import { requireModule } from './licensing/enforce';
import { broadcastEvent } from './network-server';
import * as portal from './billing-portal';
import type { Role } from './auth';

/** Who may raise a bill for an order. Admin is always allowed by requireRole. */
const DESK: Role[] = ['receptionist', 'lab_tech', 'radiology_tech', 'doctor', 'ward_incharge', 'manager'];

export function registerBillingPortalIpc() {
  ipcMain.handle('billing:patientPortal', (_e, patientId: number) => {
    const id = Number(patientId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Pick a patient first.');
    return portal.patientPortal(getDb(), id);
  });

  ipcMain.handle('analytics:receivables', (_e, opts: { limit?: number } = {}) => portal.receivables(getDb(), opts || {}));
  ipcMain.handle('analytics:discounts', (_e, from: string, to: string, limit?: number) => portal.discountsGiven(getDb(), from, to, limit));
  ipcMain.handle('analytics:unbilled', (_e, opts: { days?: number; limit?: number } = {}) => portal.unbilledWork(getDb(), opts || {}));

  ipcMain.handle(
    'billing:createOrderBill',
    (_e, kind: 'lab' | 'radiology', orderId: number, opts: { force?: boolean } = {}) => {
      if (kind !== 'lab' && kind !== 'radiology') return { ok: false as const, error: 'Say whether this is a lab or a radiology order.' };
      requireModule('lab', kind === 'lab' ? 'Laboratory' : 'Radiology');
      requireRole(DESK, `bill a ${kind} order`);
      const db = getDb();
      const s = getAllSettings(db);
      const r = portal.billOrder(db, kind, Number(orderId), {
        force: !!opts?.force,
        invoicePrefix: (s.invoice_prefix || 'INV').trim() || 'INV',
      });
      if (r.ok) {
        try { logAudit(db, actor(), 'order_billed_from_portal', 'bills', r.bill_id, JSON.stringify({ kind, order_id: Number(orderId), bill: r.bill_number, total: r.total, forced: !!opts?.force })); }
        catch { /* the audit must never block work */ }
        try { broadcastEvent('bill:updated', { billId: r.bill_id }); } catch { /* ignore */ }
      }
      return r;
    },
  );
}
