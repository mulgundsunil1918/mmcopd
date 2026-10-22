// A limit on the discount a person may give at the PHARMACY COUNTER, by role (Settings → Billing & IPD → Discounts → "At the pharmacy
// counter"). The rule lives in the main process: the limit comes from WHO IS SIGNED IN, never from what a screen sends; a role with no
// number is not limited (so an update changes nothing for a clinic that never set one); admin is never limited; a broken setting
// must not grant more than the owner meant. Real handlers on a temporary database.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, section, finish } from './lib';

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

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
