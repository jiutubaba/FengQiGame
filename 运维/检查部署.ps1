$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  npm ci
  npm run check
  npm run audit:prod
  docker compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'docker compose 配置检查失败。' }
} finally { Pop-Location }
Write-Host 'AI 文档、代码构建、测试、依赖审计和 Compose 配置检查均已通过。' -ForegroundColor Green
