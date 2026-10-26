// A limit on the discount a person may give at the PHARMACY COUNTER, by role (Settings → Billing & IPD → Discounts → "At the pharmacy
// counter"). The rule lives in the main process: the limit comes from WHO IS SIGNED IN, never from what a screen sends; a role with no
// number is not limited (so an update changes nothing for a clinic that never set one); admin is never limited; a broken setting
// must not grant more than the owner meant. Real handlers on a temporary database.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { saleSubtotalPaise, percentDiscountPaise } from '../../src/lib/discountLimit';
import { fromPaise } from '../../src/lib/pharmacyMath';

boot();
const db = getDb();

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const sup = await call('wholesalers:upsert', { name: 'Cap Supplier', drug_license_no: 'DL-CAP' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Cap Tablet', default_mrp: 100, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  const pur = await call('purchase:create', { client_ref: 'cap-1', invoice_number: 'CAP-1', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: drug.id, batch_no: 'CAP1', expiry: '2031-01-01', qty_received: 500, purchase_price: 50, mrp: 100, selling_price: 100 }] });
  ok(pur.ok, 'stock is bought on a supplier bill');

  const mk = async (username: string, role: string) => (await call('auth:createUser', { username, password: 'pass1234', role, display_name: username })).id;
  await mk('phil', 'pharmacist'); await mk('rita', 'receptionist'); await mk('dora', 'doctor'); await mk('mona', 'manager');

  let n = 0;
  /** One counter sale of `qty` × ₹`rate` with a flat ₹`discount`. */
  const sell = (discount: number, extra: Record<string, any> = {}, rate = 100, qty = 2) =>
    attempt('pharmacy:sell', { client_ref: `cap-sale-${++n}`, items: [{ drug_master_id: drug.id, drug_name: 'Cap Tablet', qty, rate }], discount, payment_mode: 'Cash', ...extra });
  const refused = (r: any) => r.ok === false && /may give up to|Settings → Billing → Discounts/.test(r.error);

  // ============================================================================================================
  section('0 · a NEW install starts with sensible limits');
  eq((await call('settings:get')).pharmacy_discount_caps_json, JSON.stringify({ pharmacist: 10, receptionist: 5 }), 'a fresh database is given pharmacist 10% and receptionist 5%');
  await call('settings:save', { require_login: true });
  await call('auth:login', 'phil', 'pass1234');
  ok(refused(await sell(40)), 'so on day one a pharmacist cannot give 20% (₹40 on a ₹200 sale)…');
  ok((await sell(20)).ok, '…but 10% is fine');
  await call('auth:logout');

  // ============================================================================================================
  section('1 · an UPDATED clinic that never set a limit keeps its freedom');
  await call('settings:save', { pharmacy_discount_caps_json: '' });     // what an updated clinic has: the key was never written (see upgrade-legacy)
  await call('auth:login', 'phil', 'pass1234');
  ok((await sell(100)).ok, 'a pharmacist can still give 50% — no limit was ever set, so an update changes nothing');
  await call('auth:logout');

  // ============================================================================================================
  section('2 · limits by role');
  await call('auth:login', 'admin', 'admin123');
  await call('settings:save', { pharmacy_discount_caps_json: JSON.stringify({ pharmacist: 10, receptionist: 5, admin: 1 }) });
  await call('auth:logout');

  await call('auth:login', 'phil', 'pass1234');
  ok((await sell(20)).ok, 'pharmacist (10%): ₹20 on a ₹200 sale is exactly 10% → allowed');
  const over = await sell(20.01);
  ok(refused(over), `…₹20.01 is refused (${over.ok ? 'ACCEPTED' : (over as any).error.slice(0, 90)})`);
  ok(!over.ok && /10%/.test((over as any).error) && /₹20\.00/.test((over as any).error), '…and the message names the limit and what it comes to in rupees');
  ok((await sell(0)).ok, '…no discount is always fine');
  const sneaky = await sell(150, { max_discount_pct: 100 });
  ok(refused(sneaky), 'a screen cannot lift its own limit: max_discount_pct sent by the caller is overwritten');
  const odd = await sell(33.34, {}, 333.33, 1);
  ok(refused(odd), '10% of ₹333.33 is ₹33.33 — ₹33.34 is refused (no rounding in the sale\'s favour)…');
  ok((await sell(33.33, {}, 333.33, 1)).ok, '…and ₹33.33 is allowed');
  const saleCount = (db.prepare('SELECT COUNT(*) c FROM pharmacy_sales').get() as any).c;
  await sell(99);
  eq((db.prepare('SELECT COUNT(*) c FROM pharmacy_sales').get() as any).c, saleCount, 'a refused sale leaves no sale and takes no stock');
  await call('auth:logout');

  await call('auth:login', 'rita', 'pass1234');
  ok((await sell(10)).ok, 'receptionist (5%): ₹10 on ₹200 → allowed');
  ok(refused(await sell(10.01)), '…₹10.01 is refused');
  await call('auth:logout');

  await call('auth:login', 'dora', 'pass1234');
  ok((await sell(100)).ok, 'a doctor with no number is not limited');
  await call('auth:logout');
  await call('auth:login', 'mona', 'pass1234');
  ok((await sell(150)).ok, 'a manager with no number is not limited either');
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  ok((await sell(200)).ok, 'an administrator is never limited — even 100%, and even with a number set for the role');
  await call('auth:logout');

  // ============================================================================================================
  section('3 · zero, a broken setting, and no one signed in');
  await call('auth:login', 'admin', 'admin123');
  await call('settings:save', { pharmacy_discount_caps_json: JSON.stringify({ pharmacist: 0 }) });
  await call('auth:logout');
  await call('auth:login', 'phil', 'pass1234');
  ok(refused(await sell(1)), '0% means no discount at all');
  ok((await sell(0)).ok, '…but the sale itself still goes through');
  await call('auth:logout');

  await call('auth:login', 'admin', 'admin123');
  await call('settings:save', { pharmacy_discount_caps_json: '{ this is not json' });
  await call('auth:logout');
  await call('auth:login', 'phil', 'pass1234');
  ok(refused(await sell(1)), 'a broken limit setting holds every non-admin at 0% — it never grants more than the owner meant');
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  ok((await sell(50)).ok, '…while the administrator, who can fix it, is not held');
  await call('settings:save', { pharmacy_discount_caps_json: JSON.stringify({ pharmacist: 10 }) });
  await call('auth:logout');

  await call('settings:save', { require_login: false });
  ok((await sell(150)).ok, 'shared-PC mode (nobody signed in) has no identity to limit, so the counter works as it always has');

  // the setting round-trips as the Settings screen writes it
  eq((await call('settings:get')).pharmacy_discount_caps_json, JSON.stringify({ pharmacist: 10 }), 'the limits are kept as the Settings screen saved them');

  // ============================================================================================================
  section('4 · a discount typed as a PERCENTAGE is remembered as that percentage (the receipt says "Discount (5%)")');
  const row = (id: number) => db.prepare('SELECT discount, discount_pct, subtotal, total FROM pharmacy_sales WHERE id = ?').get(id) as any;
  const pct = async (discount: number, discount_pct: any, rate = 100, qty = 3) => {
    const r = await sell(discount, { discount_pct }, rate, qty);
    if (!r.ok) throw new Error('sale refused: ' + (r as any).error);
    return (r as any).value ?? r;
  };
  const a = await pct(15, 5);                                            // ₹300 bill, 5% = ₹15
  eq(row(a.id).discount_pct, 5, '5% on a ₹300 bill is stored as 5%…');
  eq(row(a.id).discount, 15, '…with the rupees it comes to (₹15)');
  eq((await call('pharmacy:saleDetail', a.id)).discount_pct, 5, '…and the receipt gets it back from the sale\'s detail');
  eq(row((await pct(25, 7.5, 333.33, 1)).id).discount_pct, 7.5, '7.5% of ₹333.33 (₹25.00 after rounding) is kept as 7.5%');
  eq(row((await pct(33.33, 10, 333.33, 1)).id).discount_pct, 10, '10% of ₹333.33 (₹33.33) is kept as 10%');
  eq(row((await pct(20, undefined)).id).discount_pct, null, 'a discount typed in RUPEES carries no percentage…');
  eq(row((await pct(20, null)).id).discount_pct, null, '…whether it is sent as nothing or as null');
  eq(row((await pct(20, 5)).id).discount_pct, null, 'a "5%" label that does not match ₹20 on ₹300 is dropped — the bill shows only the rupees');
  eq(row((await pct(0, 5)).id).discount_pct, null, 'no discount, no percentage');
  eq(row((await pct(15, 'abc')).id).discount_pct, null, 'rubbish in the percentage field is ignored');
  eq(row((await pct(15, -5)).id).discount_pct, null, 'a negative percentage is ignored');
  eq(row((await pct(300, 100)).id).discount_pct, 100, '100% (the whole bill) is allowed');
  eq(row((await pct(15, 500)).id).discount_pct, null, 'more than 100% is never kept');
  eq(row((await pct(20, 5)).id).discount, 20, 'dropping the label never changes the rupees that were charged');
  eq(row(a.id).total, 285, 'the total is still the bill less the rupees (₹300 − ₹15)');
  ok((await call('pharmacy:saleDetail', (await pct(20, undefined)).id)).discount_pct == null, 'an old-style sale (no percentage) reads back as no percentage — nothing breaks for them');

  // ============================================================================================================
  section('5 · typing exactly your limit as a PERCENTAGE is never refused (the screen works the rupees out the way the main process does)');
  await call('settings:save', { require_login: true, pharmacy_discount_caps_json: JSON.stringify({ pharmacist: 10, receptionist: 5 }) });
  await call('auth:login', 'phil', 'pass1234');
  // sale values with half a paisa in them: 10% of ₹333.35 is ₹33.335 -> the screen offers ₹33.33 (never rounded up), which the 10% limit allows
  const cases: [number, number][] = [[1, 333.35], [3, 3.335], [7, 1.15], [13, 2.77], [2, 9.995], [1, 0.05], [9, 0.29], [11, 17.45]];
  for (const [qty, rate] of cases) {
    const subP = saleSubtotalPaise([{ qty, rate }]);
    const amountP = percentDiscountPaise(subP, 10);
    const r = await sell(fromPaise(amountP), { discount_pct: amountP > 0 ? 10 : null }, rate, qty);
    ok(r.ok, `10% of ${qty} × ₹${rate} (₹${fromPaise(subP).toFixed(2)}) = ₹${fromPaise(amountP).toFixed(2)} is accepted for a pharmacist limited to 10%${r.ok ? '' : ' — REFUSED: ' + (r as any).error.slice(0, 80)}`);
    if (r.ok && amountP > 0) eq(row((r as any).value.id).discount_pct, 10, `   …and it is remembered as 10%`);
  }
  // two lines, each rounded to the paisa before they are added (the receipt's way): 3 × 0.835 + 3 × 1.115
  const two = [{ qty: 3, rate: 0.835 }, { qty: 3, rate: 1.115 }];
  const subTwo = saleSubtotalPaise(two);
  const amountTwo = percentDiscountPaise(subTwo, 10);
  const rTwo = await attempt('pharmacy:sell', {
    client_ref: `cap-sale-two-${++n}`, payment_mode: 'Cash', discount: fromPaise(amountTwo), discount_pct: 10,
    items: two.map((l) => ({ drug_master_id: drug.id, drug_name: 'Cap Tablet', qty: l.qty, rate: l.rate })),
  });
  ok(rTwo.ok, `two lines adding up to ₹${fromPaise(subTwo).toFixed(2)}: 10% = ₹${fromPaise(amountTwo).toFixed(2)} is accepted${rTwo.ok ? '' : ' — REFUSED: ' + (rTwo as any).error.slice(0, 80)}`);
  ok(percentDiscountPaise(100000, 10.004) === 10000 && percentDiscountPaise(100000, 10.006) === 10010, 'a percentage is read to two decimals (10.004 -> 10%, 10.006 -> 10.01%)');
  ok(percentDiscountPaise(33335, 0) === 0 && percentDiscountPaise(5000, -3) === 0, 'no percentage, or a negative one, takes nothing off');
  await call('auth:logout');
  await call('settings:save', { require_login: false });

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
