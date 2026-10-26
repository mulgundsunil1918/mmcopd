// The owner's fifth sample bill: SAMARTH DRUG HOUSE, tax invoice 17756 of 24/10/26 — 41 lines on TWO pages, photographed sideways, 18 columns
// (MFG code, HSN, S.Q / F.Q, MRP, Rate, %DISC, Amount, Disc Amount, Taxable Amount, CGST / SGST amounts), no serial-number column, a name that wraps
// ("-NO DISC"), a free offer in a name ("1+1"), 15 lines that are not medicines (syringes, cannulas, sutures, a bed sheet that prints no batch or expiry).
//
// The Excel here is the one REAL ChatGPT made from the photos (tests/e2e/fixtures/chatgpt-real-samarth.xlsx). It got the header and footer right and 41 of 41
// lines — but it also copied a quantity down from the row above (cannula 20G: 5 instead of 15), left a free quantity out (cannula fixator 1+1: 0 instead of 10),
// and gave up on 24 lookups ("NOT FOUND"). What this proves, with the real checks and the real database:
//   - the file is accepted and read: 41 lines, the date 24/10/26, both licences, "2 of 2" pages, the payment terms;
//   - a "line amount" that is the AMOUNT column (before discount) is no longer called wrong — 34 false alarms before;
//   - the footer's own figures say WHERE the difference is: the items total before discount is short by exactly ₹110.00 (10 cannulas × ₹11);
//   - a name that says 1+1 with Free 0 is flagged; an MRP many times the rate is questioned;
//   - syringes, cannulas, sutures, tape, a bed sheet are CONSUMABLES: no generic name, strength or schedule; the bed sheet needs no batch and no expiry;
//   - the dealer's note "-NO DISC" is not part of the suggested name; "500MG" printed in a name is offered as the strength; a 5 ml ampoule is one unit;
//   - a bill read in part ("1 of 2") is refused with the reason in plain words;
//   - after the two corrections a person would make, the bill reconciles to the printed ₹7,449.00 and imports; the consumables are stored as such,
//     the bed sheet as "NO BATCH" / "No expiry", and the 10 free cannula-fixator units are on the shelf;
//   - "No expiry" is never expired and never "expiring soon".
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { boot, call, getDb } from './harness';
import {
  addAsNew, buildLookupPrompt, checkDraft, isNoExpiry, looksConsumable, packUnits, pagesMissing, patchLine, printedStrength, schemeInName, stripBillingNotes,
  NO_BATCH, NO_EXPIRY, type Draft, type DraftLine,
} from '../../src/lib/billImport';
import { fmtDate } from '../../src/lib/utils';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const FILE = path.join(root, 'tests', 'e2e', 'fixtures', 'chatgpt-real-samarth.xlsx');
const b64 = (u: Uint8Array | Buffer) => Buffer.from(u).toString('base64');

/** The real file with a cell of the Bill sheet changed (a bill read in part). */
const withBill = (changes: Record<string, string>): string => {
  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' });
  const sh = wb.Sheets['Bill'];
  const rows = XLSX.utils.sheet_to_json<string[]>(sh, { header: 1, defval: '' });
  for (const r of rows) if (r[0] in changes) r[1] = changes[r[0]];
  wb.Sheets['Bill'] = XLSX.utils.aoa_to_sheet(rows);
  return b64(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
};

(async () => {
  const TODAY = '2026-10-26';                       // the day the bill was read (its date is 24/10/26)
  const today = new Date().toLocaleDateString('en-CA');
  const FUTURE = (() => { const d = new Date(); d.setDate(d.getDate() + 900); return d.toLocaleDateString('en-CA'); })();
  const line = (d: Draft, no: number | string): DraftLine => d.lines.find((l) => l.line_no === String(no))!;
  const byName = (d: Draft, re: RegExp): DraftLine => d.lines.find((l) => re.test(l.printed_name))!;
  const codes = (d: Draft) => checkDraft(d, { today: TODAY }).problems.map((p) => `${p.line ?? '·'}:${p.code}`);

  // ============================================================================================================
  section('1 · the small readers');
  ok(looksConsumable({ name: 'KIT KATH IV 20G CANNULA', hsn: '90183930', flags: '' }), 'a cannula kit is a consumable (HSN 9018 and the word)');
  ok(looksConsumable({ name: 'BED SHEET ADULT (PSI)', hsn: '', flags: '' }), 'a bed sheet is one by its name');
  ok(looksConsumable({ name: 'ABGEL-USP REGULAR 80X50X10MM 2\'S', hsn: '30061020', flags: '' }), 'an absorbable gelatin sponge is one by its HSN 300610');
  ok(looksConsumable({ name: 'XYZ', hsn: '', flags: 'not a medicine' }), 'ChatGPT\'s own note "not a medicine" decides it');
  ok(!looksConsumable({ name: 'KLOTIN INJ 500MG', hsn: '30049099', flags: '' }), 'an injection is a medicine');
  ok(!looksConsumable({ name: 'Fabiana imbricata 30c', hsn: '', flags: 'expiry not printed; not a standard medicine' }), 'a homeopathic item ("not a standard medicine") is still a medicine');
  eq(stripBillingNotes('STERILE WATER FOR INJ-ACULIFE NO DISC'), 'STERILE WATER FOR INJ-ACULIFE', '"NO DISC" at the end of a name is the dealer\'s note, not the name');
  eq(stripBillingNotes('TETANUS TOXOID AMP DANO (NO DISC)'), 'TETANUS TOXOID AMP DANO', '…also in brackets');
  eq(stripBillingNotes('ALKEMCORT-H INJ'), 'ALKEMCORT-H INJ', '…and a name without one is untouched');
  eq(printedStrength('KLOTIN INJ 500MG'), '500 mg', '"500MG" printed in the name is offered as the strength');
  eq(printedStrength('LOX TOPICAL 4%'), '4%', '…a percentage too');
  eq(printedStrength('NOVACLAV 1.2G INJ'), '1.2 g', '…and 1.2G');
  eq(printedStrength('LOX 2% + ADRENALINE INJ'), '', '…but a combination is left to the lookup');
  eq(printedStrength('MIKATAX-500 INJ'), '', '…and a bare number with no unit is never called a strength');
  eq(JSON.stringify(schemeInName('I.V.CANNULA FIXATOR (PCI) 1+1')), '{"paid":1,"free":1}', '"1+1" at the end of a name is a free offer');
  eq(schemeInName('CLAVAM 625 (500+125)'), null, '…but a strength "500+125" is not');
  eq(JSON.stringify(pagesMissing('1 of 2')), '{"seen":1,"total":2}', '"1 of 2" means a page is missing');
  eq(pagesMissing('2 of 2'), null, '…"2 of 2" does not');
  eq(pagesMissing('Page 1 of 2, 2 of 2'), null, '…nor does "1 of 2, 2 of 2"');
  eq(pagesMissing('1 of 1'), null, '…nor "1 of 1"');
  eq(pagesMissing(''), null, '…and no text means nothing to say');
  eq(packUnits("1'UNIT"), 1, 'a pack of "1\'UNIT" is one unit');
  eq(packUnits('2.5ML'), 2, 'a 2.5 ml pack is not rounded UP to 3');
  eq(packUnits('0.5ML'), 1, '…and a half ml is at least one');
  eq(packUnits('100ML'), 100, '…while "100ML" and "1x10" read as before');
  eq(packUnits('1x10'), 10, '…');
  ok(isNoExpiry(NO_EXPIRY) && !isNoExpiry('2031-06-30'), '"No expiry" is the one stand-in date, never a real expiry');
  eq(fmtDate(NO_EXPIRY), 'No expiry', 'every screen that formats a date says "No expiry" for it');
  ok(fmtDate('2031-06-30') !== 'No expiry', '…and a real date is still a date');

  // ============================================================================================================
  section('2 · the real ChatGPT file is read');
  const real = await call('purchaseImport:parse', b64(fs.readFileSync(FILE)));
  ok(real.ok === true, `the file ChatGPT really produced is accepted as it is (${real.ok ? '' : (real.problems || []).join(' | ')})`);
  const d0 = real.draft as Draft;
  eq(d0.lines.length, 41, 'all 41 lines are there (the bill prints "No / Items 41")');
  eq(d0.bill.invoice_number + ' / ' + d0.bill.invoice_date, '17756 / 2026-10-24', 'invoice 17756 of 24/10/26 (two-digit year read as 2026)');
  eq(d0.bill.supplier_gstin, '29AAFPH9004G1ZT', 'the seller\'s GSTIN');
  eq(d0.bill.supplier_license, 'KA-GDG-20B-83 / KA-GDG-21B-79', 'both of the seller\'s drug licences (the buyer\'s KMC number is not taken)');
  eq(d0.bill.pages_seen, '2 of 2', 'ChatGPT saw both pages');
  eq(d0.bill.printed.net, 7449, 'the printed net amount ₹7,449.00 (page 2)');
  eq(`${d0.bill.printed.subtotal}/${d0.bill.printed.discount}/${d0.bill.printed.cgst}/${d0.bill.printed.sgst}/${d0.bill.printed.round_off}`, '7289.47/212.18/185.96/185.96/-0.21', 'the footer: sub total, discount, CGST, SGST, round off');
  eq(d0.bill.pay_mode, 'Cash', 'CASH printed in the corner is the payment mode');
  eq(d0.lines.map((l) => l.line_no).join(',').slice(0, 20), '1,2,3,4,5,6,7,8,9,10', 'the bill has no serial-number column: the rows are numbered 1, 2, 3 …');
  const first = checkDraft(d0, { today: TODAY });
  const c0 = codes(d0);
  ok(!c0.some((c) => /pages_missing/.test(c)), 'no complaint about pages: "2 of 2"');
  eq(c0.filter((c) => /line_amount_differs/.test(c)).length, 0, 'the AMOUNT column (before discount) is accepted as the line amount: no false "amount differs" (it was 34 of 41)');
  ok(!c0.some((c) => /lines_dont_add_up/.test(c)), '…and "the line amounts do not add up to the total" is not said about amounts that are before GST');

  // ============================================================================================================
  section('3 · the two things ChatGPT really got wrong are found');
  ok(!first.reconciliation.ok && first.reconciliation.difference !== null, `the bill's total does not agree (${first.reconciliation.difference}) — a person must look`);
  const parts = first.reconciliation.parts ?? [];
  const before = parts.find((p) => /before discount/i.test(p.label));
  ok(!!before && Math.abs((before.diff as number) - 110) < 0.005, `the footer says WHERE: the items total before discount is short by exactly ₹110.00 (10 cannulas × ₹11) — got ${before?.diff}`);
  const disc = parts.find((p) => /^Discount/.test(p.label));
  ok(!!disc && Math.abs(disc.diff) < 0.5, `…while the discount agrees (${disc?.diff})`);
  const gst = parts.find((p) => /GST/.test(p.label));
  ok(!!gst && Math.abs(gst.diff) > 0.5, `…and the GST is a little short too, as it must be when 110 of goods is missing (${gst?.diff})`);
  const msg = first.problems.find((p) => p.code === 'totals_differ')?.message ?? '';
  ok(/Items total before discount[\s\S]*?short by ₹110\.00/.test(msg), 'the red message itself names the part and the amount');
  const fixator = byName(d0, /CANNULA FIXATOR/);
  ok(c0.includes(`${fixator.id}:scheme_in_name`), '"…1+1" in the name with Free 0 is flagged: the bill\'s F.Q column says 10');
  const kit20 = byName(d0, /KIT KATH IV 20G/), kit22 = byName(d0, /KIT KATH IV 22G/);
  ok(c0.includes(`${kit20.id}:mrp_far_above_rate`) && c0.includes(`${kit22.id}:mrp_far_above_rate`), 'a cannula kit whose MRP is 13 times its rate is questioned');
  eq([kit22.qty, kit22.printed_amount, kit20.qty, kit20.printed_amount].join('/'), '5/55/5/55', 'the copy-down is what ChatGPT really did: the 20G cannula has the 22G cannula\'s 5 and 55.00');

  // ============================================================================================================
  section('4 · consumables, names, strengths and packs');
  const cons = d0.lines.filter((l) => l.suggested_new.item_type === 'consumable');
  const flagged = d0.lines.filter((l) => /not a medicine/i.test(l.flags));
  eq(cons.length, flagged.length, `every line ChatGPT called "not a medicine" is suggested as a consumable (${cons.length} lines)`);
  ok(cons.length >= 15, 'syringes (5), cannula kits (2), needles (2), tape, suture, IV set, cannula fixator, bed sheet, gelatin sponge');
  ok(cons.every((l) => l.suggested_new.schedule === 'OTC' && l.suggested_new.generic_name === '' && l.suggested_new.strength === '' && l.suggested_new.form === 'Consumable' && l.suggested_new.pack_size === 1),
    'a consumable has no generic name, no strength, no schedule (OTC) and is one unit a pack');
  const bed = byName(d0, /BED SHEET/);
  ok(!codes(d0).includes(`${bed.id}:no_batch`) && !codes(d0).includes(`${bed.id}:no_expiry`), 'the bed sheet prints no batch and no expiry — and is not red for either (it is a consumable)');
  const med = d0.lines.filter((l) => l.suggested_new.item_type !== 'consumable');
  ok(med.every((l) => l.suggested_new.schedule === 'H' || l.suggested_new.schedule === 'OTC'), 'the medicines keep a schedule for the person to check');
  eq(byName(d0, /STERILE WATER/).suggested_new.name, 'STERILE WATER FOR INJ-ACULIFE', 'the suggested name drops the dealer\'s "NO DISC"');
  eq(byName(d0, /STERILE WATER/).printed_name, 'STERILE WATER FOR INJ-ACULIFE NO DISC', '…while the name AS PRINTED stays exactly as ChatGPT copied it');
  eq(byName(d0, /TETANUS TOXOID/).suggested_new.name, 'TETANUS TOXOID AMP DANO', '…also the bracketed "(NO DISC)"');
  const klotin = byName(d0, /KLOTIN/);
  eq(klotin.suggested_new.strength, '500 mg', 'KLOTIN INJ 500MG: the strength printed in its own name is offered (ChatGPT found nothing)');
  eq(`${klotin.suggested_new.form}/${klotin.suggested_new.pack_size}`, 'Injection/1', '…as an Injection; a 5 ml ampoule is ONE unit, not 5');
  eq(byName(d0, /ALCIPRO/).suggested_new.pack_size, 1, 'a 100 ml infusion bottle is one unit, not 100');
  eq(byName(d0, /PARABOOST/).suggested_new.pack_size, 1, '…also when the form is only read from "IV"');
  const lox = byName(d0, /LOX TOPICAL/);
  eq(lox.suggested_new.strength, '4%', 'what ChatGPT really looked up is used first (Lox 4%)');

  // ============================================================================================================
  section('5 · a bill read in part is refused in plain words');
  const half = await call('purchaseImport:parse', withBill({ 'Pages seen': '1 of 2', 'Printed net amount': '' }));
  ok(half.ok === false && half.problems.some((p: string) => /2 pages/.test(p) && /saw only page 1/.test(p) && /last page/.test(p)), `page 1 without the total: ${half.ok ? 'accepted?!' : half.problems[0]}`);
  ok(half.ok === false && !half.problems.some((p: string) => /no value for "Printed net amount"/.test(p)), '…and the generic "no value" message is replaced by that one');
  const halfWithNet = await call('purchaseImport:parse', withBill({ 'Pages seen': '1 of 2' }));
  ok(halfWithNet.ok === true, 'with a total typed in but only page 1 read, the file opens…');
  const hw = checkDraft(halfWithNet.draft, { today: TODAY });
  ok(hw.problems.some((p) => p.code === 'pages_missing' && p.severity === 'error') && !hw.ready, '…and is RED: "ChatGPT saw only page 1 of this 2-page bill"');
  const acked = checkDraft({ ...halfWithNet.draft, bill: { ...halfWithNet.draft.bill, totals_ack: true } }, { today: TODAY });
  ok(acked.problems.some((p) => p.code === 'pages_missing' && p.severity === 'warn'), '…unless the person says they have checked the difference');

  // ============================================================================================================
  section('6 · the corrections a person makes, then IMPORT');
  let d = d0;
  d = patchLine(d, kit20.id, { qty: 5 + 10, printed_amount: 165 });                    // the bill: 15 × ₹11.00 = 165.00 (ChatGPT copied the 22G row's 5 / 55.00)
  d = patchLine(d, fixator.id, { free_qty: 10 });                                       // the bill's F.Q column: 10 (the "1+1" scheme)
  const fixed = checkDraft(d, { today: TODAY });
  ok(fixed.reconciliation.ok && Math.abs((fixed.reconciliation.difference as number)) <= 1, `after those two fixes the lines add up to the printed ₹7,449.00 (difference ${fixed.reconciliation.difference})`);
  ok(!codes(d).includes(`${fixator.id}:scheme_in_name`), '…and the "1+1" note is gone');
  // what the pharmacist does on the screen: every medicine is a new one here (an empty Drug List apart from the catalogue), added as suggested; expired or missing expiries read off the pack
  for (const l of d0.lines) {
    d = addAsNew(d, l.id, { ...l.suggested_new });
    const cur = d.lines.find((x) => x.id === l.id)!;
    if (cur.expiry && cur.expiry < today) d = patchLine(d, l.id, { expiry: FUTURE, expiry_problem: '' });
  }
  const ready = checkDraft(d, { today });
  ok(ready.errors === 0, `nothing is red any more (${ready.errors} red: ${ready.problems.filter((p) => p.severity === 'error').map((p) => `${p.line ?? '·'}:${p.code}`).slice(0, 6).join(', ')})`);
  ok(d.lines.find((l) => l.id === bed.id)!.expiry === '' && d.lines.find((l) => l.id === bed.id)!.batch === '', '…and the bed sheet still has no batch and no expiry');
  const lastDrugBefore = one('SELECT MAX(id) m FROM drug_master').m as number;
  const distinct = (ls: DraftLine[]) => new Set(ls.map((l) => l.suggested_new.name.toLowerCase())).size;
  // typing something else is refused
  const noWord = await call('purchaseImport:create', { draft: d, confirm: 'yes', client_ref: 'samarth-0' });
  ok(noWord.ok === false, 'without the typed word IMPORT nothing is saved');
  const res = await call('purchaseImport:create', { draft: d, confirm: 'IMPORT', client_ref: 'samarth-1' });
  ok(res.ok === true, `the bill is imported (${res.ok ? '' : res.error})`);
  near(res.total, 7449, 'the purchase comes to what the bill says: ₹7,449.00', 1.0);
  eq(res.lines, 41, 'all 41 lines are on the purchase bill');
  eq(res.new_drugs, distinct(d0.lines), `…and each different name is ONE new item in the Drug List (${distinct(d0.lines)} names on 41 lines — the four Dispo Van syringes share one name)`);

  // ============================================================================================================
  section('7 · what is in the Drug List and on the shelf');
  const sheet = one("SELECT * FROM drug_master WHERE name LIKE 'BED SHEET%'");
  eq(`${sheet.item_type}/${sheet.schedule}/${sheet.generic_name}/${sheet.strength}`, 'consumable/OTC/null/null', 'the bed sheet is a consumable: OTC, no generic name, no strength');
  eq(sheet.gst_rate, 18, '…at its own GST rate (18%)');
  const sb = one('SELECT * FROM drug_stock_batches WHERE drug_master_id=?', sheet.id);
  eq(`${sb.batch_no}/${sb.expiry}/${sb.qty_remaining}`, `${NO_BATCH}/${NO_EXPIRY}/6`, '…stored as "NO BATCH", expiry "No expiry", six on the shelf');
  const kl = one("SELECT * FROM drug_master WHERE name='KLOTIN INJ 500MG'");
  eq(`${kl.item_type}/${kl.schedule}/${kl.strength}/${kl.form}/${kl.pack_size}`, 'medicine/H/500 mg/Injection/1', 'KLOTIN is a medicine: schedule H, strength 500 mg from its own name, an injection, one unit a pack');
  const fx = one("SELECT * FROM drug_master WHERE name LIKE 'I.V.CANNULA FIXATOR%'");
  eq(one('SELECT SUM(qty_remaining) q FROM drug_stock_batches WHERE drug_master_id=?', fx.id).q, 20, 'the cannula fixator: 10 paid + the 10 free are on the shelf');
  const cn = all('SELECT item_type, COUNT(*) c FROM drug_master WHERE id > ? GROUP BY item_type', lastDrugBefore).reduce((m: any, r: any) => ({ ...m, [r.item_type]: r.c }), {});
  eq(`${cn.consumable}/${cn.medicine}`, `${distinct(cons)}/${distinct(med)}`, 'the new items split into consumables and medicines exactly as suggested');

  const listed = (await call('pharmacy:listDrugs', { q: 'BED SHEET', activeOnly: true })) as any[];
  eq(listed[0]?.item_type, 'consumable', 'the Drug List screens are told it is a consumable (so the doctor\'s prescription picker can leave it out)');
  const fixer = (await call('pharmacy:listDrugs', { q: 'KLOTIN', activeOnly: true })) as any[];
  eq(fixer[0]?.item_type, 'medicine', '…and that KLOTIN is a medicine');

  const shelf = (await call('pharmacy:clinicStock')) as any[];
  const bedRow = shelf.find((r) => r.id === sheet.id);
  ok(!!bedRow && !bedRow.expired && !bedRow.expiring_soon, '"No expiry" is never expired and never "expiring soon" in Drugs in my clinic');
  const alerts = (await call('pharmacy:alerts')) as any;
  ok(!(alerts.expiringSoon ?? []).some((b: any) => b.batch_no === NO_BATCH), '…nor in the pharmacy alerts');
  const edited = await call('pharmacy:upsertDrug', { id: sheet.id, name: sheet.name, gst_rate: 18, default_mrp: 45, schedule: 'OTC' });
  eq(edited.item_type, 'consumable', 'saving the drug from an older screen that sends no type leaves it a consumable');
  const retyped = await call('pharmacy:upsertDrug', { id: sheet.id, name: sheet.name, gst_rate: 18, default_mrp: 45, schedule: 'OTC', item_type: 'medicine' });
  eq(retyped.item_type, 'medicine', '…and a screen that does send a type changes it');

  // ============================================================================================================
  section('8 · the same bill again');
  const again = await call('purchaseImport:parse', b64(fs.readFileSync(FILE)));
  ok(again.ok === true && !!again.duplicate, 'reading the file again says it is already recorded (the supplier is now in the books)');
  const dd = checkDraft(again.draft, { today, existingInvoice: () => ({ id: 1, date: '2026-10-24' }) });
  ok(dd.problems.some((p) => p.code === 'duplicate_invoice'), '…and the import is refused as a duplicate');

  // ============================================================================================================
  section('9 · the second message can be limited to the lines still not found');
  const lk = buildLookupPrompt(['3', '5', '8']);
  ok(/ONLY for these rows \(by "Line no"\): 3, 5, 8/.test(lk), 'the follow-up message names the lines');
  ok(/THREE different searches/.test(lk) && /Klotin 500mg injection 5ml/.test(lk), '…and still carries the search method (the words printed on the bill, three tries)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
