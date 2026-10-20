/**
 * Radiology IPC — the thin layer between the screens and main/radiology.ts.
 *
 * Deliberately a separate module (like ipd-billing-ipc / peds-ipc) rather than more lines in
 * main/ipc.ts. All the behaviour lives in radiology.ts as plain functions over the database;
 * this file only adds what needs Electron: licence + role checks, the audit log, and the live
 * "something changed" broadcast so other stations refresh.
 *
 * Error policy: every mutation returns { ok: true, … } or { ok: false, error } where `error`
 * is the specific, actionable message the service threw — never a blank failure.
 */

import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { getAllSettings } from '../db/settings';
import { requireRole, actor } from './ipc';
import { logAudit } from './auth';
import { requireModule } from './licensing/enforce';
import { broadcastEvent } from './network-server';
import * as rad from './radiology';
import type { Role } from './auth';

/** Who may take, perform, report and bill radiology work. Admin is always allowed by requireRole. */
const DESK: Role[] = ['radiology_tech', 'lab_tech', 'receptionist', 'doctor', 'ward_incharge', 'manager'];
/** Who may change the catalogue and prices. */
const CATALOGUE: Role[] = ['radiology_tech', 'manager'];

function deps(): rad.RadiologyDeps {
  const db = getDb();
  const s = getAllSettings(db);
  return {
    autoBill: s.radiology_auto_bill !== false,
    invoicePrefix: (s.invoice_prefix || 'INV').trim() || 'INV',
    audit: (action, orderId, detail) => {
      try { logAudit(db, actor(), action, 'radiology_orders', orderId, JSON.stringify(detail)); } catch { /* the audit must never block clinical work */ }
    },
  };
}

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

/** Run a mutation; turn a thrown message into { ok:false, error } and tell other stations on success. */
function run<T extends object>(what: string, fn: () => T, notify = true): Ok<T> | Fail {
  try {
    const out = fn();
    if (notify) { try { broadcastEvent('radiology:changed', {}); } catch { /* ignore */ } }
    return { ok: true, ...out };
  } catch (e: any) {
    return { ok: false, error: e?.message || `Could not ${what}.` };
  }
}

export function registerRadiologyIpc() {
  // ----- catalogue -----
  ipcMain.handle('radiology:listTests', (_e, activeOnly = true) => rad.listTests(getDb(), activeOnly !== false));

  ipcMain.handle('radiology:upsertTest', (_e, t: any) => {
    requireModule('lab', 'Radiology');
    requireRole(CATALOGUE, 'change the radiology catalogue');
    return run('save the test', () => ({ test: rad.upsertTest(getDb(), t) }), false);
  });

  ipcMain.handle('radiology:deleteTests', (_e, ids: number[]) => {
    requireModule('lab', 'Radiology');
    requireRole(CATALOGUE, 'delete radiology tests');
    return run('delete those tests', () => rad.bulkDeleteTests(getDb(), ids), false);
  });

  ipcMain.handle('radiology:loadStandardCatalog', () => {
    requireModule('lab', 'Radiology');
    requireRole(CATALOGUE, 'load the standard radiology catalogue');
    return run('load the catalogue', () => rad.loadStandardCatalog(getDb()), false);
  });

  // ----- reading -----
  ipcMain.handle('radiology:listOrders', (_e, filter: rad.ListFilter = {}) => rad.listOrders(getDb(), filter || {}));
  ipcMain.handle('radiology:getOrder', (_e, id: number) => rad.getOrder(getDb(), Number(id)));

  // ----- ordering -----
  ipcMain.handle('radiology:createOrder', (_e, payload: rad.CreateOrderInput) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'order a radiology test');
    return run('create the radiology order', () => ({ order: rad.createOrder(getDb(), payload, deps()) }));
  });

  ipcMain.handle('radiology:addItems', (_e, orderId: number, items: rad.ItemInput[]) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'add scans to a radiology order');
    return run('add those scans', () => rad.addItems(getDb(), Number(orderId), items, deps()));
  });

  ipcMain.handle('radiology:removeItem', (_e, orderId: number, itemId: number) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'remove a scan from a radiology order');
    return run('remove that scan', () => rad.removeItem(getDb(), Number(orderId), Number(itemId), deps()));
  });

  // ----- doing the scan, reporting it -----
  ipcMain.handle('radiology:updateStatus', (_e, orderId: number, status: string) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'update a radiology order');
    return run('update the order', () => ({ order: rad.updateStatus(getDb(), Number(orderId), status) }));
  });

  ipcMain.handle('radiology:saveReport', (_e, orderId: number, items: rad.ReportItemInput[], opts: { reportedBy?: string | null; finalize?: boolean } = {}) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'write a radiology report');
    return run('save the report', () => {
      const order = rad.saveReport(getDb(), Number(orderId), items, opts || {});
      if (opts?.finalize) {
        try { logAudit(getDb(), actor(), 'radiology_report_finalised', 'radiology_orders', Number(orderId), JSON.stringify({ by: opts.reportedBy ?? null })); } catch { /* ignore */ }
      }
      return { order };
    });
  });

  ipcMain.handle('radiology:cancelOrder', (_e, orderId: number, reason?: string) => {
    requireModule('lab', 'Radiology');
    requireRole(DESK, 'cancel a radiology order');
    return run('cancel the order', () => rad.cancelOrder(getDb(), Number(orderId), reason ?? null, actor()?.username ?? null, deps()));
  });
}
