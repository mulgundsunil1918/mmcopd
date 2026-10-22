// "Drugs in my clinic" → Start fresh (clear every drug, all stock and batches) and Delete selected (just the ticked drugs).
// Rules proved here, on the app's real handlers and a temporary database:
//   - a NEW install starts with an empty shelf (the drug list is there, no stock) and the catalogue is never put back by a restart;
//   - only the administrator and the pharmacy in-charge may do it; everything at once needs the typed phrase, checked in the main process;
//   - a safety copy of the whole database is saved first, and if it cannot be saved NOTHING is cleared;
//   - a drug nothing mentions is erased; one that was ever sold, bought, prescribed or ordered is kept as Inactive so history stays readable;
//   - a batch nothing was sold from is deleted; one that was is set to zero and switched off (the Schedule H register points at it);
//   - patients, bills, sales, purchase bills, suppliers and what is owed to them are never touched;
//   - the preview says exactly what the action then does; a second run finds nothing left to do.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { boot, call, attempt, getDb, setReadOnlyMode, userData } from './harness';
import { runMigrations } from '../../src/db/migrations';
import { seedIfEmpty } from '../../src/db/seed';
import { PHARMACY_CATALOG } from '../../src/data/pharmacy-catalog';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const count = (t: string) => one(`SELECT COUNT(*) c FROM ${t}`).c as number;
const backupDir = path.join(userData, 'backups', 'before-clear-stock');
const backups = () => (fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory() ? fs.readdirSync(backupDir).filter((n) => n.endsWith('.sqlite')) : []);
const CAT = PHARMACY_CATALOG.length;

(async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  /** clearDrugs returns {ok:false,error} for a refusal and THROWS for a role problem — fold both into one shape. */
  const clear = async (payload: any): Promise<any> => {
    const r = await attempt('pharmacy:clearDrugs', payload);
    return r.ok ? (r as any).value : { ok: false, error: (r as any).error };
  };
  const preview = (ids: number[] | null) => call('pharmacy:previewClear', ids === null ? {} : { ids });
  const shelf = async () => (await call('pharmacy:clinicStock')) as any[];
  const drugRow = (id: number) => one('SELECT * FROM drug_master WHERE id=?', id);
  const batchRows = (id: number) => all('SELECT * FROM drug_stock_batches WHERE drug_master_id=? ORDER BY id', id);
  const mk = async (name: string, extra: Record<string, any> = {}) => (await call('pharmacy:upsertDrug', { name, default_mrp: 100, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 5, ...extra })) as any;

  // ============================================================================================================
  section('0 · a NEW install starts with an empty shelf, and the catalogue never comes back by itself');
  eq(count('drug_master'), CAT, `the Drug List is there (${CAT} catalogue drugs)…`);
  eq(count('drug_stock_batches'), 0, '…but no stock, no batches');
  eq((await shelf()).length, 0, 'Drugs in my clinic is empty');
  eq(one("SELECT value v FROM settings WHERE key='drug_catalogue_seeded'")?.v, '1', 'the catalogue is marked as put in once');
  const gone = one('SELECT id, name FROM drug_master ORDER BY id LIMIT 1');
  db.prepare('DELETE FROM drug_master WHERE id=?').run(gone.id);
  restart();
  eq(count('drug_master'), CAT - 1, 'a restart does not put a deleted catalogue drug back');
  const lc = await call('pharmacy:loadStandardCatalog');
  eq(lc.added, 1, '"Load standard drug catalogue" adds just the one that is missing…');
  eq(count('drug_stock_batches'), 0, '…and still puts no stock on the shelf');

  // ============================================================================================================
  section('1 · a clinic with a bit of everything');
  await call('settings:save', { bill_round_off: false, gst_enabled: false, pharmacy_ipd_charge_enabled: true, ipd_auto_accrue_bed: false, ipd_auto_accrue_nursing: false, ipd_auto_accrue_doctor_visit: false });
  const sup = await call('wholesalers:upsert', { name: 'Fresh Supplies', drug_license_no: 'DL-FRESH' });
  const A = await mk('SF Alpha'), B = await mk('SF Beta'), C = await mk('SF Gamma'), D = await mk('SF Delta'), E = await mk('SF Epsilon'), F = await mk('SF Zeta'), G = await mk('SF Eta');
  const H = await mk('SF Theta');
  db.prepare('UPDATE drug_master SET is_active=0 WHERE id=?').run(H.id);                       // already switched off, no stock, no history
  const L = await mk('SF Locked');
  // something this code knows nothing about points at "SF Locked": erasing it fails, and the clear must carry on and keep it Inactive
  db.exec(`CREATE TRIGGER sf_lock BEFORE DELETE ON drug_master WHEN OLD.name='SF Locked' BEGIN SELECT RAISE(ABORT, 'a record this code does not know about points at it'); END;`);
  const pur = await call('purchase:create', {
    client_ref: 'sf-pur', invoice_number: 'SF-1', wholesaler_id: sup.id, invoice_date: day(0),
    items: [
      { drug_master_id: A.id, batch_no: 'A1', expiry: day(300), qty_received: 100, purchase_price: 60, mrp: 100, selling_price: 100 },
      { drug_master_id: B.id, batch_no: 'B1', expiry: day(300), qty_received: 50, purchase_price: 60, mrp: 100, selling_price: 100 },
    ],
  });
  ok(pur.ok, 'two drugs are bought on a supplier bill (Alpha 100, Beta 50)');
  const hand = (drug: any, batch_no: string, qty: number) => call('pharmacy:upsertBatch', { drug_master_id: drug.id, batch_no, expiry: day(400), qty_received: qty, qty_remaining: qty, mrp: 100, purchase_price: 50, is_active: 1 });
  await hand(C, 'C1', 20); await hand(E, 'E1', 30); await hand(F, 'F1', 40); await hand(G, 'G1', 10); await hand(G, 'G2', 5);
  eq(count('drug_stock_batches'), 7, 'four more are put on the shelf by hand (Gamma 20, Epsilon 30, Zeta 40, Eta 10 + 5 in a second batch) — seven batches in all');
  const sell = (drug: any, qty: number, ref: string) => attempt('pharmacy:sell', { client_ref: ref, items: [{ drug_master_id: drug.id, drug_name: drug.name, qty, rate: 100 }], payment_mode: 'Cash' });
  ok((await sell(A, 10, 'sf-s1')).ok && (await sell(E, 5, 'sf-s2')).ok, 'Alpha (10) and Epsilon (5) are sold over the counter');
  const doc = await call('doctors:create', { name: 'Dr. Fresh', specialty: 'GP', default_fee: 300 });
  const pat = await call('patients:create', { first_name: 'Fiona', last_name: 'Fresh', dob: '1970-03-03', gender: 'F', phone: '9300000009' });
  const ward = await call('wards:save', { name: 'General', ward_type: 'general', per_day_rate: 0, nursing_per_day: 0 });
  const bed = await call('beds:save', { ward_id: ward.id, bed_number: 'F-1' });
  const adm = await call('ip:admitV2', { patient_id: pat.id, bed_id: bed.id, admission_doctor_id: doc.id, performed_by: 'tester' });
  const admissionId = one('SELECT id FROM ip_admissions WHERE patient_id=? ORDER BY id DESC LIMIT 1', pat.id).id as number;
  const order = await call('ip:medOrderAdd', admissionId, { drug_name: F.name, drug_master_id: F.id, dose: '1 tab' });
  const given = await call('ip:medAdminGive', order.id, { status: 'given', qty: 2, administered_by: 'nurse' });
  ok(adm.ok && order.ok && given.ok, `Zeta (2) is given to an in-patient on the ward (${given.ok ? '' : given.error})`);
  eq((await shelf()).map((r) => r.name).join(', '), 'SF Alpha, SF Beta, SF Epsilon, SF Eta, SF Gamma, SF Zeta', 'Drugs in my clinic lists the six that have stock or a purchase');

  // users first (nobody is signed in yet), then switch sign-in on
  const mkUser = async (username: string, role: string) => (await call('auth:createUser', { username, password: 'pass1234', role, display_name: username })).id;
  await mkUser('phil', 'pharmacist'); await mkUser('rita', 'receptionist'); await mkUser('mona', 'manager');

  const history = async () => ({
    patients: count('patients'), bills: count('bills'), bill_items: count('bill_items'), sales: count('pharmacy_sales'), sale_items: count('pharmacy_sale_items'),
    register: count('dispensing_register'), invoices: count('purchase_invoices'), invoice_items: count('purchase_invoice_items'), payments: count('purchase_payments'),
    wholesalers: count('wholesalers'), orders: count('ip_medication_orders'),
    register_text: JSON.stringify(all('SELECT id, drug_master_id, batch_id, batch_no, qty, rate, unit_cost FROM dispensing_register ORDER BY id')),
    invoices_text: JSON.stringify(all('SELECT id, invoice_number, total, payment_status FROM purchase_invoices ORDER BY id')),
    owed: JSON.stringify(await call('wholesalers:summary')),
  });
  const dbCounts = () => ({ drugs: count('drug_master'), batches: count('drug_stock_batches'), stock: one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches').s });
  const before = await history();

  // ============================================================================================================
  section('2 · the preview tells the truth and changes nothing');
  const snap = JSON.stringify([dbCounts(), await history()]);
  const pCD = await preview([C.id, D.id]);
  eq(`${pCD.drugs}/${pCD.delete_drugs}/${pCD.keep_drugs}`, '2/2/0', 'Gamma + Delta: two drugs, both can be erased, none kept');
  eq(`${pCD.batches}/${pCD.batches_deleted}/${pCD.batches_zeroed}/${pCD.units}`, '1/1/0/20', '…one batch, deleted, 20 units');
  const pA = await preview([A.id]);
  eq(`${pA.delete_drugs}/${pA.keep_drugs}/${pA.kept_with_sales}/${pA.kept_with_purchases}`, '0/1/1/1', 'Alpha (bought and sold) is kept — a sale and a purchase mention it');
  eq(`${pA.batches_deleted}/${pA.batches_zeroed}/${pA.units}/${pA.units_from_purchases}`, '0/1/90/90', '…its batch was sold from, so it is zeroed; 90 units left, all from the supplier bill');
  const pB = await preview([B.id]);
  eq(`${pB.keep_drugs}/${pB.kept_with_purchases}/${pB.kept_with_sales}`, '1/1/0', 'Beta (bought, never sold) is kept because of the purchase only');
  eq(`${pB.batches_deleted}/${pB.batches_zeroed}/${pB.units}`, '1/0/50', '…its batch was never sold from, so it is deleted (50 units)');
  const pE = await preview([E.id]);
  eq(`${pE.keep_drugs}/${pE.kept_with_sales}/${pE.batches_zeroed}/${pE.units}/${pE.units_from_purchases}`, '1/1/1/25/0', 'Epsilon (typed in by hand, then sold) is kept; 25 units, none from a supplier bill');
  const pF = await preview([F.id]);
  eq(`${pF.keep_drugs}/${pF.kept_with_prescriptions}/${pF.batches_zeroed}/${pF.units}`, '1/1/1/38', 'Zeta (given on the ward) is kept because of the ward order; 38 units');
  const pG = await preview([G.id]);
  eq(`${pG.delete_drugs}/${pG.batches}/${pG.batches_deleted}/${pG.units}`, '1/2/2/15', 'Eta: erasable, two batches, 15 units');
  eq((await preview([987654])).drugs, 0, 'a drug that does not exist is ignored');
  eq((await preview([C.id, C.id, C.id])).drugs, 1, 'the same drug ticked three times counts once');
  eq(JSON.stringify([dbCounts(), await history()]), snap, 'none of the previews changed anything');
  eq((await preview(null)).drugs, count('drug_master'), 'start fresh would act on every drug in the list');

  // ============================================================================================================
  section('3 · who may do it, and deleting just the ticked drugs');
  await call('settings:save', { require_login: true });
  const frozen = JSON.stringify([dbCounts(), await history()]);
  for (const [who, role] of [['rita', 'receptionist'], ['mona', 'manager']]) {
    await call('auth:login', who, 'pass1234');
    const no = await clear({ ids: [C.id] });
    ok(!no.ok && new RegExp(`${role}.*not allowed`, 'i').test(no.error), `a ${role} is refused (${String(no.error).slice(0, 60)})`);
    const noAll = await clear({ confirm: 'START FRESH' });
    ok(!noAll.ok, '…also for start fresh, even with the phrase typed');
    await call('auth:logout');
  }
  eq(JSON.stringify([dbCounts(), await history()]), frozen, 'the refusals changed nothing');
  eq(backups().length, 0, '…and made no safety copy');

  await call('auth:login', 'phil', 'pass1234');
  const none = await clear({ ids: [] });
  ok(!none.ok && /tick at least one/i.test(none.error), 'nothing ticked is refused in plain words');
  const picked = await clear({ ids: [C.id, D.id, G.id] });
  ok(picked.ok, `the pharmacy in-charge deletes the ticked drugs (${picked.ok ? '' : picked.error})`);
  eq(picked.mode, 'selected', 'it reports that it was a selected delete');
  eq(`${picked.drugs_deleted}/${picked.drugs_kept_inactive}/${picked.batches_deleted}/${picked.batches_zeroed}/${picked.units_removed}`, '3/0/3/0/35', 'three drugs erased, three batches deleted, 35 units removed — as the preview said');
  eq([C, D, G].map((d) => !!drugRow(d.id)).join(), 'false,false,false', 'Gamma, Delta and Eta are gone from the Drug List');
  eq(batchRows(C.id).length + batchRows(G.id).length, 0, '…with their batches');
  ok([A, B, E, F].every((d) => !!drugRow(d.id)), 'the other drugs are untouched');
  eq((await shelf()).map((r) => r.name).join(', '), 'SF Alpha, SF Beta, SF Epsilon, SF Zeta', 'Drugs in my clinic now shows the other four');
  eq(backups().length, 1, 'a safety copy was saved first');
  const copy = new Database(path.join(backupDir, backups()[0]), { readonly: true });
  eq((copy.prepare("SELECT COUNT(*) c FROM drug_master WHERE name IN ('SF Gamma','SF Delta','SF Eta')").get() as any).c, 3, '…and it still holds the drugs that were just deleted');
  eq((copy.prepare('SELECT COUNT(*) c FROM drug_stock_batches').get() as any).c, 7, '…and all seven batches as they were');
  eq((copy.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok', '…and is a sound database file');
  copy.close();
  const audit1 = one("SELECT * FROM audit_log WHERE action='pharmacy.clear_selected' ORDER BY id DESC LIMIT 1");
  ok(!!audit1 && /"units_removed":35/.test(audit1.details) && /"backup"/.test(audit1.details) && audit1.details.includes(`"ids":[${C.id},${D.id},${G.id}]`),
    'the audit log records the counts, the ids, the batches cleared and where the copy is');
  await call('auth:logout');

  // ============================================================================================================
  section('4 · start fresh asks for the phrase, and saves a copy first or does nothing');
  await call('auth:login', 'phil', 'pass1234');
  const stateBefore = JSON.stringify([dbCounts(), await history()]);
  for (const [what, payload] of [['no phrase', {}], ['the wrong phrase', { confirm: 'START' }], ['an empty phrase', { confirm: '   ' }]] as [string, any][]) {
    const r = await clear(payload);
    ok(!r.ok && /type START FRESH/i.test(r.error), `${what} is refused by the main process, not just the screen`);
  }
  eq(JSON.stringify([dbCounts(), await history()]), stateBefore, '…and nothing changed');
  // a copy that cannot be saved means no clearing at all
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.writeFileSync(backupDir, 'not a folder');
  const blocked = await clear({ confirm: 'START FRESH' });
  ok(!blocked.ok && /nothing was cleared/i.test(blocked.error) && /safety copy/i.test(blocked.error), `if the safety copy cannot be saved, nothing is cleared (${String(blocked.error).slice(0, 80)})`);
  eq(JSON.stringify([dbCounts(), await history()]), stateBefore, '…the shelf is exactly as it was');
  fs.rmSync(backupDir, { force: true });
  await call('auth:logout');

  // ============================================================================================================
  section('5 · start fresh');
  const plan = await preview(null);
  eq(plan.drugs, CAT + 6, `the preview counts the whole list: the ${CAT} catalogue drugs + Alpha, Beta, Epsilon, Zeta, Theta, Locked`);
  eq(`${plan.delete_drugs}/${plan.keep_drugs}`, `${CAT + 2}/4`, '…the catalogue + Theta + Locked look erasable; the four with history are kept');
  eq(`${plan.batches}/${plan.batches_deleted}/${plan.batches_zeroed}/${plan.units}`, '4/1/3/203', '…four batches (one deleted, three zeroed), 203 units (90 + 50 + 25 + 38)');
  await call('auth:login', 'admin', 'admin123');
  const r = await clear({ confirm: ' start fresh ' });
  ok(r.ok, `the administrator starts fresh (typed in lower case with spaces — still accepted) (${r.ok ? '' : r.error})`);
  eq(r.mode, 'all', 'it reports that it cleared everything');
  eq(`${r.drugs_deleted}/${r.drugs_kept_inactive}`, `${CAT + 1}/5`, 'the catalogue and Theta are erased; the four with history AND "Locked" are kept Inactive (erasing Locked failed, and the clear carried on)');
  eq(`${r.batches_deleted}/${r.batches_zeroed}/${r.units_removed}`, '1/3/203', 'batches and units are exactly what the preview said');
  await call('auth:logout');

  const left = all('SELECT id, name, is_active FROM drug_master ORDER BY name');
  eq(left.map((d) => d.name).join(', '), 'SF Alpha, SF Beta, SF Epsilon, SF Locked, SF Zeta', 'only those five are left in the Drug List');
  ok(left.every((d) => d.is_active === 0), '…all Inactive');
  eq(count('drug_stock_batches'), 3, 'three batches remain — the ones the register points at (Alpha, Epsilon, Zeta); Beta\'s was never sold from and is gone');
  ok(all('SELECT * FROM drug_stock_batches').every((b) => b.qty_remaining === 0 && b.is_active === 0), '…all at zero and switched off');
  eq(one('SELECT COALESCE(SUM(qty_remaining),0) s FROM drug_stock_batches').s, 0, 'there is no stock left anywhere');
  eq((await shelf()).length, 0, 'Drugs in my clinic is empty');
  eq((await call('pharmacy:listDrugs', { activeOnly: true })).length, 0, 'and so is the list of drugs the counter can sell');
  eq(JSON.stringify(await history()), JSON.stringify(before), 'patients, bills, sales, the Schedule H register, purchase bills, payments, suppliers and what is owed are exactly as they were');
  ok(!!one("SELECT 1 FROM audit_log WHERE action='pharmacy.start_fresh'"), 'the audit log has the start-fresh entry');
  eq(backups().length, 1, 'a new safety copy was saved for it');
  db.exec('DROP TRIGGER sf_lock');

  // ============================================================================================================
  section('6 · history still reads, and the shelf works again');
  await call('settings:save', { require_login: false });
  eq(one("SELECT m.name n FROM dispensing_register r JOIN drug_master m ON m.id=r.drug_master_id WHERE r.drug_master_id=?", A.id).n, 'SF Alpha', 'the register still names what was dispensed');
  ok(!!(await call('pharmacy:saleDetail', one('SELECT id FROM pharmacy_sales ORDER BY id LIMIT 1').id)), 'an old sale still opens');
  const sold = await sell(A, 1, 'sf-after');
  ok(!sold.ok && /insufficient stock|no stock|not in stock|inactive/i.test((sold as any).error), `a cleared drug cannot be sold any more (${(sold as any).error?.slice(0, 60)})`);
  restart();
  eq(count('drug_master'), 5, 'a restart does not bring the catalogue back');
  const N = await mk('SF Newcomer');
  const p2 = await call('purchase:create', { client_ref: 'sf-pur2', invoice_number: 'SF-2', wholesaler_id: sup.id, invoice_date: day(0), items: [{ drug_master_id: N.id, batch_no: 'N1', expiry: day(200), qty_received: 12, purchase_price: 30, mrp: 50, selling_price: 50 }] });
  ok(p2.ok, 'a new drug is added and bought on a supplier bill');
  eq((await shelf()).map((x) => `${x.name}:${x.stock_qty}`).join(), 'SF Newcomer:12', 'Drugs in my clinic starts again from a clean list');

  // ============================================================================================================
  section('7 · a second run, nothing left to clear, and the read-only licence');
  const again = await preview(null);
  eq(`${again.drugs}/${again.delete_drugs}/${again.keep_drugs}`, '2/1/1', 'only Newcomer (kept: it was bought) and Locked (now erasable) are left to clear — the four an earlier clear settled are not counted again');
  const settled = await preview([A.id, B.id, E.id, F.id]);
  eq(`${settled.drugs}/${settled.batches}/${settled.units}`, '0/0/0', 'asking about those four finds nothing left to do');
  setReadOnlyMode(true);
  const ro = await clear({ confirm: 'START FRESH' });
  ok(!ro.ok, 'with an expired licence (read-only) clearing is blocked');
  ok((await attempt('pharmacy:previewClear', {})).ok, '…while looking at the preview still works');
  setReadOnlyMode(false);
  eq((await shelf()).length, 1, '…and the shelf was not touched');
  const r2 = await clear({ confirm: 'START FRESH' });
  eq(`${r2.ok}/${r2.drugs_deleted}/${r2.drugs_kept_inactive}/${r2.batches_deleted}/${r2.units_removed}`, 'true/1/1/1/12', 'a second start fresh clears Newcomer\'s 12 units and erases Locked');
  eq((await shelf()).length, 0, 'the shelf is empty again');
  const copies = backups().length;
  const auditRows = count('audit_log');
  const r3 = await clear({ confirm: 'START FRESH' });
  eq(`${r3.ok}/${r3.drugs_deleted}/${r3.drugs_kept_inactive}/${r3.batches_deleted}/${r3.batches_zeroed}/${r3.units_removed}`, 'true/0/0/0/0/0', 'a third run finds nothing to do…');
  eq(`${backups().length}/${count('audit_log')}`, `${copies}/${auditRows}`, '…and makes no safety copy and no audit entry for it');

  finish();

  function restart() { seedIfEmpty(db); runMigrations(db); }
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
