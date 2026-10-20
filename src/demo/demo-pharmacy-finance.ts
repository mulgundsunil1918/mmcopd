/**
 * Demo-only stand-ins for the pharmacy finance channels (purchase bills with payments, profit,
 * stock value, suppliers). The real thing is main/pharmacy-finance.ts running against SQLite; here the
 * same pure maths (lib/pharmacyMath, lib/pharmacyReports) runs over the demo's in-memory data so the
 * showcase screens show believable, internally consistent figures. Nothing here ships in the app.
 */
import { computePurchase, fromPaise, profitMetrics, toPaise, validatePurchase } from '../lib/pharmacyMath';
import {
  rankProfit,
  type DrugProfitRow, type PriceHistoryRow, type ProfitReport, type ProfitTotals, type SupplierReport, type Valuation,
} from '../lib/pharmacyReports';
import type { DrugMaster, DrugStockBatch, PurchaseDetail, PurchaseInvoice, PurchaseInvoiceInput, Wholesaler } from '../types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // the browser's local calendar day
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/* ------------------------------ purchase bills + payments ------------------------------ */
export function makeDemoPurchaseStore(
  seed: PurchaseInvoice[],
  getWholesalers: () => Wholesaler[],
  getDrugs: () => DrugMaster[],
  getBatches: () => DrugStockBatch[],
  setBatches: (b: DrugStockBatch[]) => void,
) {
  const wh = (id: number) => getWholesalers().find((w) => w.id === id);
  const decorate = (p: PurchaseInvoice, items: any[], payments: any[]): PurchaseDetail => {
    const paid = payments.reduce((s, x) => s + x.amount, 0);
    const w = wh(p.wholesaler_id);
    return {
      ...p, items, payments, amount_paid: paid, outstanding: Math.round((p.total - paid) * 100) / 100,
      other_charges: p.other_charges ?? 0, round_off: p.round_off ?? 0, gst_in_cost: p.gst_in_cost ?? 0, line_count: items.length,
      wholesaler_name: w?.name ?? '', wholesaler_license_no: w?.drug_license_no ?? '', wholesaler_gstin: w?.gstin ?? null,
    } as PurchaseDetail;
  };

  let nextInv = seed.length + 1;
  let nextPay = 1;
  const store: PurchaseDetail[] = seed.map((p, i) => {
    const drugs = getDrugs();
    const items = [drugs[i % drugs.length], drugs[(i + 5) % drugs.length]].map((d, k) => ({
      id: i * 2 + k + 1, invoice_id: p.id, drug_master_id: d.id, drug_name: d.name, batch_no: `PB${i}${k}`, expiry: iso(new Date(Date.now() + 400 * 86_400_000)),
      qty_received: 100, free_qty: k === 0 ? 10 : 0, pack_qty: null, purchase_price: Math.round(d.default_mrp * 70) / 100, mrp: d.default_mrp,
      gst_rate: 12, manufacturer_license_no: null, line_total: Math.round(d.default_mrp * 7000) / 100, disc_pct: 0, discount_amount: 0,
      taxable_value: Math.round(d.default_mrp * 7000) / 100, gst_amount: 0, selling_price: null,
      unit_cost: Math.round((d.default_mrp * 0.7 * 100) / (k === 0 ? 110 : 100) * 100) / 100,
    }));
    const paid = p.payment_status === 'paid' ? p.total : 0;
    const payments = paid > 0 ? [{ id: nextPay++, invoice_id: p.id, amount: paid, payment_mode: p.payment_mode, paid_on: p.invoice_date, reference: null, notes: null, created_by: null, created_at: p.invoice_date }] : [];
    return decorate(p, items, payments);
  });

  const summary = (d: PurchaseDetail) => { const { items: _i, payments: _p, ...rest } = d; return rest; };

  return {
    all: () => store,
    list: (filter: any = {}) => store
      .filter((d) => (!filter.from || d.invoice_date >= filter.from) && (!filter.to || d.invoice_date <= filter.to))
      .filter((d) => (!filter.status ? true : filter.status === 'outstanding' ? d.payment_status !== 'paid' : d.payment_status === filter.status))
      .map(summary).sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)),
    get: (id: number) => store.find((d) => d.id === id) ?? null,

    create: (payload: PurchaseInvoiceInput) => {
      const issues: string[] = [];
      if (!payload.invoice_number?.trim()) issues.push("Enter the supplier's invoice number.");
      if (!wh(payload.wholesaler_id)) issues.push('Choose the supplier (wholesaler) this bill is from.');
      const lines = payload.items.map((l) => ({ qty: l.qty_received, free_qty: l.free_qty ?? 0, rate: l.purchase_price, disc_pct: l.disc_pct ?? 0, gst_rate: l.gst_rate ?? 0 }));
      const opts = { header_discount: payload.discount ?? 0, other_charges: payload.other_charges ?? 0, interstate: !!payload.interstate, gst_in_cost: !!payload.gst_in_cost, round_off: payload.round_off ?? 0 };
      const bad = validatePurchase(lines, opts);
      if (bad) issues.push(bad);
      if (issues.length) return { ok: false as const, error: issues[0] };
      if (payload.client_ref) { const hit = store.find((d: any) => d.client_ref === payload.client_ref); if (hit) return { ok: true as const, duplicate: true, invoice: hit }; }
      if (store.some((d) => d.wholesaler_id === payload.wholesaler_id && d.invoice_number.trim().toLowerCase() === payload.invoice_number.trim().toLowerCase())) {
        return { ok: false as const, error: `Invoice ${payload.invoice_number.trim()} from ${wh(payload.wholesaler_id)?.name} is already recorded. Open it from the Purchases list instead of entering it again.` };
      }
      const calc = computePurchase(lines, opts);
      const paidP = toPaise(payload.amount_paid ?? 0);
      if (paidP > toPaise(calc.total)) return { ok: false as const, error: 'The amount paid is more than the bill total.' };
      const id = nextInv++;
      const items = payload.items.map((l, i) => {
        const r = calc.lines[i];
        return {
          id: id * 100 + i, invoice_id: id, drug_master_id: l.drug_master_id, drug_name: getDrugs().find((d) => d.id === l.drug_master_id)?.name ?? '',
          batch_no: l.batch_no, expiry: l.expiry, manufacture_date: l.manufacture_date ?? null, qty_received: l.qty_received, free_qty: l.free_qty ?? 0, pack_qty: null,
          purchase_price: l.purchase_price, mrp: l.mrp, gst_rate: l.gst_rate ?? 0, manufacturer_license_no: l.manufacturer_license_no ?? null,
          line_total: r.taxable, disc_pct: l.disc_pct ?? 0, discount_amount: r.discount, taxable_value: r.taxable, gst_amount: r.gst, selling_price: l.selling_price ?? null, unit_cost: r.unit_cost,
        };
      });
      // stock arrives with the bill
      const existing = getBatches();
      const added: DrugStockBatch[] = items.map((it, i) => ({
        id: 9000 + id * 10 + i, drug_master_id: it.drug_master_id, purchase_item_id: it.id, batch_no: it.batch_no, expiry: it.expiry,
        qty_received: it.qty_received + it.free_qty, qty_remaining: it.qty_received + it.free_qty, purchase_price: it.purchase_price, unit_cost: it.unit_cost,
        selling_price: it.selling_price, mrp: it.mrp, manufacturer_license_no: null, received_at: iso(new Date()), is_active: 1, drug_name: it.drug_name,
      } as DrugStockBatch));
      setBatches([...existing, ...added]);
      const inv: PurchaseInvoice = {
        id, invoice_number: payload.invoice_number.trim(), wholesaler_id: payload.wholesaler_id, invoice_date: payload.invoice_date, received_date: payload.received_date ?? payload.invoice_date,
        subtotal: calc.subtotal, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, discount: calc.discount, total: calc.total,
        payment_mode: payload.payment_mode ?? null, payment_status: (paidP === 0 ? 'unpaid' : paidP >= toPaise(calc.total) ? 'paid' : 'partial') as any,
        scan_path: null, ocr_job_id: null, notes: payload.notes ?? null, created_at: new Date().toISOString(),
        other_charges: calc.other_charges, round_off: calc.round_off, gst_in_cost: payload.gst_in_cost ? 1 : 0,
      };
      const payments = paidP > 0 ? [{ id: nextPay++, invoice_id: id, amount: fromPaise(paidP), payment_mode: payload.payment_mode ?? null, paid_on: iso(new Date()), reference: null, notes: 'Paid when the bill was entered', created_by: null, created_at: new Date().toISOString() }] : [];
      const d: any = decorate(inv, items, payments);
      d.client_ref = payload.client_ref;
      store.unshift(d);
      return { ok: true as const, duplicate: false, invoice: d as PurchaseDetail };
    },

    addPayment: (invoiceId: number, p: any) => {
      const d = store.find((x) => x.id === invoiceId);
      if (!d) return { ok: false as const, error: 'That purchase bill was not found.' };
      const amountP = toPaise(p.amount);
      if (!(amountP > 0)) return { ok: false as const, error: 'Enter the amount paid (more than ₹0).' };
      const owedP = toPaise(d.total) - toPaise(d.amount_paid ?? 0);
      if (amountP > owedP) return { ok: false as const, error: `A payment of ₹${fromPaise(amountP).toFixed(2)} is more than the ₹${fromPaise(Math.max(0, owedP)).toFixed(2)} still owed on invoice ${d.invoice_number}.` };
      d.payments.push({ id: nextPay++, invoice_id: d.id, amount: fromPaise(amountP), payment_mode: p.mode ?? null, paid_on: p.paid_on ?? iso(new Date()), reference: p.reference ?? null, notes: null, created_by: null, created_at: new Date().toISOString() });
      const paid = d.payments.reduce((s, x) => s + toPaise(x.amount), 0);
      d.amount_paid = fromPaise(paid);
      d.outstanding = fromPaise(toPaise(d.total) - paid);
      d.payment_status = paid >= toPaise(d.total) ? 'paid' : 'partial';
      return { ok: true as const, duplicate: false, invoice: d };
    },
  };
}

/* ------------------------------ profit / stock value / suppliers ------------------------------ */
const totalsOf = (rows: DrugProfitRow[]): ProfitTotals => {
  const sum = (f: (r: DrugProfitRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const m = profitMetrics(sum((r) => r.costed_revenue), sum((r) => r.cogs));
  return {
    units: sum((r) => r.units), sales: Math.round(sum((r) => r.sales) * 0.7), gross_amount: sum((r) => r.gross_amount), discount: sum((r) => r.discount),
    revenue: sum((r) => r.revenue), costed_revenue: sum((r) => r.costed_revenue), cogs: sum((r) => r.cogs), profit: m.profit, margin_pct: m.marginPct, markup_pct: m.markupPct,
    uncosted_units: 0, uncosted_revenue: 0,
  };
};

export function demoProfitReport(drugs: DrugMaster[], batches: DrugStockBatch[], from: string, to: string): ProfitReport {
  const days = Math.max(1, daysBetween(from, to) + 1);
  const scale = Math.min(3, days / 30);
  const rows: DrugProfitRow[] = drugs.slice(0, 15).map((d, i) => {
    const units = Math.round((25 + ((i * 37) % 90)) * scale);
    const price = Math.round(d.default_mrp * (0.9 + (i % 3) * 0.04) * 100) / 100;     // realised price: a little under MRP
    const cost = Math.round(d.default_mrp * (0.55 + (i % 5) * 0.09) * 100) / 100;
    const gross = Math.round(units * d.default_mrp * 100) / 100;
    const revenue = Math.round(units * price * 100) / 100;
    const cogs = Math.round(units * cost * 100) / 100;
    const m = profitMetrics(revenue, cogs);
    const stock = batches.filter((b) => b.drug_master_id === d.id && b.is_active === 1).reduce((s, b) => s + b.qty_remaining, 0);
    return {
      key: `d:${d.id}`, drug_master_id: d.id, name: d.name, units, sales: Math.max(1, Math.round(units / 3)),
      gross_amount: gross, discount: Math.round((gross - revenue) * 100) / 100, revenue, costed_units: units, costed_revenue: revenue, cogs,
      profit: m.profit, margin_pct: m.marginPct, markup_pct: m.markupPct,
      gp_per_unit: units ? Math.round((m.profit / units) * 10000) / 10000 : null, avg_price: price, avg_cost: cost,
      uncosted_units: 0, uncosted_revenue: 0, stock_units: i === 14 ? 600 : stock, stock_cost: Math.round(stock * cost * 100) / 100, next_expiry: null,
    };
  });
  rows[13] = { ...rows[13], units: 0, sales: 0, gross_amount: 0, discount: 0, revenue: 0, costed_units: 0, costed_revenue: 0, cogs: 0, profit: 0, margin_pct: null, markup_pct: null, gp_per_unit: null, avg_price: null, avg_cost: null };
  const t = totalsOf(rows);
  return {
    from, to, revenue_excludes_gst: false, totals: t,
    counter: t, ward: { ...t, units: 0, sales: 0, revenue: 0, costed_revenue: 0, cogs: 0, profit: 0, gross_amount: 0, discount: 0, margin_pct: null, markup_pct: null },
    by_month: [{ month: from.slice(0, 7), revenue: t.revenue, cogs: t.cogs, profit: t.profit, margin_pct: t.margin_pct }],
    drugs: rows, rankings: rankProfit(rows, 10),
  };
}

export function demoValuation(batches: DrugStockBatch[], drugs: DrugMaster[]): Valuation {
  const today = iso(new Date());
  let units = 0, cost = 0, mrp = 0, sp = 0, repl = 0;
  const near: Valuation['near_expiry_list'] = [];
  let nearUnits = 0, nearCost = 0;
  const skus = new Set<number>();
  for (const b of batches) {
    if (!b.is_active || b.qty_remaining <= 0) continue;
    const days = daysBetween(today, b.expiry);
    const c = (b.unit_cost ?? b.purchase_price ?? 0) * b.qty_remaining;
    if (days < 0) continue;
    skus.add(b.drug_master_id);
    units += b.qty_remaining; cost += c; mrp += b.mrp * b.qty_remaining; sp += (b.selling_price ?? b.mrp) * b.qty_remaining;
    repl += (drugs.find((d) => d.id === b.drug_master_id)?.default_mrp ?? 0) * 0.75 * b.qty_remaining;
    if (days <= 90) { nearUnits += b.qty_remaining; nearCost += c; near.push({ drug: b.drug_name ?? 'Drug', batch_no: b.batch_no, expiry: b.expiry, days, qty: b.qty_remaining, at_cost: Math.round(c * 100) / 100 }); }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const m = profitMetrics(sp, cost);
  return {
    as_of: today, revenue_excludes_gst: false,
    sellable: { batches: batches.length, skus: skus.size, units, at_cost: r2(cost), at_mrp: r2(mrp), at_selling: r2(sp), expected_revenue: r2(sp), expected_profit: m.profit, expected_margin_pct: m.marginPct, at_replacement_cost: r2(repl) },
    expired: { batches: 0, units: 0, at_cost: 0, at_mrp: 0, at_selling: 0 },
    near_expiry: { batches: near.length, units: nearUnits, at_cost: r2(nearCost), at_mrp: 0, at_selling: 0, days: 90 },
    unknown_cost: { batches: 0, units: 0 },
    near_expiry_list: near.sort((a, b) => a.days - b.days).slice(0, 12), expired_list: [],
  };
}

export function demoSupplierReport(invoices: PurchaseDetail[], from: string, to: string): SupplierReport {
  const inRange = invoices.filter((d) => d.invoice_date >= from && d.invoice_date <= to);
  const by = new Map<number, SupplierReport['suppliers'][number]>();
  for (const d of inRange) {
    const s = by.get(d.wholesaler_id) ?? { id: d.wholesaler_id, name: d.wholesaler_name, invoices: 0, billed: 0, discounts: 0, other_charges: 0, paid: 0, outstanding: 0, unknown_paid: 0 };
    s.invoices++; s.billed += d.total; s.discounts += d.discount; s.paid += d.amount_paid ?? 0; s.outstanding += d.outstanding ?? 0;
    by.set(d.wholesaler_id, s);
  }
  const suppliers = [...by.values()].sort((a, b) => b.billed - a.billed);
  const owedAll = new Map<number, { id: number; name: string; outstanding: number; unknown_paid: number; open_invoices: number }>();
  for (const d of invoices) if ((d.outstanding ?? 0) > 0.004) {
    const o = owedAll.get(d.wholesaler_id) ?? { id: d.wholesaler_id, name: d.wholesaler_name, outstanding: 0, unknown_paid: 0, open_invoices: 0 };
    o.outstanding += d.outstanding ?? 0; o.open_invoices++; owedAll.set(d.wholesaler_id, o);
  }
  return {
    from, to,
    totals: {
      invoices: inRange.length, billed: suppliers.reduce((s, x) => s + x.billed, 0), discounts: suppliers.reduce((s, x) => s + x.discounts, 0),
      paid: suppliers.reduce((s, x) => s + x.paid, 0), outstanding_in_period: suppliers.reduce((s, x) => s + x.outstanding, 0),
      owed_now: [...owedAll.values()].reduce((s, x) => s + x.outstanding, 0),
    },
    suppliers, owed_now: [...owedAll.values()],
    by_month: inRange.map((d) => ({ month: d.invoice_date.slice(0, 7), wholesaler_id: d.wholesaler_id, supplier: d.wholesaler_name, invoices: 1, billed: d.total, discounts: d.discount })),
    payments: inRange.flatMap((d) => d.payments.map((p) => ({ id: p.id, paid_on: p.paid_on, amount: p.amount, payment_mode: p.payment_mode, reference: p.reference, notes: p.notes, invoice_number: d.invoice_number, supplier: d.wholesaler_name }))),
    price_changes: [], purchase_returns: null,
  };
}

export function demoPriceHistory(invoices: PurchaseDetail[], drugId: number): PriceHistoryRow[] {
  const rows = invoices.flatMap((d) => d.items.filter((i) => i.drug_master_id === drugId).map((i) => ({
    date: d.invoice_date, invoice_number: d.invoice_number, supplier: d.wholesaler_name, batch_no: i.batch_no, qty_received: i.qty_received, free_qty: i.free_qty,
    rate: i.purchase_price, disc_pct: i.disc_pct ?? 0, unit_cost: i.unit_cost ?? null, mrp: i.mrp, selling_price: i.selling_price ?? null, gst_rate: i.gst_rate,
  }))).sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows.map((r, i) => ({ ...r, rate_change_pct: i > 0 && rows[i - 1].rate > 0 ? Math.round(((r.rate - rows[i - 1].rate) / rows[i - 1].rate) * 10000) / 100 : null, cost_change_pct: null }));
}
