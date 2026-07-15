Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsLinux) { throw '此脚本仅用于正式 Linux 服务器。' }
if ((& id -u) -ne '0') { throw '请使用 sudo 以 root 身份运行此脚本。' }

$targetPath = '/etc/fengqigame/qq-smtp-auth'
$secureSecret = Read-Host '请输入 QQ SMTP 授权码' -AsSecureString
$secretPointer = [IntPtr]::Zero
$plainSecret = $null

try {
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($plainSecret)) { throw 'QQ SMTP 授权码不能为空。' }

  [IO.Directory]::CreateDirectory('/etc/fengqigame') | Out-Null
  [IO.File]::WriteAllText($targetPath, $plainSecret, [Text.UTF8Encoding]::new($false))
  & chown root:root $targetPath
  if ($LASTEXITCODE -ne 0) { throw '设置 QQ SMTP 授权码文件所有者失败。' }
  & chmod 600 $targetPath
  if ($LASTEXITCODE -ne 0) { throw '设置 QQ SMTP 授权码文件权限失败。' }

  Write-Host 'QQ SMTP 授权码已安全写入服务器。' -ForegroundColor Green
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $plainSecret = $null
}
