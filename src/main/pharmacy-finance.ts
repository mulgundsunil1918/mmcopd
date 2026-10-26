/**
 * Pharmacy finance — purchase bills, supplier payments, FEFO sales with frozen cost, and the
 * profit / valuation / supplier reports.
 *
 * Plain functions over a better-sqlite3 handle (no Electron, no IPC) so every figure can be
 * exercised against a real database in a test. main/pharmacy-finance-ipc.ts is the thin layer that
 * exposes them to the app (licence + role checks, audit log, live refresh).
 *
 * The rules this module keeps, because the old code did not:
 *   - The SERVER works out every purchase total from the lines. The screen sends quantities, rates
 *     and discounts, never totals, so a stale or tampered figure cannot be stored.
 *   - Entering a bill, receiving the stock and paying the supplier are three separate facts. Stock
 *     and the bill are saved together; payment is recorded as payments (purchase_payments) so
 *     "outstanding" is always total − Σ payments.
 *   - Cost has four distinct meanings and each lives in its own column: the supplier's RATE
 *     (purchase_price), the true acquisition cost per unit (unit_cost — free units, discounts,
 *     freight and, when it cannot be reclaimed, GST), the MRP printed on the pack, and the selling
 *     price. Revenue is whatever was actually charged on the sale, after discount.
 *   - A sale freezes the unit cost of the batch it came from (dispensing_register.unit_cost). Editing
 *     or re-buying a batch later can therefore never rewrite the profit of sales already made.
 *   - Saving twice is harmless: purchases, payments and sales carry a client_ref the screen
 *     generates once per attempt; a repeat returns the original record instead of posting stock
 *     and money a second time.
 *   - Report dates are the clinic's LOCAL calendar days. Timestamps are stored as UTC, so every
 *     date filter converts with 'localtime' — otherwise a sale at 1 a.m. lands on yesterday.
 *
 * Error policy: every failure throws an Error whose message says what was wrong and what to do.
 */

import type Database from 'better-sqlite3';
import { nextSaleNumber } from '../db/ids';
import type { ClearPreview } from '../types';
import { getAllSettings } from '../db/settings';
import { gstContext, medicineLineTax, splitInclusive } from './gst';
import {
  allocatePaise, blendUnitCost, computePurchase, fromPaise, netRevenueExGst, profitMetrics,
  r2, r4, toPaise, validatePurchase,
} from '../lib/pharmacyMath';
import {
  rankProfit,
  type CostNotRecordedSummary, type CounterSaleRow, type CounterSalesFilter, type CounterSalesResult,
  type DrugProfitRow, type IntegrityFinding, type PriceHistoryRow, type ProfitReport, type ProfitTotals,
  type StockBucket, type SupplierReport, type Valuation,
} from '../lib/pharmacyReports';
import { capPaise } from '../lib/discountLimit';
import { medicineKey } from '../lib/medicineGroups';
import { buildSupplierAccounts, buildSupplierStatement, type StatementInvoice, type StatementPayment, type SupplierStatement } from '../lib/supplierStatement';
export type { CounterSalesFilter, CounterSalesResult, CounterSaleRow, CostNotRecordedSummary } from '../lib/pharmacyReports';

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Today (or any date) as YYYY-MM-DD in the PC's own time zone. */
export const localISO = (d: Date = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

const rupees = (n: number) => `₹${(Math.round(n * 100) / 100).toFixed(2)}`;

const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10)) -
    Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10))) / 86_400_000);

// ---------------------------------------------------------------------------------------------
// Purchase bills
// ---------------------------------------------------------------------------------------------

export interface PurchaseLineIn {
  drug_master_id: number;
  batch_no: string;
  expiry: string;
  /** YYYY-MM or YYYY-MM-DD; optional. */
  manufacture_date?: string | null;
  /** Paid units. */
  qty_received: number;
  free_qty?: number;
  pack_qty?: number | null;
  /** Supplier's rate per paid unit, before discount and GST. */
  purchase_price: number;
  disc_pct?: number;
  mrp: number;
  /** What you intend to charge; blank = sell at MRP. Never above MRP. */
  selling_price?: number | null;
  gst_rate?: number;
  manufacturer_license_no?: string | null;
}

export interface PurchaseIn {
  /** Generated once per attempt by the screen; a repeat of the same value returns the first save. */
  client_ref?: string | null;
  invoice_number: string;
  wholesaler_id: number;
  invoice_date: string;
  received_date?: string | null;
  /** Flat invoice-level discount in rupees (shared over the lines by value). */
  discount?: number;
  /** Freight / packing / handling in rupees. */
  other_charges?: number;
  interstate?: boolean;
  /** GST cannot be claimed back → it becomes part of stock cost. Default: the clinic does not charge GST. */
  gst_in_cost?: boolean;
  /** Rupees, or 'auto' to round the invoice to the nearest rupee. Default 0. */
  round_off?: number | 'auto';
  payment_mode?: string | null;
  /** Paid at the time of entry (the rest stays outstanding). */
  amount_paid?: number;
  paid_on?: string | null;
  scan_path?: string | null;
  notes?: string | null;
  items: PurchaseLineIn[];
}

export interface PurchaseCreated {
  id: number;
  /** True when this was a repeat of an earlier save and nothing new was written. */
  duplicate: boolean;
}

function settle(db: Database.Database, invoiceId: number) {
  const inv = db.prepare('SELECT total FROM purchase_invoices WHERE id=?').get(invoiceId) as { total: number };
  const pays = db.prepare('SELECT amount FROM purchase_payments WHERE invoice_id=?').all(invoiceId) as { amount: number }[];
  const paidP = pays.reduce((s, p) => s + toPaise(p.amount), 0);
  const totalP = toPaise(inv.total);
  const status = totalP - paidP <= 0 ? 'paid' : paidP > 0 ? 'partial' : 'unpaid';
  db.prepare('UPDATE purchase_invoices SET amount_paid=?, payment_status=? WHERE id=?').run(fromPaise(paidP), status, invoiceId);
}

export function createPurchase(db: Database.Database, input: PurchaseIn, _by?: string | null): PurchaseCreated {
  const ref = clean(input?.client_ref);
  if (ref) {
    const hit = db.prepare('SELECT id FROM purchase_invoices WHERE client_ref=?').get(ref) as { id: number } | undefined;
    if (hit) return { id: hit.id, duplicate: true };
  }

  const invoiceNo = clean(input?.invoice_number);
  if (!invoiceNo) throw new Error("Enter the supplier's invoice number.");
  const supplier = db.prepare('SELECT id, name FROM wholesalers WHERE id=?').get(Number(input.wholesaler_id)) as
    { id: number; name: string } | undefined;
  if (!supplier) throw new Error('Choose the supplier (wholesaler) this bill is from.');
  if (!isIsoDate(input.invoice_date)) throw new Error('Enter a valid invoice date.');
  const received = isIsoDate(input.received_date) ? input.received_date : localISO();

  const dupe = db.prepare(
    'SELECT id, invoice_date FROM purchase_invoices WHERE wholesaler_id=? AND lower(trim(invoice_number))=lower(?)',
  ).get(supplier.id, invoiceNo) as { id: number; invoice_date: string } | undefined;
  if (dupe) {
    throw new Error(
      `Invoice ${invoiceNo} from ${supplier.name} is already recorded (dated ${dupe.invoice_date}). ` +
      'Open it from the Purchases list instead of entering it again.',
    );
  }

  const items = Array.isArray(input.items) ? input.items : [];
  const getDrug = db.prepare('SELECT id, name FROM drug_master WHERE id=?');
  const lines = items.map((l, i) => {
    const drug = getDrug.get(Number(l.drug_master_id)) as { id: number; name: string } | undefined;
    const row = `Line ${i + 1}`;
    if (!drug) throw new Error(`${row}: choose the medicine.`);
    const who = `${row} (${drug.name})`;
    const batch = clean(l.batch_no);
    if (!batch) throw new Error(`${who}: enter the batch number.`);
    if (!isIsoDate(l.expiry)) throw new Error(`${who}: enter the expiry date.`);
    const mfg = clean(l.manufacture_date);
    if (mfg && !/^\d{4}-\d{2}(-\d{2})?$/.test(mfg)) throw new Error(`${who}: the manufacture date is not valid.`);
    const mrp = Number(l.mrp);
    if (!(mrp > 0)) throw new Error(`${who}: enter the MRP printed on the pack.`);
    const spRaw: unknown = l.selling_price;
    const sp = spRaw === null || spRaw === undefined || spRaw === '' ? null : Number(spRaw);
    if (sp !== null) {
      if (!Number.isFinite(sp) || sp < 0) throw new Error(`${who}: the selling price is not valid.`);
      if (toPaise(sp) > toPaise(mrp)) throw new Error(`${who}: the selling price (${rupees(sp)}) cannot be higher than the MRP (${rupees(mrp)}).`);
    }
    return { src: l, drug, batch, mfg, mrp, sp };
  });

  const calcLines = lines.map((x) => ({
    qty: Number(x.src.qty_received),
    free_qty: Number(x.src.free_qty ?? 0),
    rate: Number(x.src.purchase_price),
    disc_pct: Number(x.src.disc_pct ?? 0),
    gst_rate: Number(x.src.gst_rate ?? 0),
  }));
  const gstInCost = input.gst_in_cost ?? !gstContext(db).enabled;
  const opts = {
    header_discount: Number(input.discount ?? 0),
    other_charges: Number(input.other_charges ?? 0),
    interstate: !!input.interstate,
    gst_in_cost: gstInCost,
    round_off: input.round_off ?? 0,
  };
  const problem = validatePurchase(calcLines, opts);
  if (problem) throw new Error(problem);
  const calc = computePurchase(calcLines, opts);

  const totalP = toPaise(calc.total);
  const paidP = toPaise(input.amount_paid ?? 0);
  if (paidP < 0) throw new Error('The amount paid cannot be negative.');
  if (paidP > totalP) throw new Error(`The amount paid (${rupees(fromPaise(paidP))}) is more than the bill total (${rupees(calc.total)}).`);
  const paidOn = isIsoDate(input.paid_on) ? input.paid_on : localISO();

  const tx = db.transaction((): number => {
    const info = db.prepare(`
      INSERT INTO purchase_invoices
        (invoice_number, wholesaler_id, invoice_date, received_date,
         subtotal, cgst, sgst, igst, discount, total,
         other_charges, round_off, gst_in_cost,
         payment_mode, payment_status, amount_paid, client_ref, scan_path, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      invoiceNo, supplier.id, input.invoice_date, received,
      calc.subtotal, calc.cgst, calc.sgst, calc.igst, calc.discount, calc.total,
      calc.other_charges, calc.round_off, gstInCost ? 1 : 0,
      clean(input.payment_mode), totalP === 0 ? 'paid' : 'unpaid', ref, clean(input.scan_path), clean(input.notes),
    );
    const invoiceId = Number(info.lastInsertRowid);

    const insLine = db.prepare(`
      INSERT INTO purchase_invoice_items
        (invoice_id, drug_master_id, batch_no, expiry, manufacture_date, qty_received, pack_qty, free_qty,
         purchase_price, mrp, gst_rate, manufacturer_license_no, line_total,
         disc_pct, discount_amount, taxable_value, gst_amount, selling_price, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findBatch = db.prepare(
      'SELECT id, qty_remaining, unit_cost, purchase_price FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?',
    );
    const insBatch = db.prepare(`
      INSERT INTO drug_stock_batches
        (drug_master_id, purchase_item_id, batch_no, expiry, manufacture_date, qty_received, qty_remaining,
         purchase_price, unit_cost, mrp, selling_price, manufacturer_license_no, received_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const updBatch = db.prepare(`
      UPDATE drug_stock_batches SET
        purchase_item_id=?, expiry=?, manufacture_date=?,
        qty_received = qty_received + ?, qty_remaining = qty_remaining + ?,
        purchase_price=?, unit_cost=?, mrp=?, selling_price=COALESCE(?, selling_price),
        manufacturer_license_no=COALESCE(?, manufacturer_license_no)
      WHERE id=?
    `);

    lines.forEach((x, i) => {
      const r = calc.lines[i];
      const l = x.src;
      const lineInfo = insLine.run(
        invoiceId, x.drug.id, x.batch, l.expiry, x.mfg,
        Number(l.qty_received), l.pack_qty ?? null, Number(l.free_qty ?? 0),
        Number(l.purchase_price), x.mrp, Number(l.gst_rate ?? 0), clean(l.manufacturer_license_no), r.taxable,
        Number(l.disc_pct ?? 0), r.discount, r.taxable, r.gst, x.sp, r.unit_cost,
      );
      const lineId = Number(lineInfo.lastInsertRowid);
      const units = r.units;

      const have = findBatch.get(x.drug.id, x.batch) as
        { id: number; qty_remaining: number; unit_cost: number | null; purchase_price: number | null } | undefined;
      if (have) {
        // The same manufacturer batch bought again. Units already sold keep the cost frozen on their
        // sale; what is still on the shelf is valued at the weighted average of old and new.
        const blended = blendUnitCost(have.qty_remaining, have.unit_cost ?? have.purchase_price, units, r.unit_cost);
        updBatch.run(
          lineId, l.expiry, x.mfg, units, units,
          Number(l.purchase_price), blended, x.mrp, x.sp, clean(l.manufacturer_license_no), have.id,
        );
      } else {
        insBatch.run(
          x.drug.id, lineId, x.batch, l.expiry, x.mfg, units, units,
          Number(l.purchase_price), r.unit_cost, x.mrp, x.sp, clean(l.manufacturer_license_no), received,
        );
      }
    });

    if (paidP > 0) {
      db.prepare(
        'INSERT INTO purchase_payments (invoice_id, amount, payment_mode, paid_on, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(invoiceId, fromPaise(paidP), clean(input.payment_mode), paidOn, 'Paid when the bill was entered', _by ?? null);
      settle(db, invoiceId);
    }
    return invoiceId;
  });
  return { id: tx(), duplicate: false };
}

export interface PaymentIn {
  amount: number;
  mode?: string | null;
  paid_on?: string | null;
  reference?: string | null;
  notes?: string | null;
  client_ref?: string | null;
  /**
   * Only for a bill marked "partly paid" before payments were tracked: how much had already been paid.
   * The old record never said, so it cannot be guessed.
   */
  opening_paid?: number;
}

export function recordPayment(db: Database.Database, invoiceId: number, p: PaymentIn, by?: string | null) {
  const ref = clean(p?.client_ref);
  if (ref) {
    const hit = db.prepare('SELECT id, invoice_id FROM purchase_payments WHERE client_ref=?').get(ref) as
      { id: number; invoice_id: number } | undefined;
    if (hit) return { payment_id: hit.id, invoice_id: hit.invoice_id, duplicate: true };
  }
  const inv = db.prepare('SELECT id, invoice_number, total, amount_paid, payment_status FROM purchase_invoices WHERE id=?').get(Number(invoiceId)) as
    { id: number; invoice_number: string; total: number; amount_paid: number | null; payment_status: string } | undefined;
  if (!inv) throw new Error('That purchase bill was not found.');
  const amountP = toPaise(p?.amount);
  if (!(amountP > 0)) throw new Error('Enter the amount paid (more than ₹0).');
  const paidOn = isIsoDate(p.paid_on) ? p.paid_on : localISO();
  const totalP = toPaise(inv.total);

  const tx = db.transaction(() => {
    const havePayments = (db.prepare('SELECT COUNT(*) AS c FROM purchase_payments WHERE invoice_id=?').get(inv.id) as { c: number }).c > 0;
    if (inv.amount_paid === null && !havePayments) {
      // Legacy "partly paid" bill with no recorded amount.
      const openingP = toPaise(p.opening_paid);
      if (p.opening_paid === undefined || p.opening_paid === null) {
        throw new Error(
          `Invoice ${inv.invoice_number} was marked "partly paid" before payments were tracked, so how much was paid earlier is unknown. ` +
          'Enter the amount already paid, then add this payment.',
        );
      }
      if (openingP < 0 || openingP > totalP) throw new Error('The amount already paid must be between ₹0 and the bill total.');
      if (openingP > 0) {
        db.prepare(
          'INSERT INTO purchase_payments (invoice_id, amount, payment_mode, paid_on, notes, created_by) VALUES (?, ?, NULL, ?, ?, ?)',
        ).run(inv.id, fromPaise(openingP), paidOn, 'Paid before payments were tracked (entered later)', by ?? null);
      } else {
        db.prepare('UPDATE purchase_invoices SET amount_paid=0 WHERE id=?').run(inv.id);
      }
    }
    const paidNow = (db.prepare('SELECT amount FROM purchase_payments WHERE invoice_id=?').all(inv.id) as { amount: number }[])
      .reduce((s, x) => s + toPaise(x.amount), 0);
    const owedP = totalP - paidNow;
    if (amountP > owedP) {
      throw new Error(`A payment of ${rupees(fromPaise(amountP))} is more than the ${rupees(fromPaise(Math.max(0, owedP)))} still owed on invoice ${inv.invoice_number}.`);
    }
    const info = db.prepare(
      'INSERT INTO purchase_payments (invoice_id, amount, payment_mode, paid_on, reference, notes, created_by, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(inv.id, fromPaise(amountP), clean(p.mode), paidOn, clean(p.reference), clean(p.notes), by ?? null, ref);
    settle(db, inv.id);
    return Number(info.lastInsertRowid);
  });
  return { payment_id: tx(), invoice_id: inv.id, duplicate: false };
}

export interface SupplierPaymentIn {
  wholesaler_id: number;
  /** Rupees to pay this supplier. It is shared over their unpaid bills OLDEST FIRST (by invoice date, then the order entered). */
  amount: number;
  /** Optional: pay only these bills (still oldest first) instead of every unpaid bill of the supplier. */
  invoice_ids?: number[] | null;
  mode?: string | null;
  paid_on?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** One per attempt. Each bill's payment is stored as `${client_ref}#${invoice_id}`, so a repeat of the same attempt pays nothing twice. */
  client_ref?: string | null;
}

export interface SupplierPaymentResult {
  duplicate: boolean;
  wholesaler_id: number;
  supplier: string;
  paid: number;
  allocations: { invoice_id: number; invoice_number: string; amount: number; cleared: boolean }[];
  /** What is still owed to this supplier afterwards (bills whose payments are on record). */
  owed_after: number;
}

/**
 * Pay a supplier once and let the money settle their bills oldest-first. Every bill gets its own payment row through the SAME rule as
 * paying one bill (recordPayment): never more than the bill still owes, one all-or-nothing step. A bill marked "part-paid" before payments
 * were tracked has no recorded amount, so it cannot be settled from here — it is left alone and the caller says so; it is entered on the
 * bill itself. A retried attempt (same client_ref) reports what it paid and pays nothing again.
 */
export function paySupplier(db: Database.Database, p: SupplierPaymentIn, by?: string | null): SupplierPaymentResult {
  const wid = Number(p?.wholesaler_id);
  const sup = db.prepare('SELECT id, name FROM wholesalers WHERE id=?').get(wid) as { id: number; name: string } | undefined;
  if (!sup) throw new Error('That wholesaler was not found.');
  const owedAfter = () => (supplierSummary(db).find((r) => r.wholesaler_id === wid)?.owed ?? 0);

  const ref = clean(p?.client_ref);
  if (ref) {
    const esc = ref.replace(/[\\%_]/g, (c) => `\\${c}`);
    const prior = db.prepare(
      `SELECT pp.invoice_id, pi.invoice_number, pp.amount FROM purchase_payments pp JOIN purchase_invoices pi ON pi.id = pp.invoice_id
        WHERE pp.client_ref LIKE ? ESCAPE '\\' ORDER BY pp.id`,
    ).all(`${esc}#%`) as { invoice_id: number; invoice_number: string; amount: number }[];
    if (prior.length) {
      return {
        duplicate: true, wholesaler_id: wid, supplier: sup.name,
        paid: fromPaise(prior.reduce((s, x) => s + toPaise(x.amount), 0)),
        allocations: prior.map((x) => ({ invoice_id: x.invoice_id, invoice_number: x.invoice_number, amount: x.amount, cleared: false })),
        owed_after: owedAfter(),
      };
    }
  }

  const amountP = toPaise(p?.amount);
  if (!(amountP > 0)) throw new Error('Enter the amount to pay (more than ₹0).');
  const only = Array.isArray(p.invoice_ids) && p.invoice_ids.length ? new Set(p.invoice_ids.map(Number)) : null;
  const bills = db.prepare(
    'SELECT id, invoice_number, total, amount_paid FROM purchase_invoices WHERE wholesaler_id = ? ORDER BY date(invoice_date), id',
  ).all(wid) as { id: number; invoice_number: string; total: number; amount_paid: number | null }[];
  if (only) for (const id of only) if (!bills.some((b) => b.id === id)) throw new Error('One of the bills you chose is not a bill from this supplier.');
  const open = bills
    .filter((b) => b.amount_paid !== null && toPaise(b.total) - toPaise(b.amount_paid) > 0 && (!only || only.has(b.id)))
    .map((b) => ({ ...b, owedP: toPaise(b.total) - toPaise(b.amount_paid as number) }));
  const owedP = open.reduce((s, b) => s + b.owedP, 0);
  if (owedP <= 0) throw new Error(`Nothing is owed to ${sup.name} on ${only ? 'the bills you chose' : 'bills whose payments are recorded'}.`);
  if (amountP > owedP) {
    throw new Error(`A payment of ${rupees(fromPaise(amountP))} is more than the ${rupees(fromPaise(owedP))} owed to ${sup.name} on ${only ? 'the bills you chose' : 'their unpaid bills'}.`);
  }

  const paidOn = isIsoDate(p.paid_on) ? p.paid_on : localISO();
  const allocations: SupplierPaymentResult['allocations'] = [];
  db.transaction(() => {
    let left = amountP;
    for (const b of open) {
      if (left <= 0) break;
      const payP = Math.min(b.owedP, left);
      recordPayment(db, b.id, {
        amount: fromPaise(payP), mode: p.mode ?? null, paid_on: paidOn, reference: p.reference ?? null, notes: p.notes ?? null,
        client_ref: ref ? `${ref}#${b.id}` : null,
      }, by);
      allocations.push({ invoice_id: b.id, invoice_number: b.invoice_number, amount: fromPaise(payP), cleared: payP === b.owedP });
      left -= payP;
    }
  })();
  return { duplicate: false, wholesaler_id: wid, supplier: sup.name, paid: fromPaise(amountP), allocations, owed_after: owedAfter() };
}

export interface PurchaseListFilter {
  from?: string;
  to?: string;
  wholesaler_id?: number;
  /** 'outstanding' = anything not fully paid. */
  status?: 'paid' | 'unpaid' | 'partial' | 'outstanding';
}

export function listPurchases(db: Database.Database, filter: PurchaseListFilter = {}) {
  const conds: string[] = [];
  const params: any[] = [];
  if (filter.from) { conds.push('date(pi.invoice_date) >= ?'); params.push(filter.from); }
  if (filter.to) { conds.push('date(pi.invoice_date) <= ?'); params.push(filter.to); }
  if (filter.wholesaler_id) { conds.push('pi.wholesaler_id = ?'); params.push(filter.wholesaler_id); }
  if (filter.status === 'outstanding') conds.push("pi.payment_status <> 'paid'");
  else if (filter.status) { conds.push('pi.payment_status = ?'); params.push(filter.status); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  return db.prepare(`
    SELECT pi.*, w.name AS wholesaler_name, w.drug_license_no AS wholesaler_license_no,
           CASE WHEN pi.amount_paid IS NULL THEN NULL ELSE ROUND(pi.total - pi.amount_paid, 2) END AS outstanding,
           (SELECT COUNT(*) FROM purchase_invoice_items x WHERE x.invoice_id = pi.id) AS line_count
      FROM purchase_invoices pi
      JOIN wholesalers w ON w.id = pi.wholesaler_id
      ${where}
     ORDER BY date(pi.invoice_date) DESC, pi.id DESC LIMIT 500
  `).all(...params);
}

export function getPurchase(db: Database.Database, id: number) {
  const header = db.prepare(`
    SELECT pi.*, w.name AS wholesaler_name, w.drug_license_no AS wholesaler_license_no, w.gstin AS wholesaler_gstin,
           CASE WHEN pi.amount_paid IS NULL THEN NULL ELSE ROUND(pi.total - pi.amount_paid, 2) END AS outstanding
      FROM purchase_invoices pi JOIN wholesalers w ON w.id = pi.wholesaler_id
     WHERE pi.id = ?
  `).get(id) as any;
  if (!header) return null;
  const items = db.prepare(`
    SELECT pii.*, m.name AS drug_name, m.generic_name, m.form, m.strength
      FROM purchase_invoice_items pii JOIN drug_master m ON m.id = pii.drug_master_id
     WHERE pii.invoice_id = ? ORDER BY pii.id
  `).all(id);
  const payments = db.prepare('SELECT * FROM purchase_payments WHERE invoice_id = ? ORDER BY date(paid_on), id').all(id);
  return { ...header, items, payments };
}

// ---------------------------------------------------------------------------------------------
// GST rates on the Drug List — the clinic decides them (nothing is changed for it)
// ---------------------------------------------------------------------------------------------

export const GST_RATES = [0, 5, 12, 18, 28];

/** How many medicines sit at each GST rate (active ones). */
export function gstSummary(db: Database.Database): { total: number; by_rate: { rate: number; count: number }[] } {
  const rows = db.prepare('SELECT gst_rate AS rate, COUNT(*) AS count FROM drug_master WHERE is_active = 1 GROUP BY gst_rate ORDER BY gst_rate').all() as { rate: number; count: number }[];
  return { total: rows.reduce((a, r) => a + r.count, 0), by_rate: rows };
}

export interface SetGstIn {
  /** The new GST %: one of 0, 5, 12, 18, 28. */
  rate: number;
  /** Only these medicines (a selection); omit for the whole list. */
  ids?: number[] | null;
  /** Only the medicines that are at this rate now (e.g. "everything at 12%"); omit for any rate. */
  from_rate?: number | null;
}

/**
 * Set the GST rate of many medicines at once — the clinic's own decision (the app never moves a rate by itself). Only the rate changes:
 * bills already made keep the tax they were made with; new sales and purchase lines use the new rate.
 */
export function setDrugGst(db: Database.Database, p: SetGstIn): { changed: number; unchanged: number } {
  const rate = Number(p?.rate);
  if (!GST_RATES.includes(rate)) throw new Error(`Choose a GST rate: ${GST_RATES.join('%, ')}%.`);
  const from = p?.from_rate === null || p?.from_rate === undefined ? null : Number(p.from_rate);
  if (from !== null && !GST_RATES.includes(from)) throw new Error('The rate to change from is not one of the usual GST rates.');
  const ids = Array.isArray(p?.ids) ? Array.from(new Set(p.ids.map(Number).filter((x) => Number.isInteger(x) && x > 0))) : null;
  if (ids !== null && ids.length === 0) throw new Error('Tick at least one medicine.');

  // a selection goes in chunks (SQLite limits the number of ? in one statement); no selection = the whole list
  const chunks: (number[] | null)[] = ids ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, i * 500 + 500)) : [null];
  let total = 0, changed = 0;
  db.transaction(() => {
    for (const chunk of chunks) {
      const conds: string[] = []; const args: any[] = [];
      if (chunk) { conds.push(`id IN (${chunk.map(() => '?').join(',')})`); args.push(...chunk); }
      if (from !== null) { conds.push('gst_rate = ?'); args.push(from); }
      const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
      total += (db.prepare(`SELECT COUNT(*) AS c FROM drug_master${where}`).get(...args) as { c: number }).c;
      changed += db.prepare(`UPDATE drug_master SET gst_rate = ?, updated_at = datetime('now')${where ? `${where} AND` : ' WHERE'} gst_rate <> ?`).run(rate, ...args, rate).changes;
    }
  })();
  return { changed, unchanged: total - changed };
}

// ---------------------------------------------------------------------------------------------
// Deleting a purchase bill — ANY purchase bill, no conditions (the administrator's call; the password is asked by the IPC layer)
// ---------------------------------------------------------------------------------------------

export interface PurchaseDeleted {
  invoice_id: number;
  invoice_number: string;
  supplier: string;
  total: number;
  lines: number;
  /** Units the bill brought in (paid + free). */
  units_in: number;
  /** Of those, the units still on the shelf, now taken off. */
  units_taken_off: number;
  /** Of those, the units that had already left the shelf (sold, given on a ward, cleared): what was sold stays sold — those sales are not touched. */
  units_gone: number;
  /** Batches that existed only because of this bill and were removed. */
  batches_deleted: number;
  /** Batches that stay (bought on another bill too, or sold from) with their units reduced. */
  batches_reduced: number;
  payments_erased: number;
  paid_erased: number;
  /** What was erased, for the audit log. */
  snapshot: unknown;
}

/**
 * Delete a supplier's purchase bill: the bill, its lines and the payments recorded on it go, and the stock it brought in comes off the shelf.
 *   - a batch that exists only because of this bill, and nothing was ever sold from, is removed;
 *   - a batch bought on another bill as well keeps its other units, and goes back to the price, MRP and expiry of its newest remaining purchase;
 *   - units that were already sold stay sold: the sales, the Schedule H register and their frozen cost are never touched (the batch stays as history);
 *   - the supplier's balance drops by what is no longer billed; money paid on the bill leaves the books with it.
 * One all-or-nothing step. Nothing about it is conditional on the stock being unsold or the bill being unpaid.
 */
export function deletePurchase(db: Database.Database, invoiceId: number): PurchaseDeleted {
  const header = db.prepare(`
    SELECT pi.*, w.name AS supplier FROM purchase_invoices pi JOIN wholesalers w ON w.id = pi.wholesaler_id WHERE pi.id = ?
  `).get(Number(invoiceId)) as any;
  if (!header) throw new Error('Purchase bill not found.');
  const items = db.prepare(`
    SELECT pii.*, m.name AS drug_name FROM purchase_invoice_items pii JOIN drug_master m ON m.id = pii.drug_master_id WHERE pii.invoice_id = ? ORDER BY pii.id
  `).all(header.id) as any[];
  const payments = db.prepare('SELECT amount, payment_mode, paid_on, reference, notes FROM purchase_payments WHERE invoice_id = ? ORDER BY id').all(header.id) as any[];

  // batches something was sold or given from — their rows are history and are never deleted
  const soldFrom = new Set<number>();
  let historyKnown = true;
  try {
    for (const t of ['dispensing_register', 'pharmacy_sale_items', 'ip_medication_admin']) {
      for (const r of db.prepare(`SELECT DISTINCT batch_id AS id FROM ${t} WHERE batch_id IS NOT NULL`).all() as { id: number }[]) soldFrom.add(r.id);
    }
  } catch { historyKnown = false; }                                       // if in doubt, keep the batch row

  const out: PurchaseDeleted = {
    invoice_id: header.id, invoice_number: header.invoice_number, supplier: header.supplier, total: header.total, lines: items.length,
    units_in: 0, units_taken_off: 0, units_gone: 0, batches_deleted: 0, batches_reduced: 0,
    payments_erased: payments.length, paid_erased: fromPaise(payments.reduce((a, x) => a + toPaise(x.amount), 0)), snapshot: null,
  };
  const unitsOf = (x: { qty_received: number; free_qty: number | null }) => Number(x.qty_received) + Number(x.free_qty || 0);

  db.transaction(() => {
    for (const it of items) {
      const units = unitsOf(it);
      out.units_in += units;
      const b = db.prepare('SELECT * FROM drug_stock_batches WHERE drug_master_id = ? AND batch_no = ?').get(it.drug_master_id, it.batch_no) as any;
      const onShelf = b ? Math.min(units, Math.max(0, Number(b.qty_remaining))) : 0;
      out.units_taken_off += onShelf;
      out.units_gone += units - onShelf;
      if (!b) continue;                                                    // the batch was cleared earlier (Start fresh): nothing to take off

      const newReceived = Math.max(0, Number(b.qty_received) - onShelf);
      const newRemaining = Math.max(0, Number(b.qty_remaining) - onShelf);
      const others = db.prepare('SELECT * FROM purchase_invoice_items WHERE drug_master_id = ? AND batch_no = ? AND invoice_id <> ? ORDER BY id').all(it.drug_master_id, it.batch_no, header.id) as any[];
      const hasHistory = !historyKnown || soldFrom.has(b.id);
      if (newReceived <= 0 && others.length === 0 && !hasHistory) {        // only this bill ever filled it, and nothing left it: gone
        db.prepare('DELETE FROM drug_stock_batches WHERE id = ?').run(b.id);
        out.batches_deleted++;
        continue;
      }
      db.prepare('UPDATE drug_stock_batches SET qty_received = ?, qty_remaining = ? WHERE id = ?').run(newReceived, newRemaining, b.id);
      out.batches_reduced++;
      if (others.length > 0) {
        // The newest purchase wrote the batch's price, MRP and expiry; hand them back to the newest one that is left, and value the batch at
        // the average cost of the purchases still on record.
        const last = others[others.length - 1];
        const totalUnits = others.reduce((a, x) => a + unitsOf(x), 0);
        const avg = totalUnits > 0 ? others.reduce((a, x) => a + unitsOf(x) * Number(x.unit_cost ?? x.purchase_price ?? 0), 0) / totalUnits : null;
        db.prepare(`
          UPDATE drug_stock_batches SET purchase_item_id = ?, expiry = ?, manufacture_date = ?, purchase_price = ?, unit_cost = ?, mrp = ?, selling_price = ?,
                 manufacturer_license_no = COALESCE(?, manufacturer_license_no)
           WHERE id = ?
        `).run(last.id, last.expiry, last.manufacture_date ?? null, last.purchase_price, avg !== null ? r4(avg) : b.unit_cost, last.mrp, last.selling_price ?? null, last.manufacturer_license_no ?? null, b.id);
      } else if (newRemaining <= 0) {
        db.prepare('UPDATE drug_stock_batches SET is_active = 0 WHERE id = ?').run(b.id);     // an empty batch kept only as history
      }
    }
    out.snapshot = {
      invoice: { ...header, supplier: undefined },
      items: items.map((x) => ({ drug: x.drug_name, batch: x.batch_no, expiry: x.expiry, qty: x.qty_received, free: x.free_qty, rate: x.purchase_price, mrp: x.mrp, gst: x.gst_rate })),
      payments,
    };
    db.prepare('DELETE FROM purchase_invoices WHERE id = ?').run(header.id);       // its lines and its payments go with it (cascade)
  })();
  return out;
}

// ---------------------------------------------------------------------------------------------
// "Drugs in my clinic" and the supplier list — read-only views for the Pharmacy tabs
// ---------------------------------------------------------------------------------------------

/** Days ahead that count as "expiring soon" — the same 90 the old alert boxes used. */
export const EXPIRING_SOON_DAYS = 90;

/**
 * The drugs the clinic actually holds — one row per drug that has a stock batch or was ever bought on a purchase bill —
 * with what the shelf looks like: units in stock, the earliest expiry among what is still on it, the cost of a unit and
 * the selling price(s), and plain flags the screen can filter on. A drug that only exists in the Drug List (never
 * bought, no batch) is not here; a drug marked inactive stays here only while it still has stock, so stock is never hidden.
 *
 * Stock rules are the ones the rest of the pharmacy uses (pharmacy:listDrugs / pharmacy:alerts): only ACTIVE batches
 * count, stock is the sum of qty_remaining, "expiring" is within EXPIRING_SOON_DAYS of today in the PC's own time zone.
 * Out-of-stock and low-stock are separate (low = 1 … the drug's low-stock level) and apply to active drugs only.
 * "Cost not recorded" = some of the stock on the shelf was typed in by hand or has no cost, so profit on it is a guess.
 */
export function clinicStock(db: Database.Database) {
  const rows = db.prepare(`
    SELECT m.*, m.default_mrp AS mrp,
           COALESCE(s.stock_qty, 0)        AS stock_qty,
           COALESCE(s.batch_count, 0)      AS batch_count,
           s.next_expiry                   AS next_expiry,
           COALESCE(s.expired_units, 0)    AS expired_units,
           COALESCE(s.expiring_units, 0)   AS expiring_units,
           COALESCE(s.unverified_units, 0) AS unverified_units,
           s.avg_cost                      AS avg_cost,
           s.price_min                     AS price_min,
           s.price_max                     AS price_max
      FROM drug_master m
      LEFT JOIN (
        SELECT b.drug_master_id AS drug_id,
               SUM(CASE WHEN b.is_active = 1 THEN b.qty_remaining ELSE 0 END) AS stock_qty,
               SUM(CASE WHEN b.is_active = 1 THEN 1 ELSE 0 END) AS batch_count,
               MIN(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 THEN date(b.expiry) END) AS next_expiry,
               SUM(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 AND date(b.expiry) < date('now', 'localtime')
                        THEN b.qty_remaining ELSE 0 END) AS expired_units,
               SUM(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 AND date(b.expiry) >= date('now', 'localtime')
                         AND date(b.expiry) <= date('now', 'localtime', '+${EXPIRING_SOON_DAYS} days')
                        THEN b.qty_remaining ELSE 0 END) AS expiring_units,
               SUM(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0
                         AND (b.purchase_item_id IS NULL OR COALESCE(b.unit_cost, b.purchase_price) IS NULL)
                        THEN b.qty_remaining ELSE 0 END) AS unverified_units,
               SUM(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 AND COALESCE(b.unit_cost, b.purchase_price) IS NOT NULL
                        THEN b.qty_remaining * COALESCE(b.unit_cost, b.purchase_price) END)
                 / NULLIF(SUM(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 AND COALESCE(b.unit_cost, b.purchase_price) IS NOT NULL
                                   THEN b.qty_remaining END), 0) AS avg_cost,
               MIN(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 THEN COALESCE(b.selling_price, b.mrp) END) AS price_min,
               MAX(CASE WHEN b.is_active = 1 AND b.qty_remaining > 0 THEN COALESCE(b.selling_price, b.mrp) END) AS price_max
          FROM drug_stock_batches b
         GROUP BY b.drug_master_id
      ) s ON s.drug_id = m.id
     WHERE (s.drug_id IS NOT NULL OR EXISTS (SELECT 1 FROM purchase_invoice_items x WHERE x.drug_master_id = m.id))
       AND (m.is_active = 1 OR COALESCE(s.stock_qty, 0) > 0)
     ORDER BY m.name COLLATE NOCASE
  `).all() as any[];
  return rows.map((r) => {
    const active = Number(r.is_active) === 1;
    const stock = Number(r.stock_qty) || 0;
    return {
      ...r,
      medicine_key: medicineKey(r),                      // brands of one medicine share it — the screen shows them together
      stock_qty: stock,
      avg_cost: r.avg_cost == null ? null : Math.round(Number(r.avg_cost) * 10000) / 10000,
      out_of_stock: active && stock <= 0,
      low_stock: active && stock > 0 && stock <= (Number(r.low_stock_threshold) || 0),
      expired: Number(r.expired_units) > 0,
      expiring_soon: Number(r.expiring_units) > 0,
      cost_unverified: Number(r.unverified_units) > 0,
    };
  });
}

/**
 * One row per wholesaler for the Wholesalers tab: how many bills, how much bought, and what is owed TODAY. "Owed" is the same
 * rule the Analytics supplier report uses (supplierReport().owed_now): the unpaid part of every bill whose payments are on record;
 * a bill marked part-paid before payments were tracked has no recorded amount, so it is counted apart (unknown_bills), never guessed.
 */
export function supplierSummary(db: Database.Database) {
  const rows = db.prepare(`
    SELECT w.id AS wholesaler_id,
           COUNT(pi.id) AS bills,
           COALESCE(SUM(pi.total), 0) AS total_bought,
           COALESCE(SUM(CASE WHEN pi.amount_paid IS NOT NULL AND pi.total - pi.amount_paid > 0.004 THEN pi.total - pi.amount_paid ELSE 0 END), 0) AS owed,
           COALESCE(SUM(CASE WHEN pi.id IS NOT NULL AND pi.amount_paid IS NULL THEN 1 ELSE 0 END), 0) AS unknown_bills,
           COALESCE(SUM(CASE WHEN pi.id IS NOT NULL AND (pi.amount_paid IS NULL OR pi.total - pi.amount_paid > 0.004) THEN 1 ELSE 0 END), 0) AS open_bills,
           MAX(date(pi.invoice_date)) AS last_bill_date
      FROM wholesalers w
      LEFT JOIN purchase_invoices pi ON pi.wholesaler_id = w.id
     GROUP BY w.id
  `).all() as any[];
  return rows.map((r) => ({ ...r, total_bought: r2(r.total_bought), owed: r2(r.owed) }));
}

/**
 * One supplier's whole account as a passbook (Wholesalers → Statement): every bill (credit) and payment (debit) with a running balance, the bills
 * still pending oldest first, the latest bills, and the totals. Read-only. The arithmetic is lib/supplierStatement.ts, shared with the demo;
 * its "owed" is the same figure supplierSummary gives for the supplier (the two are tested to agree).
 */
export function supplierStatement(db: Database.Database, wholesalerId: number, opts: { from?: string | null; to?: string | null } = {}) {
  const supplier = db.prepare(
    'SELECT id, name, contact_person, phone, email, address, drug_license_no, gstin, is_active FROM wholesalers WHERE id=?',
  ).get(Number(wholesalerId)) as { id: number; name: string; contact_person: string | null; phone: string | null; email: string | null; address: string | null; drug_license_no: string; gstin: string | null; is_active: number } | undefined;
  if (!supplier) return null;
  const invoices = db.prepare(`
    SELECT pi.id, pi.invoice_number, date(pi.invoice_date) AS invoice_date, pi.total, pi.amount_paid, pi.notes,
           (SELECT COUNT(*) FROM purchase_invoice_items x WHERE x.invoice_id = pi.id) AS line_count
      FROM purchase_invoices pi WHERE pi.wholesaler_id = ? ORDER BY date(pi.invoice_date), pi.id
  `).all(supplier.id) as StatementInvoice[];
  const payments = db.prepare(`
    SELECT pp.id, pp.invoice_id, pp.amount, pp.payment_mode, date(pp.paid_on) AS paid_on, pp.reference, pp.notes
      FROM purchase_payments pp JOIN purchase_invoices pi ON pi.id = pp.invoice_id
     WHERE pi.wholesaler_id = ? ORDER BY date(pp.paid_on), pp.id
  `).all(supplier.id) as StatementPayment[];
  const iso = (v: unknown) => (isIsoDate(v) ? (v as string) : null);
  return { supplier, ...buildSupplierStatement(invoices, payments, { today: localISO(), from: iso(opts?.from), to: iso(opts?.to) }) };
}

/** Every supplier's account in one list (Pharmacy → Reports → Supplier accounts): what is owed today and how old it is. Built from each supplier's statement. */
export function supplierAccounts(db: Database.Database) {
  const ids = (db.prepare('SELECT id FROM wholesalers ORDER BY name COLLATE NOCASE').all() as { id: number }[]).map((r) => r.id);
  const entries = ids.map((id) => supplierStatement(db, id)).filter((x): x is NonNullable<ReturnType<typeof supplierStatement>> => !!x)
    .map(({ supplier, ...statement }) => ({ supplier, statement: statement as SupplierStatement }));
  return buildSupplierAccounts(entries, localISO());
}

// ---------------------------------------------------------------------------------------------
// "Start fresh" / delete selected drugs — clear drugs, stock and batches
// ---------------------------------------------------------------------------------------------

/**
 * Which drugs and batches other records point at, found with ONE pass over each table. (Not one query per drug: the register, the
 * prescriptions and the ward orders have no index on the drug, so a busy clinic with thousands of drugs would make the dialog hang.)
 * A table that cannot be read counts as "no records"; the foreign keys still stop a referenced drug from ever being deleted, and the
 * clear then keeps it Inactive.
 */
interface RefIndex {
  /** Drugs named on a sale line or in the dispensing register. */
  sales: Set<number>;
  purchases: Set<number>;
  /** Drugs on a prescription line or a ward medication order. */
  prescriptions: Set<number>;
  /** Batches something was sold or given from (register, sale lines, ward administration). Null = could not be worked out: every batch is then kept. */
  soldBatches: Set<number> | null;
}
function buildRefIndex(db: Database.Database): RefIndex {
  const ids = (sql: string): number[] => { try { return (db.prepare(sql).all() as { id: number }[]).map((r) => r.id); } catch { return []; } };
  let soldBatches: Set<number> | null = new Set<number>();
  try {
    for (const t of ['dispensing_register', 'pharmacy_sale_items', 'ip_medication_admin']) {
      for (const r of db.prepare(`SELECT DISTINCT batch_id AS id FROM ${t} WHERE batch_id IS NOT NULL`).all() as { id: number }[]) soldBatches.add(r.id);
    }
  } catch { soldBatches = null; }                 // if in doubt, keep the batch
  return {
    sales: new Set([...ids('SELECT DISTINCT drug_master_id AS id FROM pharmacy_sale_items WHERE drug_master_id IS NOT NULL'), ...ids('SELECT DISTINCT drug_master_id AS id FROM dispensing_register')]),
    purchases: new Set(ids('SELECT DISTINCT drug_master_id AS id FROM purchase_invoice_items')),
    prescriptions: new Set([...ids('SELECT DISTINCT drug_master_id AS id FROM prescription_items WHERE drug_master_id IS NOT NULL'), ...ids('SELECT DISTINCT drug_master_id AS id FROM ip_medication_orders WHERE drug_master_id IS NOT NULL')]),
    soldBatches,
  };
}

interface DrugPlan {
  id: number;
  batches: { id: number; qty: number; active: boolean; fromPurchase: boolean; sold: boolean }[];
  refs: { sales: boolean; purchases: boolean; prescriptions: boolean };
  /** Nothing points at the drug, so it can be erased from the Drug List. */
  erasable: boolean;
  /** Already Inactive with every batch at zero and switched off while records still mention it: an earlier clear left it exactly like this. */
  settled: boolean;
}
/** What clearing one drug means. Null when there is no such drug. */
function planDrug(db: Database.Database, id: number, idx: RefIndex): DrugPlan | null {
  const m = db.prepare('SELECT is_active FROM drug_master WHERE id=?').get(id) as { is_active: number } | undefined;
  if (!m) return null;
  const batches = (db.prepare('SELECT id, qty_remaining, is_active, purchase_item_id FROM drug_stock_batches WHERE drug_master_id=?').all(id) as
    { id: number; qty_remaining: number; is_active: number; purchase_item_id: number | null }[])
    .map((b) => ({ id: b.id, qty: Math.max(0, b.qty_remaining), active: b.is_active === 1, fromPurchase: b.purchase_item_id !== null, sold: idx.soldBatches === null || idx.soldBatches.has(b.id) }));
  const refs = { sales: idx.sales.has(id), purchases: idx.purchases.has(id), prescriptions: idx.prescriptions.has(id) };
  const erasable = !refs.sales && !refs.purchases && !refs.prescriptions;
  const settled = !erasable && m.is_active === 0 && batches.every((b) => b.qty === 0 && !b.active);
  return { id, batches, refs, erasable, settled };
}
const targetDrugIds = (db: Database.Database, ids: number[] | null): number[] =>
  ids ? Array.from(new Set(ids.map(Number).filter((x) => Number.isInteger(x) && x > 0)))
    : (db.prepare('SELECT id FROM drug_master').all() as { id: number }[]).map((r) => r.id);
/** The drugs a clear would actually act on, planned: unknown ids and drugs an earlier clear already settled are left out. */
function plansFor(db: Database.Database, ids: number[] | null): DrugPlan[] {
  const idx = buildRefIndex(db);
  return targetDrugIds(db, ids).map((id) => planDrug(db, id, idx)).filter((p): p is DrugPlan => !!p && !p.settled);
}

/** What "clear these drugs" (or, with ids = null, "start fresh") WOULD do — nothing is changed. */
export function previewClearDrugs(db: Database.Database, ids: number[] | null): ClearPreview {
  const out: ClearPreview = { drugs: 0, delete_drugs: 0, keep_drugs: 0, kept_with_sales: 0, kept_with_purchases: 0, kept_with_prescriptions: 0,
    batches: 0, batches_deleted: 0, batches_zeroed: 0, units: 0, units_from_purchases: 0 };
  for (const p of plansFor(db, ids)) {
    out.drugs++;
    for (const b of p.batches) {
      out.batches++;
      if (b.sold) out.batches_zeroed++; else out.batches_deleted++;
      if (b.active && b.qty > 0) { out.units += b.qty; if (b.fromPurchase) out.units_from_purchases += b.qty; }
    }
    if (p.erasable) out.delete_drugs++;
    else {
      out.keep_drugs++;
      if (p.refs.sales) out.kept_with_sales++;
      if (p.refs.purchases) out.kept_with_purchases++;
      if (p.refs.prescriptions) out.kept_with_prescriptions++;
    }
  }
  return out;
}

export interface ClearResult {
  drugs_deleted: number;
  drugs_kept_inactive: number;
  batches_deleted: number;
  batches_zeroed: number;
  units_removed: number;
  /** [batch id, units it held] for every batch touched — written to the audit log so the stock can be reconstructed. */
  cleared: [number, number][];
}

/**
 * Remove the drugs' stock and batches, and the drugs themselves from the Drug List — one all-or-nothing step.
 *   - a batch nothing was sold from is deleted; one that was sold from is set to 0 units and switched off (history intact);
 *   - a drug with no record anywhere (nothing sold, bought, prescribed or ordered) is deleted; any other is kept but marked Inactive.
 * Patients, bills, sales, purchase bills, suppliers and the Schedule H register are never touched. ids = null → every drug ("start fresh").
 */
export function clearDrugs(db: Database.Database, ids: number[] | null): ClearResult {
  const out: ClearResult = { drugs_deleted: 0, drugs_kept_inactive: 0, batches_deleted: 0, batches_zeroed: 0, units_removed: 0, cleared: [] };
  const delBatch = db.prepare('DELETE FROM drug_stock_batches WHERE id=?');
  const zeroBatch = db.prepare('UPDATE drug_stock_batches SET qty_remaining=0, is_active=0 WHERE id=?');
  const delDrug = db.prepare('DELETE FROM drug_master WHERE id=?');
  const retire = db.prepare("UPDATE drug_master SET is_active=0, updated_at=datetime('now') WHERE id=?");
  db.transaction(() => {
    for (const p of plansFor(db, ids)) {
      for (const b of p.batches) {
        let deleted = false;
        if (!b.sold) {
          try { delBatch.run(b.id); deleted = true; } catch { /* something still points at it: fall through and keep it */ }
        }
        if (deleted) out.batches_deleted++; else { zeroBatch.run(b.id); out.batches_zeroed++; }
        if (b.active) out.units_removed += b.qty;
        out.cleared.push([b.id, b.qty]);
      }
      let gone = false;
      if (p.erasable) {
        try { delDrug.run(p.id); gone = true; } catch { /* a record this code does not know about points at it: keep the drug */ }
      }
      if (gone) out.drugs_deleted++; else { retire.run(p.id); out.drugs_kept_inactive++; }
    }
  })();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Selling (FEFO) — cost is frozen on every slice that leaves the shelf
// ---------------------------------------------------------------------------------------------

export interface SellItemIn {
  drug_id?: number | null;
  drug_master_id?: number | null;
  drug_name: string;
  qty: number;
  rate: number;
  gst_amount?: number;
}

export interface SellIn {
  client_ref?: string | null;
  patient_id?: number | null;
  /** Name of a walk-in / guest customer, when no registered patient is picked. Ignored when patient_id is set. */
  customer_name?: string | null;
  appointment_id?: number | null;
  items: SellItemIn[];
  /** Flat bill discount in rupees. */
  discount?: number;
  payment_mode?: string;
  sold_by?: string;
  /** Medicines on credit: a registered patient takes them now and pays later (all or part is left owing). Needs the
   *  Settings switch, and a registered patient so it is clear who owes. */
  credit?: boolean;
  /** With `credit`: what is paid now (default 0). The rest stays owing. */
  paid_now?: number;
  /** Medicines for an admitted patient, charged on that stay's in-patient bill instead of being paid for at the counter.
   *  Handled by chargeMedicinesToAdmission (ipd-billing-ipc.ts); sellItems itself only knows the resulting 'IPD-bill' mode. */
  ipd_admission_id?: number | null;
  /**
   * The most, as a percent of the sale, the person making it may discount (their role's limit — Settings → Billing → Discounts
   * → "At the pharmacy counter"). SET BY THE MAIN PROCESS from the signed-in user; whatever a screen sends here is overwritten.
   * null / undefined = no limit applies.
   */
  max_discount_pct?: number | null;
}

/**
 * Medicines charged to an in-patient are priced at the SELLING price of the batch each unit comes out of — that batch's own selling price,
 * else its MRP — and nothing a screen sends can change it (the rate it sends is ignored). A line whose units span batches with different
 * prices becomes one line per price, in the same earliest-expiry-first order sellItems draws stock in, so every unit is priced as it is
 * taken. (If stock is short, the remainder is left for sellItems to refuse in its usual words.) `changed` counts the lines whose rate was
 * not the one the screen sent — worth knowing in the audit log.
 */
export function priceAtBatchSellingPrice(db: Database.Database, items: SellItemIn[]): { items: SellItemIn[]; changed: number } {
  const free = new Map<number, number>();                 // units of each batch still free as this sale draws on it
  const fetch = db.prepare(`
    SELECT b.id, b.qty_remaining, COALESCE(b.selling_price, b.mrp) AS price
      FROM drug_stock_batches b
     WHERE b.drug_master_id = ? AND b.is_active = 1 AND b.qty_remaining > 0
     ORDER BY date(b.expiry) ASC, b.received_at ASC`);
  const out: SellItemIn[] = [];
  let changed = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const masterId = it.drug_master_id ?? it.drug_id ?? null;
    const qty = Number(it.qty);
    if (!masterId || !(qty > 0)) { out.push(it); continue; }          // sellItems reports a bad line in its own words
    let need = qty;
    const groups: { price: number; qty: number }[] = [];
    for (const b of fetch.all(masterId) as { id: number; qty_remaining: number; price: number }[]) {
      if (need <= 0) break;
      const left = free.has(b.id) ? (free.get(b.id) as number) : b.qty_remaining;
      const take = Math.min(need, left);
      if (take <= 0) continue;
      free.set(b.id, left - take);
      const price = r2(Number(b.price) || 0);
      const last = groups[groups.length - 1];
      if (last && last.price === price) last.qty += take; else groups.push({ price, qty: take });
      need -= take;
    }
    if (need > 0) groups.push({ price: groups.length ? groups[groups.length - 1].price : r2(Number(it.rate) || 0), qty: need });
    if (groups.length !== 1 || Math.abs(groups[0].price - Number(it.rate)) > 0.004) changed++;
    for (const g of groups) out.push({ ...it, qty: g.qty, rate: g.price, gst_amount: undefined });
  }
  return { items: out, changed };
}

/**
 * Sell the lines, drawing stock earliest-expiry-first. One line may span several batches; each slice
 * gets its own dispensing-register row carrying the batch's unit cost at that moment. Everything runs
 * in one transaction: a shortage anywhere rolls the whole sale back.
 */
export function sellItems(db: Database.Database, payload: SellIn, now: Date = new Date()) {
  const ref = clean(payload?.client_ref);
  if (ref) {
    const hit = db.prepare('SELECT * FROM pharmacy_sales WHERE client_ref=?').get(ref);
    if (hit) return hit as any;
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) throw new Error('Add at least one medicine to the bill.');
  items.forEach((it, i) => {
    const q = Number(it.qty);
    const rt = Number(it.rate);
    if (!Number.isFinite(q) || q <= 0) throw new Error(`Line ${i + 1} (${it.drug_name || 'medicine'}): enter a quantity above zero.`);
    if (!Number.isFinite(rt) || rt < 0) throw new Error(`Line ${i + 1} (${it.drug_name || 'medicine'}): the rate cannot be negative.`);
  });

  const amountsP = items.map((it) => toPaise(Number(it.qty) * Number(it.rate)));
  const subtotalP = amountsP.reduce((s, x) => s + x, 0);
  const discountP = toPaise(payload.discount ?? 0);
  if (discountP < 0) throw new Error('The discount cannot be negative.');
  if (discountP > subtotalP) throw new Error(`The discount (${rupees(fromPaise(discountP))}) is more than the bill value (${rupees(fromPaise(subtotalP))}).`);
  if (payload.max_discount_pct !== null && payload.max_discount_pct !== undefined && Number.isFinite(Number(payload.max_discount_pct))) {
    const pct = Math.max(0, Math.min(100, Number(payload.max_discount_pct)));
    const limitP = capPaise(subtotalP, pct);
    if (discountP > limitP) {
      throw new Error(
        `Your role may give up to ${pct}% off at the pharmacy counter — ${rupees(fromPaise(limitP))} on this ${rupees(fromPaise(subtotalP))} sale. ` +
        `The discount here is ${rupees(fromPaise(discountP))}. Ask a manager or administrator to give the larger discount, or raise the limit in Settings → Billing → Discounts.`,
      );
    }
  }
  const discountShare = allocatePaise(discountP, amountsP);

  // Look up the prescribing doctor + an Rx reference once, for the register.
  let doctorId: number | null = null;
  let rxReference: string | null = null;
  if (payload.appointment_id) {
    const a = db.prepare(
      `SELECT a.doctor_id, a.appointment_date, a.appointment_time, d.name AS doctor_name
         FROM appointments a JOIN doctors d ON d.id=a.doctor_id WHERE a.id=?`,
    ).get(payload.appointment_id) as any;
    if (a) {
      doctorId = a.doctor_id;
      rxReference = `Rx ${a.appointment_date} ${a.appointment_time} · ${a.doctor_name}`;
    }
  }
  // How much of the bill is received at the counter. Ordinary sale: all of it. On credit: only what was paid now.
  const totalP = subtotalP - discountP;
  let amountPaidP = totalP;
  let onCredit = 0;
  let paymentMode = payload.payment_mode ?? null;
  if (paymentMode === 'IPD-bill') {
    amountPaidP = 0;                                  // charged on the in-patient bill — nothing is taken at the counter
  } else if (payload.credit) {
    if (!getAllSettings(db).pharmacy_credit_enabled) {
      throw new Error('Medicines on credit are switched off. Turn them on in Settings → Billing & IPD → Pharmacy, or take the payment now.');
    }
    if (!payload.patient_id) {
      throw new Error('A sale on credit needs a registered patient, so it is clear who owes the money. Pick the patient, or take the payment now.');
    }
    if (!db.prepare('SELECT id FROM patients WHERE id=?').get(payload.patient_id)) {
      throw new Error('That patient was not found — pick the patient again.');
    }
    const nowP = toPaise(payload.paid_now ?? 0);
    if (nowP < 0) throw new Error('The amount paid now cannot be negative.');
    if (nowP > totalP) throw new Error(`The amount paid now (${rupees(fromPaise(nowP))}) is more than the bill (${rupees(fromPaise(totalP))}).`);
    if (nowP < totalP) {                               // paying all of it now is not a credit sale
      onCredit = 1;
      amountPaidP = nowP;
      paymentMode = nowP > 0 ? (payload.payment_mode || 'Cash') : 'Credit';
    }
  }
  const saleNumber = nextSaleNumber(db, now);
  // A guest's name is kept so even a walk-in sale is accountable by name; a registered patient needs no separate name.
  const guestName = payload.patient_id ? null : (clean(payload.customer_name)?.slice(0, 80) ?? null);

  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode, sold_by, client_ref, customer_name, amount_paid, on_credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      saleNumber, payload.patient_id ?? null, payload.appointment_id ?? null,
      fromPaise(subtotalP), fromPaise(discountP), fromPaise(totalP),
      paymentMode, payload.sold_by ?? null, ref, guestName, fromPaise(amountPaidP), onCredit,
    );
    const saleId = Number(info.lastInsertRowid);

    const insSaleItem = db.prepare(`
      INSERT INTO pharmacy_sale_items
        (sale_id, drug_id, drug_master_id, batch_id, drug_name, qty, rate, amount, gst_amount,
         gst_rate, cgst, sgst, hsn_sac, discount_alloc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insRegister = db.prepare(`
      INSERT INTO dispensing_register
        (sale_item_id, sale_id, patient_id, doctor_id, drug_master_id, batch_id,
         batch_no, expiry, schedule, qty, rate, unit_cost, rx_reference, dispensed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const decrementBatch = db.prepare('UPDATE drug_stock_batches SET qty_remaining = qty_remaining - ? WHERE id=?');
    const fetchBatches = db.prepare(`
      SELECT b.id, b.batch_no, b.expiry, b.qty_remaining, m.schedule,
             COALESCE(b.unit_cost, b.purchase_price) AS cost
        FROM drug_stock_batches b
        JOIN drug_master m ON m.id=b.drug_master_id
       WHERE b.drug_master_id=? AND b.is_active=1 AND b.qty_remaining > 0
       ORDER BY date(b.expiry) ASC, b.received_at ASC
    `);

    let saleTaxable = 0, saleExempt = 0, saleCgst = 0, saleSgst = 0;
    items.forEach((it, idx) => {
      const masterId = it.drug_master_id ?? it.drug_id ?? null;
      const amount = fromPaise(amountsP[idx]);
      const batches = masterId
        ? (fetchBatches.all(masterId) as Array<{ id: number; batch_no: string; expiry: string; qty_remaining: number; schedule: string; cost: number | null }>)
        : [];
      const firstBatchId = batches[0]?.id ?? null;
      // An Indian MRP is tax-INCLUSIVE: the GST is extracted from the amount, never added on top. It is extracted from
      // what the customer actually pays for the line — AFTER its share of any bill discount — so the tax breakdown on the
      // receipt adds up to the total (it used to be worked out on the undiscounted price and overstated the GST).
      const mtax = medicineLineTax(db, masterId);
      const payable = fromPaise(amountsP[idx] - discountShare[idx]);
      const split = splitInclusive(payable, mtax.gst_rate);
      saleTaxable += mtax.is_taxable ? split.net : 0;
      saleExempt += mtax.is_taxable ? 0 : payable;
      saleCgst += split.cgst;
      saleSgst += split.sgst;
      // drug_id is the LEGACY column (FKs the old drug_inventory table); the real link is drug_master_id.
      const saleItemInfo = insSaleItem.run(
        saleId, null, masterId, firstBatchId,
        it.drug_name, it.qty, it.rate, amount,
        r2(it.gst_amount ?? (split.cgst + split.sgst)),
        mtax.gst_rate, split.cgst, split.sgst, mtax.hsn_sac, fromPaise(discountShare[idx]),
      );
      const saleItemId = Number(saleItemInfo.lastInsertRowid);

      if (masterId) {
        let need = Number(it.qty);
        for (const b of batches) {
          if (need <= 0) break;
          const take = Math.min(need, b.qty_remaining);
          decrementBatch.run(take, b.id);
          insRegister.run(
            saleItemId, saleId, payload.patient_id ?? null, doctorId,
            masterId, b.id, b.batch_no, b.expiry, b.schedule || 'OTC',
            take, it.rate, b.cost ?? null, rxReference, payload.sold_by ?? null,
          );
          need -= take;
        }
        if (need > 0) throw new Error(`Insufficient stock for ${it.drug_name} — short by ${need}`);
      }
    });

    // Roll the per-line tax up onto the sale so the receipt (and any reprint) can show a proper
    // CGST/SGST breakdown without recomputing from stock.
    const ctx = gstContext(db);
    db.prepare(
      'UPDATE pharmacy_sales SET taxable_total=?, exempt_total=?, cgst_total=?, sgst_total=?, is_tax_invoice=? WHERE id=?',
    ).run(
      r2(saleTaxable), r2(saleExempt), r2(saleCgst), r2(saleSgst),
      ctx.enabled && (saleCgst + saleSgst) > 0 ? 1 : 0, saleId,
    );
    return saleId;
  });
  const id = tx();
  return db.prepare('SELECT * FROM pharmacy_sales WHERE id=?').get(id) as any;
}

// ---------------------------------------------------------------------------------------------
// Counter sales as the Billing screen sees them
// ---------------------------------------------------------------------------------------------

/** SQL: what a sale (alias `s`) still owes. An ordinary sale — and every sale made before credit existed — owes nothing. */
export const SALE_DUE_SQL = "(CASE WHEN COALESCE(s.payment_mode, '') = 'IPD-bill' THEN 0 ELSE MAX(s.total - COALESCE(s.amount_paid, s.total), 0) END)";

/**
 * Pharmacy sales made at the counter or against a prescription — NOT the ones dispensed on a ward (those are part
 * of the patient's IPD bill and would be counted twice). Money totals cover the whole filtered set, not just the
 * rows returned.
 */
export function listCounterSales(db: Database.Database, f: CounterSalesFilter = {}): CounterSalesResult {
  const conds: string[] = ["COALESCE(s.payment_mode, '') <> 'IPD-bill'"];
  const params: any[] = [];
  if (f.from) { conds.push("date(s.created_at, 'localtime') >= ?"); params.push(f.from); }
  if (f.to) { conds.push("date(s.created_at, 'localtime') <= ?"); params.push(f.to); }
  if (f.scope === 'patient') conds.push('s.patient_id IS NOT NULL');
  else if (f.scope === 'guest') conds.push('s.patient_id IS NULL');
  else if (f.scope === 'credit') conds.push(`${SALE_DUE_SQL} > 0.004`);
  const q = clean(f.q);
  if (q) {
    conds.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR s.customer_name LIKE ? OR s.sale_number LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const rows = db.prepare(`
    SELECT s.id, s.sale_number, s.created_at, s.subtotal, s.discount, s.total, s.payment_mode, s.sold_by,
           s.patient_id, (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid, s.customer_name,
           (SELECT COUNT(*) FROM pharmacy_sale_items si WHERE si.sale_id = s.id) AS item_count,
           COALESCE(s.amount_paid, s.total) AS amount_paid, ${SALE_DUE_SQL} AS due, s.on_credit
      FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id
      ${where}
     ORDER BY s.created_at DESC, s.id DESC LIMIT ?
  `).all(...params, Math.min(Math.max(Number(f.limit) || 500, 1), 2000)) as CounterSaleRow[];
  const byMode = db.prepare(`
    SELECT COALESCE(s.payment_mode, '—') AS mode, COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS total, COALESCE(SUM(s.discount), 0) AS discount,
           COALESCE(SUM(${SALE_DUE_SQL}), 0) AS due, SUM(CASE WHEN ${SALE_DUE_SQL} > 0.004 THEN 1 ELSE 0 END) AS due_count
      FROM pharmacy_sales s LEFT JOIN patients p ON p.id = s.patient_id
      ${where} GROUP BY mode ORDER BY total DESC
  `).all(...params) as { mode: string; count: number; total: number; discount: number; due: number; due_count: number }[];
  const sum = (k: 'total' | 'discount') => fromPaise(byMode.reduce((a, m) => a + toPaise(m[k]), 0));
  return {
    rows,
    totals: {
      count: byMode.reduce((a, m) => a + m.count, 0),
      total: sum('total'),
      discount: sum('discount'),
      by_mode: byMode.map((m) => ({ mode: m.mode, count: m.count, total: r2(m.total) })),
      credit_count: byMode.reduce((a, m) => a + (m.due_count || 0), 0),
      credit_due: fromPaise(byMode.reduce((a, m) => a + toPaise(m.due), 0)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Medicines on credit — taking the money later
// ---------------------------------------------------------------------------------------------

export interface CreditPaymentIn {
  amount: number;
  mode?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** One id per payment attempt: the same attempt sent twice is recorded once. */
  client_ref?: string | null;
}

/**
 * Take a payment against a pharmacy sale that was made on credit. Refuses a sale that is already settled, a payment
 * above what is still owed, and one that belongs on the in-patient bill; a repeat of the same attempt is recognised.
 */
export function payCredit(db: Database.Database, saleId: number, p: CreditPaymentIn, by?: string | null) {
  const ref = clean(p?.client_ref);
  if (ref) {
    const hit = db.prepare('SELECT sale_id FROM pharmacy_sale_payments WHERE client_ref=?').get(ref) as { sale_id: number } | undefined;
    if (hit) return { duplicate: true as const, sale_id: hit.sale_id, due: saleDue(db, hit.sale_id) };
  }
  const sale = db.prepare('SELECT id, sale_number, total, amount_paid, payment_mode FROM pharmacy_sales WHERE id=?').get(Number(saleId)) as any;
  if (!sale) throw new Error('That pharmacy sale was not found. Refresh the list and try again.');
  if (sale.payment_mode === 'IPD-bill') throw new Error(`${sale.sale_number} is charged on the in-patient bill — take the payment there.`);
  const amtP = toPaise(p?.amount);
  if (!(amtP > 0)) throw new Error('Enter an amount above zero.');
  const paidP = toPaise(sale.amount_paid ?? sale.total);
  const dueP = toPaise(sale.total) - paidP;
  if (dueP <= 0) throw new Error(`${sale.sale_number} is already paid in full — nothing more to collect.`);
  if (amtP > dueP) {
    throw new Error(`That is more than the ${rupees(fromPaise(dueP))} still owed on ${sale.sale_number}. Enter ${rupees(fromPaise(dueP))} or less.`);
  }
  db.transaction(() => {
    db.prepare(
      'INSERT INTO pharmacy_sale_payments (sale_id, amount, payment_mode, received_by, reference, notes, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(sale.id, fromPaise(amtP), clean(p.mode) ?? 'Cash', by ?? null, clean(p.reference), clean(p.notes), ref);
    db.prepare('UPDATE pharmacy_sales SET amount_paid=? WHERE id=?').run(fromPaise(paidP + amtP), sale.id);
  })();
  return { duplicate: false as const, sale_id: sale.id as number, due: fromPaise(dueP - amtP) };
}

/** The stay a patient is in right now, if any — what the counter needs to offer "charge to the in-patient bill". */
export function activeAdmissionFor(db: Database.Database, patientId: number) {
  const r = db.prepare(
    `SELECT id AS admission_id, admission_number, ward, bed_number, COALESCE(discharge_status, 'none') AS discharge_status
       FROM ip_admissions WHERE patient_id=? AND status='admitted' ORDER BY id DESC LIMIT 1`,
  ).get(Number(patientId)) as { admission_id: number; admission_number: string; ward: string | null; bed_number: string | null; discharge_status: string } | undefined;
  return r ?? null;
}

/** What a pharmacy sale still owes, in rupees (0 for an ordinary sale and for anything charged on a bill). */
export function saleDue(db: Database.Database, saleId: number): number {
  const r = db.prepare('SELECT total, amount_paid, payment_mode FROM pharmacy_sales WHERE id=?').get(Number(saleId)) as any;
  if (!r || r.payment_mode === 'IPD-bill') return 0;
  return Math.max(0, fromPaise(toPaise(r.total) - toPaise(r.amount_paid ?? r.total)));
}

// ---------------------------------------------------------------------------------------------
// "Cost not recorded"
// ---------------------------------------------------------------------------------------------

/**
 * Batches whose cost did not come from a purchase bill: typed in by hand, or starter stock an older version put on the
 * shelf. Their cost is whatever somebody entered — often a guess — so profit on them is only as good as that guess.
 */
const MANUAL_BATCH = 'purchase_item_id IS NULL AND COALESCE(unit_cost, purchase_price) IS NOT NULL';

export function costNotRecordedSummary(db: Database.Database): CostNotRecordedSummary {
  const b = db.prepare(`
    SELECT COUNT(*) AS batches,
           COALESCE(SUM(CASE WHEN qty_remaining > 0 THEN qty_remaining ELSE 0 END), 0) AS units_in_stock,
           COALESCE(SUM(CASE WHEN qty_remaining > 0 THEN qty_remaining * COALESCE(unit_cost, purchase_price) ELSE 0 END), 0) AS value_in_stock
      FROM drug_stock_batches WHERE ${MANUAL_BATCH}
  `).get() as { batches: number; units_in_stock: number; value_in_stock: number };
  const sold = db.prepare(`
    SELECT COALESCE(SUM(dr.qty), 0) AS units, COUNT(*) AS slices
      FROM dispensing_register dr
     WHERE dr.unit_cost IS NOT NULL AND dr.batch_id IN (SELECT id FROM drug_stock_batches WHERE purchase_item_id IS NULL)
  `).get() as { units: number; slices: number };
  return {
    batches: b.batches,
    units_in_stock: b.units_in_stock,
    value_in_stock: r2(b.value_in_stock),
    past_sale_units: sold.units,
    past_sale_slices: sold.slices,
  };
}

/**
 * Mark those batches "cost not recorded": their purchase price and unit cost are cleared, so stock value and profit
 * stop treating a guess as fact. Batches received through a purchase bill are never touched. With
 * `include_past_sales` the cost frozen on sales already made from these batches is cleared too, so past profit leaves
 * them out as well. Nothing is deleted; the previous figures are returned so the caller can write them to the audit log.
 */
export function clearManualCost(db: Database.Database, opts: { include_past_sales?: boolean } = {}) {
  let previous: { id: number; batch_no: string; drug_master_id: number; purchase_price: number | null; unit_cost: number | null }[] = [];
  let batches = 0, registerRows = 0;
  db.transaction(() => {
    previous = db.prepare(`SELECT id, batch_no, drug_master_id, purchase_price, unit_cost FROM drug_stock_batches WHERE ${MANUAL_BATCH} ORDER BY id`).all() as typeof previous;
    if (opts.include_past_sales) {
      registerRows = db.prepare(
        "UPDATE dispensing_register SET unit_cost = NULL WHERE unit_cost IS NOT NULL AND batch_id IN (SELECT id FROM drug_stock_batches WHERE purchase_item_id IS NULL)",
      ).run().changes;
    }
    batches = db.prepare(`UPDATE drug_stock_batches SET purchase_price = NULL, unit_cost = NULL WHERE ${MANUAL_BATCH}`).run().changes;
  })();
  return { batches, register_rows: registerRows, previous };
}

// ---------------------------------------------------------------------------------------------
// Profit report
// ---------------------------------------------------------------------------------------------

interface TotAcc {
  units: number; sales: Set<number>;
  grossP: number; discP: number; revenueP: number; costedRevenueP: number; cogsP: number;
  uncostedUnits: number; uncostedRevenueP: number; costedUnits: number;
}
const newAcc = (): TotAcc => ({
  units: 0, sales: new Set(), grossP: 0, discP: 0, revenueP: 0, costedRevenueP: 0, cogsP: 0,
  uncostedUnits: 0, uncostedRevenueP: 0, costedUnits: 0,
});
function totalsOf(a: TotAcc): ProfitTotals {
  const m = profitMetrics(fromPaise(a.costedRevenueP), fromPaise(a.cogsP));
  return {
    units: a.units, sales: a.sales.size,
    gross_amount: fromPaise(a.grossP), discount: fromPaise(a.discP), revenue: fromPaise(a.revenueP),
    costed_revenue: fromPaise(a.costedRevenueP), cogs: fromPaise(a.cogsP),
    profit: m.profit, margin_pct: m.marginPct, markup_pct: m.markupPct,
    uncosted_units: a.uncostedUnits, uncosted_revenue: fromPaise(a.uncostedRevenueP),
  };
}

export interface ProfitFilter { from: string; to: string }

export function profitReport(db: Database.Database, filter: ProfitFilter): ProfitReport {
  if (!isIsoDate(filter?.from) || !isIsoDate(filter?.to)) throw new Error('Choose a valid start and end date for the report.');
  const from = filter.from <= filter.to ? filter.from : filter.to;
  const to = filter.from <= filter.to ? filter.to : filter.from;
  const gst = gstContext(db);

  const lines = db.prepare(`
    SELECT si.id AS item_id, si.sale_id, si.drug_master_id, COALESCE(m.name, si.drug_name) AS name,
           si.qty, si.amount, COALESCE(si.discount_alloc, 0) AS discount_alloc,
           COALESCE(si.gst_rate, 0) AS gst_rate, COALESCE(si.cgst, 0) + COALESCE(si.sgst, 0) AS gst_collected,
           s.payment_mode, strftime('%Y-%m', s.created_at, 'localtime') AS month,
           (SELECT COALESCE(SUM(dr.qty), 0) FROM dispensing_register dr
             WHERE dr.sale_item_id = si.id AND dr.unit_cost IS NOT NULL) AS qty_costed,
           (SELECT COALESCE(SUM(dr.qty * dr.unit_cost), 0) FROM dispensing_register dr
             WHERE dr.sale_item_id = si.id AND dr.unit_cost IS NOT NULL) AS cogs
      FROM pharmacy_sale_items si
      JOIN pharmacy_sales s ON s.id = si.sale_id
      LEFT JOIN drug_master m ON m.id = si.drug_master_id
     WHERE date(s.created_at, 'localtime') BETWEEN ? AND ?
  `).all(from, to) as any[];

  const all = newAcc(), counter = newAcc(), ward = newAcc();
  const perDrug = new Map<string, { id: number | null; name: string; acc: TotAcc }>();
  const months = new Map<string, { revenueP: number; costedRevenueP: number; cogsP: number }>();

  for (const r of lines) {
    const qty = Number(r.qty) || 0;
    const grossP = toPaise(r.amount);
    const discP = toPaise(r.discount_alloc);
    const taxed = Number(r.gst_collected) > 0 && Number(r.gst_rate) > 0;
    const revenueP = toPaise(netRevenueExGst(r.amount, r.discount_alloc, taxed ? Number(r.gst_rate) : 0));
    const costed = qty > 0 && Number(r.qty_costed) >= qty - 1e-9;
    const cogsP = costed ? toPaise(r.cogs) : 0;
    const key = r.drug_master_id ? `d:${r.drug_master_id}` : `n:${r.name}`;
    if (!perDrug.has(key)) perDrug.set(key, { id: r.drug_master_id ?? null, name: r.name, acc: newAcc() });
    const channel = r.payment_mode === 'IPD-bill' ? ward : counter;
    for (const a of [all, channel, perDrug.get(key)!.acc]) {
      a.units += qty; a.sales.add(r.sale_id);
      a.grossP += grossP; a.discP += discP; a.revenueP += revenueP;
      if (costed) { a.costedRevenueP += revenueP; a.cogsP += cogsP; a.costedUnits += qty; }
      else { a.uncostedUnits += qty; a.uncostedRevenueP += revenueP; }
    }
    const mo = months.get(r.month) ?? { revenueP: 0, costedRevenueP: 0, cogsP: 0 };
    mo.revenueP += revenueP;
    if (costed) { mo.costedRevenueP += revenueP; mo.cogsP += cogsP; }
    months.set(r.month, mo);
  }

  // Stock on hand per medicine (a snapshot of now), so "no sales" / "slow" lists can see the shelf.
  const stock = db.prepare(`
    SELECT m.id, m.name,
           SUM(b.qty_remaining) AS units,
           SUM(CASE WHEN COALESCE(b.unit_cost, b.purchase_price) IS NOT NULL
                    THEN ROUND(b.qty_remaining * COALESCE(b.unit_cost, b.purchase_price), 2) ELSE 0 END) AS cost,
           MIN(date(b.expiry)) AS next_expiry
      FROM drug_master m
      JOIN drug_stock_batches b ON b.drug_master_id = m.id AND b.is_active = 1 AND b.qty_remaining > 0
     WHERE m.is_active = 1
     GROUP BY m.id
  `).all() as { id: number; name: string; units: number; cost: number; next_expiry: string | null }[];
  const stockById = new Map(stock.map((s) => [s.id, s]));

  const rowFor = (key: string, id: number | null, name: string, a: TotAcc): DrugProfitRow => {
    const m = profitMetrics(fromPaise(a.costedRevenueP), fromPaise(a.cogsP));
    const st = id ? stockById.get(id) : undefined;
    return {
      key, drug_master_id: id, name,
      units: a.units, sales: a.sales.size,
      gross_amount: fromPaise(a.grossP), discount: fromPaise(a.discP), revenue: fromPaise(a.revenueP),
      costed_units: a.costedUnits, costed_revenue: fromPaise(a.costedRevenueP), cogs: fromPaise(a.cogsP),
      profit: m.profit, margin_pct: m.marginPct, markup_pct: m.markupPct,
      gp_per_unit: a.costedUnits > 0 ? Math.round((m.profit / a.costedUnits) * 10000) / 10000 : null,
      avg_price: a.units > 0 ? Math.round((fromPaise(a.revenueP) / a.units) * 10000) / 10000 : null,
      avg_cost: a.costedUnits > 0 ? Math.round((fromPaise(a.cogsP) / a.costedUnits) * 10000) / 10000 : null,
      uncosted_units: a.uncostedUnits, uncosted_revenue: fromPaise(a.uncostedRevenueP),
      stock_units: st?.units ?? 0, stock_cost: r2(st?.cost ?? 0), next_expiry: st?.next_expiry ?? null,
    };
  };

  const drugs: DrugProfitRow[] = [];
  for (const [key, d] of perDrug) drugs.push(rowFor(key, d.id, d.name, d.acc));
  for (const s of stock) {
    if (!perDrug.has(`d:${s.id}`)) drugs.push(rowFor(`d:${s.id}`, s.id, s.name, newAcc()));
  }
  drugs.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  return {
    from, to,
    revenue_excludes_gst: gst.enabled,
    totals: totalsOf(all),
    counter: totalsOf(counter),
    ward: totalsOf(ward),
    by_month: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
      const pm = profitMetrics(fromPaise(m.costedRevenueP), fromPaise(m.cogsP));
      return { month, revenue: fromPaise(m.revenueP), cogs: fromPaise(m.cogsP), profit: pm.profit, margin_pct: pm.marginPct };
    }),
    drugs,
    rankings: rankProfit(drugs, 10),
  };
}

// ---------------------------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------------------------

export function valuation(db: Database.Database, today: string = localISO(), nearDays = 90): Valuation {
  const gst = gstContext(db);
  const batches = db.prepare(`
    SELECT b.id, b.drug_master_id, m.name, m.gst_rate, b.batch_no, b.expiry, b.qty_remaining AS qty,
           b.mrp, b.selling_price, COALESCE(b.unit_cost, b.purchase_price) AS cost
      FROM drug_stock_batches b
      JOIN drug_master m ON m.id = b.drug_master_id
     WHERE b.is_active = 1 AND b.qty_remaining > 0 AND m.is_active = 1
  `).all() as any[];
  const latest = new Map<number, number>(
    (db.prepare(`
      SELECT drug_master_id, unit_cost FROM (
        SELECT pii.drug_master_id, pii.unit_cost,
               ROW_NUMBER() OVER (PARTITION BY pii.drug_master_id ORDER BY date(pi.invoice_date) DESC, pii.id DESC) AS rn
          FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.invoice_id
         WHERE pii.unit_cost IS NOT NULL
      ) WHERE rn = 1
    `).all() as { drug_master_id: number; unit_cost: number }[]).map((x) => [x.drug_master_id, x.unit_cost]),
  );

  const bucket = () => ({ batches: 0, units: 0, costP: 0, mrpP: 0, spP: 0 });
  const sell = bucket(), exp = bucket(), near = bucket();
  let netSpP = 0, costedCostP = 0, costedNetSpP = 0, replacementP = 0, unknownBatches = 0, unknownUnits = 0;
  const skus = new Set<number>();
  const nearList: Valuation['near_expiry_list'] = [];
  const expList: Valuation['expired_list'] = [];

  for (const b of batches) {
    const qty = Number(b.qty);
    const known = b.cost !== null && b.cost !== undefined;
    const costP = known ? toPaise(qty * Number(b.cost)) : 0;
    const mrpP = toPaise(qty * Number(b.mrp));
    const spP = toPaise(qty * Number(b.selling_price ?? b.mrp));
    const days = daysBetween(today, b.expiry);
    const add = (x: ReturnType<typeof bucket>) => { x.batches++; x.units += qty; x.costP += costP; x.mrpP += mrpP; x.spP += spP; };
    if (!known) { unknownBatches++; unknownUnits += qty; }
    if (days < 0) {
      add(exp);
      expList.push({ drug: b.name, batch_no: b.batch_no, expiry: b.expiry, days, qty, at_cost: fromPaise(costP) });
      continue;
    }
    add(sell);
    skus.add(b.drug_master_id);
    const net = gst.enabled && b.gst_rate > 0 ? Math.round(spP / (1 + b.gst_rate / 100)) : spP;
    netSpP += net;
    if (known) { costedCostP += costP; costedNetSpP += net; }
    const rc = latest.get(b.drug_master_id);
    replacementP += toPaise(qty * (rc ?? (known ? Number(b.cost) : 0)));
    if (days <= nearDays) {
      add(near);
      nearList.push({ drug: b.name, batch_no: b.batch_no, expiry: b.expiry, days, qty, at_cost: fromPaise(costP) });
    }
  }
  const fin = (x: ReturnType<typeof bucket>): StockBucket => ({
    batches: x.batches, units: x.units, at_cost: fromPaise(x.costP), at_mrp: fromPaise(x.mrpP), at_selling: fromPaise(x.spP),
  });
  const m = profitMetrics(fromPaise(costedNetSpP), fromPaise(costedCostP));
  nearList.sort((a, b) => a.days - b.days);
  expList.sort((a, b) => a.days - b.days);
  return {
    as_of: today,
    revenue_excludes_gst: gst.enabled,
    sellable: {
      ...fin(sell), skus: skus.size,
      expected_revenue: fromPaise(netSpP),
      expected_profit: m.profit,
      expected_margin_pct: m.marginPct,
      at_replacement_cost: fromPaise(replacementP),
    },
    expired: fin(exp),
    near_expiry: { ...fin(near), days: nearDays },
    unknown_cost: { batches: unknownBatches, units: unknownUnits },
    near_expiry_list: nearList.slice(0, 30),
    expired_list: expList.slice(0, 30),
  };
}

// ---------------------------------------------------------------------------------------------
// Suppliers + price history
// ---------------------------------------------------------------------------------------------

export function supplierReport(db: Database.Database, filter: { from: string; to: string }): SupplierReport {
  if (!isIsoDate(filter?.from) || !isIsoDate(filter?.to)) throw new Error('Choose a valid start and end date for the report.');
  const { from, to } = filter;

  const suppliers = db.prepare(`
    SELECT w.id, w.name,
           COUNT(pi.id) AS invoices,
           COALESCE(SUM(pi.total), 0) AS billed,
           COALESCE(SUM(pi.discount), 0) AS discounts,
           COALESCE(SUM(pi.other_charges), 0) AS other_charges,
           COALESCE(SUM(CASE WHEN pi.amount_paid IS NOT NULL THEN pi.amount_paid ELSE 0 END), 0) AS paid,
           COALESCE(SUM(CASE WHEN pi.amount_paid IS NOT NULL THEN pi.total - pi.amount_paid ELSE 0 END), 0) AS outstanding,
           SUM(CASE WHEN pi.amount_paid IS NULL THEN 1 ELSE 0 END) AS unknown_paid
      FROM wholesalers w
      JOIN purchase_invoices pi ON pi.wholesaler_id = w.id AND date(pi.invoice_date) BETWEEN ? AND ?
     GROUP BY w.id ORDER BY billed DESC, w.name
  `).all(from, to) as any[];

  // What is owed to each supplier today, whatever the invoice date.
  const owedNow = db.prepare(`
    SELECT w.id, w.name,
           COALESCE(SUM(pi.total - pi.amount_paid), 0) AS outstanding,
           SUM(CASE WHEN pi.amount_paid IS NULL THEN 1 ELSE 0 END) AS unknown_paid,
           COUNT(*) AS open_invoices
      FROM wholesalers w
      JOIN purchase_invoices pi ON pi.wholesaler_id = w.id AND (pi.amount_paid IS NULL OR pi.total - pi.amount_paid > 0.004)
     GROUP BY w.id ORDER BY outstanding DESC
  `).all() as any[];

  const byMonth = db.prepare(`
    SELECT strftime('%Y-%m', pi.invoice_date) AS month, w.id AS wholesaler_id, w.name AS supplier,
           COUNT(*) AS invoices, COALESCE(SUM(pi.total), 0) AS billed, COALESCE(SUM(pi.discount), 0) AS discounts
      FROM purchase_invoices pi JOIN wholesalers w ON w.id = pi.wholesaler_id
     WHERE date(pi.invoice_date) BETWEEN ? AND ?
     GROUP BY month, w.id ORDER BY month, billed DESC
  `).all(from, to) as SupplierReport['by_month'];

  const payments = db.prepare(`
    SELECT pp.id, pp.paid_on, pp.amount, pp.payment_mode, pp.reference, pp.notes,
           pi.invoice_number, w.name AS supplier
      FROM purchase_payments pp
      JOIN purchase_invoices pi ON pi.id = pp.invoice_id
      JOIN wholesalers w ON w.id = pi.wholesaler_id
     WHERE date(pp.paid_on) BETWEEN ? AND ?
     ORDER BY date(pp.paid_on) DESC, pp.id DESC LIMIT 300
  `).all(from, to) as SupplierReport['payments'];

  const priceChanges = db.prepare(`
    SELECT * FROM (
      SELECT m.name AS drug, w.name AS supplier, pi.invoice_date AS date, pi.invoice_number,
             pii.purchase_price AS rate, pii.unit_cost,
             LAG(pii.purchase_price) OVER win AS prev_rate,
             LAG(pii.unit_cost) OVER win AS prev_unit_cost,
             LAG(pi.invoice_date) OVER win AS prev_date
        FROM purchase_invoice_items pii
        JOIN purchase_invoices pi ON pi.id = pii.invoice_id
        JOIN wholesalers w ON w.id = pi.wholesaler_id
        JOIN drug_master m ON m.id = pii.drug_master_id
      WINDOW win AS (PARTITION BY pi.wholesaler_id, pii.drug_master_id ORDER BY date(pi.invoice_date), pii.id)
    )
    WHERE prev_rate IS NOT NULL AND prev_rate > 0 AND ABS(rate - prev_rate) > 0.0049 AND date(date) BETWEEN ? AND ?
    ORDER BY ABS(rate - prev_rate) / prev_rate DESC, drug LIMIT 100
  `).all(from, to) as any[];

  const sum = (k: string) => suppliers.reduce((s, x) => s + toPaise(x[k]), 0);
  return {
    from, to,
    totals: {
      invoices: suppliers.reduce((s, x) => s + x.invoices, 0),
      billed: fromPaise(sum('billed')), discounts: fromPaise(sum('discounts')),
      paid: fromPaise(sum('paid')), outstanding_in_period: fromPaise(sum('outstanding')),
      owed_now: fromPaise(owedNow.reduce((s, x) => s + toPaise(x.outstanding), 0)),
    },
    suppliers: suppliers.map((s) => ({ ...s, billed: r2(s.billed), discounts: r2(s.discounts), paid: r2(s.paid), outstanding: r2(s.outstanding) })),
    owed_now: owedNow.map((s) => ({ ...s, outstanding: r2(s.outstanding) })),
    by_month: byMonth,
    payments,
    price_changes: priceChanges.map((c) => ({
      ...c, change_pct: Math.round(((c.rate - c.prev_rate) / c.prev_rate) * 10000) / 100,
    })),
    // The app has no purchase-return workflow, so there is nothing to report here — said plainly.
    purchase_returns: null,
  };
}

export function drugPriceHistory(db: Database.Database, drugId: number): PriceHistoryRow[] {
  const rows = db.prepare(`
    SELECT pi.invoice_date AS date, pi.invoice_number, w.name AS supplier, pii.batch_no,
           pii.qty_received, pii.free_qty, pii.purchase_price AS rate, pii.disc_pct,
           pii.unit_cost, pii.mrp, pii.selling_price, pii.gst_rate
      FROM purchase_invoice_items pii
      JOIN purchase_invoices pi ON pi.id = pii.invoice_id
      JOIN wholesalers w ON w.id = pi.wholesaler_id
     WHERE pii.drug_master_id = ?
     ORDER BY date(pi.invoice_date) ASC, pii.id ASC
  `).all(Number(drugId)) as any[];
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const pct = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? Math.round(((a - b) / b) * 10000) / 100 : null);
    return { ...r, rate_change_pct: prev ? pct(r.rate, prev.rate) : null, cost_change_pct: prev ? pct(r.unit_cost, prev.unit_cost) : null };
  });
}

// ---------------------------------------------------------------------------------------------
// Data-integrity checks
// ---------------------------------------------------------------------------------------------

/** Read-only sanity checks over the pharmacy ledger. Nothing is changed; each finding says what to look at. */
export function integrityChecks(db: Database.Database): IntegrityFinding[] {
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const out: IntegrityFinding[] = [];
  const add = (code: string, severity: IntegrityFinding['severity'], count: number, message: string) => {
    if (count > 0) out.push({ code, severity, count, message });
  };

  add('negative_stock', 'error', n('SELECT COUNT(*) AS c FROM drug_stock_batches WHERE qty_remaining < 0'),
    'Batches with negative stock — a sale was posted against stock that was never recorded as received.');
  add('register_mismatch', 'error', n(`
    SELECT COUNT(*) AS c FROM pharmacy_sale_items si
     WHERE si.drug_master_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM dispensing_register dr WHERE dr.sale_item_id = si.id)
       AND ABS(si.qty - (SELECT SUM(dr.qty) FROM dispensing_register dr WHERE dr.sale_item_id = si.id)) > 0.0001`),
    'Sale lines whose dispensing-register quantity does not match the quantity billed.');
  add('discount_unallocated', 'warning', n(`
    SELECT COUNT(*) AS c FROM pharmacy_sales s
     WHERE s.discount > 0
       AND ABS(s.discount - (SELECT COALESCE(SUM(si.discount_alloc), 0) FROM pharmacy_sale_items si WHERE si.sale_id = s.id)) > 0.005`),
    'Sales whose discount is not fully shared over their lines — profit by medicine will be slightly off for these.');
  add('payments_exceed_total', 'error', n(`
    SELECT COUNT(*) AS c FROM purchase_invoices pi
     WHERE (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments pp WHERE pp.invoice_id = pi.id) > pi.total + 0.005`),
    'Purchase bills with more payments recorded than the bill is worth.');
  add('status_mismatch', 'warning', n(`
    SELECT COUNT(*) AS c FROM purchase_invoices pi
     WHERE pi.amount_paid IS NOT NULL
       AND ((pi.payment_status = 'paid' AND pi.total - pi.amount_paid > 0.004)
         OR (pi.payment_status = 'unpaid' AND pi.amount_paid > 0.004))`),
    'Purchase bills whose paid/unpaid status disagrees with the payments recorded.');
  add('legacy_partial', 'info', n("SELECT COUNT(*) AS c FROM purchase_invoices WHERE amount_paid IS NULL"),
    'Purchase bills marked "partly paid" before payments were tracked — the amount paid is unknown until you enter it.');
  add('duplicate_invoices', 'warning', n(`
    SELECT COUNT(*) AS c FROM (
      SELECT 1 FROM purchase_invoices GROUP BY wholesaler_id, lower(trim(invoice_number)) HAVING COUNT(*) > 1)`),
    'The same supplier invoice number appears more than once — possible double entry (stock would be counted twice).');
  add('credit_overpaid', 'error', n(`
    SELECT COUNT(*) AS c FROM pharmacy_sales s
     WHERE COALESCE(s.payment_mode, '') <> 'IPD-bill' AND s.amount_paid IS NOT NULL AND s.amount_paid > s.total + 0.01`),
    'Some pharmacy sales show more received than their total — check Pharmacy → Sales.');
  add('credit_payments_exceed_paid', 'error', n(`
    SELECT COUNT(*) AS c FROM pharmacy_sales s
     WHERE (SELECT COALESCE(SUM(amount), 0) FROM pharmacy_sale_payments p WHERE p.sale_id = s.id) > COALESCE(s.amount_paid, s.total) + 0.01`),
    'Some credit payments add up to more than the sale shows as received — the sale and its payments disagree.');
  add('uncosted_stock', 'info', n(`
    SELECT COUNT(*) AS c FROM drug_stock_batches
     WHERE is_active = 1 AND qty_remaining > 0 AND COALESCE(unit_cost, purchase_price) IS NULL`),
    'Batches in stock with no cost recorded — they are left out of stock value and profit.');
  add('uncosted_sales', 'info', n('SELECT COUNT(*) AS c FROM dispensing_register WHERE unit_cost IS NULL'),
    'Dispensed slices with no cost recorded — their profit cannot be worked out.');
  add('manual_cost_stock', 'info', n(`
    SELECT COUNT(*) AS c FROM drug_stock_batches
     WHERE is_active = 1 AND qty_remaining > 0 AND purchase_item_id IS NULL AND COALESCE(unit_cost, purchase_price) IS NOT NULL`),
    'Batches in stock typed in by hand (not received through a purchase bill) — their cost is whatever was entered, so profit on them is only as good as that figure. Receive stock through Purchases for true cost, or use Pharmacy → Drugs in my clinic → "Cost not recorded" to stop counting the guess.');
  return out;
}
