$ErrorActionPreference = "Stop"
$databaseRoot = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".dev/mysql"
$databaseConfig = Join-Path $databaseRoot "my.ini"
if (-not (Test-Path -LiteralPath $databaseConfig)) { return }
$databasePidPath = Join-Path $databaseRoot "mysql.pid"
if (Test-Path -LiteralPath $databasePidPath) {
  $recordedProcess = Get-Process -Id ([int](Get-Content -LiteralPath $databasePidPath)) -ErrorAction SilentlyContinue
  if ($recordedProcess -and $recordedProcess.ProcessName -eq "mysqld") { return }
}
$mysqlServer = "C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe"
if (-not (Test-Path -LiteralPath $mysqlServer)) { throw "Install MySQL Server 8.0 to run the project-local database." }
$databaseProcess = Start-Process -FilePath $mysqlServer -ArgumentList @("--defaults-file=`"$databaseConfig`"") -WindowStyle Hidden -PassThru
$databaseProcess.Id | Set-Content -LiteralPath $databasePidPath
Start-Sleep -Seconds 2
if (-not (Get-Process -Id $databaseProcess.Id -ErrorAction SilentlyContinue)) { throw "Project MySQL failed to start. Check app/.dev/mysql/server-error.log." }
Write-Host "Project-local MySQL started."
