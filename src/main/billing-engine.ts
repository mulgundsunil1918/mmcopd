/**
 * Bill arithmetic — pure functions, no database access, so the money maths can
 * be tested on its own.
 *
 * GST context this encodes (India):
 *   - Clinical services by a recognised practitioner are EXEMPT
 *     (Notification 12/2017). Consultations must not be taxed.
 *   - Medicines dispensed ARE taxable at the rate on the drug master.
 *   - A single bill may therefore carry both exempt and taxable lines, and must
 *     show those subtotals separately.
 *   - Intra-state supply splits tax into CGST + SGST at half the rate each.
 *     Inter-state would be IGST, but a clinic treats patients on its own
 *     premises, so supply is intra-state and IGST is not modelled.
 *   - A bill with no taxable line is a Bill of Supply, not a Tax Invoice.
 */

export interface BillLineInput {
  description: string;
  qty: number;
  rate: number;
  /** Explicit amount wins over qty x rate when supplied (e.g. a migrated line). */
  amount?: number;
  gst_rate?: number;
  is_taxable?: boolean;
  hsn_sac?: string | null;
  charge_head_id?: number | null;
  source?: string;
  source_ref_id?: number | null;
  accrual_date?: string | null;
}

export interface ComputedLine extends BillLineInput {
  amount: number;
  is_taxable: boolean;
  gst_rate: number;
  cgst: number;
  sgst: number;
}

export interface BillTotals {
  lines: ComputedLine[];
  /** Sum of every line before discount. */
  subtotal: number;
  discountValue: number;
  /** Post-discount value of exempt lines. */
  exemptTotal: number;
  /** Post-discount taxable value, excluding tax itself. */
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  /** taxable + exempt + tax, before rounding. */
  grossTotal: number;
  roundOff: number;
  total: number;
  /** True when at least one line carries tax — decides Tax Invoice vs Bill of Supply. */
  isTaxInvoice: boolean;
}

export interface BillOptions {
  discount?: number;
  discount_type?: 'flat' | 'percent';
  /** Master GST switch. When false nothing is taxed regardless of line flags. */
  gstEnabled?: boolean;
  roundOff?: boolean;
}

/** Round to 2dp without binary-float drift (0.1 + 0.2 style errors). */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute a whole bill.
 *
 * Discount is applied proportionally across lines BEFORE tax, so tax is charged
 * on the amount actually payable. Applying tax first and then discounting would
 * overstate the tax collected and misreport GST.
 */
export function computeBill(inputLines: BillLineInput[], opts: BillOptions = {}): BillTotals {
  const gstEnabled = opts.gstEnabled !== false;

  const base = inputLines.map((l) => {
    const qty = Number.isFinite(l.qty) ? l.qty : 1;
    const rate = Number.isFinite(l.rate) ? l.rate : 0;
    const amount = money(l.amount !== undefined ? l.amount : qty * rate);
    return { ...l, qty, rate, amount };
  });

  const subtotal = money(base.reduce((s, l) => s + l.amount, 0));

  const rawDiscount =
    opts.discount_type === 'percent'
      ? (subtotal * (opts.discount ?? 0)) / 100
      : (opts.discount ?? 0);
  // Never discount below zero, and never more than the bill is worth.
  const discountValue = money(Math.min(Math.max(rawDiscount, 0), subtotal));

  // Proportional share of the discount per line.
  const factor = subtotal > 0 ? (subtotal - discountValue) / subtotal : 1;

  let exemptTotal = 0;
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;

  const lines: ComputedLine[] = base.map((l) => {
    const taxable = gstEnabled && l.is_taxable === true && (l.gst_rate ?? 0) > 0;
    const gst_rate = taxable ? (l.gst_rate ?? 0) : 0;
    const netAmount = money(l.amount * factor);

    let cgst = 0;
    let sgst = 0;
    if (taxable) {
      const tax = money((netAmount * gst_rate) / 100);
      // Split the rounded total so cgst + sgst always equals it exactly;
      // halving first and rounding twice can drift by a paisa.
      cgst = money(tax / 2);
      sgst = money(tax - cgst);
      taxableTotal += netAmount;
      cgstTotal += cgst;
      sgstTotal += sgst;
    } else {
      exemptTotal += netAmount;
    }

    return { ...l, is_taxable: taxable, gst_rate, cgst, sgst };
  });

  exemptTotal = money(exemptTotal);
  taxableTotal = money(taxableTotal);
  cgstTotal = money(cgstTotal);
  sgstTotal = money(sgstTotal);

  const grossTotal = money(exemptTotal + taxableTotal + cgstTotal + sgstTotal);
  const rounded = opts.roundOff !== false ? Math.round(grossTotal) : grossTotal;
  const roundOff = money(rounded - grossTotal);

  return {
    lines,
    subtotal,
    discountValue,
    exemptTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    grossTotal,
    roundOff,
    total: money(rounded),
    isTaxInvoice: lines.some((l) => l.is_taxable),
  };
}

/**
 * Bed-days between admission and discharge.
 *
 * Counts calendar days, with a same-day stay billed as one day — a patient
 * admitted and discharged the same afternoon still occupied a bed.
 */
export function bedDays(admittedAt: string, dischargedAt?: string | null): number {
  const start = new Date(admittedAt);
  const end = dischargedAt ? new Date(dischargedAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay - startDay) / 86_400_000) + 1);
}

/**
 * Which rate applies for a day the patient occupied more than one ward.
 * 'higher' is the default and the usual Indian practice: easiest to explain at
 * the billing counter and avoids fractional-day disputes.
 */
export function transferDayRate(
  rates: number[],
  rule: 'higher' | 'prorata' | 'both',
  hoursInEach?: number[]
): number {
  const clean = rates.filter((r) => Number.isFinite(r) && r >= 0);
  if (clean.length === 0) return 0;
  if (rule === 'both') return money(clean.reduce((a, b) => a + b, 0));
  if (rule === 'prorata' && hoursInEach && hoursInEach.length === clean.length) {
    const totalHours = hoursInEach.reduce((a, b) => a + b, 0);
    if (totalHours <= 0) return money(Math.max(...clean));
    return money(clean.reduce((sum, r, i) => sum + (r * hoursInEach[i]) / totalHours, 0));
  }
  return money(Math.max(...clean));
}

/** Highest discount percent a role may apply, from the settings JSON map. */
export function discountCapForRole(capsJson: string, role: string): number {
  if (!role) return 0;
  let caps: Record<string, number>;
  try {
    caps = JSON.parse(capsJson || '{}');
  } catch {
    // A malformed map must not silently grant unlimited discount.
    return 0;
  }
  const v = caps[role];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
