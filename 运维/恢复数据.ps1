param([Parameter(Mandatory = $true)][string]$BackupPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if ([IO.Path]::GetExtension($resolvedBackup) -ne '.dump') { throw '只允许恢复 .dump 备份文件。' }
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env。' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$database = $settings['POSTGRES_DB']
$user = $settings['POSTGRES_USER']
$mode = if ($settings['DEPLOYMENT_MODE']) { $settings['DEPLOYMENT_MODE'] } else { 'docker' }
$confirmation = Read-Host "恢复会覆盖当前数据库。请输入数据库名 $database 确认"
if ($confirmation -ne $database) { throw '确认内容不匹配，已取消恢复。' }

if ($mode -eq 'native') {
  $databaseUrl = [Uri]$settings['DATABASE_URL']
  $pgRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
  if (-not $pgRestore) {
    $pgRestore = Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
      Where-Object Name -Match '^\d+$' |
      Sort-Object { [int]$_.Name } -Descending |
      ForEach-Object { Join-Path $_.FullName 'bin\pg_restore.exe' } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
  }
  if (-not $pgRestore) { throw '未找到本机 pg_restore.exe。' }
  & (Join-Path $PSScriptRoot '启动本机服务.ps1') -StopOnly
  $env:PGPASSWORD = $settings['POSTGRES_PASSWORD']
  try {
    & $pgRestore -h $databaseUrl.Host -p $databaseUrl.Port -U $user -d $database --clean --if-exists --no-owner --no-privileges --exit-on-error $resolvedBackup
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore 执行失败；应用保持停止，请先检查数据库。' }
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  & (Join-Path $PSScriptRoot '启动本机服务.ps1')
} elseif ($mode -eq 'docker') {
  $containerPath = '/tmp/fengqi-restore.dump'
  Push-Location $root
  try {
    docker compose stop app
    docker compose cp $resolvedBackup "db:$containerPath"
    if ($LASTEXITCODE -ne 0) { throw '备份文件复制失败。' }
    docker compose exec -T db pg_restore -U $user -d $database --clean --if-exists --no-owner --no-privileges $containerPath
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore 执行失败。' }
    docker compose exec -T db rm -f $containerPath
    docker compose start app
  } finally { Pop-Location }
} else { throw 'DEPLOYMENT_MODE 必须是 docker 或 native。' }
Write-Host '数据库恢复完成，应用服务已重新启动。' -ForegroundColor Green
