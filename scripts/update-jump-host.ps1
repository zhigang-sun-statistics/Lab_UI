[CmdletBinding()]
param(
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "[Lab_UI] Repository: $repo" -ForegroundColor Cyan

git config --global --add safe.directory ($repo -replace '\\','/')

$generatedStyle = "src/client/styles.gen.ts"
if (Test-Path $generatedStyle) {
  $styleStatus = git status --porcelain -- $generatedStyle
  if ($styleStatus) {
    Write-Host "[Lab_UI] Restoring generated $generatedStyle before pull" -ForegroundColor Yellow
    git restore -- $generatedStyle
  }
}

Write-Host "[Lab_UI] Fetching origin/$Branch" -ForegroundColor Cyan
git fetch origin $Branch

git merge --ff-only "origin/$Branch"

Write-Host "[Lab_UI] Type checking" -ForegroundColor Cyan
pnpm run typecheck

Write-Host "[Lab_UI] Building Web artifacts" -ForegroundColor Cyan
pnpm run build

$revision = git rev-parse --short HEAD
Write-Host "[Lab_UI] Build complete at $revision" -ForegroundColor Green
Write-Host "[Lab_UI] Production service was NOT started or restarted." -ForegroundColor Yellow
