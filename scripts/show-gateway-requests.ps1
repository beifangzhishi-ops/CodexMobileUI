# Read only the allowlisted local Gateway request journal.
# Does not read OAuth state, environment variables, tokens, or HTTP payloads.
param(
    [ValidateRange(1, 10080)]
    [int]$Minutes = 30,
    [ValidateRange(1, 500)]
    [int]$Limit = 80,
    [ValidateSet('all', 'android', 'oauth')]
    [string]$Filter = 'all'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$base = Join-Path $root '.state\mobile-gateway-requests.jsonl'
$cutoff = [DateTimeOffset]::UtcNow.AddMinutes(-$Minutes)
$files = @("$base.2", "$base.1", "$base") |
    Where-Object { Test-Path -LiteralPath $_ }
if ($files.Count -eq 0) {
    Write-Output 'No persistent Gateway requests yet. The updated Gateway must be running.'
    return
}
$records = @(
    foreach ($file in $files) {
        foreach ($line in (Get-Content -LiteralPath $file -Encoding UTF8)) {
            if (-not $line) { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $at = [DateTimeOffset]::Parse([string]$entry.at)
                if ($at -lt $cutoff) { continue }
                if ($Filter -eq 'android' -and $entry.client -ne 'android') { continue }
                if ($Filter -eq 'oauth' -and $entry.route -notlike 'oauth.*') { continue }
                [pscustomobject]@{
                    AtUtc = $at.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss.fff')
                    Session = $entry.session
                    RequestId = $entry.requestId
                    Event = $entry.event
                    Route = $entry.route
                    Client = $entry.client
                    Method = $entry.method
                    Status = $entry.status
                    ElapsedMs = $entry.elapsedMs
                    Decision = $entry.decision
                    CloseCode = $entry.closeCode
                }
            } catch {
                # Ignore partial final JSONL lines rather than dumping raw data.
            }
        }
    }
)
Write-Output ('Gateway events in last ' + $Minutes + ' minutes: ' + $records.Count)
$records | Select-Object -Last $Limit | Format-Table -AutoSize -Wrap
