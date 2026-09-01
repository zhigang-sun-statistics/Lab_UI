param(
    [ValidateSet('Status','Disable','Restore')]
    [string]$Action = 'Status',
    [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
)

$ErrorActionPreference = 'Stop'
$packagePath = Join-Path $ProfileDir 'package.json'
$backupPath = Join-Path $ProfileDir 'package.before-lab-safe-mode.json'

if (-not (Test-Path $packagePath)) { throw "Desktop profile package not found: $packagePath" }

function Read-Package { return Get-Content -Raw -Encoding UTF8 $packagePath | ConvertFrom-Json }
function Has-LabPlugin($pkg) { return @($pkg.dsh.profile.bundles) -contains 'dsh-lab-controller' }
function Write-Package($pkg) {
    $json = $pkg | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($packagePath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

if ($Action -eq 'Status') {
    $pkg = Read-Package
    Write-Host ("Lab controller enabled: " + (Has-LabPlugin $pkg))
    Write-Host ("Recovery backup exists: " + (Test-Path $backupPath))
    exit 0
}

if ($Action -eq 'Disable') {
    if (-not (Test-Path $backupPath)) { Copy-Item $packagePath $backupPath -Force }
    $pkg = Read-Package
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-lab-controller' })
    if ($pkg.dependencies) { $pkg.dependencies.PSObject.Properties.Remove('dsh-lab-controller') }
    Write-Package $pkg
    Write-Host 'Lab controller disabled. Start DeepSeek Harness Desktop again.' -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $backupPath)) { throw "Recovery backup not found: $backupPath" }
Copy-Item $backupPath $packagePath -Force
Write-Host 'Lab controller profile entry restored. Start DeepSeek Harness Desktop again.' -ForegroundColor Green
