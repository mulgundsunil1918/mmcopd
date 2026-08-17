/**
 * The sleep-timeout parser must be right in both directions: a false alarm
 * trains staff to ignore warnings, a missed one leaves the clinic exposed.
 * Fixtures are real `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` output.
 */
import { parseStandbyTimeout } from '../.vite-test/host-power.mjs';

let pass = true;
const check = (name, ok, detail) => {
  if (!ok) pass = false;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const SLEEPS_30M = `
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      Minimum Possible Setting: 0x00000000
      Maximum Possible Setting: 0xffffffff
      Current AC Power Setting Index: 0x00000708
      Current DC Power Setting Index: 0x00000384
`;

const NEVER = `
    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      Current AC Power Setting Index: 0x00000000
      Current DC Power Setting Index: 0x00000384
`;

const DECIMAL = `
      Current AC Power Setting Index: 1800
`;

const a = parseStandbyTimeout(SLEEPS_30M);
check('reads a hex AC timeout', a.known && a.seconds === 1800, `${a.seconds}s = ${a.seconds / 60}min`);
check('flags it as sleeping', a.seconds > 0);

const b = parseStandbyTimeout(NEVER);
check('0x00000000 means never sleep', b.known && b.seconds === 0);

const c = parseStandbyTimeout(DECIMAL);
check('handles a plain decimal index', c.known && c.seconds === 1800);

const d = parseStandbyTimeout('');
check('unreadable output is "unknown", not "fine"', !d.known,
  'must not report a sleeping PC as safe when powercfg fails');

const e = parseStandbyTimeout('Current AC Power Setting Index: garbage');
check('garbage is "unknown", not 0', !e.known);

// The AC line must win — battery behaviour is irrelevant for a plugged-in host.
const f = parseStandbyTimeout(SLEEPS_30M);
check('prefers the AC value over DC', f.seconds === 1800, 'DC was 0x384 (900s)');

console.log(pass ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(pass ? 0 : 1);
