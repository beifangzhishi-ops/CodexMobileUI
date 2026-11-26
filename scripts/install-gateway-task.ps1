# Install the two least-privilege Windows tasks used by CodexMobileUI.
# The independent logon task starts the private App Server and then asks the
# on-demand Gateway task to start. Registration does not start either task.
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$gatewayLauncher = Join-Path $PSScriptRoot 'gateway-only.ps1'
$mobileLauncher = Join-Path $PSScriptRoot 'mobile-launcher.ps1'
$gatewayTaskName = 'CodexMobileUI Gateway'
$startupTaskName = 'CodexMobileUI Startup'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$pwsh = Join-Path $env:LOCALAPPDATA 'Programs\PowerShell\7\pwsh.exe'
if (-not (Test-Path -LiteralPath $pwsh)) {
    $pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
}
if (-not (Test-Path -LiteralPath $pwsh)) { throw 'PowerShell executable is unavailable.' }

function Get-RootTask([string]$Name) {
    try {
        $tasks = @(Get-ScheduledTask -TaskName $Name -ErrorAction Stop)
    } catch {
        if ($_.FullyQualifiedErrorId -match 'CmdletizationQuery_NotFound' -or
            $_.Exception.Message -match 'No .*ScheduledTask.*found') {
            return $null
        }
        throw ('Unable to inspect scheduled task "' + $Name + '": ' + $_.Exception.Message)
    }
    $mismatched = @($tasks | Where-Object { $_.TaskPath -ne '\' })
    if ($mismatched.Count -gt 0) {
        throw ('A scheduled task named "' + $Name + '" exists outside the root task folder; refusing to continue.')
    }
    if ($tasks.Count -eq 0) { return $null }
    if ($tasks.Count -ne 1) {
        throw ('More than one scheduled task named "' + $Name + '" was found; refusing to continue.')
    }
    return $tasks[0]
}

function Get-NonNullTaskTriggers($Task) {
    return @($Task.Triggers | Where-Object { $null -ne $_ })
}

function Test-UserIdMatchesCurrent([string]$UserId) {
    if ([string]::IsNullOrWhiteSpace($UserId)) { return $false }
    if ($UserId -match '^S-\d-\d+(?:-\d+)+$') {
        return [string]::Equals($UserId, $currentSid, [StringComparison]::OrdinalIgnoreCase)
    }
    try {
        $sid = ([System.Security.Principal.NTAccount]$UserId).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        return $sid -eq $currentSid
    } catch {
        return [string]::Equals($UserId, $user, [StringComparison]::OrdinalIgnoreCase)
    }
}

function Test-TaskPrincipal($Task) {
    return ($Task.Principal.RunLevel -eq 'Limited' -and
        $Task.Principal.LogonType -eq 'Interactive' -and
        (Test-UserIdMatchesCurrent ([string]$Task.Principal.UserId)))
}

function Test-TaskAction($Task, [string]$Arguments) {
    $actions = @($Task.Actions)
    return ($actions.Count -eq 1 -and
        [string]::Equals([string]$actions[0].Execute, $pwsh, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$actions[0].Arguments, $Arguments, [StringComparison]::Ordinal) -and
        [string]::Equals([string]$actions[0].WorkingDirectory, $root, [StringComparison]::OrdinalIgnoreCase))
}

function Test-LogonTrigger($Trigger) {
    $className = ''
    if ($Trigger.CimClass) { $className = [string]$Trigger.CimClass.CimClassName }
    if ($className -ne 'MSFT_TaskLogonTrigger') { return $false }
    if (-not (Test-UserIdMatchesCurrent ([string]$Trigger.UserId))) { return $false }
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

function Test-CommonTaskSettings($Task) {
    $settings = $Task.Settings
    return ([bool]$settings.Enabled -and
        [bool]$settings.AllowDemandStart -and
        [string]$settings.MultipleInstances -eq 'IgnoreNew' -and
        -not [bool]$settings.DisallowStartIfOnBatteries -and
        -not [bool]$settings.StopIfGoingOnBatteries)
}

function Test-GatewayTaskSettings($Task) {
    $settings = $Task.Settings
    return ((Test-CommonTaskSettings $Task) -and
        (Test-ScheduledDuration $settings.ExecutionTimeLimit ([TimeSpan]::Zero)) -and
        $null -ne $settings.RestartCount -and
        [uint32]$settings.RestartCount -eq 0 -and
        (Test-ScheduledDuration $settings.RestartInterval ([TimeSpan]::Zero) -AllowEmptyAsZero) -and
        -not [bool]$settings.StartWhenAvailable)
}

function Test-StartupTaskSettings($Task) {
    $settings = $Task.Settings
    return ((Test-CommonTaskSettings $Task) -and
        (Test-ScheduledDuration $settings.ExecutionTimeLimit (New-TimeSpan -Minutes 15)) -and
        $null -ne $settings.RestartCount -and
        [uint32]$settings.RestartCount -eq 3 -and
        (Test-ScheduledDuration $settings.RestartInterval (New-TimeSpan -Minutes 1)) -and
        [bool]$settings.StartWhenAvailable)
}

function Assert-InstalledTaskConfiguration($GatewayTask, $StartupTask) {
    if (-not $GatewayTask -or @(Get-NonNullTaskTriggers $GatewayTask).Count -ne 0) {
        throw 'Gateway task migration did not leave an on-demand task without a logon trigger.'
    }
    if (-not $StartupTask -or @(Get-NonNullTaskTriggers $StartupTask).Count -ne 1) {
        throw 'Startup task does not have its required user-logon trigger.'
    }
    if (-not (Test-GatewayTaskSettings $GatewayTask)) {
        throw 'Gateway task settings do not match the requested enabled on-demand configuration.'
    }
    if (-not (Test-StartupTaskSettings $StartupTask)) {
        throw 'Startup task settings do not match the requested enabled logon/retry configuration.'
    }
}

function Assert-GatewayTaskCompatible($Task) {
    $expectedArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
        $gatewayLauncher + '" -Action task-run'
    if (-not (Test-TaskAction $Task $expectedArguments) -or -not (Test-TaskPrincipal $Task)) {
        throw 'Another or outdated scheduled task uses CodexMobileUI Gateway; refusing to overwrite it.'
    }
    $triggers = @(Get-NonNullTaskTriggers $Task)
    if ($triggers.Count -gt 1 -or ($triggers.Count -eq 1 -and -not (Test-LogonTrigger $triggers[0]))) {
        throw 'CodexMobileUI Gateway has an unexpected trigger; refusing to overwrite it.'
    }
}

function Assert-StartupTaskCompatible($Task) {
    $expectedArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
        $mobileLauncher + '" -Action logon'
    if (-not (Test-TaskAction $Task $expectedArguments) -or -not (Test-TaskPrincipal $Task)) {
        throw 'Another or outdated scheduled task uses CodexMobileUI Startup; refusing to overwrite it.'
    }
    $triggers = @(Get-NonNullTaskTriggers $Task)
    if ($triggers.Count -ne 1 -or -not (Test-LogonTrigger $triggers[0])) {
        throw 'CodexMobileUI Startup must have exactly one user-logon trigger; refusing to overwrite it.'
    }
}

$gatewayAction = New-ScheduledTaskAction -Execute $pwsh `
    -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $gatewayLauncher + '" -Action task-run') `
    -WorkingDirectory $root
$startupAction = New-ScheduledTaskAction -Execute $pwsh `
    -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $mobileLauncher + '" -Action logon') `
    -WorkingDirectory $root
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$gatewaySettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$startupSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# Validate both names before writing anything. A legacy Gateway logon trigger is
# accepted only when its action, user and least-privilege principal are exact.
$existingGateway = Get-RootTask $gatewayTaskName
$existingStartup = Get-RootTask $startupTaskName
if ($existingGateway) { Assert-GatewayTaskCompatible $existingGateway }
if ($existingStartup) { Assert-StartupTaskCompatible $existingStartup }

function Register-GatewayTask {
    Register-ScheduledTask -TaskName $gatewayTaskName -Action $gatewayAction `
        -Principal $principal -Settings $gatewaySettings `
        -Description 'Starts the CodexMobileUI Gateway on demand with normal user privileges.' `
        -Force | Out-Null
}

function Register-StartupTask {
    Register-ScheduledTask -TaskName $startupTaskName -Action $startupAction `
        -Trigger $logonTrigger -Principal $principal -Settings $startupSettings `
        -Description 'Starts and verifies CodexMobileUI at user logon with normal user privileges.' `
        -Force | Out-Null
}

# If the Gateway task is absent there is no existing logon startup to preserve.
# Otherwise register the orchestrator first, then replace the Gateway task with
# its trigger-free form. A failed migration can therefore retain the legacy
# Gateway trigger, while overlap remains safe because both paths are idempotent.
if (-not $existingGateway) { Register-GatewayTask }
Register-StartupTask
if ($existingGateway) { Register-GatewayTask }

$installedGateway = Get-RootTask $gatewayTaskName
$installedStartup = Get-RootTask $startupTaskName
Assert-InstalledTaskConfiguration $installedGateway $installedStartup
Assert-GatewayTaskCompatible $installedGateway
Assert-StartupTaskCompatible $installedStartup

Write-Output 'Installed least-privilege CodexMobileUI Gateway and Startup scheduled tasks.'
