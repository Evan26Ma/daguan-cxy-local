param(
  [Parameter(Mandatory = $true)] [string]$PackageRoot,
  [string]$InstallRootOverride,
  [string]$StartMenuRootOverride,
  [string]$DesktopRootOverride,
  [switch]$ValidateOnly,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version 2.0
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$SourceCandidates = @(Get-ChildItem -LiteralPath $PackageRoot -Filter "DaguanMath-windows-x64.exe" -File)
if ($SourceCandidates.Count -ne 1) { throw "The browser package must contain DaguanMath-windows-x64.exe." }
$SourceExe = $SourceCandidates[0].FullName
$ScriptFiles = @("uninstall.ps1", "stop-service.ps1")
foreach ($scriptName in $ScriptFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot "packaging\windows\$scriptName") -PathType Leaf)) { throw "Package is missing packaging\windows\$scriptName." }
}
if ($ValidateOnly) { Write-Host "Browser package validation passed."; exit 0 }

$InstallRoot = if ($InstallRootOverride) { [IO.Path]::GetFullPath($InstallRootOverride) } else { Join-Path $env:LOCALAPPDATA "DaguanMathBrowser" }
$ProgramsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$StartMenu = if ($StartMenuRootOverride) { [IO.Path]::GetFullPath($StartMenuRootOverride) } else { Join-Path $ProgramsRoot "大观园浏览器本地版" }
$Desktop = if ($DesktopRootOverride) { [IO.Path]::GetFullPath($DesktopRootOverride) } else { [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory) }
$SharedDataRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "DaguanMath\data")).TrimEnd([IO.Path]::DirectorySeparatorChar)
$ResolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($SharedDataRoot.StartsWith($ResolvedInstallRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $ResolvedInstallRoot.StartsWith($SharedDataRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $ResolvedInstallRoot -eq $SharedDataRoot) { throw "Program install root must stay separate from shared learning data: $ResolvedInstallRoot" }
$InstallExe = Join-Path $InstallRoot "DaguanMath-windows-x64.exe"
New-Item -ItemType Directory -Force -Path $InstallRoot, $StartMenu, $Desktop | Out-Null
Copy-Item -LiteralPath $SourceExe -Destination $InstallExe -Force
Copy-Item -LiteralPath (Join-Path $PackageRoot "packaging\windows\uninstall.ps1") -Destination (Join-Path $InstallRoot "uninstall-browser-package.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PackageRoot "packaging\windows\stop-service.ps1") -Destination (Join-Path $InstallRoot "stop-daguan-service.ps1") -Force

$escapedExe = $InstallExe.Replace('"', '""')
$launcher = Join-Path $InstallRoot "LaunchDaguanMath.vbs"
@("Set shell = CreateObject(""WScript.Shell"")", "shell.Run ""$escapedExe"", 0, False") | Set-Content -LiteralPath $launcher -Encoding Ascii
$shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.Description = $Description
  $shortcut.Save()
}
$launcherArg = '"' + $launcher + '"'
$powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
New-Shortcut (Join-Path $StartMenu "大观园浏览器本地版.lnk") $wscript $launcherArg "启动本地浏览器版；在默认浏览器打开学习页"
New-Shortcut (Join-Path $StartMenu "停止浏览器本地服务.lnk") $powershell ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot "stop-daguan-service.ps1") + '"') "平稳停止浏览器版本地学习服务"
New-Shortcut (Join-Path $StartMenu "卸载浏览器本地版.lnk") $powershell ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot "uninstall-browser-package.ps1") + '" -InstallRootOverride "' + $InstallRoot + '" -StartMenuRootOverride "' + $StartMenu + '"') "卸载浏览器版程序但保留共享学习记录"
New-Shortcut (Join-Path $Desktop "大观园浏览器本地版.lnk") $wscript $launcherArg "启动本地浏览器版；在默认浏览器打开学习页"
Write-Host "Installed browser package to: $InstallRoot"
$DataRoot = Join-Path $env:LOCALAPPDATA "DaguanMath\data"
Write-Host "Shared data remains at: $DataRoot"
Write-Host "Browser edition shortcuts created: launch, stop service, and uninstall."
if (-not $NoLaunch) { Start-Process -FilePath $wscript -ArgumentList $launcherArg -WindowStyle Hidden }
