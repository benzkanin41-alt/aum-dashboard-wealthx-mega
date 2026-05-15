$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "logs"
$logFile = Join-Path $logs "history-refresh.log"

New-Item -ItemType Directory -Force -Path $logs | Out-Null
"Refresh started at $(Get-Date -Format s)" | Out-File -FilePath $logFile -Append -Encoding utf8

Set-Location $root
& npm.cmd run import:talis:history *>> $logFile

& (Join-Path $PSScriptRoot "start-local-server.ps1") *>> $logFile
"Refresh finished at $(Get-Date -Format s)" | Out-File -FilePath $logFile -Append -Encoding utf8
