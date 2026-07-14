param([Parameter(Mandatory = $true)][string]$SnapshotPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolvedSnapshot = (Resolve-Path -LiteralPath $SnapshotPath).Path
if (-not $resolvedSnapshot.EndsWith('.tar.gz', [StringComparison]::OrdinalIgnoreCase)) {
  throw '只允许恢复 .tar.gz 上传文件快照。'
}
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env。' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$mode = if ($settings['DEPLOYMENT_MODE']) { $settings['DEPLOYMENT_MODE'] } else { 'docker' }
$confirmationTarget = if ($mode -eq 'docker') { 'uploads_data' } else { 'uploads' }
$confirmation = Read-Host "恢复会覆盖全部上传文件。请输入 $confirmationTarget 确认"
if ($confirmation -ne $confirmationTarget) { throw '确认内容不匹配，已取消恢复。' }

Write-Host '正在创建恢复前上传文件安全快照...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot '备份上传文件.ps1')
$safetySnapshot = Get-ChildItem -LiteralPath (Join-Path $root 'backups') -Filter 'fengqi-uploads-*.tar.gz' -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $safetySnapshot -or $safetySnapshot.Length -le 0) { throw '恢复前上传文件安全快照未生成或文件为空。' }

function Assert-SafeArchiveEntries([string[]]$Entries) {
  foreach ($entry in $Entries) {
    $normalized = $entry.Replace('\', '/')
    if ($normalized.StartsWith('/') -or $normalized -match '(^|/)\.\.(/|$)') {
      throw "快照包含不安全路径：$entry"
    }
  }
}

function Wait-DockerAppHealthy {
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    $appId = docker compose ps -q app
    if ($appId -and (docker inspect --format '{{.State.Health.Status}}' $appId) -eq 'healthy') { return }
    Start-Sleep -Seconds 1
  }
  throw '上传卷恢复后应用未通过健康检查。'
}

if ($mode -eq 'docker') {
  Push-Location $root
  try {
    $appId = (docker compose ps -a -q app).Trim()
    if (-not $appId) { throw '未找到应用容器，请先启动 Docker 服务。' }
    $image = (docker inspect --format '{{.Config.Image}}' $appId).Trim()
    $volume = (docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' $appId).Trim()
    if (-not $image -or -not $volume) { throw '无法识别应用镜像或 uploads_data 卷。' }
    $snapshotMount = "type=bind,source=$resolvedSnapshot,target=/snapshot.tar.gz,readonly"
    $entries = docker run --rm --user 0 --mount $snapshotMount --entrypoint tar $image -tzf /snapshot.tar.gz
    if ($LASTEXITCODE -ne 0) { throw '上传文件快照校验失败。' }
    Assert-SafeArchiveEntries @($entries)
    docker compose stop app
    if ($LASTEXITCODE -ne 0) { throw '停止应用写入失败。' }
    docker run --rm --user 0 `
      --mount "type=volume,source=$volume,target=/target" `
      --mount $snapshotMount `
      --entrypoint sh $image -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /snapshot.tar.gz -C /target'
    if ($LASTEXITCODE -ne 0) {
      throw "上传卷恢复失败，应用保持停止。可使用安全快照恢复：$($safetySnapshot.FullName)"
    }
    docker compose start app
    if ($LASTEXITCODE -ne 0) { throw '上传卷已恢复，但应用启动失败。' }
    Wait-DockerAppHealthy
  } finally { Pop-Location }
} elseif ($mode -eq 'native') {
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
  if (-not $tar) { throw '未找到 tar.exe，无法恢复上传目录。' }
  $entries = & $tar -tzf $resolvedSnapshot
  if ($LASTEXITCODE -ne 0) { throw '上传文件快照校验失败。' }
  Assert-SafeArchiveEntries @($entries)
  $uploadsDir = [IO.Path]::GetFullPath((Join-Path $root 'uploads'))
  $rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $uploadsDir.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw '上传目录不在项目根目录内，拒绝恢复。'
  }
  & (Join-Path $PSScriptRoot '启动本机服务.ps1') -StopOnly
  Get-ChildItem -LiteralPath $uploadsDir -Force | Remove-Item -Recurse -Force
  & $tar -xzf $resolvedSnapshot -C $uploadsDir
  if ($LASTEXITCODE -ne 0) {
    throw "上传目录恢复失败，应用保持停止。可使用安全快照恢复：$($safetySnapshot.FullName)"
  }
  & (Join-Path $PSScriptRoot '启动本机服务.ps1')
} else { throw 'DEPLOYMENT_MODE 必须是 docker 或 native。' }

Write-Host "上传文件恢复完成，应用已重新启动并通过健康检查。恢复前安全快照：$($safetySnapshot.FullName)" -ForegroundColor Green
