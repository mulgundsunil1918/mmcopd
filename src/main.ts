import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc, runFullBackup, isBackupServiceReady } from './main/ipc';
import { getDb, closeDb } from './db/db';
import { getAllSettings } from './db/settings';

// Use Electron's autoUpdater directly so we have full control over WHEN to check.
let updaterAvailable = false;
let updateState: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' = 'idle';
let updateInfo: { version?: string; releaseNotes?: string; error?: string } = {};

if (app.isPackaged) {
  try {
    const { autoUpdater } = require('electron');
    const feedURL = `https://update.electronjs.org/mulgundsunil1918/mmcopd/${process.platform}-${process.arch}/${app.getVersion()}`;
    autoUpdater.setFeedURL({ url: feedURL });

    autoUpdater.on('checking-for-update', () => { updateState = 'checking'; mainWindowRef?.webContents.send('updates:state', { state: updateState }); });
    autoUpdater.on('update-not-available', () => { updateState = 'idle'; mainWindowRef?.webContents.send('updates:state', { state: updateState }); });
    autoUpdater.on('update-available', () => {
      updateState = 'downloading';
      mainWindowRef?.webContents.send('updates:state', { state: updateState });
    });
    autoUpdater.on('update-downloaded', (_e: any, releaseNotes: string, releaseName: string) => {
      updateState = 'downloaded';
      updateInfo = { version: releaseName, releaseNotes };
      mainWindowRef?.webContents.send('updates:state', { state: updateState, ...updateInfo });
      // Also a Windows OS notification
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'CareDesk HMS — Update ready',
            body: `Version ${releaseName} downloaded. Click to install.`,
            urgency: 'normal',
          });
          n.on('click', () => {
            mainWindowRef?.show();
            mainWindowRef?.webContents.send('updates:promptInstall', updateInfo);
          });
          n.show();
        }
      } catch { /* ignore */ }
    });
    autoUpdater.on('error', (err: Error) => {
      updateState = 'error';
      updateInfo = { error: String(err?.message || err) };
      mainWindowRef?.webContents.send('updates:state', { state: updateState, ...updateInfo });
    });
    updaterAvailable = true;
  } catch (e) {
    console.warn('Auto-updater init failed:', e);
  }
}

function safeCheckForUpdates() {
  if (!updaterAvailable || !app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron');
    autoUpdater.checkForUpdates();
  } catch (e) {
    console.warn('checkForUpdates failed:', e);
  }
}
function installNow() {
  if (!updaterAvailable || !app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron');
    allowQuit = true;
    autoUpdater.quitAndInstall();
  } catch (e) {
    console.warn('quitAndInstall failed:', e);
  }
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (process.platform === 'win32') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
}

let mainWindowRef: BrowserWindow | null = null;
let trayRef: Tray | null = null;
let allowQuit = false;

// 16x16 white plus on transparent — base64 PNG, used as fallback tray icon
// (Windows uses 16x16 icons in the system tray.)
const FALLBACK_TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR42u3OsQ2AMAxE0RtA' +
  'gZ4FsgFTwACMABuwQiqWoaIK8h+gIE5HRPm+bF8gIqJ/jACMAQzPArwBHIBvAR4ANwAVgF6A' +
  'Ej0KcvkCAJyJB1RsBUVNAAAAAElFTkSuQmCC';

function makeTrayIcon(): Electron.NativeImage {
  // Try to use the clinic logo first (user-uploaded base64 in settings)
  try {
    const s = getAllSettings(getDb());
    if (s.clinic_logo && s.clinic_logo.startsWith('data:image/')) {
      const img = nativeImage.createFromDataURL(s.clinic_logo);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  } catch { /* ignore */ }
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_ICON_B64, 'base64'));
}

function showWindow() {
  if (!mainWindowRef) return;
  if (mainWindowRef.isMinimized()) mainWindowRef.restore();
  mainWindowRef.show();
  mainWindowRef.focus();
}

function refreshTrayMenu() {
  if (!trayRef) return;
  const s = getAllSettings(getDb());
  const menu = Menu.buildFromTemplate([
    { label: `CareDesk HMS — ${s.clinic_name || 'Clinic'}`, enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: () => showWindow() },
    {
      label: 'Backup now…', click: () => {
        showWindow();
        mainWindowRef?.webContents.send('app:openBackupModal');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit (with backup)',
      click: () => {
        showWindow();
        mainWindowRef?.webContents.send('app:closeRequested');
      },
    },
    {
      label: 'Quit immediately',
      click: () => { allowQuit = true; app.quit(); },
    },
  ]);
  trayRef.setContextMenu(menu);
  trayRef.setToolTip(`${s.clinic_name || 'CareDesk HMS'} — running in background`);
}

function ensureTray() {
  if (trayRef) { refreshTrayMenu(); return; }
  try {
    trayRef = new Tray(makeTrayIcon());
    trayRef.on('click', () => showWindow());
    trayRef.on('double-click', () => showWindow());
    refreshTrayMenu();
  } catch (e) {
    console.warn('Tray init failed:', e);
  }
}

function applyAutoLaunch(enabled: boolean, startMinimized: boolean) {
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: startMinimized,
        args: startMinimized ? ['--hidden'] : [],
      });
    }
  } catch (e) {
    console.warn('setLoginItemSettings failed:', e);
  }
}

function createWindow() {
  const settings = getAllSettings(getDb());
  const startedHidden = process.argv.includes('--hidden') && settings.start_minimized;
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

  // Auto-grant camera permission for in-app barcode scanning. The app is a
  // single-tenant local install, so there's no third-party site that could
  // ever request access — only our own renderer can ask.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      return callback(true);
    }
    callback(false);
  });

  if (!startedHidden) {
    mainWindow.maximize();
    mainWindow.show();
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('close', (e) => {
    if (allowQuit) return;
    const s = getAllSettings(getDb());
    if (s.minimize_to_tray) {
      e.preventDefault();
      mainWindow.hide();
      try {
        trayRef?.displayBalloon({
          title: 'CareDesk HMS',
          content: 'Still running in the background. Click the tray icon to reopen.',
        });
      } catch { /* ignore */ }
      return;
    }
    e.preventDefault();
    mainWindow.webContents.send('app:closeRequested');
  });

  ipcMain.handle('app:getClinicName', () => getAllSettings(getDb()).clinic_name);
  ipcMain.handle('app:forceQuit', () => { allowQuit = true; setTimeout(() => app.quit(), 50); });
  ipcMain.handle('app:setAutoLaunch', (_e, enabled: boolean, startMinimized: boolean) => {
    applyAutoLaunch(enabled, startMinimized);
    return true;
  });
  ipcMain.handle('app:refreshTray', () => refreshTrayMenu());
  // Allowlisted external opener — used for "click-to-WhatsApp" (wa.me) + tel/mailto.
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    try {
      if (typeof url !== 'string') return { ok: false, error: 'Invalid URL' };
      const lower = url.toLowerCase();
      const ok =
        lower.startsWith('https://wa.me/') ||
        lower.startsWith('https://api.whatsapp.com/') ||
        lower.startsWith('tel:') ||
        lower.startsWith('mailto:') ||
        lower.startsWith('https://www.google.com/maps') ||
        lower.startsWith('https://maps.google.com/');
      if (!ok) return { ok: false, error: 'URL not allowed' };
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('updates:state', () => ({
    state: updateState,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    ...updateInfo,
  }));
  ipcMain.handle('updates:checkNow', () => { safeCheckForUpdates(); return { ok: true, isPackaged: app.isPackaged }; });
  ipcMain.handle('updates:installNow', () => { installNow(); return { ok: true }; });
}

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

const FREQUENCY_HOURS: Record<string, number> = {
  hourly: 1,
  every_3_hours: 3,
  every_6_hours: 6,
  twice_daily: 12,
  daily: 24,
};

async function runScheduledBackup(reason: 'startup' | 'tick') {
  try {
    const db = getDb();
    const s = getAllSettings(db);
    if (!s.auto_backup_enabled) return;
    const userData = app.getPath('userData');
    const dir = s.backup_folder || path.join(userData, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const intervalHours = FREQUENCY_HOURS[s.auto_backup_frequency] || 24;
    const intervalMs = intervalHours * 3600 * 1000;
    const latestMs = latestBackupMtime(dir);
    const dueByInterval = !latestMs || (Date.now() - latestMs) >= intervalMs;

    // For 'daily' / 'twice_daily', also honour the configured wall-clock time:
    // only run if we've crossed that time today AND we don't already have a backup since.
    let dueByTime = true;
    if (s.auto_backup_frequency === 'daily' || s.auto_backup_frequency === 'twice_daily') {
      const [hh, mm] = (s.auto_backup_time || '13:00').split(':').map((x) => parseInt(x, 10));
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      // For twice_daily: also accept target + 12h
      const target2 = new Date(target.getTime() + 12 * 3600 * 1000);
      const validTimes = s.auto_backup_frequency === 'twice_daily' ? [target, target2] : [target];
      dueByTime = validTimes.some((t) => Date.now() >= t.getTime() && (!latestMs || latestMs < t.getTime()));
      // On startup, if interval is satisfied, run anyway so we never skip a missed window
      if (reason === 'startup' && dueByInterval) dueByTime = true;
    }

    if (!(dueByInterval && dueByTime)) return;

    // Prefer the full backup routine (sqlite + xlsx + manifest) so an automated
    // backup leaves the same recovery payload a manual one would. Fall back to
    // a bare sqlite copy only if the backup service hasn't initialized yet
    // (very early startup race — registerIpc() hasn't run).
    if (isBackupServiceReady()) {
      try {
        await runFullBackup(dir, 'backup');
        mainWindowRef?.webContents.send('app:autoBackupRan', { at: new Date().toISOString(), reason });
        return;
      } catch (e) {
        console.error('Full auto-backup failed, falling back to sqlite-only:', e);
      }
    }

    // Bare-bones fallback path
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
    const bundleDir = path.join(dir, 'sqlite', day, time);
    fs.mkdirSync(bundleDir, { recursive: true });
    const dest = path.join(bundleDir, 'caredesk.sqlite');
    try { await db.backup(dest); } catch { fs.copyFileSync(path.join(userData, 'caredesk.sqlite'), dest); }
    mainWindowRef?.webContents.send('app:autoBackupRan', { at: new Date().toISOString(), reason });
  } catch (e) {
    console.error('Scheduled backup failed:', e);
  }
}

// Backwards compat name (still called from app.whenReady)
async function runAutoBackupIfDue() { return runScheduledBackup('startup'); }

let lastNotifiedDailyKey = '';
let lastNotifiedUsbKey = '';
function fireOsNotification(title: string, body: string, channel: 'daily' | 'usb') {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, urgency: 'critical' });
    n.on('click', () => {
      showWindow();
      if (channel === 'usb') mainWindowRef?.webContents.send('app:usbReminderTick');
      else mainWindowRef?.webContents.send('app:closeRequested');
    });
    n.show();
  }
  if (mainWindowRef) {
    if (mainWindowRef.isVisible()) mainWindowRef.flashFrame(true);
    if (channel === 'usb') mainWindowRef.webContents.send('app:usbReminderTick');
    else mainWindowRef.webContents.send('app:reminderTick', { reminder: '' });
  }
}

let lastUpdateCheckKey = '';
function tickReminder() {
  try {
    const s = getAllSettings(getDb());
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateKey = now.toISOString().slice(0, 10);

    const reminder = s.backup_reminder_time || '21:00';
    const dailyKey = dateKey + '@' + reminder;
    if (hhmm === reminder && lastNotifiedDailyKey !== dailyKey) {
      lastNotifiedDailyKey = dailyKey;
      fireOsNotification('CareDesk HMS — Time to backup & close', `It's ${reminder}. Click to open backup screen.`, 'daily');
    }

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

    // Daily update check
    if (s.update_check_enabled !== false) {
      const updateTime = s.update_check_time || '10:30';
      const updateKey = dateKey + '@upd@' + updateTime;
      if (hhmm === updateTime && lastUpdateCheckKey !== updateKey) {
        lastUpdateCheckKey = updateKey;
        safeCheckForUpdates();
      }
    }
  } catch (e) {
    console.warn('Reminder tick failed:', e);
  }
}

app.whenReady().then(async () => {
  getDb();
  registerIpc();
  createWindow();
  ensureTray();

  // Apply current login-item config on every launch (handles upgrades/changes)
  const s0 = getAllSettings(getDb());
  applyAutoLaunch(s0.auto_launch, s0.start_minimized);

  await runAutoBackupIfDue();
  // Check every 5 minutes — frequency check is internal so this is cheap
  setInterval(() => runScheduledBackup('tick'), 5 * 60 * 1000);
  setInterval(tickReminder, 30_000);
  tickReminder();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep app alive when window closes if minimize_to_tray is on
app.on('window-all-closed', () => {
  // Do not quit — tray keeps the app alive in background
});

app.on('before-quit', () => {
  allowQuit = true;
  closeDb();
  trayRef?.destroy();
});
