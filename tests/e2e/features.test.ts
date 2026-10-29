// The switchboard (owner, 2026-10-29: "set or enable or disable everything in the settings", "hyperlink the things to the settings", "a small question mark
// on whatever is added"). One catalogue (src/lib/features.ts) drives the Settings switches AND the screens. This guard keeps them honest:
//   - every catalogue entry is really used by a screen, and every id a screen uses is in the catalogue (no dead switch, no unlisted one);
//   - every tab that carries a "What to show" list actually draws it; every whole-page switch names a real page;
//   - everything is ON by default (an update changes nothing), a switch survives a save, and hiding a page hides it for the sidebar and the address alike;
//   - the money / doctor screens carry a Settings link and a "?" explanation.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call } from './harness';
import { FEATURES, featureOn, parseSwitches, pageFeatureOff, withSwitch } from '../../src/lib/features';
import { moduleSwitchedOff } from '../../src/lib/moduleAccess';
import { SETTINGS_TABS } from '../../src/lib/settingsMap';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = walk(path.join(root, 'src')).filter((f) => !f.endsWith(path.join('lib', 'features.ts')));
const text = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const all = [...text.values()].join('\n');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

(async () => {
  section('1 · the catalogue is well formed');
  const ids = FEATURES.map((f) => f.id);
  eq(new Set(ids).size, ids.length, 'no id is listed twice');
  ok(FEATURES.every((f) => f.label && f.group && f.where && SETTINGS_TABS.some((t) => t.id === f.tab)), 'every entry has a label, a heading, a place and a real Settings tab');

  section('2 · no dead switch, no unlisted one');
  const used = new Set<string>();
  for (const m of all.matchAll(/<Feature\s+id="([^"]+)"/g)) used.add(m[1]);
  for (const m of all.matchAll(/(?:useFeature|featureOn)\([^)]*?['"]([a-z][^'"]*)['"]\)/g)) used.add(m[1]);
  for (const m of all.matchAll(/feature:\s*'([^']+)'/g)) used.add(m[1]);
  for (const m of all.matchAll(/<FieldBox\s+id="([^"]+)"/g)) used.add(m[1]);                   // an optional form field: <FieldBox id="…">
  for (const m of all.matchAll(/feature="([a-z][^"]*)"/g)) used.add(m[1]);                 // a form field that can be hidden: <Field feature="…">
  const analytics = read('src/pages/Analytics.tsx');
  if (analytics.includes('`analytics.tab.${')) for (const m of analytics.matchAll(/\{\s*id:\s*'([a-z]+)',\s*label:/g)) used.add(`analytics.tab.${m[1]}`);   // the tab strip builds these ids
  const app = read('src/App.tsx');
  for (const f of FEATURES.filter((x) => x.id.startsWith('page:'))) {
    const route = f.id.slice(5);
    if (app.includes(`path="${route}"`)) used.add(f.id);
  }
  const dead = ids.filter((i) => !used.has(i));
  eq(dead.length, 0, `every catalogue entry is used by a screen${dead.length ? ' — UNUSED: ' + dead.join(', ') : ''}`);
  const unlisted = [...used].filter((i) => !ids.includes(i));
  eq(unlisted.length, 0, `every id a screen uses is in the catalogue${unlisted.length ? ' — UNLISTED: ' + unlisted.join(', ') : ''}`);

  section('3 · every list of switches is drawn in Settings');
  const settingsSrc = read('src/pages/Settings.tsx') + read('src/components/settings/AccountsSettings.tsx');
  for (const tab of [...new Set(FEATURES.map((f) => f.tab))]) ok(new RegExp(`<WhatToShow\\s+tab="${tab}"`).test(settingsSrc), `the ${tab} tab draws its “What to show” list`);

  section('4 · on by default, saved, and the sidebar and the address agree');
  ok(FEATURES.every((f) => featureOn({}, f.id) && featureOn({ feature_switches_json: '' }, f.id)), 'everything is ON when nothing was ever switched');
  let json = withSwitch('', 'accounts.tab.daybook', false);
  eq(featureOn({ feature_switches_json: json }, 'accounts.tab.daybook'), false, 'a switched-off feature is off'); eq(featureOn({ feature_switches_json: json }, 'accounts.tab.pnl'), true, '…and the others stay on');
  eq(Object.keys(parseSwitches(withSwitch(json, 'accounts.tab.daybook', true))).length, 0, 'switching it back on leaves nothing recorded');
  eq(Object.keys(parseSwitches('not json {')).length, 0, 'a damaged value reads as “nothing switched off”');
  await call('settings:save', { feature_switches_json: withSwitch('', 'page:/accounts', false) });
  const saved = await call('settings:get');
  eq(featureOn(saved, 'page:/accounts'), false, 'the switch survives a save and a reload');
  eq(pageFeatureOff('/accounts', saved), true, 'a page switched off is off…'); eq(moduleSwitchedOff('/accounts', saved), true, '…for the sidebar and the address guard (one function)');
  eq(moduleSwitchedOff('/analytics', saved), false, 'while another page is untouched'); eq(moduleSwitchedOff('/settings', saved), false, 'Settings itself can never be switched off');
  await call('settings:save', { feature_switches_json: '' });

  section('5 · the money screens carry a Settings link and a “?”');
  for (const rel of ['src/pages/Accounts.tsx', 'src/pages/Analytics.tsx', 'src/pages/accounts/DayBook.tsx', 'src/pages/accounts/Staff.tsx', 'src/components/analytics/DoctorsTab.tsx']) {
    ok(/<SettingsLink/.test(read(rel)), `${rel} links to its Settings`);
  }
  for (const rel of ['src/pages/accounts/MoneyOut.tsx', 'src/pages/accounts/Staff.tsx', 'src/pages/accounts/DayBook.tsx', 'src/pages/accounts/ProfitLoss.tsx', 'src/components/analytics/DoctorsTab.tsx', 'src/components/accounts/VoucherDialog.tsx', 'src/components/settings/AccountsSettings.tsx']) {
    ok(/<HelpTip/.test(read(rel)), `${rel} explains itself with a “?”`);
  }
  section('6 · every page has its Settings link, and each link lands on a real tab and group');
  const PAGES = ['Reception', 'Appointments', 'DoctorSelect', 'Billing', 'Miscellaneous', 'PatientLog', 'Notifications', 'PrintJobs', 'Pharmacy', 'Lab', 'Radiology', 'IPD', 'DischargeSummary', 'TPA', 'Pediatrics', 'Accounts', 'Analytics'];
  const noLink = PAGES.filter((p) => !/<SettingsLink/.test(read(`src/pages/${p}.tsx`)));
  eq(noLink.length, 0, `every working page links to its Settings${noLink.length ? ' — NO LINK: ' + noLink.join(', ') : ''}`);
  const titles = new Set([...settingsSrc.matchAll(/(?:SettingsGroup|Group)\s+title="([^"]+)"/g)].map((m) => m[1]));
  const bad: string[] = [];
  for (const m of all.matchAll(/<SettingsLink\s+tab="([a-z]+)"(?:\s+group="([^"]+)")?/g)) {
    if (!SETTINGS_TABS.some((t) => t.id === m[1])) bad.push(`tab ${m[1]}`);
    if (m[2] && !titles.has(m[2])) bad.push(`group “${m[2]}”`);
  }
  eq(bad.length, 0, `every Settings link names a tab and a group that exist${bad.length ? ' — MISSING: ' + [...new Set(bad)].join(', ') : ''}`);
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
