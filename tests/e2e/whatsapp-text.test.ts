// WhatsApp messages must never carry emoji: on some PCs they arrived as "�" and the problem kept coming back however the templates were
// repaired. So (1) every message is cleaned where the link is built, (2) the built-in templates are plain ASCII, (3) a saved template keeps its
// wording but loses its emoji at startup — and this suite fails if any of that ever regresses, so the fix STAYS.
import fs from 'node:fs';
import path from 'node:path';
import { boot, call, getDb } from './harness';
import { runMigrations } from '../../src/db/migrations';
import { cleanForWhatsApp, hasEmojiOrBrokenText } from '../../src/lib/messageText';
import { buildWhatsAppUrl, DEFAULT_WHATSAPP_TEMPLATE, renderTemplate } from '../../src/lib/whatsapp';
import { ok, eq, section, finish } from './lib';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');
const ascii = (s: string) => /^[\x00-\x7F]*$/.test(s);

(async () => {
  // ============================================================================================================
  section('1 · the cleaner removes every kind of emoji and keeps everything else');
  const cases: [string, string, string][] = [
    ['a prayer emoji', 'Namaste Rihan \u{1F64F} welcome', 'Namaste Rihan welcome'],
    ['a joined "doctor" emoji (several emoji glued by joiners)', 'Doctor: \u{1F468}‍⚕️ Dr. Rao', 'Doctor: Dr. Rao'],
    ['a family emoji', 'Hi \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} all', 'Hi all'],
    ['a flag', 'India \u{1F1EE}\u{1F1F3} clinic', 'India clinic'],
    ['a skin-tone thumbs up', 'Great \u{1F44D}\u{1F3FD} job', 'Great job'],
    ['a phone symbol with variation selector', '☎️ 9945661914', '9945661914'],
    ['a keycap', 'Press 1️⃣ now', 'Press 1 now'],
    ['a calendar + clock on one line', '\u{1F4C5} *Date:* 22 Oct  \u{1F552} *Time:* 6:30 AM', '*Date:* 22 Oct *Time:* 6:30 AM'],
    ['an existing replacement character', 'Namaste � Rihan �', 'Namaste Rihan'],
    ['a lone half of an emoji (high)', 'Hello \uD83D world', 'Hello world'],
    ['a lone half of an emoji (low)', 'Hello \uDE4F world', 'Hello world'],
  ];
  for (const [what, input, expected] of cases) eq(cleanForWhatsApp(input), expected, `removes ${what}`);
  const keep = 'Namaste *Rihan*, ₹500 — ಕನ್ನಡ हिन्दी café മലയാളം #5\nLine two';
  eq(cleanForWhatsApp(keep), keep, 'keeps bold marks, rupee sign, dashes, accents, digits, line breaks, and Kannada / Hindi / Malayalam text untouched');
  const joiner = 'ಕ‍ಷ';                                   // a zero-width joiner inside Indian-language text
  eq(cleanForWhatsApp(joiner), joiner, "a joiner inside Indian-language text is NOT removed (only joiners that glue emoji are)");
  ok(hasEmojiOrBrokenText('x \u{1F64F}') && hasEmojiOrBrokenText('x �') && hasEmojiOrBrokenText('x \uD83D') && !hasEmojiOrBrokenText(keep), 'the checker tells clean text from text with emoji or broken characters');

  // ============================================================================================================
  section('2 · every message is cleaned where the link is built');
  const dirty = `Namaste Rihan \u{1F64F}\n\nYour appointment at *SUNSHINE* is confirmed! \u{1F468}‍⚕️ *Doctor:* Dr. Anjali\n\u{1F4C5} *Date:* 22nd October 2026  \u{1F552} *Time:* 6:30 AM\n\u{1F39F}️ *Token:* #5\n\n\u{1F4CD} 2nd Cross, Mulgund � \uD83D`;
  const url = buildWhatsAppUrl('9945661914', dirty, '91') as string;
  ok(!!url && url.startsWith('https://wa.me/919945661914?text='), 'the link is a wa.me link to the right number (+91 added)');
  ok(!/%F0%9F|%EF%BF%BD|%ED%A0/i.test(url), 'it contains no emoji bytes, no replacement character and no half-emoji bytes');
  const text = new URL(url).searchParams.get('text') as string;
  eq(text, 'Namaste Rihan\n\nYour appointment at *SUNSHINE* is confirmed! *Doctor:* Dr. Anjali\n*Date:* 22nd October 2026 *Time:* 6:30 AM\n*Token:* #5\n\n2nd Cross, Mulgund', 'what WhatsApp receives is the plain message, wording and line breaks intact');
  ok(ascii(url), 'the whole link is plain ASCII');
  ok(url.includes('%20') && url.includes('%0A') && !url.includes('+'), 'spaces are %20 and line breaks %0A (the plain encoding wa.me documents)');
  eq(buildWhatsAppUrl('12345', 'x', '91'), null, 'a number that is too short is still refused');

  // ============================================================================================================
  section('3 · the built-in templates are plain text — so no one can put emoji back by accident');
  ok(ascii(DEFAULT_WHATSAPP_TEMPLATE) && !hasEmojiOrBrokenText(DEFAULT_WHATSAPP_TEMPLATE), 'the default appointment template (lib/whatsapp.ts) is plain ASCII');
  const page = fs.readFileSync(path.join(root, 'src', 'pages', 'WhatsApp.tsx'), 'utf8');
  const m1 = page.slice(page.indexOf('const DEFAULT_M1_TEMPLATES'), page.indexOf('};', page.indexOf('const DEFAULT_M1_TEMPLATES')) + 2);
  ok(m1.length > 500 && ascii(m1), `the seven messages on the WhatsApp page (confirmed, visit done, review, Rx, lab, radiology, bill) are plain ASCII (${m1.length} characters checked)`);
  const seed = fs.readFileSync(path.join(root, 'src', 'db', 'seed.ts'), 'utf8');
  const seedTpl = seed.slice(seed.indexOf('whatsapp_template:'), seed.indexOf('};', seed.indexOf('whatsapp_template:')));
  ok(seedTpl.length > 200 && ascii(seedTpl), "a new install's stored template (db/seed.ts) is plain ASCII");
  const st = await call('settings:get');
  ok(typeof st.whatsapp_template === 'string' && st.whatsapp_template.length > 100 && ascii(st.whatsapp_template), 'a fresh database holds a plain template');
  const filled = renderTemplate(DEFAULT_WHATSAPP_TEMPLATE, { patient_name: 'Rihan', clinic_name: 'SUNSHINE', doctor_name: 'Dr. Anjali Khialani (Nalwad)', date: '22nd October 2026', time: '6:30 AM', token: '5' });
  ok(filled.includes('Namaste Rihan,') && !hasEmojiOrBrokenText(filled), 'a filled-in default message reads cleanly');

  // ============================================================================================================
  section('4 · a saved template keeps its wording and loses its emoji at startup');
  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_template', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run('Namaste {{patient_name}} \u{1F64F}\n\n\u{1F468}‍⚕️ *Doctor:* {{doctor_name}}  \u{1F4C5} {{date}} �\nThank you \uD83D');
  db.prepare("INSERT INTO settings (key, value) VALUES ('clinic_tagline', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('Caring for you \u{1F499}');
  runMigrations(db);
  eq((db.prepare("SELECT value v FROM settings WHERE key='whatsapp_template'").get() as any).v, 'Namaste {{patient_name}}\n\n*Doctor:* {{doctor_name}} {{date}}\nThank you', "the clinic's own wording is kept, the emoji are gone");
  eq((db.prepare("SELECT value v FROM settings WHERE key='clinic_tagline'").get() as any).v, 'Caring for you \u{1F499}', "…and only WhatsApp templates are touched — the clinic's tagline is exactly as typed");
  const before = (db.prepare("SELECT value v FROM settings WHERE key='whatsapp_template'").get() as any).v;
  runMigrations(db);
  eq((db.prepare("SELECT value v FROM settings WHERE key='whatsapp_template'").get() as any).v, before, 'running the upgrade again changes nothing');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
