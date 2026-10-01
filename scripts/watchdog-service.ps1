$ErrorActionPreference = "SilentlyContinue"
# Literature push service watchdog.
# Run from Task Scheduler every few minutes: probe the local health endpoint and
# restart the service task when nothing answers. ASCII only: the task host may
# read this file with a non-UTF8 codepage.

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $projectRoot

$dataDir = Join-Path $projectRoot "data"
$logPath = Join-Path $dataDir "watchdog.log"
$outputLog = Join-Path $dataDir "service-runtime.log"
$errorLog = Join-Path $dataDir "service-runtime.err.log"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

function Write-Log { param([string]$Message) Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) $Message" }

$healthy = $false
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:4177/version.json" -UseBasicParsing -TimeoutSec 15
  if ([int]$response.StatusCode -eq 200) { $healthy = $true }
} catch {
  $healthy = $false
}

if ($healthy) { exit 0 }

# Record the crime scene before touching anything. Whether a node process was
# still alive is what separates "the process died" from "the process hung", and
# that distinction decides where the real fix belongs.
$stale = @(Get-Process node -ErrorAction SilentlyContinue)
if ($stale.Count -gt 0) {
  $detail = ($stale | ForEach-Object {
    "pid=$($_.Id) cpu=$([math]::Round($_.CPU, 1))s ws=$([math]::Round($_.WorkingSet64 / 1MB))MB"
  }) -join "; "
  Write-Log "health probe failed; node still present: $detail"
} else {
  Write-Log "health probe failed; no node process found"
}

# Stop before starting. The service task ignores new instances while it believes
# one is still running, so a bare /run against a hung instance is discarded and
# the site stays down until someone intervenes by hand.
& schtasks /end /tn LiteraturePushService
Start-Sleep -Seconds 1
& schtasks /run /tn LiteraturePushService
Start-Sleep -Seconds 20

$recovered = $false
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:4177/version.json" -UseBasicParsing -TimeoutSec 15
  if ([int]$response.StatusCode -eq 200) { $recovered = $true }
} catch {
  $recovered = $false
}
if ($recovered) { Write-Log "recovered via scheduled task"; exit 0 }

# Fallback: launch node directly so a stuck task record cannot keep the site down.
Write-Log "scheduled task did not recover, starting node directly"
$bundledNode = Join-Path $projectRoot ".runtime\node\node.exe"
if (-not (Test-Path -LiteralPath $bundledNode)) { $bundledNode = "node" }
$command = "`"$bundledNode`" --no-warnings=ExperimentalWarning server/index.js 1>> `"$outputLog`" 2>> `"$errorLog`""
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WorkingDirectory $projectRoot -WindowStyle Hidden
exit 0
