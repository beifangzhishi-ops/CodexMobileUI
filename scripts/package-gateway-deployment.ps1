# Package the tested runtime for the second host. Never include private state.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$scratch = Join-Path $root '.tmp\gateway-deploy'
$archive = Join-Path $root '.tmp\codex-mobile-gateway-deploy.zip'
$gateway = Join-Path $root 'dist\gateway'
$ws = Join-Path $root 'node_modules\ws'
if (-not (Test-Path (Join-Path $gateway 'main.js')) -or
    -not (Test-Path (Join-Path $ws 'package.json'))) {
    throw 'Build gateway and install dependencies before packaging.'
}
if (Test-Path $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $scratch 'dist'),
    (Join-Path $scratch 'node_modules'), (Join-Path $scratch 'scripts') | Out-Null
Copy-Item -LiteralPath $gateway -Destination (Join-Path $scratch 'dist\gateway') -Recurse
Copy-Item -LiteralPath $ws -Destination (Join-Path $scratch 'node_modules\ws') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gateway-only.ps1') -Destination (Join-Path $scratch 'scripts\gateway-only.ps1')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'init-gateway-env.cjs') -Destination (Join-Path $scratch 'scripts\init-gateway-env.cjs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'probe-funnel-auth.cjs') -Destination (Join-Path $scratch 'scripts\probe-funnel-auth.cjs')
@'
# CodexMobileGateway runtime deployment

Generated from the maintained CodexMobileUI checkout on 6v. Do not edit
these JavaScript files locally or add secrets to the deployment ZIP.
Requires Node.js 24 and the independent Codex App Server on localhost 45789.
The mobile gateway listens only on localhost 48888. Tailscale Funnel HTTPS
8443 forwards to it, never directly to the Codex App Server.
Create a private .env with unique random secret; use .env.example as a guide.
Start/stop/status: scripts/gateway-only.ps1 (no shared launcher operations).
'@ | Set-Content -LiteralPath (Join-Path $scratch 'README.md') -Encoding utf8
@'
# Gateway deployment rules

Runtime-only deployment. Source, tests, docs and Git commits belong to the
primary CodexMobileUI repository on 6v, maintained through CCM.
Never start, stop, adopt or modify the independent Codex App Server, AOI,
Desktop or shared launcher. Never commit or share .env or .state files.
Only this Gateway's own local port 48888 and Funnel 8443 are controlled here.
'@ | Set-Content -LiteralPath (Join-Path $scratch 'AGENTS.md') -Encoding utf8
@'
MOBILE_PUBLIC_ORIGIN=https://your-node.example.ts.net:8443
MOBILE_APPROVAL_SECRET=replace-with-unique-cryptographically-random-secret
MOBILE_REDIRECT_URI=codexmobileui://oauth
MOBILE_GATEWAY_PORT=48888
CODEX_APP_SERVER_WS=ws://127.0.0.1:45789
'@ | Set-Content -LiteralPath (Join-Path $scratch '.env.example') -Encoding utf8
Compress-Archive -Path (Join-Path $scratch '*') -DestinationPath $archive -CompressionLevel Optimal -Force
Write-Output ('Gateway runtime ZIP created, bytes=' + (Get-Item $archive).Length)
