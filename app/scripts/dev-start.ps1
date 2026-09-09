$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateDir = Join-Path $appRoot ".dev"
$statePath = Join-Path $stateDir "pids.json"
if (Test-Path $statePath) { throw "Axio-CRED appears to be running. Use .\scripts\dev-stop.ps1 first." }
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

$processes = @()
$processes += Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "-w", "backend") -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir "api.log") -RedirectStandardError (Join-Path $stateDir "api-error.log") -PassThru
$processes += Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "-w", "frontend") -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir "web.log") -RedirectStandardError (Join-Path $stateDir "web-error.log") -PassThru
$processes | Select-Object Id,ProcessName | ConvertTo-Json | Set-Content -LiteralPath $statePath
Write-Host "Axio-CRED is starting at http://localhost:5173"
Write-Host "Run .\scripts\dev-check.ps1 to verify readiness."
