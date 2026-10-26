// Runs the end-to-end suites (tests/e2e/*.test.ts): the app's real IPC handlers on a temporary database.
// Same mechanism as tests/db/run.mjs — better-sqlite3 is built for Electron's ABI, so the bundle runs
// under ELECTRON_RUN_AS_NODE.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const out = join(root, '.vite-test');
mkdirSync(out, { recursive: true });
const electron = join(root, 'node_modules', '.bin', 'electron');
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');

const ZONES = {
  modules: ['Asia/Kolkata', 'America/Los_Angeles'],
  localday: ['Asia/Kolkata', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland'],
  // Money screens group by the clinic's local day: a PC far behind UTC (Los Angeles) and one far ahead (Auckland) are the hard cases.
  portal: ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  analytics: ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  credit: ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  audit: ['Asia/Kolkata', 'America/Los_Angeles'],
  'audit-rules': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'upgrade-v5': ['Asia/Kolkata', 'America/Los_Angeles'],
  'upgrade-v6': ['Asia/Kolkata', 'America/Los_Angeles'],
  'upgrade-legacy': ['Asia/Kolkata', 'America/Los_Angeles'],
  // Expiry windows are worked out on the PC's own calendar day: a PC far behind UTC and one far ahead are the hard cases.
  'pharmacy-tabs': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'supplier-pay': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'supplier-statement': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'referral-analytics': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  // An imported bill is dated by the PC's own calendar day, and its expiry window is counted from it.
  'bill-import': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'bill-import-samples': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'bill-import-samarth': ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  booking: ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'],
  'counter-discount': ['Asia/Kolkata', 'America/Los_Angeles'],
  'ward-price': ['Asia/Kolkata', 'America/Los_Angeles'],
};
// Suites that run once per fixture file (a database as an earlier release left it) — see tools/make-legacy-fixture.mjs.
const FIXTURES = {
  'upgrade-legacy': () => readdirSync(join(root, 'tests', 'e2e', 'legacy-fixtures')).filter((n) => n.endsWith('.sql.gz')).map((n) => n.replace(/\.sql\.gz$/, '')).sort(),
};

let failed = 0;
const only = process.argv[2];
for (const f of readdirSync(join(root, 'tests', 'e2e')).filter((n) => n.endsWith('.test.ts')).sort()) {
  const name = f.replace('.test.ts', '');
  if (only && name !== only) continue;
  const bundle = join(out, `e2e-${name}.cjs`);
  execFileSync(esbuild, [join(root, 'tests', 'e2e', f), '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
  for (const tz of ZONES[name] ?? [process.env.TZ || 'Asia/Kolkata']) {
    for (const fx of FIXTURES[name] ? FIXTURES[name]() : [null]) {
      const tag = `${name}${fx ? ` · ${fx}` : ''}`;
      try {
        console.log(`\n######## ${tag} · TZ=${tz}`);
        const o = execFileSync(electron, [bundle], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(root, 'node_modules'), TZ: tz, ...(fx ? { LEGACY_FIXTURE: fx } : {}) },
          encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        });
        process.stdout.write(o);
      } catch (e) {
        failed++;
        process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
        console.error(`FAILED: ${tag} (TZ=${tz})`);
      }
    }
  }
}
console.log(failed ? `\n${failed} e2e suite(s) FAILED` : '\nAll e2e suites passed.');
process.exit(failed ? 1 : 0);
