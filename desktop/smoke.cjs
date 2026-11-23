'use strict';

// Noninteractive browser-render smoke check. Never launches or stops a Gateway
// or the existing Codex Desktop. Writes only an ignored test screenshot.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeServerUrl, defaultSettings } = require('./config.cjs');

const endpoint = normalizeServerUrl(process.env.CODEX_DESKTOP_TEST_URL || defaultSettings().serverUrl);
const output = path.join(__dirname, '..', '.tmp', 'desktop-smoke.png');
let window = null;

app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1280, height: 820, show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#202225', symbolColor: '#f3f3f3', height: 48 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadURL(endpoint);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const layout = await window.webContents.executeJavaScript(`(() => {
    const title = document.querySelector('.native-desktop-titlebar');
    const app = document.querySelector('.native-desktop-app');
    const menus = document.querySelectorAll('.native-titlebar-menus button');
    return { titleHeight: title?.getBoundingClientRect().height,
      appTop: app?.getBoundingClientRect().top, count: menus.length };
  })()`);
  if (layout.titleHeight !== 48 || layout.appTop !== 48 || layout.count !== 4) {
    throw Error('TITLEBAR_LAYOUT_INVALID ' + JSON.stringify(layout));
  }
  const screenshot = await window.capturePage();
  if (screenshot.isEmpty()) throw Error('EMPTY_SCREENSHOT');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, screenshot.toPNG());
  console.log('DESKTOP_RENDER_OK', output);
}).catch((error) => {
  process.exitCode = 1;
  console.error('DESKTOP_RENDER_FAILED', error.message);
}).finally(() => {
  window?.destroy();
  app.quit();
});
