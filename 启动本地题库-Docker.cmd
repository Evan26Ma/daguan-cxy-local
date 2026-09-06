@echo off
chcp 65001 >nul
title 大观园本地数学题库 - Docker 启动

cd /d "%~dp0"

echo ===================================================
echo       大观园本地数学题库 - Docker Compose 启动
echo ===================================================
echo.

where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未检测到 Docker 环境！
    echo 请先安装并启动 Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo 正在启动 Docker 容器...
docker compose -f deploy/docker-compose.yml up -d --build

if %ERRORLEVEL% equ 0 (
    echo.
    echo 容器启动成功！正在打开浏览器...
    start "" http://localhost:8080/
    echo 访问地址: http://localhost:8080/
) else (
    echo.
    echo [错误] Docker 启动失败，请检查 Docker Desktop 是否正在运行。
)
pause
