param([int]$RetentionDays = 14)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env，请先执行首次配置。' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$mode = if ($settings['DEPLOYMENT_MODE']) { $settings['DEPLOYMENT_MODE'] } else { 'docker' }
$backupDir = Join-Path $root 'backups'
[IO.Directory]::CreateDirectory($backupDir) | Out-Null
$baseName = "fengqi-uploads-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$name = "$baseName.tar.gz"
$sequence = 1
while (Test-Path -LiteralPath (Join-Path $backupDir $name)) {
  $name = "$baseName-$sequence.tar.gz"
  $sequence++
}
$targetPath = Join-Path $backupDir $name

function Wait-DockerAppHealthy {
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    $appId = docker compose ps -q app
    if ($appId -and (docker inspect --format '{{.State.Health.Status}}' $appId) -eq 'healthy') { return }
    Start-Sleep -Seconds 1
  }
  throw '上传卷备份后应用未通过健康检查。'
}

if ($mode -eq 'docker') {
  Push-Location $root
  try {
    $appId = (docker compose ps -a -q app).Trim()
    if (-not $appId) { throw '未找到应用容器，请先启动 Docker 服务。' }
    $image = (docker inspect --format '{{.Config.Image}}' $appId).Trim()
    $volume = (docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' $appId).Trim()
    if (-not $image -or -not $volume) { throw '无法识别应用镜像或 uploads_data 卷。' }
    $wasRunning = (docker inspect --format '{{.State.Running}}' $appId) -eq 'true'
    if ($wasRunning) {
      docker compose stop app
      if ($LASTEXITCODE -ne 0) { throw '停止应用写入失败。' }
    }
    try {
      docker run --rm --user 0 `
        --mount "type=volume,source=$volume,target=/source,readonly" `
        --mount "type=bind,source=$backupDir,target=/backup" `
        --entrypoint tar $image -czf "/backup/$name" -C /source .
      if ($LASTEXITCODE -ne 0) { throw '上传卷快照失败。' }
    } finally {
      if ($wasRunning) {
        docker compose start app
        if ($LASTEXITCODE -ne 0) { throw '上传卷快照结束后应用启动失败。' }
        Wait-DockerAppHealthy
      }
    }
  } finally { Pop-Location }
} elseif ($mode -eq 'native') {
  $uploadsDir = Join-Path $root 'uploads'
  [IO.Directory]::CreateDirectory($uploadsDir) | Out-Null
  $port = if ($settings['PORT']) { [int]$settings['PORT'] } else { 3000 }
  $wasRunning = $false
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/system/health" -TimeoutSec 2
    $wasRunning = $health.data.status -eq 'ok'
  } catch { }
  if ($wasRunning) { & (Join-Path $PSScriptRoot '启动本机服务.ps1') -StopOnly }
  try {
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $tar) { throw '未找到 tar.exe，无法生成上传目录快照。' }
    & $tar -czf $targetPath -C $uploadsDir .
    if ($LASTEXITCODE -ne 0) { throw '上传目录快照失败。' }
  } finally {
    if ($wasRunning) { & (Join-Path $PSScriptRoot '启动本机服务.ps1') }
  }
} else { throw 'DEPLOYMENT_MODE 必须是 docker 或 native。' }

if (-not (Test-Path -LiteralPath $targetPath) -or (Get-Item -LiteralPath $targetPath).Length -le 0) {
  throw '上传文件快照未生成或文件为空。'
}
Get-ChildItem -LiteralPath $backupDir -Filter 'fengqi-uploads-*.tar.gz' -File |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) |
  Remove-Item -Force
Write-Host "上传文件快照完成：$targetPath" -ForegroundColor Green
