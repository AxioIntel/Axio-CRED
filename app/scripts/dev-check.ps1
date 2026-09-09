$appCheckRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiPort = 8080
$webPort = 5173
if (Test-Path -LiteralPath (Join-Path $appCheckRoot ".env")) {
  foreach ($line in Get-Content -LiteralPath (Join-Path $appCheckRoot ".env")) {
    if ($line -match '^PORT=(\d+)$') { $apiPort = [int]$Matches[1] }
    if ($line -match '^WEB_PORT=(\d+)$') { $webPort = [int]$Matches[1] }
  }
}
$checks = @(
  @{ Name="Frontend"; Url="http://127.0.0.1:$webPort" },
  @{ Name="API"; Url="http://127.0.0.1:$apiPort/api/health" },
  @{ Name="Database readiness"; Url="http://127.0.0.1:$apiPort/api/ready" }
)
$failed = $false
foreach ($check in $checks) {
  try { $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec 5; Write-Host "[ready] $($check.Name) ($($response.StatusCode))" }
  catch { Write-Host "[waiting] $($check.Name): $($_.Exception.Message)"; $failed = $true }
}
if ($failed) { exit 1 }
