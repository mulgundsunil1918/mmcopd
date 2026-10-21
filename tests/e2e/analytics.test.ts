// Every analytics, Accounts and report channel, on a realistic spread of data (the app's own sample-data generator:
// ~50 patients, bills of every kind, pharmacy sales, lab orders, admissions) — through the real handlers.
// Two jobs: (1) nothing throws, whatever the date range; (2) the figures the screens show agree with each other and
// with the records beneath them, and carry the fields the screens read.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, near, section, finish, note } from './lib';
import { localISO, addDaysISO } from '../../src/lib/localDate';

boot();
const q = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => getDb().prepare(sql).get(...p) as any;
const today = localISO();
const r2 = (n: number) => Math.round(n * 100) / 100;
const hasKeys = (o: any, keys: string[]) => o && keys.every((k) => k in o);

(async () => {
  const sd = await call('admin:loadSampleData');
  ok(sd.ok && sd.patients >= 40 && sd.bills > 50, `sample data loaded (${sd.patients} patients, ${sd.bills} bills, ${sd.sales} sales, ${sd.admissions} admissions)`);
  const FROM = addDaysISO(today, -400), TO = today;
  const WIDE: [string, string] = ['2000-01-01', '2100-01-01'];

  // The generator's bills are all paid, so add real dues: an unpaid bill, a part-paid one, and one that has waited 100 days.
  const some = q('SELECT id FROM patients ORDER BY id LIMIT 3').map((r) => r.id as number);
  const unpaid = await call('bill:createStandalone', { patient_id: some[0], bill_type: 'custom', items: [{ description: 'Procedure A', qty: 1, rate: 800 }], payment_mode: 'Cash', paid_now: false });
  const part = await call('bill:createStandalone', { patient_id: some[1], bill_type: 'lab', items: [{ description: 'Panel B', qty: 1, rate: 1200 }], payment_mode: 'Cash', paid_now: false });
  const old = await call('bill:createStandalone', { patient_id: some[2], bill_type: 'radiology', items: [{ description: 'Scan C', qty: 1, rate: 1500 }], payment_mode: 'Cash', paid_now: false });
  ok(unpaid.ok && part.ok && old.ok, 'three dues are added to the sample data: ₹800 unpaid, ₹1,200 (₹500 paid below), ₹1,500 that has waited 100 days');
  ok((await call('bill:pay', part.id, 500, 'UPI')).ok, 'part-payment of ₹500 taken');
  getDb().prepare("UPDATE bills SET created_at=datetime('now','-100 days') WHERE id=?").run(old.id);

  section('1 · every channel answers, for any date range');
  const ranges: [string, string][] = [[FROM, TO], WIDE, [today, today], [TO, FROM], ['2000-01-01', '2000-01-01'], ['', ''], ['not-a-date', 'nor-this']];
  const channels: [string, (r: [string, string]) => any[]][] = [
    ['analytics:modules', (r) => [r[0], r[1]]],
    ['analytics:pharmacyOverview', (r) => [{ from: r[0], to: r[1] }]],
    ['analytics:pharmacyProfit', (r) => [{ from: r[0], to: r[1] }]],
    ['analytics:supplierReport', (r) => [{ from: r[0], to: r[1] }]],
    ['analytics:ipd', (r) => [r[0], r[1]]],
    ['analytics:billing', (r) => [r[0], r[1]]],
    ['finance:summary', (r) => [{ from: r[0], to: r[1] }]],
    ['origin:summary', (r) => [{ from: r[0], to: r[1] }]],
    ['misc:summary', (r) => [{ from: r[0], to: r[1] }]],
    ['misc:trend', (r) => [{ from: r[0], to: r[1] }]],
    ...['daily_collection', 'doctor_performance', 'top_diagnoses', 'top_drugs', 'new_patients'].map((kind): [string, (r: [string, string]) => any[]] => ['reports:run', (r) => [{ kind, from: r[0], to: r[1] }]]),
  ];
  let thrown = 0;
  for (const [ch, args] of channels) for (const r of ranges) {
    const a = await attempt(ch, ...args(r));
    // an invalid range may be REFUSED with a sentence, but it must never crash or hang
    if (!a.ok && !/^[A-Z].{8,}/.test((a as any).error)) { thrown++; console.log(`  ✗ ${ch} ${JSON.stringify(r)} → ${(a as any).error}`); }
  }
  eq(thrown, 0, `${channels.length * ranges.length} calls: none answered with a raw error`);
  for (const ch of ['analytics:overview', 'analytics:demographics', 'analytics:retention', 'analytics:cohort', 'analytics:weekdayHourHeatmap', 'analytics:pharmacyBasket', 'analytics:pharmacyValuation', 'analytics:pharmacyChecks', 'analytics:receivables']) {
    ok((await attempt(ch)).ok, `${ch} answers`);
  }

  section('2 · the fields the screens read are there');
  const fin = await call('finance:summary', { from: FROM, to: TO });
  ok(hasKeys(fin, ['today', 'yesterday', 'week', 'prevWeek', 'month', 'prevMonth', 'allTime', 'range', 'byDay', 'byMonth', 'byWeekday', 'byHour', 'byDoctor', 'byMode', 'byPlace', 'topPatients']), 'Finance summary carries every block');
  ok(fin.byWeekday.every((r: any) => 'wd' in r && 'total' in r) && fin.byHour.every((r: any) => 'hr' in r && 'total' in r), '…weekday rows are {wd, total} and hour rows are {hr, total} (the Accounts and Analytics charts both read these names)');
  ok(fin.byMode.every((r: any) => 'payment_mode' in r && 'total' in r && 'count' in r) && fin.today.byMode.every((r: any) => 'payment_mode' in r), '…payment-mode rows are {payment_mode, total, count}');
  ok(['today', 'week', 'month'].every((k) => fin[k].delta === null || typeof fin[k].delta === 'number'), '…today / week / month carry a change figure (a number, or null with nothing to compare)');
  ok(hasKeys(fin.range.pharmaSplit, ['patient', 'guest']), '…and the pharmacy range is split into patients and walk-ins');
  const ov = await call('analytics:overview');
  ok(hasKeys(ov, ['todayVisits', 'todayRevenue', 'monthRevenue', 'pharmacyMonthRevenue', 'pharmacyMonthPatientRevenue', 'pharmacyMonthGuestRevenue', 'outstandingTotal', 'pendingRx', 'lowStockDrugs', 'expiringSoonBatches', 'expiredBatches']), 'Overview carries every tile');
  const ph = await call('analytics:pharmacyOverview', { from: FROM, to: TO });
  ok(hasKeys(ph, ['totalSales', 'totalRevenue', 'totalDispensed', 'scheduleHCount', 'valuation', 'topDrugs', 'salesMix', 'customerMix', 'paymentMix', 'topPatients', 'scheduleMix', 'lowStock', 'expiringSoon']), 'Pharmacy overview carries every block');
  const mods = await call('analytics:modules', FROM, TO);
  ok(mods.ok && mods.modules.every((m: any) => hasKeys(m, ['key', 'label', 'count', 'revenue', 'collected', 'outstanding'])) && hasKeys(mods.totals, ['revenue', 'collected', 'outstanding', 'count']), 'Modules P&L rows and totals are complete');
  const rec = await call('analytics:receivables', { limit: 200 });
  ok(hasKeys(rec, ['total_due', 'bills_due', 'patients_due', 'by_kind', 'by_patient', 'aging']) && rec.aging.length === 4, 'Receivables carries totals, departments, patients and four aging bands');
  const ab = await call('analytics:billing', ...WIDE);
  ok(hasKeys(ab, ['collections', 'totalCollected', 'collectedBySource', 'outstanding', 'gst', 'bySection', 'advances', 'tpa']), 'IPD & billing analytics carries collections, dues, GST, sections, advances and insurance');

  section('3 · the figures agree');
  const billsAll = r2(one("SELECT COALESCE(SUM(total),0) s FROM bills WHERE COALESCE(status,'')<>'cancelled'").s);
  const counterAll = r2(one("SELECT COALESCE(SUM(total),0) s FROM pharmacy_sales WHERE COALESCE(payment_mode,'')<>'IPD-bill'").s);
  const modsAll = await call('analytics:modules', ...WIDE);
  near(modsAll.totals.revenue, billsAll + counterAll, 'Modules P&L revenue = every live bill + every counter pharmacy sale', 3);
  near(modsAll.modules.reduce((s: number, m: any) => s + m.revenue, 0), modsAll.totals.revenue, '…and its rows add up to its total', 2);
  const finAll = await call('finance:summary', {});
  near(finAll.allTime.total, billsAll, 'Accounts → all-time billed = every live bill');
  near(finAll.allTime.count, one("SELECT COUNT(*) c FROM bills WHERE COALESCE(status,'')<>'cancelled'").c, '…and the count');
  near(finAll.byMonth.reduce((s: number, m: any) => s + m.total, 0) <= billsAll + 0.01 ? 1 : 0, 1, 'the last-12-months chart never exceeds the all-time figure');
  const rangeAll = await call('finance:summary', { from: '2000-01-01', to: '2100-01-01' });
  near(rangeAll.range.bills.total, billsAll, 'a range covering everything = all-time (bills)');
  near(rangeAll.range.pharma.total, counterAll, '…and pharmacy');
  near(rangeAll.range.pharmaSplit.patient.total + rangeAll.range.pharmaSplit.guest.total, counterAll, '…and the patient + walk-in split adds up');
  const dc = await call('reports:run', { kind: 'daily_collection', from: '2000-01-01', to: '2100-01-01' });
  near(dc.reduce((s: number, r: any) => s + r.revenue, 0), billsAll, 'Daily Collection revenue over all days = every live bill');
  near(dc.reduce((s: number, r: any) => s + r.pharmacy, 0), counterAll, '…its pharmacy column = every counter sale');
  eq(dc.reduce((s: number, r: any) => s + r.bills, 0), one("SELECT COUNT(*) c FROM bills WHERE COALESCE(status,'')<>'cancelled'").c, '…its bill count = the number of live bills');
  ok(dc.every((r: any, i: number, a: any[]) => i === 0 || a[i - 1].day > r.day), '…days are newest first, one row each');
  const collAll = await call('analytics:billing', ...WIDE);
  near(collAll.totalCollected, dc.reduce((s: number, r: any) => s + r.received, 0), 'Collected (all time) = the Daily Collection report\'s received, summed');
  near(collAll.collections.reduce((s: number, c: any) => s + c.total, 0), collAll.totalCollected, '…and the by-mode list adds up');
  const bills = q("SELECT * FROM bills WHERE COALESCE(status,'')<>'cancelled' AND cancelled_at IS NULL");
  const owed = r2(bills.reduce((s, b) => {
    const total = Number(b.total), paid = Number(b.amount_paid);
    if (b.admission_id == null && b.bill_type !== 'ipd') return s + Math.max(0, r2(total - paid));
    if (b.finalized_at) return s + Math.max(0, r2(total - paid - Number(b.advance_adjusted)));
    const spare = Number(one('SELECT COALESCE(SUM(amount-adjusted_amount-refunded_amount),0) s FROM advances WHERE admission_id=?', b.admission_id).s);
    return s + Math.max(0, r2(total - paid - Math.min(Math.max(spare, 0), Math.max(0, total - paid))));
  }, 0));
  near(rec.total_due, owed, 'Receivables = an independent sum over every bill');
  near(ab.outstanding, owed, '…IPD & billing analytics shows it too');
  near(ov.outstandingTotal, owed, '…and the Overview');
  near(modsAll.totals.outstanding, owed, '…and the Module P&L (all-time)', 3);
  near(rec.by_patient.reduce((s: number, p: any) => s + p.due, 0), rec.total_due, 'the by-patient list adds up');
  near(rec.by_kind.reduce((s: number, k: any) => s + k.due, 0), rec.total_due, 'the by-department list adds up');
  near(owed, 800 + 700 + 1500, 'the independent sum is ₹800 + ₹700 + ₹1,500 = ₹3,000');
  eq(rec.aging.find((a: any) => a.label === 'Over 90 days').bills, 1, 'the 100-day bill is in the "over 90 days" band');
  near(rec.aging.find((a: any) => a.label === 'Over 90 days').due, 1500, '…₹1,500');
  near(rec.by_patient[0].due, 1500, 'the patient who owes most is listed first (₹1,500)');
  eq(rec.by_patient[0].oldest_days >= 100, true, '…and has waited at least 100 days');
  note(`sample data: ₹${billsAll} billed, ₹${counterAll} counter pharmacy, ₹${owed} still to collect`);

  section('4 · portals add up to the clinic');
  const pts = q('SELECT id FROM patients');
  let portalOwed = 0, portalBilled = 0, portalCounter = 0, bad = 0;
  for (const p of pts) {
    const a = await attempt('billing:patientPortal', p.id);
    if (!a.ok) { bad++; continue; }
    const pa = (a as any).value;
    portalOwed += pa.summary.outstanding; portalBilled += pa.history.filter((h: any) => h.source === 'bill' && h.status !== 'cancelled').reduce((s: number, h: any) => s + h.total, 0);
    portalCounter += pa.history.filter((h: any) => h.counter_sale).reduce((s: number, h: any) => s + h.total, 0);
    if (pa.summary.received > pa.summary.billed + 0.01 && pa.summary.credit_held <= 0) { bad++; console.log(`  ✗ ${pa.patient.uhid}: received ${pa.summary.received} exceeds billed ${pa.summary.billed}`); }
    if (Math.abs(pa.summary.billed - pa.summary.received - pa.summary.outstanding) > 0.01 && pa.summary.credit_held <= 0) { bad++; console.log(`  ✗ ${pa.patient.uhid}: billed − received ≠ still to collect`); }
  }
  eq(bad, 0, `all ${pts.length} patients' portals open, and in each billed − received = still to collect`);
  near(portalOwed, rec.total_due, "every patient's 'still to collect' adds up to the clinic's total (all bills belong to a patient here)");
  const walkInDue = r2(bills.filter((b) => b.patient_id == null).reduce((s, b) => s + Math.max(0, r2(Number(b.total) - Number(b.amount_paid))), 0));
  near(portalBilled + r2(bills.filter((b) => b.patient_id == null).reduce((s, b) => s + Number(b.total), 0)), billsAll, "every patient's billed (plus walk-in bills) = every live bill");
  near(portalCounter, r2(one("SELECT COALESCE(SUM(total),0) s FROM pharmacy_sales WHERE patient_id IS NOT NULL AND COALESCE(payment_mode,'')<>'IPD-bill'").s), "every patient's pharmacy sales = the counter sales made under patients");
  note(`walk-in bills still owing: ₹${walkInDue}`);
  const guests = await call('pharmacy:counterSales', { scope: 'guest' });
  const named = await call('pharmacy:counterSales', { scope: 'patient' });
  near(guests.totals.total + named.totals.total, counterAll, 'walk-in + under-patient counter sales = all counter sales');

  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
