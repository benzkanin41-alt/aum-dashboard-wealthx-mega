$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manager = "C:\Users\USER\Documents\Codex\LocalDashboardPorts\dashboard_ports.py"
$python = "C:\Users\USER\AppData\Local\Programs\Python\Python314\python.exe"
$resolved = (& $python -X utf8 $manager resolve --id aum-dashboard --json) | ConvertFrom-Json
$port = [int]$resolved.port
$url = "http://127.0.0.1:$port/"
$logs = Join-Path $root "logs"
$outLog = Join-Path $logs "server.out.log"
$errLog = Join-Path $logs "server.err.log"
$taskLog = Join-Path $logs "server-task.log"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Test-AumDashboard {
    try {
        $health = Invoke-RestMethod -Uri ($url + "api/health") -TimeoutSec 2
        return $health.ok -eq $true -and $health.appId -eq "aum-dashboard"
    }
    catch { return $false }
}

if (Test-AumDashboard) {
    "AUM dashboard already running on $url at $(Get-Date -Format s)" | Out-File -FilePath $taskLog -Append -Encoding utf8
    exit 0
}
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $owners = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "Port $port is occupied by a different listener (PID $owners). Nothing was stopped."
}
$hadPreviousPort = Test-Path Env:PORT
$previousPort = $env:PORT
try {
    $env:PORT = "$port"
    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}
finally {
    if ($hadPreviousPort) { $env:PORT = $previousPort }
    else { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
}
"Started AUM dashboard on $url at $(Get-Date -Format s)" | Out-File -FilePath $taskLog -Append -Encoding utf8
