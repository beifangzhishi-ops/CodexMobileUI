// Sync ignored Expo-prebuilt Android metadata without regenerating native caches.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;
const gradlePath = resolve(root, 'android', 'app', 'build.gradle');
let source = readFileSync(gradlePath, 'utf8');
const expectedPackage = 'dev.codexmobileui.app';
const packageMatches = [...source.matchAll(/^\s*applicationId\s+['"]([^'"]+)['"]\s*$/gm)];
const codeMatches = [...source.matchAll(/^(\s*versionCode\s+)(\d+)\s*$/gm)];
const nameMatches = [...source.matchAll(/^(\s*versionName\s+)"([^"]+)"\s*$/gm)];
if (packageMatches.length !== 1 || packageMatches[0][1] !== expectedPackage ||
    codeMatches.length !== 1 || nameMatches.length !== 1 ||
    app.android.package !== expectedPackage ||
    !Number.isSafeInteger(app.android.versionCode) || app.android.versionCode < 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(app.version)) {
  throw new Error('Native Android Gradle metadata does not match expected Expo identity/format');
}
const currentVersion = nameMatches[0][1];
const currentCode = Number(codeMatches[0][2]);
if (currentCode !== app.android.versionCode || currentVersion !== app.version) {
  source = source.replace(/^(\s*versionCode\s+)\d+\s*$/m,
    (_match, prefix) => prefix + app.android.versionCode);
  source = source.replace(/^(\s*versionName\s+)"[^"]+"\s*$/m,
    (_match, prefix) => prefix + '"' + app.version + '"');
  writeFileSync(gradlePath, source, 'utf8');
  console.log('Synced ignored Android Gradle version to ' + app.version + ' (' + app.android.versionCode + ').');
}
