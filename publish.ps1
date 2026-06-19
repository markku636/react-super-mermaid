<#
.SYNOPSIS
  Build and publish react-super-mermaid to npm.

.DESCRIPTION
  Runs in the package folder: check auth -> (optional) bump version -> npm publish.
  npm publish triggers prepublishOnly (typecheck + tsup build), so no extra build here.

  Auth (pick one; the token is NEVER written into this file):
    - Env var NPM_TOKEN (recommended, leaves no trace):
        one-off:    $env:NPM_TOKEN = 'npm_xxx'; ./publish.ps1
        persistent: setx NPM_TOKEN "npm_xxx"   (reopen terminal; stored in user env, not in repo)
    - Or run `npm login` / `npm config set //registry.npmjs.org/:_authToken=...` beforehand.

  2FA note:
    - An "Automation" classic token bypasses 2FA -> runs fully unattended, no prompt.
    - A normal / security-key 2FA token will make npm open a browser to confirm with your
      security key. Run this in an INTERACTIVE PowerShell window (not in the background).

.PARAMETER Bump
  Bump the version before publishing: none (default) / patch / minor / major.
  Republishing the same version is rejected by npm; use this for new releases.

.PARAMETER DryRun
  npm publish --dry-run only (packs and lists tarball, does not upload).

.EXAMPLE
  ./publish.ps1
  ./publish.ps1 -Bump patch
  ./publish.ps1 -DryRun
#>
param(
  [ValidateSet('none', 'patch', 'minor', 'major')]
  [string]$Bump = 'none',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# Always run from the script's own folder (= package root), wherever it's invoked from.
Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

Write-Step 'react-super-mermaid publish'

# Auth: prefer env var NPM_TOKEN (not stored in this file); else fall back to npm login/config.
$authArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:NPM_TOKEN)) {
  $authArgs = @("--//registry.npmjs.org/:_authToken=$($env:NPM_TOKEN)")
  Write-Host 'auth source: env NPM_TOKEN'
}

# 1. Verify login / token.
$who = npm whoami @authArgs
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($who)) {
  Write-Host 'Not logged in to npm. Set NPM_TOKEN or run `npm login`:' -ForegroundColor Red
  Write-Host "  `$env:NPM_TOKEN = 'npm_xxx'   # one-off" -ForegroundColor Yellow
  Write-Host '  setx NPM_TOKEN "npm_xxx"      # persistent (reopen terminal)' -ForegroundColor Yellow
  exit 1
}
Write-Host "logged in as: $who"

# 2. Optional version bump.
if ($Bump -ne 'none') {
  Write-Step "bump version ($Bump)"
  npm version $Bump --no-git-tag-version
  if ($LASTEXITCODE -ne 0) { Write-Host 'npm version failed.' -ForegroundColor Red; exit 1 }
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
Write-Host "package: $($pkg.name)@$($pkg.version)"

# 3. Publish (prepublishOnly auto-runs typecheck + build).
$publishArgs = @('publish', '--access', 'public') + $authArgs
if ($DryRun) { $publishArgs += '--dry-run' }

Write-Step "npm $(@('publish','--access','public') -join ' ')$(if ($DryRun) { ' --dry-run' })"
npm @publishArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Publish failed.' -ForegroundColor Red
  Write-Host 'If the error is EOTP / 2FA required:' -ForegroundColor Yellow
  Write-Host '  (a) run this in an interactive PowerShell; npm opens a browser to confirm with your security key, or' -ForegroundColor Yellow
  Write-Host '  (b) use an "Automation" classic token (bypasses 2FA) as NPM_TOKEN.' -ForegroundColor Yellow
  exit 1
}

if ($DryRun) {
  Write-Host 'OK: dry-run complete (nothing uploaded).' -ForegroundColor Green
}
else {
  Write-Host "OK: published $($pkg.name)@$($pkg.version)" -ForegroundColor Green
  Write-Step 'live version'
  npm view $pkg.name version
}
