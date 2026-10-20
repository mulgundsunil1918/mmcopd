/**
 * Pharmacy money math — pure functions, no database, no Electron.
 *
 * The SAME module computes a purchase bill on the screen (live preview) and in the main process
 * (the authoritative figure that is stored), so what the receptionist sees and what lands in the
 * database can never disagree.
 *
 * Money is handled as integer PAISE (₹1 = 100) inside every calculation. Floating-point rupees
 * drift (0.1 + 0.2, 1.005 × 100) and every allocation here — a discount or freight shared over
 * lines — must add back up to the exact original amount, so the maths is done on integers and
 * only converted to rupees at the edge. Unit costs, which are genuinely fractional
 * (₹5,000 ÷ 110 units = ₹45.4545…), are kept to 4 decimals.
 *
 * Vocabulary (kept distinct on purpose — they are NOT interchangeable):
 *   purchase rate   what the supplier's invoice charges per paid unit (before discount / GST)
 *   unit cost       what a unit ACTUALLY cost to acquire: (paid value after discounts + freight
 *                   [+ GST if it cannot be reclaimed]) ÷ ALL units received, free ones included
 *   MRP             printed on the pack — a legal ceiling, not the price you charge
 *   selling price   what you intend to charge (defaults to MRP when not set)
 *   revenue         what customers actually paid, after discounts, before GST
 *   margin          gross profit ÷ revenue   (a share of what you sold)
 *   markup          gross profit ÷ cost      (how far above cost you sold)
 */

// ---------------------------------------------------------------------------------------------
// Paise helpers
// ---------------------------------------------------------------------------------------------

/** Rupees (any float) → integer paise, rounding half away from zero and shrugging off 1.005×100 noise. */
export function toPaise(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = parseFloat((Math.abs(n) * 100).toPrecision(15));
  return (n < 0 ? -1 : 1) * Math.round(p);
}
export const fromPaise = (p: number): number => p / 100;
/** Round rupees to the nearest paisa. */
export const r2 = (v: unknown): number => fromPaise(toPaise(v));
/** Unit costs keep 4 decimals — ₹45.4545 × 110 = ₹4,999.995 still rounds back to ₹5,000.00. */
export const r4 = (v: number): number => (Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 10000) / 10000 : 0);

/**
 * Split `total` paise over `weights` so the shares add back to EXACTLY `total` (largest-remainder
 * method). Used for sharing an invoice discount, freight or a sale discount over its lines.
 * With no usable weights the split is equal.
 */
export function allocatePaise(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let sum = w.reduce((s, x) => s + x, 0);
  const useW = sum > 0 ? w : w.map(() => 1);
  if (sum <= 0) sum = n;
  const sign = total < 0 ? -1 : 1;
  const T = Math.abs(total);
  const raw = useW.map((x) => T * (x / sum));
  const base = raw.map((x) => Math.floor(x + 1e-9));
  let rest = T - base.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) base[order[k].i] += 1;
  return base.map((x) => sign * x);
}

// ---------------------------------------------------------------------------------------------
// Purchase bill
// ---------------------------------------------------------------------------------------------

export interface PurchaseLineInput {
  /** Paid units. */
  qty: number;
  /** Free / scheme units received on top. They add to stock and LOWER the unit cost. */
  free_qty?: number;
  /** Supplier's rate per paid unit, before discount and GST. */
  rate: number;
  /** Trade discount on this line, in percent. */
  disc_pct?: number;
  gst_rate?: number;
}

export interface PurchaseOptions {
  /** Flat invoice discount in rupees, taken off BEFORE GST (a trade discount) and shared over the lines by value. */
  header_discount?: number;
  /** Freight / packing / handling in rupees. Shared over the lines by value and capitalised into stock cost. */
  other_charges?: number;
  /** Interstate supply → IGST instead of CGST + SGST. Does not change the amounts, only how they are labelled. */
  interstate?: boolean;
  /** True when GST on purchases is NOT reclaimable (unregistered / composition clinics): it becomes part of the cost. */
  gst_in_cost?: boolean;
  /** Round-off in rupees, or 'auto' to round the invoice to the nearest rupee (as distributors do). */
  round_off?: number | 'auto';
}

export interface PurchaseLineResult {
  gross: number;           // qty × rate — what the line costs before any discount
  line_discount: number;
  header_discount: number; // this line's share of the invoice discount
  discount: number;        // line_discount + header_discount
  taxable: number;         // gross − discount: the value GST is charged on
  gst: number;
  charges: number;         // this line's share of freight etc.
  cost: number;            // total acquisition cost of the line = taxable + charges (+ gst when not reclaimable)
  units: number;           // qty + free_qty
  unit_cost: number;       // cost ÷ units (4 decimals)
}

export interface PurchaseResult {
  lines: PurchaseLineResult[];
  subtotal: number;        // Σ gross
  line_discount: number;
  header_discount: number;
  discount: number;        // total discount (line + invoice)
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  other_charges: number;
  round_off: number;
  /** total = subtotal − discount + gst + other_charges + round_off */
  total: number;
}

/** First problem with a purchase bill, in plain words — or null when it is fine. */
export function validatePurchase(lines: PurchaseLineInput[], opts: PurchaseOptions = {}): string | null {
  if (!lines.length) return 'Add at least one medicine line to the bill.';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const row = `Line ${i + 1}`;
    if (!Number.isFinite(l.qty) || l.qty < 1 || Math.floor(l.qty) !== l.qty) return `${row}: quantity must be a whole number of at least 1.`;
    const free = l.free_qty ?? 0;
    if (!Number.isFinite(free) || free < 0 || Math.floor(free) !== free) return `${row}: free quantity must be a whole number (0 or more).`;
    if (!Number.isFinite(l.rate) || l.rate < 0) return `${row}: the purchase rate cannot be negative.`;
    const d = l.disc_pct ?? 0;
    if (!Number.isFinite(d) || d < 0 || d > 100) return `${row}: discount must be between 0% and 100%.`;
    const g = l.gst_rate ?? 0;
    if (!Number.isFinite(g) || g < 0 || g > 40) return `${row}: GST rate must be between 0% and 40%.`;
  }
  const hd = opts.header_discount ?? 0;
  if (!Number.isFinite(hd) || hd < 0) return 'The invoice discount cannot be negative.';
  const oc = opts.other_charges ?? 0;
  if (!Number.isFinite(oc) || oc < 0) return 'Other charges cannot be negative.';
  const afterLine = lines.reduce((s, l) => {
    const gross = toPaise(l.qty * l.rate);
    return s + gross - Math.round((gross * (l.disc_pct ?? 0)) / 100);
  }, 0);
  if (toPaise(hd) > afterLine) return 'The invoice discount is larger than the value of the goods.';
  return null;
}

/** Work out a purchase bill — every line's cost, the tax, and the invoice total — in exact paise. */
export function computePurchase(lines: PurchaseLineInput[], opts: PurchaseOptions = {}): PurchaseResult {
  const grossP = lines.map((l) => toPaise((Number(l.qty) || 0) * (Number(l.rate) || 0)));
  const lineDiscP = lines.map((l, i) => Math.round((grossP[i] * Math.min(100, Math.max(0, Number(l.disc_pct) || 0))) / 100));
  const afterLineP = grossP.map((g, i) => g - lineDiscP[i]);
  const headerP = Math.min(toPaise(opts.header_discount ?? 0), afterLineP.reduce((s, x) => s + x, 0));
  const headerShare = allocatePaise(headerP, afterLineP);
  const taxableP = afterLineP.map((a, i) => a - headerShare[i]);
  const gstP = lines.map((l, i) => Math.round((taxableP[i] * Math.max(0, Number(l.gst_rate) || 0)) / 100));
  const chargesP = Math.max(0, toPaise(opts.other_charges ?? 0));
  const chargeShare = allocatePaise(chargesP, taxableP);

  const subtotal = grossP.reduce((s, x) => s + x, 0);
  const lineDisc = lineDiscP.reduce((s, x) => s + x, 0);
  const taxable = taxableP.reduce((s, x) => s + x, 0);
  const gst = gstP.reduce((s, x) => s + x, 0);
  const preRound = taxable + gst + chargesP;
  const roundP = opts.round_off === 'auto' || opts.round_off === undefined
    ? Math.round(preRound / 100) * 100 - preRound
    : toPaise(opts.round_off);
  const cgst = opts.interstate ? 0 : Math.round(gst / 2);
  const sgst = opts.interstate ? 0 : gst - cgst;

  const res: PurchaseLineResult[] = lines.map((l, i) => {
    const units = (Number(l.qty) || 0) + (Number(l.free_qty) || 0);
    const costP = taxableP[i] + chargeShare[i] + (opts.gst_in_cost ? gstP[i] : 0);
    return {
      gross: fromPaise(grossP[i]),
      line_discount: fromPaise(lineDiscP[i]),
      header_discount: fromPaise(headerShare[i]),
      discount: fromPaise(lineDiscP[i] + headerShare[i]),
      taxable: fromPaise(taxableP[i]),
      gst: fromPaise(gstP[i]),
      charges: fromPaise(chargeShare[i]),
      cost: fromPaise(costP),
      units,
      unit_cost: units > 0 ? r4(costP / 100 / units) : 0,
    };
  });

  return {
    lines: res,
    subtotal: fromPaise(subtotal),
    line_discount: fromPaise(lineDisc),
    header_discount: fromPaise(headerP),
    discount: fromPaise(lineDisc + headerP),
    taxable: fromPaise(taxable),
    gst: fromPaise(gst),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: opts.interstate ? fromPaise(gst) : 0,
    other_charges: fromPaise(chargesP),
    round_off: fromPaise(roundP),
    total: fromPaise(preRound + roundP),
  };
}

// ---------------------------------------------------------------------------------------------
// Merging stock into an existing batch
// ---------------------------------------------------------------------------------------------

/**
 * The same manufacturer batch number can be bought again — from another distributor, at another
 * rate. The batch row is unique per (drug, batch no), so the units now in it came in at two costs.
 * Units already SOLD keep the cost frozen on their sale; the units still on the shelf are valued
 * at the quantity-weighted average of old and new. Overwriting the old cost with the new one (what
 * this used to do) re-costs stock that was bought at a different price.
 *
 * An unknown old cost cannot be blended, so the new cost stands for the whole batch.
 */
export function blendUnitCost(remainingQty: number, oldCost: number | null | undefined, newQty: number, newCost: number): number {
  if (!(remainingQty > 0) || oldCost === null || oldCost === undefined || !Number.isFinite(Number(oldCost))) return r4(newCost);
  const totalQty = remainingQty + newQty;
  if (!(totalQty > 0)) return r4(newCost);
  return r4((remainingQty * Number(oldCost) + newQty * newCost) / totalQty);
}

// ---------------------------------------------------------------------------------------------
// Profit metrics — one definition, used by every report
// ---------------------------------------------------------------------------------------------

export interface ProfitMetrics {
  /** Net sales revenue − cost of goods sold. */
  profit: number;
  /** profit ÷ revenue × 100, or null when there is no revenue to be a share of. */
  marginPct: number | null;
  /** profit ÷ cost × 100, or null when the cost is zero/unknown. */
  markupPct: number | null;
}

export function profitMetrics(netRevenue: number, cogs: number): ProfitMetrics {
  const profit = r2(netRevenue - cogs);
  return {
    profit,
    marginPct: netRevenue > 0 ? Math.round(((netRevenue - cogs) / netRevenue) * 10000) / 100 : null,
    markupPct: cogs > 0 ? Math.round(((netRevenue - cogs) / cogs) * 10000) / 100 : null,
  };
}

/** What a sale line is worth to the business: after its discount, and without the GST that is owed onward. */
export function netRevenueExGst(grossInclGst: number, discount: number, gstRate: number): number {
  const afterDiscount = toPaise(grossInclGst) - toPaise(discount);
  return fromPaise(gstRate > 0 ? Math.round(afterDiscount / (1 + gstRate / 100)) : afterDiscount);
}
