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
import { chargeMedicinesToAdmission } from './ipd-billing-ipc';
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
  // ----- read-only views for the Pharmacy tabs -----
  ipcMain.handle('pharmacy:clinicStock', () => fin.clinicStock(getDb()));
  ipcMain.handle('wholesalers:summary', () => fin.supplierSummary(getDb()));

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
    // Every sale is accountable: it records who made it (the signed-in user) unless the caller already said.
    const soldBy = payload?.sold_by ?? who() ?? undefined;
    // A repeat of the same attempt (same client_ref) returns the first sale; it must not be audited or announced twice.
    const ref = typeof payload?.client_ref === 'string' && payload.client_ref.trim() ? payload.client_ref.trim() : null;
    const repeat = !!(ref && getDb().prepare('SELECT 1 FROM pharmacy_sales WHERE client_ref=?').get(ref));
    let sale: any;
    if (payload?.ipd_admission_id) {
      // Medicines charged on an admitted patient's bill: the sale and the bill lines are made together or not at all.
      sale = chargeMedicinesToAdmission(getDb(), payload, soldBy ?? null);
      if (!repeat) {
        audit('pharmacy.ipd_charge', 'pharmacy_sales', sale.id, { admission: payload.ipd_admission_id, total: sale.total });
        try { broadcastEvent('bill:updated', { billId: null }); } catch { /* ignore */ }
      }
    } else {
      // 'IPD-bill' means "leave this out of the counter totals because a bill carries it". Only the in-patient route above
      // may set it — anything else would sell stock and book the money nowhere.
      if (payload?.payment_mode === 'IPD-bill') {
        throw new Error('To charge a medicine to an in-patient, pick the admitted patient on the sale — "IPD-bill" cannot be chosen as a payment mode.');
      }
      sale = fin.sellItems(getDb(), { ...payload, sold_by: soldBy });
      if (sale?.on_credit && !repeat) audit('pharmacy.credit_sale', 'pharmacy_sales', sale.id, { patient: sale.patient_id, total: sale.total, paid_now: sale.amount_paid });
    }
    tell();
    return sale;
  });

  // Which stay (if any) a patient is in — the counter offers "charge to the in-patient bill" only when there is one.
  ipcMain.handle('pharmacy:patientAdmission', (_e, patientId: number) => fin.activeAdmissionFor(getDb(), Number(patientId)));

  // ----- medicines on credit: taking the money later -----
  // Same return shape as the other money mutations: { ok, … } or { ok: false, error } with the reason in plain words.
  ipcMain.handle('pharmacy:payCredit', (_e, saleId: number, payment: fin.CreditPaymentIn) => {
    requireModule('pharmacy', 'Pharmacy');
    try {
      const r = fin.payCredit(getDb(), Number(saleId), payment, who());
      if (!r.duplicate) {
        audit('pharmacy.credit_payment', 'pharmacy_sales', r.sale_id, { amount: payment?.amount, mode: payment?.mode ?? null, due_after: r.due });
        tell();
        try { broadcastEvent('bill:updated', { billId: null }); } catch { /* ignore */ }
      }
      return { ok: true as const, duplicate: r.duplicate, sale_id: r.sale_id, due: r.due };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not record the payment.' };
    }
  });

  // ----- counter sales (named-patient ones also show in Billing; walk-ins are their own list) -----
  ipcMain.handle('pharmacy:counterSales', (_e, filter: fin.CounterSalesFilter = {}) => fin.listCounterSales(getDb(), filter || {}));

  // ----- "Cost not recorded": stock someone typed in by hand carries a cost nobody can vouch for -----
  ipcMain.handle('pharmacy:costSummary', () => fin.costNotRecordedSummary(getDb()));
  ipcMain.handle('pharmacy:clearManualCost', (_e, opts: { include_past_sales?: boolean } = {}) => {
    requireModule('pharmacy', 'Pharmacy');
    requireRole(PAYERS, 'clear hand-typed stock costs');
    try {
      const r = fin.clearManualCost(getDb(), { include_past_sales: !!opts?.include_past_sales });
      // The previous figures go in the audit line so a mistaken click can be undone by hand (capped: a very large
      // catalogue would otherwise make one enormous log entry).
      audit('pharmacy.cost_cleared', 'drug_stock_batches', 0, {
        batches: r.batches, register_rows: r.register_rows, include_past_sales: !!opts?.include_past_sales,
        previous: r.previous.slice(0, 1000), previous_truncated: r.previous.length > 1000,
      });
      tell();
      return { ok: true as const, batches: r.batches, register_rows: r.register_rows };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not clear the costs.' };
    }
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
