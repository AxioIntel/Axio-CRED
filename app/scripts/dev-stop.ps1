$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $appRoot ".dev\pids.json"
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host "No Axio-CRED preview processes are recorded."; exit 0 }
$entries = @(Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)
foreach ($entry in $entries) {
  $recordedProcess = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
  if (-not $recordedProcess) { continue }
  if ($recordedProcess.ProcessName -ne $entry.ProcessName) { throw "Recorded process ID was reused; refusing to stop it." }
  if ($entry.StartedAt -and $recordedProcess.StartTime.ToUniversalTime().Ticks -ne ([datetime]$entry.StartedAt).ToUniversalTime().Ticks) { throw "Recorded process ID was reused; refusing to stop it." }
  & taskkill.exe /PID $entry.Id /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not stop a recorded preview process tree." }
}
Remove-Item -LiteralPath $statePath
Write-Host "Axio-CRED preview stopped. MySQL was left running."
