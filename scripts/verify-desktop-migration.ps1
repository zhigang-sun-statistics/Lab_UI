param(
    [string]$BaseUrl = 'http://127.0.0.1:43120'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$clientBundle = Join-Path $repo 'lib\client.js'

function Test-JsonRoute([string]$Path) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + $Path) -TimeoutSec 20
        return [pscustomobject]@{ Path = $Path; Status = [int]$response.StatusCode; Body = $response.Content }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        return [pscustomobject]@{ Path = $Path; Status = $status; Body = $_.Exception.Message }
    }
}

if (-not (Test-Path $clientBundle)) { throw "Missing bundle: $clientBundle. Run pnpm run build first." }
$bundle = Get-Content -Raw -Encoding UTF8 $clientBundle
$checks = [ordered]@{
    DeviceWorkspace = $bundle.Contains('dm-root')
    PhysicalTopology = $bundle.Contains('lab-device-node')
    FileTransfer = $bundle.Contains('transfer-root')
    MultiSsh = $bundle.Contains('dm-ssh-tab') -and $bundle.Contains('/api/lab/ssh')
    ActualUsage = $bundle.Contains('LIVE USAGE')
    NoAgentComponent = -not $bundle.Contains('AgentView')
}

$files = Test-JsonRoute '/api/files/me/switches'
$usage = Test-JsonRoute '/api/lab/actual-usage'
$port = ([uri]$BaseUrl).Port
$process = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host 'Desktop Device Management migration verification' -ForegroundColor Cyan
foreach ($entry in $checks.GetEnumerator()) {
    $prefix = if ($entry.Value) { '[PASS] ' } else { '[FAIL] ' }
    Write-Host ($prefix + $entry.Key)
}
Write-Host ("[HTTP $($files.Status)] $($files.Path)")
Write-Host ("[HTTP $($usage.Status)] $($usage.Path)")
if ($process) { Write-Host ("Desktop web PID: $($process.OwningProcess)") }

$failed = @($checks.Values | Where-Object { -not $_ }).Count -gt 0 -or $files.Status -ne 200 -or $usage.Status -ne 200
if ($failed) {
    Write-Host 'Verification incomplete. Fully exit and reopen DeepSeek Harness Desktop, then rerun this script.' -ForegroundColor Yellow
    exit 1
}
Write-Host 'Migration verified.' -ForegroundColor Green
