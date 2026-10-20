/**
 * Pharmacy profit reports — the row shape every report uses, and the rankings built from it.
 *
 * Pure functions, no database and no Electron: the main process fills `DrugProfitRow`s from the
 * sales ledger (main/pharmacy-finance.ts) and the Analytics screen shows what comes back. Keeping
 * the ranking rules here means they can be tested on synthetic rows, and a rule such as "low-profit,
 * high-volume" is defined in exactly one place.
 *
 * Vocabulary (same as pharmacyMath.ts — never interchangeable):
 *   revenue   what customers paid, after discounts, WITHOUT the GST owed onward
 *   cogs      what the units sold cost (the cost frozen on each sale)
 *   profit    revenue − cogs        (gross profit, before rent, salaries and other running costs)
 *   margin    profit ÷ revenue      markup   profit ÷ cogs
 * Only lines whose cost is KNOWN count towards profit and margin. A unit sold from a batch whose cost
 * was never recorded is reported as "uncosted" instead of being treated as free, which would
 * overstate profit.
 */
import { profitMetrics } from './pharmacyMath';

export interface DrugProfitRow {
  /** 'd:<drug id>' for a catalogue medicine, 'n:<name>' for a free-text line with no stock link. */
  key: string;
  drug_master_id: number | null;
  name: string;
  /** Units sold in the period (all lines). */
  units: number;
  /** Distinct bills the medicine appeared on — "transactions". */
  sales: number;
  /** Value at the price charged, GST included, before any bill discount. */
  gross_amount: number;
  discount: number;
  /** Net revenue: after discount, GST removed when the clinic charges GST. */
  revenue: number;
  costed_units: number;
  costed_revenue: number;
  cogs: number;
  /** costed_revenue − cogs */
  profit: number;
  margin_pct: number | null;
  markup_pct: number | null;
  /** Profit per unit sold (costed units only). */
  gp_per_unit: number | null;
  /** Average net price per unit actually realised. */
  avg_price: number | null;
  /** Average cost per unit sold. */
  avg_cost: number | null;
  uncosted_units: number;
  uncosted_revenue: number;
  /** Stock on hand right now (not period-bound). */
  stock_units: number;
  /** Cost of that stock (batches with a known cost only). */
  stock_cost: number;
  next_expiry: string | null;
}

export interface Rankings {
  best_by_units: DrugProfitRow[];
  best_by_revenue: DrugProfitRow[];
  best_by_sales: DrugProfitRow[];
  highest_profit: DrugProfitRow[];
  highest_margin: DrugProfitRow[];
  lowest_margin: DrugProfitRow[];
  /** Big sellers by value whose margin is below the pharmacy's overall margin. */
  high_revenue_low_profit: DrugProfitRow[];
  /** Big sellers by volume whose margin is below the pharmacy's overall margin. */
  low_profit_high_volume: DrugProfitRow[];
  /** In stock, nothing sold in the period. */
  no_sales: DrugProfitRow[];
  /** In stock, selling, but the stock is at least 4× what sold — money sitting on the shelf. */
  slow_movers: DrugProfitRow[];
  overall_margin_pct: number | null;
}

/** Stock this many times the period's sales counts as slow-moving. */
export const SLOW_COVER_FACTOR = 4;

const byDesc = (f: (r: DrugProfitRow) => number) => (a: DrugProfitRow, b: DrugProfitRow) =>
  f(b) - f(a) || a.name.localeCompare(b.name);
const byAsc = (f: (r: DrugProfitRow) => number) => (a: DrugProfitRow, b: DrugProfitRow) =>
  f(a) - f(b) || a.name.localeCompare(b.name);

export function rankProfit(rows: DrugProfitRow[], top = 10): Rankings {
  const sold = rows.filter((r) => r.units > 0);
  const costed = sold.filter((r) => r.costed_revenue > 0 && r.margin_pct !== null);
  const take = (xs: DrugProfitRow[]) => xs.slice(0, top);

  const totalRev = costed.reduce((s, r) => s + r.costed_revenue, 0);
  const totalCogs = costed.reduce((s, r) => s + r.cogs, 0);
  const overall = profitMetrics(totalRev, totalCogs).marginPct;

  // "Big seller" = the top quarter (at least one) of what sold.
  const quarter = Math.max(1, Math.ceil(sold.length / 4));
  const belowOverall = (r: DrugProfitRow) => overall !== null && r.margin_pct !== null && r.margin_pct < overall;

  return {
    best_by_units: take([...sold].sort(byDesc((r) => r.units))),
    best_by_revenue: take([...sold].sort(byDesc((r) => r.revenue))),
    best_by_sales: take([...sold].sort(byDesc((r) => r.sales))),
    highest_profit: take([...costed].sort(byDesc((r) => r.profit))),
    highest_margin: take([...costed].sort(byDesc((r) => r.margin_pct as number))),
    lowest_margin: take([...costed].sort(byAsc((r) => r.margin_pct as number))),
    high_revenue_low_profit: take([...sold].sort(byDesc((r) => r.revenue)).slice(0, quarter).filter(belowOverall)),
    low_profit_high_volume: take([...sold].sort(byDesc((r) => r.units)).slice(0, quarter).filter(belowOverall)),
    no_sales: take(rows.filter((r) => r.stock_units > 0 && r.units === 0).sort(byDesc((r) => r.stock_cost || r.stock_units / 1e6))),
    slow_movers: take(
      rows
        .filter((r) => r.stock_units > 0 && r.units > 0 && r.stock_units >= SLOW_COVER_FACTOR * r.units)
        .sort(byDesc((r) => r.stock_cost || r.stock_units / 1e6)),
    ),
    overall_margin_pct: overall,
  };
}

/** Report types shared between the main process and the Analytics screen. */
export interface ProfitTotals {
  units: number;
  sales: number;
  gross_amount: number;
  discount: number;
  revenue: number;
  costed_revenue: number;
  cogs: number;
  profit: number;
  margin_pct: number | null;
  markup_pct: number | null;
  uncosted_units: number;
  uncosted_revenue: number;
}

export interface ProfitReport {
  from: string;
  to: string;
  /** True when the clinic charges GST on sales, so revenue is shown without it. */
  revenue_excludes_gst: boolean;
  totals: ProfitTotals;
  counter: ProfitTotals;
  ward: ProfitTotals;
  by_month: { month: string; revenue: number; cogs: number; profit: number; margin_pct: number | null }[];
  drugs: DrugProfitRow[];
  rankings: Rankings;
}

export interface StockBucket {
  batches: number;
  units: number;
  at_cost: number;
  at_mrp: number;
  at_selling: number;
}

export interface Valuation {
  as_of: string;
  revenue_excludes_gst: boolean;
  /** Stock that can still be sold (not expired). */
  sellable: StockBucket & {
    skus: number;
    /** Selling-price value with GST removed when the clinic charges it. */
    expected_revenue: number;
    /** expected_revenue − at_cost, on batches whose cost is known. */
    expected_profit: number;
    expected_margin_pct: number | null;
    /** What the same units would cost to buy again today (latest purchase cost). */
    at_replacement_cost: number;
  };
  expired: StockBucket;
  near_expiry: StockBucket & { days: number };
  /** Batches in stock whose cost was never recorded — they are left out of cost and profit figures. */
  unknown_cost: { batches: number; units: number };
  near_expiry_list: { drug: string; batch_no: string; expiry: string; days: number; qty: number; at_cost: number }[];
  expired_list: { drug: string; batch_no: string; expiry: string; days: number; qty: number; at_cost: number }[];
}

export interface SupplierReport {
  from: string;
  to: string;
  totals: { invoices: number; billed: number; discounts: number; paid: number; outstanding_in_period: number; owed_now: number };
  suppliers: {
    id: number; name: string; invoices: number; billed: number; discounts: number; other_charges: number;
    paid: number; outstanding: number; unknown_paid: number;
  }[];
  /** What is owed to each supplier TODAY, whatever the invoice date. */
  owed_now: { id: number; name: string; outstanding: number; unknown_paid: number; open_invoices: number }[];
  by_month: { month: string; wholesaler_id: number; supplier: string; invoices: number; billed: number; discounts: number }[];
  payments: {
    id: number; paid_on: string; amount: number; payment_mode: string | null; reference: string | null;
    notes: string | null; invoice_number: string; supplier: string;
  }[];
  price_changes: {
    drug: string; supplier: string; date: string; invoice_number: string; rate: number; unit_cost: number | null;
    prev_rate: number; prev_unit_cost: number | null; prev_date: string; change_pct: number;
  }[];
  /** This version has no purchase-return workflow, so there is nothing to report. */
  purchase_returns: null;
}

export interface PriceHistoryRow {
  date: string;
  invoice_number: string;
  supplier: string;
  batch_no: string;
  qty_received: number;
  free_qty: number;
  rate: number;
  disc_pct: number;
  unit_cost: number | null;
  mrp: number;
  selling_price: number | null;
  gst_rate: number;
  rate_change_pct: number | null;
  cost_change_pct: number | null;
}

export interface IntegrityFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  message: string;
}
