/**
 * The bill-import Excel: what the file must contain, and the prompt that makes ChatGPT produce it.
 *
 * One definition serves everything — the prompt text, the downloadable template, the reader that parses the file, and the help the screen shows —
 * so they can never drift apart.
 *
 * How strict it is:
 *   · FILE-level must-haves ("must"): without them the file is refused with a plain list (supplier, invoice number and date, the printed total;
 *     on every line the name, quantity and rate);
 *   · SAVE-level must-haves ("save"): may be blank in the file (a blurred batch, a bill with no MRP column) but the screen will not import until a
 *     person has filled them from the bill: batch, expiry, MRP, GST %;
 *   · everything else is optional.
 */

export type Need = 'must' | 'save' | 'optional';

export interface BillField { key: string; label: string; need: Need; aliases: string[]; hint: string }
export interface ItemColumn { key: string; header: string; need: Need; aliases: string[]; hint: string }

/** Sheet "Bill": two columns, Field | Value. */
export const BILL_FIELDS: BillField[] = [
  { key: 'supplier_name', label: 'Supplier name', need: 'must', aliases: ['supplier', 'seller', 'seller name', 'vendor', 'wholesaler', 'distributor'], hint: 'The company that SOLD the medicines (the letterhead / “For …” signature), not the clinic.' },
  { key: 'supplier_gstin', label: 'Supplier GSTIN', need: 'optional', aliases: ['gstin', 'supplier gst', 'gst no', 'gst number'], hint: 'The seller’s GST number, if printed.' },
  { key: 'supplier_license', label: 'Supplier drug licence no', need: 'optional', aliases: ['drug licence no', 'drug license no', 'dl no', 'dl number', 'licence no', 'license no', 'd l no', 'supplier dl'], hint: 'The seller’s drug licence number (“DL No.”), if printed.' },
  { key: 'invoice_number', label: 'Invoice number', need: 'must', aliases: ['invoice no', 'invoice no.', 'bill no', 'bill number', 'invoice #', 'inv no'], hint: 'Exactly as printed.' },
  { key: 'invoice_date', label: 'Invoice date', need: 'must', aliases: ['date', 'bill date', 'invoice dt'], hint: 'Day first, as printed (28-04-2024).' },
  { key: 'payment_terms', label: 'Payment terms', need: 'optional', aliases: ['payment', 'payment type', 'invoice type', 'terms', 'cash/credit'], hint: 'Cash or Credit, as printed.' },
  { key: 'printed_subtotal', label: 'Printed sub total', need: 'optional', aliases: ['sub total', 'subtotal', 'amt before tax', 'taxable total', 'total before tax'], hint: 'The bill’s sub total / amount before tax, as printed.' },
  { key: 'printed_discount', label: 'Printed discount', need: 'optional', aliases: ['discount', 'total discount', 'less discount'], hint: 'The bill’s total discount, as printed (a positive number).' },
  { key: 'printed_cgst', label: 'Printed CGST', need: 'optional', aliases: ['cgst', 'cgst total', 'cgst amt'], hint: 'Total CGST, as printed.' },
  { key: 'printed_sgst', label: 'Printed SGST', need: 'optional', aliases: ['sgst', 'sgst total', 'sgst amt'], hint: 'Total SGST, as printed.' },
  { key: 'printed_igst', label: 'Printed IGST', need: 'optional', aliases: ['igst', 'igst total', 'igst amt'], hint: 'Total IGST, as printed.' },
  { key: 'printed_round_off', label: 'Printed round off', need: 'optional', aliases: ['round off', 'roundoff', 'rounding', 'round-off'], hint: 'Round off, as printed (may be negative).' },
  { key: 'printed_other', label: 'Printed freight / other charges', need: 'optional', aliases: ['freight', 'other charges', 'freight / other charges', 'courier', 'packing'], hint: 'Freight, packing or any other charge, as printed.' },
  { key: 'printed_net', label: 'Printed net amount', need: 'must', aliases: ['net amount', 'net payable', 'grand total', 'total amount', 'invoice total', 'bill total', 'total'], hint: 'The final amount payable, as printed.' },
  { key: 'pages_seen', label: 'Pages seen', need: 'optional', aliases: ['pages', 'page'], hint: 'For example “1 of 1”.' },
  { key: 'notes', label: 'Notes', need: 'optional', aliases: ['remarks', 'comments', 'note'], hint: 'Anything odd about the bill (totals that disagree, shifted labels…).' },
];

/** Sheet "Items": one header row, then one row per bill line. */
export const ITEM_COLUMNS: ItemColumn[] = [
  { key: 'line_no', header: 'Line no', need: 'optional', aliases: ['sr', 'sr.', 'sr no', 's.no', 'sl', 'sl no', 'no', '#'], hint: 'The serial number printed on the bill.' },
  { key: 'printed_name', header: 'Name as printed', need: 'must', aliases: ['product', 'product name', 'item', 'item name', 'description', 'item description', 'particulars', 'product details & services', 'name'], hint: 'The medicine exactly as printed, letter for letter.' },
  { key: 'brand', header: 'Brand name', need: 'optional', aliases: ['brand'], hint: 'Looked up on the internet: the brand with its variant.' },
  { key: 'generic', header: 'Generic name', need: 'optional', aliases: ['generic', 'composition', 'salt'], hint: 'Looked up: the active ingredient(s), joined with " + ".' },
  { key: 'strength', header: 'Strength', need: 'optional', aliases: ['strength / composition', 'dose'], hint: 'Looked up: the amount of each ingredient, per volume for liquids (250 mg/5 ml).' },
  { key: 'form', header: 'Form', need: 'optional', aliases: ['dosage form', 'type'], hint: 'Looked up: Tablet, Syrup, Injection…' },
  { key: 'lookup_source', header: 'Lookup source', need: 'optional', aliases: ['source', 'sources', 'website'], hint: 'Which website the lookup came from.' },
  { key: 'lookup_confidence', header: 'Lookup confidence', need: 'optional', aliases: ['confidence'], hint: 'High, Medium or Low.' },
  { key: 'pack', header: 'Pack as printed', need: 'optional', aliases: ['pack', 'packing', 'unit', 'pack size', 'uom'], hint: 'For example 1x10, 100 ml, 15’s.' },
  { key: 'manufacturer', header: 'Manufacturer', need: 'optional', aliases: ['mfr', 'mfg', 'company', 'make', 'manufacturer name'], hint: 'The “Mfr” column.' },
  { key: 'hsn', header: 'HSN', need: 'optional', aliases: ['hsn code', 'hsn/sac'], hint: 'The HSN code, if printed.' },
  { key: 'batch', header: 'Batch', need: 'save', aliases: ['batch no', 'batch no.', 'batch number', 'b.no', 'b no'], hint: 'The batch number exactly as printed.' },
  { key: 'expiry_printed', header: 'Expiry as printed', need: 'optional', aliases: ['exp', 'exp dt', 'exp.', 'expiry', 'expiry date', 'exp date'], hint: 'The expiry exactly as printed (03-2026, 10/25, Mar-26).' },
  { key: 'expiry_mmyyyy', header: 'Expiry (MM/YYYY)', need: 'save', aliases: ['expiry mm/yyyy', 'expiry (mm/yy)', 'expiry mm/yy', 'expiry month', 'expiry normalised', 'expiry normalized'], hint: 'The same month as MM/YYYY (03/2026).' },
  { key: 'qty', header: 'Qty', need: 'must', aliases: ['quantity', 'qty.', 'billed qty'], hint: 'The quantity billed.' },
  { key: 'free_qty', header: 'Free qty', need: 'optional', aliases: ['free', 'fr', 'scheme', 'free quantity', 'bonus'], hint: 'The free quantity (a scheme like 10+2 gives 2).' },
  { key: 'mrp', header: 'MRP', need: 'save', aliases: ['m.r.p.', 'm.r.p', 'mrp ₹', 'max retail price'], hint: 'The MRP printed on the bill, per unit.' },
  { key: 'rate', header: 'Rate', need: 'must', aliases: ['ptr', 'pts', 'list price', 'price', 'unit price', 'rate/unit', 'purchase rate', 'p.rate'], hint: 'The dealer’s rate for ONE unit, before discount and GST.' },
  { key: 'disc_pct', header: 'Disc %', need: 'optional', aliases: ['dis %', 'dis%', 'disc', 'discount %', 'discount', 'dis', 'disc%'], hint: 'The line discount percent.' },
  { key: 'gst_pct', header: 'GST %', need: 'save', aliases: ['gst', 'tax %', 'tax', 'gst%', 'gst rate'], hint: 'The TOTAL GST rate of the line (CGST% + SGST%, or IGST%).' },
  { key: 'line_amount', header: 'Line amount as printed', need: 'optional', aliases: ['amount', 'total', 'total amount', 'line total', 'value', 'net amount'], hint: 'The amount printed against the line.' },
  { key: 'flags', header: 'Flags', need: 'optional', aliases: ['flag', 'notes', 'remarks', 'doubts'], hint: 'What ChatGPT was unsure of or could not read.' },
];

/** A header as typed, reduced to what can be compared: lower case, letters and digits only. */
export const headerKey = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const itemByHeader = new Map<string, ItemColumn>();
for (const c of ITEM_COLUMNS) { itemByHeader.set(headerKey(c.header), c); for (const a of c.aliases) if (!itemByHeader.has(headerKey(a))) itemByHeader.set(headerKey(a), c); }
const billByLabel = new Map<string, BillField>();
for (const f of BILL_FIELDS) { billByLabel.set(headerKey(f.label), f); for (const a of f.aliases) if (!billByLabel.has(headerKey(a))) billByLabel.set(headerKey(a), f); }
export const itemColumnFor = (header: unknown): ItemColumn | undefined => itemByHeader.get(headerKey(header));
export const billFieldFor = (label: unknown): BillField | undefined => billByLabel.get(headerKey(label));

export const SHEET_BILL = 'Bill';
export const SHEET_ITEMS = 'Items';
export const TEMPLATE_FILE_NAME = 'CureDesk-bill.xlsx';

/** Which medicine forms the Drug List knows (so a looked-up form can be matched to one). */
export const FORM_FAMILIES: Record<string, string> = {
  tablet: 'Tablet', tab: 'Tablet', tabs: 'Tablet', capsule: 'Capsule', cap: 'Capsule', caps: 'Capsule',
  syrup: 'Syrup', suspension: 'Suspension', susp: 'Suspension', syp: 'Syrup', solution: 'Solution', drops: 'Drops', drop: 'Drops',
  injection: 'Injection', inj: 'Injection', infusion: 'Injection', cream: 'Cream', ointment: 'Ointment', oint: 'Ointment', gel: 'Gel',
  inhaler: 'Inhaler', respules: 'Respules', sachet: 'Sachet', spray: 'Spray', powder: 'Powder', lotion: 'Solution', shampoo: 'Solution',
};

/** The prompt the pharmacist copies into ChatGPT together with the bill. Plain text; the screen shows it and has a Copy button. */
export function buildPrompt(): string {
  const billRows = BILL_FIELDS.map((f) => f.label).join('; ');
  const cols = ITEM_COLUMNS.map((c) => c.header).join(', ');
  return `You are reading a medicine purchase bill (invoice) from an Indian pharmacy wholesaler. It will be entered into CureDesk, a clinic pharmacy program. I have attached the bill (a photo, a PDF or an Excel file). Read EVERY page that I attached. Produce ONE Excel file (.xlsx) as described at the end.

THE MOST IMPORTANT RULES
1. Copy, never guess. Every value comes from what is printed on the bill, character for character. If a value is not printed, or you cannot read it with certainty, leave the cell EMPTY and write the reason in the "Flags" column (for example: expiry not printed; batch unreadable). Never fill a blank from memory, from another row, or from "what it usually is". If the bill uses ditto marks, copy the value from above and add the flag "ditto".
2. Do not correct, shorten, translate or "fix" anything that is printed: spelling, spacing, capital letters and abbreviations (PCM, TAB, SYP, CAP, INJ) stay exactly as on the bill.
3. Do not stop to ask me questions. If something is missing or doubtful, leave it empty, flag it, and finish the file. The pharmacist will fill the gaps in CureDesk.
4. One row per printed line, in the printed order. Do not merge lines, do not split lines, do not skip lines — not even free items, samples, or things that are not medicines (gloves, syringes, plastic bottles). If the same medicine and batch appear on several lines, keep every line separate.
5. Do not calculate bill totals yourself. Copy the totals as printed. If the printed totals disagree with the lines, copy them as printed and say so in the Notes row. Trust the lines over a footer that disagrees.

HOW TO READ ANY BILL LAYOUT (bills differ: columns can be in any order and have different names)
- The SELLER (supplier / wholesaler) is the company in the letterhead and in the "For ..." signature box. The BUYER is the clinic ("To", "Buyer's details", "Billing details"). Put the SELLER in "Supplier name".
- Labels and values can sit one row apart (Invoice / Number / Date / Due date). Use common sense: an invoice number looks like 12 or 0001/25-26 or INV-2025/044, a date looks like a date. If you are not sure, copy what is printed and flag it.
- Column names vary. "Product Details & Services", "Description", "Product Name", "Item Description" all mean Name as printed. "Exp", "Exp Dt", "Expiry" mean Expiry. "Fr", "Free", "Scheme" mean Free qty. "Rate", "PTR", "List Price" mean Rate (the price of ONE unit before discount and GST). "MRP" is MRP. "Dis %", "Disc" mean Disc %. "Pack", "Unit", "Packing" mean Pack as printed. "Mfr", "Mfg", "Company" mean Manufacturer.
- GST %: write the TOTAL GST rate of the line: CGST% + SGST% together (2.5 + 2.5 = 5; 6 + 6 = 12; 9 + 9 = 18) or the IGST%. If only one half is printed, copy it and add the flag "only half of GST printed".
- Qty is the quantity billed. Free qty is the free quantity. If the bill prints a scheme such as 10+2, put 10 in Qty, 2 in Free qty and add the flag "10+2".
- Expiry: copy it exactly as printed in "Expiry as printed" (03-2026, 10/25, Mar-26 ...) AND write the same month in "Expiry (MM/YYYY)" (03/2026). Never invent a day. If there is no expiry on the line, leave both cells empty and flag "expiry not printed".
- Batch: copy it exactly (letters, zeros, dashes, spaces). If the batch cell holds something that is not a batch number (for example "new batch" or "NA"), copy it and add the flag "not a real batch".
- Numbers: copy the digits exactly, with no rounding and no thousand separators. A quantity such as "1." is 1. If a number is cut off, blurred or doubtful, leave it empty and flag it.
- Money columns that look wrong (a discount sitting under the wrong heading, a total that does not match): copy what is printed in the column where it is printed and flag the line.
- If the bill has several pages, read all of them (totals are usually on the last page) and put them in ONE file. If a page seems to be missing, say so in Notes.

LOOKING UP THE MEDICINE (use web search for this part — please turn Search on)
A bill often prints only a brand name ("Calpol", "Ascoril LS"). For every line, search the internet and fill these four columns, which are SEPARATE from "Name as printed" (never change "Name as printed" because of what you find):
  Brand name  — the brand as sold, with its variant (for example "Calpol 250 Suspension").
  Generic name — the active ingredient(s), joined with " + ".
  Strength  — the amount of EACH ingredient and, for liquids, how much per what volume: "250 mg/5 ml", "200 mg + 28.5 mg/5 ml", "100 mg/ml", "500 mg + 125 mg".
  Form  — Tablet, Capsule, Syrup, Suspension, Drops, Injection, Cream, Ointment, Gel, Inhaler, Sachet, Solution ...
Rules for the lookup:
  - Use the other words on the line (TAB, CAP, SYP, DROPS, INJ, 60 ML, 15's, numbers) to pick the exact product. One brand can be sold as tablets, as syrups and as drops, and in several variants (Ascoril LS, Ascoril D ...). Different variants have DIFFERENT compositions — never mix them up.
  - If the line does not make the product clear, write AMBIGUOUS in "Flags", list the possible products there, and do not choose one.
  - If you cannot find it, write NOT FOUND in "Flags". Never guess a composition.
  - In "Lookup source" write the website(s) you used (for example 1mg, PharmEasy, the manufacturer's site). In "Lookup confidence" write High, Medium or Low.
  - Homeopathic and ayurvedic items, and things that are not medicines: if you cannot find a composition, leave Generic name, Strength and Form empty and write "not a standard medicine" in "Flags".

THE FILE
Create an Excel file named ${TEMPLATE_FILE_NAME} with exactly two sheets.
Sheet 1, named "${SHEET_BILL}": two columns, "Field" and "Value". One row for each of these fields, in this order: ${billRows}.
Sheet 2, named "${SHEET_ITEMS}": one header row with exactly these column names, in this order: ${cols}. Then one row per bill line.
Leave a cell empty when the bill does not show it. Do not add other columns, rows or sheets.

When the file is ready, give it to me as a download. In the chat, write only: how many lines the bill has, and the line numbers that have something in "Flags". Nothing else.`;
}

/** ISO date n days from `iso`. */
const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
/** MM-YYYY, n months from `iso`. */
const monthsAhead = (iso: string, n: number) => { const [y, m] = iso.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${String((t % 12) + 1).padStart(2, '0')}-${Math.floor(t / 12)}`; };

/**
 * The example bill on the downloadable sample — the shape of a real, messy wholesaler bill (from the owner's own sample invoices): a batch that is not a
 * batch ("new batch"), lines with no expiry, a discount per line, a homeopathic item, a bill that says Cap for a tablet. Dated relative to today so its
 * expiries are still in the future whenever it is opened.
 */
export function sampleBill(today: string): { bill: Record<string, string>; items: Record<string, string | number>[] } {
  const inv = addDays(today, -3);
  const [y, m, d] = inv.split('-');
  const e1 = monthsAhead(today, 30), e2 = monthsAhead(today, 20), e3 = monthsAhead(today, 40);
  const mmyyyy = (e: string) => e.replace('-', '/');
  return {
    bill: {
      'Supplier name': 'Manans Bio Medicals Pvt Ltd', 'Supplier GSTIN': '24AKPPP1343N1ZK', 'Supplier drug licence no': '20C VAD 94560, 20D VAD 93441',
      'Invoice number': '12', 'Invoice date': `${d}-${m}-${y}`, 'Payment terms': 'Credit', 'Printed sub total': '2481.40', 'Printed discount': '112.00',
      'Printed CGST': '93.48', 'Printed SGST': '93.48', 'Printed IGST': '', 'Printed round off': '', 'Printed freight / other charges': '',
      'Printed net amount': '2556.36', 'Pages seen': '1 of 1', 'Notes': 'Sample bill. The discount of 112.00 is given per line (Alprax 10%, Ciplox 100 2%).',
    },
    items: [
      { 'Line no': 1, 'Name as printed': 'Ciplox 500 Cap', 'Brand name': 'Ciplox 500', 'Generic name': 'Ciprofloxacin', 'Strength': '500 mg', 'Form': 'Tablet', 'Lookup source': '1mg', 'Lookup confidence': 'High', 'Pack as printed': '(1x10)', 'Manufacturer': 'Cipla', 'HSN': '1234', 'Batch': 'abc345', 'Expiry as printed': e1, 'Expiry (MM/YYYY)': mmyyyy(e1), 'Qty': 1, 'Free qty': 0, 'MRP': 100.25, 'Rate': 78.4, 'Disc %': 0, 'GST %': 12, 'Line amount as printed': 87.8, 'Flags': 'bill says Cap, Ciplox 500 is a tablet' },
      { 'Line no': 2, 'Name as printed': 'Alprax 10 Tab', 'Brand name': '', 'Generic name': '', 'Strength': '', 'Form': '', 'Lookup source': '', 'Lookup confidence': '', 'Pack as printed': '1 X 10', 'Manufacturer': 'Torr', 'HSN': '4567', 'Batch': 'new batch', 'Expiry as printed': e2, 'Expiry (MM/YYYY)': mmyyyy(e2), 'Qty': 10, 'Free qty': 0, 'MRP': 150, 'Rate': 100, 'Disc %': 10, 'GST %': 12, 'Line amount as printed': 1008, 'Flags': 'not a real batch; NOT FOUND' },
      { 'Line no': 3, 'Name as printed': 'Ciplox 100 Tab', 'Brand name': '', 'Generic name': 'Ciprofloxacin', 'Strength': '100 mg', 'Form': 'Tablet', 'Lookup source': 'pharmeasy', 'Lookup confidence': 'Medium', 'Pack as printed': '1 X 10', 'Manufacturer': 'Alem', 'HSN': '4567', 'Batch': 'ABC', 'Expiry as printed': e3, 'Expiry (MM/YYYY)': mmyyyy(e3), 'Qty': 5, 'Free qty': 2, 'MRP': 150, 'Rate': 120, 'Disc %': 2, 'GST %': 5, 'Line amount as printed': 617.4, 'Flags': '' },
      { 'Line no': 4, 'Name as printed': 'Fabiana imbricata 30c', 'Brand name': '', 'Generic name': '', 'Strength': '', 'Form': '', 'Lookup source': '', 'Lookup confidence': '', 'Pack as printed': '30ml', 'Manufacturer': 'HAP', 'HSN': '', 'Batch': 'd668', 'Expiry as printed': '', 'Expiry (MM/YYYY)': '', 'Qty': 1, 'Free qty': 0, 'MRP': 47, 'Rate': 47, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 49.36, 'Flags': 'expiry not printed; not a standard medicine' },
      { 'Line no': 5, 'Name as printed': 'Kali arsenicosum 200', 'Brand name': '', 'Generic name': '', 'Strength': '', 'Form': '', 'Lookup source': '', 'Lookup confidence': '', 'Pack as printed': '100 ml', 'Manufacturer': 'WS', 'HSN': '', 'Batch': 'd3534', 'Expiry as printed': '', 'Expiry (MM/YYYY)': '', 'Qty': 6, 'Free qty': 0, 'MRP': 126, 'Rate': 126, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 793.8, 'Flags': 'expiry not printed; not a standard medicine' },
    ],
  };
}
