// A doctor may prescribe a BRAND (Dolo 650); the chemical name goes in brackets beside it ("Dolo 650 (Paracetamol 650 mg)") on the screen and on the
// printed prescription. It is a snapshot taken when the prescription is saved, so a later edit of the Drug List never rewrites an old prescription;
// a drug already named by its chemical, or one typed in by hand, gets no brackets; prescriptions saved before this existed print exactly as they did.
import { boot, call, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { genericLabelOf, rxLabel } from '../../src/lib/rxLabel';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const doc = await call('doctors:create', { name: 'Dr. Brand', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Bina', last_name: 'Brand', dob: '1990-01-01', gender: 'F', phone: '9411000500' });
  const visit = await call('appointments:createWithBill', {
    appointment: { patient_id: pat.id, doctor_id: doc.id, appointment_date: today, appointment_time: '10:00' },
    bill: { items: [{ description: 'OPD Consultation', qty: 1, rate: 300, amount: 300 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' },
  });
  const find = async (name: string) => (await call('pharmacy:listDrugs', { activeOnly: true, q: name })).find((d: any) => d.name === name);
  const dolo = await find('Dolo 650'), generic = await find('Paracetamol 650 mg Tablet'), combo = await find('Zerodol-P');

  section('1 · the chemical name goes in brackets beside a brand');
  eq(genericLabelOf(dolo), 'Paracetamol 650 mg', 'Dolo 650 → "Paracetamol 650 mg"');
  eq(genericLabelOf(combo), 'Aceclofenac + Paracetamol 100 mg + 325 mg', 'a combination brand lists every ingredient with its strength');
  eq(genericLabelOf(generic), '', 'a drug already named by its chemical has nothing to add');
  eq(genericLabelOf({ name: 'Mystery Tab', generic_name: null, strength: null, form: null }), '', 'a drug with no chemical name on file has nothing to add');
  eq(rxLabel({ drug_name: 'Dolo 650', generic_name: 'Paracetamol 650 mg' }), 'Dolo 650 (Paracetamol 650 mg)', 'the printed line reads "Dolo 650 (Paracetamol 650 mg)"');
  eq(rxLabel({ drug_name: 'Syp Unknown', generic_name: null }), 'Syp Unknown', '…and a line without one is unchanged');

  section('2 · saving a prescription takes the snapshot');
  const saved = await call('rx:saveAll', visit.appointment.id, [
    { drug_master_id: dolo.id, drug_name: 'Dolo 650', dosage: '1 tab', frequency: 'TDS', duration: '3 days' },
    { drug_master_id: combo.id, drug_name: 'Zerodol-P', dosage: '1 tab', frequency: 'BD', duration: '5 days' },
    { drug_master_id: generic.id, drug_name: 'Paracetamol 650 mg Tablet', dosage: '1 tab', frequency: 'SOS' },
    { drug_master_id: null, drug_name: 'Syp Unknown', dosage: '5 ml', frequency: 'BD' },
  ]);
  eq(saved.map((r: any) => rxLabel(r)).join(' | '), 'Dolo 650 (Paracetamol 650 mg) | Zerodol-P (Aceclofenac + Paracetamol 100 mg + 325 mg) | Paracetamol 650 mg Tablet | Syp Unknown',
    'the four lines read: the brand with its chemical name, the combination, the generic as it is, the typed-in drug as it is');
  const back = await call('rx:getByAppointment', visit.appointment.id);
  eq(back.find((r: any) => r.drug_name === 'Dolo 650').generic_name, 'Paracetamol 650 mg', 'it comes back when the prescription is opened again (for the slip and the editor)');
  eq(back.find((r: any) => r.drug_name === 'Syp Unknown').generic_name, null, '…and a typed-in drug has none');

  section('3 · an old prescription is not rewritten');
  db.prepare("UPDATE drug_master SET generic_name='Acetaminophen', strength='650 mg' WHERE id=?").run(dolo.id);
  eq((await call('rx:getByAppointment', visit.appointment.id)).find((r: any) => r.drug_name === 'Dolo 650').generic_name, 'Paracetamol 650 mg', 'renaming the chemical in the Drug List later does not change what was prescribed');
  const resaved = await call('rx:saveAll', visit.appointment.id, [{ drug_master_id: dolo.id, drug_name: 'Dolo 650', dosage: '1 tab' }]);
  eq(resaved[0].generic_name, 'Acetaminophen 650 mg', 'saving it again takes the Drug List as it is now');
  db.prepare("INSERT INTO prescription_items (appointment_id, drug_name, dosage, order_idx) VALUES (?, 'Old Rx Tab', '1', 9)").run(visit.appointment.id);
  const old = (await call('rx:getByAppointment', visit.appointment.id)).find((r: any) => r.drug_name === 'Old Rx Tab');
  ok(old && (old.generic_name === null || old.generic_name === undefined) && rxLabel(old) === 'Old Rx Tab', 'a prescription line written before this existed prints exactly as it did');
  eq(one('SELECT COUNT(*) c FROM pragma_table_info(?) WHERE name=?', 'prescription_items', 'generic_name').c, 1, 'the new column is added to the old table, nothing else about it changed');
  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
