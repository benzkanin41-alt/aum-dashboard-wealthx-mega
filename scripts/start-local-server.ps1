$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "logs"
$outLog = Join-Path $logs "server.out.log"
$errLog = Join-Path $logs "server.err.log"
$taskLog = Join-Path $logs "server-task.log"

New-Item -ItemType Directory -Force -Path $logs | Out-Null

$listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  "AUM dashboard already running on http://localhost:4173 at $(Get-Date -Format s)" | Out-File -FilePath $taskLog -Append -Encoding utf8
  exit 0
}

Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList "start" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

"Started AUM dashboard on http://localhost:4173 at $(Get-Date -Format s)" | Out-File -FilePath $taskLog -Append -Encoding utf8
