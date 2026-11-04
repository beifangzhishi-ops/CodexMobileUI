import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync(new URL("../scripts/mobile-shared-launcher.ps1", import.meta.url), "utf8");
const mobileStop = readFileSync(new URL("../Stop-CodexMobile.cmd", import.meta.url), "utf8");
const sharedStop = readFileSync(new URL("../shared-stop.cmd", import.meta.url), "utf8");
const oauthLogin = readFileSync(new URL("../src/auth/Login.tsx", import.meta.url), "utf8");
const appSettings = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const packageSettings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const androidStableBuild = readFileSync(new URL("../scripts/build-android-stable.ps1", import.meta.url), "utf8");

test("starting MobileUI ensures or hot-attaches to the shared App Server before Gateway startup", () => {
  assert.match(launcher, /Invoke-SharedStack "start"\s*\r?\n\s*Start-Gateway/);
  assert.match(launcher, /function Start-Gateway/);
});

test("normal MobileUI shutdown stops only Gateway, preserving shared backend", () => {
  const stopBranch = launcher.match(/if \(\$Action -eq "stop"\) \{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(stopBranch, "MobileUI launcher must have a dedicated stop branch");
  assert.match(stopBranch[1], /Stop-Gateway/);
  assert.doesNotMatch(stopBranch[1], /Invoke-SharedStack|Stop-Stack/);
  assert.match(mobileStop, /mobile-shared-launcher\.ps1" -Action stop/);
  assert.doesNotMatch(mobileStop, /shared-stack\.ps1|shared-stop\.cmd/);
});

test("explicit shared-stop remains an independent administrative action", () => {
  assert.match(sharedStop, /shared-stack\.ps1" -Action stop/);
});

test("mobile OAuth tap creates a fresh request instead of silently disabling its button", () => {
  assert.match(oauthLogin, /onPress=\{\(\) => \{ void authorize\(\); \}\}/);
  assert.match(oauthLogin, /new AuthSession\.AuthRequest\(/);
  assert.match(oauthLogin, /await request\.makeAuthUrlAsync\(discovery\)/);
  assert.match(oauthLogin, /await request\.promptAsync\(discovery\)/);
  assert.match(oauthLogin, /getAuthorizedCode\(result, request\.state\)/);
  assert.match(oauthLogin, /setPhase\('正在创建新的安全授权请求/);
  assert.match(oauthLogin, /setError\('系统中还有一个授权浏览器/);
  assert.doesNotMatch(oauthLogin, /AuthSession\.useAuthRequest\(/);
  assert.doesNotMatch(oauthLogin, /disabled=\{!request/);
  assert.equal(appSettings.expo.android.package, "dev.codexmobileui.app");
  assert.equal(appSettings.expo.android.versionCode, 2);
});

test("Android version metadata is consistent across Expo, npm and lockfile", () => {
  assert.equal(appSettings.expo.version, packageSettings.version);
  assert.equal(packageLock.version, packageSettings.version);
  assert.equal(packageLock.packages[""].version, packageSettings.version);
});

test("Windows stable Android build uses isolated reusable native caches and verifies the APK", () => {
  assert.match(androidStableBuild, /CodexMobileUI-AndroidBuild/);
  assert.match(androidStableBuild, /outside the source checkout/);
  assert.match(androidStableBuild, /stable-build\.lock/);
  assert.match(androidStableBuild, /Assert-AvailableLock/);
  assert.match(androidStableBuild, /Reusing installed dependencies and incremental Gradle\/CMake caches/);
  assert.match(androidStableBuild, /Get-DependencyLockContent/);
  assert.match(androidStableBuild, /node_modules\\expo-modules-autolinking\\build\\index\.js/);
  assert.match(androidStableBuild, /Start-Transcript/);
  assert.match(androidStableBuild, /versionCode=/);
  assert.match(androidStableBuild, /certificate SHA-256 digest/);
  assert.match(androidStableBuild, /android-artifacts/);
});
