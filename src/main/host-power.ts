/**
 * Does this HOST PC put itself to sleep?
 *
 * A host is the clinic's database. If it sleeps, every other computer loses
 * everything at once — reception cannot register, the doctor cannot open a
 * file, the pharmacy cannot bill — and it looks to all of them like the network
 * broke. The usual first move is to blame the WiFi and start restarting things,
 * which fixes nothing, because the actual cause is a Windows power setting on a
 * machine nobody is standing next to.
 *
 * Windows ships with sleep ON by default, so a PC becomes a host and inherits a
 * timer that will take the clinic offline mid-afternoon. That is a problem to
 * catch when the PC is made a host, not the first time it happens.
 *
 * Note this is specifically about SLEEP, not the screen. Turning the monitor
 * off is fine and saves the same power a clinic actually cares about — so the
 * advice is always "screen off yes, sleep no", never "disable power saving".
 */
import { exec } from 'node:child_process';

export interface HostPowerReport {
  /** false when we could not determine it (non-Windows, powercfg missing). */
  known: boolean;
  /** true when the PC will suspend itself while plugged in. */
  sleepsOnAC: boolean;
  /** Idle minutes before it sleeps on AC power. 0 means never. */
  sleepAfterMinutes: number;
  /** The exact command that fixes it, for showing to the user. */
  fixCommand: string;
  detail: string;
}

const NEVER: HostPowerReport = {
  known: false, sleepsOnAC: false, sleepAfterMinutes: 0,
  fixCommand: 'powercfg /change standby-timeout-ac 0',
  detail: 'Sleep settings could not be read on this platform.',
};

function run(cmd: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    try {
      exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch {
      resolve('');
    }
  });
}

/**
 * Parse the AC standby timeout out of `powercfg /query`.
 *
 * The value is a hex index in SECONDS on the "Current AC Power Setting Index"
 * line; 0 means never sleep. Exported for testing, because getting this wrong
 * in either direction is bad: a false alarm trains people to ignore warnings,
 * and a missed one leaves the clinic exposed.
 */
export function parseStandbyTimeout(out: string): { known: boolean; seconds: number } {
  // Prefer the AC line; powercfg prints AC then DC.
  const m = out.match(/Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+|\d+)/);
  if (!m) return { known: false, seconds: 0 };
  const raw = m[1];
  const seconds = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return { known: false, seconds: 0 };
  return { known: true, seconds };
}

/** Read this PC's sleep-on-AC setting. Windows only; safe everywhere else. */
export async function checkHostPower(): Promise<HostPowerReport> {
  if (process.platform !== 'win32') return NEVER;

  const out = await run('powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE');
  const { known, seconds } = parseStandbyTimeout(out);
  if (!known) return { ...NEVER, detail: 'Windows did not report a sleep timeout.' };

  const minutes = Math.round(seconds / 60);
  return {
    known: true,
    sleepsOnAC: seconds > 0,
    sleepAfterMinutes: minutes,
    fixCommand: 'powercfg /change standby-timeout-ac 0',
    detail: seconds > 0
      ? `This PC sleeps after ${minutes} minute${minutes === 1 ? '' : 's'} idle. While it sleeps, every other computer in the clinic loses access.`
      : 'This PC is set to never sleep — correct for the main computer.',
  };
}

/**
 * Stop the host sleeping. Sets only the AC (plugged-in) timeout, deliberately
 * leaving battery behaviour alone so a laptop host on battery can still
 * conserve power, and never touching the screen timeout — the monitor should
 * still turn off.
 */
export async function disableHostSleep(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Only applies to Windows.' };
  await run('powercfg /change standby-timeout-ac 0');
  await run('powercfg /change hibernate-timeout-ac 0');
  const after = await checkHostPower();
  return after.known && !after.sleepsOnAC
    ? { ok: true }
    : { ok: false, error: 'Windows did not accept the change — it may need an administrator account.' };
}
