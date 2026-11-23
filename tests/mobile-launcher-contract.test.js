import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const appServer = readFileSync(new URL("../scripts/mobile-app-server.ps1", import.meta.url), "utf8");
const mobileLauncher = readFileSync(new URL("../scripts/mobile-launcher.ps1", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../scripts/gateway-only.ps1", import.meta.url), "utf8");
const gatewayTask = readFileSync(new URL("../scripts/install-gateway-task.ps1", import.meta.url), "utf8");
const gatewayMain = readFileSync(new URL("../gateway/main.ts", import.meta.url), "utf8");
const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../scripts/mobile-runtime.js", import.meta.url), "utf8");

test("MobileUI uses a dedicated CODEX_HOME and never modifies persistent user environment", () => {
  assert.match(appServer, /Join-Path \$env:LOCALAPPDATA 'CodexMobileUI\\CodexHome'/);
  assert.match(appServer, /\$env:CODEX_HOME = \$homeRoot/);
  assert.match(appServer, /Assert-IsolatedHome/);
  assert.doesNotMatch(appServer, /SetEnvironmentVariable\([^)]*,\s*'User'|SetEnvironmentVariable\([^)]*,\s*'Machine'/);
  assert.doesNotMatch(appServer, /Join-Path \$HOME '\.codex'|Copy-Item.*auth\.json/i);
});

test("MobileUI selects only complete Codex Desktop runtime packages and copies them", () => {
  assert.match(appServer, /OpenAI\\Codex\\bin/);
  assert.match(appServer, /Get-AppxPackage -Name 'OpenAI\.Codex'/);
  assert.match(runtime, /export const requiredFiles/);
  assert.match(runtime, /prepareRuntime\(result\.selected, request\.runtimeRoot\)/);
  assert.doesNotMatch(appServer, /\.vscode|extensions\\openai|codex legacy/i);
});

test("App Server and Gateway use one private fixed port, no shared upstream", () => {
  assert.match(appServer, /'ws:\/\/127\.0\.0\.1:45891'/);
  assert.match(appServer, /@\(.*'app-server'.*'--listen'.*\$listenUrl.*\)/);
  assert.match(gateway, /'ws:\/\/127\.0\.0\.1:45891'/);
  assert.match(gatewayMain, /ws:\/\/127\.0\.0\.1:45891/);
  assert.match(env, /CODEX_APP_SERVER_WS=ws:\/\/127\.0\.0\.1:45891/);
});

test("launcher stops only verified processes owned by MobileUI", () => {
  assert.match(appServer, /Get-OwnedBackend/);
  assert.match(appServer, /Get-CimInstance Win32_Process/);
  assert.match(appServer, /Get-ListeningPid/);
  assert.match(appServer, /GetFullPath\(\$runtimeRoot\)/);
  assert.match(appServer, /Global\\CodexMobileUI_AppServer_45891/);
  assert.match(appServer, /Get-ListeningPid\) -ne \$id/);
  assert.match(appServer, /LastWriteTimeUtc/);
  assert.match(appServer, /TotalSeconds/);
  assert.match(appServer, /0x80041003/);
  assert.match(mobileLauncher, /Invoke-HostService \$gatewayScript 'stop'/);
  assert.match(mobileLauncher, /Invoke-HostService \$backendScript 'stop'/);
  assert.doesNotMatch(mobileLauncher, /hot.attach/i);
});

test("Gateway ownership also checks loopback PID and birth time if CIM access is denied", () => {
  assert.match(gateway, /Get-ListeningGatewayPid/);
  assert.match(gateway, /LastWriteTimeUtc/);
  assert.match(gateway, /TotalSeconds/);
  assert.match(gateway, /0x80041003/);
  assert.match(gateway, /Get-Command node.exe/);
});

test("Gateway starts via an interactive least-privilege Windows task, not a CCM child process", () => {
  assert.match(gatewayTask, /New-ScheduledTaskPrincipal -UserId \$user -LogonType Interactive -RunLevel Limited/);
  assert.match(gatewayTask, /New-ScheduledTaskTrigger -AtLogOn -User \$user/);
  assert.match(gatewayTask, /-Action task-run/);
  assert.match(gatewayTask, /Another or outdated scheduled task uses this name/);
  assert.match(gateway, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(gateway, /\[ValidateSet\('start', 'status', 'stop', 'task-run'\)\]/);
  assert.match(gateway, /if \(\$Action -eq 'start'\)/);
  assert.match(gateway, /Get-OwnedGateway/);
  assert.match(gateway, /Get-ListeningGatewayPid/);
});

test("independent Codex sign-in uses the dedicated home without copying another profile", () => {
  assert.match(appServer, /& \$kernel login --device-auth/);
  assert.ok(existsSync(new URL("../Login-CodexMobile.cmd", import.meta.url)));
  assert.doesNotMatch(appServer, /auth\.json|Join-Path\s+\$env:USERPROFILE\s+['"]\.codex|Copy-Item/i);
});

test("launcher commands resolve only this application's backend and Gateway", () => {
  assert.match(mobileLauncher, /mobile-app-server\.ps1/);
  assert.match(mobileLauncher, /gateway-only\.ps1/);
  assert.ok(existsSync(new URL("../Start-CodexMobile.cmd", import.meta.url)));
  assert.ok(existsSync(new URL("../Stop-CodexMobile.cmd", import.meta.url)));
});
