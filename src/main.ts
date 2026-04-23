import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc } from './main/ipc';
import { getDb, closeDb } from './db/db';
import { getAllSettings } from './db/settings';

// Auto-update from GitHub Releases — only in packaged builds, never in dev.
if (app.isPackaged) {
  try {
    // Lazy import so dev mode never touches it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'mulgundsunil1918/mmcopd',
      },
      updateInterval: '1 hour',
      logger: console,
      notifyUser: true, // shows OS-native dialog when an update is downloaded
    });
  } catch (e) {
    console.warn('Auto-update unavailable:', e);
  }
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (process.platform === 'win32') {
  // Avoid two instances fighting over the SQLite WAL.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

function createWindow() {
  const settings = getAllSettings(getDb());
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: settings.clinic_name || 'CareDesk HMS',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  ipcMain.handle('app:getClinicName', () => getAllSettings(getDb()).clinic_name);
}

async function runAutoBackupIfDue() {
  try {
    const db = getDb();
    const s = getAllSettings(db);
    const userData = app.getPath('userData');
    const dir = s.backup_folder || path.join(userData, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Check last backup mtime; only back up if none today
    const today = new Date().toISOString().slice(0, 10);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('caredesk-') && f.endsWith('.sqlite'));
    const hasToday = files.some((f) => {
      const mtime = fs.statSync(path.join(dir, f)).mtime.toISOString().slice(0, 10);
      return mtime === today;
    });
    if (hasToday) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, `caredesk-${stamp}.sqlite`);
    try { await db.backup(dest); } catch { fs.copyFileSync(path.join(userData, 'caredesk.sqlite'), dest); }

    // Retention: keep last 30
    const kept = fs.readdirSync(dir)
      .filter((f) => f.startsWith('caredesk-') && f.endsWith('.sqlite'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of kept.slice(30)) { try { fs.unlinkSync(path.join(dir, old.f)); } catch { /* ignore */ } }
  } catch (e) {
    // Never crash boot on backup failure
    console.error('Auto-backup failed:', e);
  }
}

app.whenReady().then(async () => {
  getDb();
  registerIpc();
  createWindow();

  // Run once at startup if no backup today, then every hour
  await runAutoBackupIfDue();
  setInterval(runAutoBackupIfDue, 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeDb();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeDb();
});
