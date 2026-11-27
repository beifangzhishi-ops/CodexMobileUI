param(
    [Parameter(Mandatory = $true)][string]$SourceAndroidRoot,
    [Parameter(Mandatory = $true)][string]$TargetAndroidRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-SafeAndroidResourceRoot([string]$AndroidRoot) {
    $root = [System.IO.Path]::GetFullPath($AndroidRoot).TrimEnd('\')
    $cursor = $root
    foreach ($part in @('', 'app', 'src', 'main', 'res')) {
        if ($part) { $cursor = Join-Path $cursor $part }
        if (-not (Test-Path -LiteralPath $cursor -PathType Container)) {
            throw "Android resource root is missing: $cursor"
        }
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Android resource path must not contain a reparse point: $cursor"
        }
    }
    return [System.IO.Path]::GetFullPath($cursor)
}

$sourceRes = Get-SafeAndroidResourceRoot $SourceAndroidRoot
$targetRes = Get-SafeAndroidResourceRoot $TargetAndroidRoot
$sourceXml = Join-Path $sourceRes 'drawable\splashscreen_logo.xml'
$targetXml = Join-Path $targetRes 'drawable\splashscreen_logo.xml'
foreach ($xmlPath in @($sourceXml, $targetXml)) {
    if (-not (Test-Path -LiteralPath $xmlPath -PathType Leaf)) {
        throw "Transparent no-image splash fallback is missing: $xmlPath"
    }
    $xml = Get-Item -LiteralPath $xmlPath -Force
    if (($xml.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Splash fallback must not be a reparse point: $xmlPath"
    }
}
if ((Get-FileHash -LiteralPath $sourceXml -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $targetXml -Algorithm SHA256).Hash) {
    throw 'Staged transparent splash fallback does not match the checked-in generated source.'
}

# Expo's no-image config uses this transparent XML fallback. Remove only stale
# image overrides for the exact managed resource name in known light/night
# density folders; keep arbitrary resources, unknown qualifiers and caches.
$qualifiers = @(
    'drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi',
    'drawable-night', 'drawable-night-mdpi', 'drawable-night-hdpi', 'drawable-night-xhdpi',
    'drawable-night-xxhdpi', 'drawable-night-xxxhdpi'
)
foreach ($qualifier in $qualifiers) {
    $directory = Join-Path $targetRes $qualifier
    if (-not (Test-Path -LiteralPath $directory)) { continue }
    $dirItem = Get-Item -LiteralPath $directory -Force
    if (($dirItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Managed splash resource directory must not be a reparse point: $directory"
    }
    $png = Join-Path $directory 'splashscreen_logo.png'
    if (-not (Test-Path -LiteralPath $png)) { continue }
    $file = Get-Item -LiteralPath $png -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Managed splash override must be a regular file: $png"
    }
    Remove-Item -LiteralPath $png -Force
}

Write-Output 'Removed stale managed splash PNG overrides; transparent XML fallback is intact.'
