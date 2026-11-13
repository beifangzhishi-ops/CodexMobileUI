# Safe, explicit release updater for a Windows CodexMobileUI Host-only installation.
# Install this single script on noha; it never pulls Android sources or Git trees.
param(
  [ValidateSet('status', 'check', 'download', 'activate', 'rollback')]
  [string]$Action = 'status',
  [string]$Tag,
  [string]$Repository = 'beifangzhishi-ops/CodexMobileUI'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stateRoot = Join-Path $root '.host-sync'
$stateFile = Join-Path $stateRoot 'deployment.json'
$releases = Join-Path $stateRoot 'releases'
$downloads = Join-Path $stateRoot 'downloads'

function Assert-RelativeRelease([string]$name) {
  if ($name -notmatch '^host-v[0-9A-Za-z._-]+$' -or $name.Contains('..')) {
    throw 'Unsafe release tag.'
  }
}

function Get-DeploymentState {
  if (Test-Path -LiteralPath $stateFile) {
    return (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json)
  }
  return [pscustomobject]@{ active = 'host-runtime'; previous = $null; tag = 'pre-release-local' }
}

function Assert-LocalHostPath([string]$relative) {
  if ($relative -ne 'host-runtime' -and $relative -notmatch '^\.host-sync[/\\]releases[/\\]host-v[0-9A-Za-z._-]+$') {
    throw 'Untrusted deployment path in state.'
  }
  $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $full.StartsWith($root.TrimEnd([char]92) + [char]92, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Deployment directory escaped expected root.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $full 'scripts\mobile-launcher.ps1'))) {
    throw "Host launcher missing: $relative"
  }
  return $full
}

function Test-Manifest([string]$directory) {
  $manifest = Join-Path $directory 'MANIFEST.sha256'
  if (-not (Test-Path -LiteralPath $manifest)) { throw 'Missing host package hash manifest.' }
  if ((Test-Path (Join-Path $directory 'src')) -or (Test-Path (Join-Path $directory 'android')) -or
      (Test-Path (Join-Path $directory 'App.tsx')) -or (Test-Path (Join-Path $directory '.env'))) {
    throw 'Package contains forbidden app source or machine-private configuration.'
  }
  $all = @(Get-ChildItem -LiteralPath $directory -File -Recurse -Force)
  $records = @(Get-Content -LiteralPath $manifest)
  if ($records.Count -lt 10 -or $all.Count -ne ($records.Count + 1)) {
    throw 'Unexpected host-only package file count.'
  }
  $seen = @{}
  foreach ($line in $records) {
    if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$') {
      throw 'Unexpected hash manifest entry.'
    }
    $hash = $Matches[1]
    $relative = $Matches[2]
    if ($relative.StartsWith('/') -or $relative.Split('/') -contains '..' -or $seen.ContainsKey($relative)) {
      throw 'Duplicate or unsafe hash manifest entry.'
    }
    $seen[$relative] = $true
    $path = [IO.Path]::GetFullPath((Join-Path $directory $relative.Replace('/', '\')))
    $prefix = [IO.Path]::GetFullPath($directory).TrimEnd([char]92) + [char]92
    if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $path -PathType Leaf) -or
        ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Missing, linked or escaping package file.'
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
      throw "Host package hash mismatch: $relative"
    }
  }
  foreach ($required in @('Start-CodexMobile.cmd', 'Stop-CodexMobile.cmd',
                          'scripts/mobile-app-server.ps1', 'scripts/mobile-launcher.ps1',
                          'scripts/gateway-only.ps1', 'dist/gateway/main.js', 'node_modules/ws/package.json')) {
    if (-not $seen.ContainsKey($required)) { throw "Missing required host component: $required" }
  }
  Write-Output "Host manifest verified: $($records.Count) files."
}

function Get-ReleaseTag {
  if ($Tag) { Assert-RelativeRelease $Tag; return $Tag }
  $found = & gh.exe release view --repo $Repository --json tagName --jq .tagName 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $found) {
    throw 'No published GitHub Host release found. Commit stable 6v source and publish a host-v* tag first.'
  }
  $value = ([string]$found).Trim()
  Assert-RelativeRelease $value
  return $value
}

function Receive-Release([string]$releaseTag) {
  Assert-RelativeRelease $releaseTag
  $staged = Join-Path $releases $releaseTag
  if (Test-Path -LiteralPath $staged) {
    Test-Manifest $staged
    return $staged
  }
  $download = Join-Path $downloads $releaseTag
  if (Test-Path -LiteralPath $download) { throw 'Existing incomplete download; inspect before retrying.' }
  New-Item -ItemType Directory -Path $download -Force | Out-Null
  $basename = 'CodexMobileHost-' + $releaseTag + '.zip'
  $archive = Join-Path $download $basename
  $hashPath = $archive + '.sha256'
  & gh.exe release download $releaseTag --repo $Repository --dir $download --pattern $basename --pattern ($basename + '.sha256')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archive) -or -not (Test-Path $hashPath)) {
    throw 'GitHub release download incomplete.'
  }
  $line = (Get-Content $hashPath -Raw).Trim()
  if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$' -or $Matches[2] -ne $basename) {
    throw 'Invalid release ZIP digest file.'
  }
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1]) {
    throw 'Downloaded release ZIP SHA-256 mismatch.'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    foreach ($entry in $zip.Entries) {
      $entryName = $entry.FullName.Replace('\', '/')
      $typeBits = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($entryName.StartsWith('/') -or $entryName.Contains(':') -or
          $entryName.Split('/') -contains '..' -or $entryName.StartsWith('./') -or
          $typeBits -eq 0xA000) {
        throw 'Unsafe ZIP entry.'
      }
    }
  } finally { $zip.Dispose() }
  New-Item -ItemType Directory -Path $releases -Force | Out-Null
  $temp = Join-Path $releases ($releaseTag + '.partial')
  if (Test-Path $temp) { throw 'Unfinished release staging exists.' }
  try {
    Expand-Archive -LiteralPath $archive -DestinationPath $temp -ErrorAction Stop
    Test-Manifest $temp
    Move-Item -LiteralPath $temp -Destination $staged -ErrorAction Stop
  } catch { throw }
  Write-Output "Release downloaded and validated: $releaseTag"
  return $staged
}

function Invoke-Host([string]$directory, [string]$operation) {
  $script = Join-Path $directory 'scripts\mobile-launcher.ps1'
  $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $script -Action $operation 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Host $operation failed: $($output | Out-String)" }
  if ($operation -eq 'status') {
    $joined = $output | Out-String
    foreach ($expected in @('MobileUI App Server owned: True', 'MobileUI App Server ready: True',
                            'Gateway owned by this directory: True', 'Gateway health: True')) {
      if (-not $joined.Contains($expected)) { throw "Host status incomplete: $expected" }
    }
  }
}

function Switch-Host([string]$fromRelative, [string]$toRelative) {
  $old = Assert-LocalHostPath $fromRelative
  $new = Assert-LocalHostPath $toRelative
  if ($old -eq $new) { throw 'Release is already active.' }
  Invoke-Host $old 'status'
  if (-not (Test-Path -LiteralPath (Join-Path $old '.env'))) { throw 'Missing old host private configuration.' }
  $newEnv = Join-Path $new '.env'
  if (Test-Path $newEnv) {
    # Rollback destinations have already received the same host-local config.
    $oldHash = (Get-FileHash -LiteralPath (Join-Path $old '.env') -Algorithm SHA256).Hash
    $newHash = (Get-FileHash -LiteralPath $newEnv -Algorithm SHA256).Hash
    if ($oldHash -ne $newHash) { throw 'Target host private config differs; refusing to overwrite.' }
  }
  # Stop before moving OAuth state, to preserve the last issued tokens/codes.
  Invoke-Host $old 'stop'
  try {
    if (-not (Test-Path $newEnv)) { Copy-Item -LiteralPath (Join-Path $old '.env') -Destination $newEnv }
    $newStateDir = Join-Path $new '.state'
    New-Item -ItemType Directory -Path $newStateDir -Force | Out-Null
    foreach ($file in @('oauth.json', 'oauth.json.codes')) {
      $source = Join-Path (Join-Path $old '.state') $file
      if (Test-Path $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $newStateDir $file) -Force
      }
    }
    Invoke-Host $new 'start'
    Invoke-Host $new 'status'
  } catch {
    $reason = $_.Exception.Message
    try { Invoke-Host $new 'stop' } catch { Write-Warning ('New release cleanup: ' + $_.Exception.Message) }
    try { Invoke-Host $old 'start'; Invoke-Host $old 'status' }
    catch { throw "Activation failed ($reason), AND old release restart failed: $($_.Exception.Message)" }
    throw "Activation failed, previous release restored: $reason"
  }
}

if ($Action -eq 'status') {
  $s = Get-DeploymentState
  Write-Output "Active host: $($s.active) ($($s.tag)); previous: $($s.previous)"
  $active = Assert-LocalHostPath $s.active
  Invoke-Host $active 'status'
  return
}
if ($Action -eq 'check') {
  $s = Get-DeploymentState
  $latest = Get-ReleaseTag
  Write-Output "Active: $($s.tag); latest published Host release: $latest"
  return
}
if ($Action -in @('download', 'activate')) {
  $releaseTag = Get-ReleaseTag
  $directory = Receive-Release $releaseTag
  if ($Action -eq 'download') { Write-Output "Staged but not activated: $directory"; return }
  $s = Get-DeploymentState
  $relative = '.host-sync\releases\' + $releaseTag
  Switch-Host $s.active $relative
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  @{ active = $relative; previous = $s.active; tag = $releaseTag } |
    ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  Write-Output "Activated: $releaseTag (rollback available)."
  return
}
if ($Action -eq 'rollback') {
  $s = Get-DeploymentState
  if (-not $s.previous) { throw 'No previous release recorded.' }
  Switch-Host $s.active $s.previous
  $previousTag = if ($s.previous -eq 'host-runtime') { 'pre-release-local' } else { Split-Path $s.previous -Leaf }
  @{ active = $s.previous; previous = $s.active; tag = $previousTag } |
    ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  Write-Output "Rolled back to $previousTag."
}
