param([switch]$StopOnly)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
$runtimeDir = Join-Path $root '.runtime'
$pidPath = Join-Path $runtimeDir 'app-process.json'
$stdoutPath = Join-Path $runtimeDir 'app.stdout.log'
$stderrPath = Join-Path $runtimeDir 'app.stderr.log'

if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env，请先执行首次配置。' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未检测到 Node.js。' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '未检测到 npm。' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
if ($settings['DEPLOYMENT_MODE'] -ne 'native') { throw '.env 不是本机原生运行模式。' }
$port = if ($settings['PORT']) { [int]$settings['PORT'] } else { 3000 }
$healthUrl = "http://127.0.0.1:$port/api/system/health"

function Get-ManagedProcess {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  try {
    $record = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    $candidate = Get-Process -Id ([int]$record.pid) -ErrorAction Stop
    $recordedStart = if ($record.startedAt -is [DateTime]) {
      $record.startedAt.ToUniversalTime()
    } else {
      [DateTime]::Parse(
        [string]$record.startedAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
      ).ToUniversalTime()
    }
    $sameStart = [Math]::Abs(($candidate.StartTime.ToUniversalTime() - $recordedStart).TotalSeconds) -lt 2
    if ($candidate.ProcessName -eq 'node' -and $sameStart) { return $candidate }
  } catch { }
  return $null
}

function Stop-ManagedProcess {
  $managed = Get-ManagedProcess
  if (-not $managed) { return $false }
  Stop-Process -Id $managed.Id
  $managed.WaitForExit(5000) | Out-Null
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  return $true
}

if ($StopOnly) {
  $stopped = Stop-ManagedProcess
  if (-not $stopped) {
    try {
      $existingHealth = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($existingHealth.data.status -eq 'ok') {
        throw "端口 $port 存在不受本项目 PID 文件管理的健康服务，已拒绝停止。"
      }
    } catch {
      if ($_.Exception.Message -like '端口 *') { throw }
    }
  }
  Write-Host '本机应用服务已停止。' -ForegroundColor Green
  exit 0
}

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
  }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw '生产构建失败。' }
  npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败。' }
} finally { Pop-Location }

[IO.Directory]::CreateDirectory($runtimeDir) | Out-Null
$managedStopped = Stop-ManagedProcess
if (-not $managedStopped) {
  try {
    $existingHealth = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($existingHealth.data.status -eq 'ok') {
      throw "端口 $port 已有一个不受本项目 PID 文件管理的健康服务，请先手工确认后再启动。"
    }
  } catch {
    if ($_.Exception.Message -like '端口 *') { throw }
  }
}

Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
$nodePath = (Get-Command node).Source
$process = Start-Process -FilePath $nodePath `
  -ArgumentList 'server/index.js' `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru
$record = @{
  pid = $process.Id
  startedAt = $process.StartTime.ToUniversalTime().ToString('O')
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText($pidPath, $record, (New-Object Text.UTF8Encoding($false)))

$healthy = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  Start-Sleep -Seconds 1
  if ($process.HasExited) { break }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.data.status -eq 'ok') { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  $details = if (Test-Path -LiteralPath $stderrPath) {
    (Get-Content -LiteralPath $stderrPath -Tail 20) -join [Environment]::NewLine
  } else { '没有生成错误日志。' }
  throw "本机服务未能通过健康检查。$([Environment]::NewLine)$details"
}

Write-Host "本机服务已启动并通过健康检查：$healthUrl" -ForegroundColor Green
