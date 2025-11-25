#!/usr/bin/env pwsh

param(
    [Parameter(Mandatory=$true)]
    [string]$Action  # compile | upload | clean | run
)

$ErrorActionPreference = "Stop"

$YAML_FILE = "home-assistant-voice.elevenlabs.yaml"

# Optimize ESP-IDF compilation to reduce memory usage
# Single-threaded compilation and no debug symbols reduces peak memory consumption
$env:MAKEFLAGS = "-j1"  # Single-threaded make for ESP-IDF

# Disable debug symbols to reduce memory during compilation
# Debug symbols significantly increase memory usage without being needed for releases
$env:CFLAGS = "$(if ($env:CFLAGS) { $env:CFLAGS } else { '' }) -g0"
$env:CXXFLAGS = "$(if ($env:CXXFLAGS) { $env:CXXFLAGS } else { '' }) -g0"

Write-Host "ℹ  Applying ESP-IDF build optimizations:" -ForegroundColor Cyan
Write-Host "   - Single-threaded compilation (MAKEFLAGS=-j1)"
Write-Host "   - Reduced debug symbols (-g0) to conserve memory"

# Collect substitutions from current environment (after 1Password injection if used)
$SubArgs = @()
Get-ChildItem env: | Where-Object { $_.Name -like "HEY_JARVIS_*" -and $_.Value } | ForEach-Object {
    $SubArgs += "--substitution"
    $SubArgs += $_.Name
    $SubArgs += $_.Value
}

# Execute esphome with collected arguments
python3.13 -m esphome @SubArgs $Action $YAML_FILE
