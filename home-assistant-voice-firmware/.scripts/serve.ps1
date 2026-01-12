#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

# Use OTA upload instead of USB
# ESPHome will automatically discover the device on the network
& "$PSScriptRoot\invoke-esphome.ps1" run
