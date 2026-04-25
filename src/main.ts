import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc } from './main/ipc';
import { getDb, closeDb } from './db/db';
import { getAllSettings } from './db/settings';

if (app.isPackaged) {
  try {
    const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
    updateElectronApp({
      updateSource: { type: UpdateSourceType.ElectronPublicUpdateService, repo: 'mulgundsunil1918/mmcopd' },
      updateInterval: '1 hour',
      logger: console,
      notifyUser: true,
    });
  } catch (e) {
    console.warn('Auto-update unavailable:', e);
  }
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (process.platform === 'win32') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
}

let mainWindowRef: BrowserWindow | null = null;
let allowQuit = false;

function createWindow() {
  const settings = getAllSettings(getDb());
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: settings.clinic_name || 'CareDesk HMS',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindowRef = mainWindow;
  mainWindow.maximize();
  mainWindow.show();

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Intercept the X close button — show backup prompt instead of quitting silently.
  mainWindow.on('close', (e) => {
    if (allowQuit) return;
    e.preventDefault();
    mainWindow.webContents.send('app:closeRequested');
  });

  ipcMain.handle('app:getClinicName', () => getAllSettings(getDb()).clinic_name);
  // Renderer signals user said "close anyway" / "backup-and-close already done"
  ipcMain.handle('app:forceQuit', () => { allowQuit = true; setTimeout(() => app.quit(), 50); });
}

// Scan the new sqlite/<day>/<time>/caredesk.sqlite layout to find latest backup
function latestBackupMtime(rootDir: string): number {
  const sqliteRoot = path.join(rootDir, 'sqlite');
  if (!fs.existsSync(sqliteRoot)) return 0;
  let latest = 0;
  for (const day of fs.readdirSync(sqliteRoot)) {
    const dayDir = path.join(sqliteRoot, day);
    try { if (!fs.statSync(dayDir).isDirectory()) continue; } catch { continue; }
    for (const time of fs.readdirSync(dayDir)) {
      const dbFile = path.join(dayDir, time, 'caredesk.sqlite');
      if (fs.existsSync(dbFile)) {
        const mt = fs.statSync(dbFile).mtimeMs;
        if (mt > latest) latest = mt;
      }
    }
  }
  return latest;
}

async function runAutoBackupIfDue() {
  try {
    const db = getDb();
    const s = getAllSettings(db);
    const userData = app.getPath('userData');
    const dir = s.backup_folder || path.join(userData, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const latestMs = latestBackupMtime(dir);
    if (latestMs && new Date(latestMs).toISOString().slice(0, 10) === today) return;

    // Use the new layout for auto-backups too
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
    const bundleDir = path.join(dir, 'sqlite', day, time);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dest = path.join(bundleDir, 'caredesk.sqlite');
    try { await db.backup(dest); } catch { fs.copyFileSync(path.join(userData, 'caredesk.sqlite'), dest); }
  } catch (e) {
    console.error('Auto-backup failed:', e);
  }
}

// OS-level notifications at configured times.
let lastNotifiedDailyKey = '';
let lastNotifiedUsbKey = '';

function fireOsNotification(title: string, body: string, channel: 'daily' | 'usb') {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, urgency: 'critical' });
    n.on('click', () => {
      if (mainWindowRef) {
        if (mainWindowRef.isMinimized()) mainWindowRef.restore();
        mainWindowRef.focus();
        if (channel === 'usb') mainWindowRef.webContents.send('app:usbReminderTick');
        else mainWindowRef.webContents.send('app:closeRequested');
      }
    });
    n.show();
  }
  if (mainWindowRef) {
    mainWindowRef.flashFrame(true);
    if (channel === 'usb') mainWindowRef.webContents.send('app:usbReminderTick');
    else mainWindowRef.webContents.send('app:reminderTick', { reminder: '' });
  }
}

function tickReminder() {
  try {
    const s = getAllSettings(getDb());
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateKey = now.toISOString().slice(0, 10);

    // Daily backup reminder
    const reminder = s.backup_reminder_time || '21:00';
    const dailyKey = dateKey + '@' + reminder;
    if (hhmm === reminder && lastNotifiedDailyKey !== dailyKey) {
      lastNotifiedDailyKey = dailyKey;
      fireOsNotification(
        'CareDesk HMS — Time to backup & close',
        `It's ${reminder}. Click to open the backup screen.`,
        'daily'
      );
    }

    // Weekly USB backup reminder (e.g., every Monday morning)
    const usbWeekday = Number.isFinite(s.usb_reminder_weekday) ? s.usb_reminder_weekday : 1;
    const usbTime = s.usb_reminder_time || '09:30';
    const usbKey = dateKey + '@usb@' + usbTime;
    if (now.getDay() === usbWeekday && hhmm === usbTime && lastNotifiedUsbKey !== usbKey) {
      lastNotifiedUsbKey = usbKey;
      fireOsNotification(
        'CareDesk HMS — Weekly USB backup',
        'Plug in your USB drive and take this week\'s physical backup. Click to open.',
        'usb'
      );
    }
  } catch (e) {
    console.warn('Reminder tick failed:', e);
  }
}

app.whenReady().then(async () => {
  getDb();
  registerIpc();
  createWindow();

  await runAutoBackupIfDue();
  setInterval(runAutoBackupIfDue, 60 * 60 * 1000);
  // Check the reminder every 30s so we hit the configured minute reliably
  setInterval(tickReminder, 30_000);
  tickReminder();

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
