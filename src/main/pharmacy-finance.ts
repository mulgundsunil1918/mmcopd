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
import { gstContext, medicineLineTax, splitInclusive } from './gst';
import {
  allocatePaise, blendUnitCost, computePurchase, fromPaise, netRevenueExGst, profitMetrics,
  r2, toPaise, validatePurchase,
} from '../lib/pharmacyMath';
import {
  rankProfit,
  type DrugProfitRow, type IntegrityFinding, type PriceHistoryRow, type ProfitReport, type ProfitTotals,
  type StockBucket, type SupplierReport, type Valuation,
} from '../lib/pharmacyReports';

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
  appointment_id?: number | null;
  items: SellItemIn[];
  /** Flat bill discount in rupees. */
  discount?: number;
  payment_mode?: string;
  sold_by?: string;
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
  const saleNumber = nextSaleNumber(db, now);

  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode, sold_by, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      saleNumber, payload.patient_id ?? null, payload.appointment_id ?? null,
      fromPaise(subtotalP), fromPaise(discountP), fromPaise(subtotalP - discountP),
      payload.payment_mode ?? null, payload.sold_by ?? null, ref,
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
  add('uncosted_stock', 'info', n(`
    SELECT COUNT(*) AS c FROM drug_stock_batches
     WHERE is_active = 1 AND qty_remaining > 0 AND COALESCE(unit_cost, purchase_price) IS NULL`),
    'Batches in stock with no cost recorded — they are left out of stock value and profit.');
  add('uncosted_sales', 'info', n('SELECT COUNT(*) AS c FROM dispensing_register WHERE unit_cost IS NULL'),
    'Dispensed slices with no cost recorded — their profit cannot be worked out.');
  add('manual_cost_stock', 'info', n(`
    SELECT COUNT(*) AS c FROM drug_stock_batches
     WHERE is_active = 1 AND qty_remaining > 0 AND purchase_item_id IS NULL AND COALESCE(unit_cost, purchase_price) IS NOT NULL`),
    'Batches in stock typed in by hand (not received through a purchase bill) — their cost is whatever was entered, so profit on them is only as good as that figure. Receive stock through Purchases for true cost.');
  return out;
}
