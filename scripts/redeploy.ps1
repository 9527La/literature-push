#requires -Version 5.1
<#
.SYNOPSIS
  文献推送服务的可复现重新部署脚本：预检 -> 依赖 -> 构建 -> 测试 -> 重启 -> 冒烟自检。

.DESCRIPTION
  代码由 Git 交付：开发机提交并推送，部署主机同步代码后再运行本脚本。
  脚本不依赖当前工作目录，也不依赖系统 PATH：优先使用仓库自带的 .runtime\node。

  部署主机（E:\SC\文献推送）注意事项：
  - node_modules / .env / data 不参与同步，两端各自保留；依赖有变化时加 -InstallDeps。
  - 服务由后台任务托管（SC Remote Runner 的 sc_job_start）时，重启交给托管方完成：
    先用 -NoRestart 完成构建与测试，再重启任务，最后用 -VerifyOnly 复检。
  - 不使用 Read-Host，可在非交互环境（后台任务、远程执行）下运行。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -NoRestart
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -VerifyOnly
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -InstallDeps -ExpectedSha e9f0c1a
#>
[CmdletBinding()]
param(
  [string]$ExpectedSha = "",
  [string]$Passport = "",
  [switch]$InstallDeps,
  [switch]$SkipBuild,
  [switch]$SkipTests,
  [switch]$NoRestart,
  [switch]$VerifyOnly,
  [switch]$SkipVerify,
  [int]$Port = 4177,
  [int]$WaitSeconds = 60
)

$ErrorActionPreference = "Stop"
# 非交互宿主下设置输出编码会抛异常，这里必须容错。
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }
function Fail { param([string]$Message) Write-Host "!!! $Message" -ForegroundColor Red; exit 1 }

# ---------------- 路径与运行时 ----------------
# 一律基于脚本位置解析仓库根目录：后台任务会忽略 workdir，因此必须显式 Set-Location。
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "package.json"))) {
  Fail "未找到 package.json，$projectRoot 不是项目根目录"
}

$bundledNodeDir = Join-Path $projectRoot ".runtime\node"
$nodeExe = Join-Path $bundledNodeDir "node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "" }
$npmCmd = Join-Path $bundledNodeDir "npm.cmd"
if (-not (Test-Path -LiteralPath $npmCmd)) { $npmCmd = "npm.cmd" }

# 远端 PATH 里没有 node/npm，必须把自带运行时和 node_modules\.bin 前置。
if ($nodeExe) { $env:Path = "$bundledNodeDir;$env:Path" }
$binDir = Join-Path $projectRoot "node_modules\.bin"
if (Test-Path -LiteralPath $binDir) { $env:Path = "$binDir;$env:Path" }

$logDir = Join-Path $projectRoot "data\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "redeploy.log"
function Write-Log { param([string]$Message)
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format s) $Message"
}

$baseUrl = "http://127.0.0.1:$Port"
Write-Step "部署目录 $projectRoot"
Write-Ok ("node       : " + $(if ($nodeExe) { $nodeExe } else { (Get-Command node -ErrorAction SilentlyContinue).Source }))
Write-Ok ("npm        : $npmCmd")
Write-Ok ("VerifyOnly : $VerifyOnly  SkipBuild: $SkipBuild  SkipTests: $SkipTests  NoRestart: $NoRestart  SkipVerify: $SkipVerify")
Write-Log "redeploy start (VerifyOnly=$VerifyOnly SkipBuild=$SkipBuild SkipTests=$SkipTests NoRestart=$NoRestart SkipVerify=$SkipVerify ExpectedSha=$ExpectedSha)"

# ---------------- 提交号校验（有 .git 时严格校验） ----------------
if ($ExpectedSha) {
  if (Test-Path -LiteralPath (Join-Path $projectRoot ".git")) {
    $head = (& git rev-parse HEAD).Trim()
    $headShort = $head.Substring(0, [Math]::Min(7, $head.Length))
    if (-not $head.StartsWith($ExpectedSha, [StringComparison]::OrdinalIgnoreCase)) {
      Fail "当前提交 $headShort 与期望的 $ExpectedSha 不一致，请先同步代码再部署"
    }
    Write-Ok "提交号校验通过: $headShort"
  } else {
    Write-Note "未找到 .git（同步目录），跳过提交号校验，改用 /version.json 与冒烟自检确认"
  }
}

# ---------------- 依赖 ----------------
if ($InstallDeps -and -not $VerifyOnly) {
  Write-Step "安装依赖 (npm ci)"
  & $npmCmd ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci 失败，退出码 $LASTEXITCODE（检查 .runtime\node 是否在 PATH 最前）" }
  Write-Ok "依赖安装完成"
  Write-Log "npm ci ok"
}

# ---------------- 构建 ----------------
if (-not $VerifyOnly -and -not $SkipBuild) {
  Write-Step "构建前端 (npm run build)"
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) { Fail "前端构建失败，退出码 $LASTEXITCODE" }
  $distIndex = Join-Path $projectRoot "dist\index.html"
  if (-not (Test-Path -LiteralPath $distIndex)) { Fail "构建结束后未找到 dist\index.html" }
  Write-Ok ("dist\index.html 更新时间 " + (Get-Item -LiteralPath $distIndex).LastWriteTime.ToString("s"))
  Write-Log "build ok"
}

# ---------------- 测试 ----------------
if (-not $VerifyOnly -and -not $SkipTests) {
  Write-Step "运行测试 (npm test)"
  & $npmCmd test
  if ($LASTEXITCODE -ne 0) { Fail "测试失败，退出码 $LASTEXITCODE" }
  Write-Ok "测试通过"
  Write-Log "tests ok"
}

# ---------------- 重启 ----------------
if ($VerifyOnly -or $NoRestart) {
  Write-Step "跳过重启（服务由后台任务托管，重启交给托管方）"
} else {
  Write-Step "重启服务（端口 $Port）"
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listenerPid in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
    Write-Ok "已停止进程 PID $listenerPid"
  }
  if ($listeners.Count -gt 0) { Start-Sleep -Seconds 1 }
  Start-Process -FilePath $npmCmd -ArgumentList "start" -WorkingDirectory $projectRoot -WindowStyle Hidden
  Write-Ok "已启动 $npmCmd start"
  Write-Log "restart on port $Port"
}

# ---------------- 等待端口 ----------------
# -SkipVerify：只做「依赖 / 构建 / 测试」，完全跳过端口等待与冒烟自检。
# 这与 -NoRestart 的区别是：-NoRestart 仍会尝试自检，只是不负责重启。
$ownerPid = $null
$versionJson = $null
$smokeSkipped = $false
if ($SkipVerify) {
  Write-Step "跳过端口等待与冒烟自检（-SkipVerify）"
  Write-Log "verify skipped (SkipVerify)"
  $smokeSkipped = $true
} else {
Write-Step "等待端口 $Port 就绪（最多 $WaitSeconds 秒）"
$ready = $false
for ($i = 0; $i -lt $WaitSeconds; $i++) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  # -NoRestart 表示服务由后台任务托管，本脚本不负责重启，端口此刻空着是正常的。
  # 典型流程是「停任务 -> 同步 -> 构建 -> 重启任务 -> -VerifyOnly 复检」，此处不能判失败。
  if ($NoRestart) {
    Write-Note "端口 $Port 未监听：-NoRestart 模式不重启服务，跳过冒烟自检；重启任务后请用 -VerifyOnly 复检"
    Write-Log "port $Port not listening; smoke skipped (NoRestart)"
    $smokeSkipped = $true
  } else {
    Fail "端口 $Port 在 $WaitSeconds 秒内没有监听，请检查 data\logs\redeploy.log 与任务日志"
  }
} else {
$ownerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
Write-Ok "端口 $Port 已监听 (PID $ownerPid)"

# ---------------- 冒烟自检 ----------------
function Invoke-Check {
  param([string]$Name, [string]$Url, [string]$Method = "GET", [string]$Json = "", $Headers = $null)
  $params = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($Json) { $params.Body = $Json; $params.ContentType = "application/json" }
  if ($Headers) { $params.Headers = $Headers }
  try {
    $response = Invoke-WebRequest @params
  } catch {
    Fail "自检失败：$Name -> $($_.Exception.Message)"
  }
  Write-Ok ("{0,-26} HTTP {1}  {2}" -f $Name, [int]$response.StatusCode, $Url)
  return $response
}

Write-Step "冒烟自检 $baseUrl"
$homePage = Invoke-Check "首页 /" "$baseUrl/"
if ($homePage.Content -notmatch 'id="root"') { Fail "首页内容异常，未找到前端挂载节点 #root" }

$assets = @([regex]::Matches($homePage.Content, '/assets/[A-Za-z0-9._~-]+') | ForEach-Object { $_.Value } | Select-Object -Unique | Select-Object -First 3)
if ($assets.Count -eq 0) { Fail "首页未引用 /assets 静态资源，dist 可能不完整" }
foreach ($asset in $assets) { [void](Invoke-Check "静态资源 $asset" "$baseUrl$asset") }

$versionResponse = Invoke-Check "版本 /version.json" "$baseUrl/version.json"
$versionJson = $versionResponse.Content | ConvertFrom-Json
Write-Ok ("部署版本 {0} ({1})" -f $versionJson.version, $versionJson.date)

# 通行证登录：既验证 .env 真被读到（缺 ADMIN_TOKEN_SECRET 时会 500），也拿到
# 后续 /api/* 自检所需的 token。
$envFile = Join-Path $projectRoot ".env"
$envValues = @{}
if (-not (Test-Path -LiteralPath $envFile)) {
  Write-Note "未找到 .env：部署主机应保留自己的 .env，缺失会让密钥为空"
} else {
  foreach ($line in (Get-Content -LiteralPath $envFile)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $envValues[$matches[1]] = $matches[2].Trim().Trim([char]34).Trim([char]39)
    }
  }
}
$passport = $Passport
if (-not $passport) { $passport = $envValues["ADMIN_PASSPORT"] }
if (-not $passport) {
  $passport = "shenchao"   # config.js 里 ADMIN_PASSPORT 的默认值
  Write-Note ".env 未配置 ADMIN_PASSPORT，使用内置默认值"
}
$login = Invoke-Check "登录 /api/gate/login" "$baseUrl/api/gate/login" "POST" (@{ passport = $passport } | ConvertTo-Json)
$loginJson = $login.Content | ConvertFrom-Json
if (-not $loginJson.token) { Fail "登录接口未返回 token，检查 ADMIN_TOKEN_SECRET / ADMIN_PASSWORD" }
$passportToken = $loginJson.token
Write-Ok ("通行证角色 {0}，token 长度 {1}" -f $loginJson.role, $passportToken.Length)

$authHeaders = @{ "x-passport-token" = $passportToken }
$sessionJson = (Invoke-Check "会话 /api/gate/session" "$baseUrl/api/gate/session" "GET" "" $authHeaders).Content | ConvertFrom-Json
if (-not $sessionJson.authenticated) { Fail "/api/gate/session 未识别通行证 token" }

$statusJson = (Invoke-Check "状态 /api/status" "$baseUrl/api/status" "GET" "" $authHeaders).Content | ConvertFrom-Json
if ([int]$statusJson.articleCount -le 0) {
  Fail "articleCount 为 0，数据目录可能未就绪（检查 LITERATURE_DATA_DIR 与 data 目录）"
}
Write-Ok ("articleCount = {0}" -f $statusJson.articleCount)
}
}
# ---------------- 汇总 ----------------
if (-not $versionJson) {
  # 跳过自检时从文件读取版本号，保证汇总与日志里始终有版本信息。
  $versionJson = Get-Content -LiteralPath (Join-Path $projectRoot "version.json") -Raw -Encoding UTF8 | ConvertFrom-Json
}
$lanIp = "127.0.0.1"
$nets = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.PrefixOrigin -ne "WellKnown" -and $_.IPAddress -ne "127.0.0.1" })
foreach ($pattern in @('^192\.168\.', '^10\.', '^172\.(1[6-9]|2[0-9]|3[01])\.')) {
  $match = $nets | Where-Object { $_.IPAddress -match $pattern } | Select-Object -First 1
  if ($match) { $lanIp = $match.IPAddress; break }
}

Write-Host ""
if ($smokeSkipped) {
  Write-Host "构建与测试完成（未做冒烟自检）" -ForegroundColor Green
  Write-Host ("  部署版本  : {0}" -f $versionJson.version)
  Write-Host ("  部署日志  : {0}" -f $logFile)
  Write-Host "  下一步    : 重启托管任务后再执行 scripts\redeploy.ps1 -VerifyOnly 复检"
} else {
  Write-Host "部署完成" -ForegroundColor Green
  Write-Host ("  本机访问  : {0}" -f $baseUrl)
  Write-Host ("  局域网访问: http://{0}:{1}" -f $lanIp, $Port)
  Write-Host ("  部署版本  : {0}" -f $versionJson.version)
  Write-Host ("  部署日志  : {0}" -f $logFile)
}
Write-Log "redeploy done (version=$($versionJson.version) lan=$lanIp pid=$ownerPid smokeSkipped=$smokeSkipped)"
exit 0