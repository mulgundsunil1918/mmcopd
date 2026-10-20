// Runs the real-SQLite tests (tests/db/*.test.ts).
//
// These need better-sqlite3 built for ELECTRON's Node ABI (that is how the app ships it), so they
// run under `ELECTRON_RUN_AS_NODE=1 electron` rather than plain node. Each file is bundled with
// esbuild first (the sources are TypeScript). time-zone-sensitive suites run under several zones:
// a "wrong time" bug only shows up when the PC's zone is not the developer's own.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const out = join(root, '.vite-test');
mkdirSync(out, { recursive: true });
const electron = join(root, 'node_modules', '.bin', 'electron');
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');

const ZONES = {
  timefix: ['Asia/Kolkata', 'America/Los_Angeles'],
  regtime: ['Asia/Kolkata', 'UTC', 'America/Los_Angeles', 'Asia/Kathmandu', 'Europe/London'],
  'pharmacy-finance': ['Asia/Kolkata', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kathmandu'],
};

let failed = 0;
for (const f of readdirSync(join(root, 'tests', 'db')).filter((n) => n.endsWith('.test.ts')).sort()) {
  const name = f.replace('.test.ts', '');
  const bundle = join(out, `db-${name}.cjs`);
  execFileSync(esbuild, [join(root, 'tests', 'db', f), '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
  for (const tz of ZONES[name] ?? [undefined]) {
    try {
      const o = execFileSync(electron, [bundle], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(root, 'node_modules'), ...(tz ? { TZ: tz } : {}) },
        encoding: 'utf8',
      });
      process.stdout.write(o);
    } catch (e) {
      failed++;
      process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
      console.error(`FAILED: ${name}${tz ? ` (TZ=${tz})` : ''}`);
    }
  }
}
console.log(failed ? `\n${failed} suite run(s) FAILED` : '\nAll database suites passed.');
process.exit(failed ? 1 : 0);
