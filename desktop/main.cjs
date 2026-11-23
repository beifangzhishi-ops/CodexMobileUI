'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, screen, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseSettings, defaultSettings, fileCandidates } = require('./config.cjs');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let quitting = false;
let settings = null;
let configPath = null;
const isWindows = process.platform === 'win32';
const titleMenuIds = ['file', 'edit', 'view', 'window'];

function readSettings() {
  try { return parseSettings(JSON.parse(fs.readFileSync(configPath, 'utf8'))); }
  catch { return defaultSettings(); }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = configPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, configPath);
}

function hasRemoteAccess(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === new URL(settings.serverUrl).origin; }
  catch { return false; }
}

function hasSettingsAccess(event) {
  return !!settingsWindow && event.sender === settingsWindow.webContents &&
    event.senderFrame === settingsWindow.webContents.mainFrame &&
    event.senderFrame.url === pathToFileURL(path.join(__dirname, 'settings.html')).href;
}

function hasOfflineAccess(event) {
  return !!mainWindow && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    event.senderFrame.url === pathToFileURL(path.join(__dirname, 'offline.html')).href;
}

function externalURL(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !parsed.username && !parsed.password && parsed.origin !== new URL(settings.serverUrl).origin;
  } catch { return false; }
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:command', command);
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    title: '桌面端连接设置', width: 505, height: 615, minWidth: 430, minHeight: 560,
    parent: mainWindow || undefined, modal: false, resizable: true, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'settings-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  void settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
}

function loadRemote() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.loadURL(settings.serverUrl).catch(() => undefined);
}

function showMainWindow() {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.show();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  tray.setToolTip('CodexMobileUI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出 CodexMobileUI', click: () => app.quit() },
  ]));
  tray.on('click', showMainWindow);
}

function menuTemplate() {
  return [
    { label: '文件', submenu: [
      { label: '新建聊天', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-chat') },
      { label: '连接设置', accelerator: 'CmdOrCtrl+,', click: openSettings },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '视图', submenu: [
      { label: '搜索', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('search') },
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+\\', click: () => sendCommand('toggle-sidebar') },
      { label: '重新连接', accelerator: 'CmdOrCtrl+R', click: loadRemote },
      { type: 'separator' }, { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
      { role: 'togglefullscreen', label: '全屏' },
    ] },
    { label: '窗口', submenu: [ { role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' } ] },
  ];
}

function openTitleMenu(event, payload) {
  if (!hasRemoteAccess(event) && !hasOfflineAccess(event)) return;
  if (!payload || !titleMenuIds.includes(payload.id) ||
      !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const index = titleMenuIds.indexOf(payload.id);
  const submenu = menuTemplate()[index].submenu;
  const x = Math.min(Math.max(Math.round(payload.x), 0), mainWindow.getContentBounds().width - 1);
  const y = Math.min(Math.max(Math.round(payload.y), 0), 120);
  Menu.buildFromTemplate(submenu).popup({ window: mainWindow, x, y,
    callback: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:menu-closed');
    },
  });
}

function handleDesktopShortcuts(event, input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt || input.meta) return;
  if (input.key === 'F11') { event.preventDefault(); mainWindow?.setFullScreen(!mainWindow.isFullScreen()); return; }
  if (!input.control) return;
  const key = input.key.toLowerCase();
  if (input.shift) return;
  if (key === 'n') { event.preventDefault(); sendCommand('new-chat'); }
  else if (key === 'k') { event.preventDefault(); sendCommand('search'); }
  else if (key === '\\') { event.preventDefault(); sendCommand('toggle-sidebar'); }
  else if (key === ',') { event.preventDefault(); openSettings(); }
  else if (key === 'r') { event.preventDefault(); loadRemote(); }
  else if (key === '0') { event.preventDefault(); mainWindow?.webContents.setZoomFactor(1); }
  else if (key === '+' || key === '=') {
    event.preventDefault();
    mainWindow?.webContents.setZoomFactor(Math.min(3, mainWindow.webContents.getZoomFactor() + 0.1));
  } else if (key === '-') {
    event.preventDefault();
    mainWindow?.webContents.setZoomFactor(Math.max(0.5, mainWindow.webContents.getZoomFactor() - 0.1));
  }
}

async function revealFile(hostId, rawPath) {
  const candidates = fileCandidates(settings, hostId, rawPath);
  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isFile()) { shell.showItemInFolder(candidate); return { ok: true }; }
      if (stat.isDirectory()) {
        const error = await shell.openPath(candidate);
        if (!error) return { ok: true };
      }
    } catch { /* Try the next user-approved SMB share candidate. */ }
  }
  return { ok: false, error: '文件不存在，或当前电脑没有权限访问该共享路径' };
}

function registerIPC() {
  ipcMain.on('desktop:open-menu', openTitleMenu);
  ipcMain.handle('desktop:local-host', (event) => {
    if (!hasRemoteAccess(event)) throw Error('UNTRUSTED_RENDERER');
    return settings.localHost;
  });
  ipcMain.handle('desktop:sync-path-hosts', (event, hosts) => {
    if (!hasRemoteAccess(event)) throw Error('UNTRUSTED_RENDERER');
    if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts) ||
        Object.keys(hosts).sort().join(',') !== '6v,noha') throw Error('INVALID_PATH_HOSTS');
    const next = parseSettings({ ...settings,
      hostIps: { '6v': hosts['6v']?.ip, noha: hosts.noha?.ip },
      hostShares: { '6v': hosts['6v']?.share, noha: hosts.noha?.share } });
    writeSettings(next);
    settings = next;
    return { ok: true };
  });
  ipcMain.handle('desktop:reveal-file', async (event, payload) => {
    if (!hasRemoteAccess(event)) throw Error('UNTRUSTED_RENDERER');
    if (!payload || typeof payload !== 'object') throw Error('INVALID_HOST_FILE');
    return revealFile(payload.hostId, payload.path);
  });
  ipcMain.handle('desktop:settings-read', (event) => {
    if (!hasSettingsAccess(event)) throw Error('UNTRUSTED_SETTINGS');
    return { serverUrl: settings.serverUrl, localHost: settings.localHost,
      hostIps: settings.hostIps, hostShares: settings.hostShares };
  });
  ipcMain.handle('desktop:settings-save', (event, data) => {
    if (!hasSettingsAccess(event)) throw Error('UNTRUSTED_SETTINGS');
    const next = parseSettings({ ...data, windowBounds: settings.windowBounds });
    writeSettings(next);
    const changed = next.serverUrl !== settings.serverUrl;
    settings = next;
    if (changed) loadRemote();
    settingsWindow?.close();
    return { ok: true };
  });
  ipcMain.on('desktop:settings-close', (event) => {
    if (hasSettingsAccess(event)) settingsWindow?.close();
  });
  ipcMain.on('desktop:offline-retry', (event) => {
    if (hasOfflineAccess(event)) loadRemote();
  });
  ipcMain.on('desktop:offline-settings', (event) => {
    if (hasOfflineAccess(event)) openSettings();
  });
}

function registerDownloads() {
  session.defaultSession.on('will-download', async (_event, item, contents) => {
    // Only the trusted Coordinator can initiate a native Save As dialog.
    if (!mainWindow || contents !== mainWindow.webContents ||
        !item.getURL().startsWith('blob:' + new URL(settings.serverUrl).origin + '/')) {
      item.cancel(); return;
    }
    item.pause();
    const name = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存助手文件', defaultPath: path.join(app.getPath('downloads'), name || 'codex-file'),
    });
    if (item.isDestroyed()) return;
    if (result.canceled || !result.filePath) item.cancel();
    else { item.setSavePath(result.filePath); item.resume(); }
  });
}

function createWindow() {
  const persisted = settings.windowBounds;
  const visible = persisted && screen.getAllDisplays().some((display) => {
    const a = display.workArea;
    return persisted.x < a.x + a.width - 120 && persisted.y < a.y + a.height - 100 &&
      persisted.x + persisted.width > a.x + 120 && persisted.y + persisted.height > a.y + 100;
  });
  mainWindow = new BrowserWindow({
    title: 'CodexMobileUI', width: visible ? persisted.width : 1280,
    height: visible ? persisted.height : 840,
    ...(visible ? { x: persisted.x, y: persisted.y } : {}), minWidth: 750, minHeight: 500,
    show: false, autoHideMenuBar: true, backgroundColor: '#101010',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#202225', symbolColor: '#f3f3f3', height: 48 },
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false, allowRunningInsecureContent: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('before-input-event', handleDesktopShortcuts);
  mainWindow.on('session-end', () => { quitting = true; });
  mainWindow.on('close', (event) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      settings.windowBounds = mainWindow.getBounds();
      try { writeSettings(settings); } catch { /* Keep the active window usable. */ }
    }
    if (tray && !quitting) {
      event.preventDefault();
      settingsWindow?.hide();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (externalURL(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== settings.serverUrl && !url.startsWith(settings.serverUrl + '#')) event.preventDefault();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url.startsWith(settings.serverUrl)) {
      void mainWindow?.loadFile(path.join(__dirname, 'offline.html')).catch(() => undefined);
    }
  });
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) items.push({ role: 'undo', label: '撤销' },
      { type: 'separator' }, { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' });
    else if (params.selectionText) items.push({ role: 'copy', label: '复制' });
    if (params.linkURL && externalURL(params.linkURL)) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: '在浏览器中打开链接', click: () => void shell.openExternal(params.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  loadRemote();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
  });
  app.whenReady().then(() => {
    configPath = path.join(app.getPath('userData'), 'desktop-settings.json');
    settings = readSettings();
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      let valid = false;
      try { valid = Boolean(mainWindow && webContents === mainWindow.webContents &&
        new URL(webContents.getURL()).origin === new URL(settings.serverUrl).origin); }
      catch { /* No permissions outside the Coordinator origin. */ }
      callback(Boolean(valid && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission)));
    });
    registerIPC(); registerDownloads();
    Menu.setApplicationMenu(null);
    if (isWindows) createTray();
    createWindow();
  });
  app.on('window-all-closed', () => { if (isWindows || process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
