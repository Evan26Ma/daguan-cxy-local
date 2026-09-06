param(
  [Parameter(Mandatory = $true)]
  [string]$PackageRoot,

  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version 2.0

$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$SourceCandidates = @(
  Get-ChildItem -LiteralPath $PackageRoot -Filter "*.exe" -File |
    Where-Object { $_.Name -notmatch "(?i)^unins.*\.exe$" }
)

if ($SourceCandidates.Count -ne 1) {
  throw "The release folder must contain exactly one application executable. Extract the complete ZIP and try again."
}

$SourceExe = $SourceCandidates[0].FullName
$InstallRoot = Join-Path $env:LOCALAPPDATA "DaguanMath"
$InstallExe = Join-Path $InstallRoot $SourceCandidates[0].Name

if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) {
  throw "Application executable not found. Download and extract the complete GitHub Release ZIP first."
}

if ($ValidateOnly) {
  Write-Host "Installer validation passed."
  exit 0
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -LiteralPath $SourceExe -Destination $InstallExe -Force

$shell = New-Object -ComObject WScript.Shell
$startMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$displayName = [IO.Path]::GetFileNameWithoutExtension($InstallExe)
$shortcutName = "$displayName.lnk"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

function New-Shortcut([string]$Path) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $InstallExe
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.Description = "$displayName local edition"
  $shortcut.Save()
}

New-Shortcut (Join-Path $startMenu $shortcutName)
New-Shortcut (Join-Path $desktop $shortcutName)

Write-Host "Installed to: $InstallRoot"
Write-Host "Desktop and Start menu shortcuts created."
Start-Process -FilePath $InstallExe -WorkingDirectory $InstallRoot
