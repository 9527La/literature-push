$ErrorActionPreference = "SilentlyContinue"

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $projectRoot "data"
$logPath = Join-Path $logDir "service.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$existing = Get-NetTCPConnection -LocalPort 4177 -State Listen
if ($existing) {
  Add-Content -Path $logPath -Value "$(Get-Date -Format s) service already running on port 4177"
  exit 0
}

Add-Content -Path $logPath -Value "$(Get-Date -Format s) starting IEEE literature service"
Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $projectRoot -WindowStyle Hidden
