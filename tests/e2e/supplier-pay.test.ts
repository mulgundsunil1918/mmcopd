// "Pay this supplier" (Wholesalers tab): one payment that settles a supplier's unpaid bills OLDEST FIRST, through the same rule as paying a
// single bill — never more than a bill still owes, all-or-nothing, a bill whose payments were never recorded is left alone, a retried
// attempt pays nothing twice, and only a pharmacist / manager / administrator can do it. Real handlers on a temporary database.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const money = (n: number) => Math.round(n * 100) / 100;
  const s1 = await call('wholesalers:upsert', { name: 'Pay Supplier One', drug_license_no: 'DL-P1' });
  const s2 = await call('wholesalers:upsert', { name: 'Pay Supplier Two', drug_license_no: 'DL-P2' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Pay Tablet', default_mrp: 50, gst_rate: 0, schedule: 'OTC' });
  let k = 0;
  const bill = async (supplier: number, no: string, date: string, qty: number, price: number) => {
    const r = await call('purchase:create', { client_ref: `pay-${no}-${++k}`, invoice_number: no, wholesaler_id: supplier, invoice_date: date, items: [{ drug_master_id: drug.id, batch_no: `${no}-B`, expiry: day(700), qty_received: qty, purchase_price: price, mrp: price * 2 }] });
    if (!r.ok) throw new Error(`could not make bill ${no}: ${r.error}`);
    return r.invoice as any;
  };

  // supplier one: B1 oldest, unpaid · B2 part paid · B3 newest unpaid · B4 a legacy part-paid bill with no recorded amount · B5 settled
  const B1 = await bill(s1.id, 'P-B1', day(-40), 10, 100);
  const B2 = await bill(s1.id, 'P-B2', day(-30), 10, 50);
  const B3 = await bill(s1.id, 'P-B3', day(-20), 4, 100);
  const B4 = await bill(s1.id, 'P-B4', day(-15), 2, 100);
  const B5 = await bill(s1.id, 'P-B5', day(-10), 1, 100);
  const O1 = await bill(s2.id, 'P-O1', day(-5), 3, 100);                       // another supplier's bill
  ok((await call('purchase:addPayment', B2.id, { amount: 100, mode: 'Cash' })).ok, 'B2 is part paid (₹100)');
  ok((await call('purchase:addPayment', B5.id, { amount: B5.total, mode: 'Cash' })).ok, 'B5 is paid in full');
  db.prepare("UPDATE purchase_invoices SET amount_paid=NULL, payment_status='partial' WHERE id=?").run(B4.id);   // a legacy bill whose payments were never recorded

  const owed = async (id: number) => (await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === id).owed as number;
  const paidOn = (id: number) => db.prepare('SELECT amount_paid a, payment_status s FROM purchase_invoices WHERE id=?').get(id) as any;
  const startOwed = money(B1.total + (B2.total - 100) + B3.total);
  near(await owed(s1.id), startOwed, `supplier one is owed ₹${startOwed}: B1 + the unpaid part of B2 + B3 (B4's payments are unknown, B5 is settled)`);

  // ============================================================================================================
  section('1 · the money settles the oldest bill first');
  const part = money(B1.total - 50);
  const r1 = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: part, mode: 'UPI', reference: 'UTR-1', client_ref: 'sp-1' });
  ok(r1.ok && !r1.duplicate, 'a part payment is recorded');
  eq(r1.allocations.length, 1, '…all of it on the oldest bill');
  ok(r1.allocations[0].invoice_id === B1.id && r1.allocations[0].amount === part && r1.allocations[0].cleared === false, `…B1 takes ₹${part} and is not yet cleared`);
  near(paidOn(B1.id).a, part, 'B1 shows that much paid');
  near(await owed(s1.id), money(startOwed - part), 'the supplier is owed that much less');
  near(r1.owed_after, money(startOwed - part), '…and the reply says so');

  section('2 · one payment can clear several bills and part-pay the next');
  const stillB1 = 50, stillB2 = money(B2.total - 100), partB3 = 40;
  const r2 = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: money(stillB1 + stillB2 + partB3), mode: 'Bank', reference: 'CHQ-77', paid_on: day(-1), notes: 'weekly settlement', client_ref: 'sp-2' });
  ok(r2.ok, 'a second payment is recorded');
  eq(r2.allocations.map((a: any) => a.invoice_number).join(','), 'P-B1,P-B2,P-B3', 'it goes to B1, then B2, then B3 — oldest first');
  eq(r2.allocations.map((a: any) => a.cleared).join(','), 'true,true,false', 'B1 and B2 are cleared; B3 is only part paid');
  near(r2.allocations[2].amount, partB3, 'B3 takes what is left of the payment');
  eq(paidOn(B1.id).s, 'paid', 'B1 reads Paid');
  eq(paidOn(B2.id).s, 'paid', 'B2 reads Paid');
  eq(paidOn(B3.id).s, 'partial', 'B3 reads Part paid');
  const rows = db.prepare("SELECT invoice_id, amount, payment_mode, reference, paid_on, notes FROM purchase_payments WHERE client_ref LIKE 'sp-2#%' ORDER BY id").all() as any[];
  eq(rows.length, 3, 'one payment row per bill');
  ok(rows.every((x) => x.payment_mode === 'Bank' && x.reference === 'CHQ-77' && x.paid_on === day(-1) && x.notes === 'weekly settlement'), '…each carrying the mode, reference, date and note given');
  near(await owed(s1.id), money(startOwed - part - stillB1 - stillB2 - partB3), 'what is owed fell by exactly what was paid');

  // ============================================================================================================
  section('3 · it can never pay more than is owed, and leaves what it cannot settle alone');
  const left = await owed(s1.id);
  const over = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: money(left + 0.01), client_ref: 'sp-3' });
  ok(over.ok === false && /more than/i.test(over.error), `a payment ₹0.01 above what is owed is refused (${over.ok ? 'ACCEPTED' : over.error.slice(0, 70)})`);
  eq(db.prepare("SELECT COUNT(*) c FROM purchase_payments WHERE client_ref LIKE 'sp-3#%'").get().c, 0, '…and nothing was recorded');
  ok((await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: 0 })).ok === false, 'zero is refused');
  ok((await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: -5 })).ok === false, 'a negative amount is refused');
  ok((await call('purchase:paySupplier', { wholesaler_id: 99999, amount: 10 })).ok === false, 'an unknown supplier is refused');
  const foreign = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: 10, invoice_ids: [O1.id] });
  ok(foreign.ok === false && /not a bill from this supplier/i.test(foreign.error), "naming another supplier's bill is refused");
  eq(db.prepare('SELECT amount_paid a FROM purchase_invoices WHERE id=?').get(B4.id).a, null, "the legacy bill with unrecorded payments (B4) was not touched");
  eq((await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === s1.id).unknown_bills, 1, '…and is still counted as unknown');

  section('4 · pay chosen bills only');
  const r4 = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: 10, invoice_ids: [B3.id], mode: 'Cash', client_ref: 'sp-4' });
  ok(r4.ok && r4.allocations.length === 1 && r4.allocations[0].invoice_id === B3.id, 'with a bill chosen, the payment goes to that bill');
  const only = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: money((B3.total - 40 - 10) + 1), invoice_ids: [B3.id], client_ref: 'sp-4b' });
  ok(only.ok === false && /more than/i.test(only.error), '…and is held to what is owed on the chosen bills only');
  const r5 = await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: money(B3.total - 40 - 10), invoice_ids: [B3.id], client_ref: 'sp-5' });
  ok(r5.ok && r5.allocations[0].cleared, 'the rest of B3 clears it');
  near(await owed(s1.id), 0, 'supplier one is now owed nothing on bills with recorded payments');
  ok((await call('purchase:paySupplier', { wholesaler_id: s1.id, amount: 1 })).ok === false, 'paying a supplier who is owed nothing is refused');
  near(await owed(s2.id), O1.total, "the other supplier's bill was never touched");

  // ============================================================================================================
  section('5 · a retried attempt pays nothing twice');
  const again = await call('purchase:paySupplier', { wholesaler_id: s2.id, amount: 100, mode: 'Cash', client_ref: 'sp-6' });
  ok(again.ok && !again.duplicate, "a payment to the other supplier is recorded");
  const rep = await call('purchase:paySupplier', { wholesaler_id: s2.id, amount: 100, mode: 'Cash', client_ref: 'sp-6' });
  ok(rep.ok && rep.duplicate === true, 'sending the same attempt again is recognised as a repeat…');
  eq(db.prepare("SELECT COUNT(*) c FROM purchase_payments WHERE client_ref LIKE 'sp-6#%'").get().c, 1, '…and records nothing new');
  near(await owed(s2.id), money(O1.total - 100), "so the supplier is owed ₹100 less, not ₹200");

  // ============================================================================================================
  section('6 · one rule everywhere');
  const w2 = (await call('wholesalers:summary')).find((r: any) => r.wholesaler_id === s2.id);
  const rep2 = (await call('analytics:supplierReport', { from: '2000-01-01', to: '2100-12-31' })).report;
  near(rep2.owed_now.find((x: any) => x.id === s2.id).outstanding, w2.owed, 'Analytics "owed now" agrees with the Wholesalers tab');
  const list2 = (await call('purchase:list', { wholesaler_id: s2.id })) as any[];
  near(money(list2.reduce((s, x) => s + Math.max(0, x.outstanding ?? 0), 0)), w2.owed, "…and with the Purchases tab's \"to pay\"");

  // ============================================================================================================
  section('7 · who may do it');
  const mk = async (username: string, role: string) => (await call('auth:createUser', { username, password: 'pass1234', role, display_name: username })).id;
  await mk('rita', 'receptionist'); await mk('phil', 'pharmacist'); await mk('mona', 'manager');
  await call('settings:save', { require_login: true });
  const anon = await attempt('purchase:paySupplier', { wholesaler_id: s2.id, amount: 5, client_ref: 'sp-7' });
  ok(!anon.ok && /sign in/i.test((anon as any).error), 'nobody signed in: refused');
  await call('auth:login', 'rita', 'pass1234');
  const rec = await attempt('purchase:paySupplier', { wholesaler_id: s2.id, amount: 5, client_ref: 'sp-8' });
  ok(!rec.ok && /not allowed/i.test((rec as any).error), 'a receptionist cannot pay a supplier (money leaving the business)');
  await call('auth:logout');
  await call('auth:login', 'phil', 'pass1234');
  ok((await call('purchase:paySupplier', { wholesaler_id: s2.id, amount: 5, client_ref: 'sp-9' })).ok, 'a pharmacist can');
  await call('auth:logout');
  await call('auth:login', 'mona', 'pass1234');
  ok((await call('purchase:paySupplier', { wholesaler_id: s2.id, amount: 5, client_ref: 'sp-10' })).ok, 'a manager can');
  await call('auth:logout');
  const audited = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action IN ('purchase.supplier_payment')").get().c;
  ok(audited >= 4, `every supplier payment is written to the audit log (${audited})`);
  setReadOnlyMode(true);
  const ro = await attempt('purchase:paySupplier', { wholesaler_id: s2.id, amount: 5, client_ref: 'sp-11' });
  ok(!ro.ok, 'an expired licence (read-only mode) blocks supplier payments');
  setReadOnlyMode(false);

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
