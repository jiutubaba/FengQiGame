param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Text')]
  [string]$ScriptText,

  [Parameter(Mandatory = $true, ParameterSetName = 'File')]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$ScriptPath,

  [ValidateRange(10, 86400)]
  [int]$TimeoutSeconds = 300,

  [string]$RegionId = 'cn-guangzhou',
  [string]$InstanceId = 'i-7xvdufe80gxzqw3oowvo',
  [string]$Profile = 'fq-production',
  [string]$AliyunCliPath = "$env:LOCALAPPDATA\AliyunCLI\aliyun.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AliyunCliPath -PathType Leaf)) {
  throw "未找到阿里云 CLI：$AliyunCliPath"
}

function Invoke-AliyunJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = & $AliyunCliPath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = $output -join "`n"
  if ($exitCode -ne 0) {
    throw "阿里云 CLI 调用失败（exit=$exitCode）：$text"
  }

  try {
    return $text | ConvertFrom-Json -Depth 100
  } catch {
    throw "阿里云 CLI 未返回有效 JSON：$text"
  }
}

$cloudStatus = Invoke-AliyunJson -Arguments @(
  'ecs',
  'DescribeCloudAssistantStatus',
  '--RegionId', $RegionId,
  '--InstanceId.1', $InstanceId,
  '--profile', $Profile
)
$instanceStatus = @(
  $cloudStatus.InstanceCloudAssistantStatusSet.InstanceCloudAssistantStatus
) | Where-Object { $_.InstanceId -eq $InstanceId } | Select-Object -First 1
if (-not $instanceStatus -or $instanceStatus.CloudAssistantStatus -ne 'true') {
  throw "目标实例的云助手状态不正常：$InstanceId"
}

$content = if ($PSCmdlet.ParameterSetName -eq 'File') {
  Get-Content -LiteralPath $ScriptPath -Raw
} else {
  $ScriptText
}
if (-not $content.StartsWith('#!')) {
  $content = "#!/usr/bin/env bash`n$content"
}
$encodedContent = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($content))
$clientToken = [Guid]::NewGuid().ToString('N')
$invocation = Invoke-AliyunJson -Arguments @(
  'ecs',
  'RunCommand',
  '--RegionId', $RegionId,
  '--Type', 'RunShellScript',
  '--ContentEncoding', 'Base64',
  '--CommandContent', $encodedContent,
  '--InstanceId.1', $InstanceId,
  '--Timeout', $TimeoutSeconds.ToString(),
  '--KeepCommand', 'false',
  '--ClientToken', $clientToken,
  '--profile', $Profile
)

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds + 60)
do {
  Start-Sleep -Seconds 2
  $result = Invoke-AliyunJson -Arguments @(
    'ecs',
    'DescribeInvocationResults',
    '--RegionId', $RegionId,
    '--InstanceId', $InstanceId,
    '--InvokeId', $invocation.InvokeId,
    '--ContentEncoding', 'PlainText',
    '--profile', $Profile
  )
  $entry = @($result.Invocation.InvocationResults.InvocationResult) |
    Where-Object { $_.InstanceId -eq $InstanceId } |
    Select-Object -First 1
  if ($entry -and $entry.InvocationStatus -notin @('Pending', 'Running')) { break }
} while ([DateTimeOffset]::UtcNow -lt $deadline)

if (-not $entry) {
  throw "云助手没有返回目标实例的执行结果：$($invocation.InvokeId)"
}
if ($entry.InvocationStatus -ne 'Success' -or $entry.ExitCode -ne 0) {
  throw "云助手命令失败（status=$($entry.InvocationStatus), exit=$($entry.ExitCode)）：$($entry.Output)"
}

[PSCustomObject]@{
  InstanceId = $InstanceId
  InvokeId = $invocation.InvokeId
  Status = $entry.InvocationStatus
  ExitCode = $entry.ExitCode
  Output = $entry.Output
}
