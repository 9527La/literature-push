$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

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
& $nodeCommand --no-warnings=ExperimentalWarning server/index.js 1>> $outputLog 2>> $errorLog
exit $LASTEXITCODE
