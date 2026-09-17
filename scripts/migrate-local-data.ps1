param([ValidateSet('Copy','DeleteVerified')][string]$Action = 'Copy')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$target = [IO.Path]::GetFullPath('E:\DASHBOARD\DASBOARD LTMH\ข้อมูล')
$legacy = "$repo-backup-20260907-195800\data"
$manifestPath = Join-Path $target 'migration-manifest.json'
function Assert-Within([string]$child, [string]$parent) {
    $full = [IO.Path]::GetFullPath($child)
    $base = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
    if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside allowlist: $full" }
}
if ($Action -eq 'Copy') {
    if (Test-Path -LiteralPath $manifestPath) { throw 'Migration manifest already exists; inspect before repeating.' }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $backup = Join-Path $target ('backups\migration-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    $entries = @()
    $groups = @(
        @{Source=(Join-Path $repo 'data');Destination=(Join-Path $target 'local-data');JsonOnly=$true},
        @{Source=(Join-Path $repo '.wrangler\state');Destination=(Join-Path $target 'dev-state');JsonOnly=$false},
        @{Source=$legacy;Destination=(Join-Path $target 'backups\legacy-20260907\data');JsonOnly=$true}
    )
    foreach ($group in $groups) {
        foreach ($file in @(Get-ChildItem -LiteralPath $group.Source -Recurse -File -Force)) {
            if ($group.JsonOnly -and $file.Extension -ne '.json') { continue }
            $relative = $file.FullName.Substring($group.Source.Length).TrimStart('\')
            $destination = Join-Path $group.Destination $relative
            if ($relative -like 'dashboard-cache.json*') { $destination = Join-Path $target ('cache\' + $relative) }
            Assert-Within $destination $target
            if (Test-Path -LiteralPath $destination) { throw "Destination exists: $destination" }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $hash) { throw 'Copy hash mismatch' }
            $rollback = Join-Path $backup ('data-files\' + $entries.Count + '-' + $file.Name)
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $rollback) | Out-Null
            Copy-Item -LiteralPath $destination -Destination $rollback
            $entries += [pscustomobject]@{source=$file.FullName;destination=$destination;rollback=$rollback;bytes=$file.Length;sha256=$hash}
        }
    }
    $sourceFiles = @(git -C $repo ls-files)
    $sourceFiles += 'data/wealthx-fund-inventory.md', 'scripts/build_fund_list_pdf.py', '.env.local'
    foreach ($relative in $sourceFiles) {
        $source = Join-Path $repo $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $destination = Join-Path $backup ('source\' + $relative)
        Assert-Within $destination $backup
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }
    Copy-Item -LiteralPath 'C:\Users\USER\Desktop\DASHBOARD\Dashboard LTHM wealthx AUM.lnk' -Destination $backup
    Copy-Item -LiteralPath 'C:\Users\USER\Documents\Codex\LocalDashboardPorts\registry.json' -Destination (Join-Path $backup 'dashboard-registry.json')
    [ordered]@{createdAt=(Get-Date).ToUniversalTime().ToString('o');sourceRoot=$repo;targetRoot=$target;backup=$backup;entries=$entries;deleted=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Write-Output "Copied and SHA256 verified $($entries.Count) data files. Manifest: $manifestPath"
    exit
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$evidence = Get-Content -LiteralPath (Join-Path $target 'migration-acceptance.json') -Raw | ConvertFrom-Json
if (-not ($evidence.localOnlineMatch -and $evidence.offlineCache -and $evidence.coldShortcut -and $evidence.rootIsE)) { throw 'Migration acceptance gates have not passed.' }
if ($manifest.sourceRoot -ne $repo -or $manifest.targetRoot -ne $target) { throw 'Manifest identity mismatch' }
foreach ($entry in $manifest.entries) {
    $allowed = @((Join-Path $repo 'data'), (Join-Path $repo '.wrangler\state'), $legacy) | Where-Object { $entry.source.StartsWith($_.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }
    if (-not $allowed) { throw "Source outside allowlist: $($entry.source)" }
    Assert-Within $entry.destination $target
    Assert-Within $entry.rollback $target
    if ((Get-FileHash -LiteralPath $entry.rollback -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Rollback copy changed' }
    if (-not (Test-Path -LiteralPath $entry.destination)) { throw 'Migrated destination is missing' }
    if (Test-Path -LiteralPath $entry.source) {
        if ((Get-FileHash -LiteralPath $entry.source -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Source changed: $($entry.source)" }
    }
}
foreach ($entry in $manifest.entries) { Remove-Item -LiteralPath $entry.source -Force -ErrorAction Stop }
$manifest.deleted = $true
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Deleted only $($manifest.entries.Count) verified source files. Rollback copies remain on E:."
