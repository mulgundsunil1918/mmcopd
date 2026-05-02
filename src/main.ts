import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc, runFullBackup, isBackupServiceReady } from './main/ipc';
// Vite's ?raw import bundles the splash HTML as a string at build time so the
// main process can show it before the main BrowserWindow is ready.
// @ts-ignore — Vite ?raw import has no built-in TS shim
import splashHtml from './splash.html?raw';
import { getDb, closeDb } from './db/db';
import { getAllSettings } from './db/settings';

// Update mechanism: poll GitHub Releases API on demand and on a daily timer.
// We ship via NSIS (electron-builder) so Electron's built-in Squirrel autoUpdater
// doesn't apply. The "install" path opens the new Setup.exe download page in
// the user's browser; they double-click to install over the existing version.
const GITHUB_REPO = 'mulgundsunil1918/mmcopd';

type UpdateState = 'idle' | 'checking' | 'uptodate' | 'available' | 'error';
let updateState: UpdateState = 'idle';
let updateInfo: {
  currentVersion?: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  checkedAt?: string;
  error?: string;
} = {};

/** "1.10.2" > "1.9.9" by component-wise integer comparison. Returns true when `a` is newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const norm = (v: string) => v.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0);
  const [aa, bb] = [norm(a), norm(b)];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0, y = bb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkGitHubReleaseNow(): Promise<typeof updateInfo & { state: UpdateState }> {
  updateState = 'checking';
  updateInfo = { ...updateInfo, error: undefined };
  mainWindowRef?.webContents.send('updates:state', { state: updateState, ...updateInfo });
  const currentVersion = app.getVersion();
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'CureDesk-HMS-UpdateCheck' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    const json = await res.json() as any;
    const tag = (json.tag_name || '').toString();
    const latest = tag.replace(/^v/i, '');
    // Find the Setup .exe asset (NSIS installer); fall back to release page if none.
    const asset = (json.assets || []).find((a: any) =>
      typeof a?.name === 'string' && /setup.*\.exe$/i.test(a.name)
    );
    const downloadUrl = asset?.browser_download_url || json.html_url;
    const checkedAt = new Date().toISOString();
    if (latest && isNewer(latest, currentVersion)) {
      updateState = 'available';
      updateInfo = {
        currentVersion, latestVersion: latest,
        releaseNotes: json.body || '',
        releaseUrl: json.html_url,
        downloadUrl, checkedAt,
      };
    } else {
      updateState = 'uptodate';
      updateInfo = {
        currentVersion, latestVersion: latest || currentVersion,
        releaseUrl: json.html_url, downloadUrl, checkedAt,
      };
    }
  } catch (err: any) {
    updateState = 'error';
    updateInfo = { ...updateInfo, currentVersion, error: err?.message || String(err) };
  }
  const payload = { state: updateState, ...updateInfo };
  mainWindowRef?.webContents.send('updates:state', payload);
  return payload;
}

function openDownloadPage() {
  const url = updateInfo.downloadUrl || updateInfo.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`;
  shell.openExternal(url);
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
    { label: `CureDesk HMS — ${s.clinic_name || 'Clinic'}`, enabled: false },
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
  trayRef.setToolTip(`${s.clinic_name || 'CureDesk HMS'} — running in background`);
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

function applyAutoLaunch(enabled: boolean, startMinimized: boolean): { ok: boolean; reason?: string; registered?: boolean; exePath?: string } {
  try {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return { ok: false, reason: `Auto-launch is only supported on Windows and macOS (running on ${process.platform}).` };
    }
    if (!app.isPackaged) {
      // In dev mode (npm start), app.getPath('exe') points at electron.exe inside
      // node_modules — registering that in the Windows Run key would launch a bare
      // Electron, not CareDesk. Skip and tell the UI.
      return { ok: false, reason: 'Auto-launch only takes effect in installed builds — running in dev mode (npm start) does NOT register with Windows. After installing the .exe, this will work.' };
    }
    const exePath = app.getPath('exe');
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: startMinimized,
      path: exePath,
      args: startMinimized ? ['--hidden'] : [],
    });
    // Verify the change actually stuck in the OS registry / launchd.
    const actual = app.getLoginItemSettings({ path: exePath });
    return { ok: true, registered: actual.openAtLogin, exePath };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

function readAutoLaunchStatus(): { supported: boolean; isPackaged: boolean; registered: boolean; exePath: string | null; reason?: string } {
  const supported = process.platform === 'win32' || process.platform === 'darwin';
  if (!supported) return { supported: false, isPackaged: app.isPackaged, registered: false, exePath: null, reason: `Not supported on ${process.platform}` };
  if (!app.isPackaged) return { supported: true, isPackaged: false, registered: false, exePath: null, reason: 'Dev mode — registry write skipped. Install the .exe to enable auto-launch.' };
  try {
    const exePath = app.getPath('exe');
    const actual = app.getLoginItemSettings({ path: exePath });
    return { supported: true, isPackaged: true, registered: actual.openAtLogin, exePath };
  } catch (e: any) {
    return { supported: true, isPackaged: true, registered: false, exePath: null, reason: e?.message || String(e) };
  }
}

/**
 * Frameless splash window — shown only in packaged builds, while the main
 * BrowserWindow loads. Auto-closes when the main window emits 'ready-to-show'.
 * Skipped in dev mode (npm start) since Vite serves quickly.
 */
let splashRef: BrowserWindow | null = null;
function showSplash() {
  if (!app.isPackaged) return; // dev mode loads instantly via Vite, no splash needed
  if (splashRef && !splashRef.isDestroyed()) return;
  try {
    splashRef = new BrowserWindow({
      width: 480,
      height: 360,
      frame: false,
      transparent: false,
      backgroundColor: '#0b1220',
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    splashRef.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
    splashRef.once('ready-to-show', () => splashRef?.show());
  } catch (e) {
    console.warn('Splash window failed:', e);
    splashRef = null;
  }
}
function closeSplash() {
  if (splashRef && !splashRef.isDestroyed()) {
    try { splashRef.close(); } catch { /* ignore */ }
  }
  splashRef = null;
}

function createWindow() {
  const settings = getAllSettings(getDb());
  const startedHidden = process.argv.includes('--hidden') && settings.start_minimized;
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: settings.clinic_name || 'CureDesk HMS',
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

  // Defer showing the main window until 'ready-to-show' so the splash stays
  // visible until React + DB queries are warm. Avoids a white flash.
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    if (!startedHidden) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

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
          title: 'CureDesk HMS',
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
    return applyAutoLaunch(enabled, startMinimized);
  });
  ipcMain.handle('app:getAutoLaunchStatus', () => readAutoLaunchStatus());
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
  ipcMain.handle('updates:checkNow', async () => {
    const result = await checkGitHubReleaseNow();
    return { ok: true, isPackaged: app.isPackaged, ...result };
  });
  // "Install" now = open the new Setup.exe download in the user's browser.
  // They double-click to install over the existing version. Their data
  // in %APPDATA%\CureDesk HMS\ is preserved.
  ipcMain.handle('updates:installNow', () => { openDownloadPage(); return { ok: true }; });
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

    const isWallClockMode = s.auto_backup_frequency === 'daily' || s.auto_backup_frequency === 'twice_daily';
    const intervalHours = FREQUENCY_HOURS[s.auto_backup_frequency] || 24;
    const intervalMs = intervalHours * 3600 * 1000;
    const latestMs = latestBackupMtime(dir);

    if (isWallClockMode) {
      // Wall-clock mode (daily / twice-daily): the configured time IS the schedule.
      // Don't apply the interval check — it would block today's run if any backup
      // (manual or yesterday's auto) happened within the past 24 hours.
      const [hh, mm] = (s.auto_backup_time || '13:00').split(':').map((x) => parseInt(x, 10));
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      const target2 = new Date(target.getTime() + 12 * 3600 * 1000);
      const validTimes = s.auto_backup_frequency === 'twice_daily' ? [target, target2] : [target];
      // Fire if we've crossed any target window AND no backup taken since that window.
      const dueByTime = validTimes.some((t) => Date.now() >= t.getTime() && (!latestMs || latestMs < t.getTime()));
      if (!dueByTime) return;
    } else {
      // Interval mode (hourly / every_3_hours / every_6_hours): plain elapsed-time check.
      const dueByInterval = !latestMs || (Date.now() - latestMs) >= intervalMs;
      if (!dueByInterval) return;
    }

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
      fireOsNotification('CureDesk HMS — Time to backup & close', `It's ${reminder}. Click to open backup screen.`, 'daily');
    }

    const usbWeekday = Number.isFinite(s.usb_reminder_weekday) ? s.usb_reminder_weekday : 1;
    const usbTime = s.usb_reminder_time || '09:30';
    const usbKey = dateKey + '@usb@' + usbTime;
    if (now.getDay() === usbWeekday && hhmm === usbTime && lastNotifiedUsbKey !== usbKey) {
      lastNotifiedUsbKey = usbKey;
      fireOsNotification(
        'CureDesk HMS — Weekly USB backup',
        'Plug in your USB drive and take this week\'s physical backup. Click to open.',
        'usb'
      );
    }

    // Daily update check — hits the GitHub Releases API and pushes the
    // result to the renderer; the Settings → Backups & Updates section
    // shows it as either "You're on the latest version" or a blue
    // "New version vX.Y.Z available · Download & Install" button.
    if (s.update_check_enabled !== false) {
      const updateTime = s.update_check_time || '10:30';
      const updateKey = dateKey + '@upd@' + updateTime;
      if (hhmm === updateTime && lastUpdateCheckKey !== updateKey) {
        lastUpdateCheckKey = updateKey;
        checkGitHubReleaseNow().catch(() => { /* swallowed; state already published */ });
      }
    }
  } catch (e) {
    console.warn('Reminder tick failed:', e);
  }
}

app.whenReady().then(async () => {
  // Splash first — appears immediately while DB + IPC + main window spin up.
  showSplash();
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
