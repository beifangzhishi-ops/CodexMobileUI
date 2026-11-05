# Build a signed ARM64 Android test APK on Windows with a long-path-aware Ninja.
# Uses the per-user shared Android SDK; does not touch any Codex shared service.
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Variant = 'Release',
    [switch]$UseWorkspaceCache,
    [switch]$RegenerateCMake,
    [switch]$CheckOnly,
    [string]$GradleLogPath = ''
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
if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\javac.exe'))) {
    throw "JDK 17 is not installed at $javaHome"
}
$jdkVersion = (& (Join-Path $javaHome 'bin\javac.exe') -version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $jdkVersion -notmatch '^javac 17\.') {
    throw "Expected JDK 17 for React Native, got: $jdkVersion"
}
$nodeVersion = (& node.exe --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
    throw "Expected Node.js 24, got: $nodeVersion"
}
foreach ($relative in @(
    'platforms\android-37.0\android.jar',
    'build-tools\37.0.0\apksigner.bat',
    'ndk\27.1.12297006\source.properties'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot $relative))) {
        throw "Required shared Android SDK component is missing: $relative"
    }
}
if ($UseWorkspaceCache) {
    $env:GRADLE_USER_HOME = Join-Path $projectRoot '.tmp\gradle-user'
    $env:TEMP = Join-Path $projectRoot '.tmp\build-temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:TEMP | Out-Null
} else {
    $sharedGradle = [Environment]::GetEnvironmentVariable('GRADLE_USER_HOME', 'User')
    if ($sharedGradle) { $env:GRADLE_USER_HOME = $sharedGradle }
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
    Write-Host "Verified $jdkVersion, Node.js $nodeVersion, API 37, Build Tools 37, and NDK 27.1"
    Write-Host "Shared Gradle cache: $env:GRADLE_USER_HOME"
    Write-Host "Selected test APK variant: $Variant"
    return
}
$lockFile = Join-Path $projectRoot '.tmp\android-build.lock'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockFile) | Out-Null
try {
    $lockHandle = [System.IO.File]::Open(
        $lockFile, [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None
    )
} catch {
    throw "Unable to acquire exclusive Android build lock in ${projectRoot}: $($_.Exception.Message)"
}
try {
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
    $gradleArguments = @(
        ":app:assemble$Variant", '--console=plain', '--no-daemon', '--max-workers=2',
        '-PreactNativeArchitectures=arm64-v8a',
        '-Pkotlin.compiler.execution.strategy=in-process', '-Pandroid.cmakeVersion=3.31.6'
    )
    if ($GradleLogPath) {
        # Redirect inside cmd.exe, not through PowerShell's pipeline/Transcript.
        # Gradle descendants can finish writing the log if their parent shell is interrupted.
        $logFile = [System.IO.Path]::GetFullPath($GradleLogPath)
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null
        $launcher = Join-Path $projectRoot '.tmp\android-gradle-command.cmd'
        $lines = @(
            '@echo off',
            ('call "{0}" {1} 1>> "{2}" 2>&1' -f $gradleCommand, ($gradleArguments -join ' '), $logFile),
            'exit /b %ERRORLEVEL%'
        )
        Set-Content -LiteralPath $launcher -Value $lines -Encoding Ascii
        Write-Host "Full Gradle stdout/stderr: $logFile"
        try {
            & cmd.exe '/d' '/c' $launcher
            $gradleExit = $LASTEXITCODE
        } finally {
            Remove-Item -LiteralPath $launcher -Force -ErrorAction SilentlyContinue
        }
    } else {
        & $gradleCommand @gradleArguments
        $gradleExit = $LASTEXITCODE
    }
    if ($gradleExit -ne 0) {
        throw "Android Gradle build failed with exit code $gradleExit; inspect $GradleLogPath"
    }
} finally {
    Pop-Location
}
$variantLower = $Variant.ToLowerInvariant()
$apk = Join-Path $projectRoot "android\app\build\outputs\apk\$variantLower\app-$variantLower.apk"
if (-not (Test-Path -LiteralPath $apk)) {
    throw "Gradle reported success but no $Variant APK exists at $apk"
}
$apksigner = Join-Path $sdkRoot 'build-tools\37.0.0\apksigner.bat'
if (-not (Test-Path -LiteralPath $apksigner)) {
    throw "APK signing verifier is missing: $apksigner"
}
& $apksigner verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed for $apk" }
if ($Variant -eq 'Release') {
    # Debug builds intentionally omit the JS bundle, but a Release test APK
    # must run without Expo Metro or a development server.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $bundled = @($archive.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' })
        if (-not $bundled.Count -or $bundled[0].Length -le 0) {
            throw 'Release APK does not contain the embedded JavaScript/Hermes bundle.'
        }
        Write-Host "Verified self-contained Release JS: $($bundled[0].Length) bytes"
    } finally { $archive.Dispose() }
    Write-Warning 'This test Release APK uses the current project debug signing key. It is NOT a production-signed release.'
}
Get-Item -LiteralPath $apk | Select-Object FullName,Length,LastWriteTime
Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Select-Object Hash
} finally {
    $lockHandle.Dispose()
}
