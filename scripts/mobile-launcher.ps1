param(
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$shell = (Get-Process -Id $PID).Path
$backendScript = Join-Path $PSScriptRoot 'mobile-app-server.ps1'
$gatewayScript = Join-Path $PSScriptRoot 'gateway-only.ps1'

function Invoke-HostService([string]$Script, [string]$Operation) {
  & $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Script -Action $Operation
  if ($LASTEXITCODE -ne 0) {
    throw ('MobileUI ' + (Split-Path $Script -Leaf) + ' ' + $Operation + ' failed (' + $LASTEXITCODE + ')')
  }
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
  }
} catch {
  Write-Error ('CodexMobileUI launcher: ' + $_.Exception.Message)
  exit 1
}
