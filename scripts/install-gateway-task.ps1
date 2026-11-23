# Register a least-privilege, interactive-user Gateway launcher outside CCM's
# restricted child-process token. Registration does not stop a running Gateway.
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'gateway-only.ps1'
$taskName = 'CodexMobileUI Gateway'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$pwsh = Join-Path $env:LOCALAPPDATA 'Programs\PowerShell\7\pwsh.exe'
if (-not (Test-Path -LiteralPath $pwsh)) {
    $pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
}
if (-not (Test-Path -LiteralPath $pwsh)) { throw 'PowerShell executable is unavailable.' }

$action = New-ScheduledTaskAction -Execute $pwsh `
    -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '" -Action task-run') `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    $actions = @($existing.Actions)
    $userMatches = $false
    try {
        $taskUserSid = ([System.Security.Principal.NTAccount]$existing.Principal.UserId).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        $userMatches = $taskUserSid -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    } catch { $userMatches = $false }
    if ($existing.TaskPath -ne '\' -or $actions.Count -ne 1 -or
        $actions[0].Execute -ne $pwsh -or
        $actions[0].Arguments -ne $action.Arguments -or
        $actions[0].WorkingDirectory -ne $root -or
        -not $userMatches -or
        $existing.Principal.RunLevel -ne 'Limited' -or
        $existing.Principal.LogonType -ne 'Interactive') {
        throw 'Another or outdated scheduled task uses this name; refusing to overwrite.'
    }
    Write-Output 'Existing user-owned Gateway scheduled task is correctly configured.'
    return
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Starts the CodexMobileUI Gateway at user logon or on demand with normal user privileges.' | Out-Null
Write-Output 'Installed least-privilege CodexMobileUI Gateway scheduled task.'
