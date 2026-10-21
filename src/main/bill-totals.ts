/**
 * ONE place that totals a bill and adds a line to it.
 *
 * Every bill — OPD, Services, Laboratory, Radiology, Quick Bill, in-patient — now gets its subtotal, discount, GST,
 * round-off and total from this file (through the engine in billing-engine.ts). Before, only in-patient and Quick bills did;
 * the others did their own arithmetic (no round-off, no tax), so the first time such a bill was printed it was re-totalled
 * and could come out ₹0.50 different from what the patient had already paid.
 *
 * A bill is never rewritten by merely LOOKING at it (except a running in-patient bill, which keeps accruing): once issued it
 * keeps its stored totals when previewed or printed, whatever settings change later. Anything that really changes a bill passes `force`.
 */
import type Database from 'better-sqlite3';
import { getAllSettings } from '../db/settings';
import { computeBill, money, type BillLineInput } from './billing-engine';
import { gstContext } from './gst';

export interface BillGstRule {
  /** Tax is charged on this bill right now. */
  enabled: boolean;
}

/**
 * Is GST charged on this bill? The clinic must be GST-registered (regular, not composition) — and for an in-patient bill the
 * "GST on in-patient bills" switch must be on as well. One rule, used by every bill and every medicine line.
 */
export function billGstEnabled(db: Database.Database, bill: { bill_type?: string | null; admission_id?: number | null }): boolean {
  const ctx = gstContext(db);
  if (!ctx.enabled) return false;
  const inPatient = bill.admission_id != null || bill.bill_type === 'ipd';
  return inPatient ? getAllSettings(db).ipd_gst_enabled !== false : true;
}

const discountValueOf = (subtotal: number, discount: number, type: string | null) =>
  money(Math.min(Math.max(type === 'percent' ? (subtotal * (discount || 0)) / 100 : (discount || 0), 0), subtotal));

/** Recompute and persist a bill's totals from its current lines. */
export function recalcBill(db: Database.Database, billId: number, opts: { force?: boolean } = {}) {
  const bill = db
    .prepare(
      `SELECT id, discount, discount_type, status, bill_type, admission_id, finalized_at, cancelled_at, amount_paid,
              subtotal, total, taxable_total, exempt_total, cgst_total, sgst_total, round_off, is_tax_invoice
         FROM bills WHERE id=?`
    )
    .get(billId) as any;
  if (!bill) throw new Error(`Cannot recalculate: bill #${billId} was not found.`);

  const rows = db
    .prepare('SELECT id, description, qty, rate, amount, gst_rate, is_taxable, tax_inclusive FROM bill_items WHERE bill_id=? ORDER BY id')
    .all(billId) as any[];

  const isIpd = bill.admission_id != null || bill.bill_type === 'ipd';
  // Only a RUNNING in-patient bill is re-totalled by being looked at (its days and medicines keep accruing). Every other bill is
  // totalled when it is written — by whoever writes it, with `force` — and then reads exactly as issued, even if a setting such
  // as round-off or GST is changed later. (Looking at an unpaid bill used to re-total it with today's settings.)
  const frozen = !opts.force && (!isIpd || bill.status === 'cancelled' || !!bill.cancelled_at || !!bill.finalized_at);

  /**
   * A bill with no line ROWS is not a bill worth zero — and a settled one is not re-totalled by being looked at. Return
   * what is stored instead of overwriting it. (items_json-only bills are converted to real rows at startup; until then
   * their stored totals are the truth.)
   */
  if (rows.length === 0 || frozen) {
    const subtotal = Number(bill.subtotal) || 0;
    return {
      lines: [] as any[],
      subtotal,
      total: Number(bill.total) || 0,
      taxableTotal: Number(bill.taxable_total) || 0,
      exemptTotal: Number(bill.exempt_total) || 0,
      cgstTotal: Number(bill.cgst_total) || 0,
      sgstTotal: Number(bill.sgst_total) || 0,
      roundOff: Number(bill.round_off) || 0,
      isTaxInvoice: !!bill.is_tax_invoice,
      discountValue: discountValueOf(subtotal, Number(bill.discount) || 0, bill.discount_type),
      grossTotal: Number(bill.total) || 0,
    };
  }

  const s = getAllSettings(db);
  const totals = computeBill(
    rows.map((r) => ({
      description: r.description,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      gst_rate: r.gst_rate,
      is_taxable: !!r.is_taxable,
      tax_inclusive: !!r.tax_inclusive,
    })),
    {
      discount: bill.discount,
      discount_type: bill.discount_type,
      // One rule for "is tax charged here" (registered, not composition, and — in the ward — the in-patient switch).
      gstEnabled: billGstEnabled(db, bill),
      roundOff: s.bill_round_off,
    }
  );

  // Persist the per-line tax split so the printed invoice matches to the paisa.
  const updLine = db.prepare('UPDATE bill_items SET cgst=?, sgst=? WHERE id=?');
  totals.lines.forEach((l, i) => updLine.run(l.cgst, l.sgst, rows[i].id));

  db.prepare(
    `UPDATE bills SET subtotal=?, total=?, taxable_total=?, exempt_total=?,
       cgst_total=?, sgst_total=?, round_off=?, is_tax_invoice=? WHERE id=?`
  ).run(
    totals.subtotal, totals.total, totals.taxableTotal, totals.exemptTotal,
    totals.cgstTotal, totals.sgstTotal, totals.roundOff, totals.isTaxInvoice ? 1 : 0, billId
  );

  return totals;
}

/** Add one line to a bill. A GST rate outside 0–28% is refused (it would be a typing slip, never a real rate). */
export function addLine(db: Database.Database, billId: number, line: BillLineInput, by?: string): number {
  const amount = money(line.amount !== undefined ? line.amount : (line.qty || 1) * (line.rate || 0));
  const gst = Number(line.gst_rate ?? 0);
  if (!Number.isFinite(gst) || gst < 0 || gst > 28) {
    throw new Error(`The GST rate on "${line.description}" must be between 0 and 28 percent (received ${JSON.stringify(line.gst_rate)}).`);
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO bill_items (bill_id, charge_head_id, description, qty, rate, amount,
                                 hsn_sac, gst_rate, is_taxable, tax_inclusive, source, source_ref_id, accrual_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        billId, line.charge_head_id ?? null, line.description,
        line.qty ?? 1, line.rate ?? 0, amount,
        line.hsn_sac ?? null, gst, line.is_taxable ? 1 : 0, line.tax_inclusive ? 1 : 0,
        line.source ?? 'manual', line.source_ref_id ?? null, line.accrual_date ?? null, by ?? null
      );
    return Number(info.lastInsertRowid);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('idx_bill_items_accrual_once')) {
      // The partial unique index caught a repeat post — expected, not an error.
      throw new Error(
        `"${line.description}" has already been charged for ${line.accrual_date}. ` +
        `Automatic charges post once per day; edit the existing line instead of adding another.`
      );
    }
    throw new Error(`Could not add "${line.description}" to bill #${billId}: ${msg}`);
  }
}
