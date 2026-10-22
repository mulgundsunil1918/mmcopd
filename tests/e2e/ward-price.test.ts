// A medicine charged to an in-patient's bill is priced at the SELLING price of the batch it comes out of (that batch's own selling price,
// else its MRP) — decided by the main process, so the rate a screen sends cannot change it. A line whose units span batches with different
// prices is priced unit by unit. An ordinary counter sale still honours the rate typed. Real handlers on a temporary database.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  await call('settings:save', { bill_round_off: false, gst_enabled: false, pharmacy_ipd_charge_enabled: true, ipd_auto_accrue_bed: false, ipd_auto_accrue_nursing: false, ipd_auto_accrue_doctor_visit: false });
  const doc = await call('doctors:create', { name: 'Dr. Ward', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Wanda', last_name: 'Ward', dob: '1970-03-03', gender: 'F', phone: '9300000001' });
  const ward = await call('wards:save', { name: 'General', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bed = await call('beds:save', { ward_id: ward.id, bed_number: 'W-1' });
  const adm = await call('ip:admitV2', { patient_id: pat.id, bed_id: bed.id, admission_doctor_id: doc.id, performed_by: 'tester' });
  ok(adm.ok, 'an in-patient is admitted');
  const sup = await call('wholesalers:upsert', { name: 'Ward Supplies', drug_license_no: 'DL-WARD' });
  const tab = await call('pharmacy:upsertDrug', { name: 'Ward Tab 100', default_mrp: 100, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  const syr = await call('pharmacy:upsertDrug', { name: 'Ward Syrup 5', default_mrp: 60, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  const pur = await call('purchase:create', {
    client_ref: 'ward-pur', invoice_number: 'WARD-1', wholesaler_id: sup.id, invoice_date: day(0),
    items: [
      { drug_master_id: tab.id, batch_no: 'T-EARLY', expiry: day(120), qty_received: 5, purchase_price: 60, mrp: 100, selling_price: 90 },   // sells at ₹90
      { drug_master_id: tab.id, batch_no: 'T-LATE', expiry: day(400), qty_received: 10, purchase_price: 60, mrp: 100 },                     // no selling price → its MRP, ₹100
      { drug_master_id: syr.id, batch_no: 'S-A', expiry: day(100), qty_received: 3, purchase_price: 30, mrp: 60, selling_price: 50 },
      { drug_master_id: syr.id, batch_no: 'S-B', expiry: day(300), qty_received: 10, purchase_price: 30, mrp: 60 },
    ],
  });
  ok(pur.ok, 'two drugs, each with an earlier batch at a selling price below MRP and a later batch at MRP');
  let n = 0;
  const admissionId = (one('SELECT id FROM ip_admissions WHERE patient_id=? ORDER BY id DESC LIMIT 1', pat.id)).id as number;
  const charge = (items: any[], extra: Record<string, any> = {}) => attempt('pharmacy:sell', { patient_id: pat.id, ipd_admission_id: admissionId, items, client_ref: `ward-${++n}`, ...extra });
  const wardLines = () => q("SELECT description, qty, rate, amount FROM bill_items WHERE source='pharmacy_ipd' ORDER BY id");
  const stock = (id: number) => Number(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', id).s);

  // ============================================================================================================
  section('1 · the rate typed on the screen is ignored — the batch decides');
  const r1 = await charge([{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 2, rate: 1 }]);       // someone types ₹1 (the batch sells at ₹90)
  ok(r1.ok, `charged to the in-patient bill (${r1.ok ? '' : (r1 as any).error})`);
  near((r1 as any).value.total, 180, '2 units are charged at the batch selling price: 2 × ₹90 = ₹180, not 2 × ₹1');
  eq(wardLines().length, 1, 'one line on the bill');
  ok(wardLines()[0].rate === 90 && wardLines()[0].amount === 180, '…at ₹90 each');
  eq((r1 as any).value.repriced_lines, 1, 'the sale notes that one line was re-priced');
  const typedHigh = await charge([{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 1, rate: 500 }]);
  near((typedHigh as any).value.total, 90, 'a rate typed ABOVE the batch price is ignored too (₹500 typed → ₹90 charged)');
  const exact = await charge([{ drug_master_id: syr.id, drug_name: 'Ward Syrup 5', qty: 1, rate: 50 }]);
  near((exact as any).value.total, 50, 'a line already at the batch price is charged as it is…');
  ok((exact as any).value.repriced_lines === undefined, '…and nothing is flagged as re-priced');

  // ============================================================================================================
  section('2 · units from batches with different prices are priced one by one');
  // tablets: the early batch has 5 − 3 = 2 left; ask for 5 → 2 at ₹90 from it, then 3 at ₹100 from the later batch
  eq(stock(tab.id), 15 - 3, 'tablet stock after the first charges: 12 (2 left in the early batch + 10)');
  const before = wardLines().length;
  const span = await charge([{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 5, rate: 90 }]);
  ok(span.ok, 'a line that spans two batches is charged');
  near((span as any).value.total, 2 * 90 + 3 * 100, '2 × ₹90 + 3 × ₹100 = ₹480');
  const added = wardLines().slice(before);
  eq(added.map((l) => `${l.qty}@${l.rate}`).join(' + '), '2@90 + 3@100', 'the bill shows it as two lines, one per price');
  const reg = q("SELECT batch_no, qty, rate FROM dispensing_register WHERE sale_id=? ORDER BY id", (span as any).value.id);
  eq(reg.map((r) => `${r.batch_no}:${r.qty}@${r.rate}`).join(', '), 'T-EARLY:2@90, T-LATE:3@100', 'the dispensing register agrees, batch by batch');
  eq(one("SELECT COUNT(*) c FROM pharmacy_sale_items WHERE sale_id=?", (span as any).value.id).c, 2, '…and the sale has one line per price');

  section('3 · two lines for the same drug in one request share the stock');
  // syrup: early batch has 3 − 1 = 2 left @₹50, later batch 10 @₹60. Two lines of 2 each → 2@50 ; then 2@60
  const two = await charge([
    { drug_master_id: syr.id, drug_name: 'Ward Syrup 5', qty: 2, rate: 60 },
    { drug_master_id: syr.id, drug_name: 'Ward Syrup 5', qty: 2, rate: 60 },
  ]);
  ok(two.ok, 'two lines of the same drug are charged');
  near((two as any).value.total, 2 * 50 + 2 * 60, 'the second line starts where the first one stopped: ₹100 + ₹120');
  eq(stock(syr.id), 13 - 1 - 4, 'and stock fell by exactly what was charged');

  // ============================================================================================================
  section('4 · what is NOT changed');
  const counter = await attempt('pharmacy:sell', { client_ref: 'counter-1', items: [{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 1, rate: 95 }], payment_mode: 'Cash' });
  near((counter as any).value.total, 95, 'an ordinary counter sale still honours the rate typed');
  const typedName = await charge([{ drug_name: 'Hand-typed syrup', qty: 1, rate: 1 }]);
  ok(!typedName.ok && /not picked from your medicine list/i.test((typedName as any).error), 'a ward line that is only a typed name (no stock to price it from) is refused, so the lock cannot be sidestepped');
  const stockBefore = stock(tab.id), linesBefore = wardLines().length;
  const short = await charge([{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 1000, rate: 90 }]);
  ok(!short.ok && /insufficient stock/i.test((short as any).error) && /short by/i.test((short as any).error), `a shortage is still refused in the usual words (${(short as any).error?.slice(0, 70)})`);
  eq(stock(tab.id), stockBefore, '…taking no stock');
  eq(wardLines().length, linesBefore, '…and adding no line to the bill');
  const ref = 'ward-retry';
  const a = await attempt('pharmacy:sell', { patient_id: pat.id, ipd_admission_id: admissionId, items: [{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 1, rate: 90 }], client_ref: ref });
  const b = await attempt('pharmacy:sell', { patient_id: pat.id, ipd_admission_id: admissionId, items: [{ drug_master_id: tab.id, drug_name: 'Ward Tab 100', qty: 1, rate: 90 }], client_ref: ref });
  ok(a.ok && b.ok && (a as any).value.id === (b as any).value.id, 'sending the same charge twice is still one sale');
  eq(q("SELECT 1 FROM pharmacy_sales WHERE client_ref=?", ref).length, 1, '…recorded once');

  const aud = one("SELECT details FROM audit_log WHERE action='pharmacy.ipd_charge' ORDER BY id LIMIT 1");
  ok(/repriced_lines/.test(aud?.details ?? ''), 'the audit log records that a charge was re-priced');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
