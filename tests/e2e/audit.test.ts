// Randomised money-consistency audit — through the app's REAL IPC handlers on a temporary database. Synthetic data only.
//
// Hundreds of random actions across EVERY way money is billed (OPD, Quick Bill, Services, Lab, Radiology, pharmacy counter,
// credit, in-patient bills with medicines/discounts/payments/transfers/discharge), with settings flipped part-way (GST on/off,
// round-off, in-patient GST). After each batch it checks, against INDEPENDENT arithmetic written here, that:
//   · nothing is negative; looking at a bill (preview/print) never changes what it says;
//   · each bill's parts add up (exempt + taxable + CGST + SGST + round-off = total);
//   · what is received never exceeds what is billed, and "still owed" equals an independent sum;
//   · stock equals what was bought less what was sold; every sold unit is in the dispensing register;
//   · the GST figures, the module P&L and the money collected equal independent sums.
// A failure prints the seed and the last actions so it can be replayed exactly.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish, note } from './lib';
import { localISO } from '../../src/lib/localDate';

boot();
const db = () => getDb();
const q = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const today = localISO();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const P = (n: number) => Math.round(n * 100);          // paise

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

(async () => {
  const SEEDS = [11, 2026, 90210];
  const OPS = 300;
  const log: string[] = [];
  let failures = 0;

  // ------------------------------------------------------------------------------------------------ world
  await call('settings:save', {
    bill_round_off: true, gst_enabled: true, gst_registration_type: 'regular', clinic_gstin: '29ABCDE1234F1Z5', clinic_state_code: '29',
    ipd_gst_enabled: true, pharmacy_credit_enabled: true, pharmacy_ipd_charge_enabled: true, ipd_advance_enabled: true,
  });
  const doc = await call('doctors:create', { name: 'Dr. Audit', specialty: 'GP', default_fee: 300 });
  const pats: any[] = [];
  for (let i = 0; i < 10; i++) pats.push(await call('patients:create', { first_name: `Aud${i}`, last_name: 'Fuzz', dob: '1980-01-01', gender: i % 2 ? 'F' : 'M', phone: `97000000${i}0` }));
  const ward = await call('wards:save', { name: 'Audit Ward', ward_type: 'general', per_day_rate: 800, nursing_per_day: 150 });
  const ward2 = await call('wards:save', { name: 'Audit ICU', ward_type: 'icu', per_day_rate: 2500, nursing_per_day: 400 });
  const beds: any[] = [];
  for (let i = 1; i <= 5; i++) beds.push(await call('beds:save', { ward_id: ward.id, bed_number: `A-${i}` }));
  const icuBeds: any[] = [];
  for (let i = 1; i <= 5; i++) icuBeds.push(await call('beds:save', { ward_id: ward2.id, bed_number: `I-${i}` }));
  const sup = await call('wholesalers:upsert', { name: 'Audit Supplies', drug_license_no: 'DL-AUD' });
  const drugDefs = [{ n: 'Aud Zero', mrp: 10, gst: 0 }, { n: 'Aud Five', mrp: 105, gst: 5 }, { n: 'Aud Twelve', mrp: 112, gst: 12 }, { n: 'Aud Eighteen', mrp: 118.5, gst: 18 }];
  const drugs: any[] = [];
  for (const d of drugDefs) drugs.push({ ...d, ...(await call('pharmacy:upsertDrug', { name: d.n, default_mrp: d.mrp, gst_rate: d.gst, schedule: 'OTC', low_stock_threshold: 5 })) });
  const INITIAL = 3000;
  await call('purchase:create', { client_ref: 'aud-pur', invoice_number: 'AUD-1', wholesaler_id: sup.id, invoice_date: today,
    items: drugs.map((d) => ({ drug_master_id: d.id, batch_no: `B${d.id}`, expiry: '2031-01-31', qty_received: INITIAL, purchase_price: r2(d.mrp * 0.6), mrp: d.mrp, gst_rate: d.gst })) });
  const labT: any[] = [];
  for (const [n, pr] of [['Aud CBC', 300], ['Aud LFT', 499.5], ['Aud Lipid', 650.25], ['Aud TSH', 275]] as [string, number][]) labT.push(await call('lab:upsertTest', { name: n, price: pr, category: 'haematology', sample_type: 'Blood' }));
  const radT: any[] = [];
  for (const [n, pr] of [['Aud X-ray', 700], ['Aud USG', 1250.5]] as [string, number][]) radT.push((await call('radiology:upsertTest', { name: n, modality: 'xray', price: pr })).test);
  const taxHead = await call('chargeHeads:save', { name: 'Aud Taxable Procedure', category: 'procedure', default_rate: 1000, gst_rate: 18, is_taxable: true, applies_to: 'both' });

  // ------------------------------------------------------------------------------------------------ the actions
  const admitted: { adm: number; pat: any; bed: any }[] = [];
  const creditSales: number[] = [];
  const allBills = () => q('SELECT id FROM bills').map((r) => r.id);

  async function doOp(rnd: () => number, i: number) {
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const money = () => pick([0, 50, 99.5, 120, 250, 333.33, 499.99, 612.4, 1000, 1500.75]);
    const pat = pick(pats);
    const w = rnd();
    const desc = (s: string) => { log.push(`#${i} ${s}`); if (log.length > 40) log.shift(); };
    if (w < 0.12) {                                                                    // OPD consultation bill
      const n = 1 + Math.floor(rnd() * 2);
      const items = Array.from({ length: n }, (_, k) => { const r = money() || 100; const qty = pick([1, 1, 2]); return { description: `Consult ${k}`, qty, rate: r, amount: r2(r * qty) }; });
      const sub = items.reduce((s, x) => s + x.amount, 0);
      const dt = pick(['flat', 'percent', 'flat']); const disc = pick([0, 0, 10, 15, 7.5]);
      desc(`opd ${items.length} lines sub=${sub} disc=${disc}${dt}`);
      await attempt('bills:create', { appointment_id: null, patient_id: pat.id, items, discount: dt === 'percent' ? disc : Math.min(disc, sub), discount_type: dt, payment_mode: pick(['Cash', 'UPI', 'Card']) });
    } else if (w < 0.22) {                                                              // Quick Bill
      const type = pick(['opd_consult', 'pharmacy', 'lab', 'radiology', 'custom']);
      const items = [{ description: 'Quick item', qty: pick([1, 2]), rate: money() || 80, gst_rate: rnd() < 0.3 ? 18 : 0, is_taxable: false }];
      (items[0] as any).is_taxable = items[0].gst_rate > 0;
      desc(`quick ${type} paid=${rnd() < 0.5}`);
      await attempt('bill:createStandalone', { patient_id: rnd() < 0.8 ? pat.id : null, patient_name: 'Walk In', bill_type: type, items, payment_mode: pick(['Cash', 'UPI']), paid_now: rnd() < 0.6 });
    } else if (w < 0.30) {                                                              // Service / procedure
      desc('service');
      await attempt('misc:create', { patient_id: pat.id, doctor_id: doc.id, description: pick(['Injection', 'Dressing', 'Vaccination']), amount: money() || 150, payment_mode: pick(['Cash', 'UPI']) });
    } else if (w < 0.40) {                                                              // Lab order + part/full payment
      const tests = [...labT].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
      desc(`lab ${tests.length} tests`);
      const o = await attempt('lab:createOrder', { appointment_id: null, patient_id: pat.id, doctor_id: doc.id, items: tests.map((t) => ({ lab_test_id: t.id, test_name: t.name })) });
      if (o.ok) {
        const b = one('SELECT * FROM bills WHERE lab_order_id=?', (o.value as any).id);
        if (b && rnd() < 0.7) { const amt = rnd() < 0.5 ? b.total : r2(b.total * 0.4); await attempt('bill:pay', b.id, amt, 'Cash', 'tester', `lab-${i}`); }
        if (b && rnd() < 0.3) await attempt('lab:addOrderItems', (o.value as any).id, [{ lab_test_id: labT[0].id, test_name: labT[0].name }]);
      }
    } else if (w < 0.48) {                                                              // Radiology order
      desc('radiology');
      const o = await attempt('radiology:createOrder', { patient_id: pat.id, doctor_id: doc.id, items: [{ test_id: pick(radT).id }] });
      if (o.ok) { const b = one('SELECT * FROM bills WHERE radiology_order_id=?', (o.value as any).order?.id); if (b && rnd() < 0.7) await attempt('bill:pay', b.id, rnd() < 0.5 ? b.total : r2(b.total / 2), 'UPI', 'tester', `rad-${i}`); }
    } else if (w < 0.66) {                                                              // pharmacy sale (counter / credit / in-patient charge)
      const dr = pick(drugs); const dr2 = pick(drugs);
      const items = [{ drug_master_id: dr.id, drug_name: dr.n, qty: 1 + Math.floor(rnd() * 4), rate: dr.mrp }, ...(rnd() < 0.4 ? [{ drug_master_id: dr2.id, drug_name: dr2.n, qty: 1 + Math.floor(rnd() * 3), rate: dr2.mrp }] : [])];
      const sub = r2(items.reduce((s, x) => s + x.qty * x.rate, 0));
      const how = rnd();
      const payload: any = { items, client_ref: `aud-sale-${i}`, payment_mode: pick(['Cash', 'UPI', 'Card']), discount: rnd() < 0.25 ? r2(sub * pick([0.05, 0.1])) : 0 };
      const inpat = admitted.length && how < 0.25 ? pick(admitted) : null;
      if (inpat) { payload.patient_id = inpat.pat.id; payload.ipd_admission_id = inpat.adm; payload.discount = 0; delete payload.payment_mode; }
      else if (how < 0.5) { payload.patient_id = pat.id; payload.credit = true; payload.paid_now = pick([0, r2(sub * 0.3), r2(sub * 0.5)]); }
      else if (how < 0.8) { payload.patient_id = pat.id; }
      else { payload.customer_name = 'Guest'; }
      desc(`sale ${inpat ? 'ipd' : payload.credit ? 'credit' : 'counter'} sub=${sub}`);
      const r = await attempt('pharmacy:sell', payload);
      if (r.ok && (r.value as any).on_credit) creditSales.push((r.value as any).id);
      if (rnd() < 0.1) await attempt('pharmacy:sell', payload);                           // the same attempt again: must be a no-op
    } else if (w < 0.72 && creditSales.length) {                                        // a later payment on a credit sale
      const id = pick(creditSales); const due = one('SELECT MAX(total - COALESCE(amount_paid,total),0) d FROM pharmacy_sales WHERE id=?', id).d;
      desc(`creditpay #${id} due=${due}`);
      if (due > 0) await attempt('pharmacy:payCredit', id, { amount: rnd() < 0.5 ? due : r2(due / 2), mode: 'Cash', client_ref: `aud-cp-${i}` });
    } else if (w < 0.80) {                                                              // admit
      const free = pats.filter((p) => !admitted.some((a) => a.pat.id === p.id));
      const bed = [...beds, ...icuBeds].find((b) => !admitted.some((a) => a.bed.id === b.id) && !one("SELECT 1 x FROM ip_admissions WHERE bed_id=? AND status='admitted'", b.id));
      if (free.length && bed) {
        const p2 = pick(free); desc(`admit ${p2.first_name}`);
        const r = await attempt('ip:admitV2', { patient_id: p2.id, bed_id: bed.id, admission_doctor_id: doc.id, advance_amount: pick([0, 0, 2000, 5000]), advance_mode: 'Cash' });
        if (r.ok && (r.value as any).ok) admitted.push({ adm: (r.value as any).id, pat: p2, bed });
      }
    } else if (w < 0.86) {                                                              // a payment, an extra line or a discount on ANY bill
      const ids = allBills();
      if (ids.length) {
        const id = pick(ids); const b = one('SELECT * FROM bills WHERE id=?', id); const x = rnd();
        if (x < 0.5) { desc(`pay bill #${id}`); await attempt('bill:pay', id, pick([b.total, r2(b.total / 2), 10.555, 1]), 'Cash', 'tester', rnd() < 0.3 ? `rp-${i}` : undefined); }
        else if (x < 0.75) { desc(`addItem bill #${id}`); await attempt('bill:addItem', id, { description: 'Extra', qty: 1, rate: pick([50, 99.5]) }, 'tester'); }
        else { desc(`discount bill #${id}`); await attempt('bill:setDiscount', id, pick([10, 50]), pick(['flat', 'percent']), 'admin', 'audit', 'tester'); }
      }
    } else if (w < 0.875) {                                                             // cancel a (non in-patient) bill, refunding what it took
      const ids = q("SELECT id FROM bills WHERE admission_id IS NULL AND COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL").map((r) => r.id);
      if (ids.length && rnd() < 0.5) { const id = pick(ids); desc(`cancel bill #${id}`); await attempt('bill:cancel', id, 'audit', pick(['Cash', 'UPI'])); }
    } else if (w < 0.89) {                                                              // cancel a scan order (and its bill)
      const o = q("SELECT id FROM radiology_orders WHERE status <> 'cancelled' ORDER BY id DESC LIMIT 5");
      if (o.length) { const id = pick(o).id; desc(`cancel scan order #${id}`); await attempt('radiology:cancelOrder', id, 'audit'); }
    } else if (admitted.length) {                                                       // an in-patient action
      const a = pick(admitted); const x = rnd();
      if (x < 0.15) { desc(`ip manual line #${a.adm}`); const bid = one('SELECT bill_id FROM ip_admissions WHERE id=?', a.adm).bill_id; await attempt('bill:addItem', bid, { description: 'Procedure', qty: 1, rate: money() || 200, charge_head_id: rnd() < 0.4 ? taxHead.id : null, gst_rate: rnd() < 0.4 ? 18 : 0, is_taxable: rnd() < 0.4 }); }
      else if (x < 0.30) { desc(`ip discount #${a.adm}`); const bid = one('SELECT bill_id FROM ip_admissions WHERE id=?', a.adm).bill_id; await attempt('bill:setDiscount', bid, pick([0, 100, 5]), pick(['flat', 'percent']), 'admin', 'audit', 'tester'); }
      else if (x < 0.50) { desc(`ip medicine #${a.adm}`); const dr = pick(drugs); const ord = await attempt('ip:medOrderAdd', a.adm, { drug_master_id: dr.id, drug_name: dr.n, dose: '1 unit', route: 'PO', frequency: 'BD', ordered_by_doctor_id: doc.id }); if (ord.ok && (ord.value as any).id) await attempt('ip:medAdminGive', (ord.value as any).id, { status: 'given', qty: 1 + Math.floor(rnd() * 3), administered_by: 'nurse' }); }
      else if (x < 0.65) { desc(`ip pay #${a.adm}`); const pv: any = await call('bill:previewAdmission', a.adm); const due = pv.balanceDue; if (due > 1) await attempt('bill:pay', pv.bill.id, rnd() < 0.5 ? r2(due) : r2(due / 3), pick(['Cash', 'UPI']), 'tester', `ip-${i}`); }
      else if (x < 0.75) { desc(`ip preview #${a.adm}`); await attempt('bill:previewAdmission', a.adm); }
      else if (x < 0.85) { const cur = one('SELECT bed_id FROM ip_admissions WHERE id=?', a.adm).bed_id; const to = [...beds, ...icuBeds].find((b) => b.id !== cur && !one("SELECT 1 x FROM ip_admissions WHERE bed_id=? AND status='admitted'", b.id) && one("SELECT status FROM beds WHERE id=?", b.id).status === 'free'); if (to) { desc(`ip transfer #${a.adm}`); await attempt('ip:transfer', a.adm, to.id, 'audit', 'tester'); a.bed = to; } }
      else { desc(`ip discharge #${a.adm}`); const rq = await attempt('ip:requestDischarge', a.adm, { outcome: 'discharged' }, 'tester'); if (rq.ok) { const ap = await attempt('ip:approveDischarge', a.adm, { by: 'tester', override_reason: 'audit' }); if (ap.ok && (ap.value as any).ok) admitted.splice(admitted.indexOf(a), 1); } }
    }
    if (rnd() < 0.04) { const k = pick(['bill_round_off', 'ipd_gst_enabled']); const cur = (await call('settings:get'))[k]; desc(`setting ${k} -> ${!cur}`); await call('settings:save', { [k]: !cur }); }
    if (rnd() < 0.15) { const ids = allBills(); if (ids.length) { const id = pick(ids); desc(`preview bill #${id}`); await attempt('bill:previewById', id); } }
  }

  // ------------------------------------------------------------------------------------------------ the invariants
  function check(label: string): string[] {
    const bad: string[] = [];
    const add = (m: string) => { if (bad.length < 8) bad.push(m); };
    const bills = q('SELECT * FROM bills');
    const live = bills.filter((b) => (b.status || '') !== 'cancelled' && !b.cancelled_at);
    const pay = (id: number) => one('SELECT COALESCE(SUM(amount),0) s FROM bill_payments WHERE bill_id=?', id).s as number;
    // 1 · sane numbers, parts add up
    for (const b of live) {
      if (b.total < -0.005 || b.subtotal < -0.005 || b.amount_paid < -0.005 || b.discount < -0.005) add(`${label}: negative figure on ${b.bill_number} (total ${b.total}, paid ${b.amount_paid}, discount ${b.discount})`);
      const parts = r2(b.exempt_total + b.taxable_total + b.cgst_total + b.sgst_total + b.round_off);
      const hasLines = one('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?', b.id).c > 0;
      if (hasLines && Math.abs(parts - b.total) > 0.011) add(`${label}: ${b.bill_number} parts ${parts} ≠ total ${b.total} (exempt ${b.exempt_total}, taxable ${b.taxable_total}, cgst ${b.cgst_total}, sgst ${b.sgst_total}, round ${b.round_off})`);
      if (Math.abs(b.cgst_total - b.sgst_total) > 0.011) add(`${label}: ${b.bill_number} CGST ${b.cgst_total} ≠ SGST ${b.sgst_total}`);
      const sumLines = r2(q('SELECT amount FROM bill_items WHERE bill_id=?', b.id).reduce((s, x) => s + x.amount, 0));
      if (hasLines && Math.abs(sumLines - b.subtotal) > 0.011) add(`${label}: ${b.bill_number} lines add to ${sumLines} but subtotal is ${b.subtotal}`);
      // 2 · money received
      const inpat = b.admission_id != null || b.bill_type === 'ipd';
      if (b.amount_paid + 0.011 < pay(b.id)) add(`${label}: ${b.bill_number} amount_paid ${b.amount_paid} is below its payment rows ${pay(b.id)}`);
      if (!inpat && b.amount_paid > b.total + 0.011) add(`${label}: ${b.bill_number} received ${b.amount_paid} > billed ${b.total}`);
      if (inpat && pay(b.id) > b.total + 0.011) add(`${label}: ${b.bill_number} (in-patient) payments ${pay(b.id)} > billed ${b.total}`);
    }
    for (const a of q('SELECT * FROM advances')) if (a.adjusted_amount + a.refunded_amount > a.amount + 0.011) add(`${label}: advance ${a.id} used ${a.adjusted_amount + a.refunded_amount} > held ${a.amount}`);
    const nums = bills.map((b) => b.bill_number); if (new Set(nums).size !== nums.length) add(`${label}: duplicate bill numbers`);
    // 3 · pharmacy sales
    for (const s of q('SELECT * FROM pharmacy_sales')) {
      const parts = r2(s.taxable_total + s.exempt_total + s.cgst_total + s.sgst_total);
      if (Math.abs(parts - s.total) > 0.021) add(`${label}: sale ${s.sale_number} tax parts ${parts} ≠ total ${s.total}`);
      const later = one('SELECT COALESCE(SUM(amount),0) s FROM pharmacy_sale_payments WHERE sale_id=?', s.id).s;
      if (s.payment_mode !== 'IPD-bill' && s.amount_paid != null && s.amount_paid > s.total + 0.011) add(`${label}: sale ${s.sale_number} received ${s.amount_paid} > ${s.total}`);
      if (later > (s.amount_paid ?? s.total) + 0.011) add(`${label}: sale ${s.sale_number} later payments ${later} exceed what was received ${s.amount_paid}`);
    }
    // 4 · stock = bought − sold; every sold unit is registered
    for (const d of drugs) {
      const stock = one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches WHERE drug_master_id=?', d.id).s;
      const sold = one('SELECT COALESCE(SUM(qty),0) s FROM pharmacy_sale_items WHERE drug_master_id=?', d.id).s;
      if (Math.abs(stock - (INITIAL - sold)) > 0.001) add(`${label}: stock of ${d.n} is ${stock}, expected ${INITIAL - sold}`);
      if (stock < 0) add(`${label}: negative stock of ${d.n}`);
    }
    for (const it of q('SELECT id, qty FROM pharmacy_sale_items WHERE drug_master_id IS NOT NULL')) {
      const reg = one('SELECT COALESCE(SUM(qty),0) s FROM dispensing_register WHERE sale_item_id=?', it.id).s;
      if (Math.abs(reg - it.qty) > 0.001) add(`${label}: sale item ${it.id} qty ${it.qty} but register ${reg}`);
    }
    return bad;
  }

  async function checkScreens(label: string): Promise<string[]> {
    const bad: string[] = [];
    const add = (m: string) => { if (bad.length < 8) bad.push(m); };
    // looking never changes what a bill says
    const before = q('SELECT id, total, subtotal, amount_paid, round_off FROM bills');
    for (const b of before) {
      const adm = one('SELECT id FROM ip_admissions WHERE bill_id=?', b.id);
      await attempt(adm ? 'bill:previewAdmission' : 'bill:previewById', adm ? adm.id : b.id);
    }
    for (const b of before) {
      const now = one('SELECT total, subtotal, amount_paid FROM bills WHERE id=?', b.id);
      // a running in-patient bill may legitimately move as days accrue; every other bill must read the same after a look
      const running = !!one("SELECT 1 x FROM ip_admissions WHERE bill_id=? AND status='admitted'", b.id);
      if (!running && (Math.abs(now.total - b.total) > 0.005 || Math.abs(now.amount_paid - b.amount_paid) > 0.005)) add(`${label}: bill #${b.id} changed on a look: total ${b.total} → ${now.total}, paid ${b.amount_paid} → ${now.amount_paid}`);
    }
    // still-owed equals an independent sum
    const oracle = (() => {
      let p = 0;
      for (const b of q("SELECT * FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL")) {
        const inpat = b.admission_id != null || b.bill_type === 'ipd';
        if (!inpat) { p += Math.max(0, P(b.total) - P(b.amount_paid)); continue; }
        const adj = b.finalized_at ? P(b.advance_adjusted) : 0;
        const spare = P(one('SELECT COALESCE(SUM(amount - adjusted_amount - refunded_amount),0) s FROM advances WHERE admission_id=?', b.admission_id).s);
        const need = Math.max(0, P(b.total) - P(b.amount_paid) - adj);
        p += Math.max(0, need - Math.min(Math.max(spare, 0), need));
      }
      for (const s of q("SELECT total, amount_paid FROM pharmacy_sales WHERE on_credit=1 AND COALESCE(payment_mode,'') <> 'IPD-bill'")) p += Math.max(0, P(s.total) - P(s.amount_paid ?? s.total));
      return p / 100;
    })();
    const rec = await call('analytics:receivables');
    if (Math.abs(rec.total_due - oracle) > 0.011) add(`${label}: receivables ${rec.total_due} ≠ independent sum ${oracle}`);
    // GST: bills + pharmacy counter sales
    const bi = await call('analytics:billing', today, today);
    const gb = one("SELECT COALESCE(SUM(cgst_total),0) c, COALESCE(SUM(sgst_total),0) s FROM bills WHERE is_tax_invoice=1 AND status != 'cancelled' AND date(created_at,'localtime') BETWEEN ? AND ?", today, today);
    const gs = one("SELECT COALESCE(SUM(cgst_total),0) c, COALESCE(SUM(sgst_total),0) s FROM pharmacy_sales WHERE COALESCE(payment_mode,'') <> 'IPD-bill' AND is_tax_invoice=1 AND date(created_at,'localtime') BETWEEN ? AND ?", today, today);
    if (Math.abs(bi.gst.cgst - (gb.c + gs.c)) > 0.021 || Math.abs(bi.gst.sgst - (gb.s + gs.s)) > 0.021) add(`${label}: GST shown ${bi.gst.cgst}/${bi.gst.sgst} ≠ bills+sales ${r2(gb.c + gs.c)}/${r2(gb.s + gs.s)}`);
    // money collected today = payment rows + paid-at-billing remainder + pharmacy counter + credit payments
    const rows = one("SELECT COALESCE(SUM(amount),0) s FROM bill_payments WHERE date(received_at,'localtime') BETWEEN ? AND ?", today, today).s;
    const atBilling = q("SELECT b.amount_paid - COALESCE((SELECT SUM(amount) FROM bill_payments p WHERE p.bill_id=b.id),0) AS rem FROM bills b WHERE COALESCE(b.status,'') <> 'cancelled' AND b.cancelled_at IS NULL AND date(b.created_at,'localtime') BETWEEN ? AND ?", today, today).reduce((s, x) => s + Math.max(0, x.rem), 0);
    const counter = q("SELECT s.total, COALESCE(s.amount_paid, s.total) AS ap, COALESCE((SELECT SUM(amount) FROM pharmacy_sale_payments x WHERE x.sale_id=s.id),0) AS later FROM pharmacy_sales s WHERE COALESCE(s.payment_mode,'') <> 'IPD-bill' AND date(s.created_at,'localtime') BETWEEN ? AND ?", today, today).reduce((s, x) => s + Math.max(0, x.ap - x.later), 0);
    const later = one("SELECT COALESCE(SUM(amount),0) s FROM pharmacy_sale_payments WHERE date(received_at,'localtime') BETWEEN ? AND ?", today, today).s;
    const deposits = one("SELECT COALESCE(SUM(amount),0) s FROM advances WHERE date(received_at,'localtime') BETWEEN ? AND ?", today, today).s - one("SELECT COALESCE(SUM(refunded_amount),0) s FROM advances WHERE refunded_at IS NOT NULL AND date(refunded_at,'localtime') BETWEEN ? AND ?", today, today).s;
    const expectCollected = r2(rows + atBilling + counter + later + deposits);
    if (Math.abs(bi.totalCollected - expectCollected) > 0.021) add(`${label}: collected today ${bi.totalCollected} ≠ independent sum ${expectCollected}`);
    // module P&L adds up to billed
    const mods = await call('analytics:modules', today, today);
    const billed = q("SELECT total FROM bills WHERE COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL AND date(created_at,'localtime') BETWEEN ? AND ?", today, today).reduce((s, x) => s + x.total, 0)
      + q("SELECT total FROM pharmacy_sales WHERE COALESCE(payment_mode,'') <> 'IPD-bill' AND date(created_at,'localtime') BETWEEN ? AND ?", today, today).reduce((s, x) => s + x.total, 0);
    if (Math.abs(mods.totals.revenue - billed) > Math.max(2, mods.modules.length)) add(`${label}: modules revenue ${mods.totals.revenue} ≠ billed ${r2(billed)}`);
    return bad;
  }

  // ------------------------------------------------------------------------------------------------ run
  for (const seed of SEEDS) {
    section(`random audit · seed ${seed} · ${OPS} actions`);
    const rnd = rng(seed);
    let bad: string[] = [];
    for (let i = 0; i < OPS && !bad.length; i++) {
      try { await doOp(rnd, seed * 1000 + i); } catch (e: any) { bad.push(`action #${i} threw: ${String(e?.message || e)}`); }
      if (i % 20 === 19) bad = check(`after ${i + 1} actions`);
    }
    if (!bad.length) bad = check('end');
    if (!bad.length) bad = await checkScreens('end');
    ok(bad.length === 0, `seed ${seed}: every invariant holds after ${OPS} random actions${bad.length ? ' — FIRST PROBLEMS: ' + bad.join(' | ') : ''}`);
    if (bad.length) { failures++; note('last actions: ' + log.slice(-12).join(' ; ')); break; }
    const nb = one('SELECT COUNT(*) c FROM bills').c, ns = one('SELECT COUNT(*) c FROM pharmacy_sales').c, np = one('SELECT COUNT(*) c FROM bill_payments').c;
    note(`${nb} bills, ${ns} pharmacy sales, ${np} payments so far`);
  }
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
