'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopSettings', Object.freeze({
  read: () => ipcRenderer.invoke('desktop:settings-read'),
  save: (settings) => ipcRenderer.invoke('desktop:settings-save', settings),
  close: () => ipcRenderer.send('desktop:settings-close'),
}));
