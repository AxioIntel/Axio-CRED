$checks = @(
  @{ Name="Frontend"; Url="http://localhost:5173" },
  @{ Name="API"; Url="http://localhost:8080/api/health" }
)
$failed = $false
foreach ($check in $checks) {
  try { $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec 5; Write-Host "[ready] $($check.Name) ($($response.StatusCode))" }
  catch { Write-Host "[waiting] $($check.Name): $($_.Exception.Message)"; $failed = $true }
}
if ($failed) { exit 1 }
