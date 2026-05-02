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

/** Install a thin proxy on ipcMain.handle that ALSO writes into ipcHandlers.
 *  Idempotent — calling twice is a no-op. */
export function installIpcRegistry(): void {
  if (monkeyPatched) return;
  monkeyPatched = true;
  const original = ipcMain.handle.bind(ipcMain);
  // Override at runtime — typed loosely to avoid fighting Electron's overloaded signature.
  (ipcMain as any).handle = (channel: string, handler: IpcHandler) => {
    ipcHandlers.set(channel, handler);
    return original(channel as any, handler as any);
  };
}
