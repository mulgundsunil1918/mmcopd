// The wording of the one-click WhatsApp messages is a SAVED SETTING now (Settings → WhatsApp), not something kept in each computer's browser storage.
// Why it matters (owner's backup rule, 2026-10-26: "everything restores as it is"): browser storage is in no backup, so a restore or a new PC lost the clinic's
// own wording, and the clinic's other computers never saw it. Rules proved here:
//   - only the messages the clinic CHANGED are saved; an untouched message keeps following the built-in wording;
//   - emoji can never come back (cleaned when read), garbage in the saved text is ignored, an emptied message falls back to the built-in wording;
//   - the wording an older version kept in browser storage is carried over once (changed messages only, newer copy wins), and never throws;
//   - the setting, the country code and the Google review link survive a save and a read through the real handlers.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call } from './harness';
import { DEFAULT_WA_TEMPLATES, WA_TEMPLATE_TYPES, OLD_LOCAL_KEYS, parseWaOverrides, resolveWaTemplates, serializeWaTemplates, readOldLocalOverrides } from '../../src/lib/whatsappTemplates';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');

(async () => {
  const keys = WA_TEMPLATE_TYPES.map((t) => t.key);

  // ============================================================================================================
  section('1 · built-in wording, and only what is changed is saved');
  eq(JSON.stringify(Object.keys(DEFAULT_WA_TEMPLATES)), JSON.stringify(keys), 'seven messages, and every one has built-in wording');
  ok(JSON.stringify(resolveWaTemplates('')) === JSON.stringify(DEFAULT_WA_TEMPLATES), 'nothing saved = the built-in wording');
  eq(serializeWaTemplates({ ...DEFAULT_WA_TEMPLATES }), '', 'saving the built-in wording unchanged saves NOTHING (so it keeps following later improvements)');
  const edited = { ...DEFAULT_WA_TEMPLATES, review: 'Hi {{patient_name}}, please review {{clinic_name}}: {{review_link}}' };
  const json = serializeWaTemplates(edited);
  eq(JSON.stringify(Object.keys(JSON.parse(json))), JSON.stringify(['review']), 'one edited message = one entry saved');
  const back = resolveWaTemplates(json);
  eq(back.review, edited.review, 'it reads back as typed…');
  ok(keys.filter((k) => k !== 'review').every((k) => back[k] === DEFAULT_WA_TEMPLATES[k]), '…and the other six are still the built-in wording');

  // ============================================================================================================
  section('2 · emoji, garbage and empty boxes');
  eq(resolveWaTemplates(JSON.stringify({ rx: 'Hello 😀 {{patient_name}} 💊 ready' })).rx, 'Hello {{patient_name}} ready', 'emoji are taken out when the wording is read (and the gap they leave is tidied)');
  for (const bad of ['not json at all', '[1,2,3]', 'null', '"text"', '{"confirmed": 5}', '{"confirmed": null}', '']) {
    ok(JSON.stringify(resolveWaTemplates(bad)) === JSON.stringify(DEFAULT_WA_TEMPLATES), `unreadable saved text ${JSON.stringify(bad)} gives the built-in wording, not a crash`);
  }
  eq(JSON.stringify(parseWaOverrides('{"evil": "x", "bill": "Bill ready"}')), JSON.stringify({ bill: 'Bill ready' }), 'an unknown message name is ignored');
  eq(resolveWaTemplates(JSON.stringify({ lab: '   ' })).lab, DEFAULT_WA_TEMPLATES.lab, 'an emptied message falls back to the built-in wording');
  eq(serializeWaTemplates({ ...DEFAULT_WA_TEMPLATES, lab: '' }), '', 'and an emptied box is not saved as an empty message');

  // ============================================================================================================
  section('3 · the old per-computer copy is carried over once');
  const store = (o: Record<string, string>): Pick<Storage, 'getItem'> => ({ getItem: (k: string) => (k in o ? o[k] : null) });
  const allDefaults = JSON.stringify(DEFAULT_WA_TEMPLATES);          // what the old loader wrote back: ALL seven, defaults included
  eq(JSON.stringify(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[0]]: allDefaults }))), '{}', 'an old copy that only holds the built-in wording carries nothing over');
  const oldEdited = JSON.stringify({ ...DEFAULT_WA_TEMPLATES, confirmed: 'Namaste {{patient_name}}, see you at {{time}}.', bill: 'Bill ready, {{patient_name}}' });
  eq(JSON.stringify(Object.keys(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[0]]: oldEdited })))), JSON.stringify(['confirmed', 'bill']), 'only the messages the clinic really changed are carried over');
  eq(JSON.stringify(Object.keys(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[1]]: JSON.stringify({ rx: 'Your Rx is ready' }) })))), JSON.stringify(['rx']), 'an older (v1) copy is used when there is no newer one');
  eq(Object.keys(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[0]]: JSON.stringify({ lab: 'new' }), [OLD_LOCAL_KEYS[1]]: JSON.stringify({ rx: 'old' }) }))).join(','), 'lab', 'the newer copy wins over the older one');
  eq(JSON.stringify(readOldLocalOverrides(store({}))), '{}', 'nothing in storage = nothing to carry');
  eq(JSON.stringify(readOldLocalOverrides(null)), '{}', 'no storage at all = nothing to carry');
  eq(JSON.stringify(readOldLocalOverrides({ getItem: () => { throw new Error('storage blocked'); } })), '{}', 'a blocked storage does not throw');
  eq(JSON.stringify(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[0]]: '{{{ broken' }))), '{}', 'a broken old copy is ignored');
  ok(!JSON.stringify(readOldLocalOverrides(store({ [OLD_LOCAL_KEYS[0]]: JSON.stringify({ confirmed: 'Hi 😀 {{patient_name}}' }) }))).includes('😀'), 'emoji in an old copy are removed on the way across');

  // ============================================================================================================
  section('4 · the real settings handlers keep them');
  const s0 = await call('settings:get');
  eq(s0.whatsapp_templates_json, '', 'a clinic that never changed the wording has no saved text');
  eq(s0.whatsapp_country_code, '91', 'the country code starts at 91');
  eq(s0.google_review_url, '', 'and there is no review link yet');
  await call('settings:save', { whatsapp_templates_json: json, whatsapp_country_code: '44', google_review_url: 'https://g.page/r/abc/review' });
  const s1 = await call('settings:get');
  eq(s1.whatsapp_templates_json, json, 'the wording is saved and read back exactly');
  eq(resolveWaTemplates(s1.whatsapp_templates_json).review, edited.review, '…and resolves to what was typed');
  eq(s1.whatsapp_country_code, '44', 'the country code is saved');
  eq(s1.google_review_url, 'https://g.page/r/abc/review', 'the review link is saved');
  await call('settings:save', { whatsapp_templates_json: '' });
  eq((await call('settings:get')).whatsapp_templates_json, '', 'saving an empty text puts every message back to the built-in wording');

  // ============================================================================================================
  section('5 · the WhatsApp page keeps nothing in browser storage, and Clinic Info no longer types the review link');
  const page = fs.readFileSync(path.join(root, 'src', 'pages', 'WhatsApp.tsx'), 'utf8');
  ok(!/localStorage/.test(page), 'the WhatsApp page does not use browser storage any more (the wording would be in no backup)');
  const settingsPage = fs.readFileSync(path.join(root, 'src', 'pages', 'Settings.tsx'), 'utf8');
  eq((settingsPage.match(/set\('google_review_url'/g) || []).length, 1, 'the Google review link is typed in ONE place in Settings (the WhatsApp tab)');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
