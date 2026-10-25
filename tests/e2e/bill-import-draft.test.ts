// Bill import — from the Excel to a checked draft. Built from the owner's own sample wholesaler bills (the messy ones):
//   · the file is read whatever the header spelling, extra columns, extra sheets or stray "Total" rows; a missing must-have refuses it with a plain list;
//   · every mishap is caught: "new batch" as a batch, no expiry, a half GST rate, an expired batch, an unconfirmed spelling-slip match, a line amount
//     that does not match its maths, a bill total that does not add up (until a person accepts it), a duplicate invoice, a future date;
//   · the discount is split correctly (line discounts vs a discount on the whole bill) so the bill adds up exactly;
//   · when everything is fixed the bill is ready — and not before.
import * as XLSX from 'xlsx';
import { PHARMACY_CATALOG } from '../../src/data/pharmacy-catalog';
import {
  buildDraft, buildPrompt, buildTemplateWorkbook, checkDraft, ITEM_COLUMNS, BILL_FIELDS, lineComputed, packUnits, parseBillDate, parseExpiry, parseNumber,
  readBillRows, readWorkbook, type DraftLine, type Draft, type SupplierRef,
} from '../../src/lib/billImport';
import { ok, eq, near, section, finish } from './lib';

const drugs = PHARMACY_CATALOG.map((d, i) => ({ id: i + 1, name: d.name, generic_name: d.generic_name, form: d.form, strength: d.strength }));
const TODAY = '2026-10-25';
const suppliers: SupplierRef[] = [{ id: 1, name: 'Sun Pharma Hubli', gstin: '29SUNPH7890Q1Z2', drug_license_no: 'KA-HBL-20B/2024-007' }, { id: 2, name: 'Manans Bio Medicals Pvt. Ltd.', gstin: null, drug_license_no: 'X' }];
const ctx = { drugs, aliases: [], suppliers, today: TODAY };
const check = (d: Draft, existing: ((id: number | null, no: string) => { id: number; date: string } | null) | undefined = undefined) => checkDraft(d, { today: TODAY, existingInvoice: existing });
const codes = (r: ReturnType<typeof check>, line?: number) => r.problems.filter((p) => (line === undefined ? true : p.line === line)).map((p) => `${p.severity}:${p.code}`);
const draftFromFile = (bytes: Uint8Array) => { const w = readWorkbook(XLSX, bytes); const r = readBillRows(w.billRows, w.itemRows); return { r, draft: r.problems.length ? null : buildDraft(r, ctx) }; };

// ============================================================================================================
section('1 · the prompt and the template');
const prompt = buildPrompt();
ok(prompt.length > 3000, `the prompt is complete (${prompt.length} characters)`);
for (const c of ITEM_COLUMNS) ok(prompt.includes(c.header), `the prompt names the column "${c.header}"`);
for (const f of BILL_FIELDS) ok(prompt.includes(f.label), `the prompt names the field "${f.label}"`);
ok(/web search|Search on/i.test(prompt) && /Never guess a composition/.test(prompt) && /AMBIGUOUS/.test(prompt) && /NOT FOUND/.test(prompt), 'the prompt tells ChatGPT to search, never to guess a composition, and to flag AMBIGUOUS / NOT FOUND');
ok(/Do not stop to ask me questions/.test(prompt) && /one row per printed line/i.test(prompt), '…to leave blanks and flag them rather than stop, and to keep one row per printed line');
ok(/Trust the lines over a footer/.test(prompt) && /CGST% \+ SGST%/.test(prompt), '…to trust the lines over a footer that disagrees, and to give the TOTAL GST');
const empty = draftFromFile(buildTemplateWorkbook(XLSX, false));
ok(empty.r.problems.length >= 4, `an empty template is refused with a list (${empty.r.problems.length} reasons: ${empty.r.problems.slice(0, 2).join(' | ')} …)`);
const sample = draftFromFile(buildTemplateWorkbook(XLSX, true, TODAY));
ok(sample.r.problems.length === 0 && sample.draft!.lines.length === 5, 'the sample bill is accepted: 5 lines');

// ============================================================================================================
section('2 · the sample bill (the owner\'s "Manans Bio Medicals" invoice): every mishap is caught');
const d1 = sample.draft!;
const b = d1.bill;
eq(b.supplier_name, 'Manans Bio Medicals Pvt Ltd', 'the supplier is the seller, not the clinic');
eq(b.wholesaler_id, 2, '…and is recognised in the Wholesalers list although the list spells it "Pvt. Ltd."');
eq(b.invoice_number, '12', 'invoice number');
eq(b.invoice_date, '2026-10-22', 'invoice date read day-first (22-10-2026, three days before today)');
near(b.printed.net as number, 2556.36, 'printed net amount');
near(b.discount, 0, 'the printed discount ₹112 is the lines\' own discounts (Alprax 10%, Ciplox 100 2%), so no extra invoice discount is added');
const L = (n: number): DraftLine => d1.lines[n - 1];
eq(L(1).match.kind, 'close', 'line 1 "Ciplox 500 Cap" → close to "Ciplox 500" (the bill says Cap, the list says Tablet)');
ok(L(1).drug_id !== null && !L(1).confirmed, '…pre-selected but not confirmed');
eq(L(2).match.kind, 'none', 'line 2 "Alprax 10 Tab" is not in the list');
ok(L(3).drug_id === null, 'line 3 "Ciplox 100 Tab": no Ciplox 100 in the list — not read as Ciplox 500');
eq(L(4).expiry, '', 'line 4 has no expiry');
const r1 = check(d1);
ok(!r1.ready, 'the bill is NOT ready');
ok(codes(r1, 1).includes('error:confirm_match'), 'line 1: confirm the match');
ok(codes(r1, 2).includes('error:placeholder_batch') && codes(r1, 2).includes('error:no_drug'), 'line 2: "new batch" is not a batch, and choose / add the medicine');
ok(codes(r1, 4).includes('error:no_expiry') && codes(r1, 5).includes('error:no_expiry'), 'lines 4 and 5: expiry missing');
ok(codes(r1, 4).includes('warn:chatgpt_flags'), 'ChatGPT\'s own notes are shown');
ok(codes(r1, 3).includes('error:no_drug'), 'line 3 "Ciplox 100 Tab" is not in the list, and is NOT guessed to be Ciplox Eye Drops or Ciplox 500');
eq(r1.reconciliation.ok, true, 'the bill adds up to the printed total: ₹2,556.36');
near(r1.reconciliation.computed_total, 2556.36, '…computed exactly as CureDesk will save it');
ok(r1.problems.some((p) => p.code === 'duplicate_invoice') === false, 'no duplicate (the supplier has no invoice 12 yet)');

// a person fixes it all
const fixed = JSON.parse(JSON.stringify(d1)) as Draft;
const f = (n: number) => fixed.lines[n - 1];
f(1).confirmed = true;
f(2).batch = 'AX2024'; f(2).new_drug = { ...f(2).suggested_new, name: 'Alprax 10', generic_name: 'Alprazolam', form: 'Tablet', strength: '10 mg', schedule: 'H1' };
f(3).new_drug = { ...f(3).suggested_new, name: 'Ciplox 100', generic_name: 'Ciprofloxacin', form: 'Tablet', strength: '100 mg', schedule: 'H' };
for (const n of [4, 5]) { f(n).expiry = '2027-12-31'; f(n).new_drug = { ...f(n).suggested_new, schedule: 'OTC' }; }
const r2 = check(fixed);
eq(r2.errors, 0, 'after fixing every red item there are no errors');
ok(r2.ready, 'the bill is ready');
ok(r2.warnings >= 1, `…with ${r2.warnings} amber note(s) still shown for the person to see`);

// ============================================================================================================
section('3 · the other layout of the same bill (Jeqline): the same batch on three lines, free quantity, a round-off');
const jeq = (rows: Record<string, any>[], bill: Record<string, any>) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...Object.entries(bill)]), 'Bill');
  const headers = Object.keys(rows[0]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))]), 'Items');
  return draftFromFile(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
};
const jBill = { 'Supplier name': 'Jeqline Pharmacy', 'Supplier GSTIN': '24AKPPP1343N1ZR', 'Invoice number': '30', 'Invoice date': '25-06-2021', 'Printed discount': 990.84, 'Printed round off': -0.3, 'Printed net amount': 18912.0 };
const jRows = [
  { 'Name as printed': 'Belladonna 30', 'Batch': '025488', 'Expiry (MM/YYYY)': '', 'Qty': 10, 'Free qty': 2, 'MRP': 165, 'Rate': 157.14, 'Disc %': 10, 'GST %': 5, 'Line amount as printed': 1484.98 },
  { 'Name as printed': 'Belladonna 30', 'Batch': '025488', 'Expiry (MM/YYYY)': '', 'Qty': 1, 'Free qty': 0, 'MRP': 165, 'Rate': 157.14, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 165 },
  { 'Name as printed': 'Belladonna 30', 'Batch': '025488', 'Expiry (MM/YYYY)': '', 'Qty': 100, 'Free qty': 3, 'MRP': 165, 'Rate': 157.14, 'Disc %': 5, 'GST %': 5, 'Line amount as printed': 15674.72 },
  { 'Name as printed': 'Belladonna 30', 'Batch': 'd2032', 'Expiry (MM/YYYY)': '10/2025', 'Qty': 5, 'Free qty': 2, 'MRP': 120, 'Rate': 120, 'Disc %': 8, 'GST %': 5, 'Line amount as printed': 579.6 },
  { 'Name as printed': '1/2 dram plastic', 'Batch': 'd3706', 'Expiry (MM/YYYY)': '', 'Qty': 5, 'Free qty': 0, 'MRP': 180, 'Rate': 180, 'Disc %': 0, 'GST %': 12, 'Line amount as printed': 1008 },
];
const j = jeq(jRows, jBill);
ok(j.r.problems.length === 0 && j.draft!.lines.length === 5, 'accepted (5 lines)');
const jd = j.draft!;
near(jd.bill.discount, 0, 'the ₹990.84 printed discount is the lines\' own discounts: no invoice discount added');
eq(jd.bill.round_off, 'auto', 'a printed round-off of −0.30 → the total is rounded to the nearest rupee');
const jr = check(jd);
eq(jr.reconciliation.ok, true, 'the bill adds up to ₹18,912.00');
near(jr.reconciliation.computed_total, 18912, '…exactly');
ok(codes(jr).includes('info:repeat_batch'), 'the three lines of batch 025488 are noted: joined into one batch of stock');
ok(['error:no_expiry'].every((c) => codes(jr, 1).includes(c)), 'line 1 has no expiry → asked');
ok(codes(jr, 4).includes('error:expired'), 'line 4 expired in 10/2025 (today is 25 Oct 2026) → it cannot be imported as it is: set it aside or check the pack');
eq(jd.lines[4].gst_rate, 12, 'the plastic dram carries its own GST 12');
near(lineComputed(jd.lines[2]) as number, 15674.72, 'line 3: 100 × ₹157.14, less 5%, plus 5% GST = ₹15,674.72 (exactly what the bill prints)');

// ============================================================================================================
section('4 · the Meerut bill: a quantity "1.", a discount in the wrong place, a footer that disagrees');
const mRows = [
  { 'Name as printed': 'Paracetamol 500mg', 'Batch': 'B1234', 'Expiry (MM/YYYY)': '12/26', 'Qty': 2, 'MRP': 20, 'Rate': 20, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 42 },
  { 'Name as printed': 'Cough Syrup 100ml', 'Batch': 'C5678', 'Expiry (MM/YYYY)': '10/25', 'Qty': '1.', 'MRP': 80, 'Rate': 80, 'Disc %': 5, 'GST %': 12, 'Line amount as printed': 84, 'Flags': 'discount 5 sits in the Disc column but amount = 80 + 5%' },
  { 'Name as printed': 'Face Mask (pack of 10)', 'Batch': 'M9087', 'Expiry (MM/YYYY)': '11/27', 'Qty': '1.', 'MRP': 100, 'Rate': 100, 'Disc %': 0, 'GST %': 5, 'Line amount as printed': 105 },
];
const mm = jeq(mRows, { 'Supplier name': 'My Company', 'Invoice number': '0001/25-26', 'Invoice date': '05-Aug-25', 'Printed net amount': 231 });
ok(mm.r.problems.length === 0, 'accepted');
const md = mm.draft!;
eq(md.lines[1].qty, 1, 'quantity "1." is read as 1');
eq(md.bill.invoice_date, '2025-08-05', '"05-Aug-25" is read as 5 August 2025');
const mr = check(md);
ok(codes(mr, 2).includes('warn:line_amount_differs'), 'line 2: the bill prints ₹84 but 80 − 5% + 12% = ₹85.12: flagged for a look at the bill');
ok(codes(mr, 2).includes('error:expired'), 'line 2 (10/25) is expired: blocked');
eq(mr.reconciliation.ok, false, 'the total does not add up: the bill says ₹231.00');
ok(Math.abs((mr.reconciliation.difference as number) + 1.12) < 0.011, `…computed ₹232.12, difference ${mr.reconciliation.difference}`);
ok(codes(mr).includes('error:totals_differ'), 'which blocks the import until a person fixes a line or accepts the difference');
const acked = JSON.parse(JSON.stringify(md)) as Draft; acked.bill.totals_ack = true;
ok(check(acked).problems.some((p) => p.code === 'totals_differ' && p.severity === 'warn'), 'accepting the difference turns the error into a note');
ok(!check(md).problems.some((p) => p.code === 'lines_dont_add_up'), 'the printed lines add up to the bill\'s own total (₹231.00), so no line seems to be missing');

// ============================================================================================================
section('5 · set aside, and checks that need a person');
const aside = JSON.parse(JSON.stringify(fixed)) as Draft;
aside.lines[3].aside = true; aside.lines[3].expiry = '';            // a line the person cannot finish now
const ra = check(aside);
ok(ra.ready && ra.aside === 1 && ra.importing === 4, 'a line set aside no longer blocks: 4 import now, 1 waits');
eq(ra.reconciliation.ok, true, '…and the whole bill still adds up (the waiting line stands in by its printed amount)');
const allAside = JSON.parse(JSON.stringify(fixed)) as Draft; allAside.lines.forEach((l) => { l.aside = true; });
ok(codes(check(allAside)).includes('error:nothing_to_import'), 'every line set aside → nothing to import');
const dup = check(fixed, (id, no) => (no === '12' ? { id: 9, date: '2024-04-28' } : null));
ok(codes(dup).includes('error:duplicate_invoice'), 'an invoice already recorded is refused');
const fut = JSON.parse(JSON.stringify(fixed)) as Draft; fut.bill.invoice_date = '2026-12-01';
ok(codes(check(fut)).includes('error:future_invoice_date'), 'a bill dated in the future is refused');
const half = JSON.parse(JSON.stringify(fixed)) as Draft; half.lines[0].gst_rate = 6;
ok(check(half).problems.some((p) => p.code === 'bad_gst' && /TOTAL: 12%/.test(p.message)), 'GST 6 is flagged as only half of 12');
const noSup = JSON.parse(JSON.stringify(fixed)) as Draft; noSup.bill.wholesaler_id = null; noSup.bill.supplier_license = '';
ok(codes(check(noSup)).includes('error:new_supplier_licence'), 'a new supplier needs its drug licence number');
const decimals = JSON.parse(JSON.stringify(fixed)) as Draft; decimals.lines[0].qty = 2.5;
ok(codes(check(decimals), 1).includes('error:bad_qty'), 'a quantity of 2.5 units is refused');
const mrpLow = JSON.parse(JSON.stringify(fixed)) as Draft; mrpLow.lines[0].mrp = 50;
ok(codes(check(mrpLow), 1).includes('warn:mrp_below_cost'), 'an MRP below the rate + GST is flagged (selling below cost)');

// ============================================================================================================
section('6 · reading messy files');
const messy = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(messy, XLSX.utils.aoa_to_sheet([['Notes from ChatGPT'], ['Here is your file']]), 'Readme');
XLSX.utils.book_append_sheet(messy, XLSX.utils.aoa_to_sheet([
  ['Field', 'Value'], ['Seller', 'Sun Pharma Hubli'], ['GSTIN', '29SUNPH7890Q1Z2'], ['Bill No', 'SP/77'], ['Date', new Date(Date.UTC(2026, 9, 20))], ['Net Payable', '₹ 1,234.50'], ['Random row', 'x'],
]), ' bill ');
XLSX.utils.book_append_sheet(messy, XLSX.utils.aoa_to_sheet([
  [],
  ['Sr', 'Product Name', 'extra', 'Batch No.', 'Exp', 'Quantity', 'Fr', 'M.R.P.', 'PTR', 'Dis %', 'Tax %', 'Total'],
  [1, 'DOLO 650 TAB', 'zzz', 'AB12', 'Mar-27', '10+2', '', 31, 28.5, '', '5', 299.25],
  [2, 'Total', '', '', '', '', '', '', '', '', '', 299.25],
  [3, 'PAN 40', '', 'PN1', new Date(Date.UTC(2027, 5, 1)), 15, 0, 130, '110.00', 0, '2.5+2.5', 1732.5],
]), 'Items');
const mess = draftFromFile(new Uint8Array(XLSX.write(messy, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
ok(mess.r.problems.length === 0, `read: a sheet named " bill ", other header spellings, an extra column, a leading blank row (${mess.r.problems.join(' | ') || 'accepted'})`);
eq(mess.r.notices.length, 1, 'a "Total" row among the lines is left out, and the person is told');
const md2 = mess.draft!;
eq(md2.lines.length, 2, 'two real lines');
eq(md2.bill.wholesaler_id, 1, 'the supplier is recognised by its GSTIN');
eq(md2.bill.invoice_date, '2026-10-20', 'a real date cell is read as that calendar day');
near(md2.bill.printed.net as number, 1234.5, '"₹ 1,234.50" is read as 1234.50');
eq(`${md2.lines[0].qty}+${md2.lines[0].free_qty}`, '10+2', 'a quantity written 10+2 is read as 10 paid + 2 free');
ok(/10\+2|read as 10 paid/.test(md2.lines[0].flags), '…and the person is told to check it');
eq(md2.lines[0].expiry, '2027-03-31', 'expiry "Mar-27" → the last day of March 2027');
eq(md2.lines[1].expiry, '2027-06-30', 'a month typed into Excel as a date (1 June 2027) → the end of June');
eq(md2.lines[1].gst_rate, 5, 'GST "2.5+2.5" → 5');
eq(md2.lines[0].match.kind, 'exact', 'DOLO 650 TAB → Dolo 650');
const refused = (rows: unknown[][], bill: unknown[][] | null = [['Supplier name', 'S'], ['Invoice number', '1'], ['Invoice date', '01-01-2026'], ['Printed net amount', 10]]) => readBillRows(bill, rows).problems;
ok(refused([['Name as printed', 'Qty', 'Rate', 'Batch'], ['X', '', 5, 'b']]).some((p) => /Row 2.*Qty is blank/.test(p)), 'a blank Qty refuses the file: "Row 2 (X): Qty is blank."');
ok(refused([['Name as printed', 'Qty', 'Rate'], ['X', 5, 'abc']]).some((p) => /Rate “abc” is not a number/.test(p)), 'a rate that is not a number is named');
ok(refused([['Name as printed', 'Batch', 'MRP'], ['X', 'b', 5]]).some((p) => /no "Qty" column/.test(p)) && refused([['Name as printed', 'Batch', 'MRP'], ['X', 'b', 5]]).some((p) => /no "Rate" column/.test(p)), 'a missing Qty or Rate COLUMN is named');
ok(refused([['Name as printed', 'Qty', 'Rate'], ['', 5, 5]]).some((p) => /name.*blank/.test(p)), 'a blank name is named');
ok(refused([['Name as printed', 'Qty', 'Rate']]).some((p) => /no lines/.test(p)), 'a header with no lines is refused');
ok(readBillRows(null, [['Name as printed', 'Qty', 'Rate'], ['X', 1, 1]]).problems.some((p) => /no sheet called "Bill"/.test(p)), 'a missing Bill sheet is named');
ok(readBillRows([['Supplier name', ''], ['Invoice number', '1']], [['Name as printed', 'Qty', 'Rate'], ['X', 1, 1]]).problems.some((p) => /Supplier name/.test(p) && /no value/.test(p)), 'a blank supplier is named');
const many = readBillRows([['Supplier name', 'S'], ['Invoice number', '1'], ['Invoice date', '01-01-2026'], ['Printed net amount', 10]], [['Name as printed', 'Qty', 'Rate'], ...Array.from({ length: 40 }, () => ['X', '', 1])]).problems;
ok(many.length <= 16 && /more/.test(many[many.length - 1]), `forty bad rows give a short list (${many.length} lines, ending "${many[many.length - 1]}")`);

// ============================================================================================================
section('7 · numbers and dates, one by one');
for (const [v, n] of [['1,234.50', 1234.5], ['₹ 78.4', 78.4], ['78.4/-', 78.4], ['Rs.100', 100], ['12%', 12], ['1.', 1], ['', null], ['abc', null], ['10+2', null], [' 5 ', 5], [7, 7], ['-0.30', -0.3]] as [any, number | null][]) {
  eq(parseNumber(v), n, `number ${JSON.stringify(v)} → ${n}`);
}
for (const [v, iso] of [['28-04-2024', '2024-04-28'], ['28/04/2024', '2024-04-28'], ['28.04.24', '2024-04-28'], ['2024-04-28', '2024-04-28'], ['05-Aug-25', '2025-08-05'], ['5 Aug 2025', '2025-08-05'], ['03/04/2026', '2026-04-03'], ['31-02-2026', null], ['hello', null]] as [string, string | null][]) {
  eq(parseBillDate(v).iso, iso, `date "${v}" → ${iso}`);
}
for (const [v, iso] of [['03-2026', '2026-03-31'], ['03/2026', '2026-03-31'], ['3/26', '2026-03-31'], ['12/26', '2026-12-31'], ['10-2025', '2025-10-31'], ['Mar-26', '2026-03-31'], ['March 2026', '2026-03-31'], ['2026-03', '2026-03-31'], ['02/2028', '2028-02-29'], ['25/10', null], ['13/2026', null], ['', null]] as [string, string | null][]) {
  eq(parseExpiry(v).iso, iso, `expiry "${v}" → ${iso}`);
}
eq(packUnits('1x10'), 10, 'pack "1x10" → 10 units'); eq(packUnits('(1x10)'), 10, '"(1x10)" → 10'); eq(packUnits('100 ml'), 100, '"100 ml" → 100'); eq(packUnits('15\'s'), 15, '"15\'s" → 15'); eq(packUnits('1 GROSS'), null, '"1 GROSS" → unknown');

// ============================================================================================================
section('8 · a free line (rate ₹0) is allowed — with a warning; a negative or blank rate is not');
const freeBill = (rate: number | string) => {
  const w = readBillRows([['Supplier name', 'Sun Pharma Hubli'], ['Invoice number', 'F-1'], ['Invoice date', '22-10-2026'], ['Printed net amount', 210]],
    [['Name as printed', 'Batch', 'Expiry (MM/YYYY)', 'Qty', 'MRP', 'Rate', 'GST %'], ['Dolo 650 Tab', 'F0', '06/2031', 10, 30, 20, 5], ['Dolo 650 Tab', 'F1', '06/2031', 5, 30, rate, 5]]);
  return { w, draft: w.problems.length ? null : buildDraft(w, ctx) };
};
const fz = freeBill(0);
ok(fz.w.problems.length === 0, 'a literal 0 in the Rate column is accepted by the file reader');
const fzCheck = check(fz.draft!);
ok(codes(fzCheck, 2).includes('warn:zero_rate') && !codes(fzCheck, 2).some((c) => c.startsWith('error:') && /rate/.test(c)), 'the free line gets an amber note: it arrives free and its profit will look like 100%');
ok(fzCheck.ready, '…and it does not block the import');
ok(!codes(fzCheck, 1).includes('warn:zero_rate'), '(the paid line has no such note)');
const fneg = check(freeBill(-5).draft!);
ok(codes(fneg, 2).includes('error:bad_rate') && !fneg.ready, 'a negative rate is an error');
ok(freeBill('').w.problems.some((p) => /Row 3.*Rate is blank/.test(p)), 'a blank rate refuses the file, naming the row');

finish();
