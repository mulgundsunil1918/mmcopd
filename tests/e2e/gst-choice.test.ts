// GST is the clinic's decision — the software assumes nothing and never moves a rate by itself. The PHARMACY has its own GST switch,
// separate from the clinic's registration switch (it follows the clinic's until it is touched).
// Rules proved here, on the app's real handlers and a temporary database:
//   - there is no default GST for a new medicine until the clinic sets one ("Ask me every time" = null), and the setting round-trips;
//   - "Set GST %" changes ONLY what was asked: the ticked medicines, or every medicine now at one rate, or the whole list — nothing else, and only the rate;
//   - a rate that is not an Indian GST rate, an empty selection, or a role that may not do it is refused; a read-only licence blocks it;
//   - bills already made keep the tax they were made with; new sales use the new rate;
//   - the GST switch turns tax on and off on pharmacy sales, and flipping it never rewrites an existing bill;
//   - the pharmacy's switch is its OWN: pharmacy GST can be on while the clinic's is off and the other way round; untouched, it follows the
//     clinic's; a composition dealer never collects GST.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, section, finish } from './lib';
import { gstContext, pharmacyGstEnabled } from '../../src/main/gst';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const mk = (name: string, gst: number) => call('pharmacy:upsertDrug', { name: `${name} ${Date.now() % 100000}`, default_mrp: 100, gst_rate: gst, schedule: 'OTC', low_stock_threshold: 1 });
  const rateOf = (id: number) => one('SELECT gst_rate g FROM drug_master WHERE id=?', id).g as number;
  const summary = async () => new Map<number, number>((await call('pharmacy:gstSummary')).by_rate.map((r: any) => [r.rate, r.count]));

  // ============================================================================================================
  section('1 · nothing is assumed: the default for a new medicine is the clinic\'s own choice');
  const s0 = await call('settings:get');
  eq(s0.default_drug_gst_rate, null, 'a fresh clinic has not chosen one — the forms ask every time');
  eq((await call('settings:save', { default_drug_gst_rate: 5 })).default_drug_gst_rate, 5, 'the clinic can choose 5%');
  eq((await call('settings:get')).default_drug_gst_rate, 5, '…and it is remembered');
  eq((await call('settings:save', { default_drug_gst_rate: 0 })).default_drug_gst_rate, 0, 'a choice of 0% is a choice (not "unset")');
  eq((await call('settings:save', { default_drug_gst_rate: null })).default_drug_gst_rate, null, 'and "Ask me every time" puts it back to undecided');

  // ============================================================================================================
  section('2 · "Set GST %" does exactly what it is told');
  const a = await mk('GstA', 12), b = await mk('GstB', 12), c = await mk('GstC', 5), d = await mk('GstD', 18);
  const before = await summary();
  ok((before.get(12) ?? 0) >= 2 && (before.get(5) ?? 0) >= 1 && (before.get(18) ?? 0) >= 1, 'the summary counts medicines at each rate');
  const stamp = (id: number) => one('SELECT updated_at u FROM drug_master WHERE id=?', id).u;
  // (a) only the ticked ones
  const t1 = await call('pharmacy:setDrugGst', { rate: 5, ids: [a.id] });
  ok(t1.ok && t1.changed === 1, 'the one ticked medicine changes');
  ok(rateOf(a.id) === 5 && rateOf(b.id) === 12 && rateOf(c.id) === 5 && rateOf(d.id) === 18, '…and no other medicine moves');
  const t1b = await call('pharmacy:setDrugGst', { rate: 5, ids: [a.id, c.id] });
  ok(t1b.ok && t1b.changed === 0 && t1b.unchanged === 2, 'ticking two that are already at 5% changes nothing and says so');
  // (b) everything now at one rate
  const at12 = (await summary()).get(12) ?? 0;
  const t2 = await call('pharmacy:setDrugGst', { rate: 5, from_rate: 12 });
  ok(t2.ok && t2.changed === at12 && at12 >= 1, `every medicine at 12% moves to 5% (${t2.changed} of them)`);
  ok(rateOf(b.id) === 5 && rateOf(d.id) === 18, '…the one at 18% stays at 18%');
  eq((await summary()).get(12) ?? 0, 0, 'nothing is left at 12%');
  // (c) the whole list
  const total = (await call('pharmacy:gstSummary')).total;
  const t3 = await call('pharmacy:setDrugGst', { rate: 0 });
  ok(t3.ok && t3.changed + t3.unchanged === all('SELECT 1 FROM drug_master').length, 'the whole list can be set at once (every row is in scope)');
  eq((await summary()).get(0), total, '…and every active medicine is now at 0%');
  await call('pharmacy:setDrugGst', { rate: 5, from_rate: 0 });
  const e = one('SELECT name, generic_name, default_mrp, schedule, low_stock_threshold, is_active FROM drug_master WHERE id=?', c.id);
  ok(e.default_mrp === 100 && e.schedule === 'OTC' && e.low_stock_threshold === 1 && e.is_active === 1, 'only the GST rate changed — price, schedule, level and flags are as they were');
  ok(stamp(a.id) !== null, 'the row records when it was changed');

  // ============================================================================================================
  section('3 · what is refused');
  const bad = await call('pharmacy:setDrugGst', { rate: 7, ids: [a.id] });
  ok(!bad.ok && /GST rate/i.test(bad.error), `an unusual rate is refused ("${bad.error}")`);
  const badFrom = await call('pharmacy:setDrugGst', { rate: 5, from_rate: 9 });
  ok(!badFrom.ok, 'so is an unusual rate to change FROM');
  const none = await call('pharmacy:setDrugGst', { rate: 5, ids: [] });
  ok(!none.ok && /tick at least one/i.test(none.error), 'an empty selection is refused (it would otherwise mean "everything")');
  eq(rateOf(a.id), 5, '…and nothing moved');
  await call('auth:createUser', { username: 'rita', password: 'pass1234', role: 'receptionist', display_name: 'Rita' });
  await call('auth:createUser', { username: 'pia', password: 'pass1234', role: 'pharmacist', display_name: 'Pia' });
  await call('settings:save', { require_login: true });
  await call('auth:login', 'rita', 'pass1234');
  const asRecep = await attempt('pharmacy:setDrugGst', { rate: 18, ids: [a.id] });
  ok(!asRecep.ok && /not allowed/i.test((asRecep as any).error), 'a receptionist cannot change GST rates');
  await call('auth:logout');
  await call('auth:login', 'pia', 'pass1234');
  const asPharm = await attempt('pharmacy:setDrugGst', { rate: 18, ids: [a.id] });
  ok(asPharm.ok && (asPharm as any).value.changed === 1, 'the pharmacist can');
  await call('pharmacy:setDrugGst', { rate: 5, ids: [a.id] });
  await call('auth:logout');
  await call('auth:login', 'admin', 'admin123');
  setReadOnlyMode(true);
  const ro = await attempt('pharmacy:setDrugGst', { rate: 18, ids: [a.id] });
  ok(!ro.ok, 'with an expired licence (read-only) it is blocked');
  setReadOnlyMode(false);
  await call('auth:logout');
  await call('settings:save', { require_login: false });
  ok(one("SELECT 1 x FROM audit_log WHERE action='drug.gst_set'"), 'every bulk change is written to the audit log');

  // ============================================================================================================
  section('4 · a bill already made keeps its tax; the GST switch turns tax on and off');
  const sup = await call('wholesalers:upsert', { name: 'Gst Supplies', drug_license_no: 'DL-GST' });
  const g = await mk('GstSell', 12);
  await call('purchase:create', { client_ref: 'gst-pur', invoice_number: 'GST-1', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: g.id, batch_no: 'G1', expiry: '2031-01-01', qty_received: 100, purchase_price: 50, mrp: 112, gst_rate: 12 }] });
  await call('settings:save', { gst_enabled: true, gst_registration_type: 'regular' });
  const sale1 = await call('pharmacy:sell', { client_ref: 'gst-sale-1', items: [{ drug_master_id: g.id, drug_name: g.name, qty: 1, rate: 112 }], payment_mode: 'Cash' });
  const line1 = () => one('SELECT gst_rate r, cgst, sgst FROM pharmacy_sale_items WHERE sale_id=?', sale1.id);
  ok(line1().r === 12 && Math.abs(line1().cgst + line1().sgst - 12) < 0.02, 'with GST ON the sale carries its 12% inside the ₹112 MRP (₹12 of tax)');
  await call('pharmacy:setDrugGst', { rate: 5, ids: [g.id] });
  ok(line1().r === 12 && Math.abs(line1().cgst + line1().sgst - 12) < 0.02, 'changing the medicine to 5% does not rewrite the bill already made');
  const sale2 = await call('pharmacy:sell', { client_ref: 'gst-sale-2', items: [{ drug_master_id: g.id, drug_name: g.name, qty: 1, rate: 112 }], payment_mode: 'Cash' });
  const line2 = one('SELECT gst_rate r, cgst, sgst FROM pharmacy_sale_items WHERE sale_id=?', sale2.id);
  ok(line2.r === 5 && Math.abs(line2.cgst + line2.sgst - 112 * 5 / 105) < 0.02, 'a new sale uses the new 5% rate');
  await call('settings:save', { gst_enabled: false });
  const sale3 = await call('pharmacy:sell', { client_ref: 'gst-sale-3', items: [{ drug_master_id: g.id, drug_name: g.name, qty: 1, rate: 112 }], payment_mode: 'Cash' });
  const line3 = one('SELECT gst_rate r, cgst, sgst FROM pharmacy_sale_items WHERE sale_id=?', sale3.id);
  ok(!(line3.r > 0) && !(line3.cgst > 0) && !(line3.sgst > 0), 'with GST switched OFF a sale carries no GST at all');
  ok(line1().r === 12 && line2.r === 5, '…and switching it off did not touch the two bills already made');
  const lastPur = await call('purchase:create', { client_ref: 'gst-pur-2', invoice_number: 'GST-2', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: g.id, batch_no: 'G2', expiry: '2031-01-01', qty_received: 10, purchase_price: 50, mrp: 112, gst_rate: 5 }] });
  eq(lastPur.invoice.gst_in_cost, 1, 'with GST off the GST on a purchase becomes part of the stock cost');
  await call('settings:save', { gst_enabled: true });
  const onPur = await call('purchase:create', { client_ref: 'gst-pur-3', invoice_number: 'GST-3', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: g.id, batch_no: 'G3', expiry: '2031-01-01', qty_received: 10, purchase_price: 50, mrp: 112, gst_rate: 5 }] });
  eq(onPur.invoice.gst_in_cost, 0, 'with GST on it is claimed back, so it is not part of the cost');
  await call('settings:save', { gst_enabled: false, gst_registration_type: 'unregistered' });

  // ============================================================================================================
  section('5 · the pharmacy has its OWN GST switch');
  const sold = async (ref: string) => {
    const sale = await call('pharmacy:sell', { client_ref: ref, items: [{ drug_master_id: g.id, drug_name: g.name, qty: 1, rate: 105 }], payment_mode: 'Cash' });
    const l = one('SELECT gst_rate r, cgst, sgst FROM pharmacy_sale_items WHERE sale_id=?', sale.id);
    return { taxed: l.r > 0 && l.cgst + l.sgst > 0, tax: Math.round((l.cgst + l.sgst) * 100) / 100, invoice: one('SELECT is_tax_invoice t FROM pharmacy_sales WHERE id=?', sale.id).t === 1 };
  };
  const buyRef = (n: number) => call('purchase:create', { client_ref: `own-${n}`, invoice_number: `OWN-${n}`, wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: g.id, batch_no: `O${n}`, expiry: '2031-01-01', qty_received: 10, purchase_price: 50, mrp: 112, gst_rate: 5 }] });
  await call('pharmacy:setDrugGst', { rate: 5, ids: [g.id] });
  eq((await call('settings:get')).pharmacy_gst_enabled, null, 'a clinic that never pressed the pharmacy button has no choice recorded (null = follow the clinic)');
  ok(!pharmacyGstEnabled(db), 'with the clinic switch off and the pharmacy untouched, the pharmacy charges no GST');
  await call('settings:save', { gst_enabled: true, gst_registration_type: 'regular' });
  ok(pharmacyGstEnabled(db), '…untouched, it follows the clinic switch ON');
  const followed = await sold('own-sale-1');
  ok(followed.taxed && followed.invoice, 'so a sale carries its GST (a tax invoice)');
  await call('settings:save', { pharmacy_gst_enabled: false });
  ok(gstContext(db).enabled, 'the clinic switch is still ON (consultations and wards are not touched)…');
  ok(!pharmacyGstEnabled(db), '…while the pharmacy switch is OFF');
  const off = await sold('own-sale-2');
  ok(!off.taxed && !off.invoice, 'a pharmacy sale carries no GST at all');
  eq((await buyRef(1)).invoice.gst_in_cost, 1, '…and the GST on a purchase becomes part of the stock cost');
  await call('settings:save', { gst_enabled: false, pharmacy_gst_enabled: true });
  ok(!gstContext(db).enabled && pharmacyGstEnabled(db), 'the other way round: clinic switch OFF, pharmacy switch ON');
  const on = await sold('own-sale-3');
  ok(on.taxed && on.invoice && Math.abs(on.tax - 105 * 5 / 105) < 0.02, `the pharmacy sale carries its 5% inside the MRP (₹${on.tax})`);
  eq((await buyRef(2)).invoice.gst_in_cost, 0, '…and the GST on a purchase is claimed back, not part of the cost');
  await call('settings:save', { gst_enabled: false, gst_registration_type: 'composition', pharmacy_gst_enabled: true });
  ok(!pharmacyGstEnabled(db), 'a composition dealer never collects GST, even with the pharmacy switch ON');
  ok(!(await sold('own-sale-4')).taxed, '…so the sale carries none');
  await call('settings:save', { pharmacy_gst_enabled: null, gst_enabled: false, gst_registration_type: 'unregistered' });
  eq((await call('settings:get')).pharmacy_gst_enabled, null, 'putting the switch back to "follow the clinic" is possible (null)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
