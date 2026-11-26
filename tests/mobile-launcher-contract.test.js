import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
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

test("logon startup uses separate least-privilege orchestrator and on-demand Gateway tasks", () => {
  assert.match(gatewayTask, /New-ScheduledTaskPrincipal -UserId \$user -LogonType Interactive -RunLevel Limited/);
  assert.match(gatewayTask, /New-ScheduledTaskTrigger -AtLogOn -User \$user/);
  assert.match(gatewayTask, /\$startupTaskName = 'CodexMobileUI Startup'/);
  assert.match(gatewayTask, /-Action task-run/);
  assert.match(gatewayTask, /-Action logon/);
  assert.match(gatewayTask, /-RestartCount 3 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(gatewayTask, /Another or outdated scheduled task uses CodexMobileUI Gateway/);
  assert.match(gatewayTask, /Another or outdated scheduled task uses CodexMobileUI Startup/);
  assert.doesNotMatch(gatewayTask, /New-ScheduledTaskTrigger -(?:Once|Daily|Weekly|Monthly)/);
  assert.doesNotMatch(gatewayTask, /-Repetition/);
  const registerGateway = gatewayTask.match(/function Register-GatewayTask \{([\s\S]*?)\n\}/);
  const registerStartup = gatewayTask.match(/function Register-StartupTask \{([\s\S]*?)\n\}/);
  assert.ok(registerGateway && registerStartup);
  assert.doesNotMatch(registerGateway[1], /-Trigger/);
  assert.match(registerStartup[1], /-Trigger \$logonTrigger/);
  assert.match(gatewayTask, /if \(-not \$existingGateway\) \{ Register-GatewayTask \}\r?\nRegister-StartupTask\r?\nif \(\$existingGateway\) \{ Register-GatewayTask \}/);
  assert.match(gateway, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(gateway, /\[ValidateSet\('start', 'status', 'stop', 'task-run'\)\]/);
  assert.match(gateway, /if \(\$Action -eq 'start'\)/);
  assert.match(gateway, /Get-OwnedGateway/);
  assert.match(gateway, /Get-ListeningGatewayPid/);
  assert.match(gateway, /Test-ValidLogonTrigger/);
  assert.match(gateway, /\$taskTriggers\.Count -gt 1/);
  assert.match(gateway, /function Get-NonNullTaskTriggers/);
  assert.match(gateway, /Test-DemandGatewaySettings/);
  assert.match(gatewayTask, /function Get-NonNullTaskTriggers/);
  assert.match(gatewayTask, /Test-GatewayTaskSettings/);
  assert.match(gatewayTask, /Test-StartupTaskSettings/);
  assert.match(gatewayTask, /Assert-InstalledTaskConfiguration/);
  assert.match(gatewayTask, /@\(Get-NonNullTaskTriggers \$GatewayTask\)\.Count/);
  assert.match(gatewayTask, /@\(Get-NonNullTaskTriggers \$StartupTask\)\.Count/);
  assert.doesNotMatch(gatewayTask, /@\(\$installedGateway\.Triggers\)\.Count/);
  assert.doesNotMatch(gatewayTask, /@\(\$installedStartup\.Triggers\)\.Count/);
  assert.doesNotMatch(gatewayTask, /@\(\$\w+\.Triggers\)\.Count/);
  assert.doesNotMatch(gateway, /@\(\$\w+\.Triggers\)\.Count/);
});

test("null CIM trigger properties normalize to zero triggers and installed settings are verified", () => {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'scripts/install-gateway-task.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw $errors[0].Message }
foreach ($name in @(
  'Get-NonNullTaskTriggers',
  'Test-ScheduledDuration',
  'Test-CommonTaskSettings',
  'Test-GatewayTaskSettings',
  'Test-StartupTaskSettings',
  'Assert-InstalledTaskConfiguration')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Missing production helper: $name" }
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
$common = @{
  Enabled = $true
  AllowDemandStart = $true
  MultipleInstances = 'IgnoreNew'
  DisallowStartIfOnBatteries = $false
  StopIfGoingOnBatteries = $false
}
$gatewaySettings = [pscustomobject]($common + @{
  ExecutionTimeLimit = 'PT0S'
  RestartCount = [uint32]0
  RestartInterval = $null
  StartWhenAvailable = $false
})
$startupSettings = [pscustomobject]($common + @{
  ExecutionTimeLimit = 'PT15M'
  RestartCount = [uint32]3
  RestartInterval = 'PT1M'
  StartWhenAvailable = $true
})
$gatewayTask = [pscustomobject]@{ Triggers = $null; Settings = $gatewaySettings }
$startupTask = [pscustomobject]@{
  Triggers = @([pscustomobject]@{ UserId = 'fixture' })
  Settings = $startupSettings
}
if (@($gatewayTask.Triggers).Count -ne 1) {
  throw 'Fixture does not reproduce PowerShell null-trigger counting.'
}
if (@(Get-NonNullTaskTriggers $gatewayTask).Count -ne 0) {
  throw 'Null trigger property was not normalized to zero.'
}
if (-not (Test-GatewayTaskSettings $gatewayTask)) {
  throw 'Expected enabled on-demand settings were rejected.'
}
if (-not (Test-StartupTaskSettings $startupTask)) {
  throw 'Expected bounded retry settings were rejected.'
}
Assert-InstalledTaskConfiguration $gatewayTask $startupTask
$gatewaySettings.Enabled = $false
if (Test-GatewayTaskSettings $gatewayTask) {
  throw 'A disabled Gateway task was accepted.'
}
$gatewaySettings.Enabled = $true
$gatewaySettings.RestartCount = [uint32]1
if (Test-GatewayTaskSettings $gatewayTask) {
  throw 'Unexpected Gateway restart count was accepted.'
}
$gatewaySettings.RestartCount = [uint32]0
$startupSettings.RestartCount = [uint32]2
if (Test-StartupTaskSettings $startupTask) {
  throw 'Unexpected Startup retry count was accepted.'
}
$startupSettings.RestartCount = [uint32]3
$startupSettings.AllowDemandStart = $false
if (Test-StartupTaskSettings $startupTask) {
  throw 'A task without demand launch was accepted.'
}
$rejected = $false
try {
  Assert-InstalledTaskConfiguration $gatewayTask $startupTask
} catch {
  $rejected = $true
}
if (-not $rejected) {
  throw 'Post-install comparison accepted unexpected settings.'
}
Write-Output 'Null-trigger and settings regression passed.'
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const output = execFileSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encoded,
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.match(output, /Null-trigger and settings regression passed/);
});

test("logon orchestration starts the owned backend, waits for one verified Tailnet IPv4, then starts Gateway", () => {
  assert.match(mobileLauncher, /\[ValidateSet\('start', 'stop', 'status', 'logon'\)\]/);
  assert.match(mobileLauncher, /mobile-tailnet-hosts\.json/);
  assert.match(mobileLauncher, /\^http:\/\/100\\\.\\d\{1,3\}\\\.\\d\{1,3\}\\\.\\d\{1,3\}:48889\$/);
  assert.match(mobileLauncher, /\$network\.Name -notmatch 'tailscale'/);
  assert.match(mobileLauncher, /\$configured\.Contains\(\$address\)/);
  assert.match(mobileLauncher, /AddSeconds\(120\)/);
  assert.match(mobileLauncher, /Expected exactly one configured local Tailscale IPv4/);
  assert.doesNotMatch(mobileLauncher, /tailscale\.exe|Get-Command\s+tailscale/i);

  const startLogon = mobileLauncher.match(/function Start-LogonServices \{([\s\S]*?)\n\}/);
  assert.ok(startLogon);
  const body = startLogon[1];
  const backendStart = body.indexOf("Invoke-HostService $backendScript 'start'");
  const tailnetWait = body.indexOf("Wait-ForSingleTailnetAddress");
  const gatewayStart = body.indexOf("Invoke-HostService $gatewayScript 'start'");
  assert.ok(backendStart >= 0 && tailnetWait > backendStart && gatewayStart > tailnetWait);
  assert.match(mobileLauncher, /exit 1/);
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
