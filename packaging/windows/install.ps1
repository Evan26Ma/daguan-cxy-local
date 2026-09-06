param(
  [Parameter(Mandatory = $true)]
  [string]$PackageRoot
)

$ErrorActionPreference = "Stop"
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$SourceExe = Join-Path $PackageRoot "大观园数学题库.exe"
$InstallRoot = Join-Path $env:LOCALAPPDATA "DaguanMath"
$InstallExe = Join-Path $InstallRoot "大观园数学题库.exe"

if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) {
  throw "找不到安装包内的 大观园数学题库.exe。请从 GitHub Release 下载完整压缩包并先解压。"
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -LiteralPath $SourceExe -Destination $InstallExe -Force

$shell = New-Object -ComObject WScript.Shell
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$desktop = [Environment]::GetFolderPath("Desktop")
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

function New-Shortcut([string]$Path) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $InstallExe
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.Description = "大观园数学题库本地版"
  $shortcut.Save()
}

New-Shortcut (Join-Path $startMenu "大观园数学题库.lnk")
New-Shortcut (Join-Path $desktop "大观园数学题库.lnk")

Write-Host "已安装到：$InstallRoot"
Write-Host "已创建开始菜单和桌面快捷方式。"
Start-Process -FilePath $InstallExe -WorkingDirectory $InstallRoot
