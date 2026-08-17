/**
 * Outside-the-process watchdog for the HOST PC.
 *
 * Why this cannot live in the main process
 * ----------------------------------------
 * The failure this exists to catch is the main process ceasing to answer while
 * still holding its listening socket. Windows completes the TCP handshake in
 * the kernel, so the port keeps testing "open", while nothing ever produces an
 * HTTP reply — clients hang, the UI freezes, and the app has no idea.
 *
 * better-sqlite3 is synchronous by design, and every remote call runs its
 * handlers on the main thread, so one long operation (a backup, a big export, a
 * migration during an upgrade, an installer touching files under a running app)
 * blocks everything: other clients, the UDP discovery beacon, and any timer we
 * might have set to check on ourselves.
 *
 * That last point is the whole argument. A self-check scheduled on the blocked
 * loop is queued BEHIND the thing that blocked it, so it can only ever run once
 * the problem has already resolved. A frozen process cannot notice it is
 * frozen. The watchdog therefore runs as a genuinely separate OS process with
 * its own event loop.
 *
 * What it does and deliberately does NOT do
 * -----------------------------------------
 * Detect and alert only. It never restarts anything. A restart during a
 * synchronous write is a real risk to clinic data, and the common freeze —
 * a slow operation that finishes on its own — resolves without help. So it
 * tells a human, on the machine that can act, and leaves the decision to them.
 *
 * It also announces recovery, so the person who walked over to the host learns
 * it came back on its own rather than power-cycling a working machine.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';

let child: ChildProcess | null = null;

/** Consecutive failed probes before we say anything. */
const FAIL_THRESHOLD = 3;
/** Seconds between probes. THRESHOLD × INTERVAL is the alert delay (~30s). */
const PROBE_INTERVAL_S = 10;
/** A probe that takes longer than this counts as a failure. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * The watchdog body, run by a separate process.
 *
 * Passed via `-e` rather than shipped as a file so it survives bundling
 * unchanged — there is no second entry point for Vite/Forge to package, and no
 * chance of the file being missing from an installed build.
 *
 * Written as ES5-ish CommonJS on purpose: it is evaluated by whatever Node the
 * Electron binary embeds, with no transpile step in front of it.
 */
function watchdogSource(port: number, threshold: number, intervalS: number, timeoutMs: number): string {
  return `
const http = require('http');
const { spawn } = require('child_process');
const PARENT = ${process.pid};
const PORT = ${port};
const THRESHOLD = ${threshold};
const INTERVAL = ${intervalS * 1000};
const TIMEOUT = ${timeoutMs};

let fails = 0;
let alerted = false;

function notify(title, body) {
  try {
    if (process.platform === 'win32') {
      // NotifyIcon balloon: present on every Windows without extra modules.
      // The sleep keeps the process alive long enough for the balloon to show.
      const ps = "[reflection.assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;" +
        "[reflection.assembly]::LoadWithPartialName('System.Drawing') | Out-Null;" +
        "$n = New-Object System.Windows.Forms.NotifyIcon;" +
        "$n.Icon = [System.Drawing.SystemIcons]::Warning;" +
        "$n.Visible = $true;" +
        "$n.ShowBalloonTip(20000, '" + title.replace(/'/g, "") + "', '" + body.replace(/'/g, "") + "', 'Warning');" +
        "Start-Sleep -Seconds 12; $n.Dispose();";
      spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      const scr = 'display notification "' + body.replace(/"/g, '') + '" with title "' + title.replace(/"/g, '') + '"';
      spawn('osascript', ['-e', scr], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) { /* a failed notification must never take the watchdog down */ }
}

function probe(cb) {
  let done = false;
  const finish = (ok) => { if (!done) { done = true; cb(ok); } };
  try {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: TIMEOUT }, (res) => {
      res.resume();
      finish(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  } catch (e) { finish(false); }
}

setInterval(() => {
  // Stop if CureDesk is gone. signal 0 tests existence without signalling, and
  // a BLOCKED process still exists — which is exactly the case we must keep
  // watching rather than treat as an exit.
  try { process.kill(PARENT, 0); } catch (e) { process.exit(0); }

  probe((ok) => {
    if (ok) {
      if (alerted) {
        notify('CureDesk is responding again',
          'The main computer is back to normal. Other computers will reconnect on their own.');
      }
      fails = 0; alerted = false;
      return;
    }
    fails++;
    if (fails >= THRESHOLD && !alerted) {
      alerted = true;
      notify('CureDesk has stopped responding',
        'This computer is still running CureDesk but is not answering the other computers. If it does not clear in a minute, close CureDesk and open it again.');
    }
  });
}, INTERVAL);
`.trim();
}

/**
 * Start watching the local server. Safe to call repeatedly — it replaces any
 * previous watcher, so a port change re-points it.
 */
export function startHostWatchdog(port: number): void {
  stopHostWatchdog();
  if (!port) return;
  try {
    child = spawn(
      process.execPath,
      ['-e', watchdogSource(port, FAIL_THRESHOLD, PROBE_INTERVAL_S, PROBE_TIMEOUT_MS)],
      {
        // ELECTRON_RUN_AS_NODE turns the Electron binary into a plain Node
        // runtime, so we get a real second process without shipping one.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.unref?.();
    child.on('error', () => { child = null; });
    child.on('exit', () => { child = null; });
  } catch {
    // A watchdog that fails to start must never stop the server from starting.
    child = null;
  }
}

export function stopHostWatchdog(): void {
  if (!child) return;
  try { child.kill(); } catch { /* already gone */ }
  child = null;
}

// Never leave an orphan behind when CureDesk closes normally.
try { app.on('will-quit', stopHostWatchdog); } catch { /* not in an Electron main context (tests) */ }

/** Exposed for testing the probe/alert decision without spawning anything. */
export const __watchdogInternals = { watchdogSource, FAIL_THRESHOLD, PROBE_INTERVAL_S, PROBE_TIMEOUT_MS };
