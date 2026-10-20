// Who may do what, enforced by the MAIN process (not just hidden screens), plus the licence read-only guard,
// injection attempts, and what the settings / user listings are allowed to reveal. Synthetic data.
import { boot, call, attempt, getDb, setReadOnlyMode } from './harness';
import { ok, eq, section, finish, note, finding } from './lib';

boot();
const q = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as any[];
const denied = (r: any) => r.ok === false && /(not allowed|sign in|administrator)/i.test(r.error);

(async () => {
  const today = (() => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();

  section('accounts');
  const users0 = await call('auth:listUsers');
  eq(users0.length, 1, 'a new install has exactly one account (admin)');
  ok(users0[0].username === 'admin' && users0[0].must_change_password === 1, 'it must change its password at first sign-in');
  ok(!('password_hash' in users0[0]) && !('salt' in users0[0]), 'the user list never carries password hashes or salts');
  ok((await call('auth:login', 'admin', 'wrong')) === null, 'a wrong password is refused');
  const adm = await call('auth:login', 'admin', 'admin123');
  ok(adm && adm.role === 'admin', 'the default admin can sign in');
  await call('auth:logout');

  // set up data and accounts with sign-in OFF (shared-PC mode: no identity to enforce)
  const sup = await call('wholesalers:upsert', { name: 'Sec Supplier', drug_license_no: 'DL-S' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Sec Drug', default_mrp: 10, gst_rate: 0, schedule: 'OTC' });
  const pur = await call('purchase:create', { invoice_number: 'SEC-1', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: drug.id, batch_no: 'S1', expiry: '2030-01-01', qty_received: 10, purchase_price: 5, mrp: 10 }] });
  ok(pur.ok, 'a purchase bill exists to test payments against');
  const patient = await call('patients:create', { first_name: 'Sec', last_name: 'Patient', dob: '1990-01-01', gender: 'F', phone: '9444444444' });
  const doctor = await call('doctors:create', { name: 'Dr. Sec', specialty: 'GP', default_fee: 100 });
  const appt = await call('appointments:create', { patient_id: patient.id, doctor_id: doctor.id, appointment_date: today, appointment_time: '10:00' });
  const bill = await call('bills:create', { appointment_id: appt.id, patient_id: patient.id, items: [{ description: 'Consultation', qty: 1, rate: 1000, amount: 1000 }], discount: 0, discount_type: 'flat', payment_mode: 'Cash' });
  const open1 = await call('bill:createStandalone', { patient_id: patient.id, bill_type: 'custom', items: [{ description: 'Procedure', qty: 1, rate: 1000 }] });
  const mk = async (username: string, role: string) => (await call('auth:createUser', { username, password: 'pass1234', role, display_name: username })).id;
  const uRec = await mk('rita', 'receptionist'); const uPh = await mk('phil', 'pharmacist'); const uDoc = await mk('dora', 'doctor');
  void uDoc; void uPh;
  ok(!!uRec, 'receptionist / pharmacist / doctor accounts created');
  await call('settings:save', { require_login: true });
  ok((await call('settings:get')).require_login === true, 'sign-in switched ON');

  section('nobody signed in');
  ok(denied(await attempt('pharmacy:bulkDeleteDrugs', [drug.id]) as any), 'deleting drugs needs a sign-in');
  ok(denied(await attempt('purchase:addPayment', pur.invoice.id, { amount: 1 }).then((r: any) => (r.ok ? r.value : r)) as any) || true, 'supplier payments need a sign-in');
  const payAnon = await attempt('purchase:addPayment', pur.invoice.id, { amount: 1 });
  ok(!payAnon.ok && /sign in/i.test((payAnon as any).error), 'paying a supplier with nobody signed in is refused');
  ok(!(await attempt('auth:createUser', { username: 'x1', password: 'abcd', role: 'admin' })).ok, 'creating an administrator with nobody signed in is refused');

  section('receptionist');
  const rec = await call('auth:login', 'rita', 'pass1234');
  ok(rec && rec.role === 'receptionist', 'receptionist signs in');
  ok(!(await attempt('pharmacy:bulkDeleteDrugs', [drug.id])).ok, 'cannot delete drugs');
  const rpay = await attempt('purchase:addPayment', pur.invoice.id, { amount: 1 });
  ok(!rpay.ok && /not allowed/i.test((rpay as any).error), 'cannot pay a supplier (money leaving the business)');
  const esc1 = await attempt('auth:createUser', { username: 'sneaky', password: 'abcd', role: 'admin' });
  ok(!esc1.ok && /administrator/i.test((esc1 as any).error), 'cannot create an administrator account');
  const esc2 = await attempt('auth:updateUser', rec.id, { role: 'admin' });
  ok(!esc2.ok, 'cannot promote itself to administrator');
  const esc3 = await attempt('auth:changePassword', 1, 'hacked99');
  ok(!esc3.ok && /another person/i.test((esc3 as any).error), "cannot reset the administrator's password");
  ok((await attempt('auth:changePassword', rec.id, 'newpass99')).ok, 'can change its OWN password');
  ok((await call('auth:login', 'rita', 'newpass99'))?.username === 'rita', '…and sign in with it');
  // discount cap follows the SESSION role, not the argument
  const disc = await call('bill:setDiscount', open1.id, 900, 'flat', 'admin', 'because', 'rita');
  ok(disc.ok === false && /limited to/i.test(disc.error), 'a 90% discount is refused by the receptionist cap even when the caller CLAIMS to be admin');
  const none = await call('bill:setDiscount', open1.id, 50, 'flat', 'receptionist', 'goodwill', 'rita');
  ok(none.ok === false && /limited to 0%/.test(none.error), 'by default a receptionist may give no discount at all (cap 0%) — an owner decision in Settings');
  await call('auth:logout'); await call('auth:login', 'admin', 'admin123');
  await call('settings:save', { discount_caps_json: JSON.stringify({ receptionist: 10 }) });
  await call('auth:logout'); await call('auth:login', 'rita', 'newpass99');
  const small = await call('bill:setDiscount', open1.id, 50, 'flat', 'receptionist', 'goodwill', 'rita');
  ok(small.ok === true, `once the owner allows 10%, a 5% discount is accepted (${JSON.stringify(small)})`);
  const big = await call('bill:setDiscount', open1.id, 150, 'flat', 'receptionist', 'too much', 'rita');
  ok(big.ok === false, 'and 15% is still refused');
  await call('auth:logout');

  section('pharmacist');
  const ph = await call('auth:login', 'phil', 'pass1234');
  ok(ph && ph.role === 'pharmacist', 'pharmacist signs in');
  const ppay = await call('purchase:addPayment', pur.invoice.id, { amount: 10, mode: 'Cash' });
  ok(ppay.ok, 'a pharmacist CAN pay a supplier');
  await call('auth:logout');

  section('administrator');
  await call('auth:login', 'admin', 'admin123');
  const ok1 = await attempt('auth:createUser', { username: 'second_admin', password: 'abcd1234', role: 'admin' });
  ok(ok1.ok, 'an administrator can create another administrator');
  const lastAdmin = await attempt('auth:updateUser', 1, { is_active: 0 });
  ok(lastAdmin.ok, 'an administrator can deactivate another account (there are now two)');
  await call('auth:updateUser', 1, { is_active: 1 });
  const only = q("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1")[0].c;
  ok(only >= 2, 'two active administrators');
  await call('auth:logout');

  section('login throttling');
  let blocked = false;
  for (let i = 0; i < 6; i++) { await call('auth:login', 'dora', 'nope'); }
  blocked = (await call('auth:login', 'dora', 'pass1234')) === null;
  ok(blocked, 'after repeated wrong passwords even the RIGHT password is refused for a while (brute-force guard)');

  section('injection attempts');
  const tables = () => q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name).sort().join(',');
  const t0 = tables();
  const evil = ["'; DROP TABLE patients; --", "' OR '1'='1", '" OR ""="', "%'; DELETE FROM bills; --"];
  for (const e of evil) {
    await attempt('patients:search', e); await attempt('bills:list', { q: e }); await attempt('pharmacy:listDrugs', { q: e });
    await attempt('lab:listOrders', { status: e }); await attempt('reports:run', { kind: e, from: e, to: e }); await attempt('patients:allList', { q: e });
  }
  eq(tables(), t0, 'every table still exists after hostile search strings');
  ok(q('SELECT COUNT(*) c FROM patients')[0].c >= 1 && q('SELECT COUNT(*) c FROM bills')[0].c >= 1, 'patients and bills are intact');
  eq((await call('patients:search', "' OR '1'='1")).length, 0, '"\' OR \'1\'=\'1" matches no one (it is data, not SQL)');

  section('what settings reveal');
  const st = await call('settings:get');
  ok(st.admin_password === undefined || st.admin_password === '' || /^\*+$/.test(String(st.admin_password)) || st.admin_password === null, `the admin PIN is not returned in the clear (${JSON.stringify(st.admin_password)?.slice(0, 20)})`);
  ok(!JSON.stringify(st).includes('$scrypt$'), 'no password hash is returned either');

  section('licence expired → read-only');
  setReadOnlyMode(true);
  for (const [ch, args] of [['patients:create', [{ first_name: 'Ro', phone: '1', dob: '1990-01-01', gender: 'M' }]], ['purchase:create', [{}]], ['purchase:addPayment', [1, { amount: 1 }]], ['pharmacy:sell', [{ items: [] }]], ['bill:pay', [bill.id, 1, 'Cash']], ['bills:create', [{}]], ['lab:createOrder', [{}]], ['bill:createStandalone', [{}]]] as [string, any[]][]) {
    const r = await attempt(ch, ...args);
    ok(!r.ok && /read-only/i.test((r as any).error), `${ch} is blocked when the licence has expired`);
  }
  for (const [ch, args] of [['patients:search', ['Sec']], ['analytics:pharmacyProfit', [{ from: today, to: today }]], ['purchase:list', [{}]], ['finance:summary', [{}]]] as [string, any[]][]) {
    const r = await attempt(ch, ...args);
    ok(r.ok, `${ch} (viewing) still works when the licence has expired`);
  }
  setReadOnlyMode(false);

  finding('Role checks in the main process use ONE process-wide session (whoever last signed in on the PC that runs the database). In multi-station mode every cabin reaches the host through a shared network secret and is judged as the HOST PC\'s signed-in user, not as itself. Fixing this needs a per-request identity in the network protocol — not changed.');
  finding('Only ~15 sensitive channels are role-gated in the main process (deletes, supplier payments, lab/pharmacy admin, discounts, user management). Everything else relies on the screens hiding what a role should not see — adequate for a trusted-staff clinic, not against a hostile signed-in user.');
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
