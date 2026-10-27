// Deleting a supplier, and importing a bill from one that was "deleted".
//
// What went wrong (owner, 2026-10-27, testing the bill import over and over): "I deleted the supplier but it was still existing behind somewhere and not
// allowing me to redo it". The Wholesalers button only SWITCHED the supplier off; the import then refused to add a supplier of the same name ("already exists
// - it may be switched off") and the switched-off one could not be chosen. Rules proved here:
//   - a supplier no bill points at is REALLY deleted (its name is free again, its remembered medicine names go with it);
//   - a supplier with bills cannot be erased (the bills would lose it): it is switched off, and the answer says so and how many bills;
//   - a bill imported from a switched-off supplier finds it (by GSTIN or name), switches it on again and makes NO second supplier of the same name;
//   - "a new supplier" with the name of a switched-off one reuses it; with the name of one in use it is refused in plain words;
//   - a switched-off supplier that never had a bill has no account to show; one with bills keeps its account for the records.
// Real handlers on a temporary database.
import * as XLSX from 'xlsx';
import { boot, call, attempt, getDb } from './harness';
import type { Draft } from '../../src/lib/billImport';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  /** A one-line bill as ChatGPT's Excel would carry it. */
  const bill = (o: { supplier: string; gstin?: string; invoice: string }): Uint8Array => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Field', 'Value'], ['Supplier name', o.supplier], ['Supplier GSTIN', o.gstin ?? ''], ['Invoice number', o.invoice], ['Invoice date', ddmmyyyy(today)], ['Printed net amount', 336],
    ]), 'Bill');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Name as printed', 'Batch', 'Expiry (MM/YYYY)', 'Qty', 'Free qty', 'MRP', 'Rate', 'Disc %', 'GST %'],
      ['Zyloprim 100', 'ZB1', '12/2030', 10, 0, 50, 30, 0, 12],
    ]), 'Items');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  };
  const draftOf = async (o: { supplier: string; gstin?: string; invoice: string }): Promise<Draft> => {
    const r = await call('purchaseImport:parse', b64(bill(o)));
    if (!r.ok) throw new Error('could not read the test bill: ' + r.problems.join(' '));
    const d = r.draft as Draft;
    d.lines[0].confirmed = true;
    return d;
  };
  const named = (n: string) => all('SELECT id, is_active FROM wholesalers WHERE lower(name)=lower(?)', n);

  await call('pharmacy:upsertDrug', { name: 'Zyloprim 100', generic_name: 'Allopurinol', form: 'Tablet', strength: '100 mg', default_mrp: 50, gst_rate: 12, schedule: 'OTC', low_stock_threshold: 1 });

  // ============================================================================================================
  section('1 · a supplier no bill points at is really deleted');
  const a = await call('wholesalers:upsert', { name: 'Lonely Traders', drug_license_no: 'DL-LONELY' });
  db.prepare('INSERT INTO purchase_name_aliases (supplier_id, alias, drug_master_id) VALUES (?, ?, (SELECT id FROM drug_master LIMIT 1))').run(a.id, 'zylo');
  eq(one('SELECT COUNT(*) c FROM purchase_name_aliases WHERE supplier_id=?', a.id).c, 1, 'it has one remembered medicine name');
  const d1 = await call('wholesalers:delete', a.id);
  eq(JSON.stringify(d1), JSON.stringify({ ok: true, mode: 'deleted', bills: 0 }), 'deleting it answers "deleted", 0 bills');
  eq(named('Lonely Traders').length, 0, 'the supplier is gone — not "behind somewhere"');
  eq(one('SELECT COUNT(*) c FROM purchase_name_aliases WHERE supplier_id=?', a.id).c, 0, 'its remembered medicine names went with it');
  const again = await attempt('wholesalers:upsert', { name: 'Lonely Traders', drug_license_no: 'DL-LONELY' });
  ok(again.ok, 'the same name can be added again straight away');
  eq((await call('wholesalers:delete', 99999)).mode, 'gone', 'deleting a supplier that is not there is harmless');

  // ============================================================================================================
  section('2 · a supplier with bills is kept (switched off) and the answer says so');
  const d2 = await draftOf({ supplier: 'Samarth Test House', gstin: '', invoice: 'INV-1' });
  d2.bill.supplier_license = 'KA-TEST-001';
  const imp1 = await call('purchaseImport:create', { draft: d2, confirm: 'IMPORT', client_ref: 'sd-1' });
  ok(imp1.ok === true && imp1.new_supplier === true, `the first bill adds the supplier (${imp1.ok ? 'ok' : imp1.error})`);
  const sup = named('Samarth Test House')[0];
  ok(!!sup && sup.is_active === 1, 'it is in use');
  const del = await call('wholesalers:delete', sup.id);
  eq(JSON.stringify(del), JSON.stringify({ ok: true, mode: 'switched_off', bills: 1 }), 'deleting it answers "switched off", 1 bill');
  eq(named('Samarth Test House')[0].is_active, 0, 'it is switched off, still on record');
  eq(one('SELECT COUNT(*) c FROM purchase_invoices WHERE wholesaler_id=?', sup.id).c, 1, 'and its bill still points at it');

  // ============================================================================================================
  section('3 · the next bill from it finds it, switches it on again, makes no twin');
  const d3 = await draftOf({ supplier: 'SAMARTH TEST HOUSE', invoice: 'INV-2' });
  eq(d3.bill.wholesaler_id, sup.id, 'the bill is matched to the switched-off supplier (by name)');
  const imp2 = await call('purchaseImport:create', { draft: d3, confirm: 'IMPORT', client_ref: 'sd-2' });
  ok(imp2.ok === true, `imported (${imp2.ok ? 'ok' : imp2.error})`);
  eq(imp2.new_supplier, false, 'no new supplier was added');
  eq(imp2.supplier_switched_on, true, 'the result says the supplier was switched on again');
  eq(named('Samarth Test House').length, 1, 'there is still ONE supplier of that name');
  eq(named('Samarth Test House')[0].is_active, 1, 'and it is in use again');

  // ============================================================================================================
  section('4 · "a new supplier" with the name of a switched-off one reuses it; with one in use it is refused');
  await call('wholesalers:delete', sup.id);                                         // switched off again (it has bills)
  const d4 = await draftOf({ supplier: 'Samarth Test House', invoice: 'INV-3' });
  d4.bill.wholesaler_id = null; d4.bill.supplier_name = 'Samarth Test House'; d4.bill.supplier_license = 'KA-TEST-001'; d4.bill.supplier_gstin = '29AAFPH9004G1ZT';
  const imp3 = await call('purchaseImport:create', { draft: d4, confirm: 'IMPORT', client_ref: 'sd-3' });
  ok(imp3.ok === true, `imported as "new supplier" (${imp3.ok ? 'ok' : imp3.error})`);
  eq(imp3.new_supplier, false, '…but no twin was made');
  eq(imp3.supplier_switched_on, true, '…the switched-off supplier was switched on');
  eq(named('Samarth Test House').length, 1, 'still ONE supplier of that name');
  eq(one('SELECT gstin FROM wholesalers WHERE id=?', sup.id).gstin, '29AAFPH9004G1ZT', 'its missing GSTIN was filled from the bill');
  const d5 = await draftOf({ supplier: 'Samarth Test House', invoice: 'INV-4' });
  d5.bill.wholesaler_id = null; d5.bill.supplier_name = 'Samarth Test House'; d5.bill.supplier_license = 'KA-TEST-001';
  const imp4 = await call('purchaseImport:create', { draft: d5, confirm: 'IMPORT', client_ref: 'sd-4' });
  ok(imp4.ok === false && /already exists/.test(imp4.error) && /choose it from the Supplier list/.test(imp4.error), `a name already in use is refused in plain words ("${(imp4.error || '').slice(0, 90)}…")`);
  eq(named('Samarth Test House').length, 1, 'and still no twin');

  // ============================================================================================================
  section('5 · supplier accounts: a switched-off supplier with no bill has nothing to show');
  await call('wholesalers:upsert', { name: 'Ghost Pharma', drug_license_no: 'DL-GHOST', is_active: 0 });   // the state older versions left behind
  ok(!JSON.stringify(await call('wholesalers:accounts')).includes('Ghost Pharma'), 'a switched-off supplier that never had a bill is not in the accounts list');
  await call('wholesalers:delete', sup.id);                                         // switched off, has bills
  ok(JSON.stringify(await call('wholesalers:accounts')).includes('Samarth Test House'), 'a switched-off supplier WITH bills keeps its account on record');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
