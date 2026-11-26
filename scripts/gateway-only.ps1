# Mobile HTTPS gateway lifecycle. Backend lifecycle is managed independently
# by the MobileUI-owned local App Server launcher.
param(
    [ValidateSet('start', 'status', 'stop', 'task-run')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$gateway = Join-Path $root 'dist\gateway\main.js'
$state = Join-Path $root '.state'
$pidFile = Join-Path $state 'mobile-gateway.pid'
$port = 48889
$taskName = 'CodexMobileUI Gateway'

function Get-HostPowerShell {
    $pwsh = Join-Path $env:LOCALAPPDATA 'Programs\PowerShell\7\pwsh.exe'
    if (Test-Path -LiteralPath $pwsh) { return $pwsh }
    $pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $pwsh) { return $pwsh }
    throw 'PowerShell executable is unavailable.'
}

function Get-RegisteredGatewayTask {
    try {
        $tasks = @(Get-ScheduledTask -TaskName $taskName -ErrorAction Stop)
    } catch {
        if ($_.FullyQualifiedErrorId -match 'CmdletizationQuery_NotFound' -or
            $_.Exception.Message -match 'No .*ScheduledTask.*found') {
            return $null
        }
        throw ('Unable to inspect Gateway scheduled task: ' + $_.Exception.Message)
    }
    if (@($tasks | Where-Object { $_.TaskPath -ne '\' }).Count -gt 0) {
        throw 'A scheduled task with the Gateway name exists outside the root task folder.'
    }
    if ($tasks.Count -eq 0) { return $null }
    if ($tasks.Count -ne 1) { throw 'More than one Gateway scheduled task was found.' }
    return $tasks[0]
}

function Get-NonNullTaskTriggers($Task) {
    return @($Task.Triggers | Where-Object { $null -ne $_ })
}

function Test-CurrentUser([string]$UserId) {
    if ([string]::IsNullOrWhiteSpace($UserId)) { return $false }
    if ($UserId -match '^S-\d-\d+(?:-\d+)+$') {
        return [string]::Equals($UserId,
            [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
            [StringComparison]::OrdinalIgnoreCase)
    }
    try {
        $sid = ([System.Security.Principal.NTAccount]$UserId).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        return $sid -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    } catch {
        return [string]::Equals($UserId,
            [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
            [StringComparison]::OrdinalIgnoreCase)
    }
}

function Test-ValidLogonTrigger($Trigger) {
    $className = ''
    if ($Trigger.CimClass) { $className = [string]$Trigger.CimClass.CimClassName }
    if ($className -ne 'MSFT_TaskLogonTrigger') { return $false }
    if (-not (Test-CurrentUser ([string]$Trigger.UserId))) { return $false }
    $interval = ''
    if ($Trigger.Repetition) { $interval = [string]$Trigger.Repetition.Interval }
    return [string]::IsNullOrWhiteSpace($interval)
}

function Test-ScheduledDuration($Value, [TimeSpan]$Expected, [switch]$AllowEmptyAsZero) {
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ($AllowEmptyAsZero -and $Expected -eq [TimeSpan]::Zero)
    }
    try {
        return [System.Xml.XmlConvert]::ToTimeSpan($text) -eq $Expected
    } catch {
        return $false
    }
}

function Test-DemandGatewaySettings($Task) {
    $settings = $Task.Settings
    return ([bool]$settings.Enabled -and
        [bool]$settings.AllowDemandStart -and
        [string]$settings.MultipleInstances -eq 'IgnoreNew' -and
        (Test-ScheduledDuration $settings.ExecutionTimeLimit ([TimeSpan]::Zero)) -and
        $null -ne $settings.RestartCount -and
        [uint32]$settings.RestartCount -eq 0 -and
        (Test-ScheduledDuration $settings.RestartInterval ([TimeSpan]::Zero) -AllowEmptyAsZero) -and
        -not [bool]$settings.StartWhenAvailable -and
        -not [bool]$settings.DisallowStartIfOnBatteries -and
        -not [bool]$settings.StopIfGoingOnBatteries)
}

function Get-ListeningGatewayPid {
    try {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalAddress -eq '127.0.0.1' })
        if ($listeners.Count -ne 1) { return 0 }
        return [int]$listeners[0].OwningProcess
    } catch {
        $pids = @()
        foreach ($line in @(netstat -ano 2>$null)) {
            if ($line -match '^\s*TCP\s+(127\.0\.0\.1:(?:48888|48889))\s+\S+\s+LISTENING\s+([0-9]+)\s*$') {
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
        --connect-timeout 2 --max-time 3 'http://127.0.0.1:48889/health'
    return ($LASTEXITCODE -eq 0 -and $status -eq '200')
}

function Import-GatewayEnv {
    $envFile = Join-Path $root '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        throw "Missing per-host private configuration: $envFile"
    }
    $keys = @('CODEX_APP_SERVER_WS', 'MOBILE_PROJECT_ROOTS',
              'MOBILE_PRIVATE_GATEWAY_PORT')
    foreach ($line in (Get-Content -LiteralPath $envFile -Encoding utf8)) {
        if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { continue }
        $key = $Matches[1]
        if ($key -notin $keys) { continue }
        $value = $Matches[2].Trim()
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
    if ($env:CODEX_APP_SERVER_WS -ne 'ws://127.0.0.1:45891' -or
        ($env:MOBILE_PRIVATE_GATEWAY_PORT -and $env:MOBILE_PRIVATE_GATEWAY_PORT -ne '48889')) {
        throw 'Unexpected dedicated MobileUI upstream or private port configuration.'
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
if ($Action -eq 'start') {
    $owner = Get-OwnedGateway
    if ($owner) {
        if (Test-GatewayHealth) { Write-Output 'Owned mobile gateway already healthy.'; return }
        throw 'Owned gateway is running but unhealthy; refusing to restart or adopt.'
    }
    if (Test-GatewayHealth -or (Get-ListeningGatewayPid)) {
        throw 'Gateway port is occupied by an unknown process; refusing to adopt.'
    }
    $task = Get-RegisteredGatewayTask
    if (-not $task) { throw 'Gateway scheduled task is not installed; run scripts/install-gateway-task.ps1 first.' }
    if (-not [bool]$task.Settings.Enabled) {
        throw 'Gateway scheduled task is disabled; rerun scripts/install-gateway-task.ps1.'
    }
    $expectedScript = Join-Path $PSScriptRoot 'gateway-only.ps1'
    $taskActions = @($task.Actions)
    if ($taskActions.Count -ne 1) {
        throw 'Gateway scheduled task definition differs from this checkout; refusing to launch.'
    }
    $taskAction = $taskActions[0]
    $taskTriggers = @(Get-NonNullTaskTriggers $task)
    if (-not [string]::Equals([string]$taskAction.Arguments,
            ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $expectedScript + '" -Action task-run'),
            [StringComparison]::Ordinal) -or
        -not [string]::Equals([string]$taskAction.Execute, (Get-HostPowerShell), [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([string]$taskAction.WorkingDirectory, $root, [StringComparison]::OrdinalIgnoreCase) -or
        $task.Principal.LogonType -ne 'Interactive' -or
        $task.Principal.RunLevel -ne 'Limited' -or
        -not (Test-CurrentUser ([string]$task.Principal.UserId)) -or
        -not (Test-DemandGatewaySettings $task) -or
        $taskTriggers.Count -gt 1 -or
        ($taskTriggers.Count -eq 1 -and -not (Test-ValidLogonTrigger $taskTriggers[0]))) {
        throw 'Gateway scheduled task definition differs from this checkout; refusing to launch.'
    }
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (Get-OwnedGateway -and (Test-GatewayHealth)) {
            Write-Output 'Mobile gateway started by Windows Task Scheduler on loopback port 48889.'
            return
        }
        Start-Sleep -Milliseconds 350
    }
    throw 'Gateway scheduled task did not start a healthy owned process.'
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
        Write-Output 'Mobile gateway listening on loopback port 48889.'
        return
    }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 350
}
throw 'Mobile gateway failed to become healthy; inspect private .state logs.'
