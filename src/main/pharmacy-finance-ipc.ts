/**
 * Pharmacy finance IPC — the thin layer between the screens and main/pharmacy-finance.ts.
 *
 * All behaviour (totals, stock costing, payments, reports) lives in pharmacy-finance.ts as plain
 * functions over the database. This file only adds what needs Electron: licence + role checks, the
 * audit log, and the live "something changed" broadcast so other stations refresh.
 *
 * Mutations return { ok: true, … } or { ok: false, error } with the specific message the service
 * threw — never a blank failure. (`pharmacy:sell` keeps its old contract: it returns the sale row,
 * and a problem is thrown so the existing screens show it unchanged.)
 *
 * Channel names matter: the read-only-licence guard blocks any channel whose verb is on its list
 * (create / pay / add / sell …), so payments are `purchase:addPayment`, not "recordPayment".
 */

import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { requireRole, actor } from './ipc';
import { logAudit } from './auth';
import { requireModule } from './licensing/enforce';
import { broadcastEvent } from './network-server';
import * as fin from './pharmacy-finance';
import type { Role } from './auth';

/** Who may pay a supplier (money leaving the business). Admin is always allowed by requireRole. */
const PAYERS: Role[] = ['pharmacist', 'manager'];

function audit(action: string, entity: string, id: number, detail: unknown) {
  try { logAudit(getDb(), actor(), action, entity, id, JSON.stringify(detail)); } catch { /* the audit must never block work */ }
}
function who(): string | null {
  try { return actor()?.username ?? null; } catch { return null; }
}
function tell() {
  try { broadcastEvent('pharmacy:changed', {}); } catch { /* ignore */ }
}

export function registerPharmacyFinanceIpc() {
  // ----- purchase bills -----
  ipcMain.handle('purchase:list', (_e, filter: fin.PurchaseListFilter = {}) => fin.listPurchases(getDb(), filter || {}));
  ipcMain.handle('purchase:get', (_e, id: number) => fin.getPurchase(getDb(), Number(id)));

  ipcMain.handle('purchase:create', (_e, payload: fin.PurchaseIn) => {
    requireModule('pharmacy', 'Pharmacy');
    try {
      const r = fin.createPurchase(getDb(), payload, who());
      if (!r.duplicate) {
        audit('purchase.create', 'purchase_invoices', r.id, {
          invoice: payload.invoice_number, supplier: payload.wholesaler_id, lines: payload.items?.length ?? 0,
        });
        tell();
      }
      return { ok: true as const, duplicate: r.duplicate, invoice: fin.getPurchase(getDb(), r.id) };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not save the purchase bill.' };
    }
  });

  ipcMain.handle('purchase:addPayment', (_e, invoiceId: number, payment: fin.PaymentIn) => {
    requireModule('pharmacy', 'Pharmacy');
    requireRole(PAYERS, 'record supplier payments');
    try {
      const r = fin.recordPayment(getDb(), Number(invoiceId), payment, who());
      if (!r.duplicate) {
        audit('purchase.payment', 'purchase_invoices', r.invoice_id, { amount: payment.amount, mode: payment.mode ?? null });
        tell();
      }
      return { ok: true as const, duplicate: r.duplicate, invoice: fin.getPurchase(getDb(), r.invoice_id) };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not record the payment.' };
    }
  });

  // ----- selling -----
  // Same contract as before (returns the sale row); a problem is thrown so the screens show it.
  ipcMain.handle('pharmacy:sell', (_e, payload: fin.SellIn) => {
    requireModule('pharmacy', 'Pharmacy');
    const sale = fin.sellItems(getDb(), payload);
    tell();
    return sale;
  });

  // ----- reports -----
  ipcMain.handle('analytics:pharmacyProfit', (_e, filter: fin.ProfitFilter) => {
    try { return { ok: true as const, report: fin.profitReport(getDb(), filter) }; }
    catch (e: any) { return { ok: false as const, error: e?.message || 'Could not build the profit report.' }; }
  });
  ipcMain.handle('analytics:pharmacyValuation', () => fin.valuation(getDb()));
  ipcMain.handle('analytics:supplierReport', (_e, filter: { from: string; to: string }) => {
    try { return { ok: true as const, report: fin.supplierReport(getDb(), filter) }; }
    catch (e: any) { return { ok: false as const, error: e?.message || 'Could not build the supplier report.' }; }
  });
  ipcMain.handle('analytics:drugPriceHistory', (_e, drugId: number) => fin.drugPriceHistory(getDb(), Number(drugId)));
  ipcMain.handle('analytics:pharmacyChecks', () => fin.integrityChecks(getDb()));
}
