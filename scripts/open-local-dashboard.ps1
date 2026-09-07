$ErrorActionPreference = 'Stop'

$manager = 'C:\Users\USER\Documents\Codex\LocalDashboardPorts\dashboard_ports.py'
$python = 'C:\Users\USER\AppData\Local\Programs\Python\Python314\python.exe'
$resolved = (& $python -X utf8 $manager resolve --id aum-dashboard --json) | ConvertFrom-Json
$url = "http://127.0.0.1:$([int]$resolved.port)/"

& (Join-Path $PSScriptRoot 'start-local-server.ps1')

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri ($url + 'api/health') -TimeoutSec 2
        if ($health.ok -eq $true -and $health.appId -eq 'aum-dashboard') {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ready) {
    throw "AUM dashboard did not become ready at $url within 30 seconds."
}

Start-Process $url
