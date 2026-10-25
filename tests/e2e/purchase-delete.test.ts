// Deleting a purchase bill: ANY purchase bill, no conditions — typed or imported, paid or not, its stock sold from or not. Administrator only, with the
// admin password typed again for that one deletion (checked in the main process). Rules proved here, on the app's real handlers and a temporary database:
//   - the bill, its lines and its payments go; the supplier's balance drops by what is no longer billed; a copy is kept in the audit log;
//   - the stock it brought in comes off the shelf (free units too); a batch that only this bill ever filled and nothing left is removed;
//   - units that were already sold stay sold: the sale, its register rows and its frozen cost are untouched, and the emptied batch stays as history;
//   - a batch bought on two bills keeps the other bill's units, and goes back to that bill's price, MRP, expiry and cost;
//   - the same batch on two lines of one bill, a batch cleared earlier by "Start fresh", a waiting (set-aside) import, a "(part 2)" bill — none of them breaks it;
//   - a wrong or missing password, a receptionist, an expired licence — nothing is deleted.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: any[]) => (one(sql, ...p)?.c ?? 0) as number;

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const today = day(0);
  const sup = await call('wholesalers:upsert', { name: 'Delete Me Distributors', drug_license_no: 'DL-DM-1' });
  const other = await call('wholesalers:upsert', { name: 'Untouched Traders', drug_license_no: 'DL-DM-2' });
  const mkDrug = (name: string) => call('pharmacy:upsertDrug', { name: `${name} ${Date.now() % 100000}`, default_mrp: 40, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  let n = 0;
  const bill = async (supplierId: number, no: string, items: any[], extra: any = {}) => {
    const r = await call('purchase:create', { client_ref: `pd-${no}-${++n}`, invoice_number: no, wholesaler_id: supplierId, invoice_date: today, items, ...extra });
    if (!r.ok) throw new Error(`could not make bill ${no}: ${r.error}`);
    return r.invoice as any;
  };
  const line = (drug: any, batch: string, qty: number, price: number, extra: any = {}) => ({ drug_master_id: drug.id, batch_no: batch, expiry: day(900), qty_received: qty, purchase_price: price, mrp: 40, gst_rate: 0, ...extra });
  const stockOf = (drugId: number) => Number(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=? AND is_active=1', drugId).s);
  const batch = (drugId: number, no: string) => one('SELECT * FROM drug_stock_batches WHERE drug_master_id=? AND batch_no=?', drugId, no);
  const owed = async (id: number) => ((await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === id)?.owed ?? 0) as number;
  const audit = (action: string) => one('SELECT details FROM audit_log WHERE action=? ORDER BY id DESC LIMIT 1', action)?.details as string | undefined;
  /** Two wrong guesses in a row lock the password for 10 s; a right one clears it. */
  const settle = () => call('admin:deleteConsultation', -1, '1234');

  // ============================================================================================================
  section('1 · an unsold, unpaid bill: it goes, and so does the stock it brought in');
  const d1 = await mkDrug('Alpha');
  const p1 = await bill(sup.id, 'PD-1', [line(d1, 'A1', 100, 10, { free_qty: 10 })]);
  eq(stockOf(d1.id), 110, 'the bill brought in 110 units (100 + 10 free)');
  near(await owed(sup.id), p1.total, 'the supplier is owed its total');
  const del1 = await call('admin:deletePurchase', p1.id, '1234');
  ok(del1.ok, `deleted with the admin password (${del1.ok ? '' : del1.error})`);
  eq(count('SELECT COUNT(*) c FROM purchase_invoices WHERE id=?', p1.id) + count('SELECT COUNT(*) c FROM purchase_invoice_items WHERE invoice_id=?', p1.id), 0, 'the bill and its lines are gone');
  eq(stockOf(d1.id), 0, 'the 110 units are off the shelf');
  eq(count('SELECT COUNT(*) c FROM drug_stock_batches WHERE drug_master_id=?', d1.id), 0, '…and the batch that only this bill ever filled is removed');
  near(await owed(sup.id), 0, 'the supplier is owed nothing now');
  ok(del1.purchase.units_taken_off === 110 && del1.purchase.units_gone === 0 && del1.purchase.batches_deleted === 1, 'it reports what it did: 110 units off, 1 batch removed, none already sold');
  const a1 = audit('purchase_deleted') || '';
  ok(/PD-1/.test(a1) && /Delete Me Distributors/.test(a1) && /snapshot/.test(a1) && /"batch":"A1"/.test(a1), 'a copy of the bill (its lines) is kept in the audit log');
  const again = await call('admin:deletePurchase', p1.id, '1234');
  ok(!again.ok && /not found/i.test(again.error), 'deleting it again says "not found"');
  const unknown = await call('admin:deletePurchase', 987654, '1234');
  ok(!unknown.ok && /not found/i.test(unknown.error), 'so does a bill that never existed');

  // ============================================================================================================
  section('2 · a bill with payments: the payments go with it, and the supplier statement forgets it');
  const d2 = await mkDrug('Bravo');
  const p2 = await bill(sup.id, 'PD-2', [line(d2, 'B1', 50, 20)]);
  await call('purchase:addPayment', p2.id, { amount: 300, mode: 'UPI', paid_on: today });
  await call('purchase:addPayment', p2.id, { amount: 200, mode: 'Cash', paid_on: today });
  const keep = await bill(sup.id, 'PD-2-KEEP', [line(d2, 'B2', 10, 20)]);
  near(await owed(sup.id), p2.total - 500 + keep.total, 'before: owed = this bill part-paid + the other bill');
  const del2 = await call('admin:deletePurchase', p2.id, '1234');
  ok(del2.ok && del2.purchase.payments_erased === 2 && del2.purchase.paid_erased === 500, 'a part-paid bill is deleted too; its 2 payments (₹500) are erased with it');
  eq(count('SELECT COUNT(*) c FROM purchase_payments WHERE invoice_id=?', p2.id), 0, 'no payment record is left behind');
  near(await owed(sup.id), keep.total, 'after: the supplier is owed only the other bill');
  const st = await call('wholesalers:statement', sup.id);
  ok(!st.rows.some((r: any) => r.ref === 'PD-2') && st.rows.some((r: any) => r.ref === 'PD-2-KEEP'), 'the statement no longer lists it (and still lists the other bill)');
  eq(stockOf(d2.id), 10, "the other bill's 10 units are still on the shelf");
  ok(/"payments":\[/.test(audit('purchase_deleted') || '') && /500/.test(audit('purchase_deleted') || ''), 'the audit copy keeps the payments');
  await call('admin:deletePurchase', keep.id, '1234');

  // ============================================================================================================
  section('3 · stock already SOLD: the sale stays, the batch stays as history');
  const d3 = await mkDrug('Charlie');
  const p3 = await bill(sup.id, 'PD-3', [line(d3, 'C1', 100, 10)]);
  const sale = await call('pharmacy:sell', { client_ref: 'pd-sale-3', items: [{ drug_master_id: d3.id, drug_name: d3.name, qty: 30, rate: 40 }], payment_mode: 'Cash' });
  eq(stockOf(d3.id), 70, 'sold 30 of 100: 70 on the shelf');
  const regBefore = count('SELECT COUNT(*) c FROM dispensing_register WHERE sale_id=?', sale.id);
  const costBefore = one('SELECT unit_cost c FROM dispensing_register WHERE sale_id=?', sale.id)?.c;
  const del3 = await call('admin:deletePurchase', p3.id, '1234');
  ok(del3.ok && del3.purchase.units_taken_off === 70 && del3.purchase.units_gone === 30 && del3.purchase.batches_deleted === 0 && del3.purchase.batches_reduced === 1, 'the 70 units still on the shelf come off; the 30 already sold are reported as gone');
  eq(stockOf(d3.id), 0, 'nothing is left to sell');
  eq(count('SELECT COUNT(*) c FROM pharmacy_sales WHERE id=?', sale.id), 1, 'the sale is untouched');
  eq(count('SELECT COUNT(*) c FROM dispensing_register WHERE sale_id=?', sale.id), regBefore, 'so are its register rows');
  eq(one('SELECT unit_cost c FROM dispensing_register WHERE sale_id=?', sale.id)?.c, costBefore, '…and the cost frozen on the sale');
  const b3 = batch(d3.id, 'C1');
  ok(!!b3 && b3.qty_remaining === 0 && b3.qty_received === 30 && b3.is_active === 0, 'the batch stays as history: 30 received (the sold ones), 0 left, switched off');
  eq(b3?.purchase_item_id ?? null, null, '…no longer pointing at the deleted bill');

  // ============================================================================================================
  section('4 · a batch bought on two bills goes back to the other bill');
  const d4 = await mkDrug('Delta');
  const p4a = await bill(sup.id, 'PD-4A', [line(d4, 'D1', 50, 10, { mrp: 40 })]);
  const p4b = await bill(other.id, 'PD-4B', [line(d4, 'D1', 50, 20, { mrp: 55, expiry: day(1200) })]);
  const merged = batch(d4.id, 'D1');
  ok(merged.qty_received === 100 && merged.qty_remaining === 100 && merged.mrp === 55, 'the two bills made one batch of 100 (the newer MRP ₹55 on it)');
  near(merged.unit_cost, 15, 'its cost is the average of the two (₹10 and ₹20)');
  const del4 = await call('admin:deletePurchase', p4b.id, '1234');
  ok(del4.ok && del4.purchase.batches_deleted === 0 && del4.purchase.batches_reduced === 1, 'deleting the newer bill reduces the batch, it does not remove it');
  const back = batch(d4.id, 'D1');
  ok(back.qty_received === 50 && back.qty_remaining === 50, 'the batch is back to the first bill\'s 50 units');
  ok(back.mrp === 40 && back.expiry === day(900), '…with the first bill\'s MRP (₹40) and expiry');
  near(back.unit_cost, 10, '…and its cost (₹10)');
  eq(back.purchase_item_id, one('SELECT id FROM purchase_invoice_items WHERE invoice_id=?', p4a.id).id, '…pointing at the first bill\'s line again');
  const del4a = await call('admin:deletePurchase', p4a.id, '1234');
  ok(del4a.ok && del4a.purchase.batches_deleted === 1 && !batch(d4.id, 'D1'), 'deleting the first bill as well removes the batch');

  // ============================================================================================================
  section('5 · the same batch on two lines of one bill, and a batch cleared earlier');
  const d5 = await mkDrug('Echo');
  const p5 = await bill(sup.id, 'PD-5', [line(d5, 'E1', 20, 10), line(d5, 'E1', 5, 12, { free_qty: 5 })]);
  eq(stockOf(d5.id), 30, 'two lines of batch E1 made 30 units');
  const del5 = await call('admin:deletePurchase', p5.id, '1234');
  ok(del5.ok && del5.purchase.units_taken_off === 30 && stockOf(d5.id) === 0 && !batch(d5.id, 'E1'), 'both lines come off, and the batch is removed');
  const d6 = await mkDrug('Foxtrot');
  const p6 = await bill(sup.id, 'PD-6', [line(d6, 'F1', 40, 10)]);
  await call('pharmacy:clearDrugs', { ids: [d6.id] });                         // "Delete selected" (the stock and the batch go)
  const del6 = await call('admin:deletePurchase', p6.id, '1234');
  ok(del6.ok && del6.purchase.units_taken_off === 0 && del6.purchase.units_gone === 40, 'a bill whose batch was cleared earlier still deletes (its 40 units were already gone)');

  // ============================================================================================================
  section('6 · an imported bill with lines set aside: the waiting lines stay');
  const imp = await call('purchaseImport:template', true);
  const parsed = await call('purchaseImport:parse', imp);
  const draft = parsed.draft;
  draft.bill.invoice_number = 'PD-IMP-1'; draft.bill.wholesaler_id = sup.id;
  draft.lines[0].confirmed = true; draft.lines[1].batch = 'IMP2024';
  for (const k of [1, 2, 3, 4]) draft.lines[k].new_drug = { ...draft.lines[k].suggested_new, schedule: 'OTC' };
  for (const k of [3, 4]) draft.lines[k].expiry = '2030-12-31';
  draft.lines[3].aside = true; draft.lines[4].aside = true; draft.bill.totals_ack = true;
  const impRes = await call('purchaseImport:create', { draft, confirm: 'IMPORT', client_ref: 'pd-imp-1' });
  ok(impRes.ok && impRes.waiting_id, 'an imported bill with two lines waiting');
  const delImp = await call('admin:deletePurchase', impRes.invoice_id, '1234');
  ok(delImp.ok, 'the imported bill is deleted like any other');
  const wait = (await call('purchaseImport:waiting')).find((w: any) => w.id === impRes.waiting_id);
  ok(!!wait && wait.line_count === 2 && wait.imported_invoice_id === null, 'the two waiting lines are still waiting (they no longer point at a bill)');
  const w = await call('purchaseImport:waitingGet', impRes.waiting_id);
  ok(w.ok && w.draft.lines.length === 2, '…and can still be opened and finished');

  // ============================================================================================================
  section('7 · the password, the role and the licence');
  const d7 = await mkDrug('Golf');
  const p7 = await bill(sup.id, 'PD-7', [line(d7, 'G1', 10, 10)]);
  await settle();
  for (const [what, pw] of [['no password', undefined], ['an empty password', ''], ['a wrong password', 'nope']] as [string, any][]) {
    const r = await call('admin:deletePurchase', p7.id, pw);
    ok(!r.ok && /wrong admin password/i.test(r.error), `${what} is refused ("${r.error}")`);
    await settle();
  }
  eq(count('SELECT COUNT(*) c FROM purchase_invoices WHERE id=?', p7.id), 1, '…and the bill is still there');
  eq(stockOf(d7.id), 10, '…and so is its stock');
  await call('auth:createUser', { username: 'rina', password: 'pass1234', role: 'pharmacist', display_name: 'Rina' });
  await call('settings:save', { require_login: true });
  await call('auth:login', 'rina', 'pass1234');
  const asPharmacist = await attempt('admin:deletePurchase', p7.id, '1234');
  ok(!asPharmacist.ok && /not allowed/i.test((asPharmacist as any).error), 'a pharmacist cannot delete a purchase bill, even with the right password');
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  setReadOnlyMode(true);
  const ro = await attempt('admin:deletePurchase', p7.id, '1234');
  ok(!ro.ok, 'with an expired licence (read-only) deleting is blocked');
  setReadOnlyMode(false);
  eq(count('SELECT COUNT(*) c FROM purchase_invoices WHERE id=?', p7.id), 1, '…and nothing was deleted');
  const asAdmin = await call('admin:deletePurchase', p7.id, '1234');
  ok(asAdmin.ok, 'the administrator, with the password, can');
  await call('auth:logout');
  await call('settings:save', { require_login: false });

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
