# Assemble a deployable Windows host bundle without any Android / Expo source.
# Build the gateway first with `npm.cmd run build:gateway`.
param(
  [string]$OutputDirectory = '.tmp\mobile-host-release'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$destination = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
}
$rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd([char]92) + [char]92
if (-not $destination.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Host bundle output must be inside this checkout.'
}
if (Test-Path -LiteralPath $destination) {
  throw "Refusing to overwrite existing host bundle: $destination"
}

$sourceFiles = @(
  'Start-CodexMobile.cmd',
  'Stop-CodexMobile.cmd',
  'Login-CodexMobile.cmd',
  'scripts\mobile-app-server.ps1',
  'scripts\mobile-launcher.ps1',
  'scripts\mobile-runtime.js',
  'scripts\gateway-only.ps1',
  'scripts\install-gateway-task.ps1',
  '.env.example'
)
$gatewayDir = Join-Path $root 'dist\gateway'
$wsDir = Join-Path $root 'node_modules\ws'
if (-not (Test-Path -LiteralPath (Join-Path $gatewayDir 'main.js'))) {
  throw 'Missing compiled Gateway. Run npm.cmd run build:gateway first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $wsDir 'package.json'))) {
  throw 'Missing ws runtime module. Restore local npm dependencies first.'
}
foreach ($file in $sourceFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file))) {
    throw "Missing host runtime file: $file"
  }
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $sourceFiles) {
  $target = Join-Path $destination $file
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target -ErrorAction Stop
}
New-Item -ItemType Directory -Path (Join-Path $destination 'dist') -Force | Out-Null
Copy-Item -LiteralPath $gatewayDir -Destination (Join-Path $destination 'dist\gateway') -Recurse
$quarkHelper = Join-Path $root 'gateway\quark-transfer\cloud_transfer.py'
if (-not (Test-Path -LiteralPath $quarkHelper)) {
  throw 'Missing standalone Quark uploader helper.'
}
New-Item -ItemType Directory -Path (Join-Path $destination 'dist\gateway\quark-transfer') -Force | Out-Null
Copy-Item -LiteralPath $quarkHelper -Destination (Join-Path $destination 'dist\gateway\quark-transfer\cloud_transfer.py') -ErrorAction Stop
$sharedDir = Join-Path $root 'dist\shared'
if (Test-Path -LiteralPath $sharedDir) {
  Copy-Item -LiteralPath $sharedDir -Destination (Join-Path $destination 'dist\shared') -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $destination 'node_modules') -Force | Out-Null
Copy-Item -LiteralPath $wsDir -Destination (Join-Path $destination 'node_modules\ws') -Recurse

$wsVersion = (Get-Content (Join-Path $wsDir 'package.json') -Raw | ConvertFrom-Json).version
$appVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$package = [ordered]@{
  name = 'codex-mobile-host'
  version = $appVersion
  private = $true
  description = 'Standalone App Server and HTTPS Gateway host bundle; no mobile application sources.'
  dependencies = @{ ws = $wsVersion }
}
$package | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'package.json') -Encoding utf8
# Only the runtime-selector script is ESM. Keep dist/gateway as CommonJS.
'{"type":"module"}' | Set-Content -LiteralPath (Join-Path $destination 'scripts\package.json') -Encoding ascii

@'
CodexMobileUI Windows Host Runtime

This is a deployment-only bundle. It contains no React Native/Expo/Android source.
Prerequisite: Windows Codex Desktop installation with a complete Codex runtime,
Node.js, PowerShell, and a machine-local Tailscale Funnel setup.

1. Create a PRIVATE .env based on .env.example; never copy another host's
   MOBILE_APPROVAL_SECRET. Keep the target host's existing OAuth secret and origin.
2. For this dedicated App Server, CODEX_APP_SERVER_WS=ws://127.0.0.1:45891.
3. Start-CodexMobile.cmd starts the private App Server and authenticated Gateway.
   Check ownership and existing listeners before switching a live Gateway.
4. Login-CodexMobile.cmd authenticates the isolated Codex profile (interactive).
5. Stop-CodexMobile.cmd stops only processes owned by this bundle.

The host's .env, .state, .runtime and CODEX_HOME are NOT part of the bundle.
Never copy the Android source tree, authentication data or runtime caches.
'@ | Set-Content -LiteralPath (Join-Path $destination 'HOST-README.txt') -Encoding utf8

$manifest = Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object {
  $_.Name -ne 'MANIFEST.sha256'
} | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($destination.Length + 1).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
$manifest | Set-Content -LiteralPath (Join-Path $destination 'MANIFEST.sha256') -Encoding ascii
Write-Output "Standalone host bundle created: $destination"
Write-Output "Files: $(@($manifest).Count); ws: $wsVersion"
