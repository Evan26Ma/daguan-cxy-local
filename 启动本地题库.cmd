@echo off
chcp 65001 >nul
title 大观园本地数学题库 - Node 中控台
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
if errorlevel 1 (
  echo.
  echo [错误] 本地中控台启动失败，请查看上面的错误信息。
  pause
)
