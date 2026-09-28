param([string]$DataDirectory)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
if (-not $DataDirectory) {
  $DataDirectory = if ($env:DAGUAN_DATA_DIR) { $env:DAGUAN_DATA_DIR } else { Join-Path $env:LOCALAPPDATA "DaguanMath\data" }
}
$lockPath = Join-Path ([IO.Path]::GetFullPath($DataDirectory)) ".service-instance.json"
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { Write-Host "No shared local service is running."; exit 0 }
$owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($owner.host -ne "127.0.0.1" -or -not [int]$owner.port -or -not $owner.instanceId) { throw "Invalid service instance file; no process was stopped." }
$uri = "http://127.0.0.1:$([int]$owner.port)/api/health"
$health = Invoke-RestMethod -Uri $uri -TimeoutSec 2
if ($health.instanceId -ne $owner.instanceId -or $health.apiProtocol -ne $owner.apiProtocol) { throw "The lock does not match the service health check; no process was stopped." }
$origin = "http://127.0.0.1:$([int]$owner.port)"
Invoke-RestMethod -Uri "$origin/api/runtime/stop" -Method Post -Headers @{ Origin = $origin } -ContentType "application/json" -Body "{}" | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 250
  try { $null = Invoke-RestMethod -Uri $uri -TimeoutSec 1 }
  catch { Write-Host "Local service stopped cleanly."; exit 0 }
}
throw "Service did not stop within 15 seconds. No lock file was manually removed."
