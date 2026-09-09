$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $appRoot ".dev\pids.json"
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host "No Axio-CRED preview processes are recorded."; exit 0 }
$entries = @(Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)
foreach ($entry in $entries) { if (Get-Process -Id $entry.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $entry.Id -Force } }
Remove-Item -LiteralPath $statePath
Write-Host "Axio-CRED preview stopped. MySQL was left running."
