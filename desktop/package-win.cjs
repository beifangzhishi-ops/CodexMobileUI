'use strict';

const path = require('node:path');
const { packager } = require('@electron/packager');
const version = require('../app.json').expo.version;

packager({
  dir: __dirname,
  // Isolated output prevents interference with older or concurrently running packagers.
  out: path.resolve(__dirname, '..', '.tmp', 'desktop-release', `${version}-offline`),
  name: 'CodexMobileUI',
  appVersion: version,
  platform: 'win32', arch: 'x64', overwrite: true, asar: true,
  electronZipDir: path.resolve(__dirname, '..', '.tmp', 'electron-zip'),
  icon: path.join(__dirname, 'icon.ico'),
  ignore: [/\/tests\//, /\/package-win\.cjs$/],
}).then((directories) => {
  console.log('Desktop executable:', path.join(directories[0], 'CodexMobileUI.exe'));
}).catch((error) => { console.error(error); process.exitCode = 1; });
