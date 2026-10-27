/**
 * From the cells of the Excel to a draft the screen can show: header, lines, which medicine each line is, which supplier — and what is still missing.
 * Pure: it is given the sheet's cells and the clinic's lists, and touches nothing.
 */
import { BILL_FIELDS, FORM_FAMILIES, ITEM_COLUMNS, SHEET_BILL, SHEET_ITEMS, billFieldFor, itemColumnFor } from './template';
import { cleanText, parseBillDate, parseExpiry, parseNumber, simplify } from './normalize';
import { lookupCell, lookupFits, looksConsumable, pagesMissing, printedStrength, stripBillingNotes } from './items';
import { makeMatcher, tokenize, wordSimilarity, type AliasRef, type DrugRef } from './match';
import type { Draft, DraftBill, DraftLine, LineLookup, NewDrugSpec, PrintedTotals } from './types';

/** The sheets as plain cells, as read from the file. */
export interface ReadResult {
  bill: Record<string, unknown>;
  items: (Record<string, unknown> & { __row: number })[];
  /** Reasons the file is refused (a must-have is missing). Empty = accepted. */
  problems: string[];
  /** Things worth telling the person that do not refuse the file (a "Total" row that was ignored…). */
  notices: string[];
}

const blank = (v: unknown) => cleanText(v) === '';
const MAX_LISTED = 15;
const limit = (xs: string[]) => (xs.length > MAX_LISTED ? [...xs.slice(0, MAX_LISTED), `…and ${xs.length - MAX_LISTED} more.`] : xs);

/** Read the two sheets' cells (rows of cells; the first sheet "Bill" is Field | Value, the second "Items" has a header row). */
export function readBillRows(billRows: unknown[][] | null, itemRows: unknown[][] | null): ReadResult {
  const problems: string[] = [];
  const notices: string[] = [];
  const bill: Record<string, unknown> = {};

  if (!billRows) problems.push(`The file has no sheet called "${SHEET_BILL}". Ask ChatGPT for the file again with the prompt from step 1.`);
  else {
    for (const row of billRows) {
      const label = cleanText(row?.[0]);
      if (!label) continue;
      const f = billFieldFor(label);
      if (!f) continue;                                               // a field we do not know: ignored
      if (blank(bill[f.key]) && !blank(row?.[1])) bill[f.key] = row[1];
    }
    for (const f of BILL_FIELDS.filter((x) => x.need === 'must')) {
      if (blank(bill[f.key])) problems.push(`The Bill sheet has no value for "${f.label}".`);
    }
    // a bill of several pages read in part: its total is on the LAST page, so the plain "no total" message would not tell the person what to do
    const miss = pagesMissing(cleanText(bill.pages_seen));
    if (miss && blank(bill.printed_net)) {
      const msg = `This bill has ${miss.total} pages and ChatGPT saw only ${miss.seen === 1 ? 'page 1' : `${miss.seen} of them`} — the bill's total is on the last page. Give ChatGPT every page of the bill (in step 2) and ask for the file again.`;
      const k = problems.findIndex((x) => x.includes('"Printed net amount"'));
      if (k >= 0) problems[k] = msg; else problems.push(msg);
    }
  }

  const items: ReadResult['items'] = [];
  if (!itemRows) problems.push(`The file has no sheet called "${SHEET_ITEMS}". Ask ChatGPT for the file again with the prompt from step 1.`);
  else {
    // the header row: the first row in which at least three cells are column names we know
    let headerAt = -1;
    for (let i = 0; i < Math.min(itemRows.length, 15); i++) {
      if ((itemRows[i] ?? []).filter((c) => itemColumnFor(c)).length >= 3) { headerAt = i; break; }
    }
    if (headerAt < 0) problems.push(`The "${SHEET_ITEMS}" sheet has no header row with the column names (Name as printed, Qty, Rate …).`);
    else {
      const colKey: (string | null)[] = (itemRows[headerAt] ?? []).map((c) => itemColumnFor(c)?.key ?? null);
      const have = new Set(colKey.filter(Boolean) as string[]);
      for (const c of ITEM_COLUMNS.filter((x) => x.need === 'must')) {
        if (!have.has(c.key)) problems.push(`The "${SHEET_ITEMS}" sheet has no "${c.header}" column.`);
      }
      const rowProblems: string[] = [];
      for (let i = headerAt + 1; i < itemRows.length; i++) {
        const cells = itemRows[i] ?? [];
        const rec: Record<string, unknown> & { __row: number } = { __row: i + 1 };
        const seen = new Set<string>();
        colKey.forEach((k, ci) => { if (k && !seen.has(k)) { seen.add(k); rec[k] = cells[ci]; } });
        if (colKey.every((k, ci) => !k || blank(cells[ci]))) continue;       // an empty row
        const name = cleanText(rec.printed_name);
        // a total / discount / round-off row that ChatGPT put among the lines: not a medicine
        if (/^(sub\s*total|grand\s*total|total|round\s*off|discount|net amount|amount|cgst|sgst|igst|tax)\b/i.test(name) && blank(rec.batch) && blank(rec.mrp)) {
          notices.push(`Row ${i + 1} (“${name}”) looks like a total, not a medicine — it was left out.`);
          continue;
        }
        if (!name) rowProblems.push(`Row ${i + 1}: the medicine name (“Name as printed”) is blank.`);
        if (blank(rec.qty)) rowProblems.push(`Row ${i + 1}${name ? ` (${name})` : ''}: Qty is blank.`);
        else if (qtyOf(rec.qty).qty === null) rowProblems.push(`Row ${i + 1}${name ? ` (${name})` : ''}: Qty “${cleanText(rec.qty)}” is not a number.`);
        if (blank(rec.rate)) rowProblems.push(`Row ${i + 1}${name ? ` (${name})` : ''}: Rate is blank.`);
        else if (parseNumber(rec.rate) === null) rowProblems.push(`Row ${i + 1}${name ? ` (${name})` : ''}: Rate “${cleanText(rec.rate)}” is not a number.`);
        items.push(rec);
      }
      problems.push(...limit(rowProblems));
      if (!rowProblems.length && !items.length) problems.push(`The "${SHEET_ITEMS}" sheet has no lines under the header row.`);
    }
  }
  return { bill, items, problems, notices };
}

/** A quantity cell: a number, or a scheme written "10+2" (10 paid + 2 free). */
function qtyOf(v: unknown): { qty: number | null; free: number | null } {
  const t = cleanText(v);
  const m = t.match(/^(\d+)\s*\+\s*(\d+)$/);
  if (m) return { qty: Number(m[1]), free: Number(m[2]) };
  return { qty: parseNumber(v), free: null };
}
/** A GST cell: a number, or a sum written out ("2.5+2.5"). */
function gstOf(v: unknown): number | null {
  const t = cleanText(v);
  const m = t.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) + Number(m[2]);
  return parseNumber(v);
}

/** Units in one pack, from the pack text: "1x10" → 10, "100 ml" → 100, "15's" → 15, "1'UNIT" → 1 (a part of a millilitre is never rounded UP to a whole one). */
export function packUnits(pack: string): number | null {
  const t = cleanText(pack).toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(\d+)\s*[x×]\s*(\d+)/))) return Number(m[2]);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(ml|l)\b/))) return Math.max(1, Math.floor(Number(m[1]) * (m[2] === 'l' ? 1000 : 1)));
  if ((m = t.match(/(\d+)\s*['’`]?\s*(?:s|units?|pcs?|nos?|pieces?)\b/))) return Number(m[1]);
  if ((m = t.match(/^\(?(\d+)\)?$/))) return Number(m[1]);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- the supplier
const SUPPLIER_NOISE = new Set(['pvt', 'ltd', 'private', 'limited', 'llp', 'co', 'company', 'and', 'the', 'inc', 'corp']);
const supplierWords = (n: string) => simplify(n).replace(/\./g, ' ').split(' ').filter((w) => w && !SUPPLIER_NOISE.has(w));
const gstinKey = (g: string) => cleanText(g).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** `is_active`: 1/true (or missing) = in use; 0/false = switched off under Wholesalers. A switched-off supplier is still matched — importing a bill from it switches it on again. */
export interface SupplierRef { id: number; name: string; gstin: string | null; drug_license_no: string | null; is_active?: number | boolean | null }
const supplierOn = (s: SupplierRef) => s.is_active === undefined || s.is_active === null || s.is_active === true || s.is_active === 1;
export function matchSupplier(name: string, gstin: string, suppliers: SupplierRef[]): { id: number | null; suggestions: { id: number; name: string; reason: string }[] } {
  const g = gstinKey(gstin);
  // a supplier in use wins over a switched-off one that looks the same
  const list = [...suppliers].sort((a, b) => Number(supplierOn(b)) - Number(supplierOn(a)));
  if (g.length === 15) { const hit = list.find((s) => s.gstin && gstinKey(s.gstin) === g); if (hit) return { id: hit.id, suggestions: [] }; }
  const w = supplierWords(name);
  if (w.length) {
    const same = list.filter((s) => { const x = supplierWords(s.name); return x.length === w.length && w.every((a) => x.includes(a)); });
    if (same.length === 1) return { id: same[0].id, suggestions: [] };
    const on = same.filter(supplierOn);
    if (on.length === 1) return { id: on[0].id, suggestions: [] };
  }
  const suggestions = list.map((s) => {
    const x = supplierWords(s.name);
    const common = w.filter((a) => x.some((b) => a === b || wordSimilarity(a, b) > 0)).length;
    return { s, score: w.length && x.length ? common / Math.max(w.length, x.length) : 0 };
  }).filter((r) => r.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3)
    .map((r) => ({ id: r.s.id, name: r.s.name, reason: 'the name is similar' }));
  return { id: null, suggestions };
}

// ---------------------------------------------------------------------------------------------------------------- the draft
export interface BuildContext {
  drugs: DrugRef[];
  aliases: AliasRef[];
  suppliers: SupplierRef[];
  /** Today, ISO — used only to name defaults; the checks use their own. */
  today: string;
}

const num = (v: unknown) => parseNumber(v);
const FORM_NAMES = new Set(['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Drops', 'Injection', 'Ointment', 'Cream', 'Gel', 'Inhaler', 'Powder', 'Sachet', 'Respules', 'Solution', 'Spray', 'Other']);
function formName(lookupForm: string, printed: string): string {
  const fam = FORM_FAMILIES[cleanText(lookupForm).toLowerCase()] ?? (FORM_NAMES.has(cleanText(lookupForm)) ? cleanText(lookupForm) : '');
  // "PARABOOST IV", "ALKEM METRO IV": IV in a name is an intravenous product — an injection or a drip
  return fam || tokenize(printed).form || (/(^|[\s-])i\.?v\.?($|[\s-])/i.test(printed) ? 'Injection' : 'Other');
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A discount on the WHOLE bill: what the bill prints as its discount, less what the lines' own discounts already come to — and only when that leaves
 * more than a rupee (below it, the lines explain it). Worked out again whenever a line is corrected (edit.ts), so a misread quantity can never leave a
 * discount behind that the corrected line has already covered.
 */
export function autoBillDiscount(printedDiscount: number | null, lines: Pick<DraftLine, 'qty' | 'rate' | 'disc_pct'>[]): number {
  const lineDisc = lines.reduce((s, l) => s + (l.qty !== null && l.rate !== null ? l.qty * l.rate * ((l.disc_pct || 0) / 100) : 0), 0);
  return printedDiscount !== null && printedDiscount > lineDisc + 1 ? Math.round((printedDiscount - lineDisc) * 100) / 100 : 0;
}

/**
 * A bill with NO discount column still shows each line's amount AFTER its discount (the "Taxable Amt" column before it, the GST and the Total after it —
 * Alprax: 10 × ₹100, GST 12%, printed ₹1,008 instead of ₹1,120), and a discount total at the bottom. Left alone, that discount would be spread over
 * all the lines in proportion and the tax would come out a few rupees wrong. So where a line's printed amount is smaller than quantity × rate + GST by a
 * CLEAN percentage (it reproduces the printed amount to the paisa), that percentage is the line's discount — but only if the discounts found this way,
 * with any printed in a column, add up to the discount the bill prints. Arithmetic on the bill's own numbers, never a guess; the line is marked so a
 * person can compare it with the bill.
 */
function deriveDiscounts(lines: DraftLine[], raw: ReadResult['items'], printedDiscount: number | null): void {
  if (printedDiscount === null || !(printedDiscount > 0)) return;
  const found: { l: DraftLine; pct: number; money: number }[] = [];
  let explicit = 0;
  lines.forEach((l, i) => {
    const gross = l.qty !== null && l.rate !== null ? l.qty * l.rate : null;
    if (gross === null) return;
    if (!blank(raw[i].disc_pct)) { explicit += gross * ((l.disc_pct || 0) / 100); return; }
    if (l.printed_amount === null || l.gst_rate === null || !(gross > 0)) return;
    const full = gross * (1 + l.gst_rate / 100);
    if (l.printed_amount >= full - 0.02) return;                                  // no discount on this line (a paisa of rounding is not one)
    const pct = r2((1 - l.printed_amount / full) * 100);
    if (!(pct > 0 && pct <= 60)) return;
    if (Math.abs(gross * (1 - pct / 100) * (1 + l.gst_rate / 100) - l.printed_amount) > 0.02) return;   // not a clean percentage: leave it for a person
    found.push({ l, pct, money: gross * (pct / 100) });
  });
  if (!found.length) return;
  const sum = explicit + found.reduce((s, f) => s + f.money, 0);
  if (Math.abs(sum - printedDiscount) > 1.0) return;                               // they do not explain the bill's discount: do not apply any
  for (const f of found) { f.l.disc_pct = f.pct; f.l.disc_derived = true; }
}

export function buildDraft(read: ReadResult, ctx: BuildContext): Draft {
  const b = read.bill;
  const text = (k: string) => cleanText(b[k]);
  const printed: PrintedTotals = {
    subtotal: num(b.printed_subtotal), discount: num(b.printed_discount), cgst: num(b.printed_cgst), sgst: num(b.printed_sgst), igst: num(b.printed_igst),
    round_off: num(b.printed_round_off), other: num(b.printed_other), net: num(b.printed_net),
  };
  const date = parseBillDate(b.invoice_date);
  const sup = matchSupplier(text('supplier_name'), text('supplier_gstin'), ctx.suppliers);
  const matcher = makeMatcher(ctx.drugs, ctx.aliases);

  const lines: DraftLine[] = read.items.map((r, i) => {
    const shown: LineLookup = {
      brand: lookupCell(r.brand), generic: lookupCell(r.generic), strength: lookupCell(r.strength), form: lookupCell(r.form),
      source: cleanText(r.lookup_source),
      confidence: ((): LineLookup['confidence'] => { const c = cleanText(r.lookup_confidence).toLowerCase(); return c.startsWith('h') ? 'High' : c.startsWith('m') ? 'Medium' : c.startsWith('l') ? 'Low' : ''; })(),
    };
    // a lookup that shares no word with this line's own name belongs to another row: shown for the person, never used to suggest or match anything
    const suspect = !lookupFits(cleanText(r.printed_name), shown);
    const lookup: LineLookup = suspect ? { brand: '', generic: '', strength: '', form: '', source: '', confidence: '' } : shown;
    const q = qtyOf(r.qty);
    const freeCell = num(r.free_qty);
    const flags = [cleanText(r.flags), q.free !== null ? `Qty written as ${cleanText(r.qty)}: read as ${q.qty} paid + ${q.free} free — check` : ''].filter(Boolean).join('; ');
    // expiry: the normalised column first, else what was printed; if both read and name different months, a person decides
    const normalised = parseExpiry(r.expiry_mmyyyy), asPrinted = parseExpiry(r.expiry_printed);
    let expiry = normalised.iso ?? asPrinted.iso ?? '';
    let expiryProblem = (blank(r.expiry_mmyyyy) ? asPrinted.problem : normalised.problem) ?? '';
    if (normalised.iso && asPrinted.iso && normalised.iso.slice(0, 7) !== asPrinted.iso.slice(0, 7)) {
      expiry = ''; expiryProblem = `The two expiry columns disagree (${cleanText(r.expiry_printed)} and ${cleanText(r.expiry_mmyyyy)}) — check the pack.`;
    }
    const printedName = cleanText(r.printed_name);
    const m = matcher.match(printedName, lookup, sup.id);
    const certain = m.certain;
    const pack = cleanText(r.pack);
    const notStandard = /not a (standard )?medicine/i.test(flags);
    // a syringe, a cannula, a suture, a bed sheet: told by ChatGPT's own note, the HSN code or plain words in the name — never a medicine's schedule or strength
    const consumableLine = looksConsumable({ name: printedName, hsn: cleanText(r.hsn), flags });
    const matchedConsumable = m.drug_id !== null && ctx.drugs.find((d) => d.id === m.drug_id)?.item_type === 'consumable';
    const form = formName(lookup.form, printedName);
    const cleanName = stripBillingNotes(printedName) || printedName;                      // "-NO DISC" is the dealer's note, not part of the name
    const suggested: NewDrugSpec = consumableLine
      ? { name: cleanName, generic_name: '', form: 'Consumable', strength: '', schedule: 'OTC', pack_size: 1, hsn_code: cleanText(r.hsn), item_type: 'consumable' }
      : {
        name: lookup.brand && lookup.confidence !== 'Low' && lookup.confidence !== '' ? lookup.brand : cleanName,
        generic_name: lookup.generic, form, strength: lookup.strength || printedStrength(printedName),
        // one ampoule, vial or bottle of an injection is ONE unit whatever its millilitres
        schedule: notStandard ? 'OTC' : 'H', pack_size: form === 'Injection' && /\b(ml|l)\b|\d\s*(ml|l)\b/i.test(pack) ? 1 : packUnits(pack), hsn_code: cleanText(r.hsn),
      };
    return {
      id: i + 1, row: r.__row, line_no: cleanText(r.line_no) || String(i + 1), printed_name: printedName, lookup, pack,
      manufacturer: cleanText(r.manufacturer), hsn: cleanText(r.hsn), batch: cleanText(r.batch), expiry, expiry_printed: cleanText(r.expiry_printed), expiry_problem: expiryProblem,
      qty: q.qty, free_qty: q.free ?? freeCell ?? 0, mrp: num(r.mrp), rate: num(r.rate), disc_pct: num(r.disc_pct) ?? 0, gst_rate: gstOf(r.gst_pct),
      selling_price: null, printed_amount: num(r.line_amount), flags,
      drug_id: m.drug_id, new_drug: null, confirmed: certain, aside: false,
      match: { kind: m.kind, candidates: m.candidates, composition: m.composition },
      suggested_new: suggested,
      ...(matchedConsumable ? { consumable: true } : {}),
      ...(suspect ? { lookup_suspect: true, lookup_seen: shown } : {}),
    };
  });

  deriveDiscounts(lines, read.items, printed.discount);

  // header amounts: what is on the bill, unless the lines' own discounts already explain it
  const billDiscount = autoBillDiscount(printed.discount, lines);
  const bill: DraftBill = {
    supplier_name: text('supplier_name'), supplier_gstin: gstinKey(text('supplier_gstin')) || text('supplier_gstin'), supplier_license: text('supplier_license'),
    wholesaler_id: sup.id, invoice_number: text('invoice_number'), invoice_date: date.iso ?? '', invoice_date_printed: text('invoice_date'),
    payment_terms: text('payment_terms'), printed, pages_seen: text('pages_seen'), notes: text('notes'),
    discount: billDiscount, discount_auto: true, other_charges: printed.other !== null && printed.other > 0 ? printed.other : 0,
    round_off: printed.round_off !== null && Math.abs(printed.round_off) > 0.004 ? 'auto' : 0,
    interstate: (printed.igst ?? 0) > 0 && !((printed.cgst ?? 0) > 0 || (printed.sgst ?? 0) > 0),
    paid_now: 0, pay_mode: /cash/i.test(text('payment_terms')) ? 'Cash' : '', totals_ack: false, part_of: '',
    supplier_suggestions: sup.suggestions,
  };
  return { bill, lines };
}
