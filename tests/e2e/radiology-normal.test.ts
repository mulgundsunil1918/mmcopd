// Radiology normal reports (owner, 2026-10-30: "similarly labs, radiology, everything"): the radiologist presses “Fill normal report” and edits only what is
// different; the clinic can save its own wording for a scan, which is then used instead of the standard text.
import { boot, call, getDb } from './harness';
import { RADIOLOGY_CATALOG } from '../../src/data/radiology-catalog';
import { normalReportFor } from '../../src/data/radiology-normal-reports';
import { ok, eq, section, finish } from './lib';

boot();
const db = getDb();

(async () => {
  section('1 · the standard normal reports cover the scans a clinic orders');
  const names = RADIOLOGY_CATALOG.map((c) => c.name);
  const missing = names.filter((n) => !normalReportFor(n));
  ok(missing.length / names.length < 0.12, `${names.length - missing.length} of ${names.length} catalogue scans have a standard normal report${missing.length ? ` (none for: ${missing.slice(0, 8).join('; ')}${missing.length > 8 ? ' …' : ''})` : ''}`);
  const chest = normalReportFor('X-Ray Chest PA View'); ok(!!chest && /lung fields are clear/i.test(chest.findings) && /Normal chest/i.test(chest.impression), 'a chest X-ray gets a chest report');
  ok(/liver/i.test(normalReportFor('USG Abdomen')?.findings ?? '') && /abdomen/i.test(normalReportFor('USG Abdomen')?.impression ?? ''), 'an abdominal ultrasound gets an abdominal report');
  ok(/brain/i.test(normalReportFor('CT Brain Plain')?.impression ?? '') && /brain/i.test(normalReportFor('MRI Brain')?.impression ?? ''), 'CT and MRI brain each get their own');
  ok(normalReportFor('Some Unheard-of Study') === null, 'a scan nobody wrote a report for gets none (and says so)');

  section('2 · the handlers: the standard text, the clinic’s own wording, and refusals in words');
  const t = db.prepare("SELECT id, name FROM radiology_tests WHERE name LIKE '%Chest%' LIMIT 1").get() as any
    ?? (await call('radiology:upsertTest', { name: 'X-Ray Chest PA View', modality: 'xray', price: 0 })).test;
  const std = await call('radiology:normalReport', t.id, t.name);
  ok(std.ok && std.source === 'standard' && std.findings.length > 40, 'the standard normal report comes back, marked as standard');
  const none = await call('radiology:normalReport', null, 'Some Unheard-of Study'); ok(!none.ok && none.error.length > 20, 'no standard report: a clear message');
  ok(!(await call('radiology:saveNormalReport', t.id, '  ', '')).ok, 'saving an empty report is refused');
  ok(!(await call('radiology:saveNormalReport', t.id, 'x'.repeat(5000), 'ok')).ok, 'an absurdly long one is refused');
  ok(!(await call('radiology:saveNormalReport', 987654, 'Lungs clear.', 'Normal.')).ok, 'a scan that is not in the catalogue is refused');
  const saved = await call('radiology:saveNormalReport', t.id, 'Lungs clear. Heart normal. (our wording)', 'Normal study.');
  ok(saved.ok, 'the clinic saves its own wording');
  const mine = await call('radiology:normalReport', t.id, t.name);
  ok(mine.ok && mine.source === 'clinic' && /our wording/.test(mine.findings) && mine.impression === 'Normal study.', 'from then on the clinic’s own wording is used');
  eq((await call('radiology:listTests', false)).find((x: any) => x.id === t.id).name, t.name, 'the catalogue itself is untouched');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
