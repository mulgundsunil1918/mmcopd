/**
 * Network client — installs proxy handlers in the main process so every IPC
 * channel that the renderer calls gets forwarded to a remote CureDesk server
 * via the existing /ipc/:channel HTTP bridge.
 *
 * Why in the MAIN process and not the renderer:
 *   - The renderer + preload + every existing window.electronAPI binding stay
 *     completely unchanged. Zero refactoring of feature code. The renderer
 *     calls ipcRenderer.invoke('patients:search', q) like always; the main
 *     process just decides whether to run it locally or fetch it remotely.
 *   - We get the network mode at boot from settings; if it's 'client' we
 *     replace every locally-registered handler with a proxy. The Map of
 *     locally-registered handlers (ipcHandlers) is the source of truth for
 *     which channels exist, so adding a new IPC handler anywhere in the
 *     codebase automatically picks up network forwarding too.
 *
 * Resilience (added after the "everything hangs forever" incident):
 *   - Every proxied call has a hard timeout. Without it, a host PC that goes
 *     to sleep leaves the cabin's fetch() pending forever and the whole UI
 *     appears frozen with no error — including Settings, so the user cannot
 *     even switch back to Local mode without editing sqlite by hand.
 *   - Transient network errors are retried once automatically.
 *   - A background health poll tracks connected/degraded/offline and reconnects
 *     on its own with exponential backoff, so a cable being replugged or the
 *     host rebooting recovers without anyone touching Settings.
 */

import { ipcMain } from 'electron';
import { ipcHandlers, rawHandle } from './ipc-registry';

/** Hard ceiling on any single proxied IPC call. Long enough for a big report
 *  query on a slow PC, short enough that a dead host surfaces as an error
 *  instead of a frozen screen. */
const REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 4_000;
const HEALTH_INTERVAL_MS = 10_000;
/** Backoff schedule after consecutive health failures (ms). */
const BACKOFF = [5_000, 10_000, 20_000, 30_000, 60_000];

export type ConnState = 'idle' | 'connected' | 'degraded' | 'offline';

let installed = false;
let installedFor: { url: string; secret: string } | null = null;
let lastError: string | null = null;
let lastSuccessAt: number | null = null;
let connState: ConnState = 'idle';
let consecutiveFailures = 0;
let lastLatencyMs: number | null = null;
let healthTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
/** Set by main.ts so the client can push status changes to the renderer. */
let onStateChange: ((s: ReturnType<typeof networkClientStatus>) => void) | null = null;

export function setClientStateListener(cb: (s: ReturnType<typeof networkClientStatus>) => void) {
  onStateChange = cb;
}

function emit() {
  try { onStateChange?.(networkClientStatus()); } catch { /* ignore */ }
}

function setState(next: ConnState, err?: string | null) {
  const changed = connState !== next || (err ?? null) !== lastError;
  connState = next;
  if (err !== undefined) lastError = err;
  if (changed) emit();
}

const SKIP_PROXY_CHANNELS = new Set([
  // These are local-only — they configure / inspect the network client itself.
  'network:status',
  'network:applyMode',
  'network:probe',
  'network:joinCode',
  'network:regenJoinCode',
  'network:discover',
  'network:pair',
  'network:diagnose',
  'network:interfaces',
  'network:reconnect',
  'network:forget',
  // Backup IPCs touch the local filesystem of the calling PC.
  'backup:run',
  'backup:list',
  'backup:open',
  'backup:status',
  'backup:pickFolder',
  'backup:pickSqliteFile',
  'backup:previewBundle',
  'backup:previewSqlite',
  'backup:restoreBundle',
  'backup:restoreSqlite',
  // Updates and OS-level helpers run on the local PC.
  'updates:state',
  'updates:checkNow',
  'updates:installNow',
  'app:openExternal',
  'app:getClinicName',
  // NOTE: settings:get / settings:save are deliberately NOT skipped — they get
  // a custom split-routing proxy below (see STATION_LOCAL_KEYS).
  // Auth must run locally so the local user session works in client mode too.
  'auth:login',
  'auth:listUsers',
  'auth:createUser',
  'auth:changePassword',
  'auth:updateUser',
  'auth:verifyAdminPassword',
  'auth:isDefaultAdminPassword',
  'auth:changeAdminPassword',
]);

/**
 * Settings keys that describe THIS PC rather than the clinic. They must never
 * be read from or written to the host.
 *
 * Without this split, a cabin in Client mode that saves Settings writes into
 * the HOST's database. Switching one cabin back to Local mode would set
 * network_mode='local' on the server, stopping the LAN server and taking every
 * other station offline — with the cabin still pointing at the now-dead host.
 * Everything else (fees, templates, clinic identity) is genuinely clinic-wide
 * and continues to come from the host so all stations stay in sync.
 */
const STATION_LOCAL_KEYS = new Set([
  'network_mode', 'network_listen_port', 'network_server_url', 'network_secret',
  'network_bind_ip', 'station_name',
  'backup_folder', 'backup_reminder_time', 'usb_reminder_weekday', 'usb_reminder_time',
  'keep_all_backups', 'auto_backup_enabled', 'auto_backup_frequency', 'auto_backup_time',
  'auto_launch', 'minimize_to_tray', 'start_minimized',
  'update_check_enabled', 'update_check_time',
]);

/** fetch() with a hard timeout — an AbortController the caller cannot forget. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Distinguish "the network is down" (worth retrying) from "the server said no"
 *  (retrying would just repeat the same rejection). */
function isTransient(err: any): boolean {
  const m = String(err?.message || err || '').toLowerCase();
  return err?.name === 'AbortError'
    || m.includes('fetch failed')
    || m.includes('econnrefused')
    || m.includes('econnreset')
    || m.includes('ehostunreach')
    || m.includes('enetunreach')
    || m.includes('etimedout')
    || m.includes('socket hang up');
}

export function installNetworkClient(serverUrl: string, secret: string): { ok: boolean; channels: number; error?: string } {
  if (!serverUrl) return { ok: false, channels: 0, error: 'serverUrl is empty' };
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  // Allow re-install when settings change (URL or secret).
  if (installed && installedFor && installedFor.url === cleanUrl && installedFor.secret === secret) {
    return { ok: true, channels: ipcHandlers.size };
  }
  let proxied = 0;

  /** One remote /ipc/:channel call with timeout. Shared by the generic proxy
   *  and the settings split-router below. */
  const callRemote = async (channel: string, args: any[]): Promise<any> => {
    const started = Date.now();
    const res = await fetchWithTimeout(`${cleanUrl}/ipc/${channel}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'Authorization': `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ args }),
    }, REQUEST_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text || res.statusText}`);
    }
    const json = await res.json() as any;
    if (!json.ok) throw new Error(json.error || 'Server error');
    lastLatencyMs = Date.now() - started;
    return json.result;
  };

  // ── settings:get — clinic-wide values from the host, station values local ──
  const localSettingsGet = ipcHandlers.get('settings:get');
  const localSettingsSave = ipcHandlers.get('settings:save');
  if (localSettingsGet && localSettingsSave) {
    try { ipcMain.removeHandler('settings:get'); } catch { /* ignore */ }
    rawHandle('settings:get', async (e: any, ...args: any[]) => {
      const local = await localSettingsGet(e, ...args);
      try {
        const remote = await callRemote('settings:get', args);
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState('connected', null);
        const merged: any = { ...remote };
        for (const k of STATION_LOCAL_KEYS) {
          if (k in (local as any)) merged[k] = (local as any)[k];
        }
        return merged;
      } catch (err: any) {
        // Host unreachable — fall back to this PC's own settings so the user can
        // still open Settings and switch back to Local mode. Without this the
        // Settings page hangs and the only fix is editing sqlite by hand.
        consecutiveFailures++;
        setState('offline', err?.message || String(err));
        return local;
      }
    });
    proxied++;

    try { ipcMain.removeHandler('settings:save'); } catch { /* ignore */ }
    rawHandle('settings:save', async (e: any, patch: any) => {
      const p = patch && typeof patch === 'object' ? patch : {};
      const localPatch: any = {};
      const remotePatch: any = {};
      for (const [k, v] of Object.entries(p)) {
        if (STATION_LOCAL_KEYS.has(k)) localPatch[k] = v;
        else remotePatch[k] = v;
      }
      // Station keys always land locally, even when the host is down — this is
      // what lets a stranded cabin switch itself back to Local mode.
      if (Object.keys(localPatch).length > 0) await localSettingsSave(e, localPatch);
      if (Object.keys(remotePatch).length > 0) {
        await callRemote('settings:save', [remotePatch]);
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState('connected', null);
      }
      return { ok: true };
    });
    proxied++;
  }

  for (const channel of ipcHandlers.keys()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    if (channel === 'settings:get' || channel === 'settings:save') continue;
    try { ipcMain.removeHandler(channel); } catch { /* ignore */ }
    rawHandle(channel, async (_e: any, ...args: any[]) => {
      const attempt = () => callRemote(channel, args);

      try {
        const result = await attempt();
        lastSuccessAt = Date.now();
        consecutiveFailures = 0;
        setState('connected', null);
        return result;
      } catch (err: any) {
        // One automatic retry for transient faults — covers a Wi-Fi roam or a
        // switch port renegotiating, which otherwise surfaces as a spurious error.
        if (isTransient(err)) {
          try {
            const result = await attempt();
            lastSuccessAt = Date.now();
            consecutiveFailures = 0;
            setState('connected', null);
            return result;
          } catch (err2: any) {
            consecutiveFailures++;
            const msg = err2?.name === 'AbortError'
              ? `Host did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`
              : (err2?.message || String(err2));
            setState('offline', msg);
            throw new Error(`${msg} — the clinic server at ${cleanUrl} is not reachable. Settings → Network Mode → Troubleshoot to diagnose, or switch this PC to Local mode.`);
          }
        }
        setState('degraded', err?.message || String(err));
        throw err;
      }
    });
    proxied++;
  }
  installed = true;
  installedFor = { url: cleanUrl, secret };
  consecutiveFailures = 0;
  reconnectAttempts = 0;
  setState('connected', null);
  startHealthMonitor();
  return { ok: true, channels: proxied };
}

// ===== Health monitor / auto-reconnect =====

async function pingHost(): Promise<{ ok: boolean; ms: number; error?: string }> {
  if (!installedFor) return { ok: false, ms: 0, error: 'not installed' };
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${installedFor.url}/api/health`, {}, HEALTH_TIMEOUT_MS);
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const body: any = await res.json().catch(() => null);
    return body?.ok === true ? { ok: true, ms } : { ok: false, ms, error: 'Not a CureDesk server' };
  } catch (e: any) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: e?.name === 'AbortError' ? 'Timed out' : (e?.message || String(e)),
    };
  }
}

function stopHealthMonitor() {
  if (healthTimer) { clearTimeout(healthTimer); healthTimer = null; }
}

function scheduleHealth(delayMs: number) {
  stopHealthMonitor();
  healthTimer = setTimeout(runHealthCheck, delayMs);
}

async function runHealthCheck() {
  if (!installed || !installedFor) return;
  const r = await pingHost();
  if (r.ok) {
    lastLatencyMs = r.ms;
    lastSuccessAt = Date.now();
    consecutiveFailures = 0;
    reconnectAttempts = 0;
    setState('connected', null);
    scheduleHealth(HEALTH_INTERVAL_MS);
  } else {
    consecutiveFailures++;
    // One miss is a blip; two or more means the link is genuinely down.
    setState(consecutiveFailures >= 2 ? 'offline' : 'degraded', r.error || 'Health check failed');
    const delay = BACKOFF[Math.min(reconnectAttempts, BACKOFF.length - 1)];
    reconnectAttempts++;
    scheduleHealth(delay);
  }
}

function startHealthMonitor() {
  stopHealthMonitor();
  scheduleHealth(HEALTH_INTERVAL_MS);
}

/** Force an immediate reconnect attempt — the "Reconnect now" button. */
export async function reconnectNow(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!installed || !installedFor) return { ok: false, error: 'Not in Client mode' };
  reconnectAttempts = 0;
  const r = await pingHost();
  if (r.ok) {
    lastLatencyMs = r.ms;
    lastSuccessAt = Date.now();
    consecutiveFailures = 0;
    setState('connected', null);
    startHealthMonitor();
    return { ok: true, latencyMs: r.ms };
  }
  consecutiveFailures++;
  setState('offline', r.error || 'Reconnect failed');
  startHealthMonitor();
  return { ok: false, error: r.error };
}

/** Tear the proxy down and restore local handlers. Used by "Forget this server"
 *  and whenever the app leaves Client mode. */
export function uninstallNetworkClient() {
  stopHealthMonitor();
  for (const [channel, handler] of ipcHandlers.entries()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    try { ipcMain.removeHandler(channel); } catch { /* ignore */ }
    try { rawHandle(channel, handler as any); } catch { /* ignore */ }
  }
  installed = false;
  installedFor = null;
  lastError = null;
  lastLatencyMs = null;
  consecutiveFailures = 0;
  reconnectAttempts = 0;
  setState('idle', null);
}

export function networkClientStatus() {
  return {
    installed,
    serverUrl: installedFor?.url || '',
    state: connState,
    lastError,
    lastSuccessAt,
    latencyMs: lastLatencyMs,
    consecutiveFailures,
  };
}
