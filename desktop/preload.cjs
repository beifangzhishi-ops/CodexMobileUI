'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const allowedCommands = new Set(['new-chat', 'toggle-sidebar', 'search']);
contextBridge.exposeInMainWorld('codexDesktop', Object.freeze({
  openMenu: (id, x, y) => ipcRenderer.send('desktop:open-menu', { id, x, y }),
  revealFile: (hostId, path) => ipcRenderer.invoke('desktop:reveal-file', { hostId, path }),
  localHost: () => ipcRenderer.invoke('desktop:local-host'),
  syncPathHosts: (hosts) => ipcRenderer.invoke('desktop:sync-path-hosts', hosts),
  filePath: (file) => webUtils.getPathForFile(file),
}));
contextBridge.exposeInMainWorld('desktopOffline', Object.freeze({
  openMenu: (id, x, y) => ipcRenderer.send('desktop:open-menu', { id, x, y }),
  retry: () => ipcRenderer.send('desktop:offline-retry'),
  settings: () => ipcRenderer.send('desktop:offline-settings'),
}));
ipcRenderer.on('desktop:menu-closed', () => window.dispatchEvent(new Event('codexdesktop:menu-closed')));
ipcRenderer.on('desktop:command', (_event, command) => {
  if (allowedCommands.has(command)) window.dispatchEvent(new CustomEvent('codexdesktop:' + command));
});
