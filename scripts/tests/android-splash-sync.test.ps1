$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixtureRoot = Join-Path $repoRoot ('.tmp\android-splash-sync-fixture-' + [Guid]::NewGuid().ToString('N'))
$sourceAndroid = Join-Path $fixtureRoot 'source\android'
$targetAndroid = Join-Path $fixtureRoot 'target\android'
$sourceRes = Join-Path $sourceAndroid 'app\src\main\res'
$targetRes = Join-Path $targetAndroid 'app\src\main\res'
New-Item -ItemType Directory -Force -Path (Join-Path $sourceRes 'drawable') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $targetRes 'drawable') | Out-Null
$fallback = '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="1dp" android:height="1dp" />'
Set-Content -LiteralPath (Join-Path $sourceRes 'drawable\splashscreen_logo.xml') -Value $fallback -Encoding UTF8
Set-Content -LiteralPath (Join-Path $targetRes 'drawable\splashscreen_logo.xml') -Value $fallback -Encoding UTF8
Set-Content -LiteralPath (Join-Path $targetRes 'drawable\unrelated.xml') -Value '<vector />' -Encoding UTF8

$sync = Join-Path $repoRoot 'scripts\sync-android-splash-resources.ps1'
& $sync -SourceAndroidRoot $sourceAndroid -TargetAndroidRoot $targetAndroid | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $targetRes 'drawable\unrelated.xml'))) {
    throw 'Clean source fixture changed an unrelated resource.'
}

$qualifiers = @(
    'drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi',
    'drawable-night', 'drawable-night-mdpi', 'drawable-night-hdpi', 'drawable-night-xhdpi',
    'drawable-night-xxhdpi', 'drawable-night-xxxhdpi'
)
foreach ($qualifier in $qualifiers) {
    $directory = Join-Path $targetRes $qualifier
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Set-Content -LiteralPath (Join-Path $directory 'splashscreen_logo.png') -Value 'stale' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $directory 'keep.png') -Value 'keep' -Encoding ASCII
}
New-Item -ItemType Directory -Force -Path (Join-Path $targetRes 'drawable-anydpi') | Out-Null
Set-Content -LiteralPath (Join-Path $targetRes 'drawable-anydpi\splashscreen_logo.png') -Value 'unmanaged' -Encoding ASCII
& $sync -SourceAndroidRoot $sourceAndroid -TargetAndroidRoot $targetAndroid | Out-Null
foreach ($qualifier in $qualifiers) {
    $directory = Join-Path $targetRes $qualifier
    if (Test-Path -LiteralPath (Join-Path $directory 'splashscreen_logo.png')) {
        throw "Stale splash override survived in $qualifier."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'keep.png'))) {
        throw "Unrelated resource was removed from $qualifier."
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $targetRes 'drawable-anydpi\splashscreen_logo.png')) -or
    -not (Test-Path -LiteralPath (Join-Path $targetRes 'drawable\splashscreen_logo.xml'))) {
    throw 'Unknown qualifier resource or transparent fallback was altered.'
}
Write-Output "PASS: clean and seeded light/night splash sync fixture ($fixtureRoot)"
