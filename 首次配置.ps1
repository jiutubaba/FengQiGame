param(
  [ValidateSet('docker', 'native')]
  [string]$Mode = 'docker',
  [ValidateRange(1, 65535)]
  [int]$PostgresPort = 55432
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$envPath = Join-Path $root '.env'

if (Test-Path -LiteralPath $envPath) {
  Write-Host '.env 已存在，首次配置未覆盖。' -ForegroundColor Yellow
  exit 0
}
if ($Mode -eq 'native' -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未检测到 Node.js，无法完成首次配置。'
}

function Read-PlainTextPassword([string]$Prompt) {
  $securePassword = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Write-Host '风起游戏 · 首次安全配置' -ForegroundColor Cyan
Write-Host "运行模式：$Mode" -ForegroundColor DarkCyan
$defaultAddress = if ($Mode -eq 'native') { 'http://127.0.0.1:3000' } else { 'http://localhost' }
$siteAddress = Read-Host "站点地址（直接回车使用 $defaultAddress）"
if ([string]::IsNullOrWhiteSpace($siteAddress)) { $siteAddress = $defaultAddress }
if ($siteAddress -notmatch '^https?://[^\s]+$') { throw '站点地址必须以 http:// 或 https:// 开头。' }
if ($Mode -eq 'native' -and $siteAddress -notmatch '^http://(127\.0\.0\.1|localhost):3000/?$') {
  throw '本机原生模式只支持 http://127.0.0.1:3000 或 http://localhost:3000。'
}

$adminUsername = Read-Host '初始管理员用户名（直接回车使用 风起）'
if ([string]::IsNullOrWhiteSpace($adminUsername)) { $adminUsername = '风起' }
$adminDisplayName = Read-Host '管理员显示名称（直接回车使用 风起）'
if ([string]::IsNullOrWhiteSpace($adminDisplayName)) { $adminDisplayName = '风起' }

do {
  $adminPassword = Read-PlainTextPassword '设置管理员密码（至少 12 位，仅允许字母、数字和 !@%^&*_-）'
  $validPassword = $adminPassword.Length -ge 12 -and $adminPassword.Length -le 128 -and $adminPassword -match '^[A-Za-z0-9!@%\^&\*_\-]+$'
  if (-not $validPassword) { Write-Host '密码不符合要求，请重新输入。' -ForegroundColor Red }
} until ($validPassword)

$bytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
$databasePassword = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$databaseHost = if ($Mode -eq 'native') { '127.0.0.1' } else { 'db' }
$databasePort = if ($Mode -eq 'native') { $PostgresPort } else { 5432 }
$trustProxy = if ($Mode -eq 'native') { 0 } else { 1 }
$cookieSecure = if ($siteAddress.StartsWith('https://')) { 'true' } else { 'false' }

if ($Mode -eq 'native') {
  $postgresAdminUser = Read-Host 'PostgreSQL 管理员用户名（直接回车使用 postgres）'
  if ([string]::IsNullOrWhiteSpace($postgresAdminUser)) { $postgresAdminUser = 'postgres' }
  $postgresAdminPassword = Read-PlainTextPassword '输入 PostgreSQL 管理员密码（仅用于创建本系统数据库，不会写入 .env）'
  $encodedAdminUser = [Uri]::EscapeDataString($postgresAdminUser)
  $encodedAdminPassword = [Uri]::EscapeDataString($postgresAdminPassword)
  $env:PG_ADMIN_DATABASE_URL = "postgres://${encodedAdminUser}:${encodedAdminPassword}@127.0.0.1:${PostgresPort}/postgres"
  $env:POSTGRES_DB = 'fengqi'
  $env:POSTGRES_USER = 'fengqi'
  $env:POSTGRES_PASSWORD = $databasePassword
  try {
    & node (Join-Path $root 'server\scripts\provision-local-database.js')
    if ($LASTEXITCODE -ne 0) { throw '本机 PostgreSQL 数据库初始化失败。' }
  } finally {
    Remove-Item Env:PG_ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
    $postgresAdminPassword = $null
  }
}

$lines = @(
  "DEPLOYMENT_MODE=$Mode"
  "SITE_ADDRESS=$siteAddress"
  'NODE_ENV=production'
  'PORT=3000'
  "TRUST_PROXY=$trustProxy"
  "COOKIE_SECURE=$cookieSecure"
  'POSTGRES_DB=fengqi'
  'POSTGRES_USER=fengqi'
  "POSTGRES_PASSWORD=$databasePassword"
  "DATABASE_URL=postgres://fengqi:${databasePassword}@${databaseHost}:${databasePort}/fengqi"
  'SESSION_COOKIE_NAME=fq_session'
  'SESSION_TTL_HOURS=12'
  "ADMIN_USERNAME=$adminUsername"
  "ADMIN_DISPLAY_NAME=$adminDisplayName"
  'PUBLIC_REGISTRATION=false'
  'UPLOAD_MAX_MB=50'
  'LOG_LEVEL=info'
)
if ($Mode -eq 'docker') { $lines += "ADMIN_PASSWORD=$adminPassword" }
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))

if ($Mode -eq 'native') {
  $env:ADMIN_USERNAME = $adminUsername
  $env:ADMIN_PASSWORD = $adminPassword
  $env:ADMIN_DISPLAY_NAME = $adminDisplayName
  try {
    Push-Location $root
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败。' }
    npm run admin:create
    if ($LASTEXITCODE -ne 0) { throw '初始管理员创建失败。' }
  } catch {
    Remove-Item -LiteralPath $envPath -Force -ErrorAction SilentlyContinue
    throw
  } finally {
    Pop-Location
    Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $adminPassword = $null
  }
}

Write-Host "配置已写入 $envPath。" -ForegroundColor Green
if ($Mode -eq 'native') {
  Write-Host '本机数据库和初始管理员已创建，管理员明文密码未写入 .env。' -ForegroundColor Green
} else {
  Write-Host '首次容器启动后，启动脚本会从 .env 移除管理员明文密码。' -ForegroundColor Green
}
