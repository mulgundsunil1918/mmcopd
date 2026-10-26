/**
 * The owner's four sample supplier bills (images he pasted on 2026-10-25 and again on 2026-10-26), written down the way a CAREFUL ChatGPT run with
 * the CureDesk prompt returns them: every value copied as printed, a blank where the bill prints nothing, the odd things in "Flags" and "Notes".
 * They are the test of the whole import (tests/e2e/bill-import-samples.test.ts), the proof of what the prompt must make ChatGPT do, and — with their
 * dates moved to today (sampleBillWorkbook) — the "try it with a sample bill" choices on the website demo.
 *
 * The four bills (all "Sample Invoice Template" bills of Indian wholesalers):
 *   manans-tax    Manans Bio Medicals "TAX INVOICE": no MRP / discount / free columns; a bill-level "Discount −112.00"; Taxable Amt before discount but CGST,
 *                 SGST and Total after it; "Unit" column; CGST+SGST beside an IGST column; "new batch"; homeopathic lines with no expiry or HSN.
 *   manans-whole  the SAME invoice 12 in the "Wholesale 2" layout: MRP, Mfr, Fr(ee), Gross, Discount % and amount per line.
 *   jeqline       Jeqline Pharmacy "Wholesale 1": Pack, Mfr, Free, MRP, Rate (= MRP / 1.05), Dis %, GST %, Amount (with GST); one batch on three lines with
 *                 different discounts and free units; blank expiries; "1/2 dram plastic" (not a medicine); footer Discount already inside Sub Total; round off.
 *   meerut        "My Company", Meerut: shifted labels (Invoice / Number / Invoice Date / Due date …), quantities "1.", a lone "5" under Disc between two rows,
 *                 a line whose amount does not match its tax %, a face mask, a footer ("Total Sale = 215.00") that disagrees with the lines (231.00).
 */

export interface SampleBill {
  key: string;
  title: string;
  bill: Record<string, string | number>;
  items: Record<string, string | number>[];
  /** What the bill itself prints as its payable amount. */
  printedNet: number;
  /** The date the bill was written (the review checks run "as of" a little after it). */
  asOf: string;
}

const E = ''; // nothing printed
const item = (o: Record<string, string | number>) => ({
  'Line no': '', 'Name as printed': '', 'Brand name': E, 'Generic name': E, 'Strength': E, 'Form': E, 'Lookup source': E, 'Lookup confidence': E,
  'Pack as printed': E, 'Manufacturer': E, 'HSN': E, 'Batch': E, 'Expiry as printed': E, 'Expiry (MM/YYYY)': E, 'Qty': '', 'Free qty': E, 'MRP': E, 'Rate': '',
  'Disc %': E, 'GST %': E, 'Line amount as printed': E, 'Flags': E, ...o,
});
const NSM = 'not a standard medicine';

export const MANANS_TAX: SampleBill = {
  key: 'manans-tax', title: 'Manans Bio Medicals — TAX INVOICE (no discount / MRP columns)', printedNet: 2556.36, asOf: '2024-05-02',
  bill: {
    'Supplier name': 'Manans Bio Medicals Pvt Ltd.', 'Supplier GSTIN': '24AKPPP1343N1ZK', 'Supplier drug licence no': E,
    'Invoice number': '12', 'Invoice date': '28-04-2024', 'Payment terms': 'Credit',
    'Printed sub total': '2369.40', 'Printed discount': '112.00', 'Printed CGST': '93.48', 'Printed SGST': '93.48', 'Printed IGST': E, 'Printed round off': E,
    'Printed freight / other charges': E, 'Printed net amount': '2556.36', 'Pages seen': '1 of 1',
    'Notes': 'No discount column: the bill prints a total discount of 112.00 only. The Taxable Amt column is before that discount but the CGST / SGST amounts and Total Amount are after it (Alprax 10 Tab: taxable 1000, CGST 54.00 = 6% of 900, total 1008). Sub Total shows quantity 25 but the line quantities add to 23. Previous Outstanding Amount 3,368.36 is not part of this bill. The only drug licence printed (DLdb3245, DL795 20.GBB) is the buyer\'s.',
  },
  items: [
    item({ 'Line no': 1, 'Name as printed': 'Ciplox 500 Cap', 'Brand name': 'Ciplox 500', 'Generic name': 'Ciprofloxacin', 'Strength': '500 mg', 'Form': 'Tablet', 'Lookup source': '1mg', 'Lookup confidence': 'High',
      'Pack as printed': '(1x10)', 'HSN': '1234', 'Batch': 'abc345', 'Expiry as printed': '03-2026', 'Expiry (MM/YYYY)': '03/2026', 'Qty': 1, 'Rate': 78.4, 'GST %': 12, 'Line amount as printed': 87.8, 'Flags': 'bill says Cap, Ciplox 500 is a tablet; no MRP column' }),
    item({ 'Line no': 2, 'Name as printed': 'Alprax 10 Tab', 'Pack as printed': '1 X 10', 'HSN': '4567', 'Batch': 'new batch', 'Expiry as printed': '10-2025', 'Expiry (MM/YYYY)': '10/2025',
      'Qty': 10, 'Rate': 100, 'GST %': 12, 'Line amount as printed': 1008, 'Flags': 'not a real batch; NOT FOUND; no MRP column; no discount column but total 1008 is less than 1000 + 12%' }),
    item({ 'Line no': 3, 'Name as printed': 'Ciplox 100 Tab', 'Generic name': 'Ciprofloxacin', 'Strength': '100 mg', 'Form': 'Tablet', 'Lookup source': 'pharmeasy', 'Lookup confidence': 'Medium', 'Pack as printed': '1 X 10', 'HSN': '4567',
      'Batch': 'ABC', 'Expiry as printed': '10-2026', 'Expiry (MM/YYYY)': '10/2026', 'Qty': 5, 'Rate': 120, 'GST %': 5, 'Line amount as printed': 617.4, 'Flags': 'no MRP column' }),
    item({ 'Line no': 4, 'Name as printed': 'Fabiana imbricata 30c', 'Pack as printed': '30ml', 'Batch': 'd668', 'Qty': 1, 'Rate': 47, 'GST %': 5, 'Line amount as printed': 49.36, 'Flags': `expiry not printed; ${NSM}; HSN not printed; no MRP column` }),
    item({ 'Line no': 5, 'Name as printed': 'Kali arsenicosum 200', 'Pack as printed': '100 ml', 'Batch': 'd3534', 'Qty': 6, 'Rate': 126, 'GST %': 5, 'Line amount as printed': 793.8, 'Flags': `expiry not printed; ${NSM}; HSN not printed; no MRP column` }),
  ],
};

export const MANANS_WHOLE: SampleBill = {
  key: 'manans-whole', title: 'Manans Bio Medicals — invoice 12, Wholesale 2 layout (discount %, free, MRP, Mfr)', printedNet: 2556.36, asOf: '2024-05-02',
  bill: {
    'Supplier name': 'Manans Bio Medicals Pvt Ltd.', 'Supplier GSTIN': '24AKPPP1343N1ZK', 'Supplier drug licence no': '20C VAD 94560, 20D VAD 93441',
    'Invoice number': '12', 'Invoice date': '28-04-2024', 'Payment terms': E,
    'Printed sub total': '2369.40', 'Printed discount': '112.00', 'Printed CGST': '93.48', 'Printed SGST': '93.48', 'Printed IGST': E, 'Printed round off': E,
    'Printed freight / other charges': E, 'Printed net amount': '2556.36', 'Pages seen': E,
    'Notes': 'The Sub Totals row shows Gross Value 2481.40, Discount -112.00, Taxable 2369.40; the discount is the total of the per-line discounts and is already inside each line. The licence shown (DI No. 20C VAD 94560, 20D VAD 93441 Dated 20 Mar 2000) is the seller\'s. The "To:" party\'s licence (DLdb3245, DL795 20.GBB) is the buyer\'s.',
  },
  items: [
    item({ 'Line no': 1, 'Name as printed': 'Ciplox 500 Cap', 'Brand name': 'Ciplox 500', 'Generic name': 'Ciprofloxacin', 'Strength': '500 mg', 'Form': 'Tablet', 'Lookup source': '1mg', 'Lookup confidence': 'High', 'Manufacturer': 'Cipla', 'HSN': '1234',
      'Batch': 'abc345', 'Expiry as printed': '03-2026', 'Expiry (MM/YYYY)': '03/2026', 'Qty': 1, 'Free qty': 0, 'MRP': 100.25, 'Rate': 78.4, 'Disc %': 0, 'GST %': 12, 'Line amount as printed': 87.8, 'Flags': 'bill says Cap, Ciplox 500 is a tablet' }),
    item({ 'Line no': 2, 'Name as printed': 'Alprax 10 Tab', 'Manufacturer': 'Torr', 'HSN': '4567', 'Batch': 'new batch', 'Expiry as printed': '10-2025', 'Expiry (MM/YYYY)': '10/2025',
      'Qty': 10, 'Free qty': 0, 'MRP': 150, 'Rate': 100, 'Disc %': 10, 'GST %': 12, 'Line amount as printed': 1008, 'Flags': 'not a real batch; NOT FOUND' }),
    item({ 'Line no': 3, 'Name as printed': 'Ciplox 100 Tab', 'Generic name': 'Ciprofloxacin', 'Strength': '100 mg', 'Form': 'Tablet', 'Lookup source': 'pharmeasy', 'Lookup confidence': 'Medium', 'Manufacturer': 'Alem', 'HSN': '4567', 'Batch': 'ABC',
      'Expiry as printed': '10-2026', 'Expiry (MM/YYYY)': '10/2026', 'Qty': 5, 'Free qty': 2, 'MRP': 150, 'Rate': 120, 'Disc %': 2, 'GST %': 5, 'Line amount as printed': 617.4 }),
    item({ 'Line no': 4, 'Name as printed': 'Fabiana imbricata 30c', 'Manufacturer': 'HAP', 'Batch': 'd668', 'Qty': 1, 'Free qty': 0, 'MRP': 47, 'Rate': 47, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 49.36, 'Flags': `expiry not printed; ${NSM}; HSN not printed` }),
    item({ 'Line no': 5, 'Name as printed': 'Kali arsenicosum 200', 'Manufacturer': 'WS', 'Batch': 'd3534', 'Qty': 6, 'Free qty': 0, 'MRP': 126, 'Rate': 126, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 793.8, 'Flags': `expiry not printed; ${NSM}; HSN not printed` }),
  ],
};

export const JEQLINE: SampleBill = {
  key: 'jeqline', title: 'Jeqline Pharmacy — Wholesale 1 (one batch on three lines, blank expiries, round off)', printedNet: 18912.0, asOf: '2021-06-27',
  bill: {
    'Supplier name': 'Jeqline Pharmacy', 'Supplier GSTIN': '24AKPPP1343N1ZR', 'Supplier drug licence no': '20C VAD 94560, 20D VAD 93441',
    'Invoice number': '30', 'Invoice date': '25-06-2021', 'Payment terms': E,
    'Printed sub total': '17951.70', 'Printed discount': '990.84', 'Printed CGST': '480.30', 'Printed SGST': '480.30', 'Printed IGST': E, 'Printed round off': '-0.30',
    'Printed freight / other charges': E, 'Printed net amount': '18912.00', 'Pages seen': 'Page 1 of 1',
    'Notes': 'The printed Discount (-990.84) is the total of the per-line discounts and is already inside Sub Total (Sub Total 17951.70 + CGST 480.30 + SGST 480.30 − 0.30 round off = 18912.00). Total Qty 128 includes the free units. Ref. No. ABC456. The seller\'s licence is the DI No. at the top; "DL No. dl123, dl456" under Buyer\'s Detail is the buyer\'s.',
  },
  items: [
    item({ 'Line no': 1, 'Name as printed': 'Belladonna 30', 'Pack as printed': '100 ml', 'Manufacturer': 'WS', 'HSN': '12345678', 'Batch': '025488', 'Qty': 10, 'Free qty': 2, 'MRP': 165, 'Rate': 157.14, 'Disc %': 10, 'GST %': 5, 'Line amount as printed': 1484.98, 'Flags': `expiry not printed; ${NSM}` }),
    item({ 'Line no': 2, 'Name as printed': 'Belladonna 30', 'Pack as printed': '100 ml', 'Manufacturer': 'WS', 'HSN': '12345678', 'Batch': '025488', 'Qty': 1, 'Free qty': 0, 'MRP': 165, 'Rate': 157.14, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 165, 'Flags': `expiry not printed; ${NSM}` }),
    item({ 'Line no': 3, 'Name as printed': 'Belladonna 30', 'Pack as printed': '100 ml', 'Manufacturer': 'WS', 'HSN': '12345678', 'Batch': '025488', 'Qty': 100, 'Free qty': 3, 'MRP': 165, 'Rate': 157.14, 'Disc %': 5, 'GST %': 5, 'Line amount as printed': 15674.72, 'Flags': `expiry not printed; ${NSM}` }),
    item({ 'Line no': 4, 'Name as printed': 'Belladonna 30', 'Pack as printed': '100 ml', 'Manufacturer': 'WS', 'HSN': '12345678', 'Batch': 'd2032', 'Expiry as printed': '10-2025', 'Expiry (MM/YYYY)': '10/2025', 'Qty': 5, 'Free qty': 2, 'MRP': 120, 'Rate': 120, 'Disc %': 8, 'GST %': 5, 'Line amount as printed': 579.6, 'Flags': NSM }),
    item({ 'Line no': 5, 'Name as printed': '1/2 dram plastic', 'Pack as printed': '1 GROSS', 'Manufacturer': 'ZDef', 'Batch': 'd3706', 'Qty': 5, 'Free qty': 0, 'MRP': 180, 'Rate': 180, 'Disc %': 0, 'GST %': 12, 'Line amount as printed': 1008, 'Flags': `expiry not printed; HSN not printed; not a medicine (packing)` }),
  ],
};

export const MEERUT: SampleBill = {
  key: 'meerut', title: '"My Company", Meerut — shifted labels, a line that does not add up, a face mask', printedNet: 231, asOf: '2025-08-07',
  bill: {
    'Supplier name': 'My Company', 'Supplier GSTIN': '09AAACH7409R1ZZ', 'Supplier drug licence no': E,
    'Invoice number': '0001/25-26', 'Invoice date': '05-Aug-25', 'Payment terms': 'Cash',
    'Printed sub total': E, 'Printed discount': E, 'Printed CGST': E, 'Printed SGST': E, 'Printed IGST': E, 'Printed round off': E, 'Printed freight / other charges': E,
    'Printed net amount': '231.00', 'Pages seen': 'Page 1 of 1',
    'Notes': 'The header labels (Invoice / Number / Invoice Date / Due date / Place of Supply / Reverse Charge) are one place off from their values; 0001/25-26 is the invoice number and 05-Aug-25 the date. The footer text (Sale @5% = 11540.00 … Total Sale = 215.00, Tax = 942.40) does not match the lines; the lines add up to the printed Total 231.00. A lone "5" sits in the Disc column between lines 2 and 3.',
  },
  items: [
    item({ 'Line no': 1, 'Name as printed': 'Paracetamol 500mg', 'Generic name': 'Paracetamol', 'Strength': '500 mg', 'Form': 'Tablet', 'Lookup source': '1mg', 'Lookup confidence': 'Medium', 'HSN': '3004', 'Batch': 'B1234', 'Expiry as printed': '12/26', 'Expiry (MM/YYYY)': '12/2026',
      'Qty': 2, 'Rate': 20, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 42, 'Flags': 'form not printed (tablet assumed from the lookup); no MRP column' }),
    item({ 'Line no': 2, 'Name as printed': 'Cough Syrup 100ml', 'Lookup source': E, 'Lookup confidence': E, 'HSN': '3004', 'Batch': 'C5678', 'Expiry as printed': '10/25', 'Expiry (MM/YYYY)': '10/2025', 'Qty': 1, 'Rate': 80, 'Disc %': 5, 'GST %': 12,
      'Line amount as printed': 84, 'Flags': 'AMBIGUOUS (no brand named); Qty printed as "1."; the 5 sits between the rows; amount 84.00 is 80 + 5%, not 12% GST' }),
    item({ 'Line no': 3, 'Name as printed': 'Face Mask (pack of 10)', 'HSN': '6307', 'Batch': 'M9087', 'Expiry as printed': '11/27', 'Expiry (MM/YYYY)': '11/2027', 'Qty': 1, 'Rate': 100, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 105, 'Flags': 'not a medicine; Qty printed as "1."' }),
  ],
};

export const SAMPLE_BILLS: SampleBill[] = [MANANS_TAX, MANANS_WHOLE, JEQLINE, MEERUT];

// ----------------------------------------------------------------------------------------------------------------------------------------------
// For the website demo: the same bills, dated around TODAY so their expiries are still in the future and the date looks recent.
// ----------------------------------------------------------------------------------------------------------------------------------------------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const addDaysISO = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/** The printed invoice date, moved to `iso` but written in the style the bill used (28-04-2024, 05-Aug-25). */
const dateLike = (original: string, iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(original) ? `${p2(d)}-${MON[m - 1]}-${String(y).slice(2)}` : `${p2(d)}-${p2(m)}-${y}`;
};
/** An expiry as printed (03-2026, 10/25, 12/26) moved so it stays in the future, keeping the month and the way it is written. */
const expiryLike = (printed: string, asOfYear: number, thisYear: number): { printed: string; mmyyyy: string } | null => {
  const m = String(printed).match(/^(\d{1,2})\s*([-/])\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  const ny = thisYear + Math.max(1, year - asOfYear + 1);
  return { printed: `${m[1].padStart(2, '0')}${m[2]}${m[3].length === 2 ? String(ny).slice(2) : String(ny)}`, mmyyyy: `${m[1].padStart(2, '0')}/${ny}` };
};

/** A sample bill with its dates moved to today (invoice 3 days ago; every printed expiry in the future). */
export function sampleBillFor(b: SampleBill, today: string): SampleBill {
  const asOfYear = Number(b.asOf.slice(0, 4)), thisYear = Number(today.slice(0, 4));
  return {
    ...b,
    bill: { ...b.bill, 'Invoice date': dateLike(String(b.bill['Invoice date']), addDaysISO(today, -3)) },
    items: b.items.map((it) => {
      const e = String(it['Expiry as printed'] ?? '') ? expiryLike(String(it['Expiry as printed']), asOfYear, thisYear) : null;
      return e ? { ...it, 'Expiry as printed': e.printed, 'Expiry (MM/YYYY)': e.mmyyyy } : it;
    }),
  };
}
