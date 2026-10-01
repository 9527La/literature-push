$ErrorActionPreference = "Stop"
# 非交互宿主（后台任务/无控制台）下设置输出编码会抛异常，这里必须容错。
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$bundledNode = Join-Path $projectRoot ".runtime\node\node.exe"
$nodeCommand = if (Test-Path -LiteralPath $bundledNode) {
  $bundledNode
} else {
  (Get-Command node -ErrorAction Stop).Source
}

$dataDir = Join-Path $projectRoot "data"
$outputLog = Join-Path $dataDir "service-runtime.log"
$errorLog = Join-Path $dataDir "service-runtime.err.log"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
Set-Location -LiteralPath $projectRoot

Add-Content -LiteralPath $outputLog -Value "$(Get-Date -Format s) starting literature service"

# Node writes ordinary diagnostics to stderr -- the crawler logs every article it
# could not enrich that way ("[enrich] #123 failed: ..."). PowerShell promotes a
# native command's stderr into a *terminating* error, and this script runs with
# $ErrorActionPreference = "Stop", so the very first such line killed the launcher
# mid-run and the service died with it. Relax the policy for the child process
# only; every other statement in this script keeps using Stop.
$ErrorActionPreference = "Continue"
& $nodeCommand --no-warnings=ExperimentalWarning server/index.js 1>> $outputLog 2>> $errorLog
$exitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"

Add-Content -LiteralPath $outputLog -Value "$(Get-Date -Format s) literature service exited, code $exitCode"
exit $exitCode
