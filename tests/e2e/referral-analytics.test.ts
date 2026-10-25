// Analytics → Referrals: who sent the patients. The "Referral" typed on a visit (Google, Self, Family, a doctor's name…) counted over a period.
// Rules proved here, on the app's real handlers and a temporary database:
//   - the same source typed differently is ONE source ("Google", "google ", "GOOGLE"; "Dr. Ramesh Kumar", "Dr Ramesh Kumar", "Ramesh Kumar") and is
//     shown as the spelling typed most often; a name that merely starts with "Dr" ("Drishti") is not mistaken for a doctor;
//   - a visit with no referral is "not recorded", never a source; the shares are of the visits that HAVE a referral;
//   - "new" is the patient's first visit ever, every later one is "returning"; patients are counted once per source;
//   - revenue is what the visit was billed (bills + pharmacy sales raised on it); a cancelled bill and a cancelled visit are left out;
//   - only the chosen period counts; the month-by-month table covers every month of it; the latest list is newest first.
import { boot, call, getDb } from './harness';
import { buildReferralStats, referralKey } from '../../src/lib/referralStats';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const doc = await call('doctors:create', { name: 'Dr. Ref Analytics', specialty: 'GP', default_fee: 300 });
  let n = 0, slot = 0;
  const patient = (first: string) => call('patients:create', { first_name: first, last_name: 'Referral', dob: '1990-01-01', gender: 'F', phone: `95${String(++n).padStart(8, '0')}` });
  const visit = async (p: any, date: string, referred_by: string | null, fee = 0) => {
    const t = ++slot;                                                                    // a different time for every visit: one doctor cannot take two at once
    const time = `${String(8 + Math.floor(t / 4)).padStart(2, '0')}:${String((t % 4) * 15).padStart(2, '0')}`;
    const a = await call('appointments:create', { patient_id: p.id, doctor_id: doc.id, appointment_date: date, appointment_time: time, ...(referred_by === null ? {} : { referred_by }) });
    if (fee > 0) await call('bills:create', { appointment_id: a.id, patient_id: p.id, items: [{ description: 'Consultation', qty: 1, rate: fee, amount: fee }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
    return a;
  };
  const [p1, p2, p3, p4, p5, p6] = await Promise.all(['Asha', 'Bina', 'Chitra', 'Deepa', 'Esha', 'Farah'].map(patient));
  // created in date order, so each patient's visit numbers follow the calendar
  const aGoogle1 = await visit(p1, day(-70), 'Google', 300);        // p1's FIRST visit ever (new) — outside the period asked below
  const aGoogle2 = await visit(p1, day(-20), 'Google', 300);        // p1 again (returning)
  const aGoogle3 = await visit(p2, day(-18), 'GOOGLE', 200);        // p2, new, typed in capitals
  const aSelf = await visit(p3, day(-15), 'Self', 250);             // p3, new; this bill is cancelled below
  const aDr1 = await visit(p4, day(-12), 'Dr. Ramesh Kumar', 400);  // p4, new
  const aGoogle4 = await visit(p1, day(-9), 'Google', 300);         // p1 a third time
  const aGoogle5 = await visit(p5, day(-8), 'google ', 200);        // p5, new, lower case and a trailing space
  const aDr4 = await visit(p3, day(-6), 'Dr Ramesh Kumar', 100);    // the same doctor without the full stop
  const aDr2 = await visit(p4, day(-5), 'Dr. Ramesh Kumar', 400);
  const aDr3 = await visit(p5, day(-4), 'Ramesh Kumar', 350);       // …and without "Dr"
  const aDri = await visit(p6, day(-3), 'Drishti', 100);            // NOT a doctor: a name that merely starts with "Dr"
  const aNone = await visit(p6, day(-2), null, 100);                // no referral
  const aBlank = await visit(p3, day(-1), '   ', 100);              // only spaces: not recorded
  const aCancelled = await visit(p2, day(-1), 'Self', 999);
  db.prepare("UPDATE appointments SET status='Cancelled' WHERE id=?").run(aCancelled.id);   // a cancelled visit is not a visit
  // a pharmacy sale on one Google visit, and a consultation bill that was cancelled
  db.prepare("INSERT INTO pharmacy_sales (sale_number, patient_id, appointment_id, subtotal, discount, total, payment_mode) VALUES ('PH-RA-1', ?, ?, 50, 0, 50, 'Cash')").run(p2.id, aGoogle3.id);
  const cancelBill = db.prepare('SELECT id FROM bills WHERE appointment_id=?').get(aSelf.id) as any;
  db.prepare("UPDATE bills SET status='cancelled' WHERE id=?").run(cancelBill.id);
  void [aGoogle1, aGoogle2, aGoogle4, aGoogle5, aDr1, aDr2, aDr3, aDr4, aDri, aNone, aBlank];

  const r = await call('analytics:referrals', { from: day(-30), to: day(0) });

  // ============================================================================================================
  section('1 · the same source typed differently is counted once');
  eq(r.ok, true, 'the report answers');
  const by = (name: string) => r.sources.find((s: any) => s.name === name);
  eq(r.sources.map((s: any) => s.name).join(' | '), 'Dr. Ramesh Kumar | Google | Drishti | Self', 'four sources: the doctor (3 spellings), Google (3 spellings), Drishti, Self');
  eq(by('Google')?.visits, 4, 'Google: four visits typed as "Google", "GOOGLE" and "google " — shown as "Google", the spelling typed most');
  eq(by('Dr. Ramesh Kumar')?.visits, 4, 'Dr. Ramesh Kumar: "Dr. Ramesh Kumar", "Dr Ramesh Kumar" and "Ramesh Kumar" are one doctor');
  eq(by('Drishti')?.visits, 1, '"Drishti" is its own source — not read as "Dr. ishti"');
  ok(r.sources[0].visits >= r.sources[1].visits && r.sources[1].visits >= r.sources[2].visits, 'most visits first');
  eq(referralKey('  DR.  Ramesh   Kumar '), 'ramesh kumar', 'the grouping key ignores case, full stops, spaces and a leading "Dr"');
  eq(referralKey('Drishti'), 'drishti', '…but keeps a name that only starts with the letters "Dr"');
  eq(referralKey('   '), '', 'blanks are no source');

  section('2 · visits with no referral, and the shares');
  eq(r.totalVisits, 12, 'twelve visits in the period (the cancelled one is not counted, the visit 70 days ago is outside)');
  eq(r.withReferral, 10, 'ten carry a referral');
  eq(r.notRecorded, 2, 'two do not (one with nothing typed, one with only spaces)');
  near(by('Dr. Ramesh Kumar').share, 40, 'the doctor sent 4 of the 10 = 40 %');
  near(by('Drishti').share, 10, 'Drishti 1 of 10 = 10 %');
  near(r.sources.reduce((s: number, x: any) => s + x.share, 0), 100, 'the shares add up to 100 %', 0.2);

  section('3 · new and returning, patients, and what the visits were billed');
  eq(by('Google').newPatients, 2, 'Google: p2 and p5 are new…');
  eq(by('Google').returning, 2, '…and p1 coming back twice is returning (her FIRST visit was 70 days ago)');
  eq(by('Google').patients, 3, 'three different patients (p1 counted once although she came twice)');
  eq(by('Dr. Ramesh Kumar').newPatients, 1, 'the doctor: only p4’s first visit is new');
  eq(by('Dr. Ramesh Kumar').returning, 3, '…the other three are returning');
  eq(by('Dr. Ramesh Kumar').patients, 3, '…from three different patients (p4, p5, p3)');
  near(by('Google').revenue, 300 + 200 + 50 + 300 + 200, 'Google billed ₹300 + ₹200 + ₹50 (pharmacy sale) + ₹300 + ₹200 = ₹1,050');
  near(by('Dr. Ramesh Kumar').revenue, 400 + 400 + 350 + 100, 'the doctor’s visits billed ₹1,250');
  near(by('Self').revenue, 0, 'a cancelled bill is not revenue (Self’s only bill was cancelled)');
  near(by('Drishti').revenue, 100, 'Drishti’s visit billed ₹100');

  section('4 · only the chosen period; month by month; the latest list');
  const wide = await call('analytics:referrals', { from: day(-90), to: day(0) });
  eq(wide.withReferral, 11, 'a wider period also picks up the visit 70 days ago');
  eq(wide.sources.find((s: any) => s.name === 'Google').visits, 5, '…which belongs to Google');
  eq(wide.sources.find((s: any) => s.name === 'Google').newPatients, 3, '…and is p1’s first visit (new)');
  ok(wide.months.length >= 3 && wide.months.length <= 5, `every month of the period has a row (${wide.months.length})`);
  eq(wide.months.reduce((s: number, m: any) => s + m.total, 0), 11, 'the months add up to all the visits with a referral');
  eq(wide.topNames[0], 'Google', 'the busiest source heads the month-by-month table');
  ok(wide.topNames.length <= 5, 'at most five sources get a column');
  ok(r.recent.every((x: any, i: number, a: any[]) => i === 0 || a[i - 1].date >= x.date), 'the latest referrals run newest first');
  eq(r.recent.length, 10, 'the latest list holds the visits that have a referral');
  ok(r.recent.every((x: any) => x.referral && x.patient && x.doctor), 'each line names the patient, the referral and the doctor');
  ok(r.recent.filter((x: any) => /Ramesh/.test(x.referral)).every((x: any) => x.referral === 'Dr. Ramesh Kumar'), 'a source is shown under one name everywhere');
  const none = await call('analytics:referrals', { from: day(1), to: day(5) });
  ok(none.totalVisits === 0 && none.withReferral === 0 && none.sources.length === 0 && none.recent.length === 0, 'a period with no visits gives an empty, zero report');

  section('5 · the counting function on its own');
  const v = (id: number, date: string, by: string | null, vn: number | null, rev = 0) => ({ id, patient_id: id, date, visit_number: vn, referred_by: by, patient: `P${id}`, uhid: `U${id}`, doctor: 'D', revenue: rev });
  const s = buildReferralStats([v(1, '2026-01-05', 'Google', 1, 0.1), v(2, '2026-01-06', 'google', 2, 0.2), v(3, '2026-02-01', 'Google', null, 0.3), v(4, '2026-02-02', 'google', 1)], { from: '2026-01-01', to: '2026-03-31' });
  eq(s.sources[0].name, 'google', 'on a tie in spellings the latest typed wins ("google" last on 2 Feb; two of each)');
  near(s.sources[0].revenue, 0.6, '₹0.10 + ₹0.20 + ₹0.30 = ₹0.60 exactly (paise)');
  eq(s.sources[0].newPatients, 3, 'a visit number of 1 or unknown counts as the first visit');
  eq(s.months.map((m) => m.month).join(','), '2026-01,2026-02,2026-03', 'three months, even the empty one');
  eq(s.months[2].total, 0, 'an empty month is zero, not missing');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
