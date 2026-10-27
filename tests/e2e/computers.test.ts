// "How many computers?" — the one answer that decides how sign-in and access work (Settings → Computers & staff, and the first-start Setup guide).
// Owner, 2026-10-27: one computer = it opens as RECEPTION (nobody signs in), the administrator chooses what Reception may open and how much it may
// discount; more than one = one main computer, everyone signs in. Rules proved here, each on the real code:
//   - the saved answer wins; a clinic that never answered is READ from its network setting (so an update changes nobody's way of working);
//   - "What can Reception do?" is the Reception column of the SAME role matrix as "Who can open what" — switching one screen touches nothing else,
//     a screen back at its built-in roles drops out of the saved text, and "nobody but the admin" is stored so it really is off;
//   - the shared desk follows ONLY the Reception column (a screen switched off for Reception is off even though a doctor could open it);
//   - the discount limit for the shared desk comes from the main process, not from what a screen sends; blank = no limit (as it has always been);
//   - the 'computers' step is part of the Setup guide, but never keeps the "setup is not finished" reminder showing.
import { boot, call, attempt, getDb } from './harness';
import { ok, eq, section, finish } from './lib';
import { computersMode, thisComputer, hasAnsweredComputers, receptionCan, canSwitchReceptionOff, withReceptionAccess, RECEPTION_SCREENS } from '../../src/lib/computers';
import { ACCESS_MODULES, effectiveRoles, parseRoleAccess } from '../../src/lib/accessModules';
import { moduleState } from '../../src/lib/moduleAccess';

boot();
const db = getDb();

(async () => {
  // ============================================================================================================
  section('1 · the answer, and what an update reads when nobody answered');
  eq(computersMode({ computers_mode: 'single', network_mode: 'server' }), 'single', 'a saved "one computer" wins, whatever the network setting says');
  eq(computersMode({ computers_mode: 'multi', network_mode: 'local' }), 'multi', 'a saved "more than one" wins too');
  eq(computersMode({ computers_mode: '', network_mode: 'local' }), 'single', 'never answered + stand-alone PC = one computer');
  eq(computersMode({ computers_mode: '', network_mode: 'server' }), 'multi', 'never answered + main computer of a network = more than one');
  eq(computersMode({ computers_mode: '', network_mode: 'client' }), 'multi', 'never answered + extra computer = more than one');
  eq(computersMode({}), 'single', 'nothing known = one computer');
  eq(computersMode(null), 'single', '…and no settings at all does not throw');
  eq(computersMode({ computers_mode: 'banana', network_mode: 'server' }), 'multi', 'an unreadable saved answer is ignored (the network setting decides)');
  ok(!hasAnsweredComputers({ computers_mode: '' }) && !hasAnsweredComputers(null) && !hasAnsweredComputers({ computers_mode: 'x' }), 'an empty or odd value is "not answered"');
  ok(hasAnsweredComputers({ computers_mode: 'single' }) && hasAnsweredComputers({ computers_mode: 'multi' }), '"single" and "multi" are answers');
  eq(thisComputer({ network_mode: 'local' }), 'alone', 'this computer: stand-alone = the only computer');
  eq(thisComputer({ network_mode: 'server' }), 'main', '…server = the main computer');
  eq(thisComputer({ network_mode: 'client' }), 'other', '…client = an extra computer');
  eq(thisComputer(undefined), 'alone', '…unknown = the only computer');

  // ============================================================================================================
  section('2 · what Reception can do — the Reception column of the role matrix');
  ok(RECEPTION_SCREENS.length === ACCESS_MODULES.length - 1 && !RECEPTION_SCREENS.some((m) => m.path === '/reception'), 'every screen but the Reception desk itself can be switched');
  ok(ACCESS_MODULES.every((m) => receptionCan(m.path, '')), 'by default Reception can open every screen it could before (nothing changes on update)');
  ok(receptionCan('/doctor-select', ''), '…Doctor Consultation included');
  ok(receptionCan('/nowhere', ''), 'a path the matrix does not know is not blocked by this list');
  ok(!canSwitchReceptionOff('/reception') && !canSwitchReceptionOff('/nowhere') && canSwitchReceptionOff('/billing'), 'only a known screen other than Reception itself can be switched off');

  const off = withReceptionAccess('', '/billing', false);
  ok(!receptionCan('/billing', off), 'Billing switched off for Reception');
  eq(JSON.stringify(parseRoleAccess(off)), JSON.stringify({ '/billing': ['manager'] }), '…and only that screen is saved, with the roles that still hold it');
  ok(receptionCan('/lab', off) && receptionCan('/pharmacy', off), '…every other screen is untouched');
  eq(withReceptionAccess(off, '/billing', false), off, 'switching off what is already off changes nothing');
  eq(withReceptionAccess(off, '/billing', true), '', 'switching it back on removes it from the saved text (the setting is empty again, like a clinic that never changed anything)');

  const two = withReceptionAccess(withReceptionAccess('', '/lab', false), '/pharmacy', false);
  const back = withReceptionAccess(two, '/lab', true);
  eq(JSON.stringify(parseRoleAccess(back)), JSON.stringify({ '/pharmacy': ['pharmacist', 'doctor'] }), 'two screens off, one back on: only the other stays saved');
  ok(!receptionCan('/pharmacy', back) && receptionCan('/lab', back), '…and each answers correctly');

  // Another role's customisation is never disturbed.
  const custom = JSON.stringify({ '/lab': ['lab_tech', 'nurse', 'receptionist'], '/tpa': ['manager'] });
  const customOff = withReceptionAccess(custom, '/lab', false);
  eq(JSON.stringify(parseRoleAccess(customOff)['/lab']), JSON.stringify(['lab_tech', 'nurse']), 'a role list the admin had edited keeps its other roles when Reception is switched off');
  eq(JSON.stringify(parseRoleAccess(customOff)['/tpa']), JSON.stringify(['manager']), '…and an unrelated screen\'s override is kept');
  ok(receptionCan('/tpa', custom) === false, 'a screen the admin had already taken from Reception reads as off');
  eq(parseRoleAccess(withReceptionAccess(custom, '/tpa', true))['/tpa'], undefined, '…and switching it on again puts the screen back at its built-in roles, so it drops out of the saved text');
  eq(JSON.stringify(parseRoleAccess(withReceptionAccess(customOff, '/lab', true))['/lab']), JSON.stringify(['lab_tech', 'nurse', 'receptionist']), 'switching Reception back on adds it to the roles the admin had chosen');

  // "Nobody but the administrator" must be stored so it is really off (an empty list would mean "no override" and leave Reception on).
  const onlyRx = JSON.stringify({ '/billing': ['receptionist'] });
  const nobody = withReceptionAccess(onlyRx, '/billing', false);
  eq(JSON.stringify(parseRoleAccess(nobody)['/billing']), JSON.stringify(['admin']), 'if Reception was the only role on a screen, switching it off stores the administrator alone');
  ok(!receptionCan('/billing', nobody), '…so the screen really is off for Reception');
  eq(JSON.stringify(effectiveRoles('/billing', ['receptionist', 'manager'], parseRoleAccess(nobody))), JSON.stringify(['admin']), '…and the role matrix reads it the same way');

  eq(withReceptionAccess('{ not json', '/lab', false), JSON.stringify({ '/lab': ['lab_tech', 'doctor'] }), 'a damaged saved text is treated as "nothing changed yet", never a crash');
  eq(withReceptionAccess('', '/reception', false), '', 'the Reception desk itself cannot be switched off');
  eq(withReceptionAccess('', '/nowhere', false), '', 'an unknown screen is ignored');

  // ============================================================================================================
  section('3 · the shared desk follows only the Reception column');
  const ctx = (role: string, id: number, overrides: any, extra: any = {}) => {
    const path = extra.path ?? '/doctor-select';
    const m = ACCESS_MODULES.find((x) => x.path === path)!;
    return { user: { role, id }, adminUnlocked: false, licensedModules: undefined, settings: {}, overrides, defaults: m.defaults, ...extra };
  };
  const rxOff = parseRoleAccess(withReceptionAccess('', '/doctor-select', false));
  eq(moduleState('/doctor-select', ctx('staff', 0, {})).allowed, true, 'the Reception desk opens Doctor Consultation by default');
  const denied = moduleState('/doctor-select', ctx('staff', 0, rxOff));
  ok(denied.allowed === false && denied.reason === 'role', 'switched off for Reception = refused with the "role" reason…');
  eq(moduleState('/doctor-select', ctx('doctor', 5, rxOff)).allowed, true, '…while a doctor who signs in still opens it');
  eq(moduleState('/doctor-select', ctx('staff', 0, rxOff, { adminUnlocked: true })).allowed, true, '…and the admin password still opens everything');
  eq(moduleState('/doctor-select', ctx('admin', 1, rxOff)).allowed, true, '…as does the Admin account');
  eq(moduleState('/billing', ctx('staff', 0, rxOff, { path: '/billing' })).allowed, true, 'a screen that was not switched off stays open');
  const stillRx = moduleState('/doctor-select', ctx('receptionist', 7, rxOff));
  ok(stillRx.allowed === false, 'a signed-in receptionist follows the same column');

  // ============================================================================================================
  section('4 · the two new settings through the real handlers');
  const s0 = await call('settings:get');
  eq(s0.computers_mode, '', 'a fresh database has not answered the question');
  eq(s0.shared_desk_discount_pct, null, '…and Reception has no discount limit');
  await call('settings:save', { computers_mode: 'multi' });
  eq((await call('settings:get')).computers_mode, 'multi', 'the answer "more than one" is saved and read back');
  await call('settings:save', { computers_mode: 'single' });
  eq((await call('settings:get')).computers_mode, 'single', '…and can be changed to "one computer"');
  await call('settings:save', { computers_mode: 'banana' });
  eq((await call('settings:get')).computers_mode, '', 'an unreadable answer is read as "not answered"');
  for (const [put, want] of [[7.5, 7.5], [0, 0], [150, 100], [-3, 0], ['abc', null], ['', null], [null, null]] as const) {
    await call('settings:save', { shared_desk_discount_pct: put as any });
    eq((await call('settings:get')).shared_desk_discount_pct, want, `Reception's discount limit ${JSON.stringify(put)} is kept as ${JSON.stringify(want)}`);
  }
  await call('settings:save', { role_access_json: withReceptionAccess('', '/accounts', false) });
  ok(!receptionCan('/accounts', (await call('settings:get')).role_access_json), 'the Reception switches are saved with the role matrix and read back');
  await call('settings:save', { role_access_json: '' });

  // ============================================================================================================
  section('5 · the discount limit for the shared desk is enforced where the sale is made');
  const today = new Date().toLocaleDateString('en-CA');
  const sup = await call('wholesalers:upsert', { name: 'Desk Supplier', drug_license_no: 'DL-DESK' });
  const drug = await call('pharmacy:upsertDrug', { name: 'Desk Tablet', default_mrp: 100, gst_rate: 0, schedule: 'OTC', low_stock_threshold: 1 });
  const pur = await call('purchase:create', { client_ref: 'desk-1', invoice_number: 'DESK-1', wholesaler_id: sup.id, invoice_date: today, items: [{ drug_master_id: drug.id, batch_no: 'D1', expiry: '2031-01-01', qty_received: 500, purchase_price: 50, mrp: 100 }] });
  ok(pur.ok, 'stock is bought on a supplier bill');
  let n = 0;
  const sell = (discount: number, extra: Record<string, any> = {}) =>
    attempt('pharmacy:sell', { client_ref: `desk-sale-${++n}`, items: [{ drug_master_id: drug.id, drug_name: 'Desk Tablet', qty: 2, rate: 100 }], discount, payment_mode: 'Cash', ...extra });
  const refused = (r: any) => r.ok === false && /may give up to|Settings → Pharmacy → Discount limits/.test(r.error);

  await call('settings:save', { require_login: false, shared_desk_discount_pct: null });
  ok((await sell(100)).ok, 'with no limit set, Reception can discount a sale by 50% (how the shared desk has always worked)');
  await call('settings:save', { shared_desk_discount_pct: 10 });
  ok((await sell(20)).ok, 'limit 10%: ₹20 on a ₹200 sale is exactly 10% → allowed');
  const over = await sell(20.01);
  ok(refused(over), `…₹20.01 is refused (${over.ok ? 'ACCEPTED' : (over as any).error.slice(0, 80)})`);
  ok(refused(await sell(150, { max_discount_pct: 100 })), 'a screen cannot lift the limit: max_discount_pct sent by the caller is overwritten');
  await call('settings:save', { shared_desk_discount_pct: 0 });
  ok(refused(await sell(1)), 'limit 0%: no discount at all');
  ok((await sell(0)).ok, '…and a sale with no discount is fine');
  await call('settings:save', { shared_desk_discount_pct: null });

  // Once people sign in, the number belongs to THEIR role, not to the shared desk.
  await call('settings:save', { require_login: true, shared_desk_discount_pct: 50 });
  await call('auth:createUser', { username: 'rita', password: 'pass1234', role: 'receptionist', display_name: 'Rita' });
  await call('settings:save', { pharmacy_discount_caps_json: JSON.stringify({ receptionist: 5 }) });
  await call('auth:login', 'rita', 'pass1234');
  ok(refused(await sell(40)), 'a signed-in receptionist follows the receptionist limit (5%), not the shared desk\'s 50%');
  ok((await sell(10)).ok, '…and 5% is fine');
  await call('auth:logout');
  await call('settings:save', { require_login: false, shared_desk_discount_pct: null });

  // ============================================================================================================
  section('6 · the "computers" question is a Setup step that never keeps the reminder showing');
  const st = await call('setup:status');
  eq(st.steps.computers, 'todo', 'the guide has a "computers" step, not done yet');
  ok(Object.keys(st.steps)[0] === 'computers', '…and it is the FIRST step');
  await call('settings:save', { clinic_name: 'Desk Clinic' });
  for (const k of ['clinic', 'doctors', 'fees', 'staff', 'pharmacy', 'inpatient']) await call('setup:markStep', k, 'done');
  const skipped = await call('setup:setStatus', 'skipped');
  ok(skipped.ok && skipped.status.status === 'skipped', 'the guide is skipped');
  eq(skipped.status.reminder, false, 'every other step done and only "computers" left: no "setup is not finished" reminder');
  await call('setup:markStep', 'computers', 'done');
  eq((await call('setup:status')).steps.computers, 'done', 'answering the question marks the step done');
  eq((await call('setup:markStep', 'banana', 'done')).ok, false, 'an unknown step is still refused');
  const wasDone = db.prepare("SELECT COUNT(*) c FROM settings WHERE key='setup_wizard'").get() as any;
  eq(wasDone.c, 1, 'the guide\'s state is one saved note, as before');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
