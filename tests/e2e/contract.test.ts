// The screens talk to the main process through src/preload.ts. TypeScript checks the screens against the
// preload, but the hop from preload to the real handler is just a channel NAME — a typo there compiles fine
// and fails only when someone clicks. This checks every name.
import fs from 'node:fs';
import path from 'node:path';
import { boot, channels } from './harness';
import { ok, section, finish, note } from './lib';

boot();
const preload = fs.readFileSync(path.join(process.cwd(), 'src', 'preload.ts'), 'utf8');
const used = new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]));
const registered = new Set(channels());
// Channels the main process registers itself in main.ts (window / license / updates / network plumbing) rather than in the IPC modules
const mainTs = fs.readFileSync(path.join(process.cwd(), 'src', 'main.ts'), 'utf8');
const inMain = new Set([...mainTs.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));

section('every channel the screens call has a handler');
const missing = [...used].filter((c) => !registered.has(c) && !inMain.has(c)).sort();
ok(missing.length === 0, `${used.size} channels used by the preload; ${missing.length} without a handler${missing.length ? ': ' + missing.join(', ') : ''}`);
section('handlers nothing calls (dead code, informational)');
const dead = [...registered].filter((c) => !used.has(c)).sort();
note(`${dead.length} registered channel(s) are not referenced by the preload: ${dead.join(', ') || 'none'}`);

// ---- static guards for mistakes that have bitten before (cheap to check, painful to rediscover) ----
section('date-handling guards in the main-process source');
const mainDir = path.join(process.cwd(), 'src', 'main');
const files: string[] = [];
const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p); } };
walk(mainDir);
const offenders = (re: RegExp) => files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f: path.relative(process.cwd(), f), i: i + 1, l })).filter((x) => re.test(x.l)).map((x) => `${x.f}:${x.i}`));
const dbl = offenders(/'localtime',\s*'localtime'/);
ok(dbl.length === 0, `no SQL applies the 'localtime' modifier twice (that shifts a date by the UTC offset a second time)${dbl.length ? ': ' + dbl.join(', ') : ''}`);
const dateOnly = offenders(/date\((?:[a-z0-9_]+\.)?(appointment_date|expiry|invoice_date|paid_on|received_date|due_date|given_date|measured_on|manufacture_date|follow_up_date)\s*,\s*'localtime'/);
ok(dateOnly.length === 0, `no SQL converts a column that already holds a LOCAL calendar date${dateOnly.length ? ': ' + dateOnly.join(', ') : ''}`);
const utcToday = offenders(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
ok(utcToday.length === 0, `the main process never uses the UTC date as "today"${utcToday.length ? ': ' + utcToday.join(', ') : ''}`);
finish();
