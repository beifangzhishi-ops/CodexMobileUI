# Release only committed, reproducible Windows Gateway/App Server source.
# The checkout's worktree must be clean; never publish someone else's WIP.
param(
  [switch]$Publish,
  [string]$Repository = 'beifangzhishi-ops/CodexMobileUI'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $branch = (& git branch --show-current).Trim()
  if ($branch -ne 'main') { throw 'Release only from checked main branch.' }
  $status = @(& git status --porcelain=v1 --untracked-files=all)
  if ($status.Count -ne 0) { throw 'Worktree is not clean; commit/resolve ongoing development before release.' }
  $head = (& git rev-parse HEAD).Trim()
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid application version.' }
  $tag = 'host-v' + $version + '-' + $head.Substring(0, 8)
  $output = '.tmp\host-release-' + $tag
  $archive = Join-Path $root ('.tmp\CodexMobileHost-' + $tag + '.zip')
  $shaFile = $archive + '.sha256'
  if (Test-Path $archive) { throw 'Release archive already exists; refusing to overwrite.' }

  & npm.cmd run typecheck:gateway
  if ($LASTEXITCODE -ne 0) { throw 'Gateway typecheck failed.' }
  & npm.cmd run build:gateway
  if ($LASTEXITCODE -ne 0) { throw 'Gateway compilation failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'package-mobile-host.ps1') -OutputDirectory $output
  if ($LASTEXITCODE -ne 0) { throw 'Host-only packaging failed.' }

  Compress-Archive -Path (Join-Path $root $output '*') -DestinationPath $archive -CompressionLevel Optimal
  $zipHash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  "$zipHash  $(Split-Path $archive -Leaf)" | Set-Content -LiteralPath $shaFile -Encoding ascii
  Write-Output "Host-only release verified: $tag"
  Write-Output "Archive SHA256: $zipHash"

  if ($Publish) {
    $remote = (& git remote get-url origin).Trim()
    if (-not $remote.EndsWith($Repository + '.git') -and -not $remote.EndsWith($Repository)) {
      throw 'Git origin does not match the expected release repository.'
    }
    & git tag -a $tag -m "Validated Windows host release $tag"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create immutable local release tag.' }
    & git push origin ('refs/tags/' + $tag)
    if ($LASTEXITCODE -ne 0) { throw 'Tag push failed; inspect the local tag before retrying.' }
    Write-Output "Published source tag $tag; GitHub Actions will build and release the host archive."
  } else {
    Write-Output 'Archive staged locally. Add -Publish after verifying source is ready.'
  }
} finally {
  Pop-Location
}
