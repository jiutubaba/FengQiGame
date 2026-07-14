param([int]$RetentionDays = 14)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env，请先执行首次配置。' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$database = $settings['POSTGRES_DB']
$user = $settings['POSTGRES_USER']
if (-not $database -or -not $user) { throw '.env 缺少 POSTGRES_DB 或 POSTGRES_USER。' }
$mode = if ($settings['DEPLOYMENT_MODE']) { $settings['DEPLOYMENT_MODE'] } else { 'docker' }

$backupDir = Join-Path $root 'backups'
[IO.Directory]::CreateDirectory($backupDir) | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "fengqi-$stamp.dump"
$containerPath = "/tmp/$name"
$targetPath = Join-Path $backupDir $name

if ($mode -eq 'native') {
  $databaseUrl = [Uri]$settings['DATABASE_URL']
  $pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
  if (-not $pgDump) {
    $pgDump = Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
      Where-Object Name -Match '^\d+$' |
      Sort-Object { [int]$_.Name } -Descending |
      ForEach-Object { Join-Path $_.FullName 'bin\pg_dump.exe' } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
  }
  if (-not $pgDump) { throw '未找到本机 pg_dump.exe。' }
  $env:PGPASSWORD = $settings['POSTGRES_PASSWORD']
  try {
    & $pgDump -h $databaseUrl.Host -p $databaseUrl.Port -U $user -d $database --format=custom --no-owner --no-privileges --file=$targetPath
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump 执行失败。' }
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
} elseif ($mode -eq 'docker') {
  Push-Location $root
  try {
    docker compose exec -T db pg_dump -U $user -d $database --format=custom --no-owner --no-privileges --file=$containerPath
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump 执行失败。' }
    docker compose cp "db:$containerPath" $targetPath
    if ($LASTEXITCODE -ne 0) { throw '备份文件复制失败。' }
    docker compose exec -T db rm -f $containerPath
  } finally { Pop-Location }
} else { throw 'DEPLOYMENT_MODE 必须是 docker 或 native。' }

Get-ChildItem -LiteralPath $backupDir -Filter 'fengqi-*.dump' -File |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) |
  Remove-Item -Force
Write-Host "备份完成：$targetPath" -ForegroundColor Green
