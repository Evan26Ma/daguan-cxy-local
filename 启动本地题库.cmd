@echo off
chcp 65001 >nul
title 大观园本地数学题库

cd /d "%~dp0"

echo ===================================================
echo           大观园本地数学题库 - 启动程序
echo ===================================================
echo.

set "PY_CMD="

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    py -3 --version >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    where python >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        set "PY_CMD=python"
    )
)

if "%PY_CMD%"=="" (
    echo [错误] 未检测到 Python 环境！
    echo.
    echo 运行本地题库需要 Python 3。
    echo 请前往 Python 官网下载并安装: https://www.python.org/downloads/
    echo 安装时请勾选 "Add python.exe to PATH"（添加到环境变量）。
    echo.
    echo 安装完成后，请重新双击此脚本。
    echo.
    pause
    exit /b 1
)

echo [1/2] 正在启动本地 HTTP 服务器 (端口 8080)...
echo 服务目录: %~dp0web
echo.
echo 提示: 请保持此命令行窗口打开。刷题完成后关闭此窗口即可退出。
echo.

start "" http://localhost:8080/

echo [2/2] 正在启动浏览器访问 http://localhost:8080/ ...
echo.
%PY_CMD% -m http.server 8080 --directory web

if %ERRORLEVEL% neq 0 (
    echo.
    echo [提示] 服务已停止或端口 8080 被占用。
    pause
)
