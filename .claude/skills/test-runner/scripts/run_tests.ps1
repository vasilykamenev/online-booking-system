<#
.SYNOPSIS
  run_tests.ps1 — run Vitest (unit) or Playwright (e2e) tests in a Next.js
  project and print a compact summary instead of the full raw output.

.USAGE
  pwsh scripts/run_tests.ps1 unit
  pwsh scripts/run_tests.ps1 unit src/components/Foo
  pwsh scripts/run_tests.ps1 e2e
  pwsh scripts/run_tests.ps1 e2e tests/login.spec.ts
  pwsh scripts/run_tests.ps1 e2e -- --project=chromium

.ENV
  TEST_PROJECT_DIR   Optional. Directory to start searching for package.json
                      from. Defaults to the current directory.

  Exits with the underlying test runner's exit code.
#>

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet("unit", "e2e")]
    [string]$Mode,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"

# Split $Rest into positional target (path/pattern) vs extra args after "--"
$Positional = @()
$ExtraArgs = @()
$seenDashDash = $false
foreach ($arg in $Rest) {
    if ($arg -eq "--") { $seenDashDash = $true; continue }
    if ($seenDashDash) { $ExtraArgs += $arg } else { $Positional += $arg }
}

# ---- Locate the nearest package.json, walking up from TEST_PROJECT_DIR/cwd ----
$startDir = if ($env:TEST_PROJECT_DIR) { $env:TEST_PROJECT_DIR } else { (Get-Location).Path }
$projectRoot = $null
$dir = Get-Item -LiteralPath $startDir
while ($null -ne $dir) {
    if (Test-Path (Join-Path $dir.FullName "package.json")) {
        $projectRoot = $dir.FullName
        break
    }
    $dir = $dir.Parent
}

if (-not $projectRoot) {
    Write-Error "Could not find a package.json above $startDir. Set `$env:TEST_PROJECT_DIR or cd into the project first."
    exit 2
}

Set-Location $projectRoot

$logDir = Join-Path $projectRoot ".claude-test-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "$Mode-$ts.log"

# ---- Pick a package manager ----
$pm = "npm"
if (Test-Path "pnpm-lock.yaml") { $pm = "pnpm" }
if (Test-Path "yarn.lock") { $pm = "yarn" }
if (Test-Path "bun.lockb") { $pm = "bun" }

function Test-HasScript($scriptName) {
    try {
        $pkg = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
        return $null -ne $pkg.scripts.$scriptName
    } catch {
        return $false
    }
}

function Invoke-ViaPm($scriptName, $argsList) {
    switch ($pm) {
        "npm"  { & npm run $scriptName -- @argsList }
        "pnpm" { & pnpm run $scriptName -- @argsList }
        "yarn" { & yarn run $scriptName @argsList }
        "bun"  { & bun run $scriptName @argsList }
    }
}

# ---- Build and run the command, redirecting all output to the log file ----
$cmdDesc = ""
$env:CI = "true"   # forces Vitest out of watch mode; harmless for Playwright

if ($Mode -eq "unit") {
    $reporterArgs = if ($ExtraArgs.Count -gt 0) { $ExtraArgs } else { @("--reporter=dot") }
    $targetArgs = $Positional

    if (Test-HasScript "test:unit") {
        $cmdDesc = "$pm run test:unit"
        Invoke-ViaPm "test:unit" (@("--run") + $reporterArgs + $targetArgs) *> $logFile
        $status = $LASTEXITCODE
    } elseif (Test-HasScript "test") {
        $cmdDesc = "$pm run test"
        Invoke-ViaPm "test" (@("--run") + $reporterArgs + $targetArgs) *> $logFile
        $status = $LASTEXITCODE
    } else {
        $cmdDesc = "npx vitest run"
        & npx vitest run @reporterArgs @targetArgs *> $logFile
        $status = $LASTEXITCODE
    }
} else {
    $reporterArgs = if ($ExtraArgs.Count -gt 0) { $ExtraArgs } else { @("--reporter=line") }
    $targetArgs = $Positional

    if (Test-HasScript "test:e2e") {
        $cmdDesc = "$pm run test:e2e"
        Invoke-ViaPm "test:e2e" ($reporterArgs + $targetArgs) *> $logFile
        $status = $LASTEXITCODE
    } elseif (Test-HasScript "e2e") {
        $cmdDesc = "$pm run e2e"
        Invoke-ViaPm "e2e" ($reporterArgs + $targetArgs) *> $logFile
        $status = $LASTEXITCODE
    } else {
        $cmdDesc = "npx playwright test"
        & npx playwright test @reporterArgs @targetArgs *> $logFile
        $status = $LASTEXITCODE
    }
}

# ---- Compact summary ----
Write-Host "== ran: $cmdDesc (mode=$Mode) in $projectRoot =="
Write-Host "== exit code: $status =="
Write-Host ""

$logContent = Get-Content $logFile -ErrorAction SilentlyContinue

if ($Mode -eq "unit") {
    $logContent | Select-String -Pattern "Test Files|^\s*Tests\s|Duration" | ForEach-Object { $_.Line }
    if ($status -ne 0) {
        Write-Host ""
        Write-Host "-- failing tests --"
        $logContent | Select-String -Pattern "FAIL|✗|×" | Select-Object -Unique Line | ForEach-Object { $_.Line }
    }
} else {
    $logContent | Select-String -Pattern "passed|failed|flaky|skipped" | Select-Object -Last 5 | ForEach-Object { $_.Line }
    if ($status -ne 0) {
        Write-Host ""
        Write-Host "-- failing tests --"
        $logContent | Select-String -Pattern "^\s*[0-9]+\)\s" | ForEach-Object { $_.Line }
        $logContent | Select-String -Pattern "Serving HTML report|npx playwright show-report" | ForEach-Object { $_.Line }
    }
}

Write-Host ""
Write-Host "Full log: $logFile"

exit $status
