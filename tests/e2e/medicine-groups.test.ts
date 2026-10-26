// "Paracetamol 650 mg should stick with any brand they add — Dolo 650, Crocin 650."
// Brands of ONE medicine (same ingredient, strength and form) are tied together by their composition alone. Nothing is merged or moved:
// every brand keeps its own drug row, batches, price, GST and sales history. Proved here:
//   - the composition key is strict where a wrong match would hurt (a different strength, form or release type never matches; a
//     drug that does not say ingredient + strength + form, or whose strength is only a volume, is never grouped);
//   - on the real 306-drug catalogue the paracetamol brands and their generic row share a key, and nothing else is pulled in;
//   - on a real database a brand added later joins its generic by itself, the lists carry the key, and the stock of the medicine is the
//     sum over its brands — while the sale still names (and the Schedule H register still records) the brand that was handed over;
//   - "out of stock" / "low" are judged for the medicine, so one brand running out while another is on the shelf is not an alarm.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { PHARMACY_CATALOG } from '../../src/data/pharmacy-catalog';
import { groupByMedicine, isGenericNamed, medicineKey, medicineStock, otherBrandsInStock, siblingsOf } from '../../src/lib/medicineGroups';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const key = (generic: string, strength: string, form: string) => medicineKey({ generic_name: generic, strength, form });

  // ============================================================================================================
  section('1 · the composition key is strict where a wrong match would hurt');
  eq(key('Paracetamol', '650 mg', 'Tablet'), key('paracetamol', '650mg', 'tablet'), 'spacing and capital letters do not matter ("650 mg" = "650mg")');
  eq(key('Paracetamol', '650 mg', 'Tablet'), key('Paracetamol', '650 mg', 'Tab'), 'Tab = Tablet, Cap = Capsule, Inj = Injection');
  ok(key('Paracetamol', '650 mg', 'Tablet') !== key('Paracetamol', '500 mg', 'Tablet'), 'another strength is another medicine');
  ok(key('Paracetamol', '250 mg/5 ml', 'Suspension') !== key('Paracetamol', '125 mg/5 ml', 'Suspension'), '…also for a liquid (250 mg/5 ml ≠ 125 mg/5 ml)');
  ok(key('Paracetamol', '650 mg', 'Tablet') !== key('Paracetamol', '650 mg', 'Syrup'), 'another form is another medicine (a tablet is not a syrup)');
  ok(key('Syrup', '250 mg/5 ml', 'Syrup') !== key('Syrup', '250 mg/5 ml', 'Suspension'), 'a syrup and a suspension are NOT assumed to be the same (asked of the owner)');
  ok(key('Diclofenac', '100 mg SR', 'Tablet') !== key('Diclofenac', '100 mg', 'Tablet'), 'a slow-release tablet is not the plain one');
  ok(key('Metoprolol Succinate', '25 mg', 'Tablet') !== key('Metoprolol Tartrate', '25 mg', 'Tablet'), 'another salt is another medicine');
  eq(key('Ibuprofen + Paracetamol', '400 mg + 325 mg', 'Tablet'), key('Paracetamol + Ibuprofen', '325 mg + 400 mg', 'Tablet'), 'a combination is the same whichever ingredient is written first, when each keeps its own strength');
  ok(key('Ibuprofen + Paracetamol', '400 mg + 325 mg', 'Tablet') !== key('Ibuprofen + Paracetamol', '325 mg + 400 mg', 'Tablet'), '…but the strengths may not be swapped between the ingredients');
  eq(key('Amoxicillin + Clavulanic Acid', '200 mg + 28.5 mg/5 ml', 'Suspension'), key('Amoxicillin + Clavulanic Acid', '200 mg/5 ml + 28.5 mg/5 ml', 'Suspension'), 'a "per 5 ml" written on the last ingredient applies to all of them');
  eq(key('Paracetamol', '', 'Tablet'), null, 'a drug with no strength is never grouped');
  eq(key('Paracetamol', '650 mg', ''), null, '…nor one with no form');
  eq(key('', '650 mg', 'Tablet'), null, '…nor one with no ingredient');
  eq(key('Multivitamin + Multimineral', '—', 'Tablet'), null, '…nor one whose strength is a dash');
  eq(key('Dextrose', '500 ml', 'Injection'), null, '…nor a drip whose "strength" is only its volume (5% and 10% dextrose are both 500 ml)');
  eq(key('Tetanus Toxoid', '0.5 ml', 'Injection'), null, '…nor a dose that is only a volume');

  eq(isGenericNamed({ name: 'Paracetamol 650 mg Tablet', generic_name: 'Paracetamol', strength: '650 mg', form: 'Tablet' }), true, '"Paracetamol 650 mg Tablet" is named by its ingredient');
  eq(isGenericNamed({ name: 'Dolo 650', generic_name: 'Paracetamol', strength: '650 mg', form: 'Tablet' }), false, '"Dolo 650" is a brand');
  eq(isGenericNamed({ name: 'Ibuprofen 100 mg/5 ml Suspension', generic_name: 'Ibuprofen', strength: '100 mg/5 ml', form: 'Suspension' }), true, 'a liquid generic name is recognised');
  eq(isGenericNamed({ name: 'Paracetamol 1000 mg/100 ml Infusion', generic_name: 'Paracetamol', strength: '1000 mg/100 ml', form: 'Injection' }), true, '…and "Infusion" counts as the injection form');
  eq(isGenericNamed({ name: 'Crocin Advance', generic_name: 'Paracetamol', strength: '500 mg', form: 'Tablet' }), false, 'a brand with a variant word is a brand');

  // ============================================================================================================
  section('2 · the real 306-drug catalogue');
  const cat = PHARMACY_CATALOG.map((d, i) => ({ id: i + 1, ...d }));
  const keyOf = (name: string) => medicineKey(cat.find((d) => d.name === name)!);
  eq(keyOf('Dolo 650'), keyOf('Paracetamol 650 mg Tablet'), 'Dolo 650 and "Paracetamol 650 mg Tablet" are one medicine');
  eq(keyOf('Dolo 500'), keyOf('Crocin Advance'), 'Dolo 500 and Crocin Advance are one medicine…');
  eq(keyOf('Crocin Advance'), keyOf('Paracetamol 500 mg Tablet'), '…with the 500 mg generic');
  ok(keyOf('Dolo 650') !== keyOf('Dolo 500'), '650 mg and 500 mg stay apart');
  ok(keyOf('Combiflam') !== keyOf('Paracetamol 500 mg Tablet'), 'Combiflam (ibuprofen + paracetamol) is not paracetamol');
  ok(keyOf('Calpol 250 Syrup') !== keyOf('Paracetamol 250 mg/5 ml Suspension'), 'a syrup is not grouped with a suspension');
  eq(keyOf('Dextrose 5% 500ml'), null, 'the dextrose drips are not grouped (their strength is only a volume)');
  eq(keyOf('Dextrose 10% 500ml'), null, '…so 5% and 10% can never be mistaken for each other');
  const groups = groupByMedicine(cat);
  const para650 = groups.find((g) => g.key === keyOf('Dolo 650'))!;
  eq(para650.rows.map((r) => r.name).sort().join(' | '), 'Dolo 650 | Paracetamol 650 mg Tablet', 'exactly those two sit together at 650 mg');
  const multi = groups.filter((g) => g.rows.length > 1);
  ok(multi.length >= 8 && multi.length <= 20, `a handful of medicines have several brands in the catalogue (${multi.length}), not hundreds`);
  // consistency: every group is truly one composition — the same strengths and forms once folded
  const bad = multi.filter((g) => new Set(g.rows.map((r) => medicineKey(r))).size !== 1);
  eq(bad.length, 0, 'every group holds one composition and nothing else');
  const unkeyed = cat.filter((d) => !medicineKey(d)).map((d) => d.name);
  ok(unkeyed.includes('Zincovit') && unkeyed.includes('Gelusil MPS') && unkeyed.includes('Normal Saline 0.9% 500ml'), `drugs that do not state an amount stay alone (${unkeyed.length} of ${cat.length})`);

  // ============================================================================================================
  section('3 · a brand added later joins its generic by itself — on a real database');
  const mk = (name: string, generic: string, strength: string, form: string, extra: Record<string, any> = {}) =>
    call('pharmacy:upsertDrug', { name, generic_name: generic, strength, form, schedule: 'OTC', default_mrp: 30, gst_rate: 5, low_stock_threshold: 10, ...extra });
  // the standard catalogue is already on this fresh database: its "Paracetamol 650 mg Tablet" and "Dolo 650" are the real rows
  let list = await call('pharmacy:listDrugs', { activeOnly: true, q: 'Paracetamol' });
  const byName = (n: string) => (list as any[]).find((d) => d.name === n);
  const generic = byName('Paracetamol 650 mg Tablet');
  list = await call('pharmacy:listDrugs', { activeOnly: true, q: 'Dolo' });
  const dolo = byName('Dolo 650');
  ok(!!generic && !!dolo, 'the catalogue on this database has "Paracetamol 650 mg Tablet" and "Dolo 650"');
  const other = await mk('Calpol 500', 'Paracetamol', '500 mg', 'Tablet');
  list = await call('pharmacy:listDrugs', { activeOnly: true });
  const row = (id: number) => list.find((d: any) => d.id === id);
  ok(row(generic.id).medicine_key && row(generic.id).medicine_key === row(dolo.id).medicine_key, 'the Drug List rows carry the same key for the generic and Dolo 650');
  ok(row(other.id).medicine_key !== row(dolo.id).medicine_key, '…and a different one for the 500 mg brand');
  const crocin = await mk('Crocin 650', 'Paracetamol', '650 mg', 'Tablet');
  list = await call('pharmacy:listDrugs', { activeOnly: true });
  eq(siblingsOf(list, row(generic.id)).map((d: any) => d.name).sort().join(' | '), 'Crocin 650 | Dolo 650', 'Crocin 650, added later, joined the generic with nothing linked by hand');
  const noComp = await mk('Mystery Tab', '', '', '');
  list = await call('pharmacy:listDrugs', { activeOnly: true });
  eq(row(noComp.id).medicine_key, null, 'a drug typed in with no composition has no key — it simply stays alone');

  // ============================================================================================================
  section('4 · stock is seen for the medicine; the sale still names the brand handed over');
  const sup = await call('wholesalers:upsert', { name: 'Brand Supplies', drug_license_no: 'DL-BR' });
  const buy = (drug: any, ref: string, batch: string, qty: number, expiry: string, price = 20) => call('purchase:create', {
    client_ref: ref, invoice_number: ref.toUpperCase(), wholesaler_id: sup.id, invoice_date: today,
    items: [{ drug_master_id: drug.id, batch_no: batch, expiry, qty_received: qty, purchase_price: price, mrp: 31, gst_rate: 5 }],
  });
  await buy(dolo, 'bg-1', 'D1', 80, '2027-03-31');
  await buy(crocin, 'bg-2', 'C1', 40, '2027-01-31');
  list = await call('pharmacy:listDrugs', { activeOnly: true });                       // stock figures are read fresh, as the screens do
  const stock = await call('pharmacy:clinicStock');
  const sr = (id: number) => stock.find((r: any) => r.id === id);
  ok(sr(dolo.id).medicine_key === sr(crocin.id).medicine_key && !!sr(dolo.id).medicine_key, 'Drugs in my clinic: both brands carry the same key');
  ok(!sr(generic.id), '(the generic row has no stock and was never bought, so it is not on the shelf list)');
  const g = groupByMedicine(stock).find((x) => x.key === sr(dolo.id).medicine_key)!;
  eq(g.rows.length, 2, 'the two brands on the shelf form ONE medicine');
  const ms = medicineStock(g.rows);
  eq(ms.stock, 120, 'its stock is what is left over BOTH brands (80 + 40)');
  eq(ms.nextExpiry, '2027-01-31', 'its next expiry is the nearest of the two');
  ok(!ms.low && !ms.out, 'it is neither low nor out');
  const brands = otherBrandsInStock(list, row(generic.id));
  eq(brands.map((d: any) => d.name).join(' → '), 'Crocin 650 → Dolo 650', 'for a prescription for the generic the shelf offers Crocin first (earliest expiry), then Dolo');

  // one brand running out while another is on the shelf is not a shortage of the medicine
  const sell = (drug: any, qty: number, ref: string) => call('pharmacy:sell', { client_ref: ref, items: [{ drug_master_id: drug.id, drug_name: drug.name, qty, rate: 31 }], payment_mode: 'Cash' });
  await sell(crocin, 40, 'bg-sale-1');
  const after = await call('pharmacy:clinicStock');
  const cr = after.find((r: any) => r.id === crocin.id);
  ok(cr.out_of_stock === true, 'Crocin 650 itself is now out (its own row says so)');
  const gm = medicineStock(groupByMedicine(after).find((x) => x.key === cr.medicine_key)!.rows);
  ok(!gm.out && !gm.low && gm.stock === 80, 'but the MEDICINE is not out: 80 are left as Dolo 650 — no alarm');
  await sell(dolo, 75, 'bg-sale-2');
  const low = medicineStock(groupByMedicine(await call('pharmacy:clinicStock')).find((x) => x.key === cr.medicine_key)!.rows);
  ok(low.low && !low.out && low.stock === 5, 'once only 5 are left over all brands, the medicine is low (the highest level any brand has is 10)');

  // the sale records the brand that was handed over — never the generic that was merely prescribed
  const lines = db.prepare('SELECT drug_name, drug_master_id FROM pharmacy_sale_items ORDER BY id').all() as any[];
  eq(lines.map((l) => l.drug_name).join(','), 'Crocin 650,Dolo 650', 'each bill line names the brand that left the shelf');
  const reg = db.prepare('SELECT drug_master_id, batch_no FROM dispensing_register ORDER BY id').all() as any[];
  eq(reg.map((r) => `${r.drug_master_id === crocin.id ? 'Crocin 650' : r.drug_master_id === dolo.id ? 'Dolo 650' : '?'}:${r.batch_no}`).join(','), 'Crocin 650:C1,Dolo 650:D1', 'the dispensing register records the same brand and batch');
  const short = await attempt('pharmacy:sell', { client_ref: 'bg-sale-3', items: [{ drug_master_id: generic.id, drug_name: generic.name, qty: 1, rate: 31 }], payment_mode: 'Cash' });
  ok(!short.ok && /insufficient stock/i.test(String((short as any).error)), 'a line for the generic row itself (which holds no stock) is still refused — the brand is chosen on the line, never guessed');

  // nothing was merged: three separate drugs, each with its own rows
  eq(one("SELECT COUNT(*) c FROM drug_master WHERE name IN ('Dolo 650','Crocin 650','Paracetamol 650 mg Tablet')").c, 3, 'the three names are still three drugs (nothing merged)');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches WHERE drug_master_id=?', dolo.id).c, 1, '…each with its own batches');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
