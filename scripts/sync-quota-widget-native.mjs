// Preserve the Android quota widget when Expo regenerates the ignored native tree.
// No additional permissions, third-party services, or network accesses.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'android/app');
const source = resolve(root, 'native/quota-widget');
const files = [
  ['QuotaWidgetProvider.kt', 'src/main/java/dev/codexmobileui/app/QuotaWidgetProvider.kt'],
  ['QuotaWidgetModule.kt', 'src/main/java/dev/codexmobileui/app/QuotaWidgetModule.kt'],
  ['QuotaWidgetPinActivity.kt', 'src/main/java/dev/codexmobileui/app/QuotaWidgetPinActivity.kt'],
  ['quota_widget.xml', 'src/main/res/layout/quota_widget.xml'],
  ['quota_widget_background.xml', 'src/main/res/drawable/quota_widget_background.xml'],
  ['quota_widget_info.xml', 'src/main/res/xml/quota_widget_info.xml'],
  ['quota_widget_shortcuts.xml', 'src/main/res/xml/quota_widget_shortcuts.xml'],
  ['quota_widget_strings.xml', 'src/main/res/values/quota_widget_strings.xml'],
];
const manifestPath = resolve(app, 'src/main/AndroidManifest.xml');
const applicationPath = resolve(app, 'src/main/java/dev/codexmobileui/app/MainApplication.kt');
if (!existsSync(manifestPath) || !existsSync(applicationPath)) {
  throw new Error('Android prebuilt project is missing; run Expo prebuild before syncing quota widget');
}
for (const [src, dst] of files) {
  const full = resolve(app, dst);
  mkdirSync(dirname(full), { recursive: true });
  copyFileSync(resolve(source, src), full);
}
let manifest = readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android:name=".QuotaWidgetProvider"')) {
  if (!manifest.includes('</application>')) throw new Error('Could not locate Android application element');
  manifest = manifest.replace('</application>', `  <receiver android:name=".QuotaWidgetProvider" android:exported="true">
      <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
      <meta-data android:name="android.appwidget.provider" android:resource="@xml/quota_widget_info"/>
    </receiver>
  </application>`);
  writeFileSync(manifestPath, manifest);
}
if (!manifest.includes('android:name=".QuotaWidgetPinActivity"') ||
    !manifest.includes('android.app.shortcuts')) {
  manifest = readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android:name=".QuotaWidgetPinActivity"')) {
    if (!manifest.includes('</application>')) throw new Error('Missing Android application element');
    manifest = manifest.replace('</application>', `  <activity android:name=".QuotaWidgetPinActivity"
      android:exported="true" android:excludeFromRecents="true"
      android:noHistory="true" android:theme="@android:style/Theme.Translucent.NoTitleBar"/>
  </application>`);
  }
  if (!manifest.includes('android.app.shortcuts')) {
    const mainActivity = /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)([\s\S]*?)(<\/activity>)/;
    if (!mainActivity.test(manifest)) throw new Error('Missing launcher MainActivity for app shortcuts');
    manifest = manifest.replace(mainActivity,
      (_full, open, inner, close) => `${open}${inner}      <meta-data android:name="android.app.shortcuts"
        android:resource="@xml/quota_widget_shortcuts"/>
    ${close}`);
  }
  writeFileSync(manifestPath, manifest);
}
let application = readFileSync(applicationPath, 'utf8');
if (!application.includes('add(QuotaWidgetPackage())')) {
  const marker = '// add(MyReactNativePackage())';
  if (!application.includes(marker)) throw new Error('Could not locate React package insertion point');
  application = application.replace(marker, `${marker}\n          add(QuotaWidgetPackage())`);
  writeFileSync(applicationPath, application);
}
console.log('Synced native Android 2x1 quota widget.');
