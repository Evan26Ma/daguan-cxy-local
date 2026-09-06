@echo off
chcp 65001 >nul
title 安装大观园数学题库
setlocal
set "PACKAGE_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACKAGE_ROOT%packaging\windows\install.ps1" -PackageRoot "%PACKAGE_ROOT%"
if errorlevel 1 (
  echo.
  echo [错误] 安装失败，请把上面的错误信息发给开发者。
  pause
  exit /b 1
)
echo.
echo 安装完成。按任意键关闭窗口。
pause >nul
