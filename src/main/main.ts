import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, shell, globalShortcut, nativeImage, safeStorage } from 'electron';
import type { AppUpdater } from 'electron-updater';
import log from 'electron-log';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// File-based startup/crash log (survives silent main-process failures).
const diagFile = path.join(os.tmpdir(), 'orbit-main-debug.log');
function mark(m: string): void {
  try { fs.appendFileSync(diagFile, `${new Date().toISOString()} ${m}\n`); } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => mark(`UNCAUGHT ${String((e as Error)?.stack ?? e)}`));
process.on('unhandledRejection', (e) => mark(`UNHANDLED ${String(e)}`));
mark('main module loaded');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendStarted = false;
let quitting = false;

// Auto-updater loads lazily (never blocks startup): the electron-updater
// module import has been observed to stall the main process in some
// environments, so it is fenced behind a timeout and every failure
// degrades gracefully to "updates unavailable".
let updater: AppUpdater | null = null;
let updaterFailed = false;

async function getUpdater(): Promise<AppUpdater | null> {
  if (updater) return updater;
  if (updaterFailed) return null;
  mark('loading electron-updater (lazy)');
  try {
    const mod = await Promise.race([
      import('electron-updater'),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('updater import timed out after 15s')), 15000)),
    ]) as unknown as { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } };
    // NB: the singleton is reliably found on the default export; the
    // top-level named binding is not statically detectable in all builds.
    const au = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!au) throw new Error('autoUpdater export not found in electron-updater');
    updater = au;
    updater.logger = log;
    log.transports.file.level = 'info';
    updater.autoDownload = true; // download in background when available
    updater.autoInstallOnAppQuit = true;
    // Escape hatch for self-hosted update feeds (also used by the update test):
    // ORBIT_UPDATE_URL=http://host:port switches to a generic provider.
    if (process.env.ORBIT_UPDATE_URL) {
      updater.setFeedURL({ provider: 'generic', url: process.env.ORBIT_UPDATE_URL });
      mark(`update feed override: ${process.env.ORBIT_UPDATE_URL}`);
    }
    updater.on('checking-for-update', () => { mark('update: checking'); sendUpdateStatus('checking'); });
    updater.on('update-available', (info) => { mark(`update: available v${info.version}`); sendUpdateStatus('available', { version: info.version }); });
    updater.on('update-not-available', (info) => { mark(`update: not available (latest v${info.version})`); sendUpdateStatus('not-available', { version: info.version }); });
    updater.on('error', (err) => { mark(`update: error ${String((err as Error)?.message ?? err)}`); sendUpdateStatus('error', { message: (err as Error)?.message ?? 'Update error' }); });
    updater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (info) => { mark(`update: downloaded v${info.version}`); sendUpdateStatus('downloaded', { version: info.version }); });
    mark('electron-updater ready');
    return updater;
  } catch (err) {
    updaterFailed = true;
    mark(`electron-updater unavailable: ${String(err)}`);
    return null;
  }
}

function sendUpdateStatus(status: string, data?: Record<string, unknown>): void {
  win?.webContents.send('orbit:update-status', { status, data });
}

async function startEmbeddedBackend(): Promise<void> {
  if (backendStarted) return;
  backendStarted = true;
  // Production default: keep user data in the OS app-data dir (per-user,
  // survives updates), never scattered next to the exe. Overridable via env.
  if (!process.env.DATABASE_PATH) {
    try {
      process.env.DATABASE_PATH = path.join(app.getPath('userData'), 'orbit.sqlite');
    } catch { /* fall back to cwd-relative default */ }
  }
  mark('starting embedded backend');
  try {
    const { startServer } = await import('../../server/index.js');
    await startServer(Number(process.env.PORT ?? 6742));
    mark('embedded backend ready');
  } catch (err) {
    mark(`embedded backend failed: ${String(err)}`);
    console.error('[orbit main] embedded backend failed (renderer can still use remote):', err);
  }
}

function createWindow(): void {
  const startHidden = process.argv.includes('--autostart') || process.argv.includes('--minimized');
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Orbit',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!startHidden) {
    win.once('ready-to-show', () => win?.show());
  }

  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, '..', '..', '..', 'renderer', 'index.html');
    void win.loadFile(indexHtml);
  }

  win.on('close', (e) => {
    const minimizeToTray = true; // preference; settings can toggle via IPC
    if (minimizeToTray && !quitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray(): void {
  try {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('Orbit');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Orbit', click: () => win?.show() },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => win?.show());
  } catch (err) {
    console.error('[orbit main] tray unavailable:', err);
  }
}

// Renderer -> main IPC (secure, validated)
ipcMain.handle('orbit:pickFiles', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('orbit:notify', (_e, args: { title: string; body: string }) => {
  const title = String(args?.title ?? '').slice(0, 120) || 'Orbit';
  const body = String(args?.body ?? '').slice(0, 300);
  if (Notification.isSupported()) new Notification({ title, body }).show();
  return true;
});
ipcMain.handle('orbit:openExternal', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url);
  return true;
});

// Auto-update IPC (lazy updater; degrades to an error payload if unavailable)
ipcMain.handle('orbit:checkForUpdates', async () => {
  try {
    const u = await getUpdater();
    if (!u) return { error: 'Auto-update unavailable on this device' };
    const result = await u.checkForUpdates();
    return { updateInfo: result?.updateInfo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Check failed' };
  }
});
ipcMain.handle('orbit:quitAndInstall', async () => {
  const u = await getUpdater();
  u?.quitAndInstall(true, true);
});
ipcMain.handle('orbit:getAppVersion', () => app.getVersion());

// Persistent session (auth token) in the main process.
// Why not localStorage: the renderer loads over file://, whose storage is
// keyed per install path — moving/reinstalling the app silently wipes it.
// This file lives in the OS user-data dir, survives updates and reinstalls,
// and is OS-encrypted (DPAPI/keychain) when available.
const sessionFile = () => path.join(app.getPath('userData'), 'orbit-session.json');
ipcMain.handle('orbit:getSession', () => {
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile(), 'utf8')) as { enc?: string; token?: string };
    if (data.enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(data.enc, 'base64'));
    }
    return data.token ?? null;
  } catch { return null; }
});
ipcMain.handle('orbit:setSession', (_e, token: string | null) => {
  try {
    if (!token) { fs.rmSync(sessionFile(), { force: true }); return true; }
    const data = safeStorage.isEncryptionAvailable()
      ? { enc: safeStorage.encryptString(token).toString('base64') }
      : { token };
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
    fs.writeFileSync(sessionFile(), JSON.stringify(data), { mode: 0o600 });
    return true;
  } catch (err) {
    mark(`session save failed: ${String(err)}`);
    return false;
  }
});

// Small generic key-value store in user-data (powers the offline outbox,
// reusable for drafts later). Values must be JSON-serializable.
const kvFile = () => path.join(app.getPath('userData'), 'orbit-kv.json');
function readKV(): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(kvFile(), 'utf8')) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}
ipcMain.handle('orbit:kv:get', (_e, key: unknown) => {
  if (typeof key !== 'string' || key.length > 128) return null;
  return readKV()[key] ?? null;
});
ipcMain.handle('orbit:kv:set', (_e, key: unknown, value: unknown) => {
  try {
    if (typeof key !== 'string' || key.length > 128) return false;
    const kv = readKV();
    if (value == null) delete kv[key];
    else kv[key] = value;
    fs.mkdirSync(path.dirname(kvFile()), { recursive: true });
    fs.writeFileSync(kvFile(), JSON.stringify(kv));
    return true;
  } catch (err) {
    mark(`kv save failed: ${String(err)}`);
    return false;
  }
});

// Deep links: orbit://<invite-code>
function handleDeepLink(url: string): void {
  const m = url.match(/^orbit:\/\/([A-Za-z0-9-]+)/);
  if (m && win) win.webContents.send('orbit:deep-link', { inviteCode: m[1] });
}
if (process.platform === 'win32' || process.platform === 'linux') {
  const arg = process.argv.find((a) => a.startsWith('orbit://'));
  if (arg) setTimeout(() => handleDeepLink(arg), 2000);
}
app.on('open-url', (_e, url) => handleDeepLink(url));
app.on('second-instance', (_e, argv) => {
  const arg = argv.find((a) => a.startsWith('orbit://'));
  if (arg) handleDeepLink(arg);
  win?.show();
});

void app.whenReady().then(async () => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }
  await startEmbeddedBackend();
  createWindow();
  createTray();
  // Global shortcuts (best-effort)
  try {
    globalShortcut.register('CommandOrControl+Shift+M', () => win?.webContents.send('orbit:shortcut', { id: 'mute' }));
    globalShortcut.register('CommandOrControl+Shift+D', () => win?.webContents.send('orbit:shortcut', { id: 'deafen' }));
  } catch { /* unsupported */ }
  // Auto-start is exposed via settings (login item); default off.
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  // Auto-update: initial check + periodic (lazy; failures only mark status)
  if (!process.env.VITE_DEV_URL) {
    void getUpdater().then((u) => u?.checkForUpdates().catch(() => undefined));
    setInterval(() => { void getUpdater().then((u) => u?.checkForUpdates().catch(() => undefined)); }, 60 * 60 * 1000); // every hour
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

export const __orbitMain = { createWindow };
export { pathToFileURL };
