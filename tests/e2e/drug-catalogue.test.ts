// The standard drug catalogue (version 2): a real composition on every row, and how an EXISTING clinic receives it — once, and safely.
// Rules proved here, on the app's real startup path and handlers, on a temporary database:
//   - the list is about 300 drugs; every liquid says how much is in how much ("250 mg/5 ml"); every combination lists the amount of EACH ingredient;
//     a brand variant is its own row (Augmentin Duo ≠ Augmentin DDS, Vicks Action 500 ≠ Advanced); the paediatric essentials are there;
//   - a NEW install is seeded from it; an UPDATING clinic gets it once: the composition of a drug nobody edited is corrected and the new drugs
//     are added — and nothing else changes: a drug the clinic edited, its price, GST, schedule, stock, batches and ids stay exactly as they were;
//   - a drug the clinic deleted is not put back by an update; a clinic that cleared its list ("Start fresh") is not handed 100 drugs;
//   - running it again changes nothing; the "Load standard drug catalogue" button adds what is missing and corrects only unedited rows.
import crypto from 'node:crypto';
import { boot, call, getDb } from './harness';
import { runMigrations } from '../../src/db/migrations';
import { seedIfEmpty } from '../../src/db/seed';
import { PHARMACY_CATALOG, type CatalogDrug } from '../../src/data/pharmacy-catalog';
import { PHARMACY_CATALOG_V1 } from '../../src/data/pharmacy-catalog-v1';
import { CATALOGUE_FLAG, STILL_USING_STANDARD_LIST } from '../../src/db/catalogue';
import { ok, eq, section, finish, note } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const low = (s: string) => s.trim().toLowerCase();
const byName = (list: CatalogDrug[]) => new Map(list.map((d) => [low(d.name), d]));
const V1 = byName(PHARMACY_CATALOG_V1);
const V2 = byName(PHARMACY_CATALOG);
const CAT = PHARMACY_CATALOG.length;
const row = (name: string) => one('SELECT * FROM drug_master WHERE LOWER(name)=?', low(name));
const comp = (r: any) => [r.generic_name ?? '', r.form ?? '', r.strength ?? '', r.pack_size ?? null].join(' | ');
const compOf = (d: CatalogDrug) => [d.generic_name, d.form, d.strength, d.pack_size ?? null].join(' | ');
const flagSet = () => !!one('SELECT 1 x FROM settings WHERE key=?', CATALOGUE_FLAG);

/** Put the Drug List back exactly as release 0.9.7 left a clinic that had never touched it: the old catalogue, row for row, the way the old seed wrote it. */
function backToOldClinic() {
  db.prepare('DELETE FROM drug_stock_batches').run();
  db.prepare('DELETE FROM drug_master').run();
  const ins = db.prepare(`INSERT INTO drug_master (name, generic_name, form, strength, pack_size, schedule, gst_rate, default_mrp, low_stock_threshold, is_active, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 1, '2020-01-01 00:00:00')`);
  for (const d of PHARMACY_CATALOG_V1) ins.run(d.name, d.generic_name, d.form, d.strength, d.pack_size ?? null, d.schedule, d.gst_rate, d.default_mrp);
  db.prepare('DELETE FROM settings WHERE key=?').run(CATALOGUE_FLAG);                       // this clinic has not had the update yet
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('drug_catalogue_seeded', '1')").run();
}
const everything = () => JSON.stringify(all('SELECT * FROM drug_master ORDER BY id'));

(async () => {
  // ============================================================================================================
  section('1 · the list: about 300 drugs, each with a real composition');
  ok(CAT >= 290 && CAT <= 330, `about 300 drugs (${CAT})`);
  eq(new Set(PHARMACY_CATALOG.map((d) => low(d.name))).size, CAT, 'no drug is listed twice');
  const FORMS = new Set(['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Drops', 'Ointment', 'Cream', 'Gel', 'Inhaler', 'Respules', 'Sachet', 'Solution', 'Spray']);
  const bad = PHARMACY_CATALOG.filter((d) => !FORMS.has(d.form) || !['H', 'H1', 'G', 'X', 'OTC'].includes(d.schedule) || !(d.default_mrp > 0)
    || !Number.isInteger(d.pack_size) || (d.pack_size as number) < 1 || !d.name.trim() || !d.generic_name.trim() || !d.strength.trim());
  ok(bad.length === 0, `every row has a valid form, schedule, price and pack size${bad.length ? ': ' + bad.slice(0, 5).map((d) => d.name).join(', ') : ''}`);
  const gstBad = PHARMACY_CATALOG.filter((d) => d.gst_rate !== (d.name === 'Dettol Antiseptic' ? 18 : 5));
  ok(gstBad.length === 0, `GST is the current rate (5 % for medicines, 18 % for Dettol)${gstBad.length ? ': ' + gstBad.slice(0, 5).map((d) => d.name).join(', ') : ''}`);

  // Rows kept exactly as 0.9.7 shipped them because their real composition could not be confirmed from a reliable source: their "strength" is still
  // the bottle size. They are listed here on purpose — when one is confirmed it is fixed in the catalogue and removed from this list.
  const UNCONFIRMED = ['Gelusil MPS', 'Sucral Syrup', 'Cypon Syrup', 'Zincovit Syrup', 'Colicaid Drops'];
  for (const n of UNCONFIRMED) ok(V2.has(low(n)) && compOf(V2.get(low(n))!) === compOf(V1.get(low(n))!), `${n}: left as shipped (composition not confirmed)`);
  const liquids = PHARMACY_CATALOG.filter((d) => ['Syrup', 'Suspension'].includes(d.form) && !UNCONFIRMED.includes(d.name));
  const noPerMl = liquids.filter((d) => !/\/\s*(\d+(\.\d+)?\s*)?ml$/.test(d.strength));
  ok(liquids.length > 40 && noPerMl.length === 0, `all ${liquids.length} syrups and suspensions say how much is in how much (e.g. "250 mg/5 ml")${noPerMl.length ? ' — missing: ' + noPerMl.slice(0, 6).map((d) => d.name + ' [' + d.strength + ']').join('; ') : ''}`);
  const drops = PHARMACY_CATALOG.filter((d) => d.form === 'Drops' && !UNCONFIRMED.includes(d.name));
  const dropsBad = drops.filter((d) => d.strength !== '—' && !/(\/\s*ml|%)/.test(d.strength));
  ok(drops.length > 8 && dropsBad.length === 0, `all ${drops.length} drops give a concentration (mg/ml, IU/ml or %)${dropsBad.length ? ' — missing: ' + dropsBad.map((d) => d.name).join(', ') : ''}`);
  // a combination lists the amount of EACH ingredient: as many amounts as ingredients (IV bags / volumes and "—" rows have nothing to compare)
  const combos = PHARMACY_CATALOG.filter((d) => /\d/.test(d.strength) && !/^\d+(\.\d+)?\s*(ml|g)$/.test(d.strength) && !UNCONFIRMED.includes(d.name));
  const mismatch = combos.filter((d) => d.generic_name.split(' + ').length !== d.strength.replace(/\/\s*\d+(\.\d+)?\s*ml$/, '').split(' + ').length);
  ok(combos.length > 200 && mismatch.length === 0, `every combination has one amount per ingredient (${combos.length} checked)${mismatch.length ? ' — mismatch: ' + mismatch.slice(0, 6).map((d) => `${d.name} [${d.generic_name} / ${d.strength}]`).join('; ') : ''}`);
  const noComposition = PHARMACY_CATALOG.filter((d) => d.strength === '—');
  ok(noComposition.length <= 12, `only a few multi-vitamin / skin combinations have no amounts written (${noComposition.length}: ${noComposition.map((d) => d.name).join(', ')})`);

  section('2 · the examples the owner gave, and the variants');
  eq(V2.get('calpol 250 syrup')?.strength, '250 mg/5 ml', '"250 mg/5 ml" — milligrams in how many millilitres');
  eq(V2.get('ascoril ls syrup')?.strength, '30 mg + 1 mg + 50 mg/5 ml', 'Ascoril LS: ambroxol 30 + levosalbutamol 1 + guaifenesin 50 per 5 ml');
  eq(V2.get('augmentin duo syrup')?.strength, '200 mg + 28.5 mg/5 ml', 'Augmentin Duo Syrup is 200 + 28.5 per 5 ml');
  eq(V2.get('augmentin dds syrup')?.strength, '400 mg + 57 mg/5 ml', '…and Augmentin DDS is its own row: 400 + 57 per 5 ml');
  ok(V2.get('vicks action 500') && V2.get('vicks action 500 advanced') && compOf(V2.get('vicks action 500')!) !== compOf(V2.get('vicks action 500 advanced')!), 'Vicks Action 500 and Vicks Action 500 Advanced are two rows with different compositions');
  eq(V2.get('zerodol mr')?.strength, '100 mg + 325 mg + 250 mg', 'Zerodol MR now lists all three amounts (it was "—")');
  eq(V2.get('dolo cold')?.strength, '500 mg + 10 mg + 30 mg', 'Dolo Cold now lists its amounts (it was "—")');
  const MUST = ['Dolo 650', 'Dolo 250 Suspension', 'Dolo 120 Suspension', 'Paracetamol 650 mg Tablet', 'Paracetamol 100 mg/ml Drops', 'Ibugesic Plus Syrup',
    'Amoxicillin 125 mg/5 ml Dry Syrup', 'Amoxicillin 250 mg/5 ml Dry Syrup', 'Azithral Syrup 200', 'Cefixime 50 mg/5 ml Dry Syrup', 'Cefixime 100 mg/5 ml Dry Syrup',
    'Ondem Syrup', 'Zinc 20 mg Dispersible Tablet', 'Electral Powder', 'Racecadotril 10 mg Sachet', 'Enterogermina', 'Cetirizine 5 mg/5 ml Syrup', 'Montelukast 4 mg Chewable Tablet',
    'Salbutamol 2 mg/5 ml Syrup', 'Levolin Respules', 'Omnacortil Syrup', 'Cholecalciferol 400 IU/ml Drops', 'Phenobarbitone 30 mg Tablet', 'Sodium Valproate 200 mg/5 ml Syrup',
    'Benzyl Benzoate 25% Lotion', 'Nystatin Oral Drops', 'Otrivin Paediatric Nasal Drops', 'Ceftriaxone 250 mg Injection', 'Dextrose 10% 500ml', 'Calcium Gluconate 10% Injection'];
  const missing = MUST.filter((n) => !V2.has(low(n)));
  ok(missing.length === 0, `the paediatric essentials are there (${MUST.length} checked)${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
  ok(!PHARMACY_CATALOG.some((d) => /nimesulide/i.test(d.generic_name) && ['Syrup', 'Suspension', 'Drops'].includes(d.form)), 'no children\'s nimesulide (not allowed for children in India)');
  const H1 = PHARMACY_CATALOG.filter((d) => /cefixime|cefpodoxime|ceftriaxone|cefotaxime|levofloxacin|tramadol|diazepam|alprazolam|rifampicin/i.test(d.generic_name) && d.schedule !== 'H1');
  ok(H1.length === 0, `third-generation cephalosporins, levofloxacin, tramadol, diazepam, alprazolam and rifampicin are Schedule H1${H1.length ? ' — not H1: ' + H1.map((d) => d.name).join(', ') : ''}`);
  const GONE = ['Grilinctus', 'Cotton Roll 500g', 'Surgical Gloves (pair)', 'Face Mask 3-ply', 'Hand Sanitizer 500ml', 'Glucometer Strips (25)', 'Enerzal', 'Piptaz 4.5g Injection', 'Meropenem 1g Injection'];
  ok(GONE.every((n) => !V2.has(low(n)) && V1.has(low(n))), 'a banned-combination cough syrup, the counter consumables and the hospital-only items are not in the new list');
  eq(PHARMACY_CATALOG_V1.length, 223, 'the frozen copy of the old list still has its 223 drugs');
  const h = crypto.createHash('sha256').update(JSON.stringify(PHARMACY_CATALOG_V1)).digest('hex');
  eq(h, '937358356cf11b411b9f177af40bc497a6d17d59ddd63e99dd4e2c09a16f609a', 'the frozen copy of the old list has not been edited (it decides which rows are "unedited")');

  // ============================================================================================================
  section('3 · a NEW install is seeded from the new list');
  eq(one('SELECT COUNT(*) c FROM drug_master').c, CAT, `the Drug List holds all ${CAT} drugs`);
  const wrong = PHARMACY_CATALOG.filter((d) => comp(row(d.name) ?? {}) !== compOf(d));
  ok(wrong.length === 0, `every row carries the composition written in the catalogue${wrong.length ? ': ' + wrong.slice(0, 4).map((d) => d.name).join(', ') : ''}`);
  eq(one("SELECT value v FROM settings WHERE key='drug_catalogue_seeded'")?.v, '1', 'marked as put in once');
  ok(flagSet(), 'and marked as already up to date, so the update never runs on it');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches').c, 0, 'no stock was invented');

  // a brand-new file: migrations run on an EMPTY list first (nothing is added there), then the first-run seed fills it — once
  db.prepare('DELETE FROM drug_master').run();
  db.prepare("DELETE FROM settings WHERE key IN ('drug_catalogue_seeded', ?)").run(CATALOGUE_FLAG);
  runMigrations(db);
  eq(one('SELECT COUNT(*) c FROM drug_master').c, 0, 'on an empty file the update adds nothing (the seed does)');
  seedIfEmpty(db);
  eq(one('SELECT COUNT(*) c FROM drug_master').c, CAT, `…and then the seed fills it with exactly the ${CAT} drugs, none twice`);

  // ============================================================================================================
  section('4 · a clinic that UPDATES: composition corrected, new drugs added, nothing the clinic did is touched');
  backToOldClinic();
  const oldCount = one('SELECT COUNT(*) c FROM drug_master').c;
  eq(oldCount, 223, 'set-up: a clinic holding the old 223-drug list');
  // what this clinic did over time
  db.prepare("UPDATE drug_master SET strength='my own wording' WHERE name='Ascoril LS Syrup'").run();            // edited a composition
  db.prepare("UPDATE drug_master SET generic_name='Paracetamol combo (mine)' WHERE name='Dolo Cold'").run();     // edited just ONE of the composition fields
  db.prepare("UPDATE drug_master SET default_mrp=99, gst_rate=12, schedule='H', low_stock_threshold=40, barcode='890123', notes='our best seller', manufacturer='Micro Labs' WHERE name='Dolo 650'").run();
  db.prepare("DELETE FROM drug_master WHERE name='Combiflam'").run();                                            // removed a drug it does not stock
  db.prepare("INSERT INTO drug_master (name, generic_name, form, strength, schedule, gst_rate, default_mrp, is_active) VALUES ('My Own Syrup', 'Mine', 'Syrup', '5 mg/5 ml', 'OTC', 12, 55, 1)").run();
  const duo = row('Augmentin Duo Syrup');
  db.prepare("INSERT INTO drug_stock_batches (drug_master_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, mrp) VALUES (?, 'AUG-77', '2027-08-31', 40, 33, 90, 135)").run(duo.id);
  const before = new Map(all('SELECT * FROM drug_master').map((r) => [r.name, r]));
  const batchBefore = JSON.stringify(all('SELECT * FROM drug_stock_batches'));

  runMigrations(db);                                                                                              // the update: first start of the new version
  const after = new Map(all('SELECT * FROM drug_master').map((r) => [r.name, r]));
  ok(flagSet(), 'the update is marked as done');
  ok([...before.values()].every((b) => after.get(b.name)?.id === b.id), 'every drug the clinic had keeps its id (prescriptions, bills and purchases point at it)');

  // corrected: unedited rows whose composition changed
  const shouldFix = [...before.values()].filter((b) => { const o = V1.get(low(b.name)), n = V2.get(low(b.name)); return o && n && comp(b) === compOf(o) && compOf(o) !== compOf(n); });
  ok(shouldFix.length > 40, `${shouldFix.length} drugs nobody edited have a corrected composition to receive`);
  ok(shouldFix.every((b) => comp(after.get(b.name)) === compOf(V2.get(low(b.name))!)), 'every one of them now carries the new composition');
  eq(after.get('Calpol 250 Syrup').strength, '250 mg/5 ml', 'Calpol 250 Syrup: "250 mg/5ml" → "250 mg/5 ml"');
  eq(after.get('Augmentin Duo Syrup').strength, '200 mg + 28.5 mg/5 ml', 'Augmentin Duo Syrup: "30 ml" → "200 mg + 28.5 mg/5 ml"');
  eq(after.get('Zerodol MR').strength, '100 mg + 325 mg + 250 mg', 'Zerodol MR: "—" → its three amounts');
  eq(after.get('Digene Gel').generic_name, 'Aluminium Hydroxide + Magnesium Hydroxide + Simethicone', 'Digene Gel: the ingredient list is corrected too');
  // never touched: what the clinic edited
  eq(after.get('Ascoril LS Syrup').strength, 'my own wording', 'a composition the clinic edited stays as the clinic wrote it');
  eq(JSON.stringify(after.get('Dolo Cold')), JSON.stringify(before.get('Dolo Cold')), 'a drug with even ONE edited field is left completely alone (no half-and-half rows)');
  const dolo = after.get('Dolo 650');
  ok(dolo.default_mrp === 99 && dolo.gst_rate === 12 && dolo.schedule === 'H' && dolo.low_stock_threshold === 40 && dolo.barcode === '890123' && dolo.notes === 'our best seller' && dolo.manufacturer === 'Micro Labs', 'price, GST, schedule, low-stock level, barcode, notes and manufacturer the clinic set are untouched');
  eq(JSON.stringify(after.get('My Own Syrup')), JSON.stringify(before.get('My Own Syrup')), 'the clinic\'s own drug is untouched');
  // fields no update ever changes, on EVERY old row
  const fields = ['id', 'name', 'schedule', 'gst_rate', 'default_mrp', 'low_stock_threshold', 'is_active', 'barcode', 'notes', 'manufacturer', 'hsn_code', 'created_at', 'updated_at'];
  const touched = [...before.values()].filter((b) => fields.some((f) => b[f] !== after.get(b.name)[f]));
  ok(touched.length === 0, `no price, GST, schedule, level, flag or date changed on any of the ${before.size} old rows${touched.length ? ': ' + touched.slice(0, 4).map((b) => b.name).join(', ') : ''}`);
  eq(after.get('Taxim-O 200').schedule, 'H', 'a schedule is never rewritten by an update (the new list marks it H1; the clinic decides)');
  eq(after.get('Taxim-O 200').gst_rate, 12, 'a GST rate is never rewritten by an update');
  // stock
  eq(JSON.stringify(all('SELECT * FROM drug_stock_batches')), batchBefore, 'the stock batch of Augmentin Duo Syrup is exactly as it was (33 of 40 left)');
  // removed / added
  ok(!after.has('Combiflam'), 'a drug the clinic deleted is not put back by the update');
  ok(after.has('Grilinctus') && JSON.stringify(after.get('Grilinctus')) === JSON.stringify(before.get('Grilinctus')), 'a drug the new list no longer carries stays on the clinic\'s list, untouched');
  const newNames = PHARMACY_CATALOG.filter((d) => !V1.has(low(d.name)));
  ok(newNames.length >= 100 && newNames.every((d) => after.has(d.name) && comp(after.get(d.name)) === compOf(d)), `all ${newNames.length} new drugs were added, with their compositions`);
  eq(after.size, before.size + newNames.length, 'nothing else was added or removed');
  const fresh = newNames.map((d) => after.get(d.name));
  ok(fresh.every((r) => r.is_active === 1 && r.low_stock_threshold === 10), 'new drugs are active; they hold no stock');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches').c, 1, 'no stock was invented');

  // once only
  const snap = everything();
  runMigrations(db); runMigrations(db);
  ok(everything() === snap, 'starting again (twice) changes nothing');
  db.prepare("DELETE FROM drug_master WHERE name='Dolo 500'").run();
  runMigrations(db);
  ok(!row('Dolo 500'), 'a new drug the clinic deletes afterwards does not come back by itself');

  // ============================================================================================================
  section('5 · a clinic that cleared or replaced its list is not handed the new drugs');
  backToOldClinic();
  const keep = ['Dolo 650', 'Calpol 250 Syrup', 'Pan 40'];
  db.prepare(`DELETE FROM drug_master WHERE name NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
  db.prepare("INSERT INTO drug_master (name, generic_name, form, strength, schedule, gst_rate, default_mrp, is_active) VALUES ('Own Drug A', 'Own', 'Tablet', '10 mg', 'H', 12, 20, 1)").run();
  runMigrations(db);
  eq(one('SELECT COUNT(*) c FROM drug_master').c, 4, `holding only 3 of the old names (< ${STILL_USING_STANDARD_LIST}): no new drug is added`);
  eq(row('Calpol 250 Syrup').strength, '250 mg/5 ml', '…but the drug it still has gets its composition corrected');
  ok(flagSet(), '…and the update is marked done, so it does not ask again');

  backToOldClinic();
  const keepN = PHARMACY_CATALOG_V1.slice(0, STILL_USING_STANDARD_LIST).map((d) => d.name);
  db.prepare(`DELETE FROM drug_master WHERE name NOT IN (${keepN.map(() => '?').join(',')})`).run(...keepN);
  runMigrations(db);
  eq(one('SELECT COUNT(*) c FROM drug_master').c, STILL_USING_STANDARD_LIST + newNames.length, `holding ${STILL_USING_STANDARD_LIST} of the old names: still using the standard list — the ${newNames.length} new drugs are added`);

  backToOldClinic();
  const keepM = PHARMACY_CATALOG_V1.slice(0, STILL_USING_STANDARD_LIST - 1).map((d) => d.name);
  db.prepare(`DELETE FROM drug_master WHERE name NOT IN (${keepM.map(() => '?').join(',')})`).run(...keepM);
  runMigrations(db);
  eq(one('SELECT COUNT(*) c FROM drug_master').c, STILL_USING_STANDARD_LIST - 1, `holding ${STILL_USING_STANDARD_LIST - 1} of the old names: nothing is added`);

  // ============================================================================================================
  section('6 · "Load standard drug catalogue" (Settings): adds what is missing, corrects only unedited rows, then has nothing left to do');
  backToOldClinic();
  db.prepare("UPDATE drug_master SET strength='my own wording' WHERE name='Ascoril LS Syrup'").run();
  db.prepare("DELETE FROM drug_master WHERE name='Combiflam'").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(CATALOGUE_FLAG);               // already updated once: only the button is in play
  const r1 = await call('pharmacy:loadStandardCatalog');
  ok(r1.ok && r1.total === CAT, `the button reports the catalogue size (${r1.total})`);
  ok(r1.added === newNames.length + 1, `adds the ${newNames.length} new drugs and the Combiflam this clinic had deleted (${r1.added})`);
  const changedNames = [...V1.keys()].filter((k) => V2.has(k) && compOf(V1.get(k)!) !== compOf(V2.get(k)!));
  const expectFix = changedNames.filter((k) => k !== 'ascoril ls syrup' && k !== 'combiflam').length;       // the edited one and the deleted one are not corrected
  eq(r1.corrected, expectFix, `corrects exactly the unedited compositions that changed (${r1.corrected} of ${changedNames.length})`);
  ok(r1.kept >= 1, `and counts the rows it left alone because the clinic edited them (${r1.kept})`);
  eq(row('Ascoril LS Syrup').strength, 'my own wording', 'the edited row is still the clinic\'s');
  ok(!!row('Combiflam'), 'the deleted drug is back (the button adds everything that is missing)');
  const r2 = await call('pharmacy:loadStandardCatalog');
  ok(r2.added === 0 && r2.corrected === 0, 'pressing it again finds nothing to add or correct');
  eq(one('SELECT COUNT(*) c FROM drug_stock_batches').c, 0, 'it never puts stock on the shelf');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
