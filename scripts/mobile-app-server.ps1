param(
  [ValidateSet('start', 'status', 'stop', 'login')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$homeRoot = Join-Path $env:LOCALAPPDATA 'CodexMobileUI\CodexHome'
$runtimeRoot = Join-Path $root '.runtime\mobile'
$runtimeScript = Join-Path $PSScriptRoot 'mobile-runtime.js'
$stateDir = Join-Path $root '.state'
$pidFile = Join-Path $stateDir 'mobile-app-server.pid'
$logOut = Join-Path $stateDir 'mobile-app-server.out.log'
$logErr = Join-Path $stateDir 'mobile-app-server.err.log'
$listenUrl = 'ws://127.0.0.1:45891'
$readyUrl = 'http://127.0.0.1:45891/readyz'
$mutexName = 'Global\CodexMobileUI_AppServer_45891'

function Read-OwnerPid {
  if (-not (Test-Path -LiteralPath $pidFile)) { return 0 }
  $raw = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($raw -match '^[0-9]+$') { return [int]$raw }
  return 0
}

function Get-ListeningPid {
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 45891 -ErrorAction Stop)
    if ($listeners.Count -ne 1) { return 0 }
    return [int]$listeners[0].OwningProcess
  } catch {
    $ids = @()
    foreach ($line in @(netstat -ano 2>$null)) {
      if ($line -match '127\.0\.0\.1:45891\s+.*LISTENING\s+([0-9]+)') {
        $ids += [int]$Matches[1]
      }
    }
    if ($ids.Count -ne 1) { return 0 }
    return $ids[0]
  }
}

function Get-OwnedBackend {
  $id = Read-OwnerPid
  if (-not $id) { return $null }
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p -or $p.ProcessName -ne 'codex') { return $null }
  $actual = [string]$p.Path
  $prefix = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd([char]92) + [char]92
  if (-not $actual.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  $details = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $id) -ErrorAction SilentlyContinue
  if (-not $details) { return $null }
  $cmd = [string]$details.CommandLine
  if ($cmd -notmatch 'app-server' -or
      $cmd.IndexOf($listenUrl, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $null
  }
  return $p
}

function Test-BackendReady {
  $status = & curl.exe --noproxy '*' --silent --output NUL --write-out '%{http_code}' --connect-timeout 2 --max-time 3 $readyUrl
  return ($LASTEXITCODE -eq 0 -and $status -eq '200')
}

function Assert-IsolatedHome {
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CodexMobileUI\CodexHome'))
  if ([IO.Path]::GetFullPath($homeRoot) -ne $expected) { throw 'Unexpected private Codex data directory' }
  $parent = Split-Path -Parent $homeRoot
  foreach ($path in @($parent, $homeRoot)) {
    if (Test-Path -LiteralPath $path) {
      $item = Get-Item -LiteralPath $path -Force
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Private Codex data directory contains a link or a non-directory'
      }
    }
  }
}

function Select-DesktopKernel {
  if (-not (Test-Path -LiteralPath $runtimeScript)) {
    throw 'MobileUI runtime selector is missing'
  }
  $candidates = @()
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
  $candidates += @(
    Get-ChildItem -LiteralPath $cacheRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName 'codex.exe') -ErrorAction SilentlyContinue } |
      Where-Object { $_ -and $_.Exists } |
      Select-Object -ExpandProperty FullName
  )
  try {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |
      Sort-Object Version -Descending | Select-Object -First 1
    if ($package -and (Test-Path -LiteralPath $package.InstallLocation)) {
      $candidate = Join-Path $package.InstallLocation 'app\resources\codex.exe'
      if (Test-Path -LiteralPath $candidate) { $candidates = @($candidate) + $candidates }
    }
  } catch { }
  $request = @{
    candidates = @{ desktop = @($candidates | Select-Object -Unique) }
    runtimeRoot = $runtimeRoot
  } | ConvertTo-Json -Depth 5 -Compress
  $reportText = $request | & node.exe $runtimeScript 'prepare'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot locate or stage a complete Codex Desktop kernel' }
  $report = $reportText | ConvertFrom-Json
  if (-not $report.prepared -or -not $report.prepared.executable) {
    throw 'Desktop installation does not provide a complete Codex runtime'
  }
  return [string]$report.prepared.executable
}

function Set-CodexNetworkEnvironment {
  # Use inherited proxy settings first. Otherwise read the current Windows
  # user's ordinary system proxy. Never change machine/user environment.
  if (-not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY) {
    try {
      $settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
      if ([int]$settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
        $proxy = [string]$settings.ProxyServer
        if ($proxy -notmatch '=') {
          if ($proxy -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $proxy = 'http://' + $proxy }
          $env:HTTP_PROXY = $proxy
          $env:HTTPS_PROXY = $proxy
          $env:ALL_PROXY = $proxy
        }
      }
    } catch { }
  }
  if (-not $env:NO_PROXY) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }
}

function Start-Backend {
  Assert-IsolatedHome
  $owner = Get-OwnedBackend
  $listener = Get-ListeningPid
  if ($owner -and $listener -eq $owner.Id -and (Test-BackendReady)) {
    Write-Output 'MobileUI App Server already owned and healthy.'
    return
  }
  if ($owner) { throw 'Owned MobileUI App Server is unhealthy; stop it explicitly before restarting' }
  if ($listener -or (Test-BackendReady)) {
    throw 'Dedicated MobileUI port is in use; do not adopt or stop an unknown process'
  }
  $kernel = Select-DesktopKernel
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  New-Item -ItemType Directory -Path $homeRoot -Force | Out-Null
  $env:CODEX_HOME = $homeRoot
  Set-CodexNetworkEnvironment
  $process = Start-Process -FilePath $kernel -ArgumentList @('app-server', '--listen', $listenUrl) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
  Set-Content -LiteralPath $pidFile -Value ([string]$process.Id) -Encoding ascii
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ((Get-ListeningPid) -eq $process.Id -and (Test-BackendReady) -and (Get-OwnedBackend)) {
      Write-Output ('MobileUI isolated App Server started; PID=' + $process.Id)
      return
    }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 400
  }
  throw 'MobileUI App Server did not become healthy; inspect its local error log'
}

function Stop-Backend {
  $owner = Get-OwnedBackend
  if (-not $owner) {
    Write-Output 'No owned MobileUI App Server to stop; other processes untouched.'
    return
  }
  Stop-Process -Id $owner.Id -ErrorAction Stop
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Output 'Stopped only the MobileUI-owned App Server.'
}

function Show-Status {
  $owner = Get-OwnedBackend
  $listener = Get-ListeningPid
  Write-Output ('MobileUI App Server owned: ' + [bool]($owner -and $listener -eq $owner.Id))
  Write-Output ('MobileUI App Server ready: ' + (Test-BackendReady))
  Write-Output ('MobileUI CODEX_HOME: ' + $homeRoot)
}

if ($Action -eq 'status') { Show-Status; exit 0 }
$mutex = [Threading.Mutex]::new($false, $mutexName)
$locked = $false
try {
  try { $locked = $mutex.WaitOne(60000) }
  catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Timed out acquiring dedicated MobileUI App Server lock' }
  switch ($Action) {
    'start' { Start-Backend }
    'stop' { Stop-Backend }
    'login' {
      Assert-IsolatedHome
      $kernel = Select-DesktopKernel
      New-Item -ItemType Directory -Path $homeRoot -Force | Out-Null
      $env:CODEX_HOME = $homeRoot
      Set-CodexNetworkEnvironment
      & $kernel login --device-auth
      if ($LASTEXITCODE -ne 0) { throw 'Private MobileUI Codex login failed' }
    }
  }
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
