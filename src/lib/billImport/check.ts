/**
 * The checks between "ChatGPT read a bill" and "stock changes": every problem in plain words, and whether the bill is ready to be imported.
 *
 *   error   red — the import is blocked until a person fixes it (a missing batch or expiry, an unconfirmed match, a bill total that does not add up…)
 *   warn    amber — worth a look, does not block (a composition that differs from ChatGPT's lookup, a line amount a few rupees off, short expiry)
 *   info    for the record (the same batch on several lines will be joined)
 *
 * The same function runs on the screen (live, as the person fixes things) and again in the main process when IMPORT is pressed, so a screen that is
 * wrong, stale or tampered with cannot get a bad bill into stock.
 */
import { computePurchase, fromPaise, toPaise } from '../pharmacyMath';
import type { Draft, DraftBill, DraftLine, Problem, ReconPart, Reconciliation } from './types';
import { looksLikePlaceholderBatch } from './normalize';
import { isNoExpiry, pagesMissing, schemeInName } from './items';

export const ALLOWED_GST = [0, 5, 12, 18, 28];
/** CGST-only (or SGST-only) figures that are often copied by mistake as the line's GST: the TOTAL is double. */
const HALF_RATES: Record<number, number> = { 2.5: 5, 6: 12, 9: 18, 14: 28, 1.5: 3 };
/** A line amount may be off by this much (a bill rounds each tax figure) before it is flagged. */
const LINE_TOLERANCE = 1.0;
/** The bill's total may be off by this much (round-off, rounding of each line's tax) before it is flagged. */
export const TOTAL_TOLERANCE = 1.0;

const money = (v: number) => `₹${(Math.round(v * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isInt = (v: number | null) => v !== null && Number.isFinite(v) && Math.floor(v) === v;

/** What a line comes to by the maths: quantity × rate, less its discount, plus its GST. Null when the line cannot be worked out. */
export function lineComputed(l: Pick<DraftLine, 'qty' | 'rate' | 'disc_pct' | 'gst_rate'>): number | null {
  if (l.qty === null || l.rate === null || !Number.isFinite(l.qty) || !Number.isFinite(l.rate)) return null;
  const gross = toPaise(l.qty * l.rate);
  const disc = Math.round((gross * Math.min(100, Math.max(0, l.disc_pct || 0))) / 100);
  const taxable = gross - disc;
  return fromPaise(taxable + Math.round((taxable * Math.max(0, l.gst_rate ?? 0)) / 100));
}

/**
 * What a line comes to at each stage — quantity × rate (before any discount), after its own discount (before GST), and with GST. A bill may print ANY of
 * the three as "the line's amount" (Samarth's AMOUNT column is the first, a "Taxable Amt" the second, a "Total" the third); all three are right.
 */
export function lineStages(l: Pick<DraftLine, 'qty' | 'rate' | 'disc_pct' | 'gst_rate'>): { gross: number; taxable: number; total: number } | null {
  if (l.qty === null || l.rate === null || !Number.isFinite(l.qty) || !Number.isFinite(l.rate)) return null;
  const gross = toPaise(l.qty * l.rate);
  const disc = Math.round((gross * Math.min(100, Math.max(0, l.disc_pct || 0))) / 100);
  const taxable = gross - disc;
  return { gross: fromPaise(gross), taxable: fromPaise(taxable), total: fromPaise(taxable + Math.round((taxable * Math.max(0, l.gst_rate ?? 0)) / 100)) };
}
/** A figure that is the line's gross or taxable value may be off by this much (a paisa or two of rounding). */
const STAGE_TOLERANCE = 0.03;

/** Days from `from` to `to` (ISO dates). */
function daysBetween(from: string, to: string): number {
  const d = (s: string) => { const [y, m, dd] = s.slice(0, 10).split('-').map(Number); return Math.floor(Date.UTC(y, (m || 1) - 1, dd || 1) / 86_400_000); };
  return d(to) - d(from);
}

export interface CheckContext {
  /** Today's date on the clinic's own calendar, ISO. */
  today: string;
  /** An invoice with this number from this supplier is already recorded? (null when the supplier is new) */
  existingInvoice?: (wholesalerId: number | null, invoiceNumber: string) => { id: number; date: string } | null;
}

export interface CheckResult {
  problems: Problem[];
  errors: number;
  warnings: number;
  reconciliation: Reconciliation;
  /** Lines that will be imported (not set aside). */
  importing: number;
  aside: number;
  /** Nothing blocks the import. */
  ready: boolean;
}

/** Everything wrong or doubtful about ONE line (a set-aside line is only looked at lightly: it is not being imported). */
export function checkLine(l: DraftLine, ctx: CheckContext): Problem[] {
  const out: Problem[] = [];
  const add = (code: string, severity: Problem['severity'], message: string, field?: string) => out.push({ code, severity, line: l.id, field, message });
  if (l.aside) return out;

  // ---- which medicine ----
  if (!l.printed_name.trim()) add('no_name', 'error', 'The medicine name is blank.', 'name');
  if (l.new_drug) {
    if (!l.new_drug.name.trim()) add('new_drug_name', 'error', 'Give the new medicine a name.', 'drug');
    if (!l.new_drug.schedule) add('new_drug_schedule', 'error', 'Choose the schedule of the new medicine (as printed on the pack).', 'drug');
  } else if (l.drug_id === null) {
    add('no_drug', 'error', 'Choose which medicine this is, or add it as a new medicine.', 'drug');
  } else if (!l.confirmed && !(l.match.kind === 'exact' || l.match.kind === 'alias')) {
    add('confirm_match', 'error', 'Confirm that this is the right medicine — the match is not certain.', 'drug');
  }
  if (l.drug_id !== null && !l.new_drug && l.match.composition === 'differ') {
    add('composition_differs', 'warn', 'ChatGPT’s lookup found a DIFFERENT composition from the medicine you matched it to — check the pack (it may be another variant).', 'drug');
  }

  // ---- quantity and money ----
  if (l.qty === null || !(l.qty > 0)) add('bad_qty', 'error', 'The quantity is missing or not more than 0.', 'qty');
  else if (!isInt(l.qty)) add('bad_qty', 'error', `The quantity (${l.qty}) must be a whole number.`, 'qty');
  if (!isInt(l.free_qty) || l.free_qty < 0) add('bad_free', 'error', 'The free quantity must be a whole number (0 or more).', 'free');
  if (l.rate === null || !(l.rate >= 0)) add('bad_rate', 'error', 'The rate is missing — enter what the dealer charges for one unit.', 'rate');
  else if (l.rate === 0) add('zero_rate', 'warn', 'The rate is ₹0 — this stock arrives free, so it counts as costing nothing and the profit on it will look like 100%. If the bill did charge for it, enter the rate.', 'rate');
  if (l.mrp === null || !(l.mrp > 0)) add('no_mrp', 'error', 'Enter the MRP printed on the pack.', 'mrp');
  if (!(l.disc_pct >= 0 && l.disc_pct <= 100)) add('bad_disc', 'error', 'The discount must be between 0% and 100%.', 'disc');
  if (l.gst_rate === null) add('no_gst', 'error', 'Enter the GST % of this line.', 'gst');
  else if (!ALLOWED_GST.includes(l.gst_rate)) {
    const half = HALF_RATES[l.gst_rate];
    add('bad_gst', 'error', half !== undefined
      ? `GST ${l.gst_rate}% looks like only the CGST (or SGST) half — the line's GST is the TOTAL: ${half}%.`
      : `GST ${l.gst_rate}% is not one of the usual rates (${ALLOWED_GST.join(', ')}).`, 'gst');
  }
  if (l.selling_price !== null && l.mrp !== null && toPaise(l.selling_price) > toPaise(l.mrp)) add('sell_over_mrp', 'error', 'The selling price cannot be higher than the MRP.', 'mrp');

  // ---- batch and expiry (a consumable — a syringe, a bed sheet — may print neither; it is then stored as "NO BATCH" / "No expiry") ----
  // (a line not decided yet follows what the bill itself suggests, so a bed sheet is not red for a batch it never had)
  const consumable = l.new_drug ? l.new_drug.item_type === 'consumable' : l.drug_id !== null ? l.consumable === true : l.suggested_new?.item_type === 'consumable';
  if (!l.batch.trim()) { if (!consumable) add('no_batch', 'error', 'Enter the batch number from the strip or bottle.', 'batch'); }
  else if (!consumable && looksLikePlaceholderBatch(l.batch)) add('placeholder_batch', 'error', `“${l.batch.trim()}” is not a real batch number — type the one printed on the pack.`, 'batch');
  if (!l.expiry) { if (!consumable || l.expiry_problem) add('no_expiry', 'error', l.expiry_problem || 'Enter the expiry date (month and year printed on the pack).', 'expiry'); }
  else if (!isNoExpiry(l.expiry)) {
    const left = daysBetween(ctx.today, l.expiry);
    if (left < 0) add('expired', 'error', `This batch expired ${-left} day${left === -1 ? '' : 's'} ago (${l.expiry}). Check the pack — if it really is expired, set this line aside.`, 'expiry');
    else if (left <= 180) add('short_dated', 'warn', `Short expiry: only ${left} day${left === 1 ? '' : 's'} left (${l.expiry}).`, 'expiry');
    else if (daysBetween(ctx.today, l.expiry) > 365 * 8) add('far_expiry', 'warn', `The expiry (${l.expiry}) is more than 8 years away — check the year.`, 'expiry');
  }

  if (l.disc_derived) {
    add('disc_derived', 'warn', `This bill has no discount column. The ${l.disc_pct}% discount was worked out from the line's printed amount ${money(l.printed_amount ?? 0)} (it adds up with the other lines to the discount the bill prints). Compare it with the bill.`, 'disc');
  }

  // ---- does the line add up? ----
  const stages = lineStages(l);
  if (stages !== null && l.printed_amount !== null) {
    const p = l.printed_amount;
    const matches = Math.abs(p - stages.gross) <= STAGE_TOLERANCE || Math.abs(p - stages.taxable) <= STAGE_TOLERANCE || Math.abs(p - stages.total) <= LINE_TOLERANCE;
    if (!matches) {
      add('line_amount_differs', 'warn', `The bill prints ${money(p)} for this line, but quantity × rate is ${money(stages.gross)}, after the discount ${money(stages.taxable)} and with GST ${money(stages.total)} — it matches none of them. Compare with the bill (the quantity, rate or amount may be misread).`, 'amount');
    }
  }
  if (l.mrp !== null && l.rate !== null && l.rate > 0 && l.mrp >= 4 * l.rate) {
    add('mrp_far_above_rate', 'warn', `The MRP (${money(l.mrp)}) is ${Math.round((l.mrp / l.rate) * 10) / 10} times the rate (${money(l.rate)}). Check that it is the MRP of ONE unit, not of a whole box.`, 'mrp');
  }
  const scheme = schemeInName(l.printed_name);
  if (scheme && (l.free_qty || 0) === 0) {
    add('scheme_in_name', 'warn', `The name says ${scheme.paid}+${scheme.free} — a free offer — but Free is 0. If the bill gives free units (look in its Free / F.Q column), enter them.`, 'free');
  }
  if (l.mrp !== null && l.rate !== null && l.mrp > 0 && l.rate > 0 && l.gst_rate !== null && l.rate * (1 + l.gst_rate / 100) > l.mrp + 0.005) {
    add('mrp_below_cost', 'warn', `The MRP (${money(l.mrp)}) is lower than the rate with GST (${money(l.rate * (1 + l.gst_rate / 100))}) — you would sell below cost. Check the MRP and the rate.`, 'mrp');
  }
  if (l.lookup_suspect) {
    const seen = [l.lookup_seen?.brand, l.lookup_seen?.generic].filter(Boolean).join(' / ');
    add('lookup_mismatch', 'warn', `ChatGPT's lookup for this line (${seen}) does not look like “${l.printed_name}” — it may belong to another row, so it was NOT used. Check the pack, and fill in the generic name and strength yourself.`, 'drug');
  }
  if (l.flags.trim()) add('chatgpt_flags', 'warn', `ChatGPT noted: ${l.flags.trim()}`);
  return out;
}

/** The bill as a whole: supplier, invoice number and date, a duplicate, and whether the totals add up. */
export function checkBill(bill: DraftBill, lines: DraftLine[], ctx: CheckContext): Problem[] {
  const out: Problem[] = [];
  const add = (code: string, severity: Problem['severity'], message: string, field?: string) => out.push({ code, severity, line: null, field, message });
  if (bill.wholesaler_id === null) {
    if (!bill.supplier_name.trim()) add('no_supplier', 'error', 'Choose the supplier this bill is from.', 'supplier');
    else if (!bill.supplier_license.trim()) add('new_supplier_licence', 'error', `${bill.supplier_name.trim()} is not in your Wholesalers list. Pick the supplier, or type its drug licence number to add it.`, 'supplier');
  }
  if (!bill.invoice_number.trim()) add('no_invoice_number', 'error', 'Enter the invoice number.', 'invoice_number');
  if (!bill.invoice_date) add('bad_invoice_date', 'error', 'Enter the invoice date.', 'invoice_date');
  else {
    const age = daysBetween(bill.invoice_date, ctx.today);
    if (age < 0) add('future_invoice_date', 'error', `The invoice date (${bill.invoice_date}) is in the future.`, 'invoice_date');
    else if (age > 400) add('old_invoice', 'warn', `This bill is ${age} days old (${bill.invoice_date}). Check the date.`, 'invoice_date');
  }
  if (bill.invoice_number.trim() && bill.invoice_date) {
    const dup = ctx.existingInvoice?.(bill.wholesaler_id, bill.invoice_number.trim());
    if (dup) add('duplicate_invoice', 'error', `Invoice ${bill.invoice_number.trim()} from this supplier is already recorded (dated ${dup.date}). Open it from Purchases instead of importing it again.`, 'invoice_number');
  }
  const miss = pagesMissing(bill.pages_seen);
  if (miss) {
    add('pages_missing', bill.totals_ack ? 'warn' : 'error',
      `ChatGPT saw only ${miss.seen === 1 ? 'page 1' : `${miss.seen} pages`} of this ${miss.total}-page bill: the rest of the lines and the bill's total are on the other page${miss.total - miss.seen === 1 ? '' : 's'}. ` +
      `Give ChatGPT every page and ask for the file again — importing part of a bill would make the other part look "already recorded". ${bill.totals_ack ? 'You have chosen to go on.' : 'Or tick “I have checked this difference” if you really mean to import only this part.'}`, 'pages');
  }
  if (!(bill.discount >= 0)) add('bad_invoice_discount', 'error', 'The invoice discount cannot be negative.', 'discount');
  if (!(bill.other_charges >= 0)) add('bad_other_charges', 'error', 'Other charges cannot be negative.', 'other');
  void lines;
  return out;
}

/** Does the bill add up? The whole bill (the lines being imported AND the ones set aside, by their printed amounts) against the bill's printed total. */
export function reconcile(bill: DraftBill, lines: DraftLine[]): Reconciliation {
  const real = lines.filter((l) => !l.aside && l.qty !== null && l.qty > 0 && l.rate !== null && l.rate >= 0)
    .map((l) => ({ qty: l.qty as number, free_qty: l.free_qty || 0, rate: l.rate as number, disc_pct: l.disc_pct || 0, gst_rate: l.gst_rate ?? 0 }));
  const asideLines = lines.filter((l) => l.aside);
  /** What a set-aside line comes to WITH GST: its printed amount, unless the bill printed that amount before the discount or before the GST (then the line's own figure with GST). */
  const withGst = (l: DraftLine): number => {
    const p = l.printed_amount as number;
    const st = lineStages(l);
    return st !== null && (Math.abs(p - st.gross) <= STAGE_TOLERANCE || Math.abs(p - st.taxable) <= STAGE_TOLERANCE) ? st.total : p;
  };
  const asidePrinted = fromPaise(asideLines.reduce((s, l) => s + (l.printed_amount === null ? 0 : toPaise(withGst(l))), 0));
  // a set-aside line stands in by its amount (ex-GST), so the invoice discount is shared as it would be on the whole bill
  const pseudo = asideLines.filter((l) => l.printed_amount !== null).map((l) => ({ qty: 1, free_qty: 0, rate: withGst(l) / (1 + (l.gst_rate ?? 0) / 100), disc_pct: 0, gst_rate: l.gst_rate ?? 0 }));
  const opts = { header_discount: bill.discount, other_charges: bill.other_charges, interstate: bill.interstate, gst_in_cost: false, round_off: bill.round_off };
  let computed = 0;
  try { computed = computePurchase([...real, ...pseudo], opts).total; } catch { computed = 0; }
  const net = bill.printed.net;
  const difference = net === null ? null : fromPaise(toPaise(net) - toPaise(computed));
  let parts: ReconPart[] = [];
  if (asideLines.length === 0 && real.length > 0) {
    try { parts = reconParts(bill, computePurchase(real, opts)); } catch { parts = []; }
  }
  return { printed_net: net, computed_total: computed, aside_printed: asidePrinted, difference, ok: difference !== null && Math.abs(difference) <= TOTAL_TOLERANCE, parts };
}

/** The bill's footer figures against the same figures from the lines: the sub total, the discount, the GST — so a difference says WHERE it is. */
function reconParts(bill: DraftBill, calc: ReturnType<typeof computePurchase>): ReconPart[] {
  const p = bill.printed;
  const out: ReconPart[] = [];
  const part = (label: string, printed: number, lines: number) => out.push({ label, printed, lines, diff: Math.round((printed - lines) * 100) / 100 });
  if (p.subtotal !== null) {
    // a "sub total" is either before the discount or after it: compare with whichever the bill's own figure is nearer to
    if (Math.abs(p.subtotal - calc.subtotal) <= Math.abs(p.subtotal - calc.taxable)) part('Items total before discount (quantity × rate)', p.subtotal, calc.subtotal);
    else part('Items total after discount, before GST', p.subtotal, calc.taxable);
  }
  if (p.discount !== null) part('Discount', p.discount, calc.discount);
  if (p.cgst !== null || p.sgst !== null || p.igst !== null) part('GST (CGST + SGST + IGST)', (p.cgst ?? 0) + (p.sgst ?? 0) + (p.igst ?? 0), calc.gst);
  return out;
}

/** Run every check. */
export function checkDraft(draft: Draft, ctx: CheckContext): CheckResult {
  const problems: Problem[] = [...checkBill(draft.bill, draft.lines, ctx)];
  for (const l of draft.lines) problems.push(...checkLine(l, ctx));

  const importing = draft.lines.filter((l) => !l.aside).length;
  const aside = draft.lines.length - importing;
  if (importing === 0) problems.push({ code: 'nothing_to_import', severity: 'error', line: null, message: aside > 0 ? 'Every line is set aside — nothing to import.' : 'The bill has no lines.' });

  // the same batch on several lines is joined into one batch of stock (each line is still recorded on the bill)
  const seen = new Map<string, DraftLine[]>();
  for (const l of draft.lines) {
    if (l.aside || !l.batch.trim()) continue;
    const who = l.drug_id !== null ? `d${l.drug_id}` : l.new_drug ? `n${l.new_drug.name.toLowerCase()}` : `p${l.printed_name.toLowerCase()}`;
    const k = `${who}|${l.batch.trim().toLowerCase()}`;
    seen.set(k, [...(seen.get(k) ?? []), l]);
  }
  for (const group of seen.values()) {
    if (group.length > 1) problems.push({ code: 'repeat_batch', severity: 'info', line: group[0].id, message: `Lines ${group.map((g) => g.line_no || g.id).join(', ')} are the same medicine and batch (${group[0].batch.trim()}): they will be joined into one batch of stock, each still recorded on the bill.` });
  }

  const reconciliation = reconcile(draft.bill, draft.lines);
  if (reconciliation.difference !== null && !reconciliation.ok) {
    const d = reconciliation.difference;
    problems.push({
      code: 'totals_differ', severity: draft.bill.totals_ack ? 'warn' : 'error', line: null, field: 'totals',
      message: `The bill’s total is ${money(reconciliation.printed_net as number)} but the lines add up to ${money(reconciliation.computed_total)} ` +
        `(${d > 0 ? 'short by' : 'over by'} ${money(Math.abs(d))}). A line may be misread or missing, or the bill has a discount or charge not entered yet.` +
        (reconciliation.parts ?? []).filter((x) => Math.abs(x.diff) > 0.5).map((x) => ` ${x.label}: the bill ${money(x.printed)}, your lines ${money(x.lines)} (${x.diff > 0 ? 'short by' : 'over by'} ${money(Math.abs(x.diff))}).`).join('') +
        `${draft.bill.totals_ack ? ' You have accepted this difference.' : ' Fix the lines, or tick “I have checked this difference”.'}`,
    });
  }
  // the bill's own lines against its own total — catches a MISSING line even when quantity × rate is right
  const all = draft.lines;
  // only meaningful when the printed line amounts are the lines' totals WITH GST — a gross or taxable column adds up to the sub total, not to the net
  const amountsWithGst = all.length > 0 && all.every((l) => { const st = lineStages(l); return st !== null && l.printed_amount !== null && Math.abs(l.printed_amount - st.total) <= LINE_TOLERANCE; });
  if (amountsWithGst && draft.bill.printed.net !== null) {
    const sum = fromPaise(all.reduce((s, l) => s + toPaise(l.printed_amount as number), 0));
    if (Math.abs(sum - draft.bill.printed.net) > TOTAL_TOLERANCE + 0.5) {
      problems.push({ code: 'lines_dont_add_up', severity: 'warn', line: null, message: `The line amounts printed on the bill add up to ${money(sum)}, but the bill’s total is ${money(draft.bill.printed.net)} — a line may be missing from the file.` });
    }
  }
  if (draft.bill.paid_now > 0 && toPaise(draft.bill.paid_now) > toPaise(reconciliation.computed_total)) {
    problems.push({ code: 'paid_too_much', severity: 'error', line: null, field: 'paid', message: 'The amount paid now is more than the bill total.' });
  }

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warn').length;
  return { problems, errors, warnings, reconciliation, importing, aside, ready: errors === 0 && importing > 0 };
}
