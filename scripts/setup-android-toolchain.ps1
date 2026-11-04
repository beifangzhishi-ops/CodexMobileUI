# Shared Android build toolchain for all projects of this Windows user.
# JDK 17 is installed with winget (Temurin) and detected here.
# SDK CLI version and checksum: https://developer.android.com/studio
param([switch] $AcceptLicenses)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$downloads = Join-Path $env:LOCALAPPDATA 'Android\Downloads'
$cmdlineRoot = Join-Path $sdkRoot 'cmdline-tools\latest'
$manager = Join-Path $cmdlineRoot 'bin\sdkmanager.bat'
$cliUrl = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
$cliHash = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$cliSize = 155655386
$cliZip = Join-Path $downloads 'commandlinetools-win-15859902_latest.zip'
$packages = @(
    'platform-tools', 'platforms;android-37.0', 'platforms;android-36',
    'build-tools;37.0.0', 'build-tools;36.0.0',
    'ndk;27.1.12297006', 'ndk;28.2.13676358',
    'cmake;3.22.1', 'cmake;3.31.6'
)
New-Item -ItemType Directory -Force -Path $sdkRoot, $downloads | Out-Null

$adoptiumRoot = Join-Path $env:ProgramFiles 'Eclipse Adoptium'
$jdk = Get-ChildItem -LiteralPath $adoptiumRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^jdk-17' -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe')) } |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $jdk) { throw 'Temurin 17 JDK not installed; install via winget first.' }
$javaHome = $jdk.FullName

[Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdkRoot, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $sdkRoot, 'User')
[Environment]::SetEnvironmentVariable('GRADLE_USER_HOME',
    (Join-Path $env:USERPROFILE '.gradle'), 'User')
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE '.gradle'

$requiredPaths = @(
    (Join-Path $javaHome 'bin'),
    (Join-Path $sdkRoot 'platform-tools'),
    (Join-Path $cmdlineRoot 'bin')
)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathSegments = @($userPath -split ';' | Where-Object { $_ })
foreach ($location in $requiredPaths) {
    if (-not ($pathSegments | Where-Object { $_.TrimEnd('\') -ieq
            $location.TrimEnd('\') })) {
        $pathSegments += $location
    }
}
[Environment]::SetEnvironmentVariable('Path', ($pathSegments -join ';'), 'User')
$env:Path = ($requiredPaths -join ';') + ';' + $env:Path

if (-not (Test-Path -LiteralPath $manager)) {
    if (-not (Test-Path -LiteralPath $cliZip)) {
        Write-Host 'Downloading official Android SDK Command-line Tools via verified HTTP ranges...'
        $temp = "$cliZip.partial"
        $chunkSize = 5 * 1024 * 1024
        $existing = if (Test-Path -LiteralPath $temp) {
            (Get-Item -LiteralPath $temp).Length
        } else { 0 }
        $resumeAt = [long]([math]::Floor($existing / $chunkSize) * $chunkSize)
        $stream = [System.IO.File]::Open($temp, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $stream.SetLength($resumeAt)
            $stream.Seek($resumeAt, [System.IO.SeekOrigin]::Begin) | Out-Null
            for ($start = $resumeAt; $start -lt $cliSize; $start += $chunkSize) {
                $end = [math]::Min($cliSize - 1, $start + $chunkSize - 1)
                $expected = $end - $start + 1
                $part = "$temp.chunk"
                if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
                Write-Host ("Google CLI: {0:N0}/{1:N0} bytes" -f $start, $cliSize)
                & curl.exe --fail --silent --show-error --location --range "$start-$end" --retry 3 --retry-all-errors --connect-timeout 15 --output $part $cliUrl
                if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $part)) {
                    throw "Android CLI range download failed at $start"
                }
                $actual = (Get-Item -LiteralPath $part).Length
                if ($actual -ne $expected) { throw "Android CLI HTTP range mismatch: $start-$end returned $actual bytes" }
                $bytes = [System.IO.File]::ReadAllBytes($part)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
                Remove-Item -LiteralPath $part -Force
            }
        } finally {
            $stream.Dispose()
        }
        Move-Item -LiteralPath $temp -Destination $cliZip -Force
    }
    $hash = (Get-FileHash -LiteralPath $cliZip -Algorithm SHA256).Hash
    if ($hash -ine $cliHash) { throw "Android CLI checksum mismatch: $hash" }
    $stage = Join-Path $downloads 'android-cli-unpacked'
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    Expand-Archive -LiteralPath $cliZip -DestinationPath $stage
    $extracted = Join-Path $stage 'cmdline-tools'
    if (-not (Test-Path (Join-Path $extracted 'bin\sdkmanager.bat'))) {
        throw 'Unexpected SDK Command-line Tools archive layout'
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $cmdlineRoot -Parent) | Out-Null
    if (Test-Path -LiteralPath $cmdlineRoot) {
        throw 'Incomplete cmdline-tools/latest exists; inspect it before retrying'
    }
    Move-Item -LiteralPath $extracted -Destination $cmdlineRoot
    Remove-Item -LiteralPath $stage -Recurse -Force
}

Write-Host '--- Shared toolchain ---'
& (Join-Path $javaHome 'bin\java.exe') -version
& $manager "--sdk_root=$sdkRoot" --version

if ($AcceptLicenses) {
    Write-Host 'Accepting Android SDK package licenses...'
    (1..48 | ForEach-Object { 'y' }) | & $manager "--sdk_root=$sdkRoot" --licenses
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK license acceptance failed' }
}

Write-Host 'Installing shared SDK packages:'
$packages | ForEach-Object { Write-Host "  $_" }
& $manager "--sdk_root=$sdkRoot" @packages
if ($LASTEXITCODE -ne 0) { throw 'Android SDK package installation failed' }

Write-Host '--- Verification ---'
& (Join-Path $sdkRoot 'platform-tools\adb.exe') version
& $manager "--sdk_root=$sdkRoot" --list_installed
Write-Host "ANDROID_HOME=$sdkRoot"
Write-Host "JAVA_HOME=$javaHome"
Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
