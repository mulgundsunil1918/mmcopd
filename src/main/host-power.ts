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
import { powerSaveBlocker } from 'electron';
import { parseStandbyTimeout } from './powercfg-parse';

// Re-exported so existing importers (and tests, via the pure module) are stable.
export { parseStandbyTimeout };

/**
 * Keep the HOST awake for as long as it is serving the clinic.
 *
 * The warning below tells a human the PC is set to sleep; this makes sleep
 * impossible while CureDesk hosts, so nobody has to notice the warning in time.
 *
 * 'prevent-app-suspension' stops the SYSTEM sleeping but still lets the DISPLAY
 * turn off — exactly the "screen off yes, sleep no" rule the clinic wants, and
 * the reason we do NOT use 'prevent-display-sleep' (which would burn the screen
 * pointlessly all day).
 *
 * A runtime blocker is the right tool rather than permanently rewriting the
 * user's Windows power scheme: it is cross-platform, it needs no admin rights,
 * and it reverts the instant CureDesk closes — so we never leave a clinic's PC
 * altered after an uninstall. Its lifetime also matches the need exactly: a host
 * only needs to stay awake while it is actually hosting, and if CureDesk is not
 * running there is nothing to serve anyway.
 */
let blockerId: number | null = null;

export function startSleepPrevention(): void {
  try {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return;
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch {
    // Never let a power-management hiccup stop the server from starting.
    blockerId = null;
  }
}

export function stopSleepPrevention(): void {
  try {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  } catch { /* ignore */ }
  blockerId = null;
}

export function isSleepPreventionActive(): boolean {
  try { return blockerId !== null && powerSaveBlocker.isStarted(blockerId); }
  catch { return false; }
}

export interface HostPowerReport {
  /** false when we could not determine it (non-Windows, powercfg missing). */
  known: boolean;
  /** true when the PC will suspend itself while plugged in. */
  sleepsOnAC: boolean;
  /** Idle minutes before it sleeps on AC power. 0 means never. */
  sleepAfterMinutes: number;
  /**
   * true when CureDesk is actively holding the machine awake right now.
   * When this is on, the OS sleepsOnAC setting no longer matters while the app
   * runs — the runtime blocker overrides it — so the UI can reassure instead of
   * warn. The one gap it does NOT cover is the window between boot and CureDesk
   * launching, which is why making the OS setting permanent is still offered.
   */
  preventionActive: boolean;
  /** The exact command that fixes it, for showing to the user. */
  fixCommand: string;
  detail: string;
}

const NEVER: HostPowerReport = {
  known: false, sleepsOnAC: false, sleepAfterMinutes: 0, preventionActive: false,
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

/** Read this PC's sleep-on-AC setting. Windows only; safe everywhere else. */
export async function checkHostPower(): Promise<HostPowerReport> {
  // The runtime blocker is cross-platform, so report it whatever the OS.
  const preventionActive = isSleepPreventionActive();
  if (process.platform !== 'win32') return { ...NEVER, preventionActive };

  const out = await run('powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE');
  const { known, seconds } = parseStandbyTimeout(out);
  if (!known) return { ...NEVER, preventionActive, detail: 'Windows did not report a sleep timeout.' };

  const minutes = Math.round(seconds / 60);
  return {
    known: true,
    sleepsOnAC: seconds > 0,
    sleepAfterMinutes: minutes,
    preventionActive,
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
