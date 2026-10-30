// Lab normal values and structured results (owner, 2026-10-30: "a user must be able to set the normal values of each test — CBC: Hb x–y g/dL, TLC … — you set the
// defaults and they just type the values, save and print a proper report"). Real handlers on a temporary database.
//   - the common panels arrive with their parameters and normal values (CBC, LFT, KFT, lipid, thyroid, urine …); nothing the clinic made is overwritten;
//   - the normal range shown is the one for the patient's sex; H / L / A flags are worked out when the values are saved;
//   - a saved report keeps the range it was entered against (editing normal values later never rewrites it);
//   - the editor refuses nonsense (lower above upper, no name, text where a number belongs);
//   - AGE GROUPS (owner, 2026-10-30: "it should automatically choose which age group or gender it is", "newborn = less than 28 days", "all these ranges should be editable"):
//     newborn / infant / child / adolescent ranges (boys and girls apart) come with the defaults, the group and the sex are picked from the patient on the day of the test,
//     the limits and every range are editable, and a report keeps the range it was entered against.
import { boot, call, attempt, getDb } from './harness';
import { seedLabParameterDefaults } from '../../src/db/labParams';
import { DEFAULT_LIMITS, ageInDays, flagFor, groupOf, groupSpans, hasNumbers, limitProblem, parseLimits, parseRangeSpec, pickRange, rangeText } from '../../src/lib/labRanges';
import { AGE_RANGES, LAB_PANELS } from '../../src/data/lab-parameters';
import { ok, eq, near, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const doc = await call('doctors:create', { name: 'Dr. Lab', specialty: 'GP', default_fee: 300 });
  const woman = await call('patients:create', { first_name: 'Leela', last_name: 'Lab', dob: '1990-01-01', gender: 'F', phone: '9500000001' });
  const man = await call('patients:create', { first_name: 'Manoj', last_name: 'Lab', dob: '1980-01-01', gender: 'M', phone: '9500000002' });
  const cbc = one("SELECT id FROM lab_tests WHERE lower(name) LIKE 'complete blood count%'");

  section('1 · the common tests arrive with their parameters and normal values');
  ok(!!cbc, 'CBC is in the test list');
  const g = await call('lab:getParams', cbc.id);
  ok(g.ok && g.params.length === 14 && g.has_default, `CBC has its ${g.params?.length} parameters (Hb, RBC, PCV, MCV, MCH, MCHC, RDW, TLC, 5 differential counts, platelets)`);
  const hb = g.params.find((p: any) => /Haemoglobin/.test(p.name));
  eq([hb.m_low, hb.m_high, hb.f_low, hb.f_high].join(), '13,17,12,15', 'Hb: men 13 – 17, women 12 – 15 g/dL'); eq(hb.unit, 'g/dL', '…in g/dL');
  for (const t of ['Liver Function Test (LFT)', 'Kidney Function Test (KFT/RFT)', 'Lipid Profile', 'Thyroid Profile (T3 T4 TSH)', 'Urine Routine & Microscopy', 'Serum Electrolytes (Na/K/Cl)']) {
    const row = one('SELECT id FROM lab_tests WHERE name = ?', t); ok(!!row && (await call('lab:getParams', row.id)).params.length >= 3, `${t} has parameters`);
  }
  const before = one('SELECT COUNT(*) n FROM lab_test_params').n;
  db.prepare("DELETE FROM settings WHERE key='lab_params_seed_v1'").run(); seedLabParameterDefaults(db);
  eq(one('SELECT COUNT(*) n FROM lab_test_params').n, before, 'running the defaults again adds nothing twice');
  const fbs = one("SELECT id FROM lab_tests WHERE name LIKE 'Fasting Blood Sugar%'");
  await call('lab:saveParams', fbs.id, [{ name: 'My own FBS', unit: 'mg/dL', low: 60, high: 90 }]);
  db.prepare("DELETE FROM settings WHERE key='lab_params_seed_v1'").run(); seedLabParameterDefaults(db);
  eq((await call('lab:getParams', fbs.id)).params[0].name, 'My own FBS', 'a test the clinic changed is never overwritten by the defaults');
  const ownTest = await call('lab:upsertTest', { name: 'My Special Test', price: 100, category: 'pathology' });
  const og = await call('lab:getParams', ownTest.id); ok(og.ok && og.params.length === 0 && !og.has_default, 'a test of the clinic’s own starts with none and no standard values');
  ok(!(await call('lab:resetParams', ownTest.id)).ok, '…and “reset to defaults” says so in words');

  section('2 · the normal range is the one for the patient; the flags are worked out');
  const orderW = await call('lab:createOrder', { appointment_id: null, patient_id: woman.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'Complete Blood Count (CBC)' }] });
  const itemW = (await call('lab:getOrderItems', orderW.id))[0];
  eq(itemW.param_count, 14, 'the order item knows it has 14 parameters');
  let sheet = (await call('lab:resultSheet', orderW.id))[0];
  const hbRow = sheet.rows.find((r: any) => /Haemoglobin/.test(r.name));
  eq(hbRow.range_text, '12 - 15', 'a woman’s Hb range is 12 - 15'); eq(hbRow.value, '', '…nothing entered yet');
  const orderM = await call('lab:createOrder', { appointment_id: null, patient_id: man.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  eq((await call('lab:resultSheet', orderM.id))[0].rows.find((r: any) => /Haemoglobin/.test(r.name)).range_text, '13 - 17', 'a man’s is 13 - 17');
  const key = (name: RegExp) => sheet.rows.find((r: any) => name.test(r.name)).key;
  const saved = await call('lab:saveResultValues', orderW.id, itemW.id, [
    { key: key(/Haemoglobin/), value: '9.2' }, { key: key(/WBC/), value: '14,200' }, { key: key(/Platelet/), value: '250000' }, { key: key(/Neutrophils/), value: '60' }, { key: key(/MCV/), value: '79' },
  ]);
  ok(saved.ok, 'the values are saved');
  const f = (n: RegExp) => saved.item.rows.find((r: any) => n.test(r.name)).flag;
  eq([f(/Haemoglobin/), f(/WBC/), f(/Platelet/), f(/Neutrophils/), f(/MCV/)].join(), 'L,H,,,L', 'Hb 9.2 is L, TLC 14,200 is H, platelets and neutrophils are fine, MCV 79 is L');
  const after = (await call('lab:getOrderItems', orderW.id))[0];
  eq(after.is_abnormal, 1, 'the test is marked abnormal'); ok(/Haemoglobin.*9\.2.*\(L\)/.test(after.result) && /\(H\)/.test(after.result), `…and carries a summary (“${after.result}”)`);
  eq(after.value_count, 14, 'every parameter of the test is kept with the report');

  section('3 · a saved report keeps the range it was entered against');
  await call('lab:saveParams', cbc.id, g.params.map((p: any) => p.name === hb.name ? { ...p, f_low: 5, f_high: 6, m_low: 5, m_high: 6 } : p));
  sheet = (await call('lab:resultSheet', orderW.id))[0];
  eq(sheet.rows.find((r: any) => /Haemoglobin/.test(r.name)).range_text, '12 - 15', 'the report already made still shows 12 - 15');
  const orderW2 = await call('lab:createOrder', { appointment_id: null, patient_id: woman.id, doctor_id: doc.id, items: [{ lab_test_id: cbc.id, test_name: 'CBC' }] });
  eq((await call('lab:resultSheet', orderW2.id))[0].rows.find((r: any) => /Haemoglobin/.test(r.name)).range_text, '5 - 6', 'a new order uses the new normal values');
  const reset = await call('lab:resetParams', cbc.id);
  ok(reset.ok && reset.params.length === 14, 'reset to defaults brings the standard values back');
  const again = await call('lab:saveResultValues', orderW.id, itemW.id, [{ key: sheet.rows.find((r: any) => /Haemoglobin/.test(r.name)).key, value: '12.5' }]);
  eq(again.item.rows.find((r: any) => /Haemoglobin/.test(r.name)).flag, '', 'correcting a value re-flags it against the frozen range (12.5 is normal for a woman)');
  eq(again.item.rows.find((r: any) => /WBC/.test(r.name)).value, '14,200', '…and leaves the other values as they were');

  section('4 · qualitative results and values that are only shown');
  const urine = one("SELECT id FROM lab_tests WHERE name LIKE 'Urine Routine%'");
  const uo = await call('lab:createOrder', { appointment_id: null, patient_id: man.id, doctor_id: doc.id, items: [{ lab_test_id: urine.id, test_name: 'Urine Routine' }] });
  const us = (await call('lab:resultSheet', uo.id))[0]; const uk = (n: RegExp) => us.rows.find((r: any) => n.test(r.name)).key;
  const ur = await call('lab:saveResultValues', uo.id, us.item_id, [{ key: uk(/Protein/), value: 'Trace' }, { key: uk(/Glucose/), value: 'Nil' }, { key: uk(/Colour/), value: 'Dark yellow' }, { key: uk(/Pus/), value: '12' }, { key: uk(/pH/), value: '6.0' }]);
  const uf = (n: RegExp) => ur.item.rows.find((r: any) => n.test(r.name)).flag;
  eq([uf(/Protein/), uf(/Glucose/), uf(/Colour/), uf(/Pus/), uf(/pH/)].join(), 'A,,,H,', 'protein “Trace” is flagged abnormal, “Nil” is not, colour is never flagged, 12 pus cells is high, pH 6.0 is fine');
  eq(us.rows.find((r: any) => /Pus/.test(r.name)).grp, 'Microscopy', 'the parameters are grouped (Physical / Chemical / Microscopy)');

  section('5 · the editor refuses nonsense');
  for (const [what, list] of [['a lower value above the upper', [{ name: 'X', low: 10, high: 5 }]], ['no name', [{ name: '  ', low: 1, high: 2 }]], ['text where a number belongs', [{ name: 'X', low: 'abc' }]], ['too many parameters', Array.from({ length: 81 }, (_, i) => ({ name: `P${i}` }))]] as [string, any[]][]) {
    const r = await call('lab:saveParams', cbc.id, list); ok(!r.ok && r.error.length > 5, `${what} is refused in words`);
  }
  ok(!(await call('lab:saveParams', 999999, [{ name: 'X' }])).ok, 'a test that does not exist is refused');
  ok(!(await call('lab:saveResultValues', orderM.id, itemW.id, [{ key: 'p1', value: '1' }])).ok, 'results cannot be written to a test of another order');
  ok(!(await call('lab:saveResultValues', orderW.id, itemW.id, [{ key: 'v1', value: 'x'.repeat(300) }])).ok, 'a huge value is refused');
  const rm = await attempt('lab:removeOrderItem', orderW.id, itemW.id); ok(!rm.ok || (rm as any).value?.ok === false, 'a test with results entered cannot be removed from its order (it is evidence)');

  section('6 · the range rules on their own');
  eq(rangeText(parseRangeSpec('M13-17;F12-15'), null), 'M 13 - 17 · F 12 - 15', 'sex unknown: both ranges are printed');
  eq(rangeText(parseRangeSpec('<140'), 'M'), '< 140', 'an upper limit prints as “< 140”'); eq(rangeText(parseRangeSpec('M>40;F>50'), 'F'), '> 50', 'a lower limit prints as “> 50”');
  eq(rangeText(parseRangeSpec('<100|Optimal < 100'), null), '< 100', 'a range keeps its number');
  eq(flagFor('140', parseRangeSpec('<140'), null), '', 'exactly at the limit is normal'); eq(flagFor('141', parseRangeSpec('<140'), null), 'H', 'above it is high');
  eq(flagFor('<2', parseRangeSpec('4-10'), null), 'L', 'a value typed with < is compared as its number (“<2” is below 4)'); eq(flagFor('>20', parseRangeSpec('4-10'), null), 'H', '…and “>20” is above 10'); eq(flagFor('', parseRangeSpec('4-10'), null), '', 'blank is never flagged');
  eq(flagFor('Positive', parseRangeSpec('Negative'), null), 'A', 'a qualitative result that is not the normal text is abnormal'); eq(flagFor('negative ', parseRangeSpec('Negative'), null), '', '…and matching ignores case and spaces');
  section('7 · the normal range is chosen automatically: age group and sex, from the patient');
  const DAY = '2026-06-15 10:00:00';                                                    // a fixed test day, so the ages are exact in every time zone
  const dobFor = (days: number) => new Date(Date.parse('2026-06-15T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
  let pn = 10;
  const mkPt = async (first: string, dob: string | null, gender: string) => {
    const p = await call('patients:create', { first_name: first, last_name: 'Age', dob: dob ?? '2000-01-01', gender, phone: '95000002' + String(++pn).padStart(2, '0') });
    if (!dob) db.prepare("UPDATE patients SET dob = '' WHERE id = ?").run(p.id);                  // the column cannot be NULL; an empty date of birth (old imported data) is the closest thing
    return p;
  };
  const kid = await mkPt('Kavya', '2022-03-10', 'F');          // 4 years 3 months (1558 days) on DAY
  const baby = await mkPt('Bobby', dobFor(10), 'M');            // 10 days
  const infantP = await mkPt('Indu', dobFor(100), 'F');          // 100 days
  const girl14 = await mkPt('Tara', '2012-02-01', 'F'); const boy14 = await mkPt('Tarun', '2012-02-01', 'M');
  const nodob = await mkPt('Nodob', null, 'F'); const other = await mkPt('Oscar', '1990-05-05', 'Other');
  const mk = async (pt: any, test: any = cbc) => {
    const o = await call('lab:createOrder', { appointment_id: null, patient_id: pt.id, doctor_id: doc.id, items: [{ lab_test_id: test.id, test_name: 'CBC' }] });
    db.prepare('UPDATE lab_orders SET ordered_at = ? WHERE id = ?').run(DAY, o.id);
    return { o, sheet: (await call('lab:resultSheet', o.id))[0] };
  };
  const rowOf = (sh: any, re: RegExp) => sh.rows.find((r: any) => re.test(r.name));
  const hbOf = async (pt: any) => rowOf((await mk(pt)).sheet, /Haemoglobin/).range_text;
  eq(ageInDays('2022-03-10', DAY), 1558, 'age in days is counted from the date of birth to the TEST day'); eq(ageInDays('2026-07-01', DAY), null, 'a date of birth after the test day gives no age'); eq(ageInDays('', DAY), null, '…and so does an empty one');

  const K = await mk(kid);
  eq(K.sheet.ref_for, 'Child · 4 years · Female', 'a 4-year-old girl: the sheet says Child · 4 years · Female — nobody chose it'); ok(K.sheet.ref_dep && !K.sheet.no_age, '…and that the ranges depend on it');
  eq([rowOf(K.sheet, /Haemoglobin/).range_text, rowOf(K.sheet, /WBC/).range_text, rowOf(K.sheet, /Platelet/).range_text].join(' | '), '11.5 - 14.5 | 5,000 - 15,500 | 1,50,000 - 4,50,000', 'her ranges are the child ranges (an adult woman’s Hb is 12 - 15, TLC 4,000 - 11,000)');
  const KS = await call('lab:saveResultValues', K.o.id, K.sheet.item_id, [{ key: rowOf(K.sheet, /Haemoglobin/).key, value: '11.0' }, { key: rowOf(K.sheet, /WBC/).key, value: '14,000' }, { key: rowOf(K.sheet, /Platelet/).key, value: '420000' }, { key: rowOf(K.sheet, /MCV/).key, value: '80' }]);
  const kf = (re: RegExp) => KS.item.rows.find((r: any) => re.test(r.name)).flag;
  eq([kf(/Haemoglobin/), kf(/WBC/), kf(/Platelet/), kf(/MCV/)].join(), 'L,,,', 'child: Hb 11.0 is low; TLC 14,000 and platelets 4,20,000 are normal for a child; MCV 80 is normal');
  ok(KS.item.rows.some((r: any) => r.by_age), '…the rows remember that their range came from an age group');
  const cur = (await call('lab:getParams', cbc.id)).params; const pk = (re: RegExp) => 'p' + cur.find((p: any) => re.test(p.name)).id;
  const adultSame = await call('lab:saveResultValues', orderW2.id, (await call('lab:getOrderItems', orderW2.id))[0].id, [{ key: pk(/WBC/), value: '14,000' }, { key: pk(/Platelet/), value: '420000' }]);
  eq([adultSame.item.rows.find((r: any) => /WBC/.test(r.name)).flag, adultSame.item.rows.find((r: any) => /Platelet/.test(r.name)).flag].join(), 'H,H', 'the same two results on an adult woman are both High');
  eq(adultSame.item.ref_for, 'Adult · 36 years · Female', '…and her sheet says Adult · 36 years · Female');

  const B = await mk(baby);
  eq([B.sheet.ref_for, rowOf(B.sheet, /Haemoglobin/).range_text].join(' | '), 'Newborn · 10 days · Male | 13.4 - 19.8', 'a 10-day-old boy: newborn, Hb 13.4 - 19.8');
  const BS = await call('lab:saveResultValues', B.o.id, B.sheet.item_id, [{ key: rowOf(B.sheet, /Haemoglobin/).key, value: '18.5' }]);
  eq(BS.item.rows.find((r: any) => /Haemoglobin/.test(r.name)).flag, '', 'Hb 18.5 is normal for a newborn (it would be High for a man)');
  eq(await hbOf(infantP), '10.5 - 13.5', 'a 100-day-old girl is an infant: Hb 10.5 - 13.5');
  eq([await hbOf(girl14), await hbOf(boy14)].join(' | '), '12 - 16 | 13 - 16', 'a 14-year-old girl and boy get their own adolescent ranges (girls 12 - 16, boys 13 - 16)');
  eq((await mk(girl14)).sheet.ref_for, 'Adolescent · 14 years · Female', '…labelled Adolescent');

  section('8 · the cut-offs between the groups (newborn = under 28 days)');
  eq([await hbOf(await mkPt('Day27', dobFor(27), 'M')), await hbOf(await mkPt('Day28', dobFor(28), 'M'))].join(' | '), '13.4 - 19.8 | 10.5 - 13.5', '27 days old is still a newborn; at 28 days the infant range applies');
  eq([(await mk(await mkPt('Day27b', dobFor(27), 'M'))).sheet.ref_for.split(' · ')[0], (await mk(await mkPt('Day28b', dobFor(28), 'M'))).sheet.ref_for.split(' · ')[0]].join(), 'Newborn,Infant', '…and the sheet names the group');
  eq([await hbOf(await mkPt('Y1m', dobFor(364), 'F')), await hbOf(await mkPt('Y1', dobFor(365), 'F'))].join(' | '), '10.5 - 13.5 | 11.5 - 14.5', 'infant until the 1st birthday, then child');
  eq([await hbOf(await mkPt('Y12m', dobFor(4382), 'F')), await hbOf(await mkPt('Y12', dobFor(4383), 'F'))].join(' | '), '11.5 - 14.5 | 12 - 16', 'child until the 12th birthday, then adolescent');
  eq([await hbOf(await mkPt('Y18m', dobFor(6574), 'F')), await hbOf(await mkPt('Y18', dobFor(6575), 'F'))].join(' | '), '12 - 16 | 12 - 15', 'adolescent until the 18th birthday, then the ordinary adult range');
  const N = await mk(nodob);
  eq(rowOf(N.sheet, /Haemoglobin/).range_text, '12 - 15', 'no usable date of birth: the adult range is used'); ok(N.sheet.no_age === true, '…and the sheet warns that the date of birth is missing'); eq(N.sheet.ref_for, 'Female', '…saying only what is known (the sex)');
  const O = await mk(other); eq(rowOf(O.sheet, /Haemoglobin/).range_text, 'M 13 - 17 · F 12 - 15', 'sex not male or female: both adult ranges are shown');
  const OS = await call('lab:saveResultValues', O.o.id, O.sheet.item_id, [{ key: rowOf(O.sheet, /Haemoglobin/).key, value: '9' }]);
  eq(rowOf(OS.item, /Haemoglobin/).range_text, 'M 13 - 17 · F 12 - 15', '…and the saved report still prints both (the printed range is kept with the report)');
  const urineOrder = await call('lab:createOrder', { appointment_id: null, patient_id: kid.id, doctor_id: doc.id, items: [{ lab_test_id: urine.id, test_name: 'Urine' }] });
  const us2 = (await call('lab:resultSheet', urineOrder.id))[0]; ok(us2.ref_for.startsWith('Child') && !us2.ref_dep && !us2.no_age, 'a test whose ranges do not depend on age or sex (urine) does not claim they do — nothing is printed about it');

  section('9 · the rules on their own');
  const full = (await call('lab:getParams', cbc.id)).params; const tlc = full.find((p: any) => /WBC/.test(p.name)); const hb2 = full.find((p: any) => /Haemoglobin/.test(p.name));
  eq(groupOf(null), null, 'no age: no group'); eq([0, 27, 28, 364, 365, 4382, 4383, 6574, 6575].map((d) => groupOf(d)).join(), 'newborn,newborn,infant,infant,child,child,adolescent,adolescent,adult', 'the five groups and their edges');
  eq(JSON.stringify(groupSpans()), JSON.stringify({ newborn: 'under 28 days', infant: '28 days to under 1 year', child: '1 year to under 12 years', adolescent: '12 to under 18 years', adult: '18 years and over' }), 'each group says in words what it covers');
  const p0 = pickRange(hb2, 0, 'M'); ok(p0.by_age && p0.high === 19.8 && p0.group === 'newborn', 'a baby born today gets the newborn range');
  ok(!pickRange(hb2, null, 'F').by_age && pickRange(hb2, null, 'F').high === 15, 'no age: the ordinary range');
  const sexless = pickRange(hb2, 5114, null); ok(!sexless.by_age && sexless.text === 'M 13 - 17 · F 12 - 15', 'sex unknown and the adolescent range is for boys and girls separately: never a guess — the adult ranges are shown');
  const only = { ranges: [{ grp: 'child', low: null, high: null, m_low: 2, m_high: 3, f_low: null, f_high: null, ref_text: null, no_flag: false }], low: 1, high: 9 } as any;
  eq([pickRange(only, 1000, 'M').high, pickRange(only, 1000, 'F').high, pickRange(only, 1000, null).high].join(), '3,9,9', 'a child range given for boys only is used for boys; girls and unknown sex use the ordinary range');
  ok(pickRange({ ranges: [{ grp: 'infant', low: null, high: null, m_low: null, m_high: null, f_low: null, f_high: null, ref_text: 'See note', no_flag: true }] } as any, 100, 'F').no_flag, 'a group with words only is never flagged');
  eq(limitProblem(DEFAULT_LIMITS), null, 'the standard limits are valid'); eq(parseLimits('garbage').newborn_days, 28, 'unreadable saved limits fall back to the standard ones');

  section('10 · the standard children’s ranges are sound');
  const names = new Set<string>(); for (const p of LAB_PANELS) for (const l of p.params) names.add(l[0]);
  const orphan = Object.keys(AGE_RANGES).filter((k) => !names.has(k)); eq(orphan.length, 0, `every standard children’s range belongs to a parameter that exists${orphan.length ? ': ' + orphan.join(', ') : ''}`);
  const problems: string[] = [];
  for (const [k, specs] of Object.entries(AGE_RANGES)) {
    if (specs.length !== 4) problems.push(`${k}: needs four groups`);
    if (specs.every((x) => !x)) problems.push(`${k}: has nothing`);
    for (const x of specs) { if (!x) continue; const sp = parseRangeSpec(x); const pairs: [any, any][] = [[sp.low, sp.high], [sp.m_low, sp.m_high], [sp.f_low, sp.f_high]];
      if (!hasNumbers(sp) && !sp.ref_text) problems.push(`${k}: “${x}” has nothing to show`);
      for (const [a, b] of pairs) if (a != null && b != null && a > b) problems.push(`${k}: “${x}” is backwards`); }
  }
  eq(problems.length, 0, `no standard children’s range is backwards or empty${problems.length ? ': ' + problems.slice(0, 4).join('; ') : ''}`);
  const nRanges = one('SELECT COUNT(*) n FROM lab_param_ranges').n;
  ok(Object.keys(AGE_RANGES).length >= 25 && nRanges > 100, `children’s ranges come ready (${nRanges} group rows across ${Object.keys(AGE_RANGES).length} parameters)`);
  ok(tlc.ranges.length === 4 && tlc.ranges.map((g: any) => g.grp).join() === 'newborn,infant,child,adolescent', 'a parameter’s groups come back in order: newborn, infant, child, adolescent');

  section('11 · the lab can edit every range and the limits; a report keeps the range it was entered against');
  const lim0 = await call('lab:getAgeGroups'); eq(JSON.stringify(lim0.limits), JSON.stringify(DEFAULT_LIMITS), 'the age limits start at the standard ones');
  const kidTlc = (p: any) => (p === tlc ? { ...p, ranges: p.ranges.map((g: any) => (g.grp === 'child' ? { ...g, low: '1000', high: '2000' } : g)) } : p);
  await call('lab:saveParams', cbc.id, full.map(kidTlc));
  eq(rowOf((await call('lab:resultSheet', K.o.id))[0], /WBC/).range_text, '5,000 - 15,500', 'the child’s report already made still shows the range it was entered with');
  eq(rowOf((await mk(kid)).sheet, /WBC/).range_text, '1,000 - 2,000', 'a new order for a child uses the edited child range');
  eq((await call('lab:getParams', cbc.id)).params.find((p: any) => /WBC/.test(p.name)).ranges.length, 4, 'saving the parameters keeps all their groups');
  await call('lab:saveParams', cbc.id, full.map((p: any) => (p === tlc ? { ...p, ranges: [] } : p)));
  eq(rowOf((await mk(kid)).sheet, /WBC/).range_text, '4,000 - 11,000', 'a parameter with no children’s ranges gives children the ordinary range');
  eq(one('SELECT COUNT(*) n FROM lab_param_ranges r LEFT JOIN lab_test_params p ON p.id = r.param_id WHERE p.id IS NULL').n, 0, 'no group row is left behind when parameters are replaced');
  const rs = await call('lab:resetParams', cbc.id); ok(rs.ok && rs.params.find((p: any) => /WBC/.test(p.name)).ranges.length === 4, '“Reset to standard values” brings the children’s ranges back too');

  const own = await call('lab:saveParams', ownTest.id, [{ name: 'My own', unit: 'u', low: '1', high: '5', ranges: [{ grp: 'child', m_low: '2', m_high: '3', f_low: '2.5', f_high: '3.5', ref_text: 'ignored' }, { grp: 'newborn', ref_text: 'See note' }, { grp: 'infant' }] }]);
  ok(own.ok, 'a lab’s own children’s ranges are saved (numbers typed as text, with decimals)');
  eq(own.params[0].ranges.map((g: any) => `${g.grp}:${g.m_low}-${g.m_high}/${g.f_low}-${g.f_high}:${g.ref_text}:${g.no_flag}`).join(' | '), 'newborn:null-null/null-null:See note:true | child:2-3/2.5-3.5:null:false',
    'a group with nothing is dropped (= adult range), a group with only words is never flagged, a group with numbers keeps no words');
  const ownBoy = await call('lab:createOrder', { appointment_id: null, patient_id: (await mkPt('Own boy', dobFor(1500), 'M')).id, doctor_id: doc.id, items: [{ lab_test_id: ownTest.id, test_name: 'My Special Test' }] });
  const ownGirl = await call('lab:createOrder', { appointment_id: null, patient_id: (await mkPt('Own girl', dobFor(1500), 'F')).id, doctor_id: doc.id, items: [{ lab_test_id: ownTest.id, test_name: 'My Special Test' }] });
  eq([(await call('lab:resultSheet', ownBoy.id))[0].rows[0].range_text, (await call('lab:resultSheet', ownGirl.id))[0].rows[0].range_text].join(' | '), '2 - 3 | 2.5 - 3.5', 'the same child range gives a boy 2 - 3 and a girl 2.5 - 3.5 — the sex is picked by itself');
  for (const [what, ranges] of [
    ['an unknown age group', [{ grp: 'toddler', low: 1, high: 2 }]], ['the same group twice', [{ grp: 'child', low: 1, high: 2 }, { grp: 'child', low: 3, high: 4 }]], ['text where a number belongs', [{ grp: 'child', low: 'x' }]],
    ['a lower value above the upper (everyone)', [{ grp: 'child', low: 9, high: 2 }]], ['a lower value above the upper (boys)', [{ grp: 'infant', m_low: 9, m_high: 2 }]], ['a note that is too long', [{ grp: 'infant', ref_text: 'x'.repeat(101) }]], ['groups that are not a list', 'nope'],
  ] as [string, any][]) {
    const r = await call('lab:saveParams', ownTest.id, [{ name: 'X', ranges }]); ok(!r.ok && r.error.length > 8, `${what} is refused in words${r.ok ? '' : ` (“${r.error.slice(0, 64)}”)`}`);
  }
  eq((await call('lab:getParams', ownTest.id)).params[0].name, 'My own', 'a refused save changes nothing');

  const l1 = await call('lab:saveAgeGroups', { newborn_days: 30, infant_months: 18, child_years: 10, adolescent_years: 16 });
  ok(l1.ok && l1.limits.newborn_days === 30, 'the lab can change the age limits');
  eq([await hbOf(await mkPt('Lim28', dobFor(28), 'M')), await hbOf(await mkPt('Lim30', dobFor(30), 'M')), await hbOf(await mkPt('Lim11y', dobFor(4018), 'F'))].join(' | '), '13.4 - 19.8 | 10.5 - 13.5 | 12 - 16', 'with the new limits 28 days is still a newborn, 30 days an infant, and an 11-year-old an adolescent');
  eq(rowOf((await call('lab:resultSheet', K.o.id))[0], /WBC/).range_text, '5,000 - 15,500', 'a report already made does not change when the limits change');
  for (const [what, bad] of [['a newborn limit of 0 days', { newborn_days: 0, infant_months: 12, child_years: 12, adolescent_years: 18 }], ['a newborn limit above 90 days', { newborn_days: 120, infant_months: 12, child_years: 12, adolescent_years: 18 }],
    ['limits out of order', { newborn_days: 90, infant_months: 2, child_years: 12, adolescent_years: 18 }], ['an adolescent limit below the child limit', { newborn_days: 28, infant_months: 12, child_years: 14, adolescent_years: 12 }],
    ['a limit that is not a number', { newborn_days: 'abc', infant_months: 12, child_years: 12, adolescent_years: 18 }], ['missing limits', {}]] as [string, any][]) {
    const r = await call('lab:saveAgeGroups', bad); ok(!r.ok && r.error.length > 8, `${what} is refused in words (“${String(r.error).slice(0, 56)}”)`);
  }
  eq((await call('lab:getAgeGroups')).limits.newborn_days, 30, '…and a refused save changes nothing');
  await call('lab:saveAgeGroups', DEFAULT_LIMITS); eq((await call('lab:getAgeGroups')).limits.newborn_days, 28, 'the standard limits can be put back');

  section('12 · the printed report says whose ranges they are');
  const rep = await call('lab:reportData', K.o.id);
  eq([rep.patient.age, rep.patient.sex, rep.items[0].ref_for, rep.items[0].ref_dep].join(' | '), '4 y 3 m | Female | Child · 4 years · Female | true', 'the report carries the age on the test day and whose ranges are printed');
  eq((await call('lab:reportData', B.o.id)).patient.age, '10 d', 'a newborn’s age is printed in days');
  section('13 · “Re-apply normal ranges”: after a date of birth is corrected or the normal values are edited');
  const wrong = await mkPt('Wrongdob', '1990-01-01', 'F');                                // a 4-year-old girl registered with an ADULT date of birth
  const W = await mk(wrong);
  eq(rowOf(W.sheet, /WBC/).range_text, '4,000 - 11,000', 'with the wrong date of birth the adult range is shown');
  const WS = await call('lab:saveResultValues', W.o.id, W.sheet.item_id, [{ key: rowOf(W.sheet, /Haemoglobin/).key, value: '13.0' }, { key: rowOf(W.sheet, /WBC/).key, value: '14,000' }]);
  eq([rowOf(WS.item, /Haemoglobin/).flag, rowOf(WS.item, /WBC/).flag].join(), ',H', 'TLC 14,000 is flagged High against the adult range');
  db.prepare('UPDATE patients SET dob = ? WHERE id = ?').run('2022-03-10', wrong.id);          // the date of birth is corrected
  eq(rowOf((await call('lab:resultSheet', W.o.id))[0], /WBC/).range_text, '4,000 - 11,000', 'a saved report does not change by itself (it keeps the range it was made with)');
  const RC = await call('lab:recalcRanges', W.o.id, W.sheet.item_id);
  ok(RC.ok && RC.changed >= 3 && RC.reflagged === 1, `“Re-apply” reworks the ranges (${RC.changed} changed) and the marks (${RC.reflagged} changed)`);
  eq([rowOf(RC.item, /WBC/).range_text, rowOf(RC.item, /WBC/).value, rowOf(RC.item, /WBC/).flag].join(' | '), '5,000 - 15,500 | 14,000 | ', 'TLC now shows the child range, the typed value stays, and it is no longer flagged');
  eq([rowOf(RC.item, /Haemoglobin/).range_text, rowOf(RC.item, /Haemoglobin/).value].join(' | '), '11.5 - 14.5 | 13.0', 'Hb too');
  eq(RC.item.ref_for, 'Child · 4 years · Female', '…and the sheet now says it is a child');
  const wi = one('SELECT result, is_abnormal FROM lab_order_items WHERE id = ?', W.sheet.item_id);
  ok(wi.is_abnormal === 0 && /within the normal range/.test(wi.result), 'the test is no longer marked abnormal and its summary is redone');
  const twice = await call('lab:recalcRanges', W.o.id, W.sheet.item_id); eq([twice.changed, twice.reflagged, twice.kept].join(), '0,0,0', 'applying it again changes nothing');
  ok(one("SELECT COUNT(*) n FROM audit_log WHERE action = 'lab_ranges_reapplied'").n >= 2, 'every re-apply is written to the audit log');
  eq((await call('lab:reportData', W.o.id)).items[0].ref_for, 'Child · 4 years · Female', 'the printed report uses the re-applied ranges');

  const now13 = (await call('lab:getParams', cbc.id)).params;
  await call('lab:saveParams', cbc.id, now13.map((p: any) => (/WBC/.test(p.name) ? { ...p, ranges: p.ranges.map((g: any) => (g.grp === 'child' ? { ...g, low: '1000', high: '2000' } : g)) } : p)));
  const RC2 = await call('lab:recalcRanges', W.o.id, W.sheet.item_id);
  eq([rowOf(RC2.item, /WBC/).range_text, rowOf(RC2.item, /WBC/).flag].join(' | '), '1,000 - 2,000 | H', 'after the lab edits its normal values, re-apply picks them up (the parameter is found by name even though its row was replaced)');
  await call('lab:saveParams', cbc.id, now13.filter((p: any) => !/WBC/.test(p.name)));
  const RC3 = await call('lab:recalcRanges', W.o.id, W.sheet.item_id);
  ok(RC3.ok && RC3.kept === 1 && rowOf(RC3.item, /WBC/).range_text === '1,000 - 2,000', 'a value whose parameter was removed from the test keeps the range it was entered with');
  await call('lab:resetParams', cbc.id);
  eq(rowOf((await call('lab:recalcRanges', W.o.id, W.sheet.item_id)).item, /WBC/).range_text, '5,000 - 15,500', 'after “Reset to standard values” a re-apply brings the standard child range');
  ok(!(await call('lab:recalcRanges', orderM.id, W.sheet.item_id)).ok, 'a test of another order is refused');
  const fresh = await mk(kid); const nr = await call('lab:recalcRanges', fresh.o.id, fresh.sheet.item_id); ok(!nr.ok && /Nothing has been saved/.test(nr.error), 'a test with nothing saved yet says so in words');
  section('14 · the standard test list is wide and sound (what other laboratories run)');
  const normName = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const CATS = ['haematology', 'biochemistry', 'serology', 'microbiology', 'clinical_pathology', 'histopathology'];
  const seenName = new Map<string, string>(); const listProblems: string[] = [];
  for (const p of LAB_PANELS) {
    if (!CATS.includes(p.category)) listProblems.push(`${p.test}: category “${p.category}”`);
    if (!p.params.length) listProblems.push(`${p.test}: no parameters`);
    const pn = new Set<string>(); for (const l of p.params) { if (pn.has(l[0])) listProblems.push(`${p.test}: “${l[0]}” twice`); pn.add(l[0]);
      const sp = parseRangeSpec(l[2].replace(/^~/, '')); if (!hasNumbers(sp) && !sp.ref_text && l[2].replace(/^~/, '') !== '') listProblems.push(`${p.test}: “${l[0]}” range “${l[2]}” is not understood`);
      for (const [a, b] of [[sp.low, sp.high], [sp.m_low, sp.m_high], [sp.f_low, sp.f_high]] as [any, any][]) if (a != null && b != null && a > b) listProblems.push(`${p.test}: “${l[0]}” is backwards`); }
    for (const n of [p.test, ...(p.aliases ?? [])]) { const k = normName(n); if (seenName.has(k) && seenName.get(k) !== p.test) listProblems.push(`“${n}” names both ${seenName.get(k)} and ${p.test}`); seenName.set(k, p.test); }
  }
  eq(listProblems.length, 0, `every standard test has a valid category, parameters, understood ranges and a name of its own${listProblems.length ? ': ' + listProblems.slice(0, 5).join('; ') : ''}`);
  ok(LAB_PANELS.length >= 150, `${LAB_PANELS.length} standard tests (${LAB_PANELS.reduce((n, p) => n + p.params.length, 0)} results with normal values)`);
  const want = ['C-Reactive Protein (CRP)', 'hs-CRP', 'HbA1c', 'Vitamin D (25-OH)', 'Vitamin B12', 'Serum Ferritin', 'Procalcitonin', 'D-Dimer', 'Troponin I', 'CPK (Total)', 'NT-proBNP', 'Free T3 (FT3)', 'Free T4 (FT4)', 'Prolactin', 'FSH', 'LH', 'Testosterone (Total)', 'Beta hCG (Quantitative)', 'Cortisol (Morning)',
    'Fasting Insulin', 'Oral Glucose Tolerance Test (OGTT 75 g)', 'Arterial Blood Gas (ABG)', 'CA-125', 'CEA', 'AFP (Alpha Fetoprotein)', 'PSA (Prostate Specific Antigen)', 'ASO Titre', 'Anti-CCP', 'ANA (Antinuclear Antibody)', 'Dengue IgM & IgG', 'Dengue NS1 Antigen', 'Malaria Parasite (Smear)',
    'Reticulocyte Count', 'Peripheral Blood Smear', 'Urine Culture & Sensitivity', 'Blood Culture & Sensitivity', 'Sputum for AFB', 'CSF Analysis', 'Urine Microalbumin', 'Serum Sodium', 'Serum Potassium', 'Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'Triglycerides'];
  const have = new Set(LAB_PANELS.map((p) => p.test)); const missing = want.filter((w) => !have.has(w)); eq(missing.length, 0, `the usual tests are all there${missing.length ? ' — MISSING: ' + missing.join(', ') : ''}`);
  const crp = one("SELECT id FROM lab_tests WHERE name = 'C-Reactive Protein (CRP)'"); const crpP = (await call('lab:getParams', crp.id)).params;
  eq(`${crpP[0].name} ${crpP[0].unit} ${crpP[0].high}`, 'C-reactive protein (CRP) mg/L 6', 'CRP arrives with its unit and normal range (below 6 mg/L)');
  const sodium = one("SELECT id FROM lab_tests WHERE name = 'Serum Potassium'"); eq((await call('lab:getParams', sodium.id)).params[0].ranges.length, 2, 'a single test shares the children’s ranges of its parameter (potassium: newborn and infant)');
  const cultOrder = await mk(await mkPt('Culture pt', '1985-03-03', 'F'), one("SELECT id FROM lab_tests WHERE name = 'Urine Culture & Sensitivity'"));
  const cultSave = await call('lab:saveResultValues', cultOrder.o.id, cultOrder.sheet.item_id, [{ key: rowOf(cultOrder.sheet, /Culture result/).key, value: 'E. coli > 100000 CFU/mL' }]);
  eq(rowOf(cultSave.item, /Culture result/).flag, 'A', 'a culture result other than “No growth” is marked Abnormal');
  const trop = await mk(await mkPt('Trop pt', '1960-03-03', 'M'), one("SELECT id FROM lab_tests WHERE name = 'Troponin I'"));
  const trSave = await call('lab:saveResultValues', trop.o.id, trop.sheet.item_id, [{ key: trop.sheet.rows[0].key, value: '0.8' }]); eq(trSave.item.rows[0].flag, 'H', 'a troponin I of 0.8 ng/mL is High');
  near(Number(one('SELECT COUNT(*) n FROM lab_test_params').n) > 100 ? 1 : 0, 1, 'the defaults hold well over 100 parameters');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
