// "Load default vitals" in the consultation: typical NORMAL readings for the patient's group, to start from while typing.
// Rules proved here: the group follows the visit's Patient Group (ANC / Geriatric / Paediatric) or else the age; only temperature, pulse,
// breathing rate, SpO2 and blood pressure are ever filled; anything already typed is never replaced; weight and height are NEVER filled;
// and every group's numbers are sensible for that group.
import { boot } from './harness';
import { DEFAULT_VITALS, DEFAULTED_KEYS, vitalsGroupFor, withDefaultVitals, type VitalsGroup } from '../../src/lib/defaultVitals';
import { ok, eq, section, finish } from './lib';

boot();
const days = (years: number, months = 0) => Math.round(years * 365.25 + months * 30.4);

(async () => {
  section('1 · which group a patient is in');
  const cases: [string, number | null, string | null, VitalsGroup][] = [
    ['a 10-day-old baby', 10, null, 'Newborn'], ['a 6-month-old', days(0, 6), null, 'Infant'], ['a 2-year-old', days(2), null, 'Toddler'],
    ['a 4-year-old', days(4), null, 'Preschool child'], ['a 9-year-old', days(9), null, 'School-age child'], ['a 15-year-old', days(15), null, 'Adolescent'],
    ['a 30-year-old', days(30), null, 'Adult'], ['a 64-year-old', days(64), null, 'Adult'], ['a 70-year-old', days(70), null, 'Older adult'],
    ['a 28-year-old booked as ANC', days(28), 'ANC', 'Pregnancy (ANC)'], ['a 30-year-old booked as "Antenatal"', days(30), 'Antenatal', 'Pregnancy (ANC)'],
    ['a 55-year-old booked as Geriatric', days(55), 'Geriatric', 'Older adult'], ['a 7-year-old booked as Paediatric', days(7), 'Paediatric', 'School-age child'],
    ['an adult wrongly booked as Paediatric', days(40), 'Paediatric', 'Adolescent'], ['someone with no date of birth', null, null, 'Adult'],
    ['an unknown-age Paediatric visit', null, 'Paediatric', 'School-age child'], ['a "VIP" visit follows the age', days(8), 'VIP', 'School-age child'],
  ];
  for (const [who, age, group, want] of cases) eq(vitalsGroupFor(age, group), want, `${who} → ${want}`);

  section('2 · only the five vitals are filled, and never over what was typed');
  const r = withDefaultVitals({}, 'Adult');
  eq(r.filled.join(','), 'temp,pulse,rr,spo2,bp', 'an empty form gets exactly temperature, pulse, RR, SpO₂ and BP');
  eq(`${r.vitals.temp}|${r.vitals.pulse}|${r.vitals.rr}|${r.vitals.spo2}|${r.vitals.bp}`, '98.6|76|16|98|120/80', 'the adult defaults');
  ok(r.vitals.weight === undefined && r.vitals.height === undefined, 'weight and height are NEVER filled (they drive drug doses)');
  const typed = withDefaultVitals({ pulse: '104', bp: '  ', weight: '18', temp: '101.2' }, 'School-age child');
  eq(`${typed.vitals.pulse}|${typed.vitals.temp}|${typed.vitals.weight}`, '104|101.2|18', 'a pulse, a temperature and a weight already typed are kept exactly');
  eq(typed.filled.join(','), 'rr,spo2,bp', 'only the empty boxes (a blank BP counts as empty) were filled');
  const full = withDefaultVitals({ temp: '98', pulse: '70', rr: '14', spo2: '99', bp: '110/70' }, 'Adult');
  eq(full.filled.length, 0, 'with every box filled nothing is replaced');
  const again = withDefaultVitals(r.vitals, 'Adult');
  eq(again.filled.length, 0, 'pressing it twice does nothing the second time');

  section('3 · every group has sensible numbers');
  for (const [g, v] of Object.entries(DEFAULT_VITALS)) {
    const n = (k: string) => Number((v.vitals as any)[k]);
    const [sys, dia] = v.vitals.bp.split('/').map(Number);
    ok(DEFAULTED_KEYS.every((k) => String((v.vitals as any)[k] || '').length > 0), `${g}: all five vitals are present`);
    ok(n('temp') >= 97 && n('temp') <= 99.5, `${g}: temperature ${v.vitals.temp} °F is normal`);
    ok(n('spo2') >= 94 && n('spo2') <= 100, `${g}: SpO₂ ${v.vitals.spo2}% is normal`);
    ok(sys > dia && dia >= 40 && sys <= 140, `${g}: BP ${v.vitals.bp} is plausible`);
  }
  const hr = (g: VitalsGroup) => Number(DEFAULT_VITALS[g].vitals.pulse), rr = (g: VitalsGroup) => Number(DEFAULT_VITALS[g].vitals.rr);
  ok(hr('Newborn') > hr('Infant') && hr('Infant') > hr('Toddler') && hr('Toddler') > hr('Preschool child') && hr('Preschool child') > hr('School-age child') && hr('School-age child') > hr('Adolescent') && hr('Adolescent') > hr('Adult'),
    'pulse falls steadily from newborn to adult');
  ok(rr('Newborn') > rr('Infant') && rr('Infant') > rr('Toddler') && rr('Toddler') > rr('Preschool child') && rr('Preschool child') >= rr('School-age child') && rr('School-age child') >= rr('Adult'),
    'breathing rate falls steadily from newborn to adult');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
