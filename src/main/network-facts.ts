/**
 * What "Check this computer" looks at on THIS computer — the raw facts, handed to lib/connectCheck.ts to be judged. Nothing here changes anything.
 *
 * Windows-only questions (the network type Public/Private, the firewall rule) are asked of Windows itself with a short PowerShell / netsh call that is allowed
 * to fail: when Windows does not answer, the fact is `null` ("could not be read") and the screen says so — never a made-up "all fine" or "all wrong".
 * The runners are passed in, so the parsing and the assembly are tested with made-up output on any computer.
 */
import { execFile } from 'node:child_process';
import type { AdapterFact, NetFacts, ProfileFact } from '../lib/connectCheck';
import { describeAdapters } from './network-diagnostics';

/** Runs a PowerShell script; the text it printed, or null when it could not run or failed. */
export type ScriptRunner = (script: string) => Promise<string | null>;
/** Runs a program; true = it ended normally (exit 0), false = it ended with an error code, null = it could not run at all. */
export type ProgramRunner = (file: string, args: string[]) => Promise<boolean | null>;

export const runPowerShell: ScriptRunner = (script) => new Promise((resolve) => {
  try {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout ?? '')));
  } catch { resolve(null); }
});

export const runProgram: ProgramRunner = (file, args) => new Promise((resolve) => {
  try {
    execFile(file, args, { timeout: 6000, windowsHide: true }, (err: any) => {
      if (!err) return resolve(true);
      resolve(typeof err.code === 'number' ? false : null);          // a number = the program ran and said "no"; anything else = it could not be started
    });
  } catch { resolve(null); }
});

/** What Windows says about each connected network's type, as JSON from PowerShell (one object, or a list). */
const PS_PROFILES = 'Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ Alias = $_.InterfaceAlias; Category = [string]$_.NetworkCategory } } | ConvertTo-Json -Compress';

/** The PowerShell text → the list of networks. null = not understood (so it is "unknown", never "no networks"); '' = Windows reported none. */
export function parseConnectionProfiles(out: string | null): ProfileFact[] | null {
  if (out === null) return null;
  const text = out.replace(/^﻿/, '').trim();
  if (text === '') return [];
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const list = Array.isArray(json) ? json : [json];
  const rows: ProfileFact[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return null;
    const alias = String((item as any).Alias ?? '').trim();
    if (!alias) return null;
    const c = String((item as any).Category ?? '').toLowerCase();
    rows.push({ alias, category: c.startsWith('public') ? 'public' : c.startsWith('private') ? 'private' : c.startsWith('domain') ? 'domain' : 'unknown' });
  }
  return rows;
}

export async function readConnectionProfiles(platform: string = process.platform, run: ScriptRunner = runPowerShell): Promise<ProfileFact[] | null> {
  if (platform !== 'win32') return null;
  return parseConnectionProfiles(await run(PS_PROFILES));
}

/** The name CureDesk gives its own firewall rule (main/network-discovery.ts addWindowsFirewallRule). */
export const firewallRuleName = (port: number) => `CureDesk HMS (port ${port})`;

export async function readFirewallRule(port: number, platform: string = process.platform, run: ProgramRunner = runProgram): Promise<boolean | null> {
  if (platform !== 'win32') return null;
  return run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${firewallRuleName(port)}`]);
}

export interface FactsDeps {
  platform?: string;
  hosting: NetFacts['hosting'];
  lanIp: string | null;
  adapters?: () => AdapterFact[];
  readPower?: () => Promise<{ known: boolean; sleepsOnAC: boolean; sleepAfterMinutes: number; preventionActive: boolean }>;
  runScript?: ScriptRunner;
  runProgram?: ProgramRunner;
}

export async function gatherNetFacts(d: FactsDeps): Promise<NetFacts> {
  const platform = d.platform ?? process.platform;
  const [profiles, power, firewallRule] = await Promise.all([
    readConnectionProfiles(platform, d.runScript),
    // Only the main computer needs its sleep setting looked at.
    d.hosting && d.readPower ? d.readPower().catch(() => null) : Promise.resolve(null),
    d.hosting ? readFirewallRule(d.hosting.port, platform, d.runProgram) : Promise.resolve(null),
  ]);
  return {
    platform,
    adapters: (d.adapters ?? describeAdapters)(),
    profiles,
    power: power ? { known: power.known, sleepsOnAC: power.sleepsOnAC, sleepAfterMinutes: power.sleepAfterMinutes, preventionActive: power.preventionActive } : null,
    hosting: d.hosting,
    lanIp: d.lanIp,
    firewallRule,
  };
}
