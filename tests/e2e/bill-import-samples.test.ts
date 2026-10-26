// The owner's four sample supplier bills (src/demo/sample-bills.ts) through the REAL import: each is read from an Excel as a careful ChatGPT would hand it over,
// checked the way the review screen checks it, fixed the way a pharmacist would fix the red boxes (MRP from the pack, an expiry the bill did not print…),
// and imported — and the money has to come out as the bill says, to the paisa. What this proves:
//   - every layout is read: labels one row out of line, DD-MM-YYYY / 05-Aug-25 dates, 03-2026 / 12/26 expiries, a quantity "1.", CGST+SGST beside IGST, "new batch";
//   - a bill with NO discount column (Manans "TAX INVOICE") gets each line's discount worked out from the bill's own line amounts — and only because those
//     discounts add up to the discount the bill prints — so it reconciles to ₹2,556.36 instead of being a few rupees out;
//   - the bill's footer discount that is only the SUM of the line discounts is not taken off a second time (Jeqline, Manans Wholesale 2);
//   - what the bill does not say (MRP, expiry, the supplier's licence, a real batch) stays RED until a person fills it — nothing is invented;
//   - one batch printed on three lines is typed once (the expiry and MRP follow it) and becomes one batch of stock;
//   - the same invoice in two layouts is caught as already recorded; a bill whose own numbers disagree (Meerut) needs a person to look;
//   - the prompt ChatGPT is given says the things these bills need said.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { boot, call, getDb } from './harness';
import {
  addAsNew, buildPrompt, checkDraft, confirmLine, patchBill, patchLine, BILL_FIELDS, ITEM_COLUMNS,
  type Draft, type DraftLine,
} from '../../src/lib/billImport';
import { SAMPLE_BILLS, MANANS_TAX, MANANS_WHOLE, JEQLINE, MEERUT, sampleBillFor, type SampleBill } from '../../src/demo/sample-bills';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

const toXlsx = (b: SampleBill): Uint8Array => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...BILL_FIELDS.map((f) => [f.label, b.bill[f.label] ?? ''])]), 'Bill');
  const headers = ITEM_COLUMNS.map((c) => c.header);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...b.items.map((r) => headers.map((h) => (r[h] === '' || r[h] === undefined ? '' : r[h])))]), 'Items');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};
const parse = async (b: SampleBill) => {
  const r = await call('purchaseImport:parse', Buffer.from(toXlsx(b)).toString('base64'));
  if (!r.ok) throw new Error(`${b.key}: the file was refused: ${JSON.stringify(r.problems)}`);
  return r as { ok: true; draft: Draft; notices: string[]; duplicate: { id: number; date: string } | null };
};

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const FUTURE = plusDays(900);
  const line = (d: Draft, n: number): DraftLine => d.lines.find((l) => l.line_no === String(n))!;
  const codes = (d: Draft, asOf: string) => checkDraft(d, { today: asOf }).problems.map((p) => `${p.line ?? '·'}:${p.code}`);

  /** What a pharmacist does on the review screen: confirm or add each medicine, read the pack for what the bill did not print, type the licence of a new supplier. */
  const review = (d0: Draft, o: { licence?: string; mrpOf?: (l: DraftLine) => number; skip?: number[] } = {}): Draft => {
    let d = d0;
    for (const l of d0.lines) {
      if (o.skip?.includes(Number(l.line_no))) continue;
      if (l.drug_id !== null && l.match.kind !== 'ambiguous') d = confirmLine(d, l.id);
      else d = addAsNew(d, l.id, { ...l.suggested_new, schedule: 'OTC', name: l.suggested_new.name });
      const cur = d.lines.find((x) => x.id === l.id)!;
      if (cur.mrp === null) d = patchLine(d, l.id, { mrp: o.mrpOf ? o.mrpOf(cur) : Math.round((cur.rate ?? 0) * (1 + (cur.gst_rate ?? 0) / 100) * 1.1 * 100) / 100 });
      if (!cur.expiry || cur.expiry < today) d = patchLine(d, l.id, { expiry: FUTURE, expiry_problem: '' });      // not printed, or already past: read the pack
      if (/^new batch$/i.test(cur.batch)) d = patchLine(d, l.id, { batch: 'AX2024' });
    }
    if (d.bill.wholesaler_id === null && !d.bill.supplier_license.trim() && o.licence) d = patchBill(d, { supplier_license: o.licence });
    return d;
  };
  const importIt = (d: Draft, ref: string) => call('purchaseImport:create', { draft: d, confirm: 'IMPORT', client_ref: ref });

  // ============================================================================================================
  section('1 · the prompt says what these bills need said');
  const prompt = buildPrompt();
  for (const [what, re] of [
    ['copy, never guess; blank + Flags', /Copy, never guess/], ['do no arithmetic to fill a cell', /Do no arithmetic to fill a cell/], ['one row per printed line, no Total row', /One row per printed line[\s\S]*do not add a "Total" row/],
    ['seller versus buyer, and the buyer\'s licence is not the supplier\'s', /The BUYER is the clinic[\s\S]*Supplier drug licence no" empty/], ['labels one row out of line', /one row out of line/],
    ['the invoice date, not the due date', /not the "Due date"/], ['"Previous outstanding" is not part of the bill', /Previous outstanding/], ['a footer discount is only the sum of the line discounts', /only the sum of the per-line discounts/],
    ['Rate is not Taxable Amt, not Amount, not MRP', /NOT "Taxable Amt"[\s\S]*NOT the MRP/], ['no discount column → Disc % stays EMPTY (not 0, not worked out)', /NO discount column, leave Disc % EMPTY/],
    ['no free column → Free qty stays EMPTY', /no free column at all, leave Free qty EMPTY/], ['no MRP column → MRP stays EMPTY', /no MRP column, leave it EMPTY/],
    ['one GST rate when CGST, SGST and IGST sit side by side', /CGST 6\.00, SGST 6\.00, IGST 12\.00[\s\S]*ONE rate \(12\)/], ['"new batch" is copied and flagged', /"new batch"[\s\S]*not a real batch/],
    ['no expiry printed → leave both empty and flag', /BOTH cells empty and flag "expiry not printed"/], ['a quantity "1." is 1', /"1\." is 1/],
    ['something that is not a medicine is flagged', /not a medicine/], ['text cells stay text, numbers stay numbers', /Write these as TEXT[\s\S]*Write these as NUMBERS/],
    ['it checks its own work (row count)', /CHECK YOUR OWN WORK[\s\S]*the same number/], ['it never stops to ask', /Do not stop to ask me questions/], ['it trusts the lines over a footer', /Trust the lines over a footer/],
    ['only one invoice per file', /ONE invoice/],
    // the five-bill round (Samarth Drug House, 41 lines, photographed sideways): what the real ChatGPT file got wrong
    ['ONE prompt, two phases: read first with no internet, then look every medicine up; not handed over until every row is done', /TWO PHASES, ONE FILE[\s\S]*PHASE 1[\s\S]*you do NOT search the internet[\s\S]*PHASE 2[\s\S]*Do NOT hand the file over until phase 2 has been done for EVERY row/],
    ['the lookup searches with the bill\'s own words, tries three times, gives the page address, and never gives up on a generic name', /Search with the bill's own words[\s\S]*THREE different searches[\s\S]*full web address[\s\S]*These are never NOT FOUND/],
    ['the end check includes that phase 2 is done for every row', /Make sure phase 2 is done for every row/],
    // what the second real Samarth file (made with the one prompt) still got wrong
    ['phase 2 writes ONLY into the lookup columns, with Python on the phase-1 file, and nothing else may change', /Phase 2 changes ONLY the six lookup columns[\s\S]*Never re-type or rebuild the other cells[\s\S]*never in Name as printed[\s\S]*they must be identical/],
    ['brand names and codes are copied as SEEN (BIOVIL, HYOKEM)', /Brand names are not words to correct: BIOVIL stays BIOVIL[\s\S]*HYOKEM stays HYOKEM/],
    ['batch characters easily confused are named', /character by character, twice[\s\S]*0\/O\/D, 1\/I\/L, 5\/S/],
    ['GST and Disc % are read from each row\'s own cells (a bed sheet is 18)', /own CGST \/ SGST cells[\s\S]*bed sheet[\s\S]*18 \(9 \+ 9\)/],
    ['a lookup cell holds only the value; remarks go to Flags', /write only the VALUE[\s\S]*never a word like AMBIGUOUS or NOT FOUND/],
    ['lookups are row by row and checked against their own row', /Work row by row[\s\S]*never carry a lookup over to the next row/],
    ['a "1+1" name sends the reader back to the free cell', /NAME contains a free offer like 1\+1[\s\S]*look at that row's free cell once more/],
    ['every row has its own values (no copy-down from the row above)', /Every row has its OWN values[\s\S]*never copy a quantity, rate, batch, expiry, manufacturer code or amount down from the row above/i],
    ['a wrapped name joins with one space and keeps every character (-NO DISC, 24G)', /name can run onto a second line[\s\S]*ONE space[\s\S]*24G/],
    ['a sideways photo: turn it upright, enlarge, read in strips', /sideways, upside down, tilted or small[\s\S]*Python tool to turn the picture upright[\s\S]*strips of about 8 rows/],
    ['syringes, cannulas, sutures, tapes, bed sheets are rows too, flagged "not a medicine"', /Syringes, needles, IV cannulas[\s\S]*bed sheets[\s\S]*write "not a medicine"/],
    ['S.Q and F.Q are the quantity and the free quantity; every row\'s free column is looked at', /"S\.Q"[\s\S]*"F\.Q"[\s\S]*Look at the free column of EVERY row/],
    ['a short manufacturer code is copied, never expanded or copied from another row', /SHORT CODE[\s\S]*never expand it and never copy it from another row/],
    ['no serial-number column: number the rows 1, 2, 3', /NO serial-number column, number the rows 1, 2, 3/],
    ['pages seen: how many given, of how many the bill has; the totals are on the last page', /how many pages you were GIVEN[\s\S]*"1 of 2" when one is missing[\s\S]*LAST page/],
    ['two licences are both copied; FSL is a food licence, not a drug licence', /"DL X"[\s\S]*copy both, separated by " \/ "[\s\S]*FSL[\s\S]*FOOD licence/],
    ['the buyer\'s doctor registration number is not wanted', /doctor's registration number[\s\S]*NOT wanted/],
    ['a corner word CASH / CREDIT is the payment terms', /CASH or CREDIT printed in a corner/],
    ['the line amount: the Total column, else the column headed Amount; never a discount-only or tax-only column', /headed just "Amount"[\s\S]*never a column that holds only the discount or only a tax/],
    ['"1+1" in a name is a free offer: the free units are in the Free column', /"1\+1" or "10\+2" is a free offer/],
    ['the self-check: add up the amount column and compare with the bill\'s own total; fix a misread row, never a number to fit', /Add up the "Line amount as printed" column[\s\S]*never change a number just to make a sum fit/],
    ['the reply lists the lines whose Free qty is not 0', /line numbers where Free qty is not 0/],
  ] as [string, RegExp][]) ok(re.test(prompt), `the prompt: ${what}`);
  ok(prompt.length > 8000 && prompt.length < 23000, `…and is complete without being a wall of text (${prompt.length} characters)`);
  for (const c of ITEM_COLUMNS) ok(prompt.includes(c.header), `…it names the column "${c.header}"`);
  for (const f of BILL_FIELDS) ok(prompt.includes(f.label), `…and the field "${f.label}"`);

  // the plain-tax-invoice layout, read BEFORE its supplier is in the books (it prints no licence for the seller)
  const t0 = await parse(MANANS_TAX);

  // ============================================================================================================
  section(`2 · ${MANANS_WHOLE.title}`);
  const w = await parse(MANANS_WHOLE);
  eq(w.draft.lines.length, 5, 'five lines are read');
  eq(w.draft.bill.invoice_date, '2024-04-28', 'the date 28-04-2024 is the 28th of April (day first)');
  eq(w.draft.bill.invoice_number, '12', 'the invoice number is 12');
  eq(w.draft.bill.supplier_license, '20C VAD 94560, 20D VAD 93441', 'the supplier\'s licence is the one the bill prints under the seller');
  eq(line(w.draft, 3).free_qty, 2, 'Ciplox 100: 5 billed + 2 free');
  eq(line(w.draft, 2).disc_pct, 10, '…Alprax carries its printed 10% discount');
  eq(w.draft.bill.discount, 0, 'the printed "-112.00" is the sum of the line discounts, so nothing is taken off a second time');
  eq(line(w.draft, 1).expiry, '2026-03-31', '03-2026 is the last day of March 2026');
  const wr = checkDraft(w.draft, { today: MANANS_WHOLE.asOf });
  ok(wr.reconciliation.ok && wr.reconciliation.difference === 0, `the lines add up to the printed ₹2,556.36 exactly (difference ${wr.reconciliation.difference})`);
  const wc = codes(w.draft, MANANS_WHOLE.asOf);
  ok(wc.includes('2:placeholder_batch') && wc.includes('4:no_expiry') && wc.includes('5:no_expiry'), 'red: "new batch" is not a batch, and the two homeopathic lines have no expiry — a person must fill them');
  ok(!wc.some((c) => /no_mrp/.test(c)), 'the MRP is printed on this layout, so nothing about MRP is red');
  const wd = review(w.draft, { licence: 'DL-MANANS-1', mrpOf: (l) => l.mrp ?? 0 });
  const wcheck = checkDraft(wd, { today });
  eq(wcheck.errors, 0, `after the pharmacist has filled what the bill did not say there is nothing red (${wcheck.problems.filter((p) => p.severity === 'error').map((p) => p.code).join(', ')})`);
  const wimp = await importIt(wd, 'smp-whole');
  ok(wimp.ok === true, `imported (${wimp.ok ? '' : wimp.error})`);
  near(wimp.total, 2556.36, 'the saved bill is ₹2,556.36 — what the bill says');
  eq(wimp.new_supplier, true, 'Manans was added as a new supplier…');
  eq(one('SELECT drug_license_no d FROM wholesalers WHERE gstin=?', '24AKPPP1343N1ZK').d, '20C VAD 94560, 20D VAD 93441', '…with the licence and GSTIN the bill prints for the seller');

  // ============================================================================================================
  section(`3 · ${MANANS_TAX.title}`);
  const t = await parse(MANANS_TAX);
  eq(t.draft.lines.length, 5, 'five lines');
  ok(t.duplicate !== null, 'it is the SAME invoice 12 from the same supplier as the one just imported — the screen is told it is already recorded');
  const dupe = await importIt(review(t.draft, { mrpOf: (l) => (l.rate ?? 0) * 1.3 }), 'smp-tax-dupe');
  ok(dupe.ok === false && /already recorded/i.test(String(dupe.error) + JSON.stringify(dupe.problems ?? [])), 'importing it again is refused: it is already recorded');
  eq(line(t.draft, 2).disc_pct, 10, 'Alprax: no discount column, but 10% is worked out from the printed ₹1,008 (10 × ₹100 + 12% GST = ₹1,120 − 10%)');
  eq(line(t.draft, 3).disc_pct, 2, '…Ciplox 100: 2% from ₹617.40');
  eq(line(t.draft, 1).disc_pct, 0, '…Ciplox 500, printed at its full ₹87.80, has none');
  ok(line(t.draft, 2).disc_derived === true && line(t.draft, 1).disc_derived !== true, 'a worked-out discount is marked so the person can compare it with the bill');
  eq(t.draft.bill.discount, 0, 'so the bill\'s ₹112 discount is fully explained by the lines — none is spread over the others');
  const tr = checkDraft(t.draft, { today: MANANS_TAX.asOf });
  ok(tr.reconciliation.ok && tr.reconciliation.difference === 0, `…and the bill reconciles to the printed ₹2,556.36 to the paisa (difference ${tr.reconciliation.difference})`);
  const tc = codes(t.draft, MANANS_TAX.asOf);
  ok(['1:no_mrp', '2:no_mrp', '3:no_mrp', '4:no_mrp', '5:no_mrp'].every((c) => tc.includes(c)), 'red on every line: this layout prints no MRP, and the program does not invent one');
  ok(tc.includes('2:disc_derived') && tc.includes('3:disc_derived'), 'amber on the two worked-out discounts: "compare it with the bill"');
  const t0c = codes(t0.draft, MANANS_TAX.asOf);
  ok(t0c.includes('·:new_supplier_licence'), 'before Manans was a supplier: red — this layout prints no licence for the SELLER (the only one shown is the buyer\'s), so it must be typed or the supplier picked');
  eq(t0.draft.bill.supplier_license, '', '…and nothing was taken from the buyer\'s line');
  // the same invoice typed under another number (a new bill): the whole path to stock works on the derived discounts
  const t2 = JSON.parse(JSON.stringify(t.draft)) as Draft;
  t2.bill.invoice_number = '12-B';
  const t2d = review(t2, { mrpOf: (l) => (l.rate ?? 0) * 1.3 });
  eq(checkDraft(t2d, { today }).errors, 0, 'filled in, the bill has nothing red');
  const timp = await importIt(t2d, 'smp-tax');
  ok(timp.ok === true, `imported as a new bill (${timp.ok ? '' : timp.error})`);
  near(timp.total, 2556.36, 'the saved total is ₹2,556.36 again — through the worked-out discounts');
  eq(timp.new_supplier, false, 'Manans is already a supplier (matched by its GSTIN)');

  // ============================================================================================================
  section(`4 · ${JEQLINE.title}`);
  const j = await parse(JEQLINE);
  eq(j.draft.lines.length, 5, 'five lines');
  eq(j.draft.bill.invoice_date, '2021-06-25', 'the date 25-06-2021');
  eq(j.draft.bill.round_off, 'auto', 'the printed round off (−0.30) is applied');
  eq(j.draft.bill.discount, 0, 'the footer discount of ₹990.84 equals the sum of the line discounts, so it is not taken off again');
  eq(line(j.draft, 3).free_qty, 3, '100 billed + 3 free on the big line');
  const jr = checkDraft(j.draft, { today: JEQLINE.asOf });
  ok(jr.reconciliation.ok && jr.reconciliation.difference === 0, `the lines + round off make exactly the printed ₹18,912.00 (difference ${jr.reconciliation.difference})`);
  const jc = codes(j.draft, JEQLINE.asOf);
  ok(['1:no_expiry', '2:no_expiry', '3:no_expiry'].every((c) => jc.includes(c)) && !jc.includes('4:no_expiry') && !jc.includes('5:no_expiry'),
    'red: three medicine lines print no expiry (the fourth batch prints 10-2025; the plastic bottle is a consumable — it needs none)');
  ok(jc.includes('1:repeat_batch'), 'the one batch (025488) on three lines is noticed: they will be one batch of stock');
  // typing the expiry once fills the other lines of the same batch — and no other batch
  let jd = j.draft;
  jd = patchLine(jd, line(jd, 1).id, { expiry: FUTURE, mrp: 165 });
  eq(line(jd, 2).expiry + '|' + line(jd, 3).expiry, `${FUTURE}|${FUTURE}`, 'the expiry typed on line 1 is also on lines 2 and 3 (the same batch)');
  eq(line(jd, 5).expiry, '', '…but not on line 5 (another batch)');
  eq(line(jd, 4).expiry, '2025-10-31', '…and the printed expiry of line 4 is untouched');
  const jrev = review(j.draft, { licence: 'DL-JEQ-1', mrpOf: (l) => l.mrp ?? 0 });
  eq(line(jrev, 2).expiry, FUTURE, 'in the pharmacist\'s pass, one expiry typed is enough for the batch');
  eq(checkDraft(jrev, { today }).errors, 0, 'nothing is red once the gaps are filled');
  const jimp = await importIt(jrev, 'smp-jeq');
  ok(jimp.ok === true, `imported (${jimp.ok ? '' : jimp.error})`);
  near(jimp.total, 18912.0, 'the saved bill is ₹18,912.00');
  eq(jimp.lines, 5, 'five lines on the bill');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches b JOIN drug_master m ON m.id=b.drug_master_id WHERE m.name LIKE ? AND b.batch_no=?', 'Belladonna 30%', '025488').c, 1, 'the three lines of batch 025488 are ONE batch of stock');
  eq(one('SELECT qty_remaining q FROM drug_stock_batches b JOIN drug_master m ON m.id=b.drug_master_id WHERE m.name LIKE ? AND b.batch_no=?', 'Belladonna 30%', '025488').q, 10 + 2 + 1 + 100 + 3, '…holding 116 units (billed + free of all three)');

  // ============================================================================================================
  section(`5 · ${MEERUT.title}`);
  const m = await parse(MEERUT);
  eq(m.draft.bill.invoice_number, '0001/25-26', 'the invoice number is read from the shifted labels');
  eq(m.draft.bill.invoice_date, '2025-08-05', '05-Aug-25 is the 5th of August 2025');
  eq(line(m.draft, 2).qty, 1, 'a quantity printed "1." is 1');
  eq(line(m.draft, 1).expiry, '2026-12-31', '12/26 is December 2026');
  eq(line(m.draft, 1).match.kind, 'exact', '"Paracetamol 500mg" is matched to the Drug List by name and strength');
  const mr = checkDraft(m.draft, { today: MEERUT.asOf });
  ok(!mr.reconciliation.ok && Math.abs(mr.reconciliation.difference as number) > 1, `the bill's own numbers disagree: lines make ₹${mr.reconciliation.computed_total}, the bill says ₹231.00 — a person must look`);
  const mc = codes(m.draft, MEERUT.asOf);
  ok(mc.includes('·:totals_differ') && mc.includes('2:line_amount_differs'), 'red on the total, and amber on the line that does not match its own GST %');
  const mrev = review(m.draft, { licence: 'DL-MYCO-1', mrpOf: (l) => (l.rate ?? 0) * 1.2 });
  ok(checkDraft(mrev, { today }).errors > 0, 'left as ChatGPT copied it, the bill cannot be imported (the total differs)');
  // the pharmacist compares with the bill: the 84.00 is 80 + 5%, so the line is discount 0 / GST 5 — then the bill adds up
  const mfix = patchLine(mrev, line(mrev, 2).id, { disc_pct: 0, gst_rate: 5 });
  const mfr = checkDraft(mfix, { today });
  ok(mfr.reconciliation.ok && mfr.reconciliation.difference === 0, `corrected from the bill itself, the lines add up to the printed ₹231.00 (difference ${mfr.reconciliation.difference})`);
  eq(mfr.errors, 0, '…and nothing is red');
  const mimp = await importIt(mfix, 'smp-meerut');
  ok(mimp.ok === true, `imported (${mimp.ok ? '' : mimp.error})`);
  near(mimp.total, 231, 'the saved bill is ₹231.00');
  ok(one('SELECT COUNT(*) c FROM drug_master WHERE name=?', 'Face Mask (pack of 10)').c === 1 && one('SELECT schedule s FROM drug_master WHERE name=?', 'Face Mask (pack of 10)').s === 'OTC', 'the face mask is added as an ordinary item (OTC), not as a prescription medicine');
  ok(line(m.draft, 3).suggested_new.schedule === 'OTC', '…because the line is flagged "not a medicine", the suggested schedule is OTC, not H');

  // ============================================================================================================
  section('6 · the website demo offers the same four bills, dated around today');
  for (const b of SAMPLE_BILLS) {
    const moved = sampleBillFor(b, today);
    const r = await parse(moved);
    const expiries = r.draft.lines.map((l) => l.expiry).filter(Boolean);
    ok(r.draft.bill.invoice_date === plusDays(-3), `${b.key}: the invoice is dated 3 days ago (${r.draft.bill.invoice_date})`);
    ok(expiries.length > 0 && expiries.every((e) => e > today), `${b.key}: every printed expiry is in the future (${expiries.join(', ')})`);
    eq(r.draft.lines.length, b.items.length, `${b.key}: the same lines`);
  }

  // ============================================================================================================
  section('7 · the owner\'s REAL ChatGPT file (Manans wholesale layout, made with the new instructions on 2026-10-26)');
  const real = await call('purchaseImport:parse', fs.readFileSync(path.join(root, 'tests', 'e2e', 'fixtures', 'chatgpt-real-manans-wholesale-2.xlsx')).toString('base64'));
  ok(real.ok === true, 'the file ChatGPT really produced is accepted as it is');
  if (real.ok) {
    const rd = real.draft as Draft;
    eq(rd.lines.length, 5, 'its five lines are all there');
    eq(rd.bill.invoice_number + ' / ' + rd.bill.invoice_date, '12 / 2024-04-28', 'invoice 12 of 28-04-2024');
    eq(rd.bill.supplier_gstin, '24AKPPP1343N1ZK', 'the seller\'s GSTIN');
    ok(/^20C VAD 94560/.test(rd.bill.supplier_license), 'the SELLER\'s licence — not the buyer\'s DLdb3245');
    eq(rd.lines.map((l) => `${l.qty}+${l.free_qty}`).join(' '), '1+0 10+0 5+2 1+0 6+0', 'quantities and the 2 free units of Ciplox 100');
    eq(rd.lines.map((l) => l.disc_pct).join(' '), '0 10 2 0 0', 'the printed line discounts');
    eq(rd.lines.map((l) => l.gst_rate).join(' '), '12 12 5 5 5', 'GST as CGST + SGST');
    const rr = checkDraft(rd, { today: '2024-05-02' });
    ok(rr.reconciliation.ok && rr.reconciliation.difference === 0, `the lines add up to the printed ₹2,556.36 exactly (difference ${rr.reconciliation.difference})`);
    const rc = rr.problems.map((p) => `${p.line ?? '·'}:${p.code}`);
    ok(rc.includes('2:placeholder_batch') && rc.includes('4:no_expiry') && rc.includes('5:no_expiry') && rc.includes('1:confirm_match'), 'the things the bill really leaves open are RED: "new batch", the two missing expiries, the Cap-for-tablet match');
    const okRed = new Set(['confirm_match', 'no_drug', 'placeholder_batch', 'no_expiry']);
    ok(rr.problems.filter((p) => p.severity === 'error').every((p) => okRed.has(p.code)), 'and nothing else is red: no wrong total, no missing MRP, no bad GST or quantity — only "which medicine", the batch and the expiry the bill does not give');
  }

  // ============================================================================================================
  section('8 · what the four bills have in common');
  eq(SAMPLE_BILLS.length, 4, 'four sample bills are tested');
  eq(one('SELECT COUNT(*) c FROM purchase_invoices').c, 4, 'four purchase bills are in the books (the repeat of invoice 12 was refused, then the new number 12-B went in)');
  const sum = one('SELECT COALESCE(SUM(total),0) s FROM purchase_invoices').s;
  near(sum, 2556.36 + 2556.36 + 18912 + 231, 'and they add up to what the four bills say (₹24,255.72)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
