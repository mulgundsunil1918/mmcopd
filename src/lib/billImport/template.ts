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
  { key: 'free_qty', header: 'Free qty', need: 'optional', aliases: ['free', 'fr', 'scheme', 'free quantity', 'bonus'], hint: 'The free quantity (a scheme like 10+2 gives 2); empty if the bill has no free column.' },
  { key: 'mrp', header: 'MRP', need: 'save', aliases: ['m.r.p.', 'm.r.p', 'mrp ₹', 'max retail price'], hint: 'The MRP printed on the bill, per unit.' },
  { key: 'rate', header: 'Rate', need: 'must', aliases: ['ptr', 'pts', 'list price', 'price', 'unit price', 'rate/unit', 'purchase rate', 'p.rate'], hint: 'The dealer’s rate for ONE unit, before discount and GST.' },
  { key: 'disc_pct', header: 'Disc %', need: 'optional', aliases: ['dis %', 'dis%', 'disc', 'discount %', 'discount', 'dis', 'disc%'], hint: 'The line discount percent — only if the bill has a discount column (empty if it has none).' },
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

/**
 * The prompt the pharmacist copies into ChatGPT together with the bill. Plain text; the screen shows it and has a Copy button.
 *
 * Written from the owner's own sample bills (four layouts of two wholesalers, see src/demo/sample-bills.ts) — every rule in it answers something those
 * bills really do: labels one row out of line, "new batch" in the batch box, one batch on three lines with different discounts, no discount / MRP / free
 * column, a Taxable Amt before the discount but a Total after it, CGST + SGST beside an IGST column, a footer discount that is only the sum of the lines,
 * a "Previous outstanding" amount, blank expiries, a lone number between two rows, a quantity "1.", a face mask among the medicines.
 */
export function buildPrompt(): string {
  const billRows = BILL_FIELDS.map((f) => f.label).join('; ');
  const cols = ITEM_COLUMNS.map((c) => c.header).join(', ');
  return `You are helping a clinic pharmacy enter a medicine purchase bill (an invoice from an Indian wholesaler or distributor) into CureDesk, its pharmacy program. I have attached the bill: a photo, a PDF or an Excel file, one page or several. Read EVERY page. Produce ONE Excel file (.xlsx), described at the end, and nothing else.

═══ ABOVE ALL: ONLY WHAT IS PRINTED — NO MISTAKES, NO ADDITIONS ═══
1. Copy, never guess. Every value comes from what is printed on the bill, character for character. If a value is not printed, or you cannot read it with certainty, leave the cell EMPTY and write the reason in the "Flags" column (for example "expiry not printed", "batch unreadable"). Never fill a blank from memory, from another row, or from "what it usually is". If the bill uses ditto marks, copy the value from the row above and add the flag "ditto".
2. Do not correct, shorten, translate or tidy anything that is printed: spelling, spacing, capital letters and abbreviations (PCM, TAB, CAP, SYP, INJ) stay exactly as on the bill. Names in Hindi, Gujarati or any other language are copied as printed.
3. Do no arithmetic to fill a cell. Do not work out a discount, a rate or a total yourself — CureDesk does the arithmetic and checks it against the bill. The one sum you do is the line's total GST % (CGST% + SGST%, see below).
4. Do not stop to ask me questions. If something is missing or doubtful, leave it empty, flag it, and finish the file. The pharmacist will fill the gaps in CureDesk.
5. One row per printed line, in the printed order. Do not merge, split or skip lines, and do not add a "Total" row — not even for free items, samples or things that are not medicines (gloves, syringes, plastic bottles, face masks). If the same medicine and batch appear on several lines (for example with different discounts or free units), keep every line separate.
6. If numbers on the bill disagree with each other, copy each one as printed and say so in the Notes row. Never choose between them, and never "fix" one to make them agree. Trust the lines over a footer that disagrees.
7. The file is for ONE invoice. If my attachment holds more than one invoice, do the first one and tell me in the chat that there is another.

═══ WHO IS WHO ═══
- The SELLER (supplier) is the company that issued the bill: its name is in the letterhead and in the "For ..." signature box. Put it in "Supplier name". Its GSTIN and its drug licence number (printed as "DL No.", "D.L. No.", "DI No.", "Drug Licence", "Lic. No.") go in "Supplier GSTIN" and "Supplier drug licence no" — but ONLY if they belong to the seller.
- The BUYER is the clinic: "To", "Bill to", "Buyer's detail", "Billing details", "Customer". Its name, GSTIN and licence numbers are NOT wanted. If a licence number appears only under the buyer, leave "Supplier drug licence no" empty and mention it in Notes.
- Labels and values can sit one row out of line (Invoice / Number / Date / Due date ...). Use common sense about what is what: an invoice number looks like 12 or 0001/25-26 or INV-2025/044; the invoice date is the date the bill was written, not the "Due date". If you are not sure, copy what is printed and flag it.

═══ THE "Bill" SHEET (the footer and the header) ═══
- Printed sub total: the amount before tax if the bill prints it ("Sub Total", "Taxable value", "Amt Before Tax", "Total before tax"), as printed.
- Printed discount: the bill's total discount, as a positive number, copied even when it is only the sum of the per-line discounts (that is usual).
- Printed CGST / Printed SGST / Printed IGST: the footer's totals — not the table of tax by rate.
- Printed round off: with its sign (-0.30). Printed freight / other charges: freight, packing, courier, anything added.
- Printed net amount: the FINAL amount payable ("Net Amount", "Grand Total", "Total Amount"). Not "Previous outstanding" or "Balance b/f" (those are not part of this bill — mention them in Notes), and not the amount in words.
- Pages seen: for example "1 of 1". Notes: anything odd about the bill — totals that disagree, labels out of place, a quantity total that is more than the lines add up to.
- Invoice date: day first, exactly as printed (28-04-2024, 05-Aug-25). Payment terms: Cash or Credit, only if printed.

═══ THE "Items" SHEET: ONE COLUMN AT A TIME ═══
Bills differ: columns can be in any order and have different names. Match them by MEANING.
- Line no — "Sr", "Sr. No", "S.No.".
- Name as printed — "Product", "Product Details & Services", "Product Name", "Description", "Item Description", "Particulars": the medicine exactly as printed, letter for letter.
- Pack as printed — "Pack", "Unit", "Packing", "UOM": 1x10, (1x10), 100 ml, 15's, 1 GROSS.  Manufacturer — "Mfr", "Mfg", "Company".  HSN — "HSN", "HSN Code", "HSN/SAC" (empty if not printed).
- Batch — "Batch", "Batch No.", "B.No.", exactly (letters, zeros, dashes, spaces). If the batch cell holds something that is not a batch number ("new batch", "NA"), copy it and add the flag "not a real batch".
- Expiry as printed — "Exp", "Exp Dt", "Expiry", exactly as printed (03-2026, 10/25, Mar-26). Expiry (MM/YYYY) — the same month written as MM/YYYY (03/2026). Never invent a day, a month or a year. If no expiry is printed on the line, leave BOTH cells empty and flag "expiry not printed" (homeopathic and some other lines often have none).
- Qty — the quantity BILLED (a quantity such as "1." is 1).  Free qty — "Fr", "Free", "Scheme", "Bonus". If the bill prints a scheme such as 10+2, put 10 in Qty, 2 in Free qty and flag "10+2". If the bill has no free column, leave Free qty EMPTY (do not write 0).
- MRP — "MRP", "M.R.P." per unit, as printed. If the bill has no MRP column, leave it EMPTY — never use the Rate instead.
- Rate — "Rate", "PTR", "PTS", "List Price", "Price": the price of ONE unit BEFORE discount and GST. It is NOT "Taxable Amt", NOT "Amount" or "Total", and NOT the MRP. (Check: Qty × Rate = the "Gross Value" or "Taxable Amt" before any discount.)
- Disc % — "Dis %", "Disc", "Discount %": copy the line's discount percent ONLY if the bill has a per-line discount column (write 0 when it prints 0). If the bill has NO discount column, leave Disc % EMPTY: do not write 0 and do not work it out — CureDesk works it out from the line amount.
- GST % — the TOTAL GST rate of the line: CGST% + SGST% added together (2.5 + 2.5 = 5, 6 + 6 = 12, 9 + 9 = 18), or the IGST %, or the "GST %" column as printed. When CGST, SGST and IGST columns sit side by side (for example CGST 6.00, SGST 6.00, IGST 12.00), the line's rate is still ONE rate (12) — do not add all three. If only one half is printed, copy it and flag "only half of GST printed".
- Line amount as printed — the amount printed against the line ("Amount", "Total", "Total Amount", "Net"), copied exactly, even if it looks wrong. A "Taxable Amt" column is NOT this.
- Flags — everything you were unsure of, in a few plain words, separated by semicolons.

═══ ODD THINGS THAT REAL BILLS DO — COPY, FLAG, NEVER FIX ═══
- A number sits under the wrong heading or between two rows: copy it where it is printed and flag that line.
- A line's printed amount does not match its quantity, rate, discount and GST: copy what is printed and flag "amount differs".
- The footer text (for example "Total Sale = 215.00") disagrees with the lines: copy the lines, write the disagreement in Notes.
- The bill's total quantity may count the free units as well as the billed ones: just copy it into Notes if it differs from the lines.
- Blurred, cut off or doubtful digits: leave the cell empty and flag it; never guess a digit.

═══ LOOKING UP THE MEDICINE (use web search for this part — please turn Search on) ═══
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
  - Homeopathic and ayurvedic items: if you cannot find a composition, leave Generic name, Strength and Form empty and write "not a standard medicine" in "Flags". Things that are not medicines at all (a face mask, a plastic bottle): leave the lookup columns empty and write "not a medicine" in "Flags".

═══ THE FILE ═══
Build it with your Python tool (openpyxl) and name it ${TEMPLATE_FILE_NAME}. It has exactly two sheets.
Sheet 1, named "${SHEET_BILL}": two columns, "Field" and "Value". One row for each of these fields, in this order: ${billRows}.
Sheet 2, named "${SHEET_ITEMS}": one header row with exactly these column names, in this order: ${cols}. Then one row per bill line.
- Write these as TEXT so Excel never turns them into dates or drops their zeros: every value on the Bill sheet, and on the Items sheet Line no, Name as printed, Pack as printed, Manufacturer, HSN, Batch, Expiry as printed and Expiry (MM/YYYY).
- Write these as NUMBERS (digits and a decimal point only, no ₹, no commas, no % sign): Qty, Free qty, MRP, Rate, Disc %, GST %, Line amount as printed.
- Leave a cell empty when the bill does not show it. Do not add other columns, rows or sheets.

Example of the style (an imaginary line, not part of your answer). Printed: "3 | Calpol 500 Tab | 3004 | A12345 | 05/27 | 10+2 | MRP 22.00 | Rate 17.62 | Disc 8 | CGST 2.5 | SGST 2.5 | Amount 170.21". The row: Line no 3; Name as printed "Calpol 500 Tab"; HSN "3004"; Batch "A12345"; Expiry as printed "05/27"; Expiry (MM/YYYY) "05/2027"; Qty 10; Free qty 2; MRP 22; Rate 17.62; Disc % 8; GST % 5; Line amount as printed 170.21; Flags "10+2".

═══ BEFORE YOU HAND IT OVER — CHECK YOUR OWN WORK ═══
1. Count the lines printed on the bill and the rows in "Items": they must be the same number.
2. Look at the picture again for every row and compare the cells that go wrong most often: Batch, Expiry, Qty, Rate, GST %.
3. Make sure nothing is in the file that is not on the bill (except the four lookup columns).
4. Make sure every empty cell that you would have expected to be filled has its reason in "Flags".

When the file is ready, give it to me as a download. In the chat, write only: how many lines the bill has, and the line numbers that have something in "Flags" (and say if a page was unreadable or missing). Nothing else. If you cannot create an Excel file, say so in one sentence — do not give me a table instead.`;
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
