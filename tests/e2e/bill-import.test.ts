// Bill import — from an uploaded Excel to stock, on the app's real handlers and a temporary database.
// Rules proved here:
//   - NOTHING reaches stock without the typed word IMPORT (the main process checks it too), and a screen that skipped a red box is refused;
//   - it becomes an ordinary purchase bill — the same totals, batches (FEFO), free units and supplier balance as typing it in — in one transaction;
//   - a new medicine or a new supplier is created only when the person asked on that line; two lines of one new medicine make ONE medicine;
//   - what the person confirmed is remembered per supplier, so the next bill from that supplier matches by itself (another supplier's memory is only offered);
//   - an invoice already recorded is refused, and a double click saves once;
//   - lines set aside are kept (with the photo) and later saved as "<invoice> (part 2)" — the bill-level discount shared by value, so every unit
//     costs exactly what it would have if the bill had been saved whole;
//   - a failure anywhere leaves nothing behind: no bill, no stray medicine, no stray supplier, no stray photo — and the same attempt can be retried;
//   - an expired licence (read-only) cannot import, but can still read a file;
//   - in a multi-PC clinic every call travels to the host as JSON — files go as base64 text, and the whole flow works through a JSON round trip.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { boot, call, attempt, getDb, setReadOnlyMode, userData } from './harness';
import { checkDraft, type Draft, type DraftLine } from '../../src/lib/billImport';
import { computePurchase } from '../../src/lib/pharmacyMath';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const today = day(0);
  const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const check = (d: Draft) => checkDraft(d, { today });
  const SUPPLIER = 'Manans Bio Medicals Pvt Ltd';
  const scanDir = path.join(userData, 'documents', 'purchase-scans');   // inside documents/, so every backup and restore carries the bill pictures
  const stockNow = () => ({ drugs: one('SELECT COUNT(*) c FROM drug_master').c, batches: one('SELECT COUNT(*) c FROM drug_stock_batches').c, bills: one('SELECT COUNT(*) c FROM purchase_invoices').c, sup: one('SELECT COUNT(*) c FROM wholesalers').c });
  const photos = () => (fs.existsSync(scanDir) ? fs.readdirSync(scanDir).length : 0);
  const asCalc = (l: DraftLine) => ({ qty: l.qty as number, free_qty: l.free_qty || 0, rate: l.rate as number, disc_pct: l.disc_pct || 0, gst_rate: l.gst_rate ?? 0 });

  /** A small bill as ChatGPT's Excel would carry it. */
  interface Row { name: string; batch: string; expiry: string; qty: number; mrp: number; rate: number; gst: number; free?: number; disc?: number }
  const mini = (o: { supplier: string; invoice: string; net: number | ''; rows: Row[] }): Uint8Array => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Field', 'Value'], ['Supplier name', o.supplier], ['Invoice number', o.invoice], ['Invoice date', ddmmyyyy(today)], ['Printed net amount', o.net],
    ]), 'Bill');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Name as printed', 'Batch', 'Expiry (MM/YYYY)', 'Qty', 'Free qty', 'MRP', 'Rate', 'Disc %', 'GST %'],
      ...o.rows.map((r) => [r.name, r.batch, r.expiry, r.qty, r.free ?? 0, r.mrp, r.rate, r.disc ?? 0, r.gst]),
    ]), 'Items');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  };
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const read = async (bytes: Uint8Array): Promise<Draft> => {
    const r = await call('purchaseImport:parse', b64(bytes));
    if (!r.ok) throw new Error(`could not read the test bill: ${r.problems.join(' ')}`);
    return r.draft as Draft;
  };

  // ============================================================================================================
  section('1 · reading the file');
  const sampleB64 = await call('purchaseImport:template', true);
  ok(typeof sampleB64 === 'string' && sampleB64.length > 2000, `the sample template downloads as base64 text (${sampleB64?.length} characters)`);
  const sampleBytes = new Uint8Array(Buffer.from(sampleB64, 'base64'));
  ok(sampleBytes[0] === 0x50 && sampleBytes[1] === 0x4b, '…and is a real .xlsx (a zip file)');
  const emptyB64 = await call('purchaseImport:template', false);
  const refused = await call('purchaseImport:parse', emptyB64);
  ok(refused.ok === false && refused.problems.length >= 4, `an empty template is refused with a list of what is missing (${refused.problems?.length} reasons)`);
  for (const [what, bytes] of [['a photo', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70])], ['a PDF', new TextEncoder().encode('%PDF-1.7 hello')], ['a text file', new TextEncoder().encode('hello,world\n1,2')], ['an empty file', new Uint8Array([])]] as [string, Uint8Array][]) {
    const r = await call('purchaseImport:parse', b64(bytes));
    ok(r.ok === false && /not an Excel file/.test(r.problems[0]) && /photo or PDF of the bill/.test(r.problems[0]), `${what} is refused in plain words, pointing to the bill-photo box`);
  }
  const base = await read(sampleBytes);
  ok((await call('purchaseImport:parse', 'this is not base64 !!')).ok === false && (await call('purchaseImport:parse', undefined)).ok === false, 'nonsense in place of a file is refused, not a crash');
  eq(base.lines.length, 5, 'the sample bill is read: 5 lines');
  eq(base.bill.wholesaler_id, null, 'the supplier (Manans Bio Medicals) is not in the Wholesalers list yet');
  ok(check(base).errors > 0, 'the draft has things to fix before it can be imported');

  // everything a person would fix on the review screen
  const fixed = (): Draft => {
    const d = clone(base);
    d.lines[0].confirmed = true;                                                                                                   // "Ciplox 500 Cap" is Ciplox 500
    d.lines[1].batch = 'AX2024';                                                                                                   // the bill said "new batch"
    d.lines[1].new_drug = { ...d.lines[1].suggested_new, name: 'Alprax 10', generic_name: 'Alprazolam', form: 'Tablet', strength: '10 mg', schedule: 'H1' };
    d.lines[2].new_drug = { ...d.lines[2].suggested_new, name: 'Ciplox 100', generic_name: 'Ciprofloxacin', form: 'Tablet', strength: '100 mg', schedule: 'H' };
    for (const n of [3, 4]) { d.lines[n].expiry = '2030-12-31'; d.lines[n].new_drug = { ...d.lines[n].suggested_new, schedule: 'OTC' }; }   // expiry not printed on the bill
    return d;
  };
  eq(check(fixed()).errors, 0, 'once every red item is fixed there are no errors');

  // ============================================================================================================
  section('2 · nothing reaches stock without IMPORT');
  const s0 = stockNow();
  for (const confirm of ['', 'import now', 'IMPORTS', 'yes']) {
    const r = await call('purchaseImport:create', { draft: fixed(), confirm, client_ref: `no-${confirm}` });
    ok(r.ok === false && /type IMPORT/i.test(r.error), `confirm "${confirm}" is refused ("${(r.error || '').slice(0, 50)}…")`);
  }
  eq(JSON.stringify(stockNow()), JSON.stringify(s0), 'and nothing was saved: no bill, no batch, no medicine, no supplier');
  const unfixed = await call('purchaseImport:create', { draft: base, confirm: 'IMPORT', client_ref: 'unfixed' });
  ok(unfixed.ok === false && /not ready/i.test(unfixed.error) && unfixed.problems.length > 0, `a screen that skipped the red boxes is refused even with IMPORT typed ("${(unfixed.error || '').slice(0, 70)}…")`);
  eq(JSON.stringify(stockNow()), JSON.stringify(s0), 'still nothing saved');
  ok((await call('purchaseImport:create', { confirm: 'IMPORT', client_ref: 'x' })).ok === false, 'no bill at all is refused');

  // ============================================================================================================
  section('3 · IMPORT: an ordinary purchase bill, with the new supplier and the new medicines');
  const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const photo = { name: 'bill.JPG', base64: b64(photoBytes) };
  const go = await call('purchaseImport:create', { draft: fixed(), confirm: ' import ', client_ref: 'imp-1', photo });
  ok(go.ok === true && go.duplicate === false, `imported (${go.ok ? 'invoice ' + go.invoice_number + ', ' + go.lines + ' lines, ₹' + go.total : go.error})`);
  eq(go.lines, 5, 'five lines');
  near(go.total, 2556.36, 'the total is exactly what the bill says: ₹2,556.36');
  eq(go.new_supplier, true, 'the supplier was added');
  eq(go.new_drugs, 4, 'four new medicines were added (Alprax 10, Ciplox 100, Fabiana imbricata 30c, Kali arsenicosum 200)');
  const inv = one('SELECT * FROM purchase_invoices WHERE id=?', go.invoice_id);
  const sup = one('SELECT * FROM wholesalers WHERE id=?', inv.wholesaler_id);
  eq(sup.name, SUPPLIER, 'the supplier is Manans Bio Medicals Pvt Ltd');
  eq(sup.gstin, '24AKPPP1343N1ZK', '…with the GSTIN from the bill');
  ok(/20C VAD/.test(sup.drug_license_no), '…and its drug licence number from the bill');
  eq(inv.invoice_number, '12', 'the invoice number is as printed');
  eq(inv.invoice_date, day(-3), 'the invoice date is the bill\'s (three days ago in the sample)');
  near(inv.total, 2556.36, 'the saved total');
  eq(inv.payment_status, 'unpaid', 'unpaid until a payment is recorded (it is owed to the supplier)');
  ok(/Imported from the bill/.test(inv.notes), 'a note says it was imported');
  ok(inv.scan_path && fs.existsSync(inv.scan_path) && path.dirname(inv.scan_path) === scanDir, 'the bill photo is kept with the purchase');
  const items = all('SELECT pii.*, m.name FROM purchase_invoice_items pii JOIN drug_master m ON m.id=pii.drug_master_id WHERE invoice_id=? ORDER BY pii.id', go.invoice_id);
  eq(items.length, 5, 'five bill lines');
  const ciplox = items.find((i) => i.name === 'Ciplox 500');
  ok(!!ciplox && ciplox.batch_no === 'abc345' && ciplox.qty_received === 1 && ciplox.mrp === 100.25 && ciplox.purchase_price === 78.4 && ciplox.gst_rate === 12, 'Ciplox 500: batch, quantity, MRP, rate and GST are as on the bill');
  ok(!!ciplox && ciplox.expiry > today && /-\d\d$/.test(ciplox.expiry), 'its expiry (a month on the bill) is the last day of that month');
  const ciplox100 = items.find((i) => i.name === 'Ciplox 100');
  eq(ciplox100.free_qty, 2, 'the free units (Ciplox 100: 5 + 2 free) are recorded');
  const batch = one('SELECT * FROM drug_stock_batches WHERE batch_no=?', 'ABC');
  eq(batch.qty_received, 7, 'the batch holds all 7 units (5 paid + 2 free)');
  eq(batch.qty_remaining, 7, '…all on the shelf');
  ok(batch.unit_cost > 0 && batch.unit_cost < 120, `the unit cost (₹${batch.unit_cost}) is spread over the 7 units, so it is below the ₹120 rate`);
  const alprax = one("SELECT * FROM drug_master WHERE name='Alprax 10'");
  ok(alprax.schedule === 'H1' && alprax.generic_name === 'Alprazolam' && alprax.strength === '10 mg' && alprax.gst_rate === 12 && alprax.default_mrp === 150, 'a new medicine carries what the person entered (schedule H1, composition) and the bill\'s GST and MRP');
  eq(one("SELECT COUNT(*) c FROM drug_master WHERE name LIKE 'Fabiana%'").c, 1, 'a homeopathic item from the bill was added once');
  const owed = (await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === sup.id);
  near(owed.owed, 2556.36, 'the supplier list now shows ₹2,556.36 owed to Manans');
  const st = await call('wholesalers:statement', sup.id);
  near(st.totals.owed, 2556.36, '…and so does the supplier\'s statement');
  ok(one('SELECT COUNT(*) c FROM purchase_name_aliases WHERE supplier_id=?', sup.id).c >= 1, 'the confirmed "Ciplox 500 Cap" → Ciplox 500 match was remembered for this supplier');
  eq(one("SELECT COUNT(*) c FROM audit_log WHERE action='purchase.import' AND entity_id=?", go.invoice_id).c, 1, 'the import is in the audit log');

  // ============================================================================================================
  section('4 · already recorded, and a double click');
  const again = await call('purchaseImport:create', { draft: fixed(), confirm: 'IMPORT', client_ref: 'imp-1' });
  ok(again.ok === true && again.duplicate === true && again.invoice_id === go.invoice_id, 'the same attempt (a double click) returns the first save');
  eq(one('SELECT COUNT(*) c FROM purchase_invoices').c, s0.bills + 1, 'still one bill');
  const reparsed = await call('purchaseImport:parse', sampleB64);
  eq(reparsed.draft.bill.wholesaler_id, sup.id, 'the same file read again: the supplier is now recognised');
  ok(reparsed.duplicate && reparsed.duplicate.id === go.invoice_id, '…and it says the invoice is already recorded');
  const reDraft = fixed(); reDraft.bill.wholesaler_id = sup.id;
  const dup = await call('purchaseImport:create', { draft: reDraft, confirm: 'IMPORT', client_ref: 'imp-2' });
  ok(dup.ok === false && /already recorded/.test(dup.error + JSON.stringify(dup.problems)), `importing it again as a new attempt is refused ("${(dup.error || '').slice(0, 70)}…")`);
  eq(one('SELECT COUNT(*) c FROM purchase_invoices').c, s0.bills + 1, 'still one bill');
  const found = await call('purchaseImport:checkInvoice', sup.id, ' 12 ');
  ok(found && found.id === go.invoice_id, 'the screen can ask whether an invoice number is taken');
  eq(await call('purchaseImport:checkInvoice', sup.id, 'NOT-A-BILL'), null, '…and gets nothing for a number that is free');

  // ============================================================================================================
  section('5 · what was confirmed is remembered for that supplier, and only that supplier');
  const dolo = one("SELECT id FROM drug_master WHERE name='Dolo 650'");
  const slip = (supplier: string, invoice: string, name = 'Dollo 650 Tab') => mini({ supplier, invoice, net: 210, rows: [{ name, batch: 'D1', expiry: '05/2031', qty: 10, mrp: 30, rate: 20, gst: 5 }] });
  const first = await read(slip(SUPPLIER, 'A-1'));
  eq(first.lines[0].match.kind, 'close', '"Dollo 650 Tab" (a spelling slip) is only a close match the first time');
  ok(first.lines[0].drug_id === dolo.id && first.lines[0].confirmed === false, '…Dolo 650 is offered but not accepted until a person confirms it');
  ok(check(first).errors > 0, '…so the bill cannot be imported yet');
  first.lines[0].confirmed = true;
  eq(check(first).errors, 0, '…once confirmed it can');
  const saved1 = await call('purchaseImport:create', { draft: first, confirm: 'IMPORT', client_ref: 'alias-1' });
  ok(saved1.ok && saved1.aliases_saved === 1 && saved1.new_drugs === 0, 'imported: the choice is remembered (and no medicine was added)');
  eq(one('SELECT drug_master_id d FROM purchase_name_aliases WHERE supplier_id=? AND alias=?', sup.id, 'dollo 650')?.d, dolo.id, '…as "dollo 650" → Dolo 650, for Manans');
  const next = await read(slip(SUPPLIER, 'A-2'));
  eq(next.lines[0].match.kind, 'alias', 'the next bill from Manans matches it by itself');
  ok(next.lines[0].confirmed && next.lines[0].drug_id === dolo.id, '…with nothing left to confirm');
  eq(check(next).errors, 0, '…and it is ready to import');
  const other = await call('wholesalers:upsert', { name: 'Another Distributor', drug_license_no: 'DL-OTHER' });
  const next2 = await read(slip('Another Distributor', 'B-1'));
  eq(next2.bill.wholesaler_id, other.id, '(the same line on a bill from ANOTHER supplier)');
  ok(next2.lines[0].match.kind !== 'alias' && !next2.lines[0].confirmed, '…is NOT matched silently: Manans\'s memory does not apply to another supplier');
  const syrup = await read(slip(SUPPLIER, 'A-3', 'Dollo 650 Syrup'));
  ok(!(syrup.lines[0].match.kind === 'alias' && syrup.lines[0].confirmed), 'and a remembered name never turns a syrup into the tablet: a different form is asked again');

  // ============================================================================================================
  section('6 · a failure leaves nothing behind, and the same attempt can be tried again');
  const d3 = fixed();
  d3.bill.invoice_number = '99'; d3.bill.wholesaler_id = null; d3.bill.supplier_name = 'Brand New Supplier Ltd'; d3.bill.supplier_gstin = ''; d3.bill.supplier_license = 'DL-NEW-1';
  const goodDrugId = d3.lines[0].drug_id;
  d3.lines[0].drug_id = 999999;                                                                                    // a medicine that is not in the list (deleted since the screen was opened)
  const s1 = stockNow(); const p1n = photos();
  const bad = await call('purchaseImport:create', { draft: d3, confirm: 'IMPORT', client_ref: 'bad-1', photo: { ...photo, name: 'x.png' } });
  ok(bad.ok === false && /no longer in the Drug List/.test(bad.error), `a medicine that vanished is refused ("${(bad.error || '').slice(0, 60)}…")`);
  eq(JSON.stringify(stockNow()), JSON.stringify(s1), 'no bill, no medicine and no supplier was left behind');
  eq(photos(), p1n, 'and the photo that had been written was removed');
  eq(one("SELECT COUNT(*) c FROM purchase_invoices WHERE client_ref='bad-1'").c, 0, 'the failed attempt is not remembered as saved');
  d3.lines[0].drug_id = goodDrugId;                                                                                // the person fixes it and presses the button again — same attempt
  const retry = await call('purchaseImport:create', { draft: d3, confirm: 'IMPORT', client_ref: 'bad-1', photo: { ...photo, name: 'x.png' } });
  ok(retry.ok === true && retry.duplicate === false && retry.new_supplier === true, 'the same attempt, once fixed, is saved (and the new supplier is added then)');
  eq(retry.new_drugs, 0, 'a new medicine already in the Drug List by that name is reused, not added twice');
  eq(one("SELECT COUNT(*) c FROM drug_master WHERE lower(name)='alprax 10'").c, 1, '…there is still one Alprax 10');
  // a new supplier needs a licence number and a name that is free
  const noLic = fixed(); noLic.bill.invoice_number = '100'; noLic.bill.wholesaler_id = null; noLic.bill.supplier_name = 'Another New Supplier'; noLic.bill.supplier_license = '';
  const r1 = await call('purchaseImport:create', { draft: noLic, confirm: 'IMPORT', client_ref: 'nl-1' });
  ok(r1.ok === false && /licen[cs]e/i.test(r1.error + JSON.stringify(r1.problems)), 'a new supplier without a drug licence number is refused');
  const sameName = fixed(); sameName.bill.invoice_number = '101'; sameName.bill.wholesaler_id = null; sameName.bill.supplier_name = SUPPLIER.toUpperCase(); sameName.bill.supplier_license = 'DL-X';
  const r2 = await call('purchaseImport:create', { draft: sameName, confirm: 'IMPORT', client_ref: 'nl-2' });
  ok(r2.ok === false && /already exists/.test(r2.error), `a "new" supplier with the name of an existing one is refused — choose it from the list ("${(r2.error || '').slice(0, 60)}…")`);
  eq(one('SELECT COUNT(*) c FROM wholesalers WHERE lower(name)=lower(?)', SUPPLIER).c, 1, '…so there is still one Manans');

  // ============================================================================================================
  section('7 · the invoice discount, freight and a payment made now');
  const mb = await read(mini({ supplier: SUPPLIER, invoice: 'MONEY-1', net: 2077.5, rows: [{ name: 'Dolo 650 Tab', batch: 'M1', expiry: '08/2031', qty: 100, mrp: 30, rate: 20, gst: 5 }] }));
  ok(mb.lines[0].match.kind === 'exact' && mb.lines[0].confirmed, 'a medicine named exactly as on the Drug List needs no confirming');
  mb.bill.discount = 50; mb.bill.other_charges = 30;                                                               // typed in the discount / freight boxes
  eq(check(mb).errors, 0, '₹2,000 − ₹50 invoice discount + 5% GST + ₹30 freight = ₹2,077.50, exactly the printed net: nothing to fix');
  mb.bill.paid_now = 3000; mb.bill.pay_mode = 'UPI';
  const tooMuch = await call('purchaseImport:create', { draft: mb, confirm: 'IMPORT', client_ref: 'money-x' });
  ok(tooMuch.ok === false && /more than the bill total/.test(tooMuch.error + JSON.stringify(tooMuch.problems)), 'paying more than the bill is refused');
  mb.bill.paid_now = 500;
  const mr = await call('purchaseImport:create', { draft: mb, confirm: 'IMPORT', client_ref: 'money-1' });
  ok(mr.ok === true, `saved (${mr.ok ? '₹' + mr.total : mr.error})`);
  near(mr.total, 2077.5, 'the invoice total is ₹2,077.50');
  const mi = one('SELECT * FROM purchase_invoices WHERE id=?', mr.invoice_id);
  ok(mi.other_charges === 30 && mi.discount === 50 && mi.amount_paid === 500 && mi.payment_mode === 'UPI' && mi.payment_status === 'partial', 'freight ₹30, discount ₹50, ₹500 paid by UPI, the bill is part paid');
  const pay = all('SELECT * FROM purchase_payments WHERE invoice_id=?', mr.invoice_id);
  ok(pay.length === 1 && pay[0].amount === 500 && pay[0].payment_mode === 'UPI' && pay[0].paid_on === today, 'the payment is on the supplier\'s account, dated today');
  const mst = await call('wholesalers:statement', sup.id);
  ok(mst.rows.some((r: any) => r.kind === 'payment' && r.debit === 500), '…and shows as a debit on the supplier\'s statement');
  const mitem = one('SELECT * FROM purchase_invoice_items WHERE invoice_id=?', mr.invoice_id);
  const mcalc = computePurchase([{ qty: 100, rate: 20, gst_rate: 5 }], { header_discount: 50, other_charges: 30, gst_in_cost: !!mi.gst_in_cost, round_off: 0 });
  near(mitem.unit_cost, mcalc.lines[0].unit_cost, 'the cost per unit counts the share of the discount and of the freight');

  // ============================================================================================================
  section('8 · two lines of one new medicine make ONE medicine; one batch on two lines is one batch of stock');
  const zx: Row[] = [
    { name: 'Zentrix Plus Tab', batch: 'Z1', expiry: '06/2031', qty: 10, mrp: 20, rate: 10, gst: 12 },
    { name: 'Zentrix Plus Tab', batch: 'Z1', expiry: '06/2031', qty: 5, mrp: 20, rate: 12, gst: 12 },
    { name: 'Zentrix Plus Tab', batch: 'Z2', expiry: '09/2031', qty: 4, mrp: 20, rate: 10, gst: 12 },
  ];
  const zxNet = Math.round((10 * 10 + 5 * 12 + 4 * 10) * 1.12 * 100) / 100;
  const zd = await read(mini({ supplier: SUPPLIER, invoice: 'MERGE-1', net: zxNet, rows: zx }));
  ok(zd.lines.every((l) => l.drug_id === null), 'the medicine is not on the Drug List yet');
  const spec = { ...zd.lines[0].suggested_new, name: 'Zentrix Plus', generic_name: '', schedule: 'OTC' as const };
  for (const l of zd.lines) l.new_drug = { ...spec };
  ok(check(zd).problems.some((p) => p.code === 'repeat_batch'), 'the screen tells the person that two lines are one batch');
  eq(check(zd).errors, 0, '…and it is ready');
  const zr = await call('purchaseImport:create', { draft: zd, confirm: 'IMPORT', client_ref: 'merge-1' });
  ok(zr.ok === true && zr.new_drugs === 1 && zr.lines === 3 && zr.batches === 2, `one new medicine, three bill lines, two batches (${zr.ok ? zr.new_drugs + ' new, ' + zr.lines + ' lines, ' + zr.batches + ' batches' : zr.error})`);
  const zdrug = one("SELECT id FROM drug_master WHERE name='Zentrix Plus'");
  const zb = all('SELECT * FROM drug_stock_batches WHERE drug_master_id=? ORDER BY batch_no', zdrug.id);
  ok(zb.length === 2 && zb[0].qty_received === 15 && zb[1].qty_received === 4, 'stock: batch Z1 holds 15 units (10 + 5), batch Z2 holds 4');
  near(zb[0].unit_cost, (10 * 10 + 5 * 12) * 1.12 / 15, 'batch Z1\'s cost per unit is the average of the two lines (the supplier charged ₹10 and ₹12), GST included for a clinic not claiming it', 0.011);
  eq(one('SELECT COUNT(*) c FROM purchase_invoice_items WHERE invoice_id=?', zr.invoice_id).c, 3, '…and all three lines are on the bill');

  // ============================================================================================================
  section('8b · a medicine that is switched off in the Drug List');
  const off = await call('pharmacy:upsertDrug', { name: 'Switchoff Syrup', schedule: 'OTC', default_mrp: 40, gst_rate: 12, is_active: 0 });
  eq(off.is_active, 0, 'a medicine switched off (as "Start fresh" leaves one that has history)');
  const sd = await read(mini({ supplier: SUPPLIER, invoice: 'OFF-1', net: 112, rows: [{ name: 'Switchoff Syrup', batch: 'S1', expiry: '06/2031', qty: 5, mrp: 40, rate: 20, gst: 12 }] }));
  ok(sd.lines[0].drug_id === null, 'the matcher does not offer a switched-off medicine');
  sd.lines[0].new_drug = { ...sd.lines[0].suggested_new, schedule: 'OTC' };
  const offGo = await call('purchaseImport:create', { draft: sd, confirm: 'IMPORT', client_ref: 'off-1' });
  ok(offGo.ok === true && offGo.reactivated === 1 && offGo.new_drugs === 0, `adding it as new switches the SAME medicine back on, not a second one (${offGo.ok ? offGo.reactivated + ' switched on, ' + offGo.new_drugs + ' new' : offGo.error})`);
  eq(one('SELECT is_active a FROM drug_master WHERE id=?', off.id).a, 1, '…so the stock is not hidden');
  eq(one("SELECT COUNT(*) c FROM drug_master WHERE lower(name)='switchoff syrup'").c, 1, '…and there is one of it');
  eq(one('SELECT qty_remaining q FROM drug_stock_batches WHERE drug_master_id=?', off.id).q, 5, '…with the five units on the shelf');
  const off2 = await call('pharmacy:upsertDrug', { name: 'Switchoff Tablet', schedule: 'OTC', default_mrp: 30, gst_rate: 12, is_active: 0 });
  const sd2 = await read(mini({ supplier: SUPPLIER, invoice: 'OFF-2', net: 210, rows: [{ name: 'Dolo 650 Tab', batch: 'S2', expiry: '06/2031', qty: 10, mrp: 30, rate: 20, gst: 5 }] }));
  sd2.lines[0].drug_id = off2.id; sd2.lines[0].confirmed = true;                                                  // a stale screen that still points at a medicine switched off meanwhile
  const offBad = await call('purchaseImport:create', { draft: sd2, confirm: 'IMPORT', client_ref: 'off-2' });
  ok(offBad.ok === false && /switched off/.test(offBad.error), `choosing a switched-off medicine is refused ("${(offBad.error || '').slice(0, 70)}…")`);
  eq(one('SELECT COUNT(*) c FROM purchase_invoices WHERE invoice_number=?', 'OFF-2').c, 0, '…and nothing was saved');

  // ============================================================================================================
  section('9 · set aside the lines with a problem, import the rest, finish the others later');
  const d4 = fixed(); d4.bill.invoice_number = 'PART-1'; d4.bill.wholesaler_id = sup.id;
  d4.bill.discount = 100;                                                                                           // a ₹100 discount on the whole bill, typed in the discount box
  d4.lines[3].aside = true; d4.lines[4].aside = true;                                                               // the two homeopathic lines wait
  const cd4 = check(d4);
  ok(!cd4.ready && cd4.problems.some((p) => p.code === 'totals_differ' && p.severity === 'error'), 'the ₹100 discount makes the lines differ from the printed net: the person must look at it');
  d4.bill.totals_ack = true;                                                                                        // "I have checked this difference"
  const pr4 = check(d4);
  ok(pr4.ready && pr4.importing === 3 && pr4.aside === 2, 'once checked: three lines import now, two wait');
  const whole = computePurchase(d4.lines.map(asCalc), { header_discount: 100, other_charges: 0, gst_in_cost: true, round_off: 0 });
  const part1 = await call('purchaseImport:create', { draft: d4, confirm: 'IMPORT', client_ref: 'part-1', photo: { ...photo, name: 'p.jpg' } });
  ok(part1.ok && part1.lines === 3 && part1.aside === 2 && part1.waiting_id > 0, `part 1 saved (${part1.lines} lines), ${part1.aside} waiting (waiting #${part1.waiting_id})`);
  if (!part1.ok) { finish(); return; }
  const waiting = await call('purchaseImport:waiting');
  const wrow = waiting.find((w: any) => w.id === part1.waiting_id);
  ok(!!wrow && wrow.line_count === 2 && wrow.invoice_number === 'PART-1 (part 2)' && wrow.supplier_name === SUPPLIER, 'the waiting list shows "PART-1 (part 2)" from Manans with 2 lines');
  eq(wrow?.has_photo, true, '…with the bill photo kept');
  eq(wrow?.imported_invoice_id, part1.invoice_id, '…and which bill it belongs to');
  const w1 = await call('purchaseImport:waitingGet', part1.waiting_id);
  ok(w1.ok && w1.draft.lines.length === 2 && w1.draft.lines.every((l: any) => !l.aside) && w1.draft.bill.part_of === 'PART-1' && w1.draft.bill.invoice_number === 'PART-1 (part 2)', 'opening it gives back just the two lines, no longer set aside');
  const ph = await call('purchaseImport:photo', w1.scan_path);
  ok(ph && Buffer.from(ph.base64, 'base64').equals(Buffer.from(photoBytes)) && ph.mime === 'image/jpeg', 'the photo can be shown again, byte for byte (as base64 text)');
  ok((await call('purchaseImport:photo', '/etc/hosts')) === null, 'but only from the folder this feature writes to…');
  ok((await call('purchaseImport:photo', path.join(scanDir, '..', 'caredesk.sqlite'))) === null && (await call('purchaseImport:photo', path.join(scanDir, '..', '..', 'caredesk.sqlite'))) === null, '…not from a path that climbs out of it');
  ok((await call('purchaseImport:photo', '..')) === null && (await call('purchaseImport:photo', '.')) === null && (await call('purchaseImport:photo', scanDir)) === null, '…nor for "..", "." or the folder itself');
  ok((await call('purchaseImport:photo', null)) === null, '…and nothing for a bill with no photo');
  const elsewhere = await call('purchaseImport:photo', `C:\\Users\\Someone Else\\AppData\\Roaming\\CureDesk\\documents\\purchase-scans\\${path.basename(w1.scan_path)}`);
  ok(elsewhere && Buffer.from(elsewhere.base64, 'base64').equals(Buffer.from(photoBytes)), 'a picture path saved on another PC (a restored backup) still finds the file by its name');
  const p1row = one('SELECT * FROM purchase_invoices WHERE id=?', part1.invoice_id);
  ok(/set aside/.test(p1row.notes) && p1row.scan_path === w1.scan_path, 'part 1\'s note says two medicines were set aside, and it keeps the same photo');
  // finish part 2 with what the person fills in later
  const d5 = w1.draft as Draft;
  d5.bill.totals_ack = true;
  const c5 = check(d5);
  ok(c5.ready, `the waiting part is ready once its totals are accepted${c5.ready ? '' : ': ' + c5.problems.filter((p) => p.severity === 'error').map((p) => p.message).join(' | ')}`);
  const part2 = await call('purchaseImport:create', { draft: d5, confirm: 'IMPORT', client_ref: 'part-2', waiting_id: part1.waiting_id });
  ok(part2.ok && part2.invoice_number === 'PART-1 (part 2)' && part2.aside === 0 && part2.waiting_id === null, `part 2 saved as "${part2.invoice_number}"`);
  eq((await call('purchaseImport:waiting')).some((w: any) => w.id === part1.waiting_id), false, 'the waiting list no longer holds it');
  eq(one('SELECT status FROM purchase_import_waiting WHERE id=?', part1.waiting_id).status, 'done', '…it is marked done');
  const p2row = one('SELECT * FROM purchase_invoices WHERE id=?', part2.invoice_id);
  eq(p2row.scan_path, p1row.scan_path, 'part 2 keeps the same bill photo (nothing was uploaded twice)');
  ok(/Later part of invoice PART-1/.test(p2row.notes), 'and says it is a later part of PART-1');
  eq(all("SELECT invoice_number FROM purchase_invoices WHERE wholesaler_id=? AND invoice_number LIKE 'PART-1%' ORDER BY id", sup.id).map((r) => r.invoice_number).join(' | '), 'PART-1 | PART-1 (part 2)', 'two purchase entries for the one supplier invoice');
  near(p1row.total + p2row.total, whole.total, `together they come to exactly what the whole bill would have cost (₹${whole.total})`, 0.021);
  const unit = (invoiceId: number) => all('SELECT unit_cost FROM purchase_invoice_items WHERE invoice_id=? ORDER BY id', invoiceId).map((r) => r.unit_cost as number);
  const costs = [...unit(part1.invoice_id), ...unit(part2.invoice_id)];
  ok(costs.length === 5 && costs.every((c, i) => Math.abs(c - whole.lines[i].unit_cost) <= 0.011), `and every unit costs what it would have if saved whole (${costs.join(', ')})`);
  const st2 = await call('wholesalers:statement', sup.id);
  ok(st2.rows.some((r: any) => r.ref === 'PART-1 (part 2)' && /later part of PART-1/.test(r.particulars)), 'the supplier statement shows part 2 as a later part of PART-1');

  // a bill with a line set aside, then thrown away
  const d6 = fixed(); d6.bill.invoice_number = 'PART-7'; d6.bill.wholesaler_id = sup.id; d6.lines[4].aside = true; d6.bill.totals_ack = true;
  const p7 = await call('purchaseImport:create', { draft: d6, confirm: 'IMPORT', client_ref: 'part-7' });
  ok(p7.ok && p7.waiting_id && p7.lines === 4 && p7.aside === 1, 'another bill with one line set aside');
  eq((await call('purchaseImport:deleteWaiting', p7.waiting_id)).ok, true, 'a waiting bill can be thrown away');
  eq((await call('purchaseImport:waiting')).some((w: any) => w.id === p7.waiting_id), false, '…and is gone from the list');
  ok((await call('purchaseImport:waitingGet', p7.waiting_id)).ok === false, '…and cannot be opened');
  eq((await call('purchaseImport:deleteWaiting', p7.waiting_id)).ok, false, '(throwing it away twice does nothing)');
  eq(one("SELECT COUNT(*) c FROM audit_log WHERE action='purchase.import_discard'").c, 1, 'throwing it away is in the audit log');
  eq(one("SELECT COUNT(*) c FROM purchase_invoices WHERE invoice_number='PART-7'").c, 1, 'the lines that were imported stay imported');

  // ============================================================================================================
  section('10 · an expired licence (read-only)');
  const ro = fixed(); ro.bill.invoice_number = 'RO-1'; ro.bill.wholesaler_id = sup.id;
  const beforeRo = stockNow();
  setReadOnlyMode(true);
  const roCreate = await attempt('purchaseImport:create', { draft: ro, confirm: 'IMPORT', client_ref: 'ro-1' });
  ok(!roCreate.ok && /read-only/i.test((roCreate as any).error), 'importing is blocked');
  const roDelete = await attempt('purchaseImport:deleteWaiting', 1);
  ok(!roDelete.ok && /read-only/i.test((roDelete as any).error), 'throwing a waiting bill away is blocked');
  ok((await attempt('purchaseImport:parse', sampleB64)).ok, 'reading a file still works');
  ok((await attempt('purchaseImport:waiting')).ok && (await attempt('purchaseImport:template', true)).ok, '…and so do the waiting list and the template');
  setReadOnlyMode(false);
  eq(JSON.stringify(stockNow()), JSON.stringify(beforeRo), 'nothing changed while it was read-only');

  // ============================================================================================================
  section('11 · over the LAN: every call travels to the host as JSON');
  // A cabin PC in client mode sends each call to the host as {args} JSON and gets {result} JSON back. Bytes cannot survive that; text can.
  const lan = async (channel: string, ...args: any[]) => JSON.parse(JSON.stringify(await call(channel, ...JSON.parse(JSON.stringify(args)))));
  const lanSample = await lan('purchaseImport:template', true);
  ok(typeof lanSample === 'string' && lanSample.length > 2000, 'the template comes back through JSON as text');
  const lanRead = await lan('purchaseImport:parse', lanSample);
  ok(lanRead.ok && lanRead.draft.lines.length === 5, 'the Excel is read after the JSON round trip');
  const lanDraft = lanRead.draft as Draft;
  lanDraft.bill.invoice_number = 'LAN-1'; lanDraft.bill.wholesaler_id = sup.id;
  lanDraft.lines[0].confirmed = true; lanDraft.lines[1].batch = 'LAN2024';
  for (const n of [1, 2, 3, 4]) { lanDraft.lines[n].new_drug = { ...lanDraft.lines[n].suggested_new, schedule: 'OTC' }; }
  for (const n of [3, 4]) lanDraft.lines[n].expiry = '2030-12-31';
  const lanPhoto = { name: 'lan.png', base64: b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7])) };
  const lanGo = await lan('purchaseImport:create', { draft: lanDraft, confirm: 'IMPORT', client_ref: 'lan-1', photo: lanPhoto, gst_in_cost: false });
  ok(lanGo.ok === true, `imported through JSON (${lanGo.ok ? 'invoice ' + lanGo.invoice_number : lanGo.error})`);
  const lanInv = one('SELECT * FROM purchase_invoices WHERE id=?', lanGo.invoice_id);
  eq(lanInv.gst_in_cost, 0, 'the screen\'s own choice about claiming the GST back is what was saved');
  const lanPic = await lan('purchaseImport:photo', lanInv.scan_path);
  ok(lanPic && lanPic.mime === 'image/png' && Buffer.from(lanPic.base64, 'base64').equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7])), 'the bill picture comes back byte for byte through JSON');
  ok(Array.isArray(await lan('purchaseImport:waiting')), 'the waiting list too');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
