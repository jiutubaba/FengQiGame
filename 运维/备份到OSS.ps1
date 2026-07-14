param(
  [int]$RetentionDays = 14,
  [switch]$AlertTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bucket = $env:FENGQI_OSS_BUCKET
$ossConfigPath = $env:FENGQI_OSS_CONFIG
$alertTo = $env:FENGQI_BACKUP_ALERT_TO
$msmtpConfigPath = $env:FENGQI_MSMTP_CONFIG

if (-not $alertTo) { throw '缺少 FENGQI_BACKUP_ALERT_TO。' }
if (-not $msmtpConfigPath -or -not (Test-Path -LiteralPath $msmtpConfigPath -PathType Leaf)) {
  throw 'FENGQI_MSMTP_CONFIG 未指向有效的 msmtp 配置文件。'
}

$msmtp = Get-Command msmtp -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $msmtp) { throw '未找到 msmtp。' }

function Send-BackupAlert {
  param(
    [Parameter(Mandatory = $true)][string]$Subject,
    [Parameter(Mandatory = $true)][string]$Body
  )

  $hostName = [System.Net.Dns]::GetHostName()
  $mail = @(
    "From: $alertTo"
    "To: $alertTo"
    "Subject: $Subject"
    'MIME-Version: 1.0'
    'Content-Type: text/plain; charset=UTF-8'
    'Content-Transfer-Encoding: 8bit'
    ''
    "服务器：$hostName"
    "时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
    $Body
  ) -join "`r`n"

  $mail | & $msmtp "--file=$msmtpConfigPath" $alertTo
  if ($LASTEXITCODE -ne 0) { throw 'msmtp 发送告警失败。' }
}

function Get-BackupFile {
  param([Parameter(Mandatory = $true)][object[]]$PipelineOutput)

  $file = $PipelineOutput |
    Where-Object { $_ -is [System.IO.FileInfo] } |
    Select-Object -Last 1
  if (-not $file -or -not $file.Exists -or $file.Length -le 0) {
    throw '备份脚本未返回有效的非空文件。'
  }
  return $file
}

function Get-OssCrc64 {
  param([Parameter(Mandatory = $true)][string]$Source)

  $output = & $ossutil -c $ossConfigPath hash crc64 $Source 2>&1
  if ($LASTEXITCODE -ne 0) { throw "CRC64 校验命令失败：$Source" }
  $match = [regex]::Match(($output -join "`n"), '(?im)crc(?:64|-64)[^:\r\n]*:\s*(\d+)')
  if (-not $match.Success) { throw "无法读取 CRC64 校验值：$Source" }
  return $match.Groups[1].Value
}

if ($AlertTest) {
  Send-BackupAlert -Subject '[FengQiGame] Backup alert test' -Body '这是一封人工触发的正式备份告警测试邮件。'
  Write-Host '备份告警测试邮件已发送。' -ForegroundColor Green
  exit 0
}

try {
  if (-not $bucket) { throw '缺少 FENGQI_OSS_BUCKET。' }
  if (-not $ossConfigPath -or -not (Test-Path -LiteralPath $ossConfigPath -PathType Leaf)) {
    throw 'FENGQI_OSS_CONFIG 未指向有效的 ossutil 配置文件。'
  }
  $ossutil = Get-Command ossutil -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
  if (-not $ossutil) { throw '未找到 ossutil。' }

  $databaseBackup = Get-BackupFile -PipelineOutput @(
    & (Join-Path $PSScriptRoot '备份数据.ps1') -RetentionDays $RetentionDays -PassThru
  )
  $uploadsBackup = Get-BackupFile -PipelineOutput @(
    & (Join-Path $PSScriptRoot '备份上传文件.ps1') -RetentionDays $RetentionDays -PassThru
  )

  $remoteDirectory = "oss://$bucket/prod/$(Get-Date -Format 'yyyy/MM/dd')"
  foreach ($file in @($databaseBackup, $uploadsBackup)) {
    $remotePath = "$remoteDirectory/$($file.Name)"
    & $ossutil -c $ossConfigPath cp $file.FullName $remotePath --acl private --meta=x-oss-server-side-encryption:AES256
    if ($LASTEXITCODE -ne 0) { throw "OSS 上传失败：$($file.Name)" }

    $localCrc64 = Get-OssCrc64 -Source $file.FullName
    $remoteCrc64 = Get-OssCrc64 -Source $remotePath
    if ($localCrc64 -ne $remoteCrc64) { throw "OSS CRC64 校验不一致：$($file.Name)" }

    Write-Host "异机副本已校验：$remotePath" -ForegroundColor Green
  }
} catch {
  $backupError = $_
  try {
    Send-BackupAlert -Subject '[FengQiGame] Production backup failed' -Body $backupError.Exception.Message
  } catch {
    Write-Warning "备份失败且告警发送失败：$($_.Exception.Message)"
  }
  throw $backupError
}
