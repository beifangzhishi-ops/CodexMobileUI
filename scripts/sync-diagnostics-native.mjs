// Preserve direct diagnostics download after Expo regenerates Android sources.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function syncDiagnosticsNative(sourceRoot) {
  const root = resolve(sourceRoot);
  const java = resolve(root, 'android/app/src/main/java/dev/codexmobileui/app');
  const appPath = resolve(java, 'MainApplication.kt');
  const modulePath = resolve(java, 'DiagnosticsDownloadModule.kt');
  if (!existsSync(appPath)) throw Error('Missing native Android application');

  copyFileSync(resolve(root, 'native/diagnostics/DiagnosticsDownloadModule.kt'), modulePath);
  let app = readFileSync(appPath, 'utf8');
  if (!app.includes('add(DiagnosticsDownloadPackage())')) {
    const registration = 'add(DiagnosticsDownloadPackage())';
    const existing = ['add(NotificationPackage())', 'add(AppNavigationPackage())',
      'add(QuotaWidgetPackage())'].find((marker) => app.includes(marker));
    const manualMarker = '// add(MyReactNativePackage())';
    const packageListMarker = 'PackageList(this).packages.apply {';
    const marker = existing ?? (app.includes(manualMarker) ? manualMarker
      : app.includes(packageListMarker) ? packageListMarker : null);
    if (!marker) throw Error('Missing native package registration point');
    app = app.replace(marker, marker + '\n          ' + registration);
    writeFileSync(appPath, app);
  }
  return { appPath, modulePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  syncDiagnosticsNative(root);
  console.log('Synced Android diagnostics download module.');
}
