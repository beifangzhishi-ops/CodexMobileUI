param(
  [ValidateSet("start", "status", "stop")]
  [string]$Action = "start",
  [switch]$Desktop
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stack = Join-Path $PSScriptRoot "shared-stack.ps1"
$gatewayJs = Join-Path $root "dist\gateway\main.js"
$stateDir = Join-Path $root ".state"
$gatewayPidFile = Join-Path $stateDir "mobile-gateway.pid"
$gatewayOut = Join-Path $stateDir "mobile-gateway.out.log"
$gatewayErr = Join-Path $stateDir "mobile-gateway.err.log"
$gatewayPort = 48888
$gatewayHealth = "http://127.0.0.1:$gatewayPort/health"
$shell = (Get-Process -Id $PID).Path

function Read-OwnerPid {
  if (-not (Test-Path -LiteralPath $gatewayPidFile)) { return 0 }
  $raw = (Get-Content -LiteralPath $gatewayPidFile -Raw).Trim()
  if ($raw -match "^\d+$") { return [int]$raw }
  return 0
}

function Get-GatewayProcess {
  $processId = Read-OwnerPid
  if (-not $processId) { return $null }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne "node") { return $null }
  try {
    $commandLine = [string](Get-CimInstance Win32_Process -Filter ("ProcessId=" + $processId)).CommandLine
    if ($commandLine.IndexOf($gatewayJs, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
  } catch { return $null }
  return $process
}

function Test-GatewayHealth {
  try {
    $code = & curl.exe --noproxy "*" --connect-timeout 2 --max-time 3 -s -o NUL -w "%{http_code}" $gatewayHealth
    return ($LASTEXITCODE -eq 0 -and $code -eq "200")
  } catch { return $false }
}

function Test-GatewayPortOccupied {
  try {
    return @((Get-NetTCPConnection -State Listen -LocalPort $gatewayPort -ErrorAction Stop)).Count -gt 0
  } catch {
    return ((netstat -ano 2>$null | Select-String (":$gatewayPort\s+.*LISTENING")).Count -gt 0)
  }
}

function Read-GatewayConfiguration {
  $keys = @("MOBILE_PUBLIC_ORIGIN", "MOBILE_APPROVAL_SECRET", "MOBILE_REDIRECT_URI", "MOBILE_GATEWAY_PORT", "CODEX_APP_SERVER_WS")
  $envFile = Join-Path $root ".env"
  if (Test-Path -LiteralPath $envFile) {
    foreach ($line in (Get-Content -LiteralPath $envFile -Encoding utf8)) {
      if ($line -notmatch "^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$") { continue }
      $name = $matches[1]
      if ($name -notin $keys) { continue }
      if ([Environment]::GetEnvironmentVariable($name, "Process")) { continue }
      $value = $matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
  if (-not $env:MOBILE_PUBLIC_ORIGIN -or -not $env:MOBILE_PUBLIC_ORIGIN.StartsWith("https://")) {
    throw "Set MOBILE_PUBLIC_ORIGIN to the HTTPS Funnel origin in a local .env file."
  }
  if (-not $env:MOBILE_APPROVAL_SECRET -or $env:MOBILE_APPROVAL_SECRET.Length -lt 24) {
    throw "Set MOBILE_APPROVAL_SECRET to a random local secret of at least 24 characters."
  }
  if ($env:MOBILE_GATEWAY_PORT -and $env:MOBILE_GATEWAY_PORT -ne "48888") {
    throw "This launcher requires the standard loopback Gateway port 48888."
  }
  $env:MOBILE_GATEWAY_PORT = "48888"
  if (-not $env:CODEX_APP_SERVER_WS) { $env:CODEX_APP_SERVER_WS = "ws://127.0.0.1:45789" }
  if ($env:CODEX_APP_SERVER_WS -ne "ws://127.0.0.1:45789") {
    throw "This shared launcher requires CODEX_APP_SERVER_WS=ws://127.0.0.1:45789."
  }
}

function Invoke-SharedStack([string]$Operation) {
  & $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $stack -Action $Operation -NoGui
  if ($LASTEXITCODE -ne 0) { throw "Shared stack $Operation failed ($LASTEXITCODE)." }
}

function Start-Gateway {
  $owned = Get-GatewayProcess
  if ($owned -and (Test-GatewayHealth)) {
    Write-Host "Gateway already owned and healthy (PID $($owned.Id))."
    return
  }
  if (Test-GatewayHealth) {
    throw "A different Gateway is already listening on 48888. No attempt to take ownership."
  }
  if ($owned) { throw "Owned Gateway is running but unhealthy. Stop it explicitly before restarting." }
  if (Test-GatewayPortOccupied) { throw "Gateway port 48888 is occupied by an unverified process." }
  if (-not (Test-Path -LiteralPath $gatewayJs)) { throw "Gateway build missing: $gatewayJs" }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $process = Start-Process -FilePath $node -ArgumentList ('"' + $gatewayJs + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $gatewayOut -RedirectStandardError $gatewayErr
  Set-Content -LiteralPath $gatewayPidFile -Value ([string]$process.Id) -Encoding ascii
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if (Test-GatewayHealth) {
      Write-Host "CodexMobileUI Gateway started (PID $($process.Id), loopback 48888)."
      return
    }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 400
  }
  throw "Gateway did not become healthy; inspect the local Gateway error log."
}

function Stop-Gateway {
  $owned = Get-GatewayProcess
  if ($owned) {
    Stop-Process -Id $owned.Id -ErrorAction Stop
    Remove-Item -LiteralPath $gatewayPidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped the Gateway owned by this checkout."
  } else {
    Write-Host "No Gateway owned by this checkout; other processes are untouched."
  }
}

try {
  if ($Action -eq "status") {
    Invoke-SharedStack "status"
    Write-Host ("Gateway healthy: " + (Test-GatewayHealth))
    exit 0
  }
  # Shared stack has its own cross-repository lock. Gateway ownership is separate.
  $mutex = [System.Threading.Mutex]::new($false, "Global\CodexMobileGateway_48888")
  $locked = $false
  try {
    try { $locked = $mutex.WaitOne(60000) }
    catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw "Timed out acquiring the Gateway startup lock." }
    if ($Action -eq "stop") {
      Stop-Gateway
      Write-Host "Shared App Server left running for AOI, Desktop and other mobile clients."
    } else {
      Read-GatewayConfiguration
      Invoke-SharedStack "start"
      Start-Gateway
      if ($Desktop) {
        & $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "Start-Codex-Shared-Proxy.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Desktop launch failed." }
      }
    }
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
  exit 0
} catch {
  Write-Host ("[CodexMobileUI launcher] " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
