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
import { discoverServers } from './network-discovery';
import { cacheClinicAdminPassword, verifyLocalAdminPin } from './ipc';
import { verifyAdminViaHost } from './admin-verify';
import type { SessionUser } from './auth';

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
/** The address currently used for all remote calls. Starts as the configured
 *  URL but is UPDATED in place if the host moves (DHCP), so cabins self-heal. */
let activeUrl = '';
let activeSecret = '';
/** Set by main.ts so a relocated URL persists to this PC's settings. */
let persistUrl: ((url: string) => void) | null = null;
export function setUrlPersister(fn: (url: string) => void) { persistUrl = fn; }
let lastError: string | null = null;
let lastSuccessAt: number | null = null;
let connState: ConnState = 'idle';
let consecutiveFailures = 0;
let lastLatencyMs: number | null = null;
let healthTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
/** Who is signed in on THIS computer, as the main computer is told with every call (see caller-session.ts). null = nobody. Set by a successful sign-in, cleared by sign-out. */
let clientSession: SessionUser | null = null;
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
  'network:findHosts',   // must run on THIS PC's own network, never proxied to the host
  'network:hostPower',   // asks about THIS PC's power settings
  'network:checkComputer', // looks at THIS PC's own network, never the host's
  'network:disableHostSleep',
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
  // The clipboard belongs to the PC the person is sitting at: proxied, "Copy" would fill the HOST's clipboard and leave theirs empty.
  'app:copyText',
  // Report PDFs are made and handed to WhatsApp on the PC the person is sitting at.
  'reports:makePdf',
  'app:copyFileToClipboard',
  'app:showFile',
  // NOTE: settings:get / settings:save are deliberately NOT skipped — they get
  // a custom split-routing proxy below (see STATION_LOCAL_KEYS).
  // The clinic has ONE admin password and the main computer holds it: an extra computer asks the main computer first and keeps a copy for the day the main
  // computer cannot be reached (so a station can still unlock Settings to fix its own network configuration) — see the admin-password proxies in
  // installNetworkClient and main/admin-verify.ts. Staff ACCOUNTS are clinic-wide too and proxy to the host (below) — a client is already useless without the
  // host (see HostOfflineOverlay). auth:login keeps a local emergency fallback.
  // Signing OUT is this computer's own business (it also forgets who is signed in here, so later calls to the main computer no longer carry them).
  'auth:logout',
]);

/**
 * Account channels that a client forwards to the host, so the clinic has ONE
 * staff list. auth:login additionally falls back to this PC's own users table
 * when the host cannot be reached, so an emergency local account can still get
 * someone into Settings to repair the connection.
 */
const HOST_ACCOUNT_CHANNELS = new Set([
  'auth:login', 'auth:listUsers', 'auth:createUser', 'auth:changePassword', 'auth:updateUser',
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
  'network_bind_ip', 'network_connection', 'station_name', 'station_role', 'sidebar_layout',
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
  // The proxies read these module-level values, so relocating the host after a
  // DHCP change is a single reassignment rather than a full re-install.
  activeUrl = cleanUrl;
  activeSecret = secret;
  let proxied = 0;

  /** One remote /ipc/:channel call with timeout. Shared by the generic proxy
   *  and the settings split-router below. */
  const callRemote = async (channel: string, args: any[]): Promise<any> => {
    const started = Date.now();
    const res = await fetchWithTimeout(`${activeUrl}/ipc/${channel}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(activeSecret ? { 'Authorization': `Bearer ${activeSecret}` } : {}),
      },
      body: JSON.stringify({ args, session: clientSession }),
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
  // Captured BEFORE the proxy replaces the handler, so the emergency fallback
  // still points at this PC's own auth:login.
  const localLogin = ipcHandlers.get('auth:login');
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

  // ── the clinic's ONE admin password ────────────────────────────────────────
  const localVerify = ipcHandlers.get('auth:verifyAdminPassword');
  const localIsDefault = ipcHandlers.get('auth:isDefaultAdminPassword');
  const localLogout = ipcHandlers.get('auth:logout');
  const ADMIN_PROXIED = new Set<string>();
  if (localVerify) {
    try { ipcMain.removeHandler('auth:verifyAdminPassword'); } catch { /* ignore */ }
    rawHandle('auth:verifyAdminPassword', (e: any, password: string) => verifyAdminViaHost({
      askHostEx: (pw) => callRemote('auth:verifyAdminPasswordEx', [pw]),
      askHostOld: async (pw) => !!(await callRemote('auth:verifyAdminPassword', [pw])),
      askLocal: async (pw) => verifyLocalAdminPin(pw),
      remember: (pw, unified) => cacheClinicAdminPassword(pw, unified),
    }, String(password ?? '')));
    ADMIN_PROXIED.add('auth:verifyAdminPassword'); proxied++;
  }
  {
    // Changing it is the main computer's job — one password for the whole clinic — so it cannot be done while the main computer is unreachable
    // (a change made here alone would give this computer a different password from every other).
    try { ipcMain.removeHandler('auth:changeAdminPassword'); } catch { /* ignore */ }
    rawHandle('auth:changeAdminPassword', async (_e: any, current: string, next: string) => {
      let r: any;
      try { r = await callRemote('auth:changeAdminPassword', [current, next]); }
      catch { return { ok: false, error: 'The main computer cannot be reached. The admin password is the same on every computer, so it can only be changed while this computer is connected to the main one.' }; }
      if (r && r.ok) { try { cacheClinicAdminPassword(String(next), true); } catch { /* the main computer has it */ } }
      return r;
    });
    ADMIN_PROXIED.add('auth:changeAdminPassword'); proxied++;
  }
  if (localIsDefault) {
    try { ipcMain.removeHandler('auth:isDefaultAdminPassword'); } catch { /* ignore */ }
    rawHandle('auth:isDefaultAdminPassword', async (e: any, ...a: any[]) => {
      try { return await callRemote('auth:isDefaultAdminPassword', a); } catch { return localIsDefault(e, ...a); }
    });
    ADMIN_PROXIED.add('auth:isDefaultAdminPassword'); proxied++;
  }
  if (localLogout) {
    try { ipcMain.removeHandler('auth:logout'); } catch { /* ignore */ }
    rawHandle('auth:logout', (e: any, ...a: any[]) => { clientSession = null; return localLogout(e, ...a); });
    proxied++;
  }

  for (const channel of ipcHandlers.keys()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    if (ADMIN_PROXIED.has(channel)) continue;
    if (channel === 'settings:get' || channel === 'settings:save') continue;
    try { ipcMain.removeHandler(channel); } catch { /* ignore */ }
    rawHandle(channel, async (_e: any, ...args: any[]) => {
      const attempt = () => callRemote(channel, args);

      // EMERGENCY LOCAL LOGIN. Accounts live on the host, but if the host is
      // unreachable a station would have no way to sign in and reach Settings to
      // repair the connection. So when (and only when) the remote login fails to
      // reach the host, fall back to this PC's own users table. A wrong password
      // against a reachable host still fails normally — we only fall back on a
      // transport failure, never on a rejected credential.
      if (channel === 'auth:login') {
        try {
          const result = await attempt();
          lastSuccessAt = Date.now();
          consecutiveFailures = 0;
          setState('connected', null);
          if (result) clientSession = result as SessionUser;      // from now on every call to the main computer says who is signed in here
          return result;
        } catch (err: any) {
          const local = localLogin;
          if (local) {
            try {
              const fallback = await local(_e, ...args);
              if (fallback) console.warn('[network] host unreachable — signed in with a LOCAL emergency account');
              return fallback;
            } catch { /* fall through to the normal error path */ }
          }
          throw err;
        }
      }

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
            throw new Error(`${msg} — the clinic server at ${activeUrl} is not reachable. Settings → Computers & staff → Troubleshoot to diagnose, or switch this PC to Local mode.`);
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
    const res = await fetchWithTimeout(`${activeUrl}/api/health`, {}, HEALTH_TIMEOUT_MS);
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

/** The host may have changed IP (DHCP renew, swapped router). Listen for CureDesk
 *  UDP broadcasts on the LAN and, for any server at a NEW address, prove it's OUR
 *  host by presenting the saved secret — only a server that accepts our token is
 *  adopted, so we never latch onto a neighbouring clinic. Returns true if moved. */
async function tryRelocate(): Promise<boolean> {
  if (!installedFor) return false;
  let servers: { ip: string; port: number }[] = [];
  try { servers = await discoverServers(4000); } catch { return false; }
  for (const s of servers) {
    const url = `http://${s.ip}:${s.port}`;
    if (url === activeUrl) continue;
    try {
      const res = await fetchWithTimeout(`${url}/ipc/settings:get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(activeSecret ? { Authorization: `Bearer ${activeSecret}` } : {}) },
        body: JSON.stringify({ args: [] }),
      }, HEALTH_TIMEOUT_MS);
      if (res.status === 401 || !res.ok) continue; // not our host, or not ready
      // Adopt the new address for this session and persist it for next launch.
      activeUrl = url;
      installedFor.url = url;
      try { persistUrl?.(url); } catch { /* ignore */ }
      return true;
    } catch { /* try next candidate */ }
  }
  return false;
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
    // Sustained failure → the host may have moved. Find it on the LAN by its
    // broadcast, adopt the new address if our secret still works, then re-ping.
    if (consecutiveFailures >= 2) {
      const moved = await tryRelocate();
      if (moved) {
        const r2 = await pingHost();
        if (r2.ok) {
          lastLatencyMs = r2.ms;
          lastSuccessAt = Date.now();
          consecutiveFailures = 0;
          reconnectAttempts = 0;
          setState('connected', null);
          scheduleHealth(HEALTH_INTERVAL_MS);
          return;
        }
      }
    }
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
  const ownLogout = ipcHandlers.get('auth:logout');
  if (ownLogout) { try { ipcMain.removeHandler('auth:logout'); } catch { /* ignore */ } try { rawHandle('auth:logout', ownLogout as any); } catch { /* ignore */ } }
  clientSession = null;
  installed = false;
  installedFor = null;
  activeUrl = '';
  activeSecret = '';
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
