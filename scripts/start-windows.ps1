$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NodeVersion = "20.19.3"
$RuntimeDir = Join-Path $Root ".runtime\node-v$NodeVersion-win-x64"
$NodeExe = Join-Path $RuntimeDir "node.exe"
$NpmCmd = Join-Path $RuntimeDir "npm.cmd"
$NodeZip = Join-Path $Root ".runtime\node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$NodeSha256 = "ee50fe3af2e4b43aef655c5126e0e4d995a391a787a9327596563a722ada2aa9"

function Find-Node {
  try {
    $candidate = (Get-Command node -ErrorAction Stop).Source
    $version = (& $candidate --version).Trim().TrimStart("v")
    if ([version]$version -ge [version]"20.0.0") { return $candidate }
  } catch {}
  return $null
}

function Ensure-Node {
  $systemNode = Find-Node
  if ($systemNode) { return @{ Node = $systemNode; Npm = (Get-Command npm.cmd).Source } }
  if (-not (Test-Path $NodeExe)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $NodeZip) | Out-Null
    Write-Host "Node.js 20 was not found. Downloading the portable runtime..."
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeZip).Hash.ToLowerInvariant()
    if ($actual -ne $NodeSha256) {
      Remove-Item -LiteralPath $NodeZip -Force -ErrorAction SilentlyContinue
      throw "Node.js download checksum failed. Expected $NodeSha256, got $actual"
    }
    $extractRoot = Join-Path $Root ".runtime\extract"
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $NodeZip -DestinationPath $extractRoot -Force
    $folder = Join-Path $extractRoot "node-v$NodeVersion-win-x64"
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Copy-Item -Path (Join-Path $folder "*") -Destination $RuntimeDir -Recurse -Force
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  if (-not (Test-Path $NodeExe)) { throw "Node.js runtime installation failed: $NodeExe" }
  return @{ Node = $NodeExe; Npm = $NpmCmd }
}

$runtime = Ensure-Node
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\cxyonly-backups") | Out-Null
Write-Host "Checking Node dependencies..."
& $runtime.Npm ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

$port = 8080
while ($true) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
    if ($health.service -eq "daguan-local-console") {
      Write-Host "The local console is already running on port $port."
      Start-Process "http://127.0.0.1:$port/"
      exit 0
    }
  } catch {}
  try {
    $busy = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop).Count -gt 0
  } catch {
    $busy = $false
  }
  if (-not $busy) { break }
  $port += 1
}

$env:PORT = [string]$port
Write-Host "Starting the local console at http://127.0.0.1:$port/"
Start-Process "http://127.0.0.1:$port/"
Write-Host "The console is running. Close this window to stop the service."
& $runtime.Node (Join-Path $Root "local-server\server.mjs")
