// In-patient money: admission with an advance, daily bed + nursing charges, a ward medicine (stock + bill),
// payments, discharge approval, how the advance is used, and refunds. Synthetic data.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish, note } from './lib';

boot();
const q = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => getDb().prepare(sql).get(...p) as any;
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  await call('settings:save', { ipd_advance_enabled: true });
  const ward = await call('wards:save', { name: 'General', ward_type: 'general', per_day_rate: 1000, nursing_per_day: 200 });
  const bed = await call('beds:save', { ward_id: ward.id, bed_number: 'G-1' });
  const bed2 = await call('beds:save', { ward_id: ward.id, bed_number: 'G-2' });
  const doc = await call('doctors:create', { name: 'Dr. Ward', specialty: 'GP', default_fee: 500 });
  const pat = await call('patients:create', { first_name: 'Ira', last_name: 'Ward', dob: '1975-01-01', gender: 'F', phone: '9555555555' });
  const pat2 = await call('patients:create', { first_name: 'Omar', last_name: 'Ward', dob: '1960-01-01', gender: 'M', phone: '9555555556' });

  section('admission');
  const adm = await call('ip:admitV2', { patient_id: pat.id, bed_id: bed.id, admission_doctor_id: doc.id, advance_amount: 5000, advance_mode: 'Cash', performed_by: 'tester' });
  ok(adm.ok, `admitted (${adm.admission_number})`);
  const again = await call('ip:admitV2', { patient_id: pat.id, bed_id: bed2.id, admission_doctor_id: doc.id });
  ok(again.ok === false && /already admitted/.test(again.error), 'the same patient cannot be admitted twice');
  const taken = await call('ip:admitV2', { patient_id: pat2.id, bed_id: bed.id });
  ok(taken.ok === false && /already occupied by Ira Ward/.test(taken.error), `a second patient on an occupied bed is refused in plain words (${taken.ok ? 'ACCEPTED' : taken.error})`);
  eq(one('SELECT status FROM beds WHERE id=?', bed.id).status, 'occupied', 'the bed shows occupied');
  const advs = await call('advances:list', adm.id);
  ok(advs.ok && advs.rows.length === 1, 'the advance receipt list loads');
  eq(advs.rows[0]?.amount, 5000, '…₹5,000 held');
  eq(advs.rows[0]?.refundable, 5000, '…all of it refundable so far');
  eq(advs.rows[0]?.mode, 'Cash', '…with its payment mode');

  section('stay charges and a ward medicine');
  let prev = await call('bill:previewAdmission', adm.id);
  eq(prev.totals.total, 1200, 'bill after day 1: bed ₹1,000 + nursing ₹200');
  const again2 = await call('bill:previewAdmission', adm.id);
  eq(again2.totals.total, 1200, 'previewing the bill again does not charge the day twice');
  const sup = await call('wholesalers:upsert', { name: 'IPD Supplier', drug_license_no: 'DL-I' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Ward Injection', default_mrp: 50, gst_rate: 0, schedule: 'OTC' });
  const pur = await call('purchase:create', { invoice_number: 'IPD-1', wholesaler_id: sup.id, invoice_date: new Date().toISOString().slice(0, 10), items: [{ drug_master_id: drug.id, batch_no: 'W1', expiry: '2030-01-01', qty_received: 20, purchase_price: 30, mrp: 50 }] });
  ok(pur.ok, 'ward stock purchased: 20 @ ₹30 cost, MRP ₹50');
  const order = await call('ip:medOrderAdd', adm.id, { drug_master_id: drug.id, drug_name: 'Ward Injection', dose: '1 amp', route: 'IV', frequency: 'BD', ordered_by_doctor_id: doc.id });
  ok(order.ok, 'medication ordered');
  const give = await call('ip:medAdminGive', order.id, { status: 'given', qty: 2, administered_by: 'nurse1' });
  ok(give.ok && give.billed === true, 'giving 2 doses is billed');
  eq(one('SELECT SUM(qty_remaining) s FROM drug_stock_batches WHERE drug_master_id=?', drug.id).s, 18, 'and 2 units leave stock (20 → 18)');
  prev = await call('bill:previewAdmission', adm.id);
  eq(prev.totals.total, 1300, 'bill = 1,200 + 2 × ₹50');
  const reg = q('SELECT unit_cost, qty FROM dispensing_register WHERE drug_master_id=?', drug.id);
  ok(reg.length === 1 && reg[0].unit_cost === 30 && reg[0].qty === 2, 'the dispensing register froze the cost (₹30) on the ward sale');
  const refused = await call('ip:medAdminGive', order.id, { status: 'given', qty: 1000, administered_by: 'nurse1' });
  ok(refused.ok === false && /Only 18/.test(refused.error), 'giving more than is in stock is refused, with the stock quantity in the message');
  eq(one('SELECT SUM(qty_remaining) s FROM drug_stock_batches WHERE drug_master_id=?', drug.id).s, 18, '…stock unchanged');

  section('payments and the advance');
  eq(prev.advanceAvailable, 5000, 'the ₹5,000 advance counts towards the bill');
  eq(prev.balanceDue, -3700, 'balance = 1,300 − advance 5,000 = −₹3,700: the advance covers the bill and ₹3,700 is the patient\'s credit');
  const billId = prev.bill.id;
  const over = await call('bill:pay', billId, 100, 'Cash', 'tester');
  ok(over.ok === false, 'paying cash against a bill the advance already covers is refused (no double collection)');
  const bad = await call('ip:dischargeV2', adm.id, { outcome: 'nonsense' });
  ok(bad.ok === false, 'an invalid discharge outcome is refused');

  section('discharge');
  const noReq = await call('ip:approveDischarge', adm.id, { by: 'mgr' });
  ok(noReq.ok === false && /requested/.test(noReq.error), 'approving before the doctor has requested discharge is refused');
  const rq = await call('ip:requestDischarge', adm.id, { outcome: 'discharged' }, 'dr');
  ok(rq.ok, 'the doctor requests discharge');
  const ap = await call('ip:approveDischarge', adm.id, { by: 'mgr' });
  ok(ap.ok, `discharge approved (${JSON.stringify({ total: ap.total, balanceDue: ap.balanceDue })})`);
  const fin = one('SELECT * FROM bills WHERE id=?', billId);
  eq(fin.status, 'paid', 'the final bill is settled');
  ok(!!fin.finalized_at, '…and frozen');
  eq(fin.advance_adjusted, 1300, '…using ₹1,300 of the advance');
  eq(one('SELECT status FROM ip_admissions WHERE id=?', adm.id).status, 'discharged', 'admission closed');
  eq(one('SELECT status FROM beds WHERE id=?', bed.id).status, 'cleaning', 'the bed goes to cleaning');
  const noAdd = await call('bill:addItem', billId, { description: 'late charge', qty: 1, rate: 10 }, 'x');
  ok(noAdd.ok === false, 'a frozen/settled bill takes no further lines');

  section('refund of the unused advance');
  const adv2 = await call('advances:list', adm.id);
  eq(adv2.rows[0].refundable, 3700, '₹5,000 − ₹1,300 used = ₹3,700 refundable');
  const tooMuch = await call('advances:refund', adv2.rows[0].id, 3701, 'balance returned', 'mgr');
  ok(tooMuch.ok === false, 'refunding more than is left is refused');
  const noReason = await call('advances:refund', adv2.rows[0].id, 100, '', 'mgr');
  ok(noReason.ok === false, 'a refund needs a recorded reason');
  const good = await call('advances:refund', adv2.rows[0].id, 3700, 'balance returned at discharge', 'mgr');
  ok(good.ok && good.remaining === 0, '₹3,700 refunded');
  const twice = await call('advances:refund', adv2.rows[0].id, 1, 'again', 'mgr');
  ok(twice.ok === false, 'a second refund of the same money is refused');

  section('reports');
  const b = await call('analytics:billing', '2000-01-01', '2100-01-01');
  ok(b.ok, 'IPD billing analytics loads');
  near(b.advances.collected, 5000, 'analytics: advances collected ₹5,000');
  near(b.advances.refunded, 3700, '…refunded ₹3,700');
  near(b.advances.adjusted, 1300, '…adjusted against bills ₹1,300');
  near(b.advances.held, 0, '…nothing held any more');
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
