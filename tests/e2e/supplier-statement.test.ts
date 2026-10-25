// Wholesalers → Statement: a supplier's whole account as a passbook, so the clinic needs nothing else to know where it stands.
// Rules proved here, on the app's real handlers and a temporary database:
//   - every bill is a CREDIT (what the clinic owes) and every payment a DEBIT (what it paid), in date order, a bill before a payment on the same day,
//     with a running balance; the last balance IS what is owed now, and it is the same figure the supplier list shows;
//   - the bills still pending are listed oldest first with how many days old each is; the latest bills newest first;
//   - a bill whose paid amount was never recorded is shown apart and is in no total (it cannot be guessed) — exactly as the supplier list treats it;
//   - choosing a start date gives the balance brought forward and only the rows from then; an end date stops the passbook there;
//   - another supplier's bills never appear; an unknown supplier gives nothing; money is added in paise, so pennies never drift;
//   - a later part of a bill ("12 (part 2)") is labelled with the invoice it belongs to.
import { boot, call, getDb } from './harness';
import { buildSupplierStatement } from '../../src/lib/supplierStatement';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const s1 = await call('wholesalers:upsert', { name: 'Statement Supplier One', drug_license_no: 'DL-S1', gstin: '29ABCDE1234F1Z5', phone: '9000000001' });
  const s2 = await call('wholesalers:upsert', { name: 'Statement Supplier Two', drug_license_no: 'DL-S2' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Statement Tablet', default_mrp: 50, gst_rate: 0, schedule: 'OTC' });
  let k = 0;
  const bill = async (supplier: number, no: string, date: string, qty: number, price: number) => {
    const r = await call('purchase:create', { client_ref: `st-${no}-${++k}`, invoice_number: no, wholesaler_id: supplier, invoice_date: date,
      items: [{ drug_master_id: drug.id, batch_no: `${no}-B`, expiry: day(700), qty_received: qty, purchase_price: price, mrp: price * 2, gst_rate: 0 }] });
    if (!r.ok) throw new Error(`could not make bill ${no}: ${r.error}`);
    return r.invoice as any;
  };
  const pay = async (id: number, amount: number, date: string, mode = 'Cash', reference?: string) => {
    const r = await call('purchase:addPayment', id, { amount, mode, paid_on: date, reference });
    if (!r.ok) throw new Error(`could not pay: ${r.error}`);
  };

  // supplier one's story:  B1 oldest, paid in full · B2 part paid · B3 unpaid · B4 legacy (paid amount never recorded) · B5 "12" unpaid, B6 "12 (part 2)" unpaid
  const B1 = await bill(s1.id, 'ST-1', day(-60), 10, 100);          // 1000
  const B2 = await bill(s1.id, 'ST-2', day(-45), 10, 50);           // 500
  const B3 = await bill(s1.id, 'ST-3', day(-30), 4, 100);           // 400
  const B4 = await bill(s1.id, 'ST-4', day(-20), 2, 100);           // 200  (unknown payments)
  const B5 = await bill(s1.id, '12', day(-10), 3, 100);             // 300
  const B6 = await bill(s1.id, '12 (part 2)', day(-10), 1, 100);    // 100  (same day as B5)
  const O1 = await bill(s2.id, 'ST-O1', day(-5), 3, 100);           // another supplier
  await pay(B1.id, 1000, day(-55), 'UPI', 'UTR-55');
  await pay(B2.id, 100, day(-40), 'Cash');
  await pay(B2.id, 50, day(-10), 'Bank', 'CHQ-9');                  // paid on the same day B5 and B6 were billed
  db.prepare("UPDATE purchase_invoices SET amount_paid=NULL, payment_status='partial' WHERE id=?").run(B4.id);

  const owedInList = async (id: number) => (await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === id).owed as number;
  const st = await call('wholesalers:statement', s1.id);

  // ============================================================================================================
  section('1 · the heading and the totals');
  eq(st.supplier.name, 'Statement Supplier One', 'the statement is for the right supplier');
  ok(st.supplier.drug_license_no === 'DL-S1' && st.supplier.gstin === '29ABCDE1234F1Z5' && st.supplier.phone === '9000000001', 'it carries the licence number, GSTIN and phone for the printout');
  eq(st.as_of, day(0), 'as of today');
  near(st.totals.billed, 1000 + 500 + 400 + 300 + 100, 'billed = every bill whose payments are recorded (₹2,300; the unknown one is apart)');
  near(st.totals.paid, 1000 + 100 + 50, 'paid = every payment (₹1,150)');
  near(st.totals.owed, 2300 - 1150, 'owed now = ₹1,150');
  near(st.totals.owed, await owedInList(s1.id), "…the same figure the supplier list shows (they can never disagree)");
  eq(st.totals.bills, 6, 'six bills in all');
  eq(st.totals.open_bills, 4, 'four of them are still pending (B2, B3, "12", "12 (part 2)")');
  eq(st.totals.oldest_pending_days, 45, 'the oldest pending bill is 45 days old');
  eq(st.totals.last_bill_date, day(-10), 'the last bill was ten days ago');
  eq(st.totals.last_payment_date, day(-10), 'the last payment was ten days ago');

  section('2 · the passbook: credit, debit and a running balance');
  const lines = st.rows.map((r: any) => `${r.kind}:${r.ref}`);
  eq(lines.join(' | '), `bill:ST-1 | payment:ST-1 | bill:ST-2 | payment:ST-2 | bill:ST-3 | bill:12 | bill:12 (part 2) | payment:ST-2`, 'in date order, and on the same day the bill comes before the payment');
  ok(st.rows.every((r: any) => (r.kind === 'bill' ? r.credit > 0 && r.debit === 0 : r.debit > 0 && r.credit === 0)), 'a bill is a credit, a payment is a debit');
  let run = 0;
  const balances = st.rows.map((r: any) => (run = Math.round((run + r.credit - r.debit) * 100) / 100));
  ok(st.rows.every((r: any, i: number) => Math.abs(r.balance - balances[i]) < 0.005), 'every row carries the running balance (credit − debit so far)');
  near(st.rows[st.rows.length - 1].balance, st.totals.owed, 'the last balance is what is owed now');
  near(st.period.credit, 2300, 'credit total');
  near(st.period.debit, 1150, 'debit total');
  near(st.period.closing, st.totals.owed, 'closing balance = credit − debit = owed now');
  eq(st.brought_forward, 0, 'nothing is brought forward when no start date is chosen');
  ok(/UPI/.test(st.rows[1].particulars) && /UTR-55/.test(st.rows[1].particulars), 'a payment line says how it was paid (mode and reference)');
  ok(/12 \(part 2\)/.test(st.rows[6].particulars) && /later part of 12/.test(st.rows[6].particulars), 'a later part of a bill is labelled with the invoice it belongs to');

  section('3 · pending bills oldest first, latest bills newest first');
  eq(st.pending.map((b: any) => b.invoice_number).join(' | '), 'ST-2 | ST-3 | 12 | 12 (part 2)', 'pending: oldest first (the paid bill and the unknown one are not in it)');
  near(st.pending[0].outstanding, 350, 'ST-2 still owes ₹350 (₹500 less ₹150 paid)');
  eq(st.pending[0].state, 'part', '…and reads part-paid');
  eq(st.pending[1].state, 'unpaid', 'ST-3 reads unpaid');
  eq(st.pending[0].days_old, 45, 'ST-2 is 45 days old');
  eq(st.pending[1].days_old, 30, 'ST-3 is 30 days old');
  eq(st.pending[3].part_of, '12', '"12 (part 2)" says it is a part of invoice 12');
  eq(st.latest[0].invoice_number === '12 (part 2)' || st.latest[0].invoice_number === '12', true, 'the latest bills start with the newest');
  ok(st.latest.every((b: any, i: number, a: any[]) => i === 0 || a[i - 1].invoice_date >= b.invoice_date), 'latest bills run newest → oldest');
  eq(st.latest.length, 6, 'all six bills are in the latest list (10 are shown at most)');

  section('4 · a bill whose payments were never recorded is shown apart, in no total');
  eq(st.unknown.map((b: any) => b.invoice_number).join(','), 'ST-4', 'ST-4 is listed as unknown');
  eq(st.unknown[0].state, 'unknown', '…with state "unknown"');
  ok(!st.rows.some((r: any) => r.ref === 'ST-4') && !st.pending.some((b: any) => b.invoice_number === 'ST-4'), 'it is not in the passbook or the pending list');
  ok(st.latest.some((b: any) => b.invoice_number === 'ST-4'), '(it is still among the latest bills, marked unknown)');
  eq((await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === s1.id).unknown_bills, 1, 'the supplier list counts it as unknown too');

  section('5 · a start date and an end date');
  const mid = await call('wholesalers:statement', s1.id, { from: day(-35) });
  near(mid.brought_forward, 1000 - 1000 + 500 - 100, 'balance brought forward from before that day: B1 settled, B2 less ₹100 = ₹400');
  eq(mid.rows.map((r: any) => `${r.kind}:${r.ref}`).join(' | '), 'bill:ST-3 | bill:12 | bill:12 (part 2) | payment:ST-2', 'only the rows from the start date on');
  near(mid.rows[0].balance, 400 + 400, 'the running balance carries on from the balance brought forward');
  near(mid.period.closing, mid.totals.owed, 'closing balance still equals what is owed now');
  near(mid.period.closing, mid.brought_forward + mid.period.credit - mid.period.debit, 'closing = brought forward + credit − debit');
  const upTo = await call('wholesalers:statement', s1.id, { to: day(-42) });
  eq(upTo.rows.map((r: any) => `${r.kind}:${r.ref}`).join(' | '), 'bill:ST-1 | payment:ST-1 | bill:ST-2', 'an end date stops the passbook there');
  near(upTo.period.closing, 500, 'the balance on that day was ₹500');
  near(upTo.totals.owed, st.totals.owed, '(the headline "owed now" does not change with the period shown)');
  const none = await call('wholesalers:statement', s1.id, { from: day(1) });
  ok(none.rows.length === 0 && Math.abs(none.brought_forward - st.totals.owed) < 0.005, 'a start date in the future: no rows, everything brought forward');

  section('6 · only this supplier, and no such supplier');
  const st2 = await call('wholesalers:statement', s2.id);
  eq(st2.rows.map((r: any) => r.ref).join(','), 'ST-O1', "supplier two's passbook holds only its own bill");
  near(st2.totals.owed, 300, '…owing ₹300');
  eq(await call('wholesalers:statement', 99999), null, 'an unknown supplier gives nothing');
  const empty = await call('wholesalers:upsert', { name: 'Statement Supplier Three', drug_license_no: 'DL-S3' });
  const st3 = await call('wholesalers:statement', empty.id);
  ok(st3.rows.length === 0 && st3.totals.owed === 0 && st3.totals.bills === 0 && st3.pending.length === 0, 'a supplier with no bills has an empty, zero statement');

  section('7 · money is added in paise');
  const inv = [{ id: 1, invoice_number: 'X1', invoice_date: '2026-01-01', total: 99.99, amount_paid: 99.99, line_count: 1 }];
  const pays = [33.33, 33.33, 33.33].map((a, i) => ({ id: i + 1, invoice_id: 1, amount: a, payment_mode: 'Cash', paid_on: '2026-01-0' + (i + 2) }));
  const sp = buildSupplierStatement(inv, pays, { today: '2026-02-01' });
  ok(sp.totals.owed === 0 && sp.pending.length === 0 && sp.rows[sp.rows.length - 1].balance === 0, 'three payments of ₹33.33 settle a ₹99.99 bill to exactly ₹0.00');
  const tenth = buildSupplierStatement([{ id: 1, invoice_number: 'T', invoice_date: '2026-01-01', total: 0.3, amount_paid: 0.2 }, { id: 2, invoice_number: 'U', invoice_date: '2026-01-02', total: 0.1, amount_paid: 0 }],
    [{ id: 1, invoice_id: 1, amount: 0.1, payment_mode: null, paid_on: '2026-01-03' }, { id: 2, invoice_id: 1, amount: 0.1, payment_mode: null, paid_on: '2026-01-04' }], { today: '2026-01-10' });
  eq(tenth.totals.owed, 0.2, '0.1 + 0.2 style sums come out exact (₹0.30 − ₹0.20 + ₹0.10 = ₹0.20)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
