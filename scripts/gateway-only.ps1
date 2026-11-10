# Mobile HTTPS gateway lifecycle. Backend lifecycle is managed independently
# by the MobileUI-owned local App Server launcher.
param(
    [ValidateSet('start', 'status', 'stop')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$gateway = Join-Path $root 'dist\gateway\main.js'
$state = Join-Path $root '.state'
$pidFile = Join-Path $state 'mobile-gateway.pid'
$port = 48888

function Get-ListeningGatewayPid {
    try {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
        if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { return 0 }
        return [int]$listeners[0].OwningProcess
    } catch {
        $pids = @()
        foreach ($line in @(netstat -ano 2>$null)) {
            if ($line -match '^\s*TCP\s+(\S+:48888)\s+\S+\s+LISTENING\s+([0-9]+)\s*$') {
                if ($Matches[1] -ne '127.0.0.1:48888') { return 0 }
                $pids += [int]$Matches[2]
            }
        }
        if ($pids.Count -ne 1) { return 0 }
        return $pids[0]
    }
}

function Get-OwnedGateway {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $idText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($idText -notmatch '^\d+$') { return $null }
    $candidate = Get-Process -Id ([int]$idText) -ErrorAction SilentlyContinue
    if (-not $candidate -or $candidate.ProcessName -ne 'node') { return $null }
    try {
        $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
        if (-not [string]::Equals([string]$candidate.Path, [string]$nodeExecutable, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$idText" -ErrorAction Stop
        if (-not $details -or [string]$details.CommandLine -notmatch [regex]::Escape($gateway)) {
            return $null
        }
    } catch {
        # Restricted CCM cannot query WMI; fail closed unless an exact PID,
        # loopback listener, Node executable and fresh owner PID file agree.
        if ([string]$_.FullyQualifiedErrorId -notmatch '0x80041003|AccessDenied|Unauthorized') { return $null }
        if (-not $nodeExecutable -or
            -not [string]::Equals([string]$candidate.Path, [string]$nodeExecutable, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        if ((Get-ListeningGatewayPid) -ne [int]$idText) { return $null }
        $recorded = (Get-Item -LiteralPath $pidFile -ErrorAction Stop).LastWriteTimeUtc
        $started = $candidate.StartTime.ToUniversalTime()
        $seconds = ($recorded - $started).TotalSeconds
        if ($seconds -lt 0 -or $seconds -gt 60) { return $null }
    }
    return $candidate
}

function Test-GatewayHealth {
    $status = & curl.exe --noproxy '*' --silent --output NUL --write-out '%{http_code}' `
        --connect-timeout 2 --max-time 3 'http://127.0.0.1:48888/health'
    return ($LASTEXITCODE -eq 0 -and $status -eq '200')
}

function Import-GatewayEnv {
    $envFile = Join-Path $root '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        throw "Missing per-host private configuration: $envFile"
    }
    $keys = @('MOBILE_PUBLIC_ORIGIN', 'MOBILE_APPROVAL_SECRET',
              'MOBILE_REDIRECT_URI', 'MOBILE_GATEWAY_PORT',
              'CODEX_APP_SERVER_WS')
    foreach ($line in (Get-Content -LiteralPath $envFile -Encoding utf8)) {
        if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { continue }
        $key = $Matches[1]
        if ($key -notin $keys) { continue }
        $value = $Matches[2].Trim()
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
    if ($env:MOBILE_PUBLIC_ORIGIN -notmatch '^https://[^/]+\.ts\.net:8443$') {
        throw 'The independent mobile gateway expects this host HTTPS Funnel origin on port 8443.'
    }
    if (-not $env:MOBILE_APPROVAL_SECRET -or
        $env:MOBILE_APPROVAL_SECRET.Length -lt 32 -or
        $env:MOBILE_APPROVAL_SECRET.StartsWith('replace-')) {
        throw 'Generate a private random mobile authorization secret of at least 32 characters.'
    }
    if ($env:CODEX_APP_SERVER_WS -ne 'ws://127.0.0.1:45891' -or
        $env:MOBILE_GATEWAY_PORT -ne '48888' -or
        $env:MOBILE_REDIRECT_URI -ne 'codexmobileui://oauth') {
        throw 'Unexpected dedicated MobileUI upstream, port or OAuth redirect configuration.'
    }
}

if ($Action -eq 'status') {
    $owner = Get-OwnedGateway
    Write-Output ("Gateway owned by this directory: " + [bool]$owner)
    Write-Output ("Gateway health: " + (Test-GatewayHealth))
    return
}
if ($Action -eq 'stop') {
    $owner = Get-OwnedGateway
    if ($owner) {
        Stop-Process -Id $owner.Id -ErrorAction Stop
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        Write-Output 'Stopped only the mobile gateway owned by this directory.'
    } else {
        Write-Output 'No owned mobile gateway to stop; other processes untouched.'
    }
    return
}
if (Get-OwnedGateway) {
    if (Test-GatewayHealth) { Write-Output 'Owned mobile gateway already healthy.'; return }
    throw 'Owned gateway is running but unhealthy; refusing to restart or adopt.'
}
if (Test-GatewayHealth) {
    throw 'Gateway port is occupied by an unknown process; refusing to adopt.'
}
if (Get-ListeningGatewayPid) {
    throw 'Gateway port is in use; refusing to overwrite its owner.'
}
if (-not (Test-Path -LiteralPath $gateway)) {
    throw "Compiled gateway is missing: $gateway"
}
Import-GatewayEnv
New-Item -ItemType Directory -Path $state -Force | Out-Null
$node = (Get-Command node.exe -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList ('"' + $gateway + '"') `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $state 'mobile-gateway.out.log') `
    -RedirectStandardError (Join-Path $state 'mobile-gateway.err.log')
Set-Content -LiteralPath $pidFile -Value ([string]$process.Id) -Encoding ascii
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    if (Test-GatewayHealth) {
        Write-Output 'Mobile gateway listening on loopback port 48888.'
        return
    }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 350
}
throw 'Mobile gateway failed to become healthy; inspect private .state logs.'
