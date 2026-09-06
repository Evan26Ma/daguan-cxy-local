@echo off
title Daguan Math Installer
setlocal
set "PACKAGE_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACKAGE_ROOT%packaging\windows\install.ps1" -PackageRoot "%PACKAGE_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] Installation failed. Please send the error above to the developer.
  pause
  exit /b 1
)
echo.
echo Installation completed. Press any key to close this window.
pause >nul
