// A stand-in for the `electron` module so the app's REAL main-process code (IPC handlers, database
// layer, billing, pharmacy…) can run under plain Node against a temporary database. Nothing here
// touches a real clinic's data: userData is a fresh temp folder per run.
//
// Must be the FIRST import of the test entry file — it installs the interceptor before any app module
// asks for `electron`.
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'curedesk-e2e-'));
const noop = () => undefined;
// Anything we did not model returns itself, so an incidental call (a tray icon, a window) cannot crash a test.
const deep: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : deep), apply: () => deep, construct: () => deep });

export const stubState = { isPackaged: false };
const electron = {
  app: {
    get isPackaged() { return stubState.isPackaged; },
    getPath: (name: string) => {
      if (name === 'userData') return userData;
      const p = path.join(userData, `_${name}`);
      fs.mkdirSync(p, { recursive: true });
      return p;
    },
    getVersion: () => '0.0.0-e2e',
    getName: () => 'CureDesk HMS',
    on: noop, once: noop, whenReady: () => Promise.resolve(), quit: noop, exit: noop, relaunch: noop,
    setLoginItemSettings: noop, getLoginItemSettings: () => ({ openAtLogin: false }),
  },
  ipcMain: { handle: noop as (ch: string, fn: any) => void, on: noop, removeHandler: noop },
  shell: { openExternal: async () => undefined, openPath: async () => '', showItemInFolder: noop },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }) },
  BrowserWindow: Object.assign(function () { return deep; }, { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null }),
  powerSaveBlocker: { start: () => 1, stop: noop, isStarted: () => false },
  Notification: deep, nativeImage: deep, clipboard: deep, Menu: deep, Tray: deep, screen: deep, session: deep,
};

const original = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  return request === 'electron' ? electron : original.call(this, request, ...rest);
};

export default electron;
