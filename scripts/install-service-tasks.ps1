$ErrorActionPreference = "Stop"
# One-off installer for the literature push service tasks. Run once on the
# deployment host; it is idempotent. ASCII only so any host codepage reads it.

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

# 1) Rewrite the main service task: it must survive battery / idle transitions.
$xmlSrc = Join-Path $root "scripts\service-task.xml"
$xmlDst = Join-Path $root "scripts\service-task.utf16.xml"
[System.IO.File]::WriteAllText($xmlDst, (Get-Content -LiteralPath $xmlSrc -Raw), [System.Text.Encoding]::Unicode)
& schtasks /create /tn LiteraturePushService /xml $xmlDst /f
Write-Output "create-task-exit=$LASTEXITCODE"

# 2) Watchdog: probe /version.json every 2 minutes and restart when it is down.
$watchdog = Join-Path $root "scripts\watchdog-service.ps1"
$tr = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '" + $watchdog + "'"
& schtasks /create /tn LiteraturePushWatchdog /tr $tr /sc minute /mo 2 /ru SYSTEM /f
Write-Output "create-watchdog-exit=$LASTEXITCODE"

& schtasks /query /tn LiteraturePushWatchdog /fo csv /nh
& schtasks /query /tn LiteraturePushService /fo csv /nh
exit 0
