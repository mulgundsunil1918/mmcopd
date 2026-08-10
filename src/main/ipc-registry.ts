/**
 * Single source of truth for every IPC handler the app registers.
 *
 * Why: in single-PC mode the renderer talks to the main process via
 * Electron's ipcRenderer.invoke → ipcMain.handle. In network/server mode the
 * main process ALSO needs to expose every channel as an HTTP endpoint so other
 * stations on the LAN can call them. Maintaining two parallel registrations
 * is brittle — instead we wrap ipcMain.handle once, and every handler is
 * recorded in `ipcHandlers` automatically. The network-server.ts module reads
 * from that map to expose POST /ipc/:channel without needing to know the
 * complete list ahead of time.
 */

import { ipcMain } from 'electron';

export type IpcHandler = (event: any, ...args: any[]) => any;

/** Channel name → handler. Populated as registerHandler is called from setup code. */
export const ipcHandlers = new Map<string, IpcHandler>();

let monkeyPatched = false;
let originalHandle: typeof ipcMain.handle | null = null;

// ===== Licence read-only enforcement =====
// When the licence has expired past its grace period the app runs read-only:
// data can be viewed and backed up, but not changed. We gate every write channel
// centrally here so no feature can be forgotten. Config, backup, auth, updates,
// networking and licence channels stay allowed so the clinic can still renew,
// export, log in, and switch modes.
let readOnlyMode = false;
export function setReadOnlyMode(on: boolean): void { readOnlyMode = on; }
const READONLY_ALLOW_PREFIX = /^(backup:|license:|licence:|auth:|updates:|network:|app:|dialog:|settings:)/;
const WRITE_VERB = /:(create|save|update|delete|remove|add|set|pay|refund|admit|discharge|sell|dispense|give|approve|reject|transfer|seed|recalc|mark|cancel|adjust|upsert|restore|rename|book|generate|regen|void|close|clear|reset|load)/i;
function isBlockedInReadOnly(channel: string): boolean {
  if (!readOnlyMode) return false;
  if (READONLY_ALLOW_PREFIX.test(channel)) return false;
  return WRITE_VERB.test(channel);
}

/** Install a thin proxy on ipcMain.handle that ALSO writes into ipcHandlers.
 *  Idempotent — calling twice is a no-op. */
export function installIpcRegistry(): void {
  if (monkeyPatched) return;
  monkeyPatched = true;
  originalHandle = ipcMain.handle.bind(ipcMain);
  // Override at runtime — typed loosely to avoid fighting Electron's overloaded signature.
  (ipcMain as any).handle = (channel: string, handler: IpcHandler) => {
    const guarded: IpcHandler = async (event, ...args) => {
      if (isBlockedInReadOnly(channel)) {
        throw new Error('Your licence has expired — the app is read-only. You can still view and back up data. Renew the licence to make changes.');
      }
      return handler(event, ...args);
    };
    ipcHandlers.set(channel, guarded);
    return originalHandle!(channel as any, guarded as any);
  };
}

/** Register a handler WITHOUT recording it into ipcHandlers. Used by the
 *  network-client proxy installer — proxies are runtime overrides, not
 *  authoritative handlers, and shouldn't shadow the originals in the registry. */
export function rawHandle(channel: string, handler: IpcHandler): void {
  if (!originalHandle) throw new Error('IPC registry not installed yet');
  originalHandle(channel as any, handler as any);
}
