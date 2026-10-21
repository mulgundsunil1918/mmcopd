// Makes a "legacy fixture": a database exactly as a clinic running an EARLIER release would have it, saved as
// tests/e2e/legacy-fixtures/<label>.sql.gz. tests/e2e/upgrade-legacy.test.ts opens every fixture with the CURRENT
// code and checks nothing the clinic had is lost — so an update can never quietly drop old data.
//
//   node tools/make-legacy-fixture.mjs <label> <git-rev | WORKTREE> [<previous-label>]
//
// The fixture is built with THAT release's own code (taken from git history), on top of the previous fixture, so the
// chain mirrors a real clinic updating release after release. After shipping a release, add its fixture:
//
//   node tools/make-legacy-fixture.mjs v0.9.3 <release-commit> v0.9.2
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const [label, rev, prevLabel] = process.argv.slice(2);
if (!label || !rev) { console.error('usage: node tools/make-legacy-fixture.mjs <label> <git-rev | WORKTREE> [<previous-label>]'); process.exit(2); }

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'tests', 'e2e', 'legacy-fixtures');
mkdirSync(outDir, { recursive: true });
const electron = join(root, 'node_modules', '.bin', 'electron');      // better-sqlite3 is built for Electron's ABI
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');

const work = join(os.tmpdir(), `curedesk-legacy-${label.replace(/[^0-9a-z.]/gi, '_')}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

if (rev === 'WORKTREE') cpSync(join(root, 'src'), join(work, 'src'), { recursive: true });
else execFileSync('sh', ['-c', `git -C "${root}" archive ${rev} src | tar -x -C "${work}"`]);
copyFileSync(join(root, 'tools', 'legacy-seed.ts'), join(work, '__seed.ts'));

execFileSync(esbuild, [join(work, '__seed.ts'), '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${join(work, 'seed.cjs')}`, '--log-level=error'], { stdio: 'inherit' });

const prev = prevLabel ? join(outDir, `${prevLabel}.sql.gz`) : '-';
if (prevLabel && !existsSync(prev)) { console.error(`previous fixture not found: ${prev}`); process.exit(2); }
execFileSync(electron, [join(work, 'seed.cjs'), prev, join(work, 'scratch.sqlite'), label, join(outDir, `${label}.sql.gz`)], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(root, 'node_modules') },
  stdio: 'inherit',
});
rmSync(work, { recursive: true, force: true });
