# Build an ARM64 Android debug APK on Windows with a long-path-aware Ninja.
# Uses the per-user shared Android SDK; does not touch any Codex shared service.
param(
    [switch]$UseWorkspaceCache,
    [switch]$RegenerateCMake,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else {
    $jdk = Get-ChildItem (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -Directory |
        Where-Object { $_.Name -match '^jdk-17' } |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $jdk) { throw 'Install Temurin JDK 17 first.' }
    $jdk.FullName
}
$cmake = Join-Path $sdkRoot 'cmake\3.31.6\bin\ninja.exe'
if (-not (Test-Path -LiteralPath $cmake)) {
    throw 'Official Android SDK CMake 3.31.6 is missing. Run setup-android-toolchain.ps1 first.'
}
$version = (& $cmake --version).Trim()
if ($LASTEXITCODE -ne 0 -or [version]$version -lt [version]'1.12.0') {
    throw "Ninja 1.12+ required for Windows long paths; found $version"
}
$longPathSetting = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled).LongPathsEnabled
if ($longPathSetting -ne 1) {
    throw 'Windows LongPathsEnabled must be 1 before building.'
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path
if ($UseWorkspaceCache) {
    $env:GRADLE_USER_HOME = Join-Path $projectRoot '.tmp\gradle-user'
    $env:TEMP = Join-Path $projectRoot '.tmp\build-temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:TEMP | Out-Null
}

$gradlew = Join-Path $projectRoot 'android\gradlew.bat'
if (-not (Test-Path -LiteralPath $gradlew)) {
    throw 'Missing Android project: run expo prebuild for Android first.'
}
$gradleCommand = $gradlew
if ($UseWorkspaceCache) {
    # Gradle Wrapper would try downloading its distribution into an empty
    # project-local GRADLE_USER_HOME. Reuse the version installed in the
    # shared user-wide wrapper directory, but keep project-local dependencies.
    $properties = Get-Content -LiteralPath (Join-Path $projectRoot 'android\gradle\wrapper\gradle-wrapper.properties') -Raw
    if ($properties -notmatch 'gradle-([0-9]+(?:\.[0-9]+)+)-bin\.zip') {
        throw 'Could not determine exact Gradle distribution from gradle-wrapper.properties.'
    }
    $gradleVersion = $Matches[1]
    $sharedGradleHome = [Environment]::GetEnvironmentVariable('GRADLE_USER_HOME', 'User')
    if (-not $sharedGradleHome) {
        $sharedGradleHome = Join-Path $env:USERPROFILE '.gradle'
    }
    $distributionDir = Join-Path $sharedGradleHome "wrapper\dists\gradle-$gradleVersion-bin"
    $gradleCommand = $null
    foreach ($folder in @(Get-ChildItem -LiteralPath $distributionDir -Directory -ErrorAction SilentlyContinue)) {
        $candidate = Join-Path $folder.FullName "gradle-$gradleVersion\bin\gradle.bat"
        if (Test-Path -LiteralPath $candidate) {
            $gradleCommand = $candidate
            break
        }
    }
    if (-not $gradleCommand) {
        throw "Shared Gradle $gradleVersion is not installed under $distributionDir. Install it outside the restricted build first."
    }
    Write-Host "Using shared Gradle $gradleVersion distribution with project-local dependency cache."
}
if ($CheckOnly) {
    Write-Host "Verified Windows Android build prerequisites: CMake 3.31.6, Ninja $version and Gradle at $gradleCommand"
    return
}
$androidRoot = Join-Path $projectRoot 'android'
if ($RegenerateCMake) {
    # Reset ONLY generated app-side native build state when switching away
    # from SDK CMake 3.22.1/Ninja 1.10.2. Never delete source or the SDK.
    foreach ($relative in @('app\.cxx', 'app\build')) {
        $generated = Join-Path $androidRoot $relative
        if (Test-Path -LiteralPath $generated) {
            Write-Host "Clearing generated app build cache: $generated"
            Remove-Item -LiteralPath $generated -Recurse -Force
        }
    }
}
Push-Location $androidRoot
try {
    & $gradleCommand ':app:assembleDebug' '--console=plain' '--no-daemon' '--max-workers=2' `
        '-PreactNativeArchitectures=arm64-v8a' `
        '-Pkotlin.compiler.execution.strategy=in-process' '-Pandroid.cmakeVersion=3.31.6'
    if ($LASTEXITCODE -ne 0) { throw "Android Gradle build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
$apk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) {
    throw 'Gradle reported success but no app-debug.apk exists.'
}
Get-Item -LiteralPath $apk | Select-Object FullName,Length,LastWriteTime
