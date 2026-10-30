// Lab normal values and structured results (owner, 2026-10-30: "a user must be able to set the normal values of each test — CBC: Hb x–y g/dL, TLC … — you set the
// defaults and they just type the values, save and print a proper report"). Real handlers on a temporary database.
//   - the common panels arrive with their parameters and normal values (CBC, LFT, KFT, lipid, thyroid, urine …); nothing the clinic made is overwritten;
//   - the normal range shown is the one for the patient's sex; H / L / A flags are worked out when the values are saved;
//   - a saved report keeps the range it was entered against (editing normal values later never rewrites it);
//   - the editor refuses nonsense (lower above upper, no name, text where a number belongs).
import { boot, call, attempt, getDb } from './harness';
import { seedLabParameterDefaults } from '../../src/db/labParams';
import { flagFor, parseRangeSpec, rangeText } from '../../src/lib/labRanges';
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
  near(Number(one('SELECT COUNT(*) n FROM lab_test_params').n) > 100 ? 1 : 0, 1, 'the defaults hold well over 100 parameters');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
