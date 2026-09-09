$appRuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$localNode = Get-ChildItem -Path (Join-Path $appRuntimeRoot ".tools/node-v22.*-win-x64") -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '^node-v|\-win-x64$', '') } -Descending | Select-Object -First 1
if ($localNode) { $env:PATH = "$($localNode.FullName);$env:PATH" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22 is required." }
if ((& node -p "process.versions.node.split('.')[0]") -ne "22") { throw "Use Node.js 22 to match the application CI and Docker runtime." }
