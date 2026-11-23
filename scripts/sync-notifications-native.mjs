// Preserve the native task completion listener across Expo prebuilds.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const java = resolve(root, 'android/app/src/main/java/dev/codexmobileui/app');
const manifestPath = resolve(root, 'android/app/src/main/AndroidManifest.xml');
const appPath = resolve(java, 'MainApplication.kt');
if (!existsSync(manifestPath) || !existsSync(appPath))
  throw Error('Android prebuilt project is missing');
for (const name of ['NotificationBridge.kt', 'NotificationListenerService.kt']) {
  copyFileSync(resolve(root, 'native/notifications', name), resolve(java, name));
}
let app = readFileSync(appPath, 'utf8');
if (!app.includes('add(NotificationPackage())')) {
  if (!app.includes('add(QuotaWidgetPackage())')) throw Error('Missing native package registration point');
  app = app.replace('add(QuotaWidgetPackage())', 'add(QuotaWidgetPackage())\n          add(NotificationPackage())');
  writeFileSync(appPath, app);
}
let manifest = readFileSync(manifestPath, 'utf8');
for (const name of ['POST_NOTIFICATIONS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_SPECIAL_USE']) {
  if (!manifest.includes('android.permission.' + name + '"')) {
    manifest = manifest.replace('<uses-permission android:name="android.permission.INTERNET"/>',
      '<uses-permission android:name="android.permission.INTERNET"/>\n  ' +
      '<uses-permission android:name="android.permission.' + name + '"/>');
  }
}
if (!manifest.includes('android:name=".NotificationListenerService"')) {
  if (!manifest.includes('</application>')) throw Error('Invalid Android manifest');
  manifest = manifest.replace('</application>',
    '  <service android:name=".NotificationListenerService" ' +
    'android:exported="false" android:stopWithTask="false" ' +
    'android:foregroundServiceType="specialUse">\n' +
    '    <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" ' +
    'android:value="Persistent private-network task completion listener for user-initiated Codex sessions"/>\n' +
    '  </service>\n  </application>');
}
writeFileSync(manifestPath, manifest);
console.log('Synced Android private task notification service.');
