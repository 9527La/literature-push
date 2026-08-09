$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $projectRoot "data"
$logPath = Join-Path $logDir "service.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  IEEE 电力文献 - 一键构建部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build frontend
Write-Host "[1/4] 构建前端..." -ForegroundColor Yellow
Set-Location $projectRoot
$buildOutput = & npm.cmd run build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "前端构建失败！" -ForegroundColor Red
    Write-Host $buildOutput
    Read-Host "按回车键退出"
    exit 1
}
Write-Host "  前端构建完成" -ForegroundColor Green

# Step 2: Update version.json + read CHANGELOG.md
Write-Host "[2/4] 更新版本号..." -ForegroundColor Yellow
$versionFile = Join-Path $projectRoot "version.json"
$distVersionFile = Join-Path (Join-Path $projectRoot "dist") "version.json"
$dateStr = Get-Date -Format "yyyy.MM.dd"
$timeStr = Get-Date -Format "HH:mm"

if (Test-Path $versionFile) {
    $vObj = Get-Content $versionFile -Raw | ConvertFrom-Json
    $vObj.version = $dateStr
    $vObj.date = (Get-Date -Format "yyyy-MM-dd")
} else {
    $vObj = [PSCustomObject]@{
        version = $dateStr
        date    = (Get-Date -Format "yyyy-MM-dd")
        notes   = @()
    }
}

# Read CHANGELOG.md and extract latest section (before first ---)
$changelogFile = Join-Path $projectRoot "CHANGELOG.md"
$changelogContent = ""
if (Test-Path $changelogFile) {
    $mdRaw = Get-Content $changelogFile -Raw -Encoding UTF8
    # Strip HTML comments
    $mdRaw = $mdRaw -replace '(?s)<!--.*?-->', ''
    # Split by horizontal rule (---) and take the first section
    $sections = $mdRaw -split '(?m)^\s*-{3,}\s*$'
    $changelogContent = $sections[0].Trim()
    Write-Host "  已读取 CHANGELOG.md 更新说明" -ForegroundColor Green
} else {
    Write-Host "  未找到 CHANGELOG.md，跳过更新说明" -ForegroundColor Gray
}
$vObj | Add-Member -NotePropertyName "changelog" -NotePropertyValue $changelogContent -Force

$jsonContent = $vObj | ConvertTo-Json -Depth 5
Set-Content -Path $versionFile -Value $jsonContent -Encoding UTF8
if (Test-Path (Join-Path $projectRoot "dist")) {
    Copy-Item $versionFile $distVersionFile -Force
}
Write-Host "  版本已更新: $dateStr ($timeStr)" -ForegroundColor Green

# Step 3: Stop old server
Write-Host "[3/4] 停止旧服务..." -ForegroundColor Yellow
$connections = Get-NetTCPConnection -LocalPort 4177 -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    $procIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "  已停止进程 PID $procId" -ForegroundColor Green
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "  无旧服务运行" -ForegroundColor Gray
}

# Step 4: Start new server
Write-Host "[4/4] 启动新服务..." -ForegroundColor Yellow
Add-Content -Path $logPath -Value "$(Get-Date -Format s) deploying new version"
Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $projectRoot -WindowStyle Hidden

# Wait for server to start
$maxWait = 10
$started = $false
for ($i = 0; $i -lt $maxWait; $i++) {
    Start-Sleep -Seconds 1
    $check = Get-NetTCPConnection -LocalPort 4177 -State Listen -ErrorAction SilentlyContinue
    if ($check) { $started = $true; break }
}

if (-not $started) {
    Write-Host "  服务启动超时，请检查日志" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

# Get LAN IP
$lanIp = "127.0.0.1"
$nets = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" }
foreach ($net in $nets) {
    if ($net.IPAddress -match "^192\.168\." -or $net.IPAddress -match "^10\." -or $net.IPAddress -match "^172\.(1[6-9]|2[0-9]|3[01])\.") {
        $lanIp = $net.IPAddress
        break
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署成功！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  本机访问:  " -NoNewline; Write-Host "http://127.0.0.1:4177" -ForegroundColor Cyan
Write-Host "  局域网访问:" -NoNewline; Write-Host " http://${lanIp}:4177" -ForegroundColor Cyan
Write-Host ""
Write-Host "  同一 Wi-Fi 下的其他设备请在浏览器中打开上述局域网地址" -ForegroundColor Gray
Write-Host ""
Read-Host "按回车键退出"
