@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title 风起游戏
cd /d "%~dp0"

set "DEPLOYMENT_MODE="
if exist ".env" (
  for /f "tokens=1,* delims==" %%A in ('findstr /b "DEPLOYMENT_MODE=" ".env"') do set "DEPLOYMENT_MODE=%%B"
)

if not exist ".env" (
  set "DEPLOYMENT_MODE=native"
  where docker >nul 2>nul
  if not errorlevel 1 (
    docker info >nul 2>nul
    if not errorlevel 1 set "DEPLOYMENT_MODE=docker"
  )
  echo.
  echo 首次运行将使用 !DEPLOYMENT_MODE! 模式配置。
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0首次配置.ps1" -Mode !DEPLOYMENT_MODE!
  if errorlevel 1 (
    echo.
    echo [错误] 首次配置未完成。
    pause
    exit /b 1
  )
)

if not defined DEPLOYMENT_MODE (
  findstr /c:"@db:5432/" ".env" >nul 2>nul
  if errorlevel 1 (set "DEPLOYMENT_MODE=native") else set "DEPLOYMENT_MODE=docker"
)

set "SITE_ADDRESS=http://127.0.0.1:3000"
for /f "tokens=1,* delims==" %%A in ('findstr /b "SITE_ADDRESS=" ".env"') do set "SITE_ADDRESS=%%B"

if /i "%DEPLOYMENT_MODE%"=="docker" goto docker_mode
if /i "%DEPLOYMENT_MODE%"=="native" goto native_mode
echo [错误] .env 中 DEPLOYMENT_MODE 必须是 docker 或 native。
pause
exit /b 1

:docker_mode
where docker >nul 2>nul
if errorlevel 1 (
  echo [错误] 当前配置要求 Docker，但未检测到 Docker Desktop。
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo [错误] Docker 引擎尚未运行。可在 BIOS 开启 SVM 后继续使用该模式。
  pause
  exit /b 1
)
echo.
echo 正在构建并启动数据库、应用服务和反向代理...
docker compose up -d --build
if errorlevel 1 (
  echo [错误] 启动失败，请执行 docker compose logs 查看错误。
  pause
  exit /b 1
)
findstr /b "ADMIN_PASSWORD=" ".env" >nul 2>nul
if not errorlevel 1 (
  echo 正在等待初始管理员创建完成...
  powershell.exe -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ $id=docker compose ps -q app; if($id -and (docker inspect --format '{{.State.Health.Status}}' $id) -eq 'healthy'){$ok=$true;break}; Start-Sleep -Seconds 1 }; if(-not $ok){exit 1}"
  if errorlevel 1 (
    echo [错误] 应用未通过健康检查，管理员密码仍保留在 .env 以便排障重试。
    pause
    exit /b 1
  )
  powershell.exe -NoProfile -Command "$path=(Resolve-Path -LiteralPath '.env').Path; $lines=[IO.File]::ReadAllLines($path) | Where-Object { $_ -notmatch '^ADMIN_PASSWORD=' }; [IO.File]::WriteAllLines($path,$lines,(New-Object Text.UTF8Encoding($false)))"
  docker compose up -d --force-recreate app
)
echo.
echo Docker 服务已启动：%SITE_ADDRESS%
echo 管理命令：docker compose ps
echo 停止命令：docker compose down
start "" "%SITE_ADDRESS%"
pause
exit /b 0

:native_mode
echo.
echo 正在使用本机 PostgreSQL 构建、迁移并启动风起游戏...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0运维\启动本机服务.ps1"
if errorlevel 1 (
  echo.
  echo [错误] 本机服务启动失败，请检查 .runtime\app.stderr.log。
  pause
  exit /b 1
)
echo.
echo 本机服务已启动：%SITE_ADDRESS%
echo 运行日志：.runtime\app.stdout.log
echo 错误日志：.runtime\app.stderr.log
start "" "%SITE_ADDRESS%"
pause
