// The Settings page is organised BY MODULE, and that has to stay true (owner, 2026-10-27: "the whole settings section needs to be audited, I only get
// confused what is where"). Before, pharmacy / lab / radiology / in-patient settings were scattered over Billing & IPD, the Pharmacy page and the Lab page.
// Now (src/lib/settingsMap.ts):
//   - every module has ONE tab, unlocked only while the subscription includes the module;
//   - every saved setting with a module's name on it (pharmacy_*, lab_*, radiology_*, ipd_*, tpa_*, discharge_summary_*, ip_number_prefix,
//     default_drug_gst_rate) is saved by that module's tab and by no other;
//   - nothing the old "Billing & IPD" tab saved has been dropped;
//   - every tab in the map is really drawn by the page, and an old remembered tab name still lands somewhere.
// A setting added tomorrow with a module's name on it fails here until it is given to the module's tab. Real handlers on a temporary database.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call } from './harness';
import { SETTINGS_TABS, SETTINGS_GROUPS, BILLING_KEYS, PHARMACY_KEYS, LAB_KEYS, IPD_KEYS, owningTabOfKey, tabFromStored } from '../../src/lib/settingsMap';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');

// What the old "Billing & IPD" tab saved with its one Save button (copied from the version before the split).
const OLD_BILLING_IPD_KEYS = [
  'gst_enabled', 'pharmacy_gst_enabled', 'pharmacy_gstin', 'pharmacy_legal_name', 'pharmacy_drug_license_no', 'default_drug_gst_rate', 'gst_registration_type',
  'clinic_gstin', 'clinic_legal_name', 'clinic_state_code', 'healthcare_gst_exempt', 'invoice_prefix', 'ip_number_prefix', 'bill_round_off',
  'discount_caps_json', 'discount_require_reason', 'pharmacy_discount_caps_json', 'ipd_auto_accrue_bed', 'ipd_auto_accrue_nursing', 'ipd_auto_accrue_doctor_visit',
  'ipd_doctor_visit_mode', 'ipd_transfer_charge_rule', 'ipd_accrual_time', 'ipd_advance_enabled', 'tpa_enabled', 'ipd_admission_requests_enabled',
  'discharge_summary_enabled', 'lab_auto_bill', 'radiology_auto_bill', 'pharmacy_credit_enabled', 'pharmacy_ipd_charge_enabled', 'ipd_gst_enabled',
];

(async () => {
  const saved = await call('settings:get');
  const keysOfSaved = Object.keys(saved);
  const lists: Record<string, string[]> = { billing: BILLING_KEYS as string[], pharmacy: PHARMACY_KEYS as string[], lab: LAB_KEYS as string[], ipd: IPD_KEYS as string[] };

  // ============================================================================================================
  section('1 · a setting with a module\'s name on it is saved by that module\'s tab');
  const stray: string[] = [];
  for (const k of keysOfSaved) {
    const owner = owningTabOfKey(k);
    if (owner && !(lists[owner] ?? []).includes(k)) stray.push(`${k} (belongs to the ${owner} tab)`);
  }
  eq(stray.length, 0, `no module setting is missing from its tab${stray.length ? ': ' + stray.join(', ') : ''}`);
  const wrongHome: string[] = [];
  for (const [tab, keys] of Object.entries(lists)) for (const k of keys) { const o = owningTabOfKey(k); if (o && o !== tab) wrongHome.push(`${k} is in ${tab} but belongs to ${o}`); }
  eq(wrongHome.length, 0, `no module setting sits in another module's tab${wrongHome.length ? ': ' + wrongHome.join(', ') : ''}`);
  const dup: string[] = [];
  const seen = new Map<string, string>();
  for (const [tab, keys] of Object.entries(lists)) for (const k of keys) { if (seen.has(k)) dup.push(`${k} (${seen.get(k)} and ${tab})`); seen.set(k, tab); }
  eq(dup.length, 0, `no setting is saved by two tabs${dup.length ? ': ' + dup.join(', ') : ''}`);
  const typos = [...seen.keys()].filter((k) => !keysOfSaved.includes(k));
  eq(typos.length, 0, `every key a tab saves exists in the saved settings${typos.length ? ' — unknown: ' + typos.join(', ') : ''}`);

  // ============================================================================================================
  section('2 · nothing the old Billing & IPD tab saved was dropped');
  const now = new Set(seen.keys());
  const lost = OLD_BILLING_IPD_KEYS.filter((k) => !now.has(k));
  eq(lost.length, 0, `all ${OLD_BILLING_IPD_KEYS.length} settings are still saved by some tab${lost.length ? ' — LOST: ' + lost.join(', ') : ''}`);
  const added = [...now].filter((k) => !OLD_BILLING_IPD_KEYS.includes(k));
  eq(added.length, 0, `…and no tab saves anything it should not${added.length ? ' — new: ' + added.join(', ') : ''}`);

  // ============================================================================================================
  section('3 · the tabs: unlocked by subscription, all drawn, old names still land');
  eq(new Set(SETTINGS_TABS.map((t) => t.id)).size, SETTINGS_TABS.length, 'tab ids are unique');
  ok(SETTINGS_TABS.every((t) => SETTINGS_GROUPS.some((g) => g.id === t.group)), 'every tab belongs to a group of the tab bar');
  ok(SETTINGS_GROUPS.every((g) => SETTINGS_TABS.some((t) => t.group === g.id)), 'every group has a tab');
  eq(JSON.stringify(SETTINGS_TABS.filter((t) => t.module).map((t) => `${t.id}:${t.module}`)), JSON.stringify(['pharmacy:pharmacy', 'lab:lab', 'ipd:ipd']), 'exactly the Pharmacy, Laboratory & Radiology and In-Patient tabs wait for a module');
  ok(SETTINGS_TABS.every((t) => t.blurb.length > 20), 'every tab says in a sentence what lives in it');
  eq(tabFromStored('workflow'), 'reception', 'a remembered "Fees & Workflow" tab opens Reception & Fees');
  eq(tabFromStored('patients'), 'reception', 'a remembered "Patients" tab opens Reception & Fees');
  eq(tabFromStored('pharmacy'), 'pharmacy', 'a current tab name is kept');
  eq(tabFromStored('nonsense'), 'clinic', 'an unknown name opens the first tab, not a blank page');
  eq(tabFromStored(null), 'clinic', 'nothing remembered opens the first tab');

  const page = fs.readFileSync(path.join(root, 'src', 'pages', 'Settings.tsx'), 'utf8');
  const undrawn = SETTINGS_TABS.filter((t) => !new RegExp(`tab === '${t.id}'`).test(page)).map((t) => t.id);
  eq(undrawn.length, 0, `the page draws every tab in the map${undrawn.length ? ' — NOT drawn: ' + undrawn.join(', ') : ''}`);
  for (const t of SETTINGS_TABS.filter((x) => x.module)) {
    ok(new RegExp(`tab === '${t.id}' && \\(isLocked\\(tabDef\\('${t.id}'\\)\\)`).test(page), `the ${t.label} tab is shown locked while the ${t.module} module is not in the subscription`);
  }
  // module settings reach the screen only through the module's own key list — never an inline list on some other tab
  const inline = [...page.matchAll(/useSectionDraft\(\s*settings\s*,\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]));
  const strayInline = inline.filter((k) => owningTabOfKey(k));
  eq(strayInline.length, 0, `no inline settings list in the page carries a module's setting${strayInline.length ? ': ' + strayInline.join(', ') : ''}`);

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
