param(
  [string]$InstallRootOverride,
  [string]$StartMenuRootOverride,
  [string]$DesktopRootOverride,
  [string]$DataDirectoryOverride
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$InstallRoot = if ($InstallRootOverride) { [IO.Path]::GetFullPath($InstallRootOverride) } else { Join-Path $env:LOCALAPPDATA "DaguanMathBrowser" }
$ProgramsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$StartMenu = if ($StartMenuRootOverride) { [IO.Path]::GetFullPath($StartMenuRootOverride) } else { Join-Path $ProgramsRoot "大观园浏览器本地版" }
$Desktop = if ($DesktopRootOverride) { [IO.Path]::GetFullPath($DesktopRootOverride) } else { [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory) }
$dataDir = if ($DataDirectoryOverride) { [IO.Path]::GetFullPath($DataDirectoryOverride) } else { Join-Path $env:LOCALAPPDATA "DaguanMath\data" }
$resolvedInstall = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ([IO.Path]::GetFileName($resolvedInstall) -notin @("DaguanMathBrowser", "DaguanMath")) { throw "Refusing to uninstall from an unexpected directory: $resolvedInstall" }
$lockPath = Join-Path $dataDir ".service-instance.json"
$installExe = Join-Path $resolvedInstall "DaguanMath-windows-x64.exe"
if ((Test-Path -LiteralPath $lockPath -PathType Leaf) -and (Test-Path -LiteralPath $installExe -PathType Leaf)) {
  try {
    $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$owner.pid)" -ErrorAction Stop
    if ($process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath) -eq [IO.Path]::GetFullPath($installExe)) {
      & (Join-Path $resolvedInstall "stop-daguan-service.ps1") -DataDirectory $dataDir
    }
  } catch { Write-Warning "The browser package service could not be stopped automatically. Close that process before deleting its files. Shared data is preserved."; throw }
}

foreach ($shortcutName in @("大观园浏览器本地版.lnk", "停止浏览器本地服务.lnk", "卸载浏览器本地版.lnk")) {
  Remove-Item -LiteralPath (Join-Path $StartMenu $shortcutName) -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $Desktop) { Remove-Item -LiteralPath (Join-Path $Desktop "大观园浏览器本地版.lnk") -Force -ErrorAction SilentlyContinue }
if ((Test-Path -LiteralPath $StartMenu) -and -not (Get-ChildItem -LiteralPath $StartMenu -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $StartMenu -Force }

foreach ($fileName in @("DaguanMath-windows-x64.exe", "bundle.sha256", "LaunchDaguanMath.vbs", "uninstall-browser-package.ps1", "stop-daguan-service.ps1")) {
  Remove-Item -LiteralPath (Join-Path $resolvedInstall $fileName) -Force -ErrorAction SilentlyContinue
}
$appDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedInstall "app"))
if ($dataDir -eq $appDirectory -or $dataDir.StartsWith($appDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $appDirectory.StartsWith($dataDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove an application directory containing shared data: $dataDir" }
if ($appDirectory.StartsWith($resolvedInstall + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $appDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
if ((Test-Path -LiteralPath $resolvedInstall -PathType Container) -and -not (Get-ChildItem -LiteralPath $resolvedInstall -Force | Select-Object -First 1)) {
  Remove-Item -LiteralPath $resolvedInstall -Force
}
Write-Host "Browser package uninstalled. Shared learning data was preserved at: $dataDir"
