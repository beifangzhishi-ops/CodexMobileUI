// Keep the Android non-destructive Back action after regenerating Expo sources.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const java = resolve(root, 'android/app/src/main/java/dev/codexmobileui/app');
const appPath = resolve(java, 'MainApplication.kt');
if (!existsSync(appPath)) throw Error('Missing native Android application');
copyFileSync(resolve(root, 'native/navigation/AppNavigationModule.kt'),
  resolve(java, 'AppNavigationModule.kt'));
let app = readFileSync(appPath, 'utf8');
if (!app.includes('add(AppNavigationPackage())')) {
  if (!app.includes('add(QuotaWidgetPackage())')) throw Error('Missing native package registration point');
  app = app.replace('add(QuotaWidgetPackage())',
    'add(QuotaWidgetPackage())\n          add(AppNavigationPackage())');
  writeFileSync(appPath, app);
}
console.log('Synced non-destructive Android back navigation.');
