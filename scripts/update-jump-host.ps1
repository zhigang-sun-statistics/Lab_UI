[CmdletBinding()]
param(
  [string]$Branch = "main",
  [string]$HttpsRepository = "https://github.com/zhigang-sun-statistics/Lab_UI.git"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE"
  }
}

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "[Lab_UI] Repository: $repo" -ForegroundColor Cyan
Invoke-Native git config --global --add safe.directory ($repo.Replace('\','/'))

$generatedStyle = "src/client/styles.gen.ts"
if (Test-Path $generatedStyle) {
  $styleStatus = git status --porcelain -- $generatedStyle
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect $generatedStyle" }
  if ($styleStatus) {
    Write-Host "[Lab_UI] Restoring generated $generatedStyle before pull" -ForegroundColor Yellow
    Invoke-Native git restore -- $generatedStyle
  }
}

Write-Host "[Lab_UI] Fetching origin/$Branch" -ForegroundColor Cyan
& git fetch origin $Branch
if ($LASTEXITCODE -eq 0) {
  Invoke-Native git merge --ff-only "origin/$Branch"
} else {
  Write-Host "[Lab_UI] Origin fetch failed; retrying public HTTPS repository" -ForegroundColor Yellow
  Invoke-Native git fetch $HttpsRepository $Branch
  Invoke-Native git merge --ff-only FETCH_HEAD
}

Write-Host "[Lab_UI] Type checking" -ForegroundColor Cyan
Invoke-Native pnpm run typecheck

Write-Host "[Lab_UI] Building Web artifacts" -ForegroundColor Cyan
Invoke-Native pnpm run build

$revision = git rev-parse --short HEAD
if ($LASTEXITCODE -ne 0) { throw "Unable to read Git revision" }
Write-Host "[Lab_UI] Build complete at $revision" -ForegroundColor Green
Write-Host "[Lab_UI] Production service was NOT started or restarted." -ForegroundColor Yellow
