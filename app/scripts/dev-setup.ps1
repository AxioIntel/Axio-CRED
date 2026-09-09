param([switch]$DemoOnly, [switch]$PasswordlessRoot)
$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $appRoot ".env"
$mysqlPath = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm is required." }
if (-not (Test-Path (Join-Path $appRoot "node_modules"))) { & npm.cmd install --prefix $appRoot }

if ($DemoOnly) {
  Copy-Item -LiteralPath (Join-Path $appRoot ".env.example") -Destination $envPath -Force
  Write-Host "Demo preview configured. Run .\scripts\dev-start.ps1"
  exit 0
}
if (-not (Test-Path -LiteralPath $mysqlPath)) { throw "MySQL 8 was not found at $mysqlPath" }
$mysqlService = Get-Service -Name "MySQL80" -ErrorAction SilentlyContinue
if ($mysqlService -and $mysqlService.Status -ne "Running") { Start-Service -Name $mysqlService.Name }
if (-not (Get-Process -Name "mysqld" -ErrorAction SilentlyContinue)) {
  $myIni = "C:\ProgramData\MySQL\MySQL Server 8.0\my.ini"
  if (-not (Test-Path -LiteralPath $myIni)) { throw "MySQL is installed but its my.ini file was not found." }
  $stateDir = Join-Path $appRoot ".dev"; New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $configArg = "--defaults-file=`"$myIni`""
  $mysqlProcess = Start-Process -FilePath (Join-Path (Split-Path $mysqlPath) "mysqld.exe") -ArgumentList @($configArg, "--console") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir "mysql.log") -RedirectStandardError (Join-Path $stateDir "mysql-error.log") -PassThru
  $mysqlProcess.Id | Set-Content -LiteralPath (Join-Path $stateDir "mysql.pid")
  Start-Sleep -Seconds 3
  if (-not (Get-Process -Id $mysqlProcess.Id -ErrorAction SilentlyContinue)) { throw "MySQL could not start. Check app\.dev\mysql-error.log." }
}

$appSecure = Read-Host "Choose a password for the axiocred_app database user" -AsSecureString
$rootPassword = if ($PasswordlessRoot) { "" } else { [System.Net.NetworkCredential]::new("", (Read-Host "MySQL root password (used once, never stored)" -AsSecureString)).Password }
$appPassword = [System.Net.NetworkCredential]::new("", $appSecure).Password
try {
  $env:MYSQL_PWD = $rootPassword
  $escaped = $appPassword.Replace("'", "''")
  & $mysqlPath -h 127.0.0.1 -P 3306 -u root --execute "CREATE DATABASE IF NOT EXISTS axiocred_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER IF NOT EXISTS 'axiocred_app'@'localhost' IDENTIFIED BY '$escaped'; ALTER USER 'axiocred_app'@'localhost' IDENTIFIED BY '$escaped'; CREATE USER IF NOT EXISTS 'axiocred_app'@'127.0.0.1' IDENTIFIED BY '$escaped'; ALTER USER 'axiocred_app'@'127.0.0.1' IDENTIFIED BY '$escaped'; GRANT ALL PRIVILEGES ON axiocred_dev.* TO 'axiocred_app'@'localhost'; GRANT ALL PRIVILEGES ON axiocred_dev.* TO 'axiocred_app'@'127.0.0.1'; FLUSH PRIVILEGES;"
  if ($LASTEXITCODE -ne 0) { throw "MySQL setup failed." }
} finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue; $rootPassword = $null }

$connection = "mysql://axiocred_app:$([uri]::EscapeDataString($appPassword))@127.0.0.1:3306/axiocred_dev"
$example = Get-Content -LiteralPath (Join-Path $appRoot ".env.example") -Raw
$configured = $example.Replace("DATA_MODE=demo", "DATA_MODE=mysql").Replace("mysql://axiocred_app:CHANGE_ME@127.0.0.1:3306/axiocred_dev", $connection)
[IO.File]::WriteAllText($envPath, $configured)
$env:MYSQL_URL = $connection
& npm.cmd run migrate --prefix $appRoot
if ($LASTEXITCODE -ne 0) { throw "Schema migration failed." }
$appPassword = $null
Write-Host "Local MySQL preview is ready. Run .\scripts\dev-start.ps1"
