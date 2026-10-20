// Real-SQLite test of the radiology department: migrations (fresh + upgrade), catalogue,
// ordering, billing, re-pricing, reporting, cancelling and cleanup.
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { seedIfEmpty } from '../../src/db/seed';
import * as rad from '../../src/main/radiology';

let pass = 0, fail = 0;
function ok(cond: any, msg: string) { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } }
function throws(fn: () => any, re: RegExp, msg: string) {
  try { fn(); fail++; console.log('  ✗ FAIL (no error):', msg); }
  catch (e: any) { if (re.test(e.message)) { pass++; console.log('  ✓', msg, '→', JSON.stringify(e.message).slice(0, 90)); } else { fail++; console.log('  ✗ FAIL wrong error:', msg, e.message); } }
}
function fresh() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db); seedIfEmpty(db);
  return db;
}
const deps = (autoBill = true) => ({ autoBill, invoicePrefix: 'INV', audit: () => {} });
function addPatient(db: any, n = 1) {
  const r = db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone) VALUES (?, 'Asha', 'Rao', '1990-01-01', 'F', ?)").run('PT-T-' + n, '99000000' + n);
  return Number(r.lastInsertRowid);
}
function addDoctor(db: any) {
  const cols = db.prepare("PRAGMA table_info(doctors)").all().map((c: any) => c.name);
  const r = db.prepare("INSERT INTO doctors (name, specialty) VALUES ('Dr. T', 'General')").run();
  return Number(r.lastInsertRowid);
}

console.log('\n== 1. FRESH INSTALL ==');
{
  const db = fresh();
  const n = (db.prepare('SELECT COUNT(*) c FROM radiology_tests').get() as any).c;
  ok(n === 55, `standard radiology catalogue seeded (${n} tests)`);
  const labRad = (db.prepare("SELECT COUNT(*) c FROM lab_tests WHERE category='radiology'").get() as any).c;
  ok(labRad === 0, 'no radiology tests leaked into the LAB catalogue');
  const head = db.prepare("SELECT name FROM charge_heads WHERE category='radiology'").get() as any;
  ok(head?.name === 'Radiology', 'Radiology billing head exists');
  const heads = (db.prepare('SELECT COUNT(*) c FROM charge_heads').get() as any).c;
  ok(heads >= 12, `default billing heads still seeded alongside it (${heads})`);
  ok(db.prepare("SELECT 1 FROM pragma_table_info('bills') WHERE name='radiology_order_id'").get(), 'bills.radiology_order_id column exists');
  const xr = db.prepare("SELECT price, modality FROM radiology_tests WHERE name='X-Ray Chest PA View'").get() as any;
  ok(xr && xr.price === 250 && xr.modality === 'xray', 'known price (₹250) + modality carried for X-Ray Chest PA');
  // idempotent re-run
  runMigrations(db); seedIfEmpty(db);
  ok((db.prepare('SELECT COUNT(*) c FROM radiology_tests').get() as any).c === 55, 'running migrations + seed again adds nothing');
}

console.log('\n== 2. UPGRADE of an existing clinic (radiology lived in the lab catalogue) ==');
{
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  runMigrations(db);              // a clinic on the new schema…
  // …rewind to the old world: radiology tests in lab_tests with the clinic's own prices, flags unset
  db.exec("DELETE FROM radiology_tests; DELETE FROM settings WHERE key IN ('radiology_catalog_migrated','radiology_catalog_seeded');");
  const ins = db.prepare("INSERT INTO lab_tests (name, price, category, is_active) VALUES (?, ?, 'radiology', ?)");
  ins.run('X-Ray Chest PA View', 180, 1); ins.run('USG Whole Abdomen', 900, 1); ins.run('MRI Brain', 3500, 0);
  db.prepare("INSERT INTO lab_tests (name, price, category) VALUES ('CBC', 300, 'haematology')").run();
  runMigrations(db); seedIfEmpty(db);
  const rows = db.prepare('SELECT name, price, is_active, modality FROM radiology_tests ORDER BY name').all() as any[];
  ok(rows.length === 3, `only the clinic's 3 imaging tests moved, not the whole standard list (${rows.length})`);
  const x = rows.find((r) => r.name === 'X-Ray Chest PA View');
  ok(x && x.price === 180, "the clinic's own price (₹180) survived, not reset to the default");
  ok(rows.find((r) => r.name === 'MRI Brain')?.is_active === 0, 'an inactive test stays inactive');
  ok(rows.find((r) => r.name === 'USG Whole Abdomen')?.modality === 'usg', 'modality inferred from the name');
  ok((db.prepare("SELECT COUNT(*) c FROM lab_tests WHERE name='CBC'").get() as any).c === 1, 'lab tests untouched');
  runMigrations(db); seedIfEmpty(db);
  ok((db.prepare('SELECT COUNT(*) c FROM radiology_tests').get() as any).c === 3, 're-running does not resurrect tests the clinic never had');
}

console.log('\n== 3. ORDER → BILL ==');
{
  const db = fresh();
  const pid = addPatient(db), did = addDoctor(db);
  const t = db.prepare("SELECT id FROM radiology_tests WHERE name='USG Whole Abdomen'").get() as any;
  db.prepare("UPDATE radiology_tests SET price=900 WHERE id=?").run(t.id);
  const xr = db.prepare("SELECT id FROM radiology_tests WHERE name='X-Ray Chest PA View'").get() as any;
  const o: any = rad.createOrder(db, { patient_id: pid, doctor_id: did, referred_by: 'Ramesh K', clinical_info: 'Pain RUQ', items: [{ test_id: t.id }, { test_id: xr.id }, { test_id: t.id }] }, deps());
  ok(/^RAD-\d{8}-0001$/.test(o.order_number), `order number ${o.order_number}`);
  ok(o.items.length === 2, 'the same scan twice on one order collapsed to once');
  ok(o.referred_by === 'Ramesh K' && o.clinical_info === 'Pain RUQ', 'referring doctor + clinical info stored');
  ok(o.total === 1150, `order total ₹${o.total} (900 + 250)`);
  ok(o.bill_id && o.bill_status === 'unpaid' && o.bill_total === 1150, `unpaid bill ${o.bill_number} raised for ₹${o.bill_total}`);
  const bill = db.prepare('SELECT * FROM bills WHERE id=?').get(o.bill_id) as any;
  ok(bill.bill_kind === 'radiology' && bill.bill_type === 'radiology' && bill.radiology_order_id === o.id, 'bill typed radiology and linked to the order');
  const lines = db.prepare("SELECT description, amount, source, charge_head_id FROM bill_items WHERE bill_id=?").all(o.bill_id) as any[];
  ok(lines.length === 2 && lines.every((l) => l.source === 'radiology' && l.charge_head_id), 'real bill_items rows written (so the standard bill can print it)');
  ok(JSON.parse(bill.items_json).length === 2, 'legacy items_json kept in step');
  const o2: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'Custom Dental OPG', price: 400 }] }, deps());
  ok(/-0002$/.test(o2.order_number), 'second order gets the next number');
  ok(o2.items[0].test_id === null && o2.items[0].price === 400, 'a custom (uncatalogued) scan with a typed price is accepted');
  throws(() => rad.createOrder(db, { patient_id: pid, items: [] }, deps()), /at least one/i, 'empty order refused with a clear message');
  throws(() => rad.createOrder(db, { patient_id: 99999, items: [{ test_name: 'X' }] }, deps()), /patient/i, 'unknown patient refused');
  const o3: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'Unpriced scan' }] }, deps());
  ok(!o3.bill_id, 'an order with no priced scan raises no bill (nothing to charge)');
  const o4: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'Billing off', price: 100 }] }, deps(false));
  ok(!o4.bill_id, 'auto-billing switched off → no bill');
}

console.log('\n== 4. FROM A BOOKING: inherits referring doctor + consultant ==');
{
  const db = fresh();
  const pid = addPatient(db), did = addDoctor(db);
  const a = db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, referred_by) VALUES (?, ?, date('now'), '10:00', 1, 'Dr Meena S')").run(pid, did);
  const o: any = rad.createOrder(db, { patient_id: pid, appointment_id: Number(a.lastInsertRowid), items: [{ test_name: 'CT Chest', price: 2500 }] }, deps());
  ok(o.referred_by === 'Dr Meena S', 'referring doctor inherited from the appointment');
  ok(o.doctor_id === did, 'consulting doctor inherited from the appointment');
  ok(rad.listOrders(db, { patient_id: pid }).length === 1, "appears in the patient's own history");
}

console.log('\n== 5. EDIT SCANS → BILL FOLLOWS ==');
{
  const db = fresh();
  const pid = addPatient(db);
  const o: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'USG Pelvis', price: 700 }, { test_name: 'X-Ray Knee', price: 300 }] }, deps());
  const r1 = rad.addItems(db, o.id, [{ test_name: 'CT Brain', price: 2000 }], deps());
  ok(r1.billChanged && r1.total === 3000, `add a scan → unpaid bill re-priced to ₹${r1.total}`);
  ok((db.prepare('SELECT COUNT(*) c FROM bill_items WHERE bill_id=?').get(o.bill_id) as any).c === 3, 'bill lines now 3 (replaced, not duplicated)');
  throws(() => rad.addItems(db, o.id, [{ test_name: 'CT Brain' }], deps()), /not already/i, 'adding a scan the order already has is refused');
  const kneeId = r1.order.items.find((i: any) => i.test_name === 'X-Ray Knee').id;
  const r2 = rad.removeItem(db, o.id, kneeId, deps());
  ok(r2.billChanged && r2.total === 2700, `remove a scan → bill re-priced to ₹${r2.total}`);
  // pay it, then change the order: bill must be left alone
  db.prepare("UPDATE bills SET amount_paid=2700, status='paid', paid_at=? WHERE id=?").run(new Date().toISOString(), o.bill_id);
  const r3 = rad.addItems(db, o.id, [{ test_name: 'MRI Brain', price: 4000 }], deps());
  ok(!r3.billChanged && /settled/.test(r3.note), 'a PAID bill is never rewritten — the screen is told to adjust it manually');
  ok((db.prepare('SELECT total FROM bills WHERE id=?').get(o.bill_id) as any).total === 2700, 'paid bill total unchanged');
  const only: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'One only', price: 100 }] }, deps());
  throws(() => rad.removeItem(db, only.id, only.items[0].id, deps()), /at least one/i, 'cannot remove the last scan');
}

console.log('\n== 6. DO THE SCAN → WRITE THE REPORT ==');
{
  const db = fresh();
  const pid = addPatient(db);
  const o: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'X-Ray Chest PA View', price: 250 }, { test_name: 'USG KUB', price: 600 }] }, deps());
  const done = rad.updateStatus(db, o.id, 'done');
  ok(done.status === 'done' && done.performed_at, 'marked done → performed_at stamped');
  throws(() => rad.saveReport(db, o.id, [], { finalize: true }), /findings or the impression/i, 'cannot mark a blank report ready');
  const draft = rad.saveReport(db, o.id, [{ id: o.items[0].id, findings: 'Lungs clear.', impression: 'Normal study.' }], { reportedBy: 'Dr. R. Iyer' });
  ok(draft.status === 'done', 'saving a draft does not move the status');
  ok(draft.items[0].findings === 'Lungs clear.' && draft.items[1].findings == null, 'only the supplied fields were written');
  const fin = rad.saveReport(db, o.id, [{ id: o.items[1].id, findings: 'Mild fatty liver.', impression: 'Grade I fatty liver.', is_abnormal: 1 }], { reportedBy: 'Dr. R. Iyer', finalize: true });
  ok(fin.status === 'reported' && fin.reported_at && fin.reported_by === 'Dr. R. Iyer', 'finalised → reported, with who and when');
  ok(fin.items[1].is_abnormal === 1, 'abnormal flag stored');
  const other: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'Other', price: 1 }] }, deps());
  rad.saveReport(db, other.id, [{ id: o.items[0].id, findings: 'HIJACK' }], {});
  ok((db.prepare('SELECT findings FROM radiology_order_items WHERE id=?').get(o.items[0].id) as any).findings === 'Lungs clear.', "a stale draft from one order cannot overwrite another order's report");
  throws(() => rad.removeItem(db, o.id, o.items[0].id, deps()), /cannot be removed|reported/i, 'a scan with a written report cannot be removed');
  throws(() => rad.addItems(db, o.id, [{ test_name: 'More' }], deps()), /already been issued/i, 'cannot add to a reported order');
  throws(() => rad.cancelOrder(db, o.id, null, 'u', deps()), /report has already been issued/i, 'a reported order cannot be cancelled');
}

console.log('\n== 7. CANCEL ==');
{
  const db = fresh();
  const pid = addPatient(db);
  const a: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'USG', price: 500 }] }, deps());
  const c = rad.cancelOrder(db, a.id, 'Patient left', 'reception', deps());
  ok(c.order.status === 'cancelled' && /cancelled with it/.test(c.note), 'unpaid order cancelled → its bill cancelled too');
  ok((db.prepare('SELECT status FROM bills WHERE id=?').get(a.bill_id) as any).status === 'cancelled', 'bill status = cancelled');
  const b: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'CT', price: 2000 }] }, deps());
  db.prepare("UPDATE bills SET amount_paid=2000, status='paid', paid_at=? WHERE id=?").run(new Date().toISOString(), b.bill_id);
  const c2 = rad.cancelOrder(db, b.id, null, 'reception', deps());
  ok(/already been paid/.test(c2.note), 'cancelling a PAID order leaves the bill for a refund and says so');
  ok((db.prepare('SELECT status FROM bills WHERE id=?').get(b.bill_id) as any).status === 'paid', 'paid bill untouched');
  throws(() => rad.updateStatus(db, a.id, 'done'), /cancelled/, 'a cancelled order cannot be moved on');
}

console.log('\n== 8. LISTING ==');
{
  const db = fresh();
  const p1 = addPatient(db, 1), p2 = addPatient(db, 2);
  rad.createOrder(db, { patient_id: p1, items: [{ test_name: 'A', price: 1 }] }, deps());
  const o2: any = rad.createOrder(db, { patient_id: p2, items: [{ test_name: 'B, with comma', price: 2 }, { test_name: 'C', price: 3 }] }, deps());
  rad.updateStatus(db, o2.id, 'done');
  ok(rad.listOrders(db, {}).length === 2, 'list all');
  ok(rad.listOrders(db, { status: 'done' }).length === 1, 'filter by status');
  ok(rad.listOrders(db, { status: 'open' }).length === 2, "'open' = ordered + done (work still to do)");
  rad.updateStatus(db, o2.id, 'reported');
  ok(rad.listOrders(db, { status: 'open' }).length === 1, "a reported order leaves 'open'");
  rad.updateStatus(db, o2.id, 'done');
  ok(rad.listOrders(db, { q: 'PT-T-2' }).length === 1, 'search by UHID');
  ok(rad.listOrders(db, { q: '990000002' }).length === 1, 'search by phone');
  ok(rad.listOrders(db, { window: 'today' }).length === 2, "'today' window includes today's orders");
  const row: any = rad.listOrders(db, { patient_id: p2 })[0];
  ok(row.test_names.split('\u001f').length === 2 && row.test_names.includes('B, with comma'), 'test names survive commas (unit-separator join)');
  ok(row.total === 5 && row.bill_total === 5, 'row carries the order total and bill total');
}

console.log('\n== 9. CATALOGUE ==');
{
  const db = fresh();
  const t: any = rad.upsertTest(db, { name: 'Test Scan', price: 123 });
  ok(t.modality === 'other' && t.price === 123, 'add a test (modality inferred)');
  throws(() => rad.upsertTest(db, { name: 'test scan' }), /already exists/, 'duplicate name refused (case-insensitive)');
  const u: any = rad.upsertTest(db, { id: t.id, name: 'Test Scan', modality: 'ct', price: 500 });
  ok(u.modality === 'ct' && u.price === 500, 'edit a test');
  const pid = addPatient(db);
  const o: any = rad.createOrder(db, { patient_id: pid, items: [{ test_id: t.id }] }, deps());
  rad.upsertTest(db, { id: t.id, name: 'Test Scan', modality: 'ct', price: 999 });
  ok((db.prepare('SELECT price FROM radiology_order_items WHERE order_id=?').get(o.id) as any).price === 500, 'changing a price later does NOT rewrite an existing order (price is frozen at ordering)');
  const d = rad.bulkDeleteTests(db, [t.id]);
  ok(d.deactivated === 1 && d.deleted === 0, 'a test that was ordered is deactivated, not deleted');
  const fresh1: any = rad.upsertTest(db, { name: 'Never used' });
  ok(rad.bulkDeleteTests(db, [fresh1.id]).deleted === 1, 'a never-used test is deleted');
  ok(rad.loadStandardCatalog(db).added === 0, 'loading the standard catalogue again adds nothing');
  ok((rad.listTests(db, true) as any[]).every((x) => x.is_active === 1), 'active-only listing');
}

console.log('\n== 10. CLEANUP when a patient / appointment is deleted ==');
{
  const db = fresh();
  const pid = addPatient(db);
  const o: any = rad.createOrder(db, { patient_id: pid, items: [{ test_name: 'X', price: 10 }] }, deps());
  rad.deleteOrdersForPatient(db, pid);
  ok((db.prepare('SELECT COUNT(*) c FROM radiology_orders').get() as any).c === 0, 'orders removed');
  ok((db.prepare('SELECT COUNT(*) c FROM radiology_order_items').get() as any).c === 0, 'items removed');
  ok((db.prepare('SELECT radiology_order_id r FROM bills WHERE id=?').get(o.bill_id) as any).r === null, 'bill kept (money record) but unlinked');
}

console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
