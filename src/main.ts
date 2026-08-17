import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { registerIpc, runFullBackup, isBackupServiceReady, runConfiguredBackup, requireRole } from './main/ipc';
import { registerIpdBillingIpc, runDailyAccrual } from './main/ipd-billing-ipc';
import { registerPedsIpc } from './main/peds-ipc';
import { installIpcRegistry, setReadOnlyMode } from './main/ipc-registry';
import { getLicenseStatus, activateLicense, activateOnline, machineFingerprint } from './main/licensing/license';
import { registerWhatsAppIpc, pollRelayServer, runScheduledCampaigns } from './main/whatsapp-ipc';
import { processQueue } from './services/whatsapp/queue-worker';
import { runAutomationScheduler } from './services/whatsapp/scheduler';
import { startNetworkServer, stopNetworkServer, networkServerStatus, getJoinCode, regenerateJoinCode, getLocalLanIP, setPreferredIp, runSelfTest } from './main/network-server';
import { discoverServers, pairWithCode, addWindowsFirewallRule } from './main/network-discovery';
import { installNetworkClient, networkClientStatus, uninstallNetworkClient, reconnectNow, setClientStateListener, setUrlPersister } from './main/network-client';
import { listNetworkInterfaces, runDiagnostics, scanLanForHosts } from './main/network-diagnostics';
// Vite's ?raw import bundles the splash HTML as a string at build time so the
// main process can show it before the main BrowserWindow is ready.
// @ts-ignore — Vite ?raw import has no built-in TS shim
import splashHtml from './splash.html?raw';
import { getDb, closeDb } from './db/db';
import { getAllSettings, saveSettings } from './db/settings';
import { checkHostPower, disableHostSleep } from './main/host-power';

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
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'CureDesk-HMS-UpdateCheck' },
    });
    // 404 from /releases/latest means the repo has no PUBLISHED releases yet
    // (drafts and pre-releases don't count). Not an error — there's just
    // nothing newer for the user to install. Show as "uptodate" so the user
    // sees a green "you're on the latest version" instead of a scary red error.
    if (res.status === 404) {
      updateState = 'uptodate';
      updateInfo = {
        currentVersion,
        latestVersion: currentVersion,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        checkedAt,
      };
      const payload = { state: updateState, ...updateInfo };
      mainWindowRef?.webContents.send('updates:state', payload);
      return payload;
    }
    if (!res.ok) throw new Error(`Update server ${res.status}: ${res.statusText}`);
    const json = await res.json() as any;
    const tag = (json.tag_name || '').toString();
    const latest = tag.replace(/^v/i, '');
    // Find the Setup .exe asset (NSIS installer); fall back to release page if none.
    const asset = (json.assets || []).find((a: any) =>
      typeof a?.name === 'string' && /setup.*\.exe$/i.test(a.name)
    );
    const downloadUrl = asset?.browser_download_url || json.html_url;
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

/** Read network_mode from settings and start/stop the LAN server accordingly.
 *  Called once at boot AND every time the user saves Network Mode in Settings. */
async function applyNetworkMode() {
  // Lazy-import to avoid pulling DB before whenReady().
  const s = getAllSettings(getDb());
  // Honour the operator's pinned adapter before anything reads getLocalLanIP().
  setPreferredIp(s.network_bind_ip || '');
  if (s.network_mode === 'server') {
    // Leaving Client mode — restore local handlers before starting the server.
    uninstallNetworkClient();
    const port = s.network_listen_port || 4321;
    // Auto-generate a secret if the user enabled Server mode without typing one.
    let secret = s.network_secret || '';
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      // Persist back so next launch keeps the same secret. Use the top-level
      // import (NOT a dynamic require — Vite bundles main.ts into a single
      // main.js so './db/settings' doesn't exist as a separate module at runtime).
      saveSettings(getDb(), { network_secret: secret });
    }
    const result = await startNetworkServer(port, secret, app.getVersion());
    if (result.ok) {
      console.log(`[network] Server listening on port ${result.port}`);
      // Best-effort firewall rule (no-op if already exists or denied).
      addWindowsFirewallRule(port).catch(() => { /* ignore */ });
      // Launch self-test: did we actually answer on our own LAN IP?
      const st = result.selfTest;
      if (st?.reachable) console.log(`[network] Self-test OK — reachable at http://${st.ip}:${st.port}`);
      else console.warn(`[network] Self-test FAILED — cabins may not connect: ${st?.error || 'unknown'}`);
      // Re-run after the firewall rule / first-run "Allow access" prompt settles,
      // so the status flips to reachable without a restart (the Settings panel
      // polls network:status every few seconds and picks it up).
      setTimeout(() => { runSelfTest().catch(() => { /* ignore */ }); }, 5000);
    } else {
      console.warn(`[network] Failed to start server: ${result.error}`);
    }
  } else if (s.network_mode === 'client') {
    // Stop any local server first (in case user toggled from server → client).
    await stopNetworkServer();
    // If the client auto-relocates to the host's new IP (DHCP change), persist
    // the new address so it survives the next launch.
    setUrlPersister((url) => { try { saveSettings(getDb(), { network_server_url: url }); } catch { /* ignore */ } });
    // Install the IPC-to-HTTP proxy. Every existing window.electronAPI call now
    // routes through the configured server transparently. Renderer code unchanged.
    const r = installNetworkClient(s.network_server_url, s.network_secret || '');
    if (r.ok) {
      console.log(`[network] Client installed — proxying ${r.channels} channels to ${s.network_server_url}`);
    } else {
      console.warn(`[network] Client install failed: ${r.error}`);
    }
  } else {
    await stopNetworkServer();
    uninstallNetworkClient();
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
      // Electron, not CureDesk. Skip and tell the UI.
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
      sandbox: true,
    },
  });
  mainWindowRef = mainWindow;

  // Hardening: the app is a local SPA, so block any attempt to navigate the
  // window to a remote origin or spawn a popup. Legitimate external links go
  // through the allowlisted app:openExternal IPC, never window.open / <a>.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, navUrl) => {
    const dev = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    const allowed = navUrl.startsWith('file:') || (!!dev && navUrl.startsWith(dev));
    if (!allowed) e.preventDefault();
  });

  // Push LAN connection-state changes to the renderer so the status pill and
  // the troubleshooting panel update the moment the link drops or recovers,
  // instead of waiting for the next poll.
  setClientStateListener((s) => {
    try { mainWindowRef?.webContents.send('network:state', s); } catch { /* ignore */ }
  });

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
  // Native clipboard write — the renderer loads over file://, which is not a
  // secure context, so navigator.clipboard is undefined there. Route copy
  // through the main process so "Copy" (Machine ID, etc.) actually works.
  ipcMain.handle('app:copyText', (_e, text: string) => {
    try { clipboard.writeText(String(text ?? '')); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
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
        lower.startsWith('https://maps.google.com/') ||
        lower.startsWith('https://mulgundsunil1918.github.io/mmcopd/') ||
        lower.startsWith('https://bridgr.co.in/');
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
  //
  // MANDATORY safety backup first: before sending them to install a new version,
  // take a full backup (to their configured folder, else userData/backups). No
  // data can be lost across an upgrade, even if a schema migration runs on next
  // launch. Backup rarely fails (the default folder always works); if it does we
  // report it so they can back up manually before installing.
  ipcMain.handle('updates:installNow', async () => {
    let backup: { ok: boolean; path?: string; error?: string };
    try {
      const r = await runConfiguredBackup('backup');
      backup = { ok: true, path: r.bundleDir };
    } catch (e: any) {
      backup = { ok: false, error: e?.message || String(e) };
    }
    openDownloadPage();
    return { ok: true, backup };
  });

  // ===== Hard reset =====
  // Wipes %APPDATA%\CureDesk HMS\ (everything: SQLite, settings, localStorage).
  //
  // Strategy: rmSync inside the running app DOESN'T work — Electron's own
  // storage files (Local Storage, Code Cache, GPUCache, sqlite-wal) stay
  // file-locked even after closeDb(), so the directory delete silently fails,
  // the app restarts, and picks up the OLD DB. Result: wizard doesn't appear.
  //
  // Fix: write a "wipe me" marker file to OS temp dir before relaunching.
  // The next launch reads the marker BEFORE any DB / storage opens, deletes
  // userData clean, then continues normal startup. Bulletproof against locks.
  ipcMain.handle('admin:hardResetAndRestart', async () => {
    requireRole([], 'erase all clinic data');
    try {
      const userData = app.getPath('userData');
      const marker = getResetMarkerPath();
      try { fs.mkdirSync(path.dirname(marker), { recursive: true }); } catch { /* ignore */ }
      fs.writeFileSync(marker, userData, 'utf8');
      // Close DB so as much as possible flushes; final lock release happens on exit.
      try { closeDb(); } catch { /* ignore */ }
      allowQuit = true;
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ===== Network / Multi-station =====
  ipcMain.handle('network:status', () => {
    const s = getAllSettings(getDb());
    return {
      mode: s.network_mode,
      listenPort: s.network_listen_port,
      serverUrl: s.network_server_url,
      hasSecret: !!s.network_secret,
      ...networkServerStatus(),
      appVersion: app.getVersion(),
      client: networkClientStatus(),
    };
  });
  // Apply the current settings.network_mode. Renderer calls this after saving
  // Settings so the server boots / stops without restarting the whole app.
  ipcMain.handle('network:applyMode', async () => {
    await applyNetworkMode();
    return { ok: true, ...networkServerStatus() };
  });
  // Re-run the host reachability self-test on demand (the "Re-check" button).
  ipcMain.handle('network:selfTest', async () => {
    const s = getAllSettings(getDb());
    if (s.network_mode !== 'server') return { reachable: false, ip: null, port: 0, error: 'This PC is not in Server mode.', at: Date.now() };
    return runSelfTest();
  });
  // Probe a remote server (used by the Settings "Test connection" button).
  ipcMain.handle('network:probe', async (_e, payload: { url: string; secret?: string }) => {
    try {
      const u = (payload.url || '').replace(/\/+$/, '');
      const headers: any = { 'Accept': 'application/json' };
      if (payload.secret) headers['Authorization'] = `Bearer ${payload.secret}`;
      const res = await fetch(`${u}/api/health`, { headers });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      return { ok: true, info: json };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Current join code + LAN IP — drives the big "Show this code on the host PC"
  // panel in the Welcome wizard / Settings page.
  ipcMain.handle('network:joinCode', () => ({
    code: getJoinCode()?.code ?? null,
    expiresAt: getJoinCode()?.expiresAt ?? null,
    lanIp: getLocalLanIP(),
    port: networkServerStatus().port,
  }));
  ipcMain.handle('network:regenJoinCode', () => {
    const s = getAllSettings(getDb());
    if (s.network_mode !== 'server') return { ok: false, error: 'Not in Server mode' };
    const port = s.network_listen_port || 4321;
    const fresh = regenerateJoinCode(s.network_secret || '', port);
    return { ok: true, ...fresh };
  });

  // Listen for UDP broadcasts and return discovered CureDesk servers on the LAN.
  // Used by the Welcome wizard's "Connect to existing clinic" flow.
  ipcMain.handle('network:discover', async (_e, opts: { timeoutMs?: number } = {}) => {
    const list = await discoverServers(opts.timeoutMs ?? 5_000);
    return list;
  });

  // Trade a 5-char join code for the server's secret + port. On success, the
  // renderer saves the result into settings and reloads in Client mode.
  ipcMain.handle('network:pair', async (_e, payload: { url: string; code: string }) => {
    return pairWithCode(payload.url, payload.code);
  });

  // ===== Troubleshooting =====
  // Every network adapter on this PC, wired-first, so the host can pin itself
  // to the Ethernet card instead of whichever one Node listed first.
  ipcMain.handle('network:interfaces', () => ({
    interfaces: listNetworkInterfaces(),
    active: getLocalLanIP(),
    pinned: getAllSettings(getDb()).network_bind_ip || '',
  }));

  // Staged connectivity check — tells the user which layer is broken and how to
  // fix it, instead of a bare "failed to fetch".
  ipcMain.handle('network:diagnose', async (_e, payload?: { url?: string; secret?: string }) => {
    const s = getAllSettings(getDb());
    const url = payload?.url ?? s.network_server_url ?? '';
    const secret = payload?.secret ?? s.network_secret ?? '';
    // When this PC is the host, also verify its own server is actually
    // listening — "nothing on port 4321" is a common and previously invisible
    // cause that no amount of checking from the other PC can reveal.
    const selfPort = s.network_mode === 'server' ? (s.network_listen_port || 4321) : undefined;
    return runDiagnostics(url, secret, selfPort);
  });

  /**
   * Find the main computer on this network.
   *
   * A clinic should never have to run ipconfig and work out which of several
   * addresses is the real one. This sweeps the local subnet for a CureDesk
   * host and reports exactly what to use.
   */
  ipcMain.handle('network:findHosts', async (_e, port?: number) => {
    try {
      const s2 = getAllSettings(getDb());
      const hosts = await scanLanForHosts(port || s2.network_listen_port || 4321);
      return { ok: true as const, hosts };
    } catch (err: any) {
      return { ok: false as const, hosts: [], error: err?.message || String(err) };
    }
  });

  /**
   * Will this host PC put itself to sleep and take the clinic offline?
   *
   * Windows enables sleep by default, so a PC promoted to host silently
   * inherits a timer that will drop every other computer mid-session. To the
   * staff that looks like the network broke, and they go restarting routers.
   * Catching it while someone is at the host is the whole point.
   */
  ipcMain.handle('network:hostPower', async () => {
    try { return await checkHostPower(); }
    catch (err: any) { return { known: false, sleepsOnAC: false, sleepAfterMinutes: 0, fixCommand: '', detail: err?.message || String(err) }; }
  });

  ipcMain.handle('network:disableHostSleep', async () => {
    try { return await disableHostSleep(); }
    catch (err: any) { return { ok: false, error: err?.message || String(err) }; }
  });

  // Force an immediate reconnect attempt (the "Reconnect now" button).
  ipcMain.handle('network:reconnect', async () => {
    const s = getAllSettings(getDb());
    if (s.network_mode === 'client') return reconnectNow();
    if (s.network_mode === 'server') {
      await applyNetworkMode();
      return { ok: networkServerStatus().running };
    }
    return { ok: false, error: 'Not in Server or Client mode' };
  });

  // Forget the paired host: tear down the proxy, clear the saved URL/secret,
  // and drop back to Local so the PC is usable while the user re-pairs.
  ipcMain.handle('network:forget', async () => {
    uninstallNetworkClient();
    saveSettings(getDb(), {
      network_mode: 'local',
      network_server_url: '',
      network_secret: '',
    });
    await applyNetworkMode();
    return { ok: true };
  });
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
      // We look at every scheduled instant across TODAY and YESTERDAY. Including
      // yesterday's is what makes a missed slot self-heal: if the PC was OFF at
      // last night's time, the moment it's switched on again — even first thing in
      // the morning, before today's slot — the most-recent past slot is yesterday's,
      // there's been no backup since, so it runs immediately. No button needed.
      const [hh, mm] = (s.auto_backup_time || '13:00').split(':').map((x) => parseInt(x, 10));
      const slot = (dayOffset: number, addHours = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hh, mm, 0, 0);
        return d.getTime() + addHours * 3600 * 1000;
      };
      const targets: number[] = [];
      for (const off of [0, -1]) {
        targets.push(slot(off));
        if (s.auto_backup_frequency === 'twice_daily') targets.push(slot(off, 12));
      }
      // Most recent scheduled instant that has already elapsed.
      const lastPassed = targets.filter((t) => Date.now() >= t).sort((a, b) => b - a)[0];
      if (!lastPassed) return;                         // nothing scheduled has occurred yet
      if (latestMs && latestMs >= lastPassed) return;  // already backed up since that slot
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
        const res: any = await runFullBackup(dir, 'backup');
        const verified = res?.verified !== false; // undefined (older path) counts as ok
        mainWindowRef?.webContents.send('app:autoBackupRan', { at: new Date().toISOString(), reason, verified });
        // Robustness: if the automated copy fails its integrity / row-count check,
        // don't let it pass silently — warn the clinic so they can back up manually.
        if (!verified) {
          fireOsNotification(
            'CureDesk backup needs attention',
            'Today’s automatic backup did not pass the safety check. Please open CureDesk → Backup and run a manual backup to a different folder or USB.',
            'daily',
          );
        }
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

/** Persistent path used to defer userData wipes across an app restart. Same
 *  location every launch — derived from the userData path so different installs
 *  (per-user vs per-machine) don't collide. */
function getResetMarkerPath(): string {
  const tmp = require('node:os').tmpdir();
  const tag = require('node:crypto').createHash('md5').update(app.getPath('userData')).digest('hex').slice(0, 12);
  return path.join(tmp, `curedesk-reset-${tag}.flag`);
}

/** If the previous run wrote a "wipe me" marker, do the actual delete BEFORE
 *  any DB or Electron storage opens this session. Files are no longer locked
 *  by the previous process, so rmSync succeeds cleanly. */
function consumeResetMarkerIfPresent() {
  try {
    const marker = getResetMarkerPath();
    if (!fs.existsSync(marker)) return;
    const target = fs.readFileSync(marker, 'utf8').trim();
    if (target && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[reset] Wiped ${target}`);
    }
    try { fs.unlinkSync(marker); } catch { /* ignore */ }
  } catch (err) {
    console.warn('[reset] consumeResetMarkerIfPresent failed:', err);
  }
}

app.whenReady().then(async () => {
  // FIRST thing — process any pending hard reset from the last run. Must run
  // before getDb / Electron storage to avoid re-locking files.
  consumeResetMarkerIfPresent();
  // Splash first — appears immediately while DB + IPC + main window spin up.
  showSplash();
  getDb();
  // Wrap ipcMain.handle BEFORE registerIpc so every channel gets recorded into
  // ipcHandlers (network-server.ts reads from there to expose POST /ipc/:channel).
  installIpcRegistry();
  registerIpc();
  // IPD + billing live in their own module rather than growing ipc.ts further.
  registerIpdBillingIpc();
  registerPedsIpc();
  registerWhatsAppIpc();

  // ===== Licensing =====
  const applyLicense = () => {
    const st = getLicenseStatus();
    setReadOnlyMode(st.readOnly);
    try { mainWindowRef?.webContents.send('license:state', st); } catch { /* ignore */ }
    return st;
  };
  ipcMain.handle('license:status', () => applyLicense());
  ipcMain.handle('license:machineId', () => machineFingerprint());
  ipcMain.handle('license:activate', (_e, token: string) => {
    const r = activateLicense(String(token || ''));
    if (r.ok) applyLicense();
    return r;
  });
  ipcMain.handle('license:activateOnline', async (_e, code: string) => {
    const r = await activateOnline(String(code || ''));
    if (r.ok) applyLicense();
    return r;
  });
  applyLicense();                          // enforce from the very first IPC call
  setInterval(applyLicense, 60 * 60 * 1000); // re-evaluate hourly (grace/expiry crossing)

  // Boot the network server if Settings says we're in 'server' mode.
  await applyNetworkMode().catch((e) => console.warn('Network server boot failed:', e));
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

  /**
   * Daily IPD accrual at the configured time (Settings → Billing & IPD).
   *
   * The setting existed with no scheduler behind it, so bed and nursing charges
   * only landed when somebody opened a patient's bill. Checked every minute
   * against the clinic's chosen time, and guarded so a restart within the same
   * minute cannot post twice (the accrual is idempotent anyway).
   */
  let lastAccrualKey = '';
  setInterval(() => {
    try {
      const s = getAllSettings(getDb());
      const want = String(s.ipd_accrual_time || '00:05');
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (hhmm !== want) return;
      const key = `${now.toDateString()} ${want}`;
      if (key === lastAccrualKey) return;
      lastAccrualKey = key;
      const r = runDailyAccrual();
      if (r.added > 0) console.log(`[IPD accrual] ${r.added} line(s) across ${r.admissions} admission(s)`);
    } catch { /* never let the tick crash the app */ }
  }, 60_000);

  // WhatsApp background workers — queue flush + automation scheduler + relay poll
  const waWorker = () => {
    const d = getDb();
    processQueue(d).catch((e) => console.warn('[WA queue]', e));
    runAutomationScheduler(d);
    pollRelayServer().catch((e) => console.warn('[WA relay]', e));
    runScheduledCampaigns().catch((e) => console.warn('[WA scheduled]', e));
  };
  setInterval(waWorker, 60_000);
  waWorker();

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
