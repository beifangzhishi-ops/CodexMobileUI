# Deterministic Windows Android packaging in a persistent short-path build checkout.
# The source checkout and its possibly locked native build outputs are never modified.
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Variant = 'Release',
    [string]$BuildRoot = '',
    [switch]$CheckOnly,
    [switch]$RegenerateCMake
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRootHint = Join-Path $sourceRoot '.tmp\android-build-root.txt'
if (-not $BuildRoot) {
    if (Test-Path -LiteralPath $buildRootHint) {
        $rememberedRoot = (Get-Content -LiteralPath $buildRootHint -Raw).Trim()
        if ($rememberedRoot -and (Test-Path -LiteralPath (Join-Path $rememberedRoot 'package.json'))) {
            $BuildRoot = $rememberedRoot
        }
    }
    if (-not $BuildRoot) { $BuildRoot = Join-Path $env:USERPROFILE 'CodexMobileUI-AndroidBuild' }
}
$buildRoot = [System.IO.Path]::GetFullPath($BuildRoot).TrimEnd('\')
$sourcePrefix = $sourceRoot.TrimEnd('\') + '\'
if ($buildRoot.Equals($sourceRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase) -or
    $buildRoot.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The persistent Android build directory must be outside the source checkout.'
}

$app = Get-Content -LiteralPath (Join-Path $sourceRoot 'app.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json
$appVersion = [string]$app.expo.version
$appCode = [string]$app.expo.android.versionCode
$appId = [string]$app.expo.android.package
if (-not $appVersion -or $appCode -notmatch '^\d+$' -or $appId -ne 'dev.codexmobileui.app') {
    throw 'Invalid native app identity/version in app.json.'
}
if ([string]$package.version -ne $appVersion) {
    throw "package.json version $($package.version) differs from app.json $appVersion."
}
$nativeFile = Join-Path $sourceRoot 'android\app\build.gradle'
if (-not (Test-Path -LiteralPath $nativeFile)) {
    throw 'Android native sources are missing. Generate them with Expo prebuild first.'
}
$nativeText = Get-Content -LiteralPath $nativeFile -Raw
$nativeCode = [regex]::Match($nativeText, '(?m)^\s*versionCode\s+(\d+)').Groups[1].Value
$nativeVersion = [regex]::Match($nativeText, '(?m)^\s*versionName\s+"([^"]+)"').Groups[1].Value
if ($nativeCode -ne $appCode -or $nativeVersion -ne $appVersion) {
    throw "Gradle native version ($nativeVersion/$nativeCode) differs from app.json ($appVersion/$appCode)."
}
$sourceBuilder = Join-Path $sourceRoot 'scripts\build-android-windows.ps1'
if ($CheckOnly) {
    & $sourceBuilder -Variant $Variant -CheckOnly
    if (-not $?) { throw 'Android build preflight failed.' }
    Write-Host "Android identity verified: $appId $appVersion ($appCode)"
    Write-Host "Persistent cache directory: $buildRoot"
    return
}

function Sync-Tree([string]$From, [string]$To, [string[]]$ExcludedDirectories) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    $copyArguments = @($From, $To, '/E', '/MT:12', '/R:0', '/W:0', '/NP', '/NFL', '/NDL', '/NJH', '/NJS')
    if ($ExcludedDirectories.Count) {
        $copyArguments += '/XD'
        $copyArguments += $ExcludedDirectories
    }
    $copyArguments += @('/XF', '.env', '.env.*', '*.jks', '*.p12', '*.pfx', '*.pem', '*.key')
    & robocopy.exe @copyArguments | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Source sync failed (robocopy $LASTEXITCODE) from $From." }
}

function Assert-AvailableLock([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $handle = $null
    try {
        $handle = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
    } catch {
        throw "Build already running in this checkout: $Path"
    } finally {
        if ($null -ne $handle) { $handle.Dispose() }
    }
}

function Get-DependencyLockContent([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    # Only the two root package version fields may change without reinstalling dependencies.
    # Every actual dependency/version/integrity change must trigger npm ci.
    $rootVersions = [regex]::new('(?m)^(\s*"version": ")[^"]+("\s*,?)')
    return $rootVersions.Replace($content, '1APP_VERSION2', 2)
}

if (Test-Path -LiteralPath (Join-Path $buildRoot 'package.json')) {
    $existing = Get-Content -LiteralPath (Join-Path $buildRoot 'package.json') -Raw | ConvertFrom-Json
    if ([string]$existing.name -ne [string]$package.name) {
        throw "Build directory contains a different project: $buildRoot."
    }
}
$stateDir = Join-Path $buildRoot '.tmp'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$lockHandle = $null
try {
    $lockHandle = [System.IO.File]::Open(
        (Join-Path $stateDir 'stable-build.lock'), 'OpenOrCreate', 'ReadWrite', 'None'
    )
} catch {
    throw "Unable to acquire exclusive stable build lock in ${buildRoot}: $($_.Exception.Message)"
}

try {
    Assert-AvailableLock (Join-Path $stateDir 'android-build.lock')
    $sourceLock = Join-Path $sourceRoot 'package-lock.json'
    $stagedLock = Join-Path $buildRoot 'package-lock.json'
    $dependenciesCurrent = (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo\package.json')) -and
        (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo-modules-autolinking\build\index.js')) -and
        (Test-Path -LiteralPath $stagedLock)
    if ($dependenciesCurrent) {
        $dependenciesCurrent = (Get-DependencyLockContent $sourceLock) -ceq
            (Get-DependencyLockContent $stagedLock)
    }

    Write-Host "Synchronizing source into $buildRoot"
    Sync-Tree $sourceRoot $buildRoot @(
        '.git', '.tmp', '.npm-cache', '.local-home', '.expo', '.expo-shared',
        '.state', '.runtime', 'node_modules', 'android', 'dist', 'coverage'
    )
    Sync-Tree (Join-Path $sourceRoot 'android') (Join-Path $buildRoot 'android') @(
        '.gradle', '.cxx', 'build'
    )
    if (-not $dependenciesCurrent) {
        Write-Host 'Installing dependency lockfile in the persistent build checkout.'
        Push-Location $buildRoot
        try {
            & npm.cmd ci '--no-audit' '--no-fund' '--prefer-offline'
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $LASTEXITCODE" }
        } finally { Pop-Location }
    } else {
        Write-Host 'Reusing installed dependencies and incremental Gradle/CMake caches.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo-modules-autolinking\build\index.js'))) {
        throw 'Expo Autolinking compiled JavaScript is missing.'
    }

    $logDir = Join-Path $stateDir 'android-build-logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logPath = Join-Path $logDir ("$($Variant.ToLowerInvariant())-$(Get-Date -Format 'yyyyMMdd-HHmmss').log")
    Write-Host "Build transcript: $logPath"
    $transcribing = $false
    try {
        Start-Transcript -LiteralPath $logPath -ErrorAction Stop | Out-Null
        $transcribing = $true
        $builder = Join-Path $buildRoot 'scripts\build-android-windows.ps1'
        if ($RegenerateCMake) {
            & $builder -Variant $Variant -RegenerateCMake
        } else {
            & $builder -Variant $Variant
        }
        if (-not $?) { throw 'Gradle build did not complete successfully.' }
    } finally {
        if ($transcribing) { Stop-Transcript | Out-Null }
    }

    $lower = $Variant.ToLowerInvariant()
    $apk = Join-Path $buildRoot "android\app\build\outputs\apk\$lower\app-$lower.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle returned without an APK.' }
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    $aapt = Join-Path $sdk 'build-tools\37.0.0\aapt.exe'
    $badging = & $aapt dump badging $apk
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect APK metadata.' }
    $identity = @($badging | Where-Object { $_ -like 'package:*' }) | Select-Object -First 1
    if (-not $identity -or $identity -notmatch "name='$([regex]::Escape($appId))'" -or
        $identity -notmatch "versionCode='$appCode'" -or
        $identity -notmatch "versionName='$([regex]::Escape($appVersion))'") {
        throw "APK identity/version mismatch: $identity"
    }
    $previous = Join-Path $sourceRoot 'android\app\build\outputs\apk\release\app-release.apk'
    if ($Variant -eq 'Release' -and (Test-Path -LiteralPath $previous)) {
        $signer = Join-Path $sdk 'build-tools\37.0.0\apksigner.bat'
        $oldInfo = & $signer verify '--print-certs' $previous
        if ($LASTEXITCODE -ne 0) { throw 'Previously installed APK signing check failed.' }
        $newInfo = & $signer verify '--print-certs' $apk
        if ($LASTEXITCODE -ne 0) { throw 'New APK signing check failed.' }
        # Android SDK apksigner emits "V2 Signer: certificate SHA-256 digest: ...".
        # Require a complete digest; empty matches must never count as equal signing keys.
        $digest = '(?im)^V2 Signer: certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$'
        $oldHash = [regex]::Match(($oldInfo -join [Environment]::NewLine), $digest).Groups[1].Value
        $newHash = [regex]::Match(($newInfo -join [Environment]::NewLine), $digest).Groups[1].Value
        if (-not $oldHash -or $oldHash -ne $newHash) {
            throw 'New APK signing certificate differs from the installed test APK.'
        }
        Write-Host 'Signing identity matches the previously installed APK.'
    }
    $artifactDir = Join-Path $sourceRoot '.tmp\android-artifacts'
    New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
    $artifact = Join-Path $artifactDir "CodexMobileUI-$appVersion-$lower-arm64.apk"
    Copy-Item -LiteralPath $apk -Destination $artifact -Force
    $sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
    Write-Host "Verified APK: $artifact"
    Write-Host "Version $appVersion ($appCode); SHA-256: $sha"
    Write-Host "Build transcript: $logPath"
    # Keep the same native cache on subsequent invocations without machine-specific tracked paths.
    [System.IO.File]::WriteAllText($buildRootHint, $buildRoot, (New-Object System.Text.UTF8Encoding($false)))
} finally {
    $lockHandle.Dispose()
}
