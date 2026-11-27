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
$workspaceCacheRoot = Join-Path $sourceRoot '.tmp'
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

$app = Get-Content -LiteralPath (Join-Path $sourceRoot 'app.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
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
# Keep ignored Expo-prebuilt version metadata aligned with app.json, without
# changing the fixed build command or regenerating Gradle/CMake caches.
& node.exe (Join-Path $sourceRoot 'scripts\sync-android-native-version.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to synchronize Android native version metadata.' }
& node.exe (Join-Path $sourceRoot 'scripts\sync-quota-widget-native.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to synchronize quota widget native files.' }
& node.exe (Join-Path $sourceRoot 'scripts\sync-notifications-native.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to synchronize task notification native files.' }
& node.exe (Join-Path $sourceRoot 'scripts\sync-app-navigation-native.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to synchronize native Android navigation.' }
& node.exe (Join-Path $sourceRoot 'scripts\sync-diagnostics-native.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to synchronize native Android diagnostics.' }
$nativeText = Get-Content -LiteralPath $nativeFile -Raw
$nativeCode = [regex]::Match($nativeText, '(?m)^\s*versionCode\s+(\d+)').Groups[1].Value
$nativeVersion = [regex]::Match($nativeText, '(?m)^\s*versionName\s+"([^"]+)"').Groups[1].Value
if ($nativeCode -ne $appCode -or $nativeVersion -ne $appVersion) {
    throw "Gradle native version ($nativeVersion/$nativeCode) differs from app.json ($appVersion/$appCode)."
}
$sourceBuilder = Join-Path $sourceRoot 'scripts\build-android-windows.ps1'
if ($CheckOnly) {
    & $sourceBuilder -Variant $Variant -UseWorkspaceCache -WorkspaceCacheRoot $workspaceCacheRoot -CheckOnly
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
        throw "Unable to acquire nested Android build lock at ${Path}: $($_.Exception.Message)"
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

$stateTool = Join-Path $sourceRoot 'scripts\android-build-state.mjs'
function Invoke-BuildState([string]$Action, [string[]]$Values) {
    $output = & node.exe $stateTool $Action @Values
    if ($LASTEXITCODE -ne 0) {
        throw "Android build state operation failed: $Action"
    }
    return $output
}

try {
    Assert-AvailableLock (Join-Path $stateDir 'android-build.lock')
    $logDir = Join-Path $stateDir 'android-build-logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $lower = $Variant.ToLowerInvariant()
    $apk = Join-Path $buildRoot "android\app\build\outputs\apk\$lower\app-$lower.apk"
    $probe = Invoke-BuildState 'inspect' @($sourceRoot, $buildRoot, $Variant, $appVersion, $appCode, $appId, $apk)
    # Explicit native graph regeneration must never reuse an interrupted APK.
    $resuming = (-not $RegenerateCMake) -and ($probe -eq 'RESUME')
    $tracked = $false
    try {
        if ($resuming) {
            Write-Host 'Recovering a completed APK from the recorded interrupted build; skipping Gradle.'
            $tracked = $true
        } else {
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            $logPath = Join-Path $logDir "$lower-$stamp.log"
            $gradleLog = Join-Path $logDir "$lower-$stamp.gradle.log"
            Invoke-BuildState 'begin' @(
                $sourceRoot, $buildRoot, $Variant, $appVersion, $appCode, $appId, $gradleLog
            ) | Out-Null
            $tracked = $true
            $sourceLock = Join-Path $sourceRoot 'package-lock.json'
            $stagedLock = Join-Path $buildRoot 'package-lock.json'
            $dependenciesCurrent = (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo\package.json')) -and
                (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo-modules-autolinking\build\index.js')) -and
                (Test-Path -LiteralPath $stagedLock)
            if ($dependenciesCurrent) {
                $dependenciesCurrent = (Get-DependencyLockContent $sourceLock) -ceq
                    (Get-DependencyLockContent $stagedLock)
            }
            if ($dependenciesCurrent) {
                # A failed npm ci can leave Expo present while newer plugins
                # are missing. Lock equality alone does not prove completeness.
                $rootPackages = @($package.dependencies.PSObject.Properties.Name) +
                    @($package.devDependencies.PSObject.Properties.Name)
                foreach ($name in $rootPackages) {
                    $manifest = Join-Path $buildRoot ('node_modules\' + $name.Replace('/', '\') + '\package.json')
                    if (-not (Test-Path -LiteralPath $manifest)) {
                        Write-Host "Incomplete build dependency install: $name"
                        $dependenciesCurrent = $false
                        break
                    }
                }
            }
            Write-Host "Synchronizing source into $buildRoot"
            Sync-Tree $sourceRoot $buildRoot @(
                '.git', '.worktrees', '.tmp', '.npm-cache', '.local-home', '.expo', '.expo-shared',
                '.state', '.runtime', 'node_modules', (Join-Path $sourceRoot 'android'), 'dist', 'coverage'
            )
            Sync-Tree (Join-Path $sourceRoot 'android') (Join-Path $buildRoot 'android') @(
                '.gradle', '.cxx', 'build'
            )
            $splashImageProperty = $app.expo.splash.PSObject.Properties['image']
            if ($null -eq $splashImageProperty -or
                [string]::IsNullOrWhiteSpace([string]$splashImageProperty.Value)) {
                & (Join-Path $sourceRoot 'scripts\sync-android-splash-resources.ps1') `
                    -SourceAndroidRoot (Join-Path $sourceRoot 'android') `
                    -TargetAndroidRoot (Join-Path $buildRoot 'android')
                if (-not $?) { throw 'Unable to remove stale no-image splash overrides.' }
            }
            if (-not $dependenciesCurrent) {
                Write-Host 'Installing dependency lockfile in the persistent build checkout.'
                # npm ci runs before the Gradle builder; it must also use an
                # isolated writable cache, never the user's global npm cache.
                $npmCache = Join-Path $workspaceCacheRoot 'npm-cache'
                New-Item -ItemType Directory -Force -Path $npmCache | Out-Null
                $previousNpmCache = [Environment]::GetEnvironmentVariable('npm_config_cache', 'Process')
                Push-Location $buildRoot
                try {
                    $env:npm_config_cache = $npmCache
                    # The checked-in lockfile is resolved without optional
                    # Storybook peer graphs (notably react-native-windows).
                    # Honor that graph without upgrading React Native or npm.
                    & npm.cmd ci '--no-audit' '--no-fund' '--prefer-offline' '--legacy-peer-deps'
                    if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $LASTEXITCODE" }
                } finally {
                    if ($null -eq $previousNpmCache) {
                        Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue
                    } else {
                        $env:npm_config_cache = $previousNpmCache
                    }
                    Pop-Location
                }
            } else {
                Write-Host 'Reusing installed dependencies and incremental Gradle/CMake caches.'
            }
            if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'node_modules\expo-modules-autolinking\build\index.js'))) {
                throw 'Expo Autolinking compiled JavaScript is missing.'
            }
            # Verify the two native modules required by the active WebView shell
            # are linked into the staged Android graph. The former diagnostic
            # download module belonged to the removed native chat UI.
            Push-Location $buildRoot
            try {
                $autolinkingJson = & node.exe 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking' resolve --platform android --json
                if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Android Expo module autolinking.' }
                $autolinking = ($autolinkingJson -join '') | ConvertFrom-Json
                foreach ($requiredModule in @('expo-file-system', 'expo-sqlite')) {
                    if (-not (@($autolinking.modules) | Where-Object { $_.packageName -eq $requiredModule } | Select-Object -First 1)) {
                        throw "Android WebView shell module missing from staged Expo autolinking: $requiredModule"
                    }
                }
            } finally { Pop-Location }
            # The source fingerprint is checked again before publishing the APK.
            Invoke-BuildState 'phase' @($buildRoot, 'building') | Out-Null
            Write-Host "Build transcript: $logPath"
            Write-Host "Gradle output: $gradleLog"
            $transcribing = $false
            try {
                Start-Transcript -LiteralPath $logPath -ErrorAction Stop | Out-Null
                $transcribing = $true
                $builder = Join-Path $buildRoot 'scripts\build-android-windows.ps1'
                if ($RegenerateCMake) {
                    & $builder -Variant $Variant -UseWorkspaceCache -WorkspaceCacheRoot $workspaceCacheRoot -RegenerateCMake -GradleLogPath $gradleLog
                } else {
                    & $builder -Variant $Variant -UseWorkspaceCache -WorkspaceCacheRoot $workspaceCacheRoot -GradleLogPath $gradleLog
                }
                if (-not $?) { throw 'Gradle build did not complete successfully.' }
            } finally {
                if ($transcribing) { Stop-Transcript | Out-Null }
            }
            Invoke-BuildState 'phase' @($buildRoot, 'built') | Out-Null
        }
        Invoke-BuildState 'phase' @($buildRoot, 'verifying') | Out-Null
        if ((Invoke-BuildState 'source-match' @($sourceRoot, $buildRoot, $Variant, $appVersion, $appCode, $appId)) -ne 'MATCH') {
            throw 'APK cannot be published because its recorded source or version has changed.'
        }
        if ($resuming -and
            (Invoke-BuildState 'inspect' @($sourceRoot, $buildRoot, $Variant, $appVersion, $appCode, $appId, $apk)) -ne 'RESUME') {
            throw 'Interrupted build APK is older than its recorded Gradle attempt.'
        }
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
        $signer = Join-Path $sdk 'build-tools\37.0.0\apksigner.bat'
        $newInfo = & $signer verify '--verbose' '--print-certs' $apk
        if ($LASTEXITCODE -ne 0) { throw 'New APK signing check failed.' }
        $digest = '(?im)^V2 Signer: certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$'
        $newHash = [regex]::Match(($newInfo -join [Environment]::NewLine), $digest).Groups[1].Value
        if (-not $newHash) { throw 'New APK has no valid V2 signing certificate digest.' }
        if ($Variant -eq 'Release') {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
            try {
                $bundled = @($archive.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' })
                if (-not $bundled.Count -or $bundled[0].Length -le 0) {
                    throw 'Release APK is missing the embedded JavaScript/Hermes bundle.'
                }
                $libraries = @($archive.Entries | Where-Object { $_.FullName -match '^lib/[^/]+/[^/]+\.so$' })
                if (-not $libraries.Count -or @($libraries | Where-Object {
                    $_.FullName -notmatch '^lib/arm64-v8a/'
                }).Count) {
                    throw 'Release APK has no ARM64 native libraries or contains another ABI.'
                }
                # The retired diagnostic-download Java module is no longer part of the WebView shell.
                # Required Expo modules are checked via staged autolinking above; ensure bytecode exists.
                $dexEntries = @($archive.Entries | Where-Object { $_.FullName -match '^classes\d*\.dex$' -and $_.Length -gt 0 })
                if (-not $dexEntries.Count) { throw 'Release APK has no compiled Android DEX bytecode.' }
                Write-Host "Embedded Release JavaScript verified: $($bundled[0].Length) bytes"
            } finally { $archive.Dispose() }
        }
        $artifactDir = Join-Path $sourceRoot '.tmp\android-artifacts'
        New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
        $artifact = Join-Path $artifactDir "CodexMobileUI-$appVersion-$lower-arm64.apk"
        $previous = Get-ChildItem -LiteralPath $artifactDir -Filter 'CodexMobileUI-*-release-arm64.apk' -File |
            Where-Object { $_.FullName -ne $artifact } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($Variant -eq 'Release' -and $previous) {
            $oldInfo = & $signer verify '--print-certs' $previous.FullName
            if ($LASTEXITCODE -ne 0) { throw 'Previous APK signing check failed.' }
            $oldHash = [regex]::Match(($oldInfo -join [Environment]::NewLine), $digest).Groups[1].Value
            if (-not $oldHash -or $oldHash -ne $newHash) {
                throw 'New APK signing certificate differs from the previous APK.'
            }
            Write-Host 'Signing identity matches the previous APK.'
        }
        $sourceSha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
        $partial = "$artifact.partial"
        if (Test-Path -LiteralPath $partial) {
            Remove-Item -LiteralPath $partial -Force
        }
        Copy-Item -LiteralPath $apk -Destination $partial -ErrorAction Stop
        $partialSha = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
        if ($sourceSha -ne $partialSha) { throw 'APK staging copy SHA-256 mismatch.' }
        Move-Item -LiteralPath $partial -Destination $artifact -Force
        $sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
        if ($sha -ne $sourceSha) { throw 'Published APK SHA-256 mismatch.' }
        $size = (Get-Item -LiteralPath $artifact).Length
        Invoke-BuildState 'finish' @($buildRoot, $artifact, $sha, "$size") | Out-Null
        Write-Host "Verified APK: $artifact"
        Write-Host "Version $appVersion ($appCode); SHA-256: $sha"
        [System.IO.File]::WriteAllText($buildRootHint, $buildRoot, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        if ($tracked) {
            try { Invoke-BuildState 'fail' @($buildRoot, $_.Exception.Message) | Out-Null }
            catch { Write-Warning 'Unable to persist failed Android build state.' }
        }
        throw
    }
} finally {
    $lockHandle.Dispose()
}
