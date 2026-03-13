#!/usr/bin/env bash
set -euo pipefail
# Build (compile) firmware; substitutions added by invoke-esphome.sh

export HEY_JARVIS_WIFI_SSID="${HEY_JARVIS_WIFI_SSID:-build-placeholder-ssid}"
export HEY_JARVIS_WIFI_PASSWORD="${HEY_JARVIS_WIFI_PASSWORD:-build-placeholder-password}"
export HEY_JARVIS_ELEVENLABS_AGENT_ID="${HEY_JARVIS_ELEVENLABS_AGENT_ID:-build-placeholder-agent-id}"
export HEY_JARVIS_ELEVENLABS_API_KEY="${HEY_JARVIS_ELEVENLABS_API_KEY:-build-placeholder-api-key}"

# Firmware compilation only needs placeholder values, so avoid 1Password env resolution here.
bash ./.scripts/invoke-esphome.sh compile
