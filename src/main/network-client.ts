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
 */

import { ipcMain } from 'electron';
import { ipcHandlers, rawHandle } from './ipc-registry';

let installed = false;
let installedFor: { url: string; secret: string } | null = null;
/** Connection-status state — surfaced to the renderer via the network:status IPC. */
let lastError: string | null = null;
let lastSuccessAt: number | null = null;

const SKIP_PROXY_CHANNELS = new Set([
  // These are local-only — they configure / inspect the network client itself.
  'network:status',
  'network:applyMode',
  'network:probe',
  'network:joinCode',
  'network:regenJoinCode',
  'network:discover',
  'network:pair',
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
  // Auth must run locally so the local user session works in client mode too.
  // (Future: switch to remote auth — keeps the LAN deployment uniform.)
  'auth:login',
  'auth:listUsers',
  'auth:createUser',
  'auth:changePassword',
  'auth:updateUser',
  'auth:verifyAdminPassword',
  'auth:isDefaultAdminPassword',
  'auth:changeAdminPassword',
]);

export function installNetworkClient(serverUrl: string, secret: string): { ok: boolean; channels: number; error?: string } {
  if (!serverUrl) return { ok: false, channels: 0, error: 'serverUrl is empty' };
  // Allow re-install when settings change (URL or secret).
  if (installed && installedFor && installedFor.url === serverUrl && installedFor.secret === secret) {
    return { ok: true, channels: ipcHandlers.size };
  }
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  let proxied = 0;
  for (const channel of ipcHandlers.keys()) {
    if (SKIP_PROXY_CHANNELS.has(channel)) continue;
    try { ipcMain.removeHandler(channel); } catch { /* ignore */ }
    rawHandle(channel, async (_e: any, ...args: any[]) => {
      try {
        const res = await fetch(`${cleanUrl}/ipc/${channel}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'Authorization': `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify({ args }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          lastError = `HTTP ${res.status} ${text || res.statusText}`;
          throw new Error(lastError);
        }
        const json = await res.json() as any;
        if (!json.ok) {
          lastError = json.error || 'Server error';
          throw new Error(lastError);
        }
        lastError = null;
        lastSuccessAt = Date.now();
        return json.result;
      } catch (err: any) {
        lastError = err?.message || String(err);
        throw err;
      }
    });
    proxied++;
  }
  installed = true;
  installedFor = { url: cleanUrl, secret };
  return { ok: true, channels: proxied };
}

export function networkClientStatus() {
  return {
    installed,
    serverUrl: installedFor?.url || '',
    lastError,
    lastSuccessAt,
  };
}
