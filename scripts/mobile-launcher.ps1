param(
  [ValidateSet('start', 'stop', 'status', 'logon')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$shell = (Get-Process -Id $PID).Path
$backendScript = Join-Path $PSScriptRoot 'mobile-app-server.ps1'
$gatewayScript = Join-Path $PSScriptRoot 'gateway-only.ps1'
$tailnetManifest = Join-Path (Split-Path -Parent $PSScriptRoot) '.state\mobile-tailnet-hosts.json'

function Invoke-HostService([string]$Script, [string]$Operation) {
  & $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Script -Action $Operation
  if ($LASTEXITCODE -ne 0) {
    throw ('MobileUI ' + (Split-Path $Script -Leaf) + ' ' + $Operation + ' failed (' + $LASTEXITCODE + ')')
  }
}

function Get-EligibleTailnetAddresses {
  # Mirror gateway/main.ts: configured manifest addresses on a Tailscale-named
  # IPv4 network interface. This only inspects local adapters and never binds.
  if (-not (Test-Path -LiteralPath $tailnetManifest -PathType Leaf)) {
    throw "Missing private Tailnet host manifest: $tailnetManifest"
  }
  $manifestText = Get-Content -LiteralPath $tailnetManifest -Raw
  if (-not $manifestText.TrimStart().StartsWith('[')) {
    throw 'Invalid Tailnet host manifest: expected a JSON array.'
  }
  $parsed = $manifestText | ConvertFrom-Json
  $entries = @($parsed)
  if ($entries.Count -lt 1 -or $entries.Count -gt 16) {
    throw 'Invalid Tailnet host manifest: expected 1 to 16 entries.'
  }

  $configured = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($entry in $entries) {
    if ($null -eq $entry) { throw 'Invalid Tailnet host manifest entry.' }
    $properties = @($entry.PSObject.Properties.Name)
    if ($properties -cnotcontains 'name' -or
        $properties -cnotcontains 'url' -or
        $entry.name -isnot [string] -or
        $entry.url -isnot [string]) {
      throw 'Invalid Tailnet host manifest entry.'
    }
    $name = [string]$entry.name
    $url = [string]$entry.url
    if ($name -notmatch '^[A-Za-z0-9_-]{1,32}$' -or
        $url -notmatch '^http://100\.\d{1,3}\.\d{1,3}\.\d{1,3}:48889$' -or
        -not $names.Add($name)) {
      throw 'Invalid Tailnet host manifest entry.'
    }
    $configured.Add(([Uri]$url).Host) | Out-Null
  }

  $addresses = [Collections.Generic.List[string]]::new()
  foreach ($network in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($network.Name -notmatch 'tailscale') { continue }
    foreach ($unicast in $network.GetIPProperties().UnicastAddresses) {
      if ($unicast.Address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
          [Net.IPAddress]::IsLoopback($unicast.Address)) {
        continue
      }
      $address = $unicast.Address.ToString()
      if ($configured.Contains($address)) {
        $addresses.Add($address)
      }
    }
  }
  return @($addresses)
}

function Wait-ForSingleTailnetAddress {
  $deadline = (Get-Date).AddSeconds(120)
  $lastCount = -1
  do {
    $addresses = @(Get-EligibleTailnetAddresses)
    $lastCount = $addresses.Count
    if ($lastCount -eq 1) { return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw ('Expected exactly one configured local Tailscale IPv4 address before Gateway startup; found ' + $lastCount + ' after 120 seconds.')
}

function Start-LogonServices {
  # App Server is idempotent and verifies its private runtime, owner and readiness.
  Invoke-HostService $backendScript 'start'
  Wait-ForSingleTailnetAddress
  # Re-check the backend after waiting so Gateway never starts against a lost process.
  Invoke-HostService $backendScript 'start'
  Invoke-HostService $gatewayScript 'start'
}

try {
  switch ($Action) {
    'start' {
      Invoke-HostService $backendScript 'start'
      Invoke-HostService $gatewayScript 'start'
      Write-Output 'CodexMobileUI services ready: dedicated App Server and authenticated Gateway.'
    }
    'stop' {
      # The Gateway is disconnected first. Stop only MobileUI-owned processes.
      Invoke-HostService $gatewayScript 'stop'
      Invoke-HostService $backendScript 'stop'
    }
    'status' {
      Invoke-HostService $backendScript 'status'
      Invoke-HostService $gatewayScript 'status'
    }
    'logon' {
      Start-LogonServices
      Write-Output 'CodexMobileUI logon startup ready: isolated App Server and authenticated Gateway.'
    }
  }
} catch {
  [Console]::Error.WriteLine('CodexMobileUI launcher: ' + $_.Exception.Message)
  exit 1
}
